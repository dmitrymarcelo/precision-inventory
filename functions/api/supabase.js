import { createClient } from '@supabase/supabase-js';

let cached = null;
let usableCache = { url: '', at: 0, ok: false };
const migrationMarkerKey = '__migrated_from_d1_v1';
const STATE_V2_MANIFEST_KEY = 'inventory_v2_manifest';
const STATE_V2_PREFIX = 'inventory_v2';
const MAX_STATE_ROW_BYTES = 1900000;

export function isSupabaseConfigured(env) {
  const url = typeof env?.SUPABASE_URL === 'string' ? env.SUPABASE_URL.trim() : '';
  const keyRaw = env?.SUPABASE_SERVICE_ROLE_KEY || env?.SUPABASE_SERVICE_ROLE;
  const key = typeof keyRaw === 'string' ? keyRaw.trim() : '';
  const urlOk = /^https?:\/\//i.test(url);
  return Boolean(urlOk && key);
}

export function getSupabaseAdmin(env) {
  if (!isSupabaseConfigured(env)) {
    throw new Error('SUPABASE_NOT_CONFIGURED');
  }
  const url = String(env.SUPABASE_URL || '').trim();
  if (cached && cached.url === url) return cached.client;
  const serviceKey = String(env?.SUPABASE_SERVICE_ROLE_KEY || env?.SUPABASE_SERVICE_ROLE || '').trim();
  const client = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-application-name': 'precision-inventory' } }
  });
  cached = { url, client };
  return client;
}

export async function isSupabaseUsable(env) {
  if (!isSupabaseConfigured(env)) return false;
  const url = String(env?.SUPABASE_URL || '').trim();
  const now = Date.now();
  if (usableCache.url === url && now - usableCache.at < 30_000) {
    return usableCache.ok;
  }
  try {
    const sb = getSupabaseAdmin(env);
    const { error } = await sb.from('app_state').select('key').limit(1);
    if (error) throw error;
    usableCache = { url, at: now, ok: true };
    return true;
  } catch {
    usableCache = { url, at: now, ok: false };
    return false;
  }
}

export function splitIntoBatches(list, size) {
  const out = [];
  const safe = Array.isArray(list) ? list : [];
  const chunkSize = Math.max(1, Number(size) || 1);
  for (let i = 0; i < safe.length; i += chunkSize) {
    out.push(safe.slice(i, i + chunkSize));
  }
  return out;
}

async function d1All(db, sql, ...binds) {
  if (!db) return { ok: false, rows: [], error: new Error('D1 binding ausente') };
  try {
    const stmt = db.prepare(sql);
    const result = binds.length ? await stmt.bind(...binds).all() : await stmt.all();
    return { ok: true, rows: Array.isArray(result?.results) ? result.results : [] };
  } catch (error) {
    return { ok: false, rows: [], error };
  }
}

async function d1First(db, sql, ...binds) {
  if (!db) return { ok: false, row: null, error: new Error('D1 binding ausente') };
  try {
    const stmt = db.prepare(sql);
    const result = binds.length ? await stmt.bind(...binds).first() : await stmt.first();
    return { ok: true, row: result || null };
  } catch (error) {
    return { ok: false, row: null, error };
  }
}

function isMissingD1Table(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('no such table') || message.includes('no such column');
}

function isMigrationMarkerComplete(marker) {
  if (!marker?.value) return false;
  if (String(marker.value) === '1') return true;
  const parsed = safeJsonParse(marker.value, null);
  return parsed?.ok === true;
}

export async function getSupabaseAppStateValue(sb, key) {
  const { data, error } = await sb.from('app_state').select('value, updated_at').eq('key', key).maybeSingle();
  if (error || !data) return null;
  return { value: data.value, updatedAt: data.updated_at };
}

export async function setSupabaseAppStateValue(sb, key, value, updatedAt) {
  const row = { key, value, updated_at: updatedAt };
  const { error } = await sb.from('app_state').upsert([row], { onConflict: 'key' });
  if (error) throw error;
}

