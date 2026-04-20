import {
  InventoryItem,
  InventoryLog,
  InventorySettings,
  MaterialRequest,
  VehicleRecord
} from './types';

export interface CloudInventoryState {
  items: InventoryItem[];
  logs: InventoryLog[];
  settings: InventorySettings;
  requests: MaterialRequest[];
  vehicles: VehicleRecord[];
  ocrAliases?: Record<string, string>;
}

export async function loadCloudState() {
  const response = await fetch('/api/state', {
    cache: 'no-store'
  });

  if (!response.ok) {
    throw new Error('Estado online indisponível');
  }

  return response.json() as Promise<{ state: CloudInventoryState | null; updatedAt: string | null }>;
}

export async function saveCloudState(state: CloudInventoryState) {
  const response = await fetch('/api/state', {
    method: 'PUT',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(state)
  });

  if (!response.ok) {
    throw new Error('Não foi possível salvar no Cloudflare');
  }

  return response.json() as Promise<{ ok: boolean; updatedAt: string }>;
}
