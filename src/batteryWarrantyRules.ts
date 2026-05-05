import { InventoryItem, MaterialRequest, MaterialRequestItem } from './types';
import { normalizeUserFacingText } from './textUtils';
import { normalizePlate } from './vehicleBase';

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const DEFAULT_BATTERY_VALIDITY_MONTHS = 12;
const MOTORCYCLE_BATTERY_VALIDITY_MONTHS = 6;
const MOTORCYCLE_BATTERY_SKUS = new Set(['12047']);

type BatteryItemCandidate = Partial<Pick<InventoryItem, 'name' | 'category' | 'sourceCategory'>> &
  Partial<Pick<MaterialRequestItem, 'itemName'>>;

export interface BatteryWarrantyAlert {
  requestCode: string;
  sku: string;
  itemName: string;
  fulfilledAt: string;
  validUntil: string;
  validityMonths: number;
  daysRemaining: number;
}

export function isBatteryInventoryItem(item: InventoryItem) {
  return isBatteryLikeText(buildBatterySearchText(item));
}

export function isBatteryRequestItem(item: MaterialRequestItem) {
  return isBatteryLikeText(buildBatterySearchText(item));
}

export function findActiveBatteryWarrantyAlert(
  requests: MaterialRequest[],
  plate: string,
  currentRequestId?: string,
  now = new Date()
): BatteryWarrantyAlert | null {
  const normalizedPlate = normalizePlate(plate);
  if (!normalizedPlate) return null;

  const nowTime = now.getTime();
  if (!Number.isFinite(nowTime)) return null;

  const activeBatteryRequests = requests
    .filter(request => {
      if (!request || request.deletedAt || request.reversedAt) return false;
      if (currentRequestId && request.id === currentRequestId) return false;
      if (normalizePlate(request.vehiclePlate) !== normalizedPlate) return false;
      if (normalizeUserFacingText(request.status) !== 'Atendida') return false;
      return request.items.some(item => isBatteryRequestItem(item) && getRequestItemQuantity(item) > 0);
    })
    .map(request => {
      const fulfilledAt = getRequestFulfilledDate(request);
      const fulfilledTime = fulfilledAt ? new Date(fulfilledAt).getTime() : Number.NaN;
      const batteryItem = request.items.find(item => isBatteryRequestItem(item) && getRequestItemQuantity(item) > 0);
      if (!batteryItem || !Number.isFinite(fulfilledTime)) {
        return { request, fulfilledAt, fulfilledTime, batteryItem, validUntil: null, validityMonths: 0, daysRemaining: 0 };
      }

      const validityMonths = getBatteryValidityMonths(batteryItem.sku);
      const validUntil = addMonths(new Date(fulfilledTime), validityMonths);
      const daysRemaining = Math.ceil((validUntil.getTime() - nowTime) / DAY_IN_MS);

      return { request, fulfilledAt, fulfilledTime, batteryItem, validUntil, validityMonths, daysRemaining };
    })
    .filter(entry => entry.fulfilledAt && entry.batteryItem && entry.validUntil && entry.daysRemaining > 0)
    .sort((first, second) => second.fulfilledTime - first.fulfilledTime)[0];

  if (!activeBatteryRequests || !activeBatteryRequests.batteryItem || !activeBatteryRequests.validUntil) return null;

  return {
    requestCode: activeBatteryRequests.request.code || 'solicitacao anterior',
    sku: activeBatteryRequests.batteryItem.sku,
    itemName: normalizeUserFacingText(activeBatteryRequests.batteryItem.itemName),
    fulfilledAt: activeBatteryRequests.fulfilledAt,
    validUntil: activeBatteryRequests.validUntil.toISOString(),
    validityMonths: activeBatteryRequests.validityMonths,
    daysRemaining: activeBatteryRequests.daysRemaining
  };
}

export function formatBatteryWarrantyDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';

  return date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
}

function buildBatterySearchText(item: BatteryItemCandidate) {
  return [item.itemName, item.name, item.category, item.sourceCategory]
    .map(value => normalizeForSearch(value))
    .filter(Boolean)
    .join(' ');
}

function isBatteryLikeText(text: string) {
  if (!/\bbateria\b/.test(text)) return false;

  const accessoryTerms = [
    'adaptador',
    'cabo',
    'carregador',
    'chave',
    'conector',
    'presilha',
    'sensor',
    'suporte',
    'tampa',
    'terminal'
  ];
  if (accessoryTerms.some(term => text.includes(term))) return false;

  const nonVehicleBatteryTerms = ['cr2032', 'litio', 'lithium', 'pilha'];
  return !nonVehicleBatteryTerms.some(term => text.includes(term));
}

function normalizeForSearch(value: unknown) {
  return normalizeUserFacingText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function getRequestFulfilledDate(request: MaterialRequest) {
  return request.fulfilledAt || request.updatedAt || request.createdAt || '';
}

function getRequestItemQuantity(item: MaterialRequestItem) {
  const separated = Number(item.separatedQuantity);
  const requested = Number(item.requestedQuantity);
  const quantity = Number.isFinite(separated) && separated > 0 ? separated : requested;
  return Number.isFinite(quantity) ? quantity : 0;
}

function getBatteryValidityMonths(sku: string) {
  return MOTORCYCLE_BATTERY_SKUS.has(normalizeSku(sku))
    ? MOTORCYCLE_BATTERY_VALIDITY_MONTHS
    : DEFAULT_BATTERY_VALIDITY_MONTHS;
}

function addMonths(date: Date, months: number) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function normalizeSku(value: string) {
  return String(value || '').trim().replace(/^0+/, '') || '0';
}
