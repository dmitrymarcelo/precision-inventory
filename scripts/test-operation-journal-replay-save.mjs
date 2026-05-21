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
    body: JSON.stringify({ ids: ['op-replay-1'] })
  }),
  env: { DB: db }
});

if (response.status !== 200) {
  assert.equal(response.status, 200, await response.text());
}

const payload = await response.json();
assert.equal(payload.ok, true);
assert.equal(payload.applied, 1);
assert.ok(db.rows.some(row => row.key === 'inventory_v2_manifest'), 'replay deve salvar estado V2');

console.log('operation journal replay save passed');

function createFakeDb() {
  const db = {
    rows: [
      {
        id: 'op-replay-1',
        payload: JSON.stringify({
          items: [{ sku: '100', name: 'ITEM TESTE', quantity: 4, updatedAt: '2026-05-20T12:00:00.000Z' }],
          logs: [],
          requests: [],
          vehicles: [],
          purchases: [],
          settings: null,
          ocrAliases: null
        }),
        created_at: '2026-05-20T12:00:00.000Z',
        status: 'received'
      }
    ],
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
          return null;
        }
        return null;
      },
      async all() {
        if (sql.includes('FROM operation_journal')) {
          const ids = new Set(args.map(String));
          return {
            results: db.rows.filter(row => row.status === 'received' && ids.has(String(row.id)))
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
          const value = String(args[1]);
          const updatedAt = String(args[2]);
          const existing = db.rows.find(row => row.key === key);
          if (existing) {
            existing.value = value;
            existing.updated_at = updatedAt;
          } else {
            db.rows.push({ key, value, updated_at: updatedAt });
          }
          return { meta: { changes: 1 } };
        }
        if (sql.includes('UPDATE operation_journal')) {
          const appliedAt = args[0];
          const ids = new Set(args.slice(1).map(String));
          let changes = 0;
          for (const row of db.rows) {
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
