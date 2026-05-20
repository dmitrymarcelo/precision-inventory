import { getSessionFromRequest } from './auth.js';

const RETENTION_DAYS = 7;
const MAX_PAYLOAD_CHARS = 220000;
const STATE_KEY = 'inventory';
const MAX_STATE_CHARS = 1800000;

const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store'
};

export async function onRequestPost({ request, env }) {
  await ensureSchema(env.DB);
  const url = new URL(request.url);
  const action = (url.searchParams.get('action') || '').toLowerCase();

  const session = await getSessionFromRequest(request, env.DB);
  if (!session) {
    return Response.json({ ok: false, message: 'Sessao invalida.' }, { status: 401, headers: jsonHeaders });
  }

  if (action === 'replay') {
    const role = String(session.role || '');
    if (role !== 'admin' && role !== 'operacao') {
      return Response.json({ ok: false, message: 'Sem permissao.' }, { status: 403, headers: jsonHeaders });
    }
    return replayEntries({ request, env });
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
    .prepare(`
      CREATE TABLE IF NOT EXISTS app_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `)
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

async function replayEntries({ request, env }) {
  const body = await safeJson(request);
  const ids = Array.isArray(body?.ids) ? body.ids.map(value => String(value || '').trim()).filter(Boolean).slice(0, 25) : [];
  if (ids.length === 0) {
    return Response.json({ ok: false, message: 'Informe IDs para reprocessar.' }, { status: 400, headers: jsonHeaders });
  }

  const placeholders = ids.map(() => '?').join(', ');
  const rows = await env.DB
    .prepare(
      `
        SELECT id, payload, created_at
        FROM operation_journal
        WHERE id IN (${placeholders})
          AND status = 'received'
          AND entity = 'inventory_state'
          AND operation_type = 'state_patch'
      `
    )
    .bind(...ids)
    .all();

  const list = Array.isArray(rows?.results) ? rows.results : [];
  if (list.length === 0) {
    return Response.json({ ok: true, applied: 0 }, { headers: jsonHeaders });
  }

  list.sort((a, b) => parseUpdatedAt(a?.created_at) - parseUpdatedAt(b?.created_at));

  const existingRow = await env.DB
    .prepare('SELECT value, updated_at FROM app_state WHERE key = ?')
    .bind(STATE_KEY)
    .first();
  let state = existingRow ? normalizeState(JSON.parse(existingRow.value)) : normalizeState({});

  for (const row of list) {
    let patch = null;
    try {
      patch = JSON.parse(String(row.payload || ''));
    } catch {
      patch = null;
    }
    if (!patch || typeof patch !== 'object') continue;
    state = applyPatchToState(state, patch);
  }

  const updatedAt = new Date().toISOString();
  const serialized = JSON.stringify(state);
  if (serialized.length > MAX_STATE_CHARS) {
    return Response.json(
      { ok: false, message: 'Estado grande demais para aplicar agora. Aplique em lotes menores.' },
      { status: 413, headers: jsonHeaders }
    );
  }

  await env.DB
    .prepare(`
      INSERT INTO app_state (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `)
    .bind(STATE_KEY, serialized, updatedAt)
    .run();

  const appliedAt = updatedAt;
  const updateResult = await env.DB
    .prepare(
      `
        UPDATE operation_journal
        SET status = 'applied', applied_at = ?
        WHERE id IN (${placeholders})
      `
    )
    .bind(appliedAt, ...ids)
    .run();

  const cleanupDeleted = await cleanupOldJournalRows(env.DB, appliedAt);
  return Response.json(
    { ok: true, updatedAt, applied: Number(updateResult?.meta?.changes) || 0, cleanupDeleted },
    { headers: jsonHeaders }
  );
}

function normalizeState(body) {
  return {
    items: Array.isArray(body?.items) ? body.items : [],
    logs: Array.isArray(body?.logs) ? body.logs : [],
    settings: body?.settings && typeof body.settings === 'object' ? body.settings : {},
    requests: Array.isArray(body?.requests) ? body.requests : [],
    vehicles: Array.isArray(body?.vehicles) ? body.vehicles : [],
    purchases: Array.isArray(body?.purchases) ? body.purchases : [],
    ocrAliases: body?.ocrAliases && typeof body.ocrAliases === 'object' ? body.ocrAliases : {}
  };
}

function applyPatchToState(existingState, patch) {
  const incoming = {
    items: Array.isArray(patch.items) ? patch.items : [],
    logs: Array.isArray(patch.logs) ? patch.logs : [],
    requests: Array.isArray(patch.requests) ? patch.requests : [],
    vehicles: Array.isArray(patch.vehicles) ? patch.vehicles : [],
    purchases: Array.isArray(patch.purchases) ? patch.purchases : [],
    settings: patch.settings && typeof patch.settings === 'object' ? patch.settings : null,
    ocrAliases: patch.ocrAliases && typeof patch.ocrAliases === 'object' ? patch.ocrAliases : null
  };

  return {
    items: mergeItemsBySku(existingState.items || [], incoming.items),
    logs: mergeLogsById(existingState.logs || [], incoming.logs),
    settings: incoming.settings ? mergeSettings(existingState.settings || {}, incoming.settings) : existingState.settings || {},
    requests: mergeRequestsById(existingState.requests || [], incoming.requests),
    vehicles: mergeVehiclesById(existingState.vehicles || [], incoming.vehicles),
    purchases: mergePurchasesById(existingState.purchases || [], incoming.purchases),
    ocrAliases: incoming.ocrAliases ? mergeAliases(existingState.ocrAliases || {}, incoming.ocrAliases) : existingState.ocrAliases || {}
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
    merged.set(id, current ? mergeMaterialRequest(current, incoming) : incoming);
  }
  return Array.from(merged.values());
}

function mergeMaterialRequest(a, b) {
  const newer = chooseNewerRecord(a, b, 'updatedAt');
  const older = newer === a ? b : a;

  const merged = { ...older, ...newer };

  merged.items = mergeRequestItems(older?.items || [], newer?.items || []);
  merged.auditTrail = mergeAuditTrail(older?.auditTrail || [], newer?.auditTrail || []);

  const status = mergeRequestStatus(a, b);
  merged.status = status;

  if (status === 'Atendida') {
    merged.fulfilledAt = merged.fulfilledAt || a?.fulfilledAt || b?.fulfilledAt;
    merged.reversedAt = undefined;
  }

  if (status === 'Estornada') {
    merged.reversedAt = merged.reversedAt || a?.reversedAt || b?.reversedAt;
  }

  const updatedAtTime = Math.max(parseUpdatedAt(a?.updatedAt), parseUpdatedAt(b?.updatedAt));
  merged.updatedAt = updatedAtTime > 0 ? new Date(updatedAtTime).toISOString() : merged.updatedAt;

  if (a?.deletedAt || b?.deletedAt) {
    const deletedAtTime = Math.max(parseUpdatedAt(a?.deletedAt), parseUpdatedAt(b?.deletedAt));
    merged.deletedAt = deletedAtTime > 0 ? new Date(deletedAtTime).toISOString() : a?.deletedAt || b?.deletedAt;
  }

  return merged;
}

function mergeRequestStatus(a, b) {
  const statusA = typeof a?.status === 'string' ? a.status : '';
  const statusB = typeof b?.status === 'string' ? b.status : '';

  if (a?.reversedAt || b?.reversedAt) return 'Estornada';
  if (a?.fulfilledAt || b?.fulfilledAt) return 'Atendida';

  const rankA = requestStatusRank(statusA);
  const rankB = requestStatusRank(statusB);
  return rankA >= rankB ? statusA || statusB || 'Aberta' : statusB || statusA || 'Aberta';
}

function requestStatusRank(value) {
  switch (value) {
    case 'Estornada':
      return 5;
    case 'Atendida':
      return 4;
    case 'Separada':
      return 3;
    case 'Em separação':
      return 2;
    case 'Aberta':
      return 1;
    default:
      return 0;
  }
}

function mergeRequestItems(existingItems, incomingItems) {
  const merged = new Map();

  for (const item of existingItems) {
    if (item && item.sku) merged.set(String(item.sku), item);
  }

  for (const incoming of incomingItems) {
    if (!incoming || !incoming.sku) continue;
    const sku = String(incoming.sku);
    const current = merged.get(sku);

    if (!current) {
      merged.set(sku, incoming);
      continue;
    }

    const requestedQuantity = Math.max(Number(current.requestedQuantity) || 0, Number(incoming.requestedQuantity) || 0);
    const separatedQuantity = Math.max(Number(current.separatedQuantity) || 0, Number(incoming.separatedQuantity) || 0);

    const base = chooseNewerRecord(current, incoming, 'updatedAt');
    merged.set(sku, {
      ...current,
      ...incoming,
      ...base,
      requestedQuantity,
      separatedQuantity: Math.min(separatedQuantity, requestedQuantity)
    });
  }

  return Array.from(merged.values());
}

function mergeAuditTrail(existingEntries, incomingEntries) {
  if (!Array.isArray(existingEntries) && !Array.isArray(incomingEntries)) return undefined;
  const merged = new Map();
  const all = []
    .concat(Array.isArray(existingEntries) ? existingEntries : [])
    .concat(Array.isArray(incomingEntries) ? incomingEntries : []);

  for (const entry of all) {
    if (!entry) continue;
    const key = entry.id ? String(entry.id) : '';
    if (!key) continue;
    if (!merged.has(key)) merged.set(key, entry);
  }

  const result = Array.from(merged.values());
  result.sort((left, right) => parseUpdatedAt(left?.at) - parseUpdatedAt(right?.at));
  return result;
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

function mergePurchasesById(existingPurchases, incomingPurchases) {
  const merged = new Map();
  for (const purchase of existingPurchases) {
    if (purchase && purchase.id) merged.set(String(purchase.id), purchase);
  }
  for (const incoming of incomingPurchases) {
    if (!incoming || !incoming.id) continue;
    const id = String(incoming.id);
    const current = merged.get(id);
    merged.set(id, chooseNewerRecord(current, incoming, 'updatedAt'));
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
