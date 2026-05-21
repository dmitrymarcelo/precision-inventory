import assert from 'node:assert/strict';

const moduleUrl = new URL('../src/operationJournal.ts', import.meta.url).href;
const {
  enqueueOperationJournalEntry,
  flushOperationJournalQueue,
  postOperationJournalEntries,
  removeOperationJournalEntries
} = await import(moduleUrl);

const storage = new Map();
globalThis.localStorage = {
  getItem(key) {
    return storage.has(key) ? storage.get(key) : null;
  },
  setItem(key, value) {
    storage.set(key, String(value));
  },
  removeItem(key) {
    storage.delete(key);
  }
};

globalThis.fetch = async () => new Response(JSON.stringify({ ok: false }), { status: 401 });

const entry = {
  id: 'op-auth-1',
  deviceId: 'device-1',
  operationType: 'state_patch',
  entity: 'inventory_state',
  createdAt: '2026-05-20T23:59:00.000Z',
  payload: {
    items: [{ sku: '100', quantity: 1 }],
    logs: [],
    requests: [],
    vehicles: [],
    purchases: [],
    settings: null,
    ocrAliases: null
  }
};

enqueueOperationJournalEntry(entry);

await assert.rejects(
  () => flushOperationJournalQueue('expired-token'),
  /AUTH/,
  'flush da ponte deve traduzir 401 em erro de sessao expirada'
);

removeOperationJournalEntries([entry.id]);

await assert.rejects(
  () => postOperationJournalEntries([entry], 'expired-token'),
  /AUTH/,
  'post direto da ponte tambem deve traduzir 401 em erro de sessao expirada'
);

console.log('operation journal auth error mapping passed');
