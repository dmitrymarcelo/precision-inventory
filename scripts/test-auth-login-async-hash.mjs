import assert from 'node:assert/strict';

import { hashPassword, onRequestPost } from '../functions/api/auth.js';

function normalizeSql(sql) {
  return String(sql || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function createFakeDb() {
  const users = [];
  const sessions = [];

  return {
    users,
    sessions,
    prepare(sql) {
      const query = normalizeSql(sql);
      const values = [];

      return {
        bind(...nextValues) {
          values.splice(0, values.length, ...nextValues);
          return this;
        },
        async run() {
          if (query.startsWith('create table') || query.startsWith('alter table')) {
            return { success: true };
          }

          if (query.includes('insert into sessions')) {
            const [token, userId, role, createdAt, expiresAt] = values;
            sessions.push({ token, userId, role, createdAt, expiresAt });
            return { success: true };
          }

          throw new Error(`Unhandled run SQL: ${query}`);
        },
        async first() {
          if (query.includes('from users') && query.includes('where matricula')) {
            const [matricula] = values;
            return users.find((user) => user.matricula === matricula) || null;
          }

          throw new Error(`Unhandled first SQL: ${query}`);
        }
      };
    }
  };
}

function loginRequest(senha) {
  return new Request('https://local.test/api/auth?action=login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ matricula: '24000', senha })
  });
}

const db = createFakeDb();
const salt = '000102030405060708090a0b0c0d0e0f';
const hashPromise = hashPassword('1234', salt, 2);
assert.equal(typeof hashPromise?.then, 'function', 'hashPassword precisa ser assincrono para nao travar o Worker');
const passwordHash = await hashPromise;

db.users.push({
  id: 'user-1',
  matricula: '24000',
  name: 'Dmitry Marcelo',
  role: 'admin',
  password_hash: passwordHash,
  password_salt: salt,
  password_iters: 2,
  active: 1,
  must_change_password: 0,
  requiresDailyCycleInventory: 0
});

const okResponse = await onRequestPost({ request: loginRequest('1234'), env: { DB: db } });
assert.equal(okResponse.status, 200);
const okBody = await okResponse.json();
assert.equal(okBody.ok, true);
assert.equal(okBody.user.matricula, '24000');
assert.equal(db.sessions.length, 1);

const badResponse = await onRequestPost({ request: loginRequest('senha-errada'), env: { DB: db } });
assert.equal(badResponse.status, 401);
assert.equal(db.sessions.length, 1);

console.log('test-auth-login-async-hash: ok');
