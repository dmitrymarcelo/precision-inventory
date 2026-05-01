import { getSessionFromRequest } from './auth.js';

const STATE_KEY = 'inventory';

const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store'
};

export async function onRequestGet({ env }) {
  await ensureSchema(env.DB);

  const row = await env.DB
    .prepare('SELECT value, updated_at FROM app_state WHERE key = ?')
    .bind(STATE_KEY)
    .first();

  return Response.json({
    state: row ? JSON.parse(row.value) : null,
    updatedAt: row?.updated_at ?? null
  }, { headers: jsonHeaders });
}

export async function onRequestPut({ request, env }) {
  await ensureSchema(env.DB);

  const userCountRow = await env.DB.prepare('SELECT COUNT(1) as count FROM users').first();
  const hasUsers = (Number(userCountRow?.count) || 0) > 0;
  if (hasUsers) {
    const session = await getSessionFromRequest(request, env.DB);
    if (!session) {
      return Response.json({ ok: false, message: 'Sessão inválida.' }, { status: 401, headers: jsonHeaders });
    }
    if (session.role !== 'operacao' && session.role !== 'admin') {
      return Response.json({ ok: false, message: 'Sem permissão.' }, { status: 403, headers: jsonHeaders });
    }
  }

  const body = await request.json();
  const incomingState = normalizeState(body);
  const updatedAt = new Date().toISOString();

  const existingRow = await env.DB
    .prepare('SELECT value, updated_at FROM app_state WHERE key = ?')
    .bind(STATE_KEY)
    .first();

  const state = existingRow
    ? mergeStates(normalizeState(JSON.parse(existingRow.value)), incomingState)
    : incomingState;

  await env.DB
    .prepare(`
      INSERT INTO app_state (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `)
    .bind(STATE_KEY, JSON.stringify(state), updatedAt)
    .run();

  return Response.json({ ok: true, updatedAt }, { headers: jsonHeaders });
}

export function onRequestOptions() {
  return new Response(null, {
    headers: {
      ...jsonHeaders,
      'access-control-allow-methods': 'GET, PUT, OPTIONS',
      'access-control-allow-headers': 'content-type, authorization'
    }
  });
}

async function ensureSchema(db) {
  await db
    .prepare(`
      CREATE TABLE IF NOT EXISTS app_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `)
    .run();

  await db
    .prepare(
      `
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          matricula TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          role TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          password_salt TEXT NOT NULL,
          password_iters INTEGER NOT NULL,
          must_change_password INTEGER NOT NULL DEFAULT 0,
          active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `
    )
    .run();

  try {
    await db.prepare('ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0').run();
  } catch {}

  await db
    .prepare(
      `
        CREATE TABLE IF NOT EXISTS sessions (
          token TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          role TEXT NOT NULL,
          created_at TEXT NOT NULL,
          expires_at TEXT NOT NULL
        )
      `
    )
    .run();
}

function normalizeState(body) {
  return {
    items: Array.isArray(body?.items) ? body.items : [],
    logs: Array.isArray(body?.logs) ? body.logs : [],
    settings: body?.settings && typeof body.settings === 'object' ? body.settings : {},
    requests: Array.isArray(body?.requests) ? body.requests : [],
    vehicles: Array.isArray(body?.vehicles) ? body.vehicles : [],
    ocrAliases: body?.ocrAliases && typeof body.ocrAliases === 'object' ? body.ocrAliases : {}
  };
}

function mergeStates(existing, incoming) {
  return {
    items: mergeItemsBySku(existing.items, incoming.items),
    logs: mergeLogsById(existing.logs, incoming.logs),
    settings: mergeSettings(existing.settings, incoming.settings),
    requests: mergeRequestsById(existing.requests, incoming.requests),
    vehicles: mergeVehiclesById(existing.vehicles, incoming.vehicles),
    ocrAliases: mergeAliases(existing.ocrAliases, incoming.ocrAliases)
  };
}

function mergeItemsBySku(existingItems, incomingItems) {
  const merged = new Map();
  for (const item of existingItems) {
    if (item && item.sku) merged.set(String(item.sku), item);
  }
  for (const incoming of incomingItems) {
    if (!incoming || !incoming.sku) continue;
    const sku = String(incoming.sku);
    const current = merged.get(sku);
    merged.set(sku, chooseNewerRecord(current, incoming, 'updatedAt'));
  }
  return Array.from(merged.values());
}

function mergeRequestsById(existingRequests, incomingRequests) {
  const merged = new Map();
  for (const request of existingRequests) {
    if (request && request.id) merged.set(String(request.id), request);
  }
  for (const incoming of incomingRequests) {
    if (!incoming || !incoming.id) continue;
    const id = String(incoming.id);
    const current = merged.get(id);
    merged.set(id, chooseNewerRecord(current, incoming, 'updatedAt'));
  }
  return Array.from(merged.values());
}

function mergeVehiclesById(existingVehicles, incomingVehicles) {
  const merged = new Map();
  for (const vehicle of existingVehicles) {
    if (vehicle && vehicle.id) merged.set(String(vehicle.id), vehicle);
  }
  for (const incoming of incomingVehicles) {
    if (!incoming || !incoming.id) continue;
    merged.set(String(incoming.id), incoming);
  }
  return Array.from(merged.values());
}

function mergeLogsById(existingLogs, incomingLogs) {
  const merged = new Map();
  for (const log of existingLogs) {
    if (log && log.id) merged.set(String(log.id), log);
  }
  for (const incoming of incomingLogs) {
    if (!incoming || !incoming.id) continue;
    merged.set(String(incoming.id), incoming);
  }
  return Array.from(merged.values());
}

function mergeSettings(existing, incoming) {
  const existingIsEmpty = !existing || Object.keys(existing).length === 0;
  const incomingIsEmpty = !incoming || Object.keys(incoming).length === 0;
  if (incomingIsEmpty) return existingIsEmpty ? {} : existing;
  return { ...existing, ...incoming };
}

function mergeAliases(existing, incoming) {
  return {
    ...(existing && typeof existing === 'object' ? existing : {}),
    ...(incoming && typeof incoming === 'object' ? incoming : {})
  };
}

function chooseNewerRecord(current, incoming, updatedAtField) {
  if (!current) return incoming;
  const currentTime = parseUpdatedAt(current?.[updatedAtField]);
  const incomingTime = parseUpdatedAt(incoming?.[updatedAtField]);

  if (incomingTime === 0 && currentTime > 0) return current;
  if (incomingTime > currentTime) return incoming;
  if (currentTime > incomingTime) return current;
  return incoming;
}

function parseUpdatedAt(value) {
  if (!value || typeof value !== 'string') return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}
