import { InventoryLog, MaterialRequest } from './types';

export interface OpenDivergence {
  sku: string;
  itemName: string;
  location: string;
  delta: number;
  date: string;
  referenceCode?: string;
  expectedQuantityAfter?: number;
  reportedQuantityAfter?: number;
  log: InventoryLog;
}

export function getOpenDivergenceForSku(logs: InventoryLog[], sku: string): OpenDivergence | null {
  const normalizedSku = normalizeSku(sku);
  if (!normalizedSku) return null;

  let latestDivergence: InventoryLog | null = null;
  let latestClearingAdjustment: InventoryLog | null = null;

  logs.forEach(log => {
    if (normalizeSku(log.sku) !== normalizedSku) return;

    if (log.source === 'divergencia' && isNewerLog(log, latestDivergence)) {
      latestDivergence = log;
      return;
    }

    if (isDivergenceClearingLog(log) && isNewerLog(log, latestClearingAdjustment)) {
      latestClearingAdjustment = log;
    }
  });

  if (!latestDivergence) return null;
  if (
    latestClearingAdjustment &&
    getLogTime(latestClearingAdjustment) >= getLogTime(latestDivergence)
  ) {
    return null;
  }

  return buildOpenDivergence(latestDivergence);
}

export function getOpenDivergenceMap(logs: InventoryLog[]) {
  const skus = new Set(logs.filter(log => log.source === 'divergencia').map(log => normalizeSku(log.sku)).filter(Boolean));
  const next = new Map<string, OpenDivergence>();

  skus.forEach(sku => {
    const divergence = getOpenDivergenceForSku(logs, sku);
    if (divergence) {
      next.set(sku, divergence);
      next.set(divergence.sku, divergence);
    }
  });

  return next;
}

export function getOpenDivergences(logs: InventoryLog[]) {
  const skus = new Set(
    logs
      .filter(log => log.source === 'divergencia')
      .map(log => normalizeSku(log.sku))
      .filter(Boolean)
  );

  const divergences: OpenDivergence[] = [];
  skus.forEach(sku => {
    const divergence = getOpenDivergenceForSku(logs, sku);
    if (divergence) divergences.push(divergence);
  });

  return divergences.sort((first, second) => getLogTime(second.log) - getLogTime(first.log));
}

export function getRequestDivergenceLogs(request: MaterialRequest | null, logs: InventoryLog[]) {
  if (!request) return [];
  const requestCode = String(request.code || '').trim();
  if (!requestCode) return [];

  return logs
    .filter(log => log.source === 'divergencia' && String(log.referenceCode || '').trim() === requestCode)
    .slice()
    .sort((first, second) => getLogTime(second) - getLogTime(first));
}

export function getLatestRequestDivergenceBySku(request: MaterialRequest | null, logs: InventoryLog[]) {
  const next = new Map<string, InventoryLog>();

  getRequestDivergenceLogs(request, logs).forEach(log => {
    const sku = normalizeSku(log.sku);
    if (!sku || next.has(sku)) return;
    next.set(sku, log);
  });

  return next;
}

export function getReportedRemainingBySkuFromDivergences(
  request: MaterialRequest | null,
  logs: InventoryLog[],
  current: Record<string, number> = {}
) {
  const next: Record<string, number> = { ...current };

  getLatestRequestDivergenceBySku(request, logs).forEach((log, sku) => {
    if (Number.isFinite(next[sku])) return;
    const reported = Number(log.reportedQuantityAfter ?? log.quantityAfter);
    if (Number.isFinite(reported)) {
      const normalizedReported = Math.max(0, Math.floor(reported));
      next[sku] = normalizedReported;
      next[log.sku] = normalizedReported;
    }
  });

  return next;
}

export function formatDivergenceDelta(delta: number) {
  return `${delta > 0 ? '+' : ''}${delta} un`;
}

export function normalizeSku(value: unknown) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const digits = raw.replace(/[^\d]/g, '');
  if (digits) return digits.length < 5 ? digits.padStart(5, '0') : digits;
  return raw.toLowerCase();
}

function isDivergenceClearingLog(log: InventoryLog) {
  if (log.source !== 'ajuste') return false;
  if (log.clearsDivergence === true) return true;
  if (log.clearsDivergence === false) return false;
  return Number(log.delta) !== 0;
}

function isNewerLog(candidate: InventoryLog, current: InventoryLog | null) {
  if (!current) return true;
  return getLogTime(candidate) >= getLogTime(current);
}

function getLogTime(log: InventoryLog) {
  const parsed = new Date(log.date).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildOpenDivergence(log: InventoryLog): OpenDivergence {
  return {
    sku: log.sku,
    itemName: log.itemName,
    location: log.location,
    delta: Number(log.delta) || 0,
    date: log.date,
    referenceCode: log.referenceCode,
    expectedQuantityAfter: log.expectedQuantityAfter,
    reportedQuantityAfter: log.reportedQuantityAfter ?? log.quantityAfter,
    log
  };
}
