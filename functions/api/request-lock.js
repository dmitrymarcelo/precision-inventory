import { getSessionFromRequest } from './auth.js';
import { getSupabaseAdmin, isSupabaseConfigured, migrateD1ToSupabaseIfNeeded } from './supabase.js';

const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store'
};

const lockTtlMs = 45_000;

export async function onRequestGet({ request, env }) {
  const supabaseEnabled = isSupabaseConfigured(env);
  if (supabaseEnabled) {
    const sb = getSupabaseAdmin(env);
    await migrateD1ToSupabaseIfNeeded(env, sb);
  } else {
    await ensureSchema(env.DB);
  }

  const url = new URL(request.url);
  const requestId = normalizeId(url.searchParams.get('requestId') || '');
  if (!requestId) {
    return Response.json({ ok: false, message: 'Informe requestId.' }, { status: 400, headers: jsonHeaders });
  }

  const lock = supabaseEnabled ? await readLockSupabase(env, requestId) : await readLock(env.DB, requestId);
  if (!lock) return Response.json({ ok: true, lock: null }, { headers: jsonHeaders });
  return Response.json({ ok: true, lock }, { headers: jsonHeaders });
}

export async function onRequestPost({ request, env }) {
  const supabaseEnabled = isSupabaseConfigured(env);
  if (supabaseEnabled) {
    const sb = getSupabaseAdmin(env);
    await migrateD1ToSupabaseIfNeeded(env, sb);
  } else {
    await ensureSchema(env.DB);
  }

  const url = new URL(request.url);
  const action = (url.searchParams.get('action') || '').toLowerCase();
  const session = await getSessionFromRequest(request, supabaseEnabled ? env : env.DB);
  if (!session) {
    return Response.json({ ok: false, message: 'Sessão inválida.' }, { status: 401, headers: jsonHeaders });
  }

  const body = await safeJson(request);
  const requestId = normalizeId(body?.requestId);
  if (!requestId) {
    return Response.json({ ok: false, message: 'Informe requestId.' }, { status: 400, headers: jsonHeaders });
  }

  if (action === 'acquire') {
    const lock = supabaseEnabled
      ? await acquireLockSupabase(env, requestId, session)
      : await acquireLock(env.DB, requestId, session);
    if (!lock.ok) {
      return Response.json({ ok: false, lock: lock.lock }, { status: 409, headers: jsonHeaders });
    }
    return Response.json({ ok: true, lock: lock.lock }, { headers: jsonHeaders });
  }

  if (action === 'heartbeat') {
    const lock = supabaseEnabled
      ? await heartbeatLockSupabase(env, requestId, session)
      : await heartbeatLock(env.DB, requestId, session);
    if (!lock.ok) {
      return Response.json({ ok: false, lock: lock.lock }, { status: 409, headers: jsonHeaders });
    }
    return Response.json({ ok: true, lock: lock.lock }, { headers: jsonHeaders });
  }

  if (action === 'release') {
    if (supabaseEnabled) {
      await releaseLockSupabase(env, requestId, session);
    } else {
      await releaseLock(env.DB, requestId, session);
    }
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

async function readLockSupabase(env, requestId) {
  const sb = getSupabaseAdmin(env);
  const nowIso = new Date().toISOString();
  const { data, error } = await sb
    .from('request_locks')
    .select(
      'request_id, holder_user_id, holder_matricula, holder_name, holder_role, acquired_at, heartbeat_at, expires_at'
    )
    .eq('request_id', requestId)
    .gt('expires_at', nowIso)
    .maybeSingle();
  if (error || !data) return null;
  return {
    requestId: String(data.request_id),
    holder: {
      userId: String(data.holder_user_id),
      matricula: String(data.holder_matricula || ''),
      name: String(data.holder_name || ''),
      role: String(data.holder_role || '')
    },
    acquiredAt: String(data.acquired_at),
    heartbeatAt: String(data.heartbeat_at),
    expiresAt: String(data.expires_at)
  };
}

async function acquireLockSupabase(env, requestId, session) {
  const sb = getSupabaseAdmin(env);
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + lockTtlMs).toISOString();

  const existing = await readLockSupabase(env, requestId);
  if (existing && existing.holder?.userId && String(existing.holder.userId) !== String(session.userId)) {
    return { ok: false, lock: existing };
  }

  const { error } = await sb.from('request_locks').upsert(
    [
      {
        request_id: requestId,
        holder_user_id: session.userId,
        holder_matricula: session.matricula,
        holder_name: session.name,
        holder_role: session.role,
        acquired_at: nowIso,
        heartbeat_at: nowIso,
        expires_at: expiresAt
      }
    ],
    { onConflict: 'request_id' }
  );
  if (error) {
    const lock = await readLockSupabase(env, requestId);
    return { ok: false, lock };
  }
  const lock = await readLockSupabase(env, requestId);
  return { ok: true, lock };
}

async function heartbeatLockSupabase(env, requestId, session) {
  const sb = getSupabaseAdmin(env);
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + lockTtlMs).toISOString();

  const { error } = await sb
    .from('request_locks')
    .update({ heartbeat_at: nowIso, expires_at: expiresAt })
    .eq('request_id', requestId)
    .eq('holder_user_id', session.userId);
  if (error) {
    const lock = await readLockSupabase(env, requestId);
    return { ok: false, lock };
  }
  const lock = await readLockSupabase(env, requestId);
  return { ok: Boolean(lock), lock };
}

async function releaseLockSupabase(env, requestId, session) {
  const sb = getSupabaseAdmin(env);
  await sb.from('request_locks').delete().eq('request_id', requestId).eq('holder_user_id', session.userId);
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
