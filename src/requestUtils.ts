import {
  InventoryItem,
  InventorySettings,
  MaterialRequest,
  MaterialRequestItem,
  MaterialRequestStatus
} from './types';
import { classifyInventoryCategory } from './categoryCatalog';
import { normalizeLocationText, normalizeUserFacingText } from './textUtils';

export function createEmptyRequest(): MaterialRequest {
  const now = new Date().toISOString();
  return {
    id: '',
    code: '',
    vehiclePlate: '',
    costCenter: '',
    vehicleDescription: '',
    vehicleDetails: {},
    requester: '',
    sector: '',
    destination: '',
    notes: '',
    priority: 'Normal',
    status: 'Aberta',
    createdAt: now,
    updatedAt: now,
    items: []
  };
}

export function createRequestItem(item: InventoryItem): MaterialRequestItem {
  const { category } = classifyInventoryCategory(item.name, item.sourceCategory || item.category);

  return {
    id: `${item.sku}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sku: item.sku,
    itemName: normalizeUserFacingText(item.name),
    location: normalizeLocationText(item.location),
    category,
    requestedQuantity: 1,
    separatedQuantity: 0
  };
}

export function createRequestCode(existingRequests: MaterialRequest[]) {
  const highestCode = existingRequests.reduce((highest, request) => {
    const match = request.code.match(/SOL-(\d+)/i);
    const current = match ? Number(match[1]) : 0;
    return Math.max(highest, current);
  }, 0);

  return `SOL-${String(highestCode + 1).padStart(4, '0')}`;
}

export function recalculateRequestStatus(request: MaterialRequest): MaterialRequestStatus {
  if (!request.items.length) return 'Aberta';

  const totalRequested = request.items.reduce((sum, item) => sum + normalizeQuantity(item.requestedQuantity), 0);
  const totalSeparated = request.items.reduce((sum, item) => sum + normalizeQuantity(item.separatedQuantity), 0);

  if (request.fulfilledAt) return 'Atendida';
  if (totalRequested > 0 && totalSeparated >= totalRequested) return 'Separada';
  if (totalSeparated > 0) return 'Em separação';
  return 'Aberta';
}

export function upsertRequestState(
  draft: MaterialRequest,
  existingRequests: MaterialRequest[]
): MaterialRequest {
  const now = new Date().toISOString();
  const code = draft.code || createRequestCode(existingRequests);
  const createdAt = draft.createdAt || now;
  const items = draft.items
    .map(item => ({
      ...item,
      requestedQuantity: normalizeQuantity(item.requestedQuantity),
      separatedQuantity: Math.min(
        normalizeQuantity(item.requestedQuantity),
        normalizeQuantity(item.separatedQuantity)
      )
    }))
    .filter(item => item.sku && item.itemName && item.requestedQuantity > 0);

  const baseRequest: MaterialRequest = {
    ...draft,
    id: draft.id || `${code}-${Date.now()}`,
    code,
    createdAt,
    updatedAt: now,
    items
  };

  const status = recalculateRequestStatus(baseRequest);
  return {
    ...baseRequest,
    status,
    fulfilledAt: status === 'Atendida' ? (draft.fulfilledAt || now) : undefined
  };
}

export function getRequestProgress(request: MaterialRequest) {
  const requested = request.items.reduce((sum, item) => sum + normalizeQuantity(item.requestedQuantity), 0);
  const separated = request.items.reduce((sum, item) => sum + normalizeQuantity(item.separatedQuantity), 0);
  const pending = Math.max(0, requested - separated);
  const percent = requested > 0 ? Math.min(100, Math.round((separated / requested) * 100)) : 0;

  return { requested, separated, pending, percent };
}

export function materialRequestNeedsStockAttention(
  request: MaterialRequest,
  items: InventoryItem[],
  settings: InventorySettings
) {
  const stockBySku = new Map(items.map(item => [item.sku, item]));

  return request.items.some(requestItem => {
    const stockItem = stockBySku.get(requestItem.sku);
    if (!stockItem) return true;

    const projectedQuantity = stockItem.quantity - normalizeQuantity(requestItem.requestedQuantity);
    return projectedQuantity <= settings.reorderLimit;
  });
}

export function updateRequestItemQuantity(
  request: MaterialRequest,
  itemId: string,
  quantity: number
) {
  return {
    ...request,
    items: request.items.map(item =>
      item.id === itemId
        ? {
            ...item,
            requestedQuantity: Math.max(0, Math.floor(quantity)),
            separatedQuantity: Math.min(
              Math.max(0, Math.floor(quantity)),
              normalizeQuantity(item.separatedQuantity)
            )
          }
        : item
    )
  };
}

export function bumpSeparatedQuantity(
  request: MaterialRequest,
  sku: string,
  amount: number
) {
  let updated = false;

  const nextItems = request.items.map(item => {
    if (updated || item.sku !== sku) return item;

    const nextQuantity = clamp(
      normalizeQuantity(item.separatedQuantity) + amount,
      0,
      normalizeQuantity(item.requestedQuantity)
    );

    if (nextQuantity !== item.separatedQuantity) {
      updated = true;
      return {
        ...item,
        separatedQuantity: nextQuantity
      };
    }

    return item;
  });

  return {
    request: {
      ...request,
      items: nextItems
    },
    updated
  };
}

export function fillPendingQuantity(request: MaterialRequest, itemId: string) {
  return {
    ...request,
    items: request.items.map(item =>
      item.id === itemId
        ? {
            ...item,
            separatedQuantity: normalizeQuantity(item.requestedQuantity)
          }
        : item
    )
  };
}

export function sanitizeRequests(input: unknown): MaterialRequest[] {
  if (!Array.isArray(input)) return [];

  return input
    .map(value => sanitizeSingleRequest(value))
    .filter((value): value is MaterialRequest => Boolean(value))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

function sanitizeSingleRequest(value: unknown): MaterialRequest | null {
  if (!value || typeof value !== 'object') return null;

  const candidate = value as Partial<MaterialRequest>;
  const now = new Date().toISOString();
  const items = Array.isArray(candidate.items)
    ? candidate.items
        .map(item => sanitizeRequestItem(item))
        .filter((entry): entry is MaterialRequestItem => Boolean(entry))
    : [];

  const request: MaterialRequest = {
    id: String(candidate.id || ''),
    code: String(candidate.code || ''),
    vehiclePlate: String(candidate.vehiclePlate || ''),
    costCenter: String(candidate.costCenter || ''),
    vehicleDescription: candidate.vehicleDescription ? String(candidate.vehicleDescription) : '',
    vehicleDetails:
      candidate.vehicleDetails && typeof candidate.vehicleDetails === 'object'
        ? Object.fromEntries(
            Object.entries(candidate.vehicleDetails).map(([key, detailValue]) => [String(key), String(detailValue)])
          )
        : {},
    requester: String(candidate.requester || ''),
    sector: String(candidate.sector || ''),
    destination: String(candidate.destination || ''),
    notes: String(candidate.notes || ''),
    priority: normalizePriority(candidate.priority),
    status: 'Aberta',
    createdAt: String(candidate.createdAt || now),
    updatedAt: String(candidate.updatedAt || now),
    fulfilledAt: candidate.fulfilledAt ? String(candidate.fulfilledAt) : undefined,
    items
  };

  if (!request.id && !request.code && items.length === 0) return null;

  return {
    ...request,
    status: recalculateRequestStatus(request)
  };
}

function sanitizeRequestItem(value: unknown): MaterialRequestItem | null {
  if (!value || typeof value !== 'object') return null;

  const candidate = value as Partial<MaterialRequestItem>;
  const requestedQuantity = normalizeQuantity(candidate.requestedQuantity);
  const separatedQuantity = Math.min(
    requestedQuantity,
    normalizeQuantity(candidate.separatedQuantity)
  );

  if (!candidate.sku || !candidate.itemName) return null;

  return {
    id: String(candidate.id || `${candidate.sku}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    sku: String(candidate.sku),
    itemName: normalizeUserFacingText(candidate.itemName),
    location: normalizeLocationText(candidate.location || 'Sem localização'),
    category: classifyInventoryCategory(
      normalizeUserFacingText(candidate.itemName),
      normalizeUserFacingText(candidate.category || 'Sem categoria')
    ).category,
    requestedQuantity,
    separatedQuantity
  };
}

function normalizeQuantity(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

function normalizePriority(value: unknown): MaterialRequest['priority'] {
  if (value === 'Baixa' || value === 'Alta' || value === 'Urgente') {
    return value;
  }

  return 'Normal';
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
