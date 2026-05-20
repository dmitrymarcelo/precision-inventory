import assert from 'node:assert/strict';
const moduleUrl = new URL('../src/operationJournal.ts', import.meta.url).href;
const { buildOperationJournalPatch } = await import(moduleUrl);

const previous = {
  items: [
    { sku: '100', name: 'ITEM A', quantity: 10, updatedAt: '2026-05-20T10:00:00.000Z' },
    { sku: '200', name: 'ITEM B', quantity: 5, updatedAt: '2026-05-20T10:00:00.000Z' }
  ],
  logs: [],
  settings: { alertDefaults: { criticalLimit: 1 } },
  requests: [],
  vehicles: [],
  purchases: [],
  ocrAliases: {}
};

const next = {
  ...previous,
  items: [
    { sku: '100', name: 'ITEM A', quantity: 8, updatedAt: '2026-05-20T10:10:00.000Z' },
    previous.items[1]
  ],
  logs: [
    {
      id: 'log-1',
      sku: '100',
      itemName: 'ITEM A',
      delta: -2,
      quantityAfter: 8,
      location: 'A1',
      source: 'ajuste',
      date: '2026-05-20T10:10:00.000Z'
    }
  ],
  requests: [
    {
      id: 'REQ-1',
      code: 'SOL-1',
      status: 'Aberta',
      vehiclePlate: 'ABC1D23',
      costCenter: 'CC',
      items: [],
      auditTrail: [],
      createdAt: '2026-05-20T10:10:00.000Z',
      updatedAt: '2026-05-20T10:10:00.000Z'
    }
  ]
};

const patch = buildOperationJournalPatch(previous, next);

assert.equal(patch.items.length, 1);
assert.equal(patch.items[0].sku, '100');
assert.equal(patch.logs.length, 1);
assert.equal(patch.requests.length, 1);
assert.equal(patch.vehicles.length, 0);
assert.equal(patch.purchases.length, 0);
assert.equal(patch.settings, null);
assert.ok(JSON.stringify(patch).length < JSON.stringify(next).length, 'patch deve ser menor que snapshot completo');

console.log('operation journal patch rules passed');
