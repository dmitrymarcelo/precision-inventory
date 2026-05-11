import { getSessionFromRequest } from './auth';

const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store'
};

const lockTtlMs = 45_000;

export async function onRequestGet({ request, env }) {
  await ensureSchema(env.DB);

  const url = new URL(request.url);
  const requestId = normalizeId(url.searchParams.get('requestId') || '');
  if (!requestId) {
    return Response.json({ ok: false, message: 'Informe requestId.' }, { status: 400, headers: jsonHeaders });
  }

  const lock = await readLock(env.DB, requestId);
  if (!lock) return Response.json({ ok: true, lock: null }, { headers: jsonHeaders });
  return Response.json({ ok: true, lock }, { headers: jsonHeaders });
}

export async function onRequestPost({ request, env }) {
  await ensureSchema(env.DB);

  const url = new URL(request.url);
  const action = (url.searchParams.get('action') || '').toLowerCase();
  const session = await getSessionFromRequest(request, env.DB);
  if (!session) {
    return Response.json({ ok: false, message: 'Sessão inválida.' }, { status: 401, headers: jsonHeaders });
  }

  const body = await safeJson(request);
  const requestId = normalizeId(body?.requestId);
  if (!requestId) {
    return Response.json({ ok: false, message: 'Informe requestId.' }, { status: 400, headers: jsonHeaders });
  }

  if (action === 'acquire') {
    const lock = await acquireLock(env.DB, requestId, session);
    if (!lock.ok) {
      return Response.json({ ok: false, lock: lock.lock }, { status: 409, headers: jsonHeaders });
    }
    return Response.json({ ok: true, lock: lock.lock }, { headers: jsonHeaders });
  }

  if (action === 'heartbeat') {
    const lock = await heartbeatLock(env.DB, requestId, session);
    if (!lock.ok) {
      return Response.json({ ok: false, lock: lock.lock }, { status: 409, headers: jsonHeaders });
    }
    return Response.json({ ok: true, lock: lock.lock }, { headers: jsonHeaders });
  }

  if (action === 'release') {
    await releaseLock(env.DB, requestId, session);
    return Response.json({ ok: true }, { headers: jsonHeaders });
  }

  return Response.json({ ok: false }, { status: 404, headers: jsonHeaders });
}

export function onRequestOptions() {
  return new Response(null, {
    headers: {
      ...jsonHeaders,
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type, authorization'
    }
  });
}

async function ensureSchema(db) {
  await db
    .prepare(
      `
        CREATE TABLE IF NOT EXISTS request_locks (
          request_id TEXT PRIMARY KEY,
          holder_user_id TEXT NOT NULL,
          holder_matricula TEXT NOT NULL,
          holder_name TEXT NOT NULL,
          holder_role TEXT NOT NULL,
          acquired_at TEXT NOT NULL,
          heartbeat_at TEXT NOT NULL,
          expires_at TEXT NOT NULL
        )
      `
    )
    .run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_request_locks_expires ON request_locks (expires_at)').run();
}

async function readLock(db, requestId) {
  const nowIso = new Date().toISOString();
  const row = await db
    .prepare(
      `
        SELECT request_id as requestId,
               holder_user_id as holderUserId,
               holder_matricula as holderMatricula,
               holder_name as holderName,
               holder_role as holderRole,
               acquired_at as acquiredAt,
               heartbeat_at as heartbeatAt,
               expires_at as expiresAt
        FROM request_locks
        WHERE request_id = ?
          AND expires_at > ?
        LIMIT 1
      `
    )
    .bind(requestId, nowIso)
    .first();

  if (!row) return null;

  return {
    requestId: String(row.requestId),
    holder: {
      userId: String(row.holderUserId),
      matricula: String(row.holderMatricula || ''),
      name: String(row.holderName || ''),
      role: String(row.holderRole || '')
    },
    acquiredAt: String(row.acquiredAt),
    heartbeatAt: String(row.heartbeatAt),
    expiresAt: String(row.expiresAt)
  };
}

async function acquireLock(db, requestId, session) {
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + lockTtlMs).toISOString();

  const update = await db
    .prepare(
      `
        UPDATE request_locks
        SET holder_user_id = ?,
            holder_matricula = ?,
            holder_name = ?,
            holder_role = ?,
            acquired_at = ?,
            heartbeat_at = ?,
            expires_at = ?
        WHERE request_id = ?
          AND (expires_at <= ? OR holder_user_id = ?)
      `
    )
    .bind(
      session.userId,
      session.matricula,
      session.name,
      session.role,
      nowIso,
      nowIso,
      expiresAt,
      requestId,
      nowIso,
      session.userId
    )
    .run();

  if (Number(update.meta?.changes || 0) > 0) {
    const lock = await readLock(db, requestId);
    return { ok: true, lock };
  }

  const insert = await db
    .prepare(
      `
        INSERT INTO request_locks (
          request_id,
          holder_user_id,
          holder_matricula,
          holder_name,
          holder_role,
          acquired_at,
          heartbeat_at,
          expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(request_id) DO NOTHING
      `
    )
    .bind(
      requestId,
      session.userId,
      session.matricula,
      session.name,
      session.role,
      nowIso,
      nowIso,
      expiresAt
    )
    .run();

  if (Number(insert.meta?.changes || 0) > 0) {
    const lock = await readLock(db, requestId);
    return { ok: true, lock };
  }

  const lock = await readLock(db, requestId);
  return { ok: false, lock };
}

async function heartbeatLock(db, requestId, session) {
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + lockTtlMs).toISOString();

  const update = await db
    .prepare(
      `
        UPDATE request_locks
        SET heartbeat_at = ?,
            expires_at = ?
        WHERE request_id = ?
          AND holder_user_id = ?
      `
    )
    .bind(nowIso, expiresAt, requestId, session.userId)
    .run();

  if (Number(update.meta?.changes || 0) > 0) {
    const lock = await readLock(db, requestId);
    return { ok: true, lock };
  }

  const lock = await readLock(db, requestId);
  return { ok: false, lock };
}

async function releaseLock(db, requestId, session) {
  await db
    .prepare('DELETE FROM request_locks WHERE request_id = ? AND holder_user_id = ?')
    .bind(requestId, session.userId)
    .run();
}

function normalizeId(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.length > 120) return trimmed.slice(0, 120);
  return trimmed;
}

async function safeJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
