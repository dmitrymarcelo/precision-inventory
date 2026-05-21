import assert from 'node:assert/strict';
import { resolveSupabaseReplayBaseState } from '../functions/api/operation-journal.js';

const v1State = {
  items: [{ sku: '100', quantity: 7 }],
  logs: [{ id: 'log-v1' }],
  settings: { source: 'v1' },
  requests: [{ id: 'req-v1' }],
  vehicles: [{ id: 'vehicle-v1' }],
  purchases: [],
  ocrAliases: { A: '100' }
};

const v2State = {
  items: [{ sku: '200', quantity: 3 }],
  logs: [{ id: 'log-v2' }],
  settings: { source: 'v2' },
  requests: [],
  vehicles: [],
  purchases: [],
  ocrAliases: {}
};

assert.deepEqual(
  resolveSupabaseReplayBaseState(null, v1State),
  {
    items: v1State.items,
    logs: v1State.logs,
    settings: v1State.settings,
    requests: v1State.requests,
    vehicles: v1State.vehicles,
    purchases: v1State.purchases,
    ocrAliases: v1State.ocrAliases
  },
  'replay Supabase deve partir do estado V1 migrado quando ainda nao existe State V2'
);

assert.deepEqual(
  resolveSupabaseReplayBaseState({ state: v2State }, v1State),
  {
    items: v2State.items,
    logs: v2State.logs,
    settings: v2State.settings,
    requests: v2State.requests,
    vehicles: v2State.vehicles,
    purchases: v2State.purchases,
    ocrAliases: v2State.ocrAliases
  },
  'quando State V2 ja existe, ele continua sendo a base preferida do replay'
);

console.log('operation journal supabase replay base passed');
