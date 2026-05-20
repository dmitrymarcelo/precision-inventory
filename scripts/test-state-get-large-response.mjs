import assert from 'node:assert/strict';
import { onRequestGet } from '../functions/api/state.js';

const db = createFakeDb();
const response = await onRequestGet({ env: { DB: db } });

if (response.status !== 200) {
  assert.equal(response.status, 200, await response.text());
}

const text = await response.text();
const payload = JSON.parse(text);

assert.equal(payload.updatedAt, '2026-05-20T12:00:00.000Z');
assert.deepEqual(payload.state.items.map(item => item.sku), ['100', '200', '300']);
assert.deepEqual(payload.state.logs.map(log => log.id), ['log-1']);
assert.equal(payload.state.settings.alertDefaults.criticalLimit, 1);
assert.equal(payload.state.ocrAliases.ABC, '100');

console.log('state large response serialization passed');

const fallbackResponse = await onRequestGet({ env: { DB: createFakeDbWithUnsafeManifest() } });
if (fallbackResponse.status !== 200) {
  assert.equal(fallbackResponse.status, 200, await fallbackResponse.text());
}
const fallbackPayload = await fallbackResponse.json();
assert.equal(fallbackPayload.updatedAt, '2026-05-20T11:00:00.000Z');
assert.equal(fallbackPayload.state.items[0].sku, 'V1');

console.log('state unsafe v2 manifest fallback passed');

function createFakeDb() {
  const rows = new Map([
    [
      'inventory_v2_manifest',
      JSON.stringify({
        version: 2,
        updatedAt: '2026-05-20T12:00:00.000Z',
        parts: { items: 2, logs: 1, requests: 0, vehicles: 0, purchases: 0 }
      })
    ],
    ['inventory_v2:items:0', JSON.stringify([{ sku: '100' }, { sku: '200' }])],
    ['inventory_v2:items:1', JSON.stringify([{ sku: '300' }])],
    ['inventory_v2:logs:0', JSON.stringify([{ id: 'log-1' }])],
    ['inventory_v2:settings', JSON.stringify({ alertDefaults: { criticalLimit: 1 } })],
    ['inventory_v2:ocrAliases', JSON.stringify({ ABC: '100' })]
  ]);

  return {
    prepare(sql) {
      return {
        bind(key) {
          return {
            async first() {
              return rows.has(String(key)) ? { value: rows.get(String(key)) } : null;
            }
          };
        }
      };
    }
  };
}

function createFakeDbWithUnsafeManifest() {
  const v1State = JSON.stringify({
    items: [{ sku: 'V1' }],
    logs: [],
    settings: {},
    requests: [],
    vehicles: [],
    purchases: [],
    ocrAliases: {}
  });
  const rows = new Map([
    [
      'inventory_v2_manifest',
      JSON.stringify({
        version: 2,
        updatedAt: '2026-05-20T12:00:00.000Z',
        parts: { items: 1000, logs: 0, requests: 0, vehicles: 0, purchases: 0 }
      })
    ],
    ['inventory', v1State]
  ]);

  return {
    prepare(sql) {
      return {
        bind(key) {
          return {
            async first() {
              const text = String(sql);
              if (text.includes('inventory_v2:items:')) {
                throw new Error('unsafe v2 chunk lookup should not happen');
              }
              if (String(key) === 'inventory') {
                return { value: rows.get('inventory'), updated_at: '2026-05-20T11:00:00.000Z' };
              }
              return rows.has(String(key)) ? { value: rows.get(String(key)) } : null;
            }
          };
        }
      };
    }
  };
}
