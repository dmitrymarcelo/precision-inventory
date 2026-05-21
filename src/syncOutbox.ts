export type CloudOutboxIdentity = {
  queuedAt?: string;
  localUpdatedAt?: string;
} | null;

export type FlushCompletionMode = 'accept' | 'defer-newer-outbox';

const largeStateReplayThreshold = 1500000;

export function isSameCloudOutbox(left: CloudOutboxIdentity, right: CloudOutboxIdentity) {
  if (!left || !right) return false;
  return String(left.queuedAt || '') === String(right.queuedAt || '')
    && String(left.localUpdatedAt || '') === String(right.localUpdatedAt || '');
}

export function getFlushCompletionMode(
  flushedOutbox: CloudOutboxIdentity,
  currentOutbox: CloudOutboxIdentity
): FlushCompletionMode {
  if (!currentOutbox) return 'accept';
  return isSameCloudOutbox(flushedOutbox, currentOutbox) ? 'accept' : 'defer-newer-outbox';
}

export function shouldUseJournalReplayForSync({
  serializedStateLength,
  journalIdCount,
  reason
}: {
  serializedStateLength: number;
  journalIdCount: number;
  reason?: string;
}) {
  return (
    journalIdCount > 0 ||
    serializedStateLength > largeStateReplayThreshold
  );
}
