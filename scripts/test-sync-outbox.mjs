import assert from 'node:assert/strict';
const moduleUrl = new URL('../src/syncOutbox.ts', import.meta.url).href;
const { getFlushCompletionMode, isSameCloudOutbox, shouldUseJournalReplayForSync } = await import(moduleUrl);

const flushed = {
  queuedAt: '2026-05-20T10:00:00.000Z',
  localUpdatedAt: '2026-05-20T09:59:00.000Z'
};

const sameIdentity = {
  queuedAt: '2026-05-20T10:00:00.000Z',
  localUpdatedAt: '2026-05-20T09:59:00.000Z'
};

const newerOutbox = {
  queuedAt: '2026-05-20T10:00:02.000Z',
  localUpdatedAt: '2026-05-20T10:00:01.000Z'
};

assert.equal(isSameCloudOutbox(flushed, sameIdentity), true, 'mesmo queuedAt/localUpdatedAt e a mesma gravacao');
assert.equal(isSameCloudOutbox(flushed, newerOutbox), false, 'outbox mais novo nao pode ser tratado como o antigo');
assert.equal(getFlushCompletionMode(flushed, sameIdentity), 'accept', 'retorno do cloud pode ser aceito quando o outbox nao mudou');
assert.equal(getFlushCompletionMode(flushed, newerOutbox), 'defer-newer-outbox', 'retorno antigo nao pode limpar alteracao mais nova');
assert.equal(getFlushCompletionMode(flushed, null), 'accept', 'sem outbox atual, retorno pode ser aceito');
assert.equal(
  shouldUseJournalReplayForSync({ serializedStateLength: 2100000, journalIdCount: 1, reason: 'manual_force_sync' }),
  true,
  'estado grande com ponte deve usar replay antes do PUT completo'
);
assert.equal(
  shouldUseJournalReplayForSync({ serializedStateLength: 120000, journalIdCount: 0, reason: 'autosave' }),
  false,
  'estado pequeno sem ponte pode usar PUT completo'
);

console.log('sync outbox race rules passed');
