import assert from 'node:assert/strict';
import {
  loadStateV2ResponseStreamFromSupabase,
  migrateD1ToSupabaseIfNeeded
} from '../functions/api/supabase.js';

const updatedAt = '2026-05-20T20:55:13.025Z';

const d1 = createFakeD1({
  app_state: [
    {
      key: 'inventory_v2_manifest',
      value: JSON.stringify({
        version: 2,
        updatedAt,
        parts: { items: 1, logs: 1, requests: 1, vehicles: 0, purchases: 0 }
      }),
      updated_at: updatedAt
    },
    { key: 'inventory_v2:items:0', value: JSON.stringify([{ sku: '100', quantity: 7 }]), updated_at: updatedAt },
    { key: 'inventory_v2:logs:0', value: JSON.stringify([{ id: 'log-1', sku: '100' }]), updated_at: updatedAt },
    { key: 'inventory_v2:requests:0', value: JSON.stringify([{ id: 'req-1', code: 'SOL-1' }]), updated_at: updatedAt },
    { key: 'inventory_v2:settings', value: JSON.stringify({ alertDefaults: { criticalLimit: 1 } }), updated_at: updatedAt },
    { key: 'inventory_v2:ocrAliases', value: JSON.stringify({ ABC: '100' }), updated_at: updatedAt }
  ],
  users: [
    {
      id: 'user-1',
      matricula: '24000',
      name: 'Dmitry Marcelo',
      role: 'admin',
      password_hash: 'hash',
      password_salt: 'salt',
      password_iters: 50000,
      must_change_password: 0,
      requires_daily_cycle_inventory: 0,
      active: 1,
      created_at: updatedAt,
      updated_at: updatedAt
    }
  ],
  sessions: [{ token: 'session-1', user_id: 'user-1', role: 'admin', created_at: updatedAt, expires_at: '2026-06-20T00:00:00.000Z' }],
  operation_journal: [
    {
      id: 'journal-1',
      device_id: 'device-1',
      actor_matricula: '24000',
      actor_name: 'Dmitry Marcelo',
      actor_role: 'admin',
      operation_type: 'state_patch',
      entity: 'inventory_state',
      payload: '{}',
      status: 'received',
      created_at: updatedAt,
      received_at: updatedAt,
      applied_at: null
    }
  ],
  request_locks: []
});

const supabase = createFakeSupabase();
const migrated = await migrateD1ToSupabaseIfNeeded({ DB: d1 }, supabase);
assert.deepEqual({ ok: migrated.ok, migrated: migrated.migrated }, { ok: true, migrated: true });

assert.equal(supabase.table('users').size, 1);
assert.equal(supabase.table('sessions').size, 1);
assert.equal(supabase.table('operation_journal').size, 1);

const marker = supabase.table('app_state').get('__migrated_from_d1_v1');
assert.equal(JSON.parse(marker.value).ok, true);
assert.equal(JSON.parse(marker.value).appStateRows, 6);

const stream = await loadStateV2ResponseStreamFromSupabase(supabase);
assert.ok(stream);
const payload = JSON.parse(await new Response(stream).text());
assert.equal(payload.backend, 'supabase');
assert.equal(payload.updatedAt, updatedAt);
assert.deepEqual(payload.state.items.map(item => item.sku), ['100']);
assert.deepEqual(payload.state.logs.map(log => log.id), ['log-1']);
assert.deepEqual(payload.state.requests.map(request => request.id), ['req-1']);
assert.equal(payload.state.settings.alertDefaults.criticalLimit, 1);
assert.equal(payload.state.ocrAliases.ABC, '100');

const secondRun = await migrateD1ToSupabaseIfNeeded({ DB: d1 }, supabase);
assert.deepEqual({ ok: secondRun.ok, migrated: secondRun.migrated }, { ok: true, migrated: false });

const failingSupabase = createFakeSupabase();
const failingMigration = await migrateD1ToSupabaseIfNeeded({ DB: createFailingD1() }, failingSupabase);
assert.equal(failingMigration.ok, false);
assert.equal(failingSupabase.table('app_state').has('__migrated_from_d1_v1'), false);

console.log('supabase migration and stream rules passed');

function createFakeD1(tables) {
  return {
    prepare(sql) {
      return {
        bind() {
          return this;
        },
        async all() {
          return { results: rowsForSql(sql, tables) };
        },
        async first() {
          const rows = rowsForSql(sql, tables);
          if (/count\(1\)/i.test(sql)) return { count: rows.length };
          return rows[0] || null;
        }
      };
    }
  };
}

function createFailingD1() {
  return {
    prepare() {
      return {
        bind() {
          return this;
        },
        async all() {
          throw new Error('D1 quota exhausted');
        },
        async first() {
          throw new Error('D1 quota exhausted');
        }
      };
    }
  };
}

function rowsForSql(sql, tables) {
  const text = String(sql).toLowerCase();
  if (text.includes('from app_state')) return tables.app_state || [];
  if (text.includes('from users')) return tables.users || [];
  if (text.includes('from sessions')) return tables.sessions || [];
  if (text.includes('from operation_journal')) return tables.operation_journal || [];
  if (text.includes('from request_locks')) return tables.request_locks || [];
  return [];
}

function createFakeSupabase() {
  const tables = new Map([
    ['app_state', new Map()],
    ['users', new Map()],
    ['sessions', new Map()],
    ['operation_journal', new Map()],
    ['request_locks', new Map()]
  ]);

  return {
    table(name) {
      return tables.get(name);
    },
    from(name) {
      return createQuery(tables, name);
    }
  };
}

function createQuery(tables, tableName) {
  const filters = [];
  let inFilter = null;
  let selected = '*';

  const table = () => tables.get(tableName) || new Map();
  const primaryKey = () => {
    if (tableName === 'app_state') return 'key';
    if (tableName === 'sessions') return 'token';
    if (tableName === 'request_locks') return 'request_id';
    return 'id';
  };
  const applyFilters = rows => rows.filter(row => filters.every(filter => String(row[filter.key]) === String(filter.value)));
  const selectColumns = row => {
    if (!row || selected === '*') return row;
    const out = {};
    for (const column of selected.split(',').map(part => part.trim()).filter(Boolean)) {
      out[column] = row[column];
    }
    return out;
  };

  return {
    select(columns) {
      selected = columns || '*';
      return this;
    },
    eq(key, value) {
      filters.push({ key, value });
      return this;
    },
    in(key, values) {
      inFilter = { key, values: new Set((values || []).map(value => String(value))) };
      return this;
    },
    async maybeSingle() {
      const rows = applyFilters([...table().values()]);
      return { data: rows[0] ? selectColumns(rows[0]) : null, error: null };
    },
    async upsert(rows) {
      for (const row of Array.isArray(rows) ? rows : [rows]) {
        table().set(String(row[primaryKey()]), { ...(table().get(String(row[primaryKey()])) || {}), ...row });
      }
      return { data: null, error: null };
    },
    then(resolve) {
      let rows = applyFilters([...table().values()]);
      if (inFilter) rows = rows.filter(row => inFilter.values.has(String(row[inFilter.key])));
      resolve({ data: rows.map(selectColumns), error: null });
    }
  };
}
