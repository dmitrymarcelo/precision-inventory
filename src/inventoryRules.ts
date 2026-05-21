import { InventoryItem, InventoryLog, InventorySettings } from './types';
import { getAdaptiveAbcStockPolicy } from './abcAnalysis';

export const defaultInventorySettings: InventorySettings = {
  criticalLimit: 0,
  reorderLimit: 20
};

const ALERT_RULE_OVERRIDE_DAYS = 90;
const ALERT_RULE_OVERRIDE_MAX_AGE_MS = ALERT_RULE_OVERRIDE_DAYS * 24 * 60 * 60 * 1000;

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
  fallback: InventorySettings,
  logs: InventoryLog[] = []
): InventorySettings {
  const manualCriticalLimit = normalizeLimit(item.alertCriticalLimit, fallback.criticalLimit);
  const manualReorderLimit = Math.max(
    manualCriticalLimit,
    normalizeLimit(item.alertReorderLimit, fallback.reorderLimit)
  );

  const abcPolicy = getAdaptiveAbcStockPolicy(item.sku, logs);

  const overrideAt = typeof item.alertRuleOverrideAt === 'string' ? item.alertRuleOverrideAt : '';
  if (isOverrideActive(overrideAt)) {
    return {
      criticalLimit: manualCriticalLimit,
      reorderLimit: manualReorderLimit
    };
  }

  if (abcPolicy) {
    const hasManualDifferences =
      manualCriticalLimit !== abcPolicy.criticalLimit || manualReorderLimit !== abcPolicy.reorderLimit;
    const updatedAtFallback = typeof item.updatedAt === 'string' ? item.updatedAt : '';
    if (hasManualDifferences && isOverrideActive(updatedAtFallback)) {
      return {
        criticalLimit: manualCriticalLimit,
        reorderLimit: manualReorderLimit
      };
    }
    return {
      criticalLimit: abcPolicy.criticalLimit,
      reorderLimit: abcPolicy.reorderLimit
    };
  }

  return { criticalLimit: manualCriticalLimit, reorderLimit: manualReorderLimit };
}

export function calculateItemStatus(
  item: InventoryItem,
  fallback: InventorySettings,
  logs: InventoryLog[] = []
): InventoryItem['status'] {
  return calculateInventoryStatus(item.quantity, getItemAlertSettings(item, fallback, logs));
}

function normalizeLimit(value: number | undefined, fallback: number) {
  return Number.isFinite(value) ? Math.max(0, Number(value)) : fallback;
}

function isOverrideActive(value: string) {
  if (!value) return false;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time) || time <= 0) return false;
  return Date.now() - time < ALERT_RULE_OVERRIDE_MAX_AGE_MS;
}
