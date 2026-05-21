import {
  InventoryItem,
  InventoryLog,
  InventorySettings,
  MaterialRequest,
  PurchaseRequest,
  VehicleRecord
} from './types';

export interface CloudInventoryState {
  items: InventoryItem[];
  logs: InventoryLog[];
  settings: InventorySettings;
  requests: MaterialRequest[];
  vehicles: VehicleRecord[];
  purchases?: PurchaseRequest[];
  ocrAliases?: Record<string, string>;
}

export interface CloudStateResult {
  state: CloudInventoryState | null;
  updatedAt: string | null;
  backend?: 'd1' | 'supabase' | string;
}

async function fetchWithRetry(
  input: RequestInfo | URL,
  init: RequestInit,
  options: { retries: number; baseDelayMs: number }
) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    try {
      const response = await fetch(input, init);
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === options.retries) return response;
    } catch (error) {
      lastError = error;
      if (attempt === options.retries) throw error;
    }
    const delay = options.baseDelayMs * (attempt + 1);
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  throw lastError || new Error('FETCH_RETRY_FAILED');
}

export async function loadCloudState() {
  const response = await fetchWithRetry(
    '/api/state',
    {
    cache: 'no-store'
    },
    { retries: 2, baseDelayMs: 450 }
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const cleanDetail = detail.replace(/\s+/g, ' ').trim().slice(0, 160);
    throw new Error(
      cleanDetail
        ? `Estado online indisponivel (HTTP ${response.status}): ${cleanDetail}`
        : `Estado online indisponivel (HTTP ${response.status})`
    );
  }

  return response.json() as Promise<CloudStateResult>;
}

export async function saveCloudState(state: CloudInventoryState, token?: string) {
  const body = JSON.stringify(state);
  const response = await fetchWithRetry(
    '/api/state',
    {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {})
      },
      body
    },
    { retries: 2, baseDelayMs: 450 }
  );

  if (response.status === 401 || response.status === 403) {
    throw new Error('AUTH');
  }
  if (!response.ok) {
    throw new Error(`Nao foi possivel salvar no Cloudflare (HTTP ${response.status})`);
  }

  return response.json() as Promise<{ ok: boolean; updatedAt: string; state?: CloudInventoryState; backend?: 'd1' | 'supabase' | string }>;
}