export async function migrateD1ToSupabaseIfNeeded(env, sb) {
  if (!env?.DB) return { ok: true, migrated: false };

  try {
    const marker = await getSupabaseAppStateValue(sb, migrationMarkerKey);
    if (isMigrationMarkerComplete(marker)) return { ok: true, migrated: false };

    const existingSupabaseState =
      (await getSupabaseAppStateValue(sb, STATE_V2_MANIFEST_KEY)) || (await getSupabaseAppStateValue(sb, 'inventory'));
    if (existingSupabaseState?.value) {
      await setSupabaseAppStateValue(
        sb,
        migrationMarkerKey,
        JSON.stringify({ ok: true, skipped: 'supabase_already_has_state', at: new Date().toISOString() }),
        new Date().toISOString()
      );
      return { ok: true, migrated: false };
    }
  } catch {
    return { ok: false, migrated: false };
  }

  const now = new Date().toISOString();
  const upsertBatch = async (table, rows, onConflict) => {
    for (const batch of splitIntoBatches(rows, 200)) {
      const { error } = await sb.from(table).upsert(batch, onConflict ? { onConflict } : undefined);
      if (error) throw error;
    }
  };

  const appStateResult = await d1All(env.DB, 'SELECT key, value, updated_at FROM app_state');
  if (!appStateResult.ok && !isMissingD1Table(appStateResult.error)) {
    return { ok: false, migrated: false, error: 'app_state_read_failed' };
  }
  const appStateRows = appStateResult.rows;
  if (appStateRows.length > 0) {
    const mapped = appStateRows.map(row => ({
      key: String(row.key),
      value: String(row.value),
      updated_at: String(row.updated_at)
    }));
    await upsertBatch('app_state', mapped, 'key');
  }

  const usersResult = await d1All(
    env.DB,
    `SELECT id, matricula, name, role, password_hash, password_salt, password_iters,
            must_change_password, requires_daily_cycle_inventory, active, created_at, updated_at
     FROM users`
  );
  if (!usersResult.ok && !isMissingD1Table(usersResult.error)) {
    return { ok: false, migrated: false, error: 'users_read_failed' };
  }
  const usersRows = usersResult.rows;
  if (usersRows.length > 0) {
    const mapped = usersRows.map(row => ({
      id: String(row.id),
      matricula: String(row.matricula),
      name: String(row.name),
      role: String(row.role),
      password_hash: String(row.password_hash),
      password_salt: String(row.password_salt),
      password_iters: Number(row.password_iters) || 50000,
      must_change_password: Number(row.must_change_password) || 0,
      requires_daily_cycle_inventory: Number(row.requires_daily_cycle_inventory) || 0,
      active: Number(row.active) || 0,
      created_at: String(row.created_at),
      updated_at: String(row.updated_at)
    }));
    await upsertBatch('users', mapped, 'id');
  }

  const sessionsResult = await d1All(env.DB, 'SELECT token, user_id, role, created_at, expires_at FROM sessions');
  if (!sessionsResult.ok && !isMissingD1Table(sessionsResult.error)) {
    return { ok: false, migrated: false, error: 'sessions_read_failed' };
  }
  const sessionsRows = sessionsResult.rows;
  if (sessionsRows.length > 0) {
    const mapped = sessionsRows.map(row => ({
      token: String(row.token),
      user_id: String(row.user_id),
      role: String(row.role),
      created_at: String(row.created_at),
      expires_at: String(row.expires_at)
    }));
    await upsertBatch('sessions', mapped, 'token');
  }

  const journalResult = await d1All(
    env.DB,
    `SELECT id, device_id, actor_matricula, actor_name, actor_role, operation_type, entity,
            payload, status, created_at, received_at, applied_at
     FROM operation_journal`
  );
  if (!journalResult.ok && !isMissingD1Table(journalResult.error)) {
    return { ok: false, migrated: false, error: 'operation_journal_read_failed' };
  }
  const journalRows = journalResult.rows;
  if (journalRows.length > 0) {
    const mapped = journalRows.map(row => ({
      id: String(row.id),
      device_id: String(row.device_id),
      actor_matricula: row.actor_matricula === null ? null : String(row.actor_matricula),
      actor_name: row.actor_name === null ? null : String(row.actor_name),
      actor_role: row.actor_role === null ? null : String(row.actor_role),
      operation_type: String(row.operation_type),
      entity: String(row.entity),
      payload: String(row.payload),
      status: String(row.status),
      created_at: String(row.created_at),
      received_at: String(row.received_at),
      applied_at: row.applied_at === null ? null : String(row.applied_at)
    }));
    await upsertBatch('operation_journal', mapped, 'id');
  }

  const lockResult = await d1All(
    env.DB,
    `SELECT request_id, holder_user_id, holder_matricula, holder_name, holder_role,
            acquired_at, heartbeat_at, expires_at
     FROM request_locks`
  );
  const lockRows = lockResult.ok ? lockResult.rows : [];
  if (lockRows.length > 0) {
    const mapped = lockRows.map(row => ({
      request_id: String(row.request_id),
      holder_user_id: String(row.holder_user_id),
      holder_matricula: String(row.holder_matricula),
      holder_name: String(row.holder_name),
      holder_role: String(row.holder_role),
      acquired_at: String(row.acquired_at),
      heartbeat_at: String(row.heartbeat_at),
      expires_at: String(row.expires_at)
    }));
    await upsertBatch('request_locks', mapped, 'request_id');
  }

  await setSupabaseAppStateValue(
    sb,
    migrationMarkerKey,
    JSON.stringify({
      ok: true,
      at: now,
      appStateRows: appStateRows.length,
      usersRows: usersRows.length,
      sessionsRows: sessionsRows.length,
      journalRows: journalRows.length,
      lockRows: lockRows.length,
      lockReadSkipped: !lockResult.ok
    }),
    now
  );
  return { ok: true, migrated: true };
}

