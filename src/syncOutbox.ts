export type CloudOutboxIdentity = {
  queuedAt?: string;
  localUpdatedAt?: string;
} | null;

export type FlushCompletionMode = 'accept' | 'defer-newer-outbox';

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

