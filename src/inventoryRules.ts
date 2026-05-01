import { InventoryItem, InventorySettings } from './types';
import { getAbcStockPolicy } from './abcAnalysis';

export const defaultInventorySettings: InventorySettings = {
  criticalLimit: 0,
  reorderLimit: 20
};

export function calculateInventoryStatus(
  quantity: number,
  settings: InventorySettings
): InventoryItem['status'] {
  if (quantity <= settings.criticalLimit) return 'Estoque Crítico';
  if (quantity <= settings.reorderLimit) return 'Repor em Breve';
  return 'Estoque Saudável';
}

export function getItemAlertSettings(
  item: InventoryItem,
  fallback: InventorySettings
): InventorySettings {
  const abcPolicy = getAbcStockPolicy(item.sku);
  if (abcPolicy) {
    return {
      criticalLimit: abcPolicy.criticalLimit,
      reorderLimit: abcPolicy.reorderLimit
    };
  }

  const criticalLimit = normalizeLimit(item.alertCriticalLimit, fallback.criticalLimit);
  const reorderLimit = Math.max(criticalLimit, normalizeLimit(item.alertReorderLimit, fallback.reorderLimit));

  return { criticalLimit, reorderLimit };
}

export function calculateItemStatus(
  item: InventoryItem,
  fallback: InventorySettings
): InventoryItem['status'] {
  return calculateInventoryStatus(item.quantity, getItemAlertSettings(item, fallback));
}

function normalizeLimit(value: number | undefined, fallback: number) {
  return Number.isFinite(value) ? Math.max(0, Number(value)) : fallback;
}
