import assert from 'node:assert/strict';
import { onRequestPut } from '../functions/api/users.js';

const consultaDb = createFakeUsersDb({ existingRole: 'operacao' });
const consultaResponse = await onRequestPut({
  request: new Request('https://example.test/api/users', {
    method: 'PUT',
    headers: {
      authorization: 'Bearer token-admin',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      id: 'user-1',
      nome: 'Usuario Teste',
      role: 'consulta',
      active: true,
      requiresDailyCycleInventory: true
    })
  }),
  env: { DB: consultaDb }
});

assert.equal(consultaResponse.status, 200, await consultaResponse.text());
assert.equal(consultaDb.lastRequiresDailyCycleInventory, 0, 'consulta nao pode ficar com inventario ciclico obrigatorio');

const operacaoDb = createFakeUsersDb({ existingRole: 'operacao' });
const operacaoResponse = await onRequestPut({
  request: new Request('https://example.test/api/users', {
    method: 'PUT',
    headers: {
      authorization: 'Bearer token-admin',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      id: 'user-2',
      nome: 'Operador Teste',
      role: 'operacao',
      active: true,
      requiresDailyCycleInventory: true
    })
  }),
  env: { DB: operacaoDb }
});

assert.equal(operacaoResponse.status, 200, await operacaoResponse.text());
assert.equal(operacaoDb.lastRequiresDailyCycleInventory, 1, 'operacao pode ficar com inventario ciclico obrigatorio');

console.log('user daily cycle requirement rules passed');

function createFakeUsersDb({ existingRole }) {
  const db = {
    lastRequiresDailyCycleInventory: undefined,
    prepare(sql) {
      return createStatement(db, String(sql).replace(/\s+/g, ' ').trim(), []);
    }
  };
  return db;

  function createStatement(targetDb, sql, args) {
    return {
      bind(...nextArgs) {
        return createStatement(targetDb, sql, nextArgs);
      },
      async first() {
        if (sql.includes('FROM sessions s JOIN users u')) {
          return {
            token: 'token-admin',
            userId: 'admin-1',
            matricula: '24000',
            name: 'Dmitry Marcelo',
            role: 'admin',
            active: 1,
            expiresAt: '2026-06-20T12:00:00.000Z',
            requiresDailyCycleInventory: 0
          };
        }
        if (sql.includes('FROM users WHERE id = ? LIMIT 1')) {
          return {
            id: args[0],
            matricula: '001',
            role: existingRole,
            active: 1,
            requiresDailyCycleInventory: 0
          };
        }
        return null;
      },
      async run() {
        if (sql.includes('UPDATE users SET')) {
          targetDb.lastRequiresDailyCycleInventory = args[3];
        }
        return { meta: { changes: 1 } };
      },
      async all() {
        return { results: [] };
      }
    };
  }
}
