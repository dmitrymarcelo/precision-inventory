import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/api/operation-journal.js';

const db = createFakeDb();

const response = await onRequestPost({
  request: new Request('https://example.test/api/operation-journal?action=replay', {
    method: 'POST',
    headers: {
      authorization: 'Bearer token-admin',
      'content-type': 'application/json'
    },
    body: JSON.stringify({ ids: ['op-direct-1'] })
  }),
  env: { DB: db }
});

if (response.status !== 200) {
  assert.equal(response.status, 200, await response.text());
}

const payload = await response.json();
assert.equal(payload.ok, true);
assert.equal(payload.applied, 1);

const itemChunk = JSON.parse(db.appState.get('inventory_v2:items:0').value);
const logChunk = JSON.parse(db.appState.get('inventory_v2:logs:0').value);
const vehicleChunk = JSON.parse(db.appState.get('inventory_v2:vehicles:0').value);

assert.equal(itemChunk.find(item => item.sku === '100').quantity, 7);
assert.equal(logChunk.length, 1);
assert.equal(vehicleChunk.length, 1, 'colecao nao alterada nao deve ser regravada');
assert.equal(db.readCounts.vehicles, 0, 'replay direto nao deve carregar colecao sem patch');
assert.equal(db.writeCounts.vehicles, 0, 'replay direto nao deve regravar colecao sem patch');

console.log('operation journal direct v2 replay passed');

function createFakeDb() {
  const appState = new Map([
    [
      'inventory_v2_manifest',
      {
        value: JSON.stringify({
          version: 2,
          updatedAt: '2026-05-20T12:00:00.000Z',
          parts: { items: 1, logs: 0, requests: 0, vehicles: 1, purchases: 0 }
        }),
        updated_at: '2026-05-20T12:00:00.000Z'
      }
    ],
    [
      'inventory_v2:items:0',
      {
        value: JSON.stringify([{ sku: '100', quantity: 4, updatedAt: '2026-05-20T12:00:00.000Z' }]),
        updated_at: '2026-05-20T12:00:00.000Z'
      }
    ],
    [
      'inventory_v2:vehicles:0',
      {
        value: JSON.stringify([{ id: 'vehicle-1', plate: 'ABC1D23' }]),
        updated_at: '2026-05-20T12:00:00.000Z'
      }
    ],
    ['inventory_v2:settings', { value: '{}', updated_at: '2026-05-20T12:00:00.000Z' }],
    ['inventory_v2:ocrAliases', { value: '{}', updated_at: '2026-05-20T12:00:00.000Z' }]
  ]);

  const journalRows = [
    {
      id: 'op-direct-1',
      payload: JSON.stringify({
        items: [{ sku: '100', quantity: 7, updatedAt: '2026-05-20T12:10:00.000Z' }],
        logs: [{ id: 'log-1', sku: '100', date: '2026-05-20T12:10:00.000Z' }],
        requests: [],
        vehicles: [],
        purchases: [],
        settings: null,
        ocrAliases: null
      }),
      created_at: '2026-05-20T12:10:00.000Z',
      status: 'received'
    }
  ];

  const readCounts = { vehicles: 0 };
  const writeCounts = { vehicles: 0 };

  const db = {
    appState,
    readCounts,
    writeCounts,
    prepare(sql) {
      return createStatement(String(sql).replace(/\s+/g, ' ').trim(), []);
    }
  };
  return db;

  function createStatement(sql, args) {
    return {
      bind(...nextArgs) {
        return createStatement(sql, nextArgs);
      },
      async first() {
        if (sql.includes('FROM sessions s JOIN users u')) {
          return {
            token: 'token-admin',
            userId: 'user-admin',
            matricula: '24000',
            name: 'Dmitry Marcelo',
            role: 'admin',
            active: 1,
            expiresAt: new Date(Date.now() + 86400000).toISOString(),
            requiresDailyCycleInventory: 0
          };
        }
        if (sql.includes('FROM app_state')) {
          const key = String(args[0]);
          if (key.startsWith('inventory_v2:vehicles:')) readCounts.vehicles += 1;
          return appState.get(key) || null;
        }
        return null;
      },
      async all() {
        if (sql.includes('FROM operation_journal')) {
          const ids = new Set(args.map(String));
          return {
            results: journalRows.filter(row => row.status === 'received' && ids.has(String(row.id)))
          };
        }
        return { results: [] };
      },
      async run() {
        if (sql.includes('CREATE TABLE') || sql.includes('CREATE INDEX')) {
          return { meta: { changes: 0 } };
        }
        if (sql.includes('INSERT INTO app_state')) {
          const key = String(args[0]);
          if (key.startsWith('inventory_v2:vehicles:')) writeCounts.vehicles += 1;
          appState.set(key, { value: String(args[1]), updated_at: String(args[2]) });
          return { meta: { changes: 1 } };
        }
        if (sql.includes('DELETE FROM app_state')) {
          appState.delete(String(args[0]));
          return { meta: { changes: 1 } };
        }
        if (sql.includes('UPDATE operation_journal')) {
          const appliedAt = args[0];
          const ids = new Set(args.slice(1).map(String));
          let changes = 0;
          for (const row of journalRows) {
            if (ids.has(String(row.id))) {
              row.status = 'applied';
              row.applied_at = appliedAt;
              changes += 1;
            }
          }
          return { meta: { changes } };
        }
        if (sql.includes('DELETE FROM operation_journal')) {
          return { meta: { changes: 0 } };
        }
        return { meta: { changes: 0 } };
      }
    };
  }
}
