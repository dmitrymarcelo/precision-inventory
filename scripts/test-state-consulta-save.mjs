import assert from 'node:assert/strict';
import { onRequestPut } from '../functions/api/state.js';

const existingState = {
  items: [{ sku: '100', name: 'ITEM TESTE', quantity: 10, updatedAt: '2026-05-18T12:00:00.000Z' }],
  logs: [],
  settings: {},
  requests: [],
  vehicles: [],
  purchases: [],
  ocrAliases: {}
};

const newRequest = {
  id: 'REQ-CONSULTA-1',
  code: 'SOL-TESTE',
  status: 'Aberta',
  vehiclePlate: 'ABC1D23',
  costCenter: 'TESTE',
  requester: 'ABC1D23',
  destination: 'TESTE',
  items: [
    {
      id: 'item-1',
      sku: '100',
      itemName: 'ITEM TESTE',
      requestedQuantity: 1,
      separatedQuantity: 0,
      location: 'A1'
    }
  ],
  auditTrail: [
    {
      id: 'audit-1',
      at: '2026-05-19T12:00:00.000Z',
      event: 'request_created',
      detail: '1 item'
    }
  ],
  createdAt: '2026-05-19T12:00:00.000Z',
  updatedAt: '2026-05-19T12:00:00.000Z'
};

const incomingState = {
  ...existingState,
  // A role consulta nunca deve conseguir alterar estoque pelo PUT geral.
  items: [{ ...existingState.items[0], quantity: 0, updatedAt: '2026-05-19T12:00:00.000Z' }],
  requests: [newRequest]
};

const db = createFakeDb(existingState, 'consulta');
const response = await onRequestPut({
  request: new Request('https://example.test/api/state', {
    method: 'PUT',
    headers: {
      authorization: 'Bearer token-consulta',
      'content-type': 'application/json'
    },
    body: JSON.stringify(incomingState)
  }),
  env: { DB: db },
  context: {}
});

if (response.status !== 200) {
  assert.equal(response.status, 200, await response.text());
}
const payload = await response.json();
assert.equal(payload.ok, true);
assert.equal(payload.state.items[0].quantity, 10, 'consulta nao pode alterar estoque');
assert.equal(payload.state.requests.length, 1, 'consulta pode criar solicitacao nova');
assert.equal(payload.state.requests[0].id, newRequest.id);

console.log('consulta scoped state save passed');

function createFakeDb(initialState, sessionRole) {
  let stateRow = {
    value: JSON.stringify(initialState),
    updated_at: '2026-05-18T12:00:00.000Z'
  };

  return {
    prepare(sql) {
      return createStatement(String(sql).replace(/\s+/g, ' ').trim(), []);
    }
  };

  function createStatement(sql, args) {
    return {
      bind(...nextArgs) {
        return createStatement(sql, nextArgs);
      },
      async first() {
        if (sql.includes('SELECT COUNT(1) as count FROM users')) {
          return { count: 1 };
        }
        if (sql.includes('FROM sessions s JOIN users u')) {
          return {
            token: 'token-consulta',
            userId: 'user-consulta',
            matricula: 'consulta',
            name: 'Usuario Consulta',
            role: sessionRole,
            active: 1,
            expiresAt: '2026-06-19T12:00:00.000Z'
          };
        }
        if (sql.includes('SELECT value FROM app_state') || sql.includes('SELECT value, updated_at FROM app_state')) {
          return stateRow;
        }
        return null;
      },
      async run() {
        if (sql.includes('INSERT INTO app_state')) {
          stateRow = {
            value: args[1],
            updated_at: args[2]
          };
          return { meta: { changes: 1 } };
        }
        return { meta: { changes: 0 } };
      }
    };
  }
}
