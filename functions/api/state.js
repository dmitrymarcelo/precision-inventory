import { getSessionFromRequest } from './auth.js';

const STATE_KEY = 'inventory';
const STATE_V2_MANIFEST_KEY = 'inventory_v2_manifest';
const STATE_V2_PREFIX = 'inventory_v2';
const MAX_STATE_ROW_BYTES = 1900000;

const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store'
};

export async function onRequestGet({ env }) {
  const v2Manifest = await loadStateV2Manifest(env.DB);
  if (v2Manifest) {
    return new Response(streamStateV2Response(env.DB, v2Manifest), { headers: jsonHeaders });
  }

  const row = await env.DB.prepare('SELECT value, updated_at FROM app_state WHERE key = ?').bind(STATE_KEY).first();
  const stateText = row?.value ? String(row.value) : 'null';
  return new Response(`{"state":${stateText},"updatedAt":${JSON.stringify(row?.updated_at ?? null)}}`, {
    headers: jsonHeaders
  });
}

export async function onRequestPut({ request, env, context }) {
  try {
    await ensureSchema(env.DB);

    const userCountRow = await env.DB.prepare('SELECT COUNT(1) as count FROM users').first();
    const hasUsers = (Number(userCountRow?.count) || 0) > 0;
    let sessionRole = '';
    if (hasUsers) {
      const session = await getSessionFromRequest(request, env.DB);
      if (!session) {
        return Response.json({ ok: false, message: 'Sessão inválida.' }, { status: 401, headers: jsonHeaders });
      }
      sessionRole = String(session.role || '');
      if (sessionRole !== 'operacao' && sessionRole !== 'admin' && sessionRole !== 'consulta') {
        return Response.json({ ok: false, message: 'Sem permissão.' }, { status: 403, headers: jsonHeaders });
      }
    }

    const body = await request.json();
    const incomingState = normalizeState(body);
    const updatedAt = new Date().toISOString();

    const existingV2 = await loadStateV2(env.DB);
    const existingState = existingV2 ? normalizeState(existingV2.state) : await loadStateV1(env.DB);
    const canWriteFullState = !hasUsers || sessionRole === 'operacao' || sessionRole === 'admin';
    const state = canWriteFullState
      ? existingState
        ? mergeStates(existingState, incomingState)
        : incomingState
      : mergeConsultaRequestState(existingState || normalizeState({}), incomingState);

    const saved = await saveStateV2(env.DB, state, updatedAt);
    if (!saved.ok) {
      return Response.json(
        {
          ok: false,
          message:
            'Nao foi possivel sincronizar: dados muito grandes para o servidor. Use Exportar backup e Enviar backup ao servidor.'
        },
        { status: 413, headers: jsonHeaders }
      );
    }

    const newDivergenceLogs = existingState ? collectNewDivergenceLogs(existingState, state) : [];
    if (newDivergenceLogs.length > 0) {
      const task = sendDivergenceNotifications(newDivergenceLogs, updatedAt, env);
      if (context?.waitUntil) {
        context.waitUntil(task);
      } else {
        void task;
      }
    }

    return Response.json({ ok: true, updatedAt, state }, { headers: jsonHeaders });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const lowered = String(message || '').toLowerCase();
    const looksTooLarge =
      lowered.includes('toobig') ||
      lowered.includes('too big') ||
      lowered.includes('too large') ||
      lowered.includes('payload') ||
      lowered.includes('entity too large');

    if (looksTooLarge) {
      return Response.json(
        {
          ok: false,
          message:
            'Estado grande demais para salvar agora. Exporte o backup neste aparelho e depois descarte a pendencia local para continuar.'
        },
        { status: 413, headers: jsonHeaders }
      );
    }

    return Response.json(
      { ok: false, message: 'Servidor com instabilidade agora. Aguarde e tente novamente.' },
      { status: 500, headers: jsonHeaders }
    );
  }
}

async function loadStateV1(db) {
  const row = await db.prepare('SELECT value FROM app_state WHERE key = ?').bind(STATE_KEY).first();
  return row ? normalizeState(JSON.parse(row.value)) : null;
}

async function loadStateV2Manifest(db) {
  const manifestRow = await db.prepare('SELECT value FROM app_state WHERE key = ?').bind(STATE_V2_MANIFEST_KEY).first();
  if (!manifestRow?.value) return null;
  let manifest = null;
  try {
    manifest = JSON.parse(manifestRow.value);
  } catch {
    return null;
  }
  if (!manifest || manifest.version !== 2 || typeof manifest.updatedAt !== 'string' || !hasSafeManifestParts(manifest.parts)) {
    return null;
  }
  return manifest;
}

