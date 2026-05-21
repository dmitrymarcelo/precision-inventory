export const APP_TIME_ZONE = 'America/Manaus';

export type DailyCycleCandidate<TItem = unknown> = {
  item: TItem;
  countedToday: boolean;
  needsRecount?: boolean;
  cycleWeight?: number;
};

export type InventoryLogLike = {
  sku?: string;
  date?: string;
  source?: 'ajuste' | 'recebimento' | 'solicitacao' | 'divergencia';
  referenceCode?: string;
};

export function getCalendarDayKey(date: Date, timeZone = APP_TIME_ZONE) {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  return formatter.format(date);
}

export function isSameCalendarDay(date: string | Date, referenceDate: Date, timeZone = APP_TIME_ZONE) {
  const parsed = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(parsed.getTime())) return false;
  return getCalendarDayKey(parsed, timeZone) === getCalendarDayKey(referenceDate, timeZone);
}

export function isOperationalInventoryLog(log: InventoryLogLike) {
  if (log.source === 'ajuste' || log.source === 'divergencia') return true;
  if (log.source) return false;
  return !log.referenceCode;
}

export function getLatestOperationalLogBySku<TLog extends InventoryLogLike>(
  logs: TLog[],
  referenceDate = new Date(),
  timeZone = APP_TIME_ZONE
) {
  const next = new Map<string, TLog>();

  for (const log of logs) {
    const sku = String(log?.sku || '');
    if (!sku || !log?.date) continue;
    if (!isSameCalendarDay(log.date, referenceDate, timeZone) || !isOperationalInventoryLog(log)) continue;

    const previous = next.get(sku);
    if (!previous || new Date(log.date).getTime() > new Date(previous.date || 0).getTime()) {
      next.set(sku, log);
    }
  }

  return next;
}

export function buildDailyCycleRows<T extends DailyCycleCandidate>(
  rows: T[],
  options: { count?: number; dayKey: string }
) {
  const count = Math.max(0, options.count ?? 5);
  if (count <= 0) return [];

  const sortedCandidates = rows
    .slice()
    .sort((first, second) => getCandidateSku(first).localeCompare(getCandidateSku(second), 'pt-BR'));
  const pending = sortedCandidates.filter(row => !row.countedToday || row.needsRecount);
  const selected = pickDailyCycleRows(pending.length >= count ? pending : sortedCandidates, count, options.dayKey);

  if (selected.length >= count) return selected;

  const selectedSkus = new Set(selected.map(getCandidateSku));
  const remaining = sortedCandidates.filter(row => !selectedSkus.has(getCandidateSku(row)));
  const fill = pickDailyCycleRows(remaining, count - selected.length, `${options.dayKey}/fill`);
  return [...selected, ...fill];
}

function getCandidateSku(row: DailyCycleCandidate) {
  const item = row.item as { sku?: string } | null | undefined;
  return String(item?.sku || '');
}

function hashToSeed(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number) {
  return () => {
    let next = (seed += 0x6d2b79f5);
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function pickDailyCycleRows<T extends DailyCycleCandidate>(rows: T[], count: number, seedKey: string) {
  if (count <= 0) return [];
  if (rows.length <= count) return rows.slice(0, count);

  const rng = mulberry32(hashToSeed(seedKey));
  const scored = rows.map(row => {
    const baseWeight = Math.max(1, Number(row.cycleWeight) || 1);
    const divergenceMultiplier = row.needsRecount ? 1.4 : 1;
    const weight = Math.max(1, baseWeight * divergenceMultiplier);
    const u = Math.min(0.999999, Math.max(0.000001, rng()));
    const key = Math.pow(u, 1 / weight);
    return { row, key };
  });

  return scored
    .sort((first, second) => second.key - first.key)
    .slice(0, count)
    .map(entry => entry.row);
}

