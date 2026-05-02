import { ABC_ANALYSIS, ABC_ANALYSIS_MONTHS_COVERED, type AbcAnalysisRecord } from './abcAnalysisData';
import type { InventoryLog } from './types';

export type AbcStockPolicy = {
  criticalLimit: number;
  reorderLimit: number;
  minimumStock: number;
  maximumStock: number;
  averageMonthlyDemand: number;
  baseAverageMonthlyDemand: number;
  recentAverageMonthlyOutflow: number;
  recentOutflowQuantity: number;
  recentInflowQuantity: number;
  recentAdjustmentQuantity: number;
  monthsCovered: number;
  demandSource: 'curva-abc' | 'curva-abc-e-movimentacao' | 'movimentacao';
};

const ABC_POLICY_FACTORS: Record<AbcAnalysisRecord['className'], { min: number; max: number }> = {
  A: { min: 0.5, max: 1.5 },
  B: { min: 0.35, max: 1 },
  C: { min: 0.2, max: 0.75 }
};
const LIVE_MOVEMENT_DAYS = 120;
const LIVE_MOVEMENT_MONTHS = LIVE_MOVEMENT_DAYS / 30;

const abcBySku = new Map(ABC_ANALYSIS.flatMap(record => getSkuCandidates(record.sku).map(sku => [sku, record])));

export function getAbcAnalysisForSku(sku: string | null | undefined) {
  const candidates = getSkuCandidates(sku);
  for (const candidate of candidates) {
    const record = abcBySku.get(candidate);
    if (record) return record;
  }
  return null;
}

export function getAbcStockPolicy(sku: string | null | undefined): AbcStockPolicy | null {
  return getAdaptiveAbcStockPolicy(sku);
}

export function getAdaptiveAbcStockPolicy(
  sku: string | null | undefined,
  logs: InventoryLog[] = []
): AbcStockPolicy | null {
  const record = getAbcAnalysisForSku(sku);
  const movement = summarizeRecentMovement(sku, logs);
  if (!record) return null;

  const className = record.className;
  const baseDemand = Math.max(record.attendedQuantity, record.requestedQuantity, 0);
  const baseAverageMonthlyDemand = baseDemand / ABC_ANALYSIS_MONTHS_COVERED;
  const recentAverageMonthlyOutflow = movement.outflowQuantity / LIVE_MOVEMENT_MONTHS;
  const averageMonthlyDemand = Math.max(baseAverageMonthlyDemand, recentAverageMonthlyOutflow);
  if (averageMonthlyDemand <= 0) return null;

  const factors = ABC_POLICY_FACTORS[className];
  const minimumStock = Math.max(1, Math.ceil(averageMonthlyDemand * factors.min));
  const maximumStock = Math.max(minimumStock, Math.ceil(averageMonthlyDemand * factors.max));
  const demandSource =
    baseAverageMonthlyDemand > 0 && recentAverageMonthlyOutflow > baseAverageMonthlyDemand
      ? 'curva-abc-e-movimentacao'
      : baseAverageMonthlyDemand > 0
        ? 'curva-abc'
        : 'movimentacao';

  return {
    criticalLimit: minimumStock,
    reorderLimit: maximumStock,
    minimumStock,
    maximumStock,
    averageMonthlyDemand,
    baseAverageMonthlyDemand,
    recentAverageMonthlyOutflow,
    recentOutflowQuantity: movement.outflowQuantity,
    recentInflowQuantity: movement.inflowQuantity,
    recentAdjustmentQuantity: movement.adjustmentQuantity,
    monthsCovered: ABC_ANALYSIS_MONTHS_COVERED,
    demandSource
  };
}

export function getAbcSortRank(sku: string | null | undefined) {
  return getAbcAnalysisForSku(sku)?.rank ?? Number.MAX_SAFE_INTEGER;
}

export function getAbcClassPriority(sku: string | null | undefined) {
  const className = getAbcAnalysisForSku(sku)?.className;
  if (className === 'A') return 3;
  if (className === 'B') return 2;
  if (className === 'C') return 1;
  return 0;
}

function summarizeRecentMovement(sku: string | null | undefined, logs: InventoryLog[]) {
  const candidates = new Set(getSkuCandidates(sku));
  const cutoff = Date.now() - LIVE_MOVEMENT_DAYS * 24 * 60 * 60 * 1000;
  let outflowQuantity = 0;
  let inflowQuantity = 0;
  let adjustmentQuantity = 0;

  for (const log of logs) {
    if (!candidates.has(String(log.sku || '').trim())) continue;
    const date = new Date(log.date).getTime();
    if (!Number.isFinite(date) || date < cutoff) continue;

    if (log.source === 'solicitacao') {
      outflowQuantity += Math.abs(Math.min(0, Number(log.delta) || 0));
      continue;
    }

    if (log.source === 'recebimento') {
      inflowQuantity += Math.max(0, Number(log.delta) || 0);
      continue;
    }

    if (log.source === 'ajuste' || log.source === 'divergencia' || !log.source) {
      adjustmentQuantity += Math.abs(Number(log.delta) || 0);
      if ((Number(log.delta) || 0) < 0) {
        outflowQuantity += Math.abs(Number(log.delta) || 0);
      }
    }
  }

  return { outflowQuantity, inflowQuantity, adjustmentQuantity };
}

function getSkuCandidates(value: string | null | undefined) {
  const raw = String(value || '').trim();
  if (!raw) return [];

  const digits = raw.replace(/\D/g, '');
  const candidates = new Set<string>([raw]);
  if (digits) {
    candidates.add(digits);
    candidates.add(digits.padStart(5, '0'));
    candidates.add(digits.replace(/^0+/, '') || '0');
  }

  return Array.from(candidates);
}