async function loadStateV2(db) {
  const manifest = await loadStateV2Manifest(db);
  if (!manifest) return null;

  const state = normalizeState({});
  const parts = manifest.parts || {};
  const items = await loadChunkedArray(db, `${STATE_V2_PREFIX}:items:`, Number(parts.items) || 0);
  const logs = await loadChunkedArray(db, `${STATE_V2_PREFIX}:logs:`, Number(parts.logs) || 0);
  const requests = await loadChunkedArray(db, `${STATE_V2_PREFIX}:requests:`, Number(parts.requests) || 0);
  const vehicles = await loadChunkedArray(db, `${STATE_V2_PREFIX}:vehicles:`, Number(parts.vehicles) || 0);
  const purchases = await loadChunkedArray(db, `${STATE_V2_PREFIX}:purchases:`, Number(parts.purchases) || 0);

  const settingsRow = await db.prepare('SELECT value FROM app_state WHERE key = ?').bind(`${STATE_V2_PREFIX}:settings`).first();
  const aliasesRow = await db.prepare('SELECT value FROM app_state WHERE key = ?').bind(`${STATE_V2_PREFIX}:ocrAliases`).first();

  state.items = items;
  state.logs = logs;
  state.requests = requests;
  state.vehicles = vehicles;
  state.purchases = purchases;
  state.settings = settingsRow?.value ? JSON.parse(settingsRow.value) : {};
  state.ocrAliases = aliasesRow?.value ? JSON.parse(aliasesRow.value) : {};

  return { state, updatedAt: manifest.updatedAt };
}

function streamStateV2Response(db, manifest) {
  const parts = manifest.parts || {};
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      const write = text => controller.enqueue(encoder.encode(text));

      try {
        write('{"state":{"items":');
        await writeChunkedArrayTextStream(write, db, `${STATE_V2_PREFIX}:items:`, Number(parts.items) || 0);
        write(',"logs":');
        await writeChunkedArrayTextStream(write, db, `${STATE_V2_PREFIX}:logs:`, Number(parts.logs) || 0);

        const settingsRow = await db.prepare('SELECT value FROM app_state WHERE key = ?').bind(`${STATE_V2_PREFIX}:settings`).first();
        const settings = settingsRow?.value ? String(settingsRow.value) : '{}';
        write(`,"settings":${settings}`);

        write(',"requests":');
        await writeChunkedArrayTextStream(write, db, `${STATE_V2_PREFIX}:requests:`, Number(parts.requests) || 0);
        write(',"vehicles":');
        await writeChunkedArrayTextStream(write, db, `${STATE_V2_PREFIX}:vehicles:`, Number(parts.vehicles) || 0);
        write(',"purchases":');
        await writeChunkedArrayTextStream(write, db, `${STATE_V2_PREFIX}:purchases:`, Number(parts.purchases) || 0);

        const aliasesRow = await db.prepare('SELECT value FROM app_state WHERE key = ?').bind(`${STATE_V2_PREFIX}:ocrAliases`).first();
        const ocrAliases = aliasesRow?.value ? String(aliasesRow.value) : '{}';
        write(`,"ocrAliases":${ocrAliases}},"updatedAt":${JSON.stringify(manifest.updatedAt)}}`);
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    }
  });
}

async function writeChunkedArrayTextStream(write, db, prefix, count) {
  write('[');
  let hasContent = false;
  for (let i = 0; i < count; i += 1) {
    const row = await db.prepare('SELECT value FROM app_state WHERE key = ?').bind(`${prefix}${i}`).first();
    const value = row?.value ? String(row.value).trim() : '';
    if (!value || value === '[]') continue;
    if (!value.startsWith('[') || !value.endsWith(']')) continue;
    const inner = value.slice(1, -1).trim();
    if (!inner) continue;
    if (hasContent) write(',');
    write(inner);
    hasContent = true;
  }
  write(']');
}

async function loadChunkedArray(db, prefix, count) {
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const key = `${prefix}${i}`;
    const row = await db.prepare('SELECT value FROM app_state WHERE key = ?').bind(key).first();
    if (!row?.value) continue;
    const parsed = JSON.parse(row.value);
    if (Array.isArray(parsed)) out.push(...parsed);
  }
  return out;
}

