import { getSessionFromRequest } from './auth.js';

const RETENTION_DAYS = 7;
const MAX_PAYLOAD_CHARS = 220000;

const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store'
};

export async function onRequestPost({ request, env }) {
  await ensureSchema(env.DB);
  const session = await getSessionFromRequest(request, env.DB);
  if (!session) {
    return Response.json({ ok: false, message: 'Sessao invalida.' }, { status: 401, headers: jsonHeaders });
  }

  const body = await safeJson(request);
  const entries = Array.isArray(body?.entries) ? body.entries : body?.entry ? [body.entry] : [];
  if (entries.length === 0) {
    return Response.json({ ok: false, message: 'Nenhuma operacao enviada.' }, { status: 400, headers: jsonHeaders });
  }

  const receivedAt = new Date().toISOString();
  let accepted = 0;
  const acceptedIds = [];

  for (const rawEntry of entries.slice(0, 25)) {
    const entry = sanitizeEntry(rawEntry, session, receivedAt);
    if (!entry) continue;

    await env.DB
      .prepare(
        `
          INSERT OR IGNORE INTO operation_journal (
            id, device_id, actor_matricula, actor_name, actor_role,
            operation_type, entity, payload, status, created_at, received_at, applied_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
        `
      )
      .bind(
        entry.id,
        entry.deviceId,
        entry.actorMatricula,
        entry.actorName,
        entry.actorRole,
        entry.operationType,
        entry.entity,
        entry.payload,
        'received',
        entry.createdAt,
        receivedAt
      )
      .run();
    accepted += 1;
    acceptedIds.push(entry.id);
  }

  const cleanupDeleted = await cleanupOldJournalRows(env.DB, receivedAt);
  return Response.json({ ok: true, accepted, acceptedIds, cleanupDeleted }, { headers: jsonHeaders });
}

export async function onRequestPut({ request, env }) {
  await ensureSchema(env.DB);
  const session = await getSessionFromRequest(request, env.DB);
  if (!session) {
    return Response.json({ ok: false, message: 'Sessao invalida.' }, { status: 401, headers: jsonHeaders });
  }

  const body = await safeJson(request);
  const ids = Array.isArray(body?.ids)
    ? body.ids.map(value => String(value || '').trim()).filter(Boolean).slice(0, 50)
    : [];
  const status = body?.status === 'applied' ? 'applied' : '';
  if (!ids.length || !status) {
    return Response.json({ ok: false, message: 'Informe operacoes aplicadas.' }, { status: 400, headers: jsonHeaders });
  }

  const appliedAt = new Date().toISOString();
  const placeholders = ids.map(() => '?').join(', ');
  const result = await env.DB
    .prepare(
      `
        UPDATE operation_journal
        SET status = ?, applied_at = ?
        WHERE id IN (${placeholders})
      `
    )
    .bind(status, appliedAt, ...ids)
    .run();

  const cleanupDeleted = await cleanupOldJournalRows(env.DB, appliedAt);
  return Response.json(
    { ok: true, updated: Number(result?.meta?.changes) || 0, cleanupDeleted },
    { headers: jsonHeaders }
  );
}

export function onRequestOptions() {
  return new Response(null, {
    headers: {
      ...jsonHeaders,
      'access-control-allow-methods': 'POST, PUT, OPTIONS',
      'access-control-allow-headers': 'content-type, authorization'
    }
  });
}

async function ensureSchema(db) {
  await db
    .prepare(
      `
        CREATE TABLE IF NOT EXISTS operation_journal (
          id TEXT PRIMARY KEY,
          device_id TEXT NOT NULL,
          actor_matricula TEXT,
          actor_name TEXT,
          actor_role TEXT,
          operation_type TEXT NOT NULL,
          entity TEXT NOT NULL,
          payload TEXT NOT NULL,
          status TEXT NOT NULL,
          created_at TEXT NOT NULL,
          received_at TEXT NOT NULL,
          applied_at TEXT
        )
      `
    )
    .run();

  await db
    .prepare('CREATE INDEX IF NOT EXISTS idx_operation_journal_created_at ON operation_journal(created_at)')
    .run();
  await db
    .prepare('CREATE INDEX IF NOT EXISTS idx_operation_journal_status ON operation_journal(status)')
    .run();
}

async function cleanupOldJournalRows(db, nowIso) {
  const cutoff = new Date(new Date(nowIso).getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const result = await db
    .prepare('DELETE FROM operation_journal WHERE created_at < ?')
    .bind(cutoff)
    .run();
  return Number(result?.meta?.changes) || 0;
}

async function safeJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function sanitizeEntry(rawEntry, session, receivedAt) {
  const id = sanitizeText(rawEntry?.id, 120);
  const deviceId = sanitizeText(rawEntry?.deviceId, 120);
  const operationType = sanitizeText(rawEntry?.operationType, 80) || 'state_patch';
  const entity = sanitizeText(rawEntry?.entity, 80) || 'inventory_state';
  const createdAt = sanitizeIso(rawEntry?.createdAt) || receivedAt;
  const payload = JSON.stringify(rawEntry?.payload || {});

  if (!id || !deviceId || payload.length > MAX_PAYLOAD_CHARS) return null;

  return {
    id,
    deviceId,
    actorMatricula: sanitizeText(session.matricula, 80),
    actorName: sanitizeText(session.name, 160),
    actorRole: sanitizeText(session.role, 40),
    operationType,
    entity,
    payload,
    createdAt
  };
}

function sanitizeText(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function sanitizeIso(value) {
  const text = typeof value === 'string' ? value : '';
  const date = new Date(text);
  return Number.isFinite(date.getTime()) ? date.toISOString() : '';
}