function byteLength(text) {
  const encoder = new TextEncoder();
  return encoder.encode(text).length;
}

function safeJsonParse(raw, fallback) {
  try {
    return JSON.parse(String(raw ?? ''));
  } catch {
    return fallback;
  }
}

function hasSafeManifestParts(parts) {
  if (!parts || typeof parts !== 'object') return false;
  const keys = ['items', 'logs', 'requests', 'vehicles', 'purchases'];
  return keys.every(key => {
    const value = parts[key];
    return value === 0 || (Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 100000);
  });
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

function collectManifestKeysSafe(raw) {
  const manifest = safeJsonParse(raw, null);
  if (!manifest || manifest.version !== 2 || !manifest.parts) return [];
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

async function loadStateV2ManifestSupabase(sb) {
  const { data, error } = await sb.from('app_state').select('value').eq('key', STATE_V2_MANIFEST_KEY).maybeSingle();
  if (error || !data?.value) return null;
  const manifest = safeJsonParse(data.value, null);
  if (!manifest || manifest.version !== 2 || typeof manifest.updatedAt !== 'string' || !hasSafeManifestParts(manifest.parts)) {
    return null;
  }
  return manifest;
}

async function loadChunkedArraySupabase(sb, prefix, count) {
  const total = Number(count) || 0;
  if (total <= 0) return [];
  const keys = [];
  for (let i = 0; i < total; i += 1) keys.push(`${prefix}${i}`);

  const byKey = new Map();
  for (const batch of splitIntoBatches(keys, 200)) {
    const { data, error } = await sb.from('app_state').select('key,value').in('key', batch);
    if (error) continue;
    for (const row of Array.isArray(data) ? data : []) {
      byKey.set(String(row.key), String(row.value || ''));
    }
  }

  const out = [];
  for (const key of keys) {
    const raw = byKey.get(key);
    if (!raw) continue;
    const parsed = safeJsonParse(raw, null);
    if (Array.isArray(parsed)) out.push(...parsed);
  }
  return out;
}

async function getSupabaseRawStateValue(sb, key) {
  const { data, error } = await sb.from('app_state').select('value').eq('key', key).maybeSingle();
  if (error || !data?.value) return '';
  return String(data.value);
}

async function writeChunkedArrayTextStreamSupabase(write, sb, prefix, count) {
  const total = Number(count) || 0;
  write('[');
  if (total <= 0) {
    write(']');
    return;
  }

  const keys = [];
  for (let i = 0; i < total; i += 1) keys.push(`${prefix}${i}`);

  const byKey = new Map();
  for (const batch of splitIntoBatches(keys, 200)) {
    const { data, error } = await sb.from('app_state').select('key,value').in('key', batch);
    if (error) throw error;
    for (const row of Array.isArray(data) ? data : []) {
      byKey.set(String(row.key), String(row.value || ''));
    }
  }

  let hasContent = false;
  for (const key of keys) {
    const value = String(byKey.get(key) || '').trim();
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

function streamStateV2ResponseFromSupabase(sb, manifest) {
  const parts = manifest.parts || {};
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      const write = text => controller.enqueue(encoder.encode(text));

      try {
        write('{"state":{"items":');
        await writeChunkedArrayTextStreamSupabase(write, sb, `${STATE_V2_PREFIX}:items:`, parts.items);
        write(',"logs":');
        await writeChunkedArrayTextStreamSupabase(write, sb, `${STATE_V2_PREFIX}:logs:`, parts.logs);

        const settingsRaw = await getSupabaseRawStateValue(sb, `${STATE_V2_PREFIX}:settings`);
        const settings = safeJsonParse(settingsRaw, null) ? settingsRaw : '{}';
        write(`,"settings":${settings}`);

        write(',"requests":');
        await writeChunkedArrayTextStreamSupabase(write, sb, `${STATE_V2_PREFIX}:requests:`, parts.requests);
        write(',"vehicles":');
        await writeChunkedArrayTextStreamSupabase(write, sb, `${STATE_V2_PREFIX}:vehicles:`, parts.vehicles);
        write(',"purchases":');
        await writeChunkedArrayTextStreamSupabase(write, sb, `${STATE_V2_PREFIX}:purchases:`, parts.purchases);

        const aliasesRaw = await getSupabaseRawStateValue(sb, `${STATE_V2_PREFIX}:ocrAliases`);
        const ocrAliases = safeJsonParse(aliasesRaw, null) ? aliasesRaw : '{}';
        write(`,"ocrAliases":${ocrAliases}},"updatedAt":${JSON.stringify(manifest.updatedAt)},"backend":"supabase"}`);
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    }
  });
}

export async function loadStateV2ResponseStreamFromSupabase(sb) {
  const manifest = await loadStateV2ManifestSupabase(sb);
  if (!manifest) return null;
  return streamStateV2ResponseFromSupabase(sb, manifest);
}

export async function loadStateV2FromSupabase(sb) {
  const manifest = await loadStateV2ManifestSupabase(sb);
  if (!manifest) return null;
  try {
    const parts = manifest.parts || {};
    const items = await loadChunkedArraySupabase(sb, `${STATE_V2_PREFIX}:items:`, parts.items);
    const logs = await loadChunkedArraySupabase(sb, `${STATE_V2_PREFIX}:logs:`, parts.logs);
    const requests = await loadChunkedArraySupabase(sb, `${STATE_V2_PREFIX}:requests:`, parts.requests);
    const vehicles = await loadChunkedArraySupabase(sb, `${STATE_V2_PREFIX}:vehicles:`, parts.vehicles);
    const purchases = await loadChunkedArraySupabase(sb, `${STATE_V2_PREFIX}:purchases:`, parts.purchases);

    const { data: settingsRow } = await sb.from('app_state').select('value').eq('key', `${STATE_V2_PREFIX}:settings`).maybeSingle();
    const { data: aliasesRow } = await sb.from('app_state').select('value').eq('key', `${STATE_V2_PREFIX}:ocrAliases`).maybeSingle();

    const state = {
      items,
      logs,
      settings: settingsRow?.value ? safeJsonParse(settingsRow.value, {}) : {},
      requests,
      vehicles,
      purchases,
      ocrAliases: aliasesRow?.value ? safeJsonParse(aliasesRow.value, {}) : {}
    };

    return { state, updatedAt: manifest.updatedAt };
  } catch {
    return null;
  }
}

export async function saveStateV2ToSupabase(sb, state, updatedAt) {
  const chunks = {
    items: chunkArray(state.items || []),
    logs: chunkArray(state.logs || []),
    requests: chunkArray(state.requests || []),
    vehicles: chunkArray(state.vehicles || []),
    purchases: chunkArray(state.purchases || [])
  };

  if (chunks.items.tooLarge || chunks.logs.tooLarge || chunks.requests.tooLarge || chunks.vehicles.tooLarge || chunks.purchases.tooLarge) {
    return { ok: false };
  }

  const { data: previous } = await sb.from('app_state').select('value').eq('key', STATE_V2_MANIFEST_KEY).maybeSingle();
  const previousKeys = previous?.value ? collectManifestKeysSafe(previous.value) : [];

  const rows = [];
  const nextKeys = [];
  const pushRow = (key, value) => {
    nextKeys.push(key);
    rows.push({ key, value, updated_at: updatedAt });
  };

  pushRow(`${STATE_V2_PREFIX}:settings`, JSON.stringify(state.settings || {}));
  pushRow(`${STATE_V2_PREFIX}:ocrAliases`, JSON.stringify(state.ocrAliases || {}));

  const writeChunks = (prefix, list) => {
    for (let i = 0; i < list.length; i += 1) {
      pushRow(`${prefix}${i}`, JSON.stringify(list[i]));
    }
  };

  writeChunks(`${STATE_V2_PREFIX}:items:`, chunks.items.chunks);
  writeChunks(`${STATE_V2_PREFIX}:logs:`, chunks.logs.chunks);
  writeChunks(`${STATE_V2_PREFIX}:requests:`, chunks.requests.chunks);
  writeChunks(`${STATE_V2_PREFIX}:vehicles:`, chunks.vehicles.chunks);
  writeChunks(`${STATE_V2_PREFIX}:purchases:`, chunks.purchases.chunks);

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
  pushRow(STATE_V2_MANIFEST_KEY, JSON.stringify(manifest));

  for (const batch of splitIntoBatches(rows, 200)) {
    const { error } = await sb.from('app_state').upsert(batch, { onConflict: 'key' });
    if (error) return { ok: false };
  }

  const nextKeySet = new Set(nextKeys);
  const stale = previousKeys.filter(key => !nextKeySet.has(key));
  for (const batch of splitIntoBatches(stale, 200)) {
    const { error } = await sb.from('app_state').delete().in('key', batch);
    if (error) return { ok: false };
  }

  return { ok: true };
}