async function saveStateV2(db, state, updatedAt) {
  const chunks = {
    items: chunkArray(state.items || []),
    logs: chunkArray(state.logs || []),
    requests: chunkArray(state.requests || []),
    vehicles: chunkArray(state.vehicles || []),
    purchases: chunkArray(state.purchases || [])
  };

  if (
    chunks.items.tooLarge ||
    chunks.logs.tooLarge ||
    chunks.requests.tooLarge ||
    chunks.vehicles.tooLarge ||
    chunks.purchases.tooLarge
  ) {
    return { ok: false };
  }

  const previous = await db.prepare('SELECT value FROM app_state WHERE key = ?').bind(STATE_V2_MANIFEST_KEY).first();
  const previousKeys = previous?.value ? collectManifestKeysSafe(previous.value) : [];
  const nextKeys = [];

  const statements = [];

  const upsert = (key, value) => {
    nextKeys.push(key);
    statements.push(
      db
        .prepare(
          `
            INSERT INTO app_state (key, value, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET
              value = excluded.value,
              updated_at = excluded.updated_at
          `
        )
        .bind(key, value, updatedAt)
    );
  };

  upsert(`${STATE_V2_PREFIX}:settings`, JSON.stringify(state.settings || {}));
  upsert(`${STATE_V2_PREFIX}:ocrAliases`, JSON.stringify(state.ocrAliases || {}));

  writeChunkedArray(upsert, `${STATE_V2_PREFIX}:items:`, chunks.items.chunks);
  writeChunkedArray(upsert, `${STATE_V2_PREFIX}:logs:`, chunks.logs.chunks);
  writeChunkedArray(upsert, `${STATE_V2_PREFIX}:requests:`, chunks.requests.chunks);
  writeChunkedArray(upsert, `${STATE_V2_PREFIX}:vehicles:`, chunks.vehicles.chunks);
  writeChunkedArray(upsert, `${STATE_V2_PREFIX}:purchases:`, chunks.purchases.chunks);

  const manifest = {
    version: 2,
    updatedAt,
    parts: {
      items: chunks.items.chunks.length,
      logs: chunks.logs.chunks.length,
      requests: chunks.requests.chunks.length,
      vehicles: chunks.vehicles.chunks.length,
      purchases: chunks.purchases.chunks.length
    }
  };
  nextKeys.push(STATE_V2_MANIFEST_KEY);
  statements.push(
    db
      .prepare(
        `
          INSERT INTO app_state (key, value, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            updated_at = excluded.updated_at
        `
      )
      .bind(STATE_V2_MANIFEST_KEY, JSON.stringify(manifest), updatedAt)
  );

  const nextKeySet = new Set(nextKeys);
  for (const key of previousKeys) {
    if (nextKeySet.has(key)) continue;
    statements.push(db.prepare('DELETE FROM app_state WHERE key = ?').bind(key));
  }

  for (const statement of statements) {
    await statement.run();
  }

  return { ok: true };
}

function writeChunkedArray(upsert, prefix, list) {
  for (let i = 0; i < list.length; i += 1) {
    upsert(`${prefix}${i}`, JSON.stringify(list[i]));
  }
}

function chunkArray(records) {
  const chunks = [];
  let current = [];

  const fits = value => byteLength(JSON.stringify(value)) <= MAX_STATE_ROW_BYTES;

  for (const record of Array.isArray(records) ? records : []) {
    current.push(record);
    if (fits(current)) continue;
    current.pop();
    if (current.length === 0) {
      return { chunks: [], tooLarge: true };
    }
    chunks.push(current);
    current = [record];
    if (!fits(current)) {
      return { chunks: [], tooLarge: true };
    }
  }

  if (current.length > 0) chunks.push(current);
  return { chunks, tooLarge: false };
}

function byteLength(text) {
  const encoder = new TextEncoder();
  return encoder.encode(text).length;
}

function collectManifestKeysSafe(raw) {
  let manifest = null;
  try {
    manifest = JSON.parse(String(raw || ''));
  } catch {
    return [];
  }
  if (!manifest || manifest.version !== 2 || !hasSafeManifestParts(manifest.parts)) return [];
  const parts = manifest.parts || {};
  const keys = [
    `${STATE_V2_PREFIX}:settings`,
    `${STATE_V2_PREFIX}:ocrAliases`
  ];

  const pushChunks = (prefix, count) => {
    const total = Number(count) || 0;
    for (let i = 0; i < total; i += 1) keys.push(`${prefix}${i}`);
  };

  pushChunks(`${STATE_V2_PREFIX}:items:`, parts.items);
  pushChunks(`${STATE_V2_PREFIX}:logs:`, parts.logs);
  pushChunks(`${STATE_V2_PREFIX}:requests:`, parts.requests);
  pushChunks(`${STATE_V2_PREFIX}:vehicles:`, parts.vehicles);
  pushChunks(`${STATE_V2_PREFIX}:purchases:`, parts.purchases);
  keys.push(STATE_V2_MANIFEST_KEY);
  return keys;
}

