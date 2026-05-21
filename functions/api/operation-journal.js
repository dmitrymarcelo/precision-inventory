import { getSessionFromRequest } from './auth.js';
import {
  getSupabaseAdmin,
  isSupabaseConfigured,
  isSupabaseUsable,
  loadStateV2FromSupabase,
  migrateD1ToSupabaseIfNeeded,
  saveStateV2ToSupabase
} from './supabase.js';

const RETENTION_DAYS = 7;
const MAX_PAYLOAD_CHARS = 220000;
const STATE_KEY = 'inventory';
const STATE_V2_MANIFEST_KEY = 'inventory_v2_manifest';
const STATE_V2_PREFIX = 'inventory_v2';
const MAX_STATE_ROW_BYTES = 1900000;

const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store'
};

export async function onRequestPost({ request, env }) {
  const supabaseEnabled = isSupabaseConfigured(env) && (await isSupabaseUsable(env));
  if (!supabaseEnabled) {
    await ensureSchema(env.DB);
  }
  const url = new URL(request.url);
  const action = (url.searchParams.get('action') || '').toLowerCase();

  const session = await getSessionFromRequest(request, supabaseEnabled ? env : env.DB);
  if (!session) {
    return Response.json({ ok: false, message: 'Sessao invalida.' }, { status: 401, headers: jsonHeaders });
  }

  if (action === 'replay') {
    const role = String(session.role || '');
    if (role !== 'admin' && role !== 'operacao') {
      return Response.json({ ok: false, message: 'Sem permissao.' }, { status: 403, headers: jsonHeaders });
    }
    return supabaseEnabled ? replayEntriesSupabase({ request, env }) : replayEntries({ request, env });
  }

  const body = await safeJson(request);
  const entries = Array.isArray(body?.entries) ? body.entries : body?.entry ? [body.entry] : [];
  if (entries.length === 0) {
    return Response.json({ ok: false, message: 'Nenhuma operacao enviada.' }, { status: 400, headers: jsonHeaders });
  }

  const receivedAt = new Date().toISOString();
  let accepted = 0;
  const acceptedIds = [];

  if (supabaseEnabled) {
    try {
      const sb = getSupabaseAdmin(env);
      await migrateD1ToSupabaseIfNeeded(env, sb);
      const rows = [];
      for (const rawEntry of entries.slice(0, 25)) {
        const entry = sanitizeEntry(rawEntry, session, receivedAt);
        if (!entry) continue;
        rows.push({
          id: entry.id,
          device_id: entry.deviceId,
          actor_matricula: entry.actorMatricula || null,
          actor_name: entry.actorName || null,
          actor_role: entry.actorRole || null,
          operation_type: entry.operationType,
          entity: entry.entity,
          payload: entry.payload,
          status: 'received',
          created_at: entry.createdAt,
          received_at: receivedAt,
          applied_at: null
        });
        accepted += 1;
        acceptedIds.push(entry.id);
      }
      if (rows.length > 0) {
        const { error } = await sb.from('operation_journal').upsert(rows, { onConflict: 'id' });
        if (error) throw error;
      }
      const cleanupDeleted = await cleanupOldJournalRowsSupabase(sb, receivedAt);
      return Response.json({ ok: true, accepted, acceptedIds, cleanupDeleted }, { headers: jsonHeaders });
    } catch {
      // fallback to D1 below
      await ensureSchema(env.DB);
      accepted = 0;
      acceptedIds.length = 0;
    }
  }

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
  const supabaseEnabled = isSupabaseConfigured(env) && (await isSupabaseUsable(env));
  if (!supabaseEnabled) {
    await ensureSchema(env.DB);
  }
  const session = await getSessionFromRequest(request, supabaseEnabled ? env : env.DB);
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
  if (supabaseEnabled) {
    try {
      const sb = getSupabaseAdmin(env);
      await migrateD1ToSupabaseIfNeeded(env, sb);
      const { error } = await sb.from('operation_journal').update({ status, applied_at: appliedAt }).in('id', ids);
      if (error) throw error;
      const cleanupDeleted = await cleanupOldJournalRowsSupabase(sb, appliedAt);
      return Response.json({ ok: true, updated: ids.length, cleanupDeleted }, { headers: jsonHeaders });
    } catch {
      // fallback to D1 below
      await ensureSchema(env.DB);
    }
  }

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

  const patches = [];

  for (const row of list) {
    let patch = null;
    try {
      patch = JSON.parse(String(row.payload || ''));
    } catch {
      patch = null;
    }
    if (!patch || typeof patch !== 'object') continue;
    patches.push(patch);
  }

  const updatedAt = new Date().toISOString();
  const directV2 = await applyPatchesToStateV2(env.DB, patches, updatedAt);
  if (!directV2.ok) {
    const existingV2 = await loadStateV2(env.DB);
    const existingRow = existingV2
      ? null
      : await env.DB.prepare('SELECT value, updated_at FROM app_state WHERE key = ?').bind(STATE_KEY).first();
    let state = existingV2?.state
      ? normalizeState(existingV2.state)
      : existingRow?.value
        ? normalizeState(JSON.parse(existingRow.value))
        : normalizeState({});

    for (const patch of patches) {
      state = applyPatchToState(state, patch);
    }

    const saved = await saveStateV2(env.DB, state, updatedAt);
    if (!saved.ok) {
      return Response.json(
        { ok: false, message: 'Estado grande demais para aplicar agora. Aplique em lotes menores.' },
        { status: 413, headers: jsonHeaders }
      );
    }
  }

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

async function replayEntriesSupabase({ request, env }) {
  const sb = getSupabaseAdmin(env);
  const body = await safeJson(request);
  const ids = Array.isArray(body?.ids) ? body.ids.map(value => String(value || '').trim()).filter(Boolean).slice(0, 25) : [];
  if (ids.length === 0) {
    return Response.json({ ok: false, message: 'Informe IDs para reprocessar.' }, { status: 400, headers: jsonHeaders });
  }

  const { data: rows, error } = await sb
    .from('operation_journal')
    .select('id, payload, created_at')
    .in('id', ids)
    .eq('status', 'received')
    .eq('entity', 'inventory_state')
    .eq('operation_type', 'state_patch');

  if (error) {
    return Response.json({ ok: false, message: 'Servidor com instabilidade agora. Aguarde e tente novamente.' }, { status: 500, headers: jsonHeaders });
  }

  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) {
    return Response.json({ ok: true, applied: 0 }, { headers: jsonHeaders });
  }

  list.sort((a, b) => parseUpdatedAt(a?.created_at) - parseUpdatedAt(b?.created_at));

  const existingV2 = await loadStateV2FromSupabase(sb);
  const existingV1 = existingV2?.state ? null : await loadStateV1Supabase(sb);
  let state = resolveSupabaseReplayBaseState(existingV2, existingV1);

  for (const row of list) {
    const patch = safeJsonParse(row?.payload);
    if (!patch || typeof patch !== 'object') continue;
    state = applyPatchToState(state, patch);
  }

  const updatedAt = new Date().toISOString();
  const saved = await saveStateV2ToSupabase(sb, state, updatedAt);
  if (!saved.ok) {
    return Response.json(
      { ok: false, message: 'Estado grande demais para aplicar agora. Aplique em lotes menores.' },
      { status: 413, headers: jsonHeaders }
    );
  }

  const appliedAt = updatedAt;
  await sb.from('operation_journal').update({ status: 'applied', applied_at: appliedAt }).in('id', ids);
  const cleanupDeleted = await cleanupOldJournalRowsSupabase(sb, appliedAt);
  return Response.json({ ok: true, updatedAt, applied: list.length, cleanupDeleted }, { headers: jsonHeaders });
}

