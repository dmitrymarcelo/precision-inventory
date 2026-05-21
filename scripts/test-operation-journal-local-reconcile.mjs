import assert from 'node:assert/strict';

const moduleUrl = new URL('../src/operationJournal.ts', import.meta.url).href;
const { getAlreadyAppliedOperationJournalEntryIds } = await import(moduleUrl);

const onlineItem = {
  sku: '15641',
  name: 'ADITIVO RADIADOR ROSA GASOLINA ALCOOL FLEX',
  quantity: 6,
  location: 'G3',
  updatedAt: '2026-05-20T23:53:00.000Z'
};
const onlineRequest = {
  id: 'req-sol-0357',
  code: 'SOL-0357',
  status: 'Atendida',
  updatedAt: '2026-05-20T23:53:00.000Z',
  items: [{ sku: '15641', requestedQuantity: 1, separatedQuantity: 1 }]
};

const onlineState = {
  items: [onlineItem],
  logs: [{ id: 'log-1', sku: '15641', quantity: -1 }],
  settings: { alertDefaults: { criticalLimit: 1, reorderLimit: 2 }, theme: 'operacional' },
  requests: [onlineRequest],
  vehicles: [{ id: 'vehicle-1', plate: 'PHO0A62' }],
  purchases: [{ id: 'purchase-1', sku: '15641', quantity: 2 }],
  ocrAliases: { ABC123: '15641', XYZ999: '17902' }
};

const makePayload = overrides => ({
  items: [],
  logs: [],
  requests: [],
  vehicles: [],
  purchases: [],
  settings: null,
  ocrAliases: null,
  ...overrides
});

const entries = [
  {
    id: 'op-item-and-request-already-online',
    deviceId: 'device-1',
    operationType: 'state_patch',
    entity: 'inventory_state',
    createdAt: '2026-05-20T23:53:00.000Z',
    payload: makePayload({ items: [onlineItem], requests: [onlineRequest] })
  },
  {
    id: 'op-settings-partial-already-online',
    deviceId: 'device-1',
    operationType: 'state_patch',
    entity: 'inventory_state',
    createdAt: '2026-05-20T23:54:00.000Z',
    payload: makePayload({
      settings: { alertDefaults: { criticalLimit: 1 } },
      ocrAliases: { ABC123: '15641' }
    })
  },
  {
    id: 'op-item-not-yet-online',
    deviceId: 'device-1',
    operationType: 'state_patch',
    entity: 'inventory_state',
    createdAt: '2026-05-20T23:55:00.000Z',
    payload: makePayload({ items: [{ ...onlineItem, quantity: 5 }] })
  },
  {
    id: 'op-request-missing-online',
    deviceId: 'device-1',
    operationType: 'state_patch',
    entity: 'inventory_state',
    createdAt: '2026-05-20T23:56:00.000Z',
    payload: makePayload({ requests: [{ ...onlineRequest, id: 'req-new' }] })
  }
];

assert.deepEqual(
  getAlreadyAppliedOperationJournalEntryIds(entries, onlineState).sort(),
  ['op-item-and-request-already-online', 'op-settings-partial-already-online'].sort(),
  'deve limpar apenas operacoes locais que ja aparecem no estado online'
);

assert.deepEqual(
  getAlreadyAppliedOperationJournalEntryIds(entries, null),
  [],
  'sem estado online confirmado, nada pode ser descartado'
);

console.log('operation journal local reconcile passed');
