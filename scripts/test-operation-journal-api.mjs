import assert from 'node:assert/strict';
import { onRequestPost, onRequestPut } from '../functions/api/operation-journal.js';

const recentAt = new Date().toISOString();
const oldAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
const db = createFakeDb();

const postResponse = await onRequestPost({
  request: new Request('https://example.test/api/operation-journal', {
    method: 'POST',
    headers: {
      authorization: 'Bearer token-admin',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      entries: [
        {
          id: 'op-old',
          deviceId: 'device-1',
          operationType: 'state_patch',
          entity: 'inventory_state',
          payload: { requests: [{ id: 'REQ-OLD' }] },
          createdAt: oldAt
        },
        {
          id: 'op-new',
          deviceId: 'device-1',
          operationType: 'state_patch',
          entity: 'inventory_state',
          payload: { requests: [{ id: 'REQ-NEW' }] },
          createdAt: recentAt
        }
      ]
    })
  }),
  env: { DB: db }
});

if (postResponse.status !== 200) {
  assert.equal(postResponse.status, 200, await postResponse.text());
}
const postPayload = await postResponse.json();
assert.equal(postPayload.ok, true);
assert.equal(postPayload.accepted, 2);
assert.deepEqual(postPayload.acceptedIds, ['op-old', 'op-new']);
assert.equal(db.rows.length, 1, 'registros com mais de 7 dias devem ser removidos');
assert.equal(db.rows[0].id, 'op-new');
assert.equal(db.rows[0].status, 'received');

const putResponse = await onRequestPut({
  request: new Request('https://example.test/api/operation-journal', {
    method: 'PUT',
    headers: {
      authorization: 'Bearer token-admin',
      'content-type': 'application/json'
    },
    body: JSON.stringify({ ids: ['op-new'], status: 'applied' })
  }),
  env: { DB: db }
});

if (putResponse.status !== 200) {
  assert.equal(putResponse.status, 200, await putResponse.text());
}
const putPayload = await putResponse.json();
assert.equal(putPayload.ok, true);
assert.equal(db.rows[0].status, 'applied');
assert.ok(db.rows[0].applied_at, 'operacao aplicada deve receber applied_at');

console.log('operation journal api retention passed');

function createFakeDb() {
  const db = {
    rows: [],
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
        return null;
      },
      async run() {
        if (sql.includes('INTO operation_journal')) {
          const id = String(args[0]);
          if (!db.rows.some(row => row.id === id)) {
            db.rows.push({
              id,
              device_id: args[1],
              actor_matricula: args[2],
              actor_name: args[3],
              actor_role: args[4],
              operation_type: args[5],
              entity: args[6],
              payload: args[7],
              status: args[8],
              created_at: args[9],
              received_at: args[10],
              applied_at: null
            });
          }
          return { meta: { changes: 1 } };
        }
        if (sql.includes('UPDATE operation_journal SET status')) {
          const status = String(args[0]);
          const appliedAt = args[1];
          const ids = new Set(args.slice(2).map(String));
          let changes = 0;
          for (const row of db.rows) {
            if (ids.has(String(row.id))) {
              row.status = status;
              row.applied_at = appliedAt;
              changes += 1;
            }
          }
          return { meta: { changes } };
        }
        if (sql.includes('DELETE FROM operation_journal')) {
          const cutoff = String(args[0]);
          const before = db.rows.length;
          db.rows = db.rows.filter(row => String(row.created_at) >= cutoff);
          return { meta: { changes: before - db.rows.length } };
        }
        return { meta: { changes: 0 } };
      }
    };
  }
}