export function resolveSupabaseReplayBaseState(existingV2, existingV1) {
  if (existingV2?.state) return normalizeState(existingV2.state);
  if (existingV1) return normalizeState(existingV1);
  return normalizeState({});
}

async function loadStateV1Supabase(sb) {
  const { data, error } = await sb.from('app_state').select('value').eq('key', STATE_KEY).maybeSingle();
  if (error || !data?.value) return null;
  const parsed = safeJsonParse(data.value);
  return parsed && typeof parsed === 'object' ? parsed : null;
}

function safeJsonParse(raw) {
  try {
    return JSON.parse(String(raw ?? ''));
  } catch {
    return null;
  }
}

async function cleanupOldJournalRowsSupabase(sb, nowIso) {
  const cutoff = new Date(new Date(nowIso).getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await sb.from('operation_journal').delete().lt('created_at', cutoff);
  if (error) return 0;
  return 0;
}

async function applyPatchesToStateV2(db, patches, updatedAt) {
  const manifestRow = await db.prepare('SELECT value FROM app_state WHERE key = ?').bind(STATE_V2_MANIFEST_KEY).first();
  if (!manifestRow?.value) return { ok: false };

  let manifest = null;
  try {
    manifest = JSON.parse(manifestRow.value);
  } catch {
    return { ok: false };
  }
  if (!manifest || manifest.version !== 2 || typeof manifest.updatedAt !== 'string' || !hasSafeManifestParts(manifest.parts)) {
    return { ok: false };
  }

  const incoming = normalizePatchList(patches);
  const nextParts = { ...(manifest.parts || {}) };

  const updateArrayPart = async (field, prefix, mergeFn) => {
    if (!incoming[field].length) return true;
    const current = await loadChunkedArray(db, prefix, Number(nextParts[field]) || 0);
    const chunks = chunkArray(mergeFn(current, incoming[field]));
    if (chunks.tooLarge) return false;
    await saveChunkedArrayPart(db, prefix, chunks.chunks, Number(nextParts[field]) || 0, updatedAt);
    nextParts[field] = chunks.chunks.length;
    return true;
  };

  if (!(await updateArrayPart('items', `${STATE_V2_PREFIX}:items:`, mergeItemsBySku))) return { ok: false };
  if (!(await updateArrayPart('logs', `${STATE_V2_PREFIX}:logs:`, mergeLogsById))) return { ok: false };
  if (!(await updateArrayPart('requests', `${STATE_V2_PREFIX}:requests:`, mergeRequestsById))) return { ok: false };
  if (!(await updateArrayPart('vehicles', `${STATE_V2_PREFIX}:vehicles:`, mergeVehiclesById))) return { ok: false };
  if (!(await updateArrayPart('purchases', `${STATE_V2_PREFIX}:purchases:`, mergePurchasesById))) return { ok: false };

  if (incoming.settings) {
    const settingsRow = await db.prepare('SELECT value FROM app_state WHERE key = ?').bind(`${STATE_V2_PREFIX}:settings`).first();
    const currentSettings = settingsRow?.value ? JSON.parse(settingsRow.value) : {};
    await upsertStateRow(db, `${STATE_V2_PREFIX}:settings`, JSON.stringify(mergeSettings(currentSettings, incoming.settings)), updatedAt);
  }

  if (incoming.ocrAliases) {
    const aliasesRow = await db.prepare('SELECT value FROM app_state WHERE key = ?').bind(`${STATE_V2_PREFIX}:ocrAliases`).first();
    const currentAliases = aliasesRow?.value ? JSON.parse(aliasesRow.value) : {};
    await upsertStateRow(db, `${STATE_V2_PREFIX}:ocrAliases`, JSON.stringify(mergeAliases(currentAliases, incoming.ocrAliases)), updatedAt);
  }

  await upsertStateRow(
    db,
    STATE_V2_MANIFEST_KEY,
    JSON.stringify({ version: 2, updatedAt, parts: nextParts }),
    updatedAt
  );
  return { ok: true };
}

function normalizePatchList(patches) {
  const out = {
    items: [],
    logs: [],
    requests: [],
    vehicles: [],
    purchases: [],
    settings: null,
    ocrAliases: null
  };

  for (const patch of Array.isArray(patches) ? patches : []) {
    if (!patch || typeof patch !== 'object') continue;
    if (Array.isArray(patch.items)) out.items.push(...patch.items);
    if (Array.isArray(patch.logs)) out.logs.push(...patch.logs);
    if (Array.isArray(patch.requests)) out.requests.push(...patch.requests);
    if (Array.isArray(patch.vehicles)) out.vehicles.push(...patch.vehicles);
    if (Array.isArray(patch.purchases)) out.purchases.push(...patch.purchases);
    if (patch.settings && typeof patch.settings === 'object') {
      out.settings = mergeSettings(out.settings || {}, patch.settings);
    }
    if (patch.ocrAliases && typeof patch.ocrAliases === 'object') {
      out.ocrAliases = mergeAliases(out.ocrAliases || {}, patch.ocrAliases);
    }
  }

  return out;
}

async function saveChunkedArrayPart(db, prefix, chunks, previousCount, updatedAt) {
  for (let i = 0; i < chunks.length; i += 1) {
    await upsertStateRow(db, `${prefix}${i}`, JSON.stringify(chunks[i]), updatedAt);
  }
  for (let i = chunks.length; i < previousCount; i += 1) {
    await db.prepare('DELETE FROM app_state WHERE key = ?').bind(`${prefix}${i}`).run();
  }
}

async function upsertStateRow(db, key, value, updatedAt) {
  await db
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
    .run();
}

async function loadStateV2(db) {
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
  const keys = [`${STATE_V2_PREFIX}:settings`, `${STATE_V2_PREFIX}:ocrAliases`];

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
