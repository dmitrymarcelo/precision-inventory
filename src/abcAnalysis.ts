import { ABC_ANALYSIS, ABC_ANALYSIS_MONTHS_COVERED, type AbcAnalysisRecord } from './abcAnalysisData';

export type AbcStockPolicy = {
  criticalLimit: number;
  reorderLimit: number;
  minimumStock: number;
  maximumStock: number;
  averageMonthlyDemand: number;
};

const ABC_POLICY_FACTORS: Record<AbcAnalysisRecord['className'], { min: number; max: number }> = {
  A: { min: 0.5, max: 1.5 },
  B: { min: 0.35, max: 1 },
  C: { min: 0.2, max: 0.75 }
};

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
  const record = getAbcAnalysisForSku(sku);
  if (!record) return null;

  const demand = Math.max(record.attendedQuantity, record.requestedQuantity, 0);
  if (demand <= 0) return null;

  const averageMonthlyDemand = demand / ABC_ANALYSIS_MONTHS_COVERED;
  const factors = ABC_POLICY_FACTORS[record.className];
  const minimumStock = Math.max(1, Math.ceil(averageMonthlyDemand * factors.min));
  const maximumStock = Math.max(minimumStock, Math.ceil(averageMonthlyDemand * factors.max));

  return {
    criticalLimit: minimumStock,
    reorderLimit: maximumStock,
    minimumStock,
    maximumStock,
    averageMonthlyDemand
  };
}

export function getAbcSortRank(sku: string | null | undefined) {
  return getAbcAnalysisForSku(sku)?.rank ?? Number.MAX_SAFE_INTEGER;
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
