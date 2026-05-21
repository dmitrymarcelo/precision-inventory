import assert from 'node:assert/strict';
import { onRequestGet, onRequestPut } from '../functions/api/users.js';

const ownerGet = await onRequestGet({
  request: new Request('https://example.test/api/users', {
    headers: { authorization: 'Bearer token-owner' }
  }),
  env: { DB: createFakeUsersDb({ sessionMatricula: '24000', sessionRole: 'admin' }) }
});

assert.equal(ownerGet.status, 200, await ownerGet.text());

const otherAdminGet = await onRequestGet({
  request: new Request('https://example.test/api/users', {
    headers: { authorization: 'Bearer token-other-admin' }
  }),
  env: { DB: createFakeUsersDb({ sessionMatricula: '12345', sessionRole: 'admin' }) }
});

assert.equal(otherAdminGet.status, 403, 'admin diferente da matricula 24000 nao pode listar usuarios');

const otherAdminPut = await onRequestPut({
  request: new Request('https://example.test/api/users', {
    method: 'PUT',
    headers: {
      authorization: 'Bearer token-other-admin',
      'content-type': 'application/json'
    },
    body: JSON.stringify({ id: 'user-1', nome: 'Bloqueado', role: 'operacao', active: true })
  }),
  env: { DB: createFakeUsersDb({ sessionMatricula: '12345', sessionRole: 'admin' }) }
});

assert.equal(otherAdminPut.status, 403, 'admin diferente da matricula 24000 nao pode editar usuarios');

console.log('primary admin user management access passed');

function createFakeUsersDb({ sessionMatricula, sessionRole }) {
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
        if (sql.includes('FROM sessions s JOIN users u')) {
          return {
            token: args[0] || 'token',
            userId: `user-${sessionMatricula}`,
            matricula: sessionMatricula,
            name: sessionMatricula === '24000' ? 'Dmitry Marcelo' : 'Outro Admin',
            role: sessionRole,
            active: 1,
            expiresAt: '2026-06-20T12:00:00.000Z',
            requiresDailyCycleInventory: 0
          };
        }
        if (sql.includes('FROM users WHERE id = ? LIMIT 1')) {
          return {
            id: args[0],
            matricula: '001',
            role: 'operacao',
            active: 1,
            requiresDailyCycleInventory: 0
          };
        }
        if (sql.includes("COUNT(1) as count FROM users WHERE role = 'admin'")) {
          return { count: 2 };
        }
        return null;
      },
      async all() {
        if (sql.includes('FROM users ORDER BY matricula')) {
          return {
            results: [
              {
                id: 'user-24000',
                matricula: '24000',
                name: 'Dmitry Marcelo',
                role: 'admin',
                active: 1,
                requiresDailyCycleInventory: 0,
                createdAt: '2026-05-20T00:00:00.000Z',
                updatedAt: '2026-05-20T00:00:00.000Z'
              }
            ]
          };
        }
        return { results: [] };
      },
      async run() {
        return { meta: { changes: 1 } };
      }
    };
  }
}