function hasSafeManifestParts(parts) {
  if (!parts || typeof parts !== 'object') return false;
  return ['items', 'logs', 'requests', 'vehicles', 'purchases'].every(key => {
    const value = Number(parts[key]) || 0;
    return Number.isInteger(value) && value >= 0 && value <= 80;
  });
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
          requires_daily_cycle_inventory INTEGER NOT NULL DEFAULT 0,
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
  try {
    await db.prepare('ALTER TABLE users ADD COLUMN requires_daily_cycle_inventory INTEGER NOT NULL DEFAULT 0').run();
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
    purchases: Array.isArray(body?.purchases) ? body.purchases : [],
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
    purchases: mergePurchasesById(existing.purchases || [], incoming.purchases || []),
    ocrAliases: mergeAliases(existing.ocrAliases, incoming.ocrAliases)
  };
}

function mergeConsultaRequestState(existing, incoming) {
  return {
    ...existing,
    requests: mergeRequestsById(existing.requests, filterConsultaCreatedRequests(existing.requests, incoming.requests))
  };
}

function filterConsultaCreatedRequests(existingRequests, incomingRequests) {
  const existingIds = new Set(existingRequests.map(request => (request?.id ? String(request.id) : '')).filter(Boolean));
  return incomingRequests.filter(request => isConsultaCreatedRequest(request, existingIds));
}

function isConsultaCreatedRequest(request, existingIds) {
  if (!request || !request.id || existingIds.has(String(request.id))) return false;
  if (request.deletedAt || request.reversedAt || request.fulfilledAt) return false;
  if (request.status !== 'Aberta') return false;
  if (!request.vehiclePlate || !request.costCenter) return false;
  if (!Array.isArray(request.items) || request.items.length === 0) return false;

  return request.items.every(item => {
    if (!item || !item.sku) return false;
    const requestedQuantity = Number(item.requestedQuantity);
    const separatedQuantity = Number(item.separatedQuantity) || 0;
    return Number.isFinite(requestedQuantity) && requestedQuantity > 0 && separatedQuantity <= 0;
  });
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

function collectNewDivergenceLogs(existingState, mergedState) {
  const existingIds = new Set(
    (existingState?.logs || []).map(log => (log && log.id ? String(log.id) : '')).filter(Boolean)
  );

  return (mergedState?.logs || []).filter(log => {
    if (!log || !log.id) return false;
    if (log.source !== 'divergencia') return false;
    return !existingIds.has(String(log.id));
  });
}

async function sendDivergenceNotifications(logs, updatedAt, env) {
  const urlList = String(env?.DIVERGENCE_WEBHOOK_URLS || env?.DIVERGENCE_WEBHOOK_URL || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);

  if (urlList.length === 0) return;

  const payload = JSON.stringify({
    event: 'divergence_created',
    updatedAt,
    divergences: logs.slice(0, 20).map(log => ({
      id: log.id,
      sku: log.sku,
      itemName: log.itemName,
      location: log.location,
      delta: log.delta,
      expectedQuantityAfter: log.expectedQuantityAfter,
      reportedQuantityAfter: log.reportedQuantityAfter ?? log.quantityAfter,
      referenceCode: log.referenceCode,
      date: log.date,
      note: log.note
    }))
  });

  await Promise.allSettled(
    urlList.map(url => postWebhook(url, payload, env))
  );
}

async function postWebhook(url, payload, env) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);

  try {
    await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=utf-8',
        ...(env?.DIVERGENCE_WEBHOOK_AUTH ? { authorization: String(env.DIVERGENCE_WEBHOOK_AUTH) } : {}),
        ...(env?.DIVERGENCE_WEBHOOK_SECRET ? { 'x-webhook-secret': String(env.DIVERGENCE_WEBHOOK_SECRET) } : {})
      },
      body: payload,
      signal: controller.signal
    });
  } catch {} finally {
    clearTimeout(timeout);
  }
}
