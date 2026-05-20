import type { CloudInventoryState } from './cloudState';

export type OperationJournalPatch = {
  items: unknown[];
  logs: unknown[];
  requests: unknown[];
  vehicles: unknown[];
  purchases: unknown[];
  settings: unknown | null;
  ocrAliases: Record<string, string> | null;
};

export type OperationJournalEntry = {
  id: string;
  deviceId: string;
  operationType: 'state_patch';
  entity: 'inventory_state';
  payload: OperationJournalPatch;
  createdAt: string;
};

const operationJournalQueueKey = 'precisionInventory.operationJournal.queue.v1';
const operationJournalDeviceKey = 'precisionInventory.operationJournal.deviceId.v1';
const maxPayloadChars = 220000;

export function buildOperationJournalPatch(
  previousState: CloudInventoryState | null | undefined,
  nextState: CloudInventoryState
): OperationJournalPatch {
  const previous = previousState || {
    items: [],
    logs: [],
    settings: {},
    requests: [],
    vehicles: [],
    purchases: [],
    ocrAliases: {}
  };

  return {
    items: collectChangedRecords(previous.items || [], nextState.items || [], 'sku'),
    logs: collectChangedRecords(previous.logs || [], nextState.logs || [], 'id'),
    requests: collectChangedRecords(previous.requests || [], nextState.requests || [], 'id'),
    vehicles: collectChangedRecords(previous.vehicles || [], nextState.vehicles || [], 'id'),
    purchases: collectChangedRecords(previous.purchases || [], nextState.purchases || [], 'id'),
    settings: areJsonEqual(previous.settings || {}, nextState.settings || {}) ? null : nextState.settings || {},
    ocrAliases: areJsonEqual(previous.ocrAliases || {}, nextState.ocrAliases || {})
      ? null
      : (nextState.ocrAliases || {})
  };
}

export function hasOperationJournalPatchChanges(patch: OperationJournalPatch) {
  return Boolean(
    patch.items.length ||
      patch.logs.length ||
      patch.requests.length ||
      patch.vehicles.length ||
      patch.purchases.length ||
      patch.settings ||
      patch.ocrAliases
  );
}

export function createOperationJournalEntry({
  previousState,
  nextState,
  createdAt = new Date().toISOString()
}: {
  previousState: CloudInventoryState | null | undefined;
  nextState: CloudInventoryState;
  createdAt?: string;
}): OperationJournalEntry | null {
  const payload = buildOperationJournalPatch(previousState, nextState);
  if (!hasOperationJournalPatchChanges(payload)) return null;
  if (JSON.stringify(payload).length > maxPayloadChars) return null;

  return {
    id: `op-${createdAt}-${createRandomId()}`,
    deviceId: getOperationJournalDeviceId(),
    operationType: 'state_patch',
    entity: 'inventory_state',
    payload,
    createdAt
  };
}

export function getPendingOperationJournalQueue(): OperationJournalEntry[] {
  if (!hasLocalStorage()) return [];
  try {
    const stored = localStorage.getItem(operationJournalQueueKey);
    const parsed = stored ? (JSON.parse(stored) as OperationJournalEntry[]) : [];
    return Array.isArray(parsed) ? parsed.filter(isValidEntry).slice(0, 80) : [];
  } catch {
    return [];
  }
}

export function enqueueOperationJournalEntry(entry: OperationJournalEntry) {
  if (!hasLocalStorage()) return [];
  const current = getPendingOperationJournalQueue();
  const next = [entry, ...current.filter(item => item.id !== entry.id)].slice(0, 80);
  localStorage.setItem(operationJournalQueueKey, JSON.stringify(next));
  return next;
}

export function removeOperationJournalEntries(ids: string[]) {
  if (!hasLocalStorage()) return [];
  const idSet = new Set(ids.map(String));
  const next = getPendingOperationJournalQueue().filter(entry => !idSet.has(entry.id));
  localStorage.setItem(operationJournalQueueKey, JSON.stringify(next));
  return next;
}

export async function flushOperationJournalQueue(token?: string) {
  const queue = getPendingOperationJournalQueue();
  if (!queue.length) return { ok: true, accepted: 0, remaining: 0 };

  const response = await fetch('/api/operation-journal', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify({ entries: queue.slice(0, 25) })
  });

  if (!response.ok) {
    throw new Error(`journal-post-${response.status}`);
  }

  const data = (await response.json()) as { ok?: boolean; accepted?: number; acceptedIds?: string[] };
  if (!data?.ok) {
    throw new Error('journal-post-rejected');
  }

  const acceptedIds = Array.isArray(data.acceptedIds)
    ? data.acceptedIds.map(String)
    : queue.slice(0, Number(data.accepted) || 0).map(entry => entry.id);
  const remaining = removeOperationJournalEntries(acceptedIds).length;
  return { ok: true, accepted: acceptedIds.length, remaining };
}

export async function markOperationJournalApplied(ids: string[], token?: string) {
  const cleanIds = ids.map(String).filter(Boolean);
  if (!cleanIds.length) return { ok: true, updated: 0 };

  const response = await fetch('/api/operation-journal', {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify({ ids: cleanIds, status: 'applied' })
  });

  if (!response.ok) {
    throw new Error(`journal-put-${response.status}`);
  }

  const data = (await response.json()) as { ok?: boolean; updated?: number };
  if (!data?.ok) {
    throw new Error('journal-put-rejected');
  }
  return { ok: true, updated: Number(data.updated) || 0 };
}

export function getOperationJournalDeviceId() {
  if (!hasLocalStorage()) return 'unknown-device';
  const existing = localStorage.getItem(operationJournalDeviceKey);
  if (existing) return existing;
  const next = `device-${createRandomId()}`;
  localStorage.setItem(operationJournalDeviceKey, next);
  return next;
}

function collectChangedRecords(previousRecords: unknown[], nextRecords: unknown[], key: string) {
  const previousByKey = new Map<string, unknown>();
  for (const record of previousRecords) {
    const recordKey = getRecordKey(record, key);
    if (recordKey) previousByKey.set(recordKey, record);
  }

  return nextRecords.filter(record => {
    const recordKey = getRecordKey(record, key);
    if (!recordKey) return false;
    return !areJsonEqual(previousByKey.get(recordKey), record);
  });
}

function getRecordKey(record: unknown, key: string) {
  if (!record || typeof record !== 'object') return '';
  const value = (record as Record<string, unknown>)[key];
  return value === undefined || value === null ? '' : String(value);
}

function areJsonEqual(left: unknown, right: unknown) {
  return stableStringify(left) === stableStringify(right);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function createRandomId() {
  const cryptoApi = typeof crypto !== 'undefined' ? crypto : null;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function hasLocalStorage() {
  return typeof localStorage !== 'undefined';
}

function isValidEntry(entry: OperationJournalEntry) {
  return Boolean(entry?.id && entry?.deviceId && entry?.payload && entry?.createdAt);
}
