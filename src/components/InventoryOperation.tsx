import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  Clock3,
  PackageSearch,
  RefreshCcw
} from 'lucide-react';
import { InventoryItem, InventoryLog, InventorySettings } from '../types';
import { calculateItemStatus } from '../inventoryRules';
import { getAbcAnalysisForSku, getAbcClassPriority, getAbcSortRank, getAdaptiveAbcStockPolicy } from '../abcAnalysis';
import { getVehicleTypeFromModel, normalizeOperationalVehicleType } from '../vehicleCatalog';
import { normalizeLocationText, normalizeUserFacingText } from '../textUtils';
import { formatDivergenceDelta, getOpenDivergenceMap, type OpenDivergence } from '../divergenceRules';

const APP_TIME_ZONE = 'America/Manaus';
const MAX_VISIBLE_OPERATION_ITEMS = 6;

interface InventoryOperationProps {
  items: InventoryItem[];
  logs: InventoryLog[];
  settings: InventorySettings;
  onSelectSku: (sku: string) => void;
  showToast: (message: string, type?: 'success' | 'info') => void;
}

type InventoryStatusFilter = 'all' | 'critical' | 'reorder' | 'healthy';

export default function InventoryOperation({
  items,
  logs,
  settings,
  onSelectSku,
  showToast
}: InventoryOperationProps) {
  const [focusLocation, setFocusLocation] = useState('all');
  const [focusVehicleType, setFocusVehicleType] = useState('all');
  const [focusStatus, setFocusStatus] = useState<InventoryStatusFilter>('all');

  const openDivergenceBySku = useMemo(() => getOpenDivergenceMap(logs), [logs]);
  const itemBySku = useMemo(() => {
    const next = new Map<string, InventoryItem>();
    items.forEach(item => {
      if (!item?.sku) return;
      next.set(String(item.sku), item);
    });
    return next;
  }, [items]);

  const operationBaseItems = useMemo(() => {
    const next = new Map<string, InventoryItem>();

    items.forEach(item => {
      if (item.isActiveInWarehouse === true) {
        next.set(item.sku, item);
      }
    });

    for (const divergence of openDivergenceBySku.values()) {
      const item = itemBySku.get(divergence.sku);
      if (item) next.set(item.sku, item);
    }

    return Array.from(next.values());
  }, [itemBySku, items, openDivergenceBySku]);

  const locationOptions = useMemo(
    () =>
      Array.from(new Set(operationBaseItems.map(item => normalizeLocationText(item.location))))
        .sort((first, second) => first.localeCompare(second, 'pt-BR')),
    [operationBaseItems]
  );

  const vehicleTypeOptions = useMemo(
    () =>
      Array.from(
        new Set(
          operationBaseItems
            .map(item => getEffectiveVehicleType(item))
            .filter(Boolean)
        )
      ).sort((first, second) => first.localeCompare(second, 'pt-BR')),
    [operationBaseItems]
  );

  useEffect(() => {
    if (focusLocation !== 'all' && !locationOptions.includes(focusLocation)) {
      setFocusLocation('all');
    }
  }, [focusLocation, locationOptions]);

  useEffect(() => {
    if (focusVehicleType !== 'all' && !vehicleTypeOptions.includes(focusVehicleType)) {
      setFocusVehicleType('all');
    }
  }, [focusVehicleType, vehicleTypeOptions]);

  const todayLogs = useMemo(
    () => {
      const today = new Date();
      return logs.filter(log => isSameCalendarDay(log.date, today) && isOperationalInventoryLog(log));
    },
    [logs]
  );

  const latestLogBySku = useMemo(() => {
    const next = new Map<string, InventoryLog>();

    for (const log of todayLogs) {
      const previous = next.get(log.sku);
      if (!previous || new Date(log.date).getTime() > new Date(previous.date).getTime()) {
        next.set(log.sku, log);
      }
    }

    return next;
  }, [todayLogs]);

  const filteredItems = useMemo(
    () =>
      operationBaseItems.filter(item => {
        const matchesLocation = focusLocation === 'all' || normalizeLocationText(item.location) === focusLocation;
        const matchesVehicleType =
          focusVehicleType === 'all' || getEffectiveVehicleType(item) === focusVehicleType;
        const matchesStatus = matchesInventoryStatusFilter(calculateItemStatus(item, settings, logs), focusStatus);

        return matchesLocation && matchesVehicleType && matchesStatus;
      }),
    [focusLocation, focusStatus, focusVehicleType, logs, operationBaseItems, settings]
  );

  const operationRows = useMemo(
    () =>
      filteredItems.map(item => {
        const latestLog = latestLogBySku.get(item.sku) || null;
        const openDivergence = openDivergenceBySku.get(item.sku) || null;
        const liveStatus = calculateItemStatus(item, settings, logs);
        const abcRecord = getAbcAnalysisForSku(item.sku);
        const abcPolicy = getAdaptiveAbcStockPolicy(item.sku, logs);
        const abcRank = getAbcSortRank(item.sku);
        const abcRankScore = Number.isFinite(abcRank) ? Math.max(0, 1000 - Math.min(abcRank, 1000)) : 0;
        const absDelta = openDivergence ? Math.abs(openDivergence.delta) : latestLog ? Math.abs(latestLog.delta) : 0;
        const needsRecount = Boolean(openDivergence);
        const priorityScore =
          getAbcClassPriority(item.sku) * 10000 +
          abcRankScore +
          getStatusPriority(liveStatus) * 1000 +
          (needsRecount ? 3000 : 0) +
          (isNoLocation(item.location) ? 200 : 0) +
          absDelta * 10 +
          (item.quantity <= 0 ? 50 : 0);

        return {
          item,
          latestLog,
          openDivergence,
          liveStatus,
          abcRecord,
          abcPolicy,
          absDelta,
          needsRecount,
          countedToday: Boolean(latestLog),
          priorityScore
        };
      }),
    [filteredItems, latestLogBySku, logs, openDivergenceBySku, settings]
  );

  const cycleCandidateRows = useMemo(
    () =>
      operationBaseItems.map(item => {
        const latestLog = latestLogBySku.get(item.sku) || null;
        const openDivergence = openDivergenceBySku.get(item.sku) || null;
        const liveStatus = calculateItemStatus(item, settings, logs);
        const abcRecord = getAbcAnalysisForSku(item.sku);
        const abcPolicy = getAdaptiveAbcStockPolicy(item.sku, logs);
        const abcRank = getAbcSortRank(item.sku);
        const abcRankScore = Number.isFinite(abcRank) ? Math.max(0, 1000 - Math.min(abcRank, 1000)) : 0;
        const absDelta = openDivergence ? Math.abs(openDivergence.delta) : latestLog ? Math.abs(latestLog.delta) : 0;
        const needsRecount = Boolean(openDivergence);
        const priorityScore =
          getAbcClassPriority(item.sku) * 10000 +
          abcRankScore +
          getStatusPriority(liveStatus) * 1000 +
          (needsRecount ? 3000 : 0) +
          (isNoLocation(item.location) ? 200 : 0) +
          absDelta * 10 +
          (item.quantity <= 0 ? 50 : 0);

        return {
          item,
          latestLog,
          openDivergence,
          liveStatus,
          abcRecord,
          abcPolicy,
          absDelta,
          needsRecount,
          countedToday: Boolean(latestLog),
          priorityScore
        };
      }),
    [latestLogBySku, logs, openDivergenceBySku, operationBaseItems, settings]
  );

  const cyclicDayKey = getCalendarDayKey(new Date(), APP_TIME_ZONE);
  const cyclicInventoryRows = useMemo(() => {
    const sortedCandidates = cycleCandidateRows
      .slice()
      .sort((first, second) => String(first.item.sku).localeCompare(String(second.item.sku), 'pt-BR'));

    const pending = sortedCandidates.filter(row => !row.countedToday);
    const selected = pickDailyCycleRows(pending.length >= 5 ? pending : sortedCandidates, 5, cyclicDayKey);

    if (selected.length >= 5) return selected;

    const selectedSkus = new Set(selected.map(row => row.item.sku));
    const remaining = sortedCandidates.filter(row => !selectedSkus.has(row.item.sku));
    const fill = pickDailyCycleRows(remaining, 5 - selected.length, `${cyclicDayKey}/fill`);
    return [...selected, ...fill];
  }, [cycleCandidateRows, cyclicDayKey]);

  const pendingQueue = useMemo(
    () =>
      operationRows
        .filter(row => !row.countedToday)
        .sort((first, second) => second.priorityScore - first.priorityScore)
        .slice(0, MAX_VISIBLE_OPERATION_ITEMS),
    [operationRows]
  );

  const recountQueue = useMemo(
    () =>
      operationRows
        .filter(row => row.needsRecount)
        .sort((first, second) => {
          if (second.absDelta !== first.absDelta) return second.absDelta - first.absDelta;
          return second.priorityScore - first.priorityScore;
        })
        .slice(0, MAX_VISIBLE_OPERATION_ITEMS),
    [operationRows]
  );

  const countedTodayRows = useMemo(
    () =>
      operationRows
        .filter(row => row.countedToday)
        .sort((first, second) => {
          if (!first.latestLog || !second.latestLog) return 0;
          return new Date(second.latestLog.date).getTime() - new Date(first.latestLog.date).getTime();
        })
        .slice(0, MAX_VISIBLE_OPERATION_ITEMS),
    [operationRows]
  );

  const countedTodayTotal = operationRows.filter(row => row.countedToday).length;
  const divergenceTotal = operationRows.filter(row => row.needsRecount).length;
  const pendingTotal = Math.max(0, filteredItems.length - countedTodayTotal);
  const abcSummary = operationRows.reduce(
    (summary, row) => {
      if (row.abcRecord) {
        summary[row.abcRecord.className] += 1;
        if (!row.countedToday) summary.pendingAbc += 1;
        if (!row.countedToday && row.abcRecord.className === 'A') summary.pendingA += 1;
      }
      return summary;
    },
    { A: 0, B: 0, C: 0, pendingAbc: 0, pendingA: 0 }
  );
  const noLocationTotal = filteredItems.filter(
    item => isNoLocation(item.location)
  ).length;
  const progressPercent = filteredItems.length
    ? Math.round((countedTodayTotal / filteredItems.length) * 100)
    : 0;

  const openNextPending = () => {
    const next = pendingQueue[0];
    if (!next) {
      showToast('Nao ha itens pendentes para contar no foco atual.', 'info');
      return;
    }

    onSelectSku(next.item.sku);
    showToast(`Abrindo o proximo SKU pendente: ${next.item.sku}.`, 'success');
  };

  const openNextRecount = () => {
    const next = recountQueue[0];
    if (!next) {
      showToast('Nao ha itens com divergencia para recontar no foco atual.', 'info');
      return;
    }

    onSelectSku(next.item.sku);
    showToast(`Abrindo o proximo SKU para recontagem: ${next.item.sku}.`, 'success');
  };

  return (
    <section className="mb-6 rounded-2xl border border-outline-variant/20 bg-surface-container-lowest p-5 shadow-sm">
      <div className="flex flex-col gap-2 mb-5">
        <span className="text-primary font-label text-[11px] font-semibold uppercase tracking-wider">
          Inventário
        </span>
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
          <div>
            <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight text-on-surface">
              Inventário Operacional
            </h2>
            <p className="text-sm text-on-surface-variant mt-1 max-w-3xl">
              Organize a contagem por fila, acompanhe o progresso do dia e reabra rapido os SKUs com divergencia.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <button
              type="button"
              onClick={openNextPending}
              className="h-11 px-4 rounded-xl bg-primary text-on-primary font-bold flex items-center justify-center gap-2"
            >
              <PackageSearch size={18} />
              Proximo pendente
            </button>
            <button
              type="button"
              onClick={openNextRecount}
              className="h-11 px-4 rounded-xl bg-surface-container-highest text-primary font-bold flex items-center justify-center gap-2"
            >
              <RefreshCcw size={18} />
              Proxima recontagem
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-5 mb-5">
        <SummaryCard
          icon={<ClipboardList size={18} />}
          label="Base do foco"
          value={String(filteredItems.length)}
          description="SKUs dentro do recorte atual"
        />
        <SummaryCard
          icon={<CheckCircle2 size={18} />}
          label="Contados hoje"
          value={`${countedTodayTotal} (${progressPercent}%)`}
          description="Progresso real da operacao"
        />
        <SummaryCard
          icon={<Clock3 size={18} />}
          label="Pendentes"
          value={String(pendingTotal)}
          description="Itens ainda sem contagem hoje"
        />
        <SummaryCard
          icon={<AlertTriangle size={18} />}
          label="Divergencias"
          value={String(divergenceTotal)}
          description={`${noLocationTotal} sem localizacao no foco`}
          tone={divergenceTotal > 0 ? 'warning' : 'default'}
        />
        <SummaryCard
          icon={<PackageSearch size={18} />}
          label="ABC prioritario"
          value={`${abcSummary.pendingA} A`}
          description={`${abcSummary.pendingAbc} ABC pendentes no foco`}
          tone={abcSummary.pendingA > 0 ? 'warning' : 'default'}
        />
      </div>

      <div className="mb-5 rounded-2xl border border-primary/10 bg-primary-container/20 px-4 py-3">
        <p className="text-[11px] font-bold uppercase tracking-widest text-primary">
          Inventario guiado por Curva ABC
        </p>
        <p className="mt-1 text-sm text-on-surface-variant">
          No foco atual: Classe A {abcSummary.A}, Classe B {abcSummary.B}, Classe C {abcSummary.C}. A fila prioriza
          classe/rank ABC, itens criticos, divergencias, movimentacao recente e falta de localizacao.
        </p>
      </div>

      <div className="mb-6 rounded-2xl border border-outline-variant/20 bg-surface-container-low px-4 py-4">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-on-surface-variant">Inventario ciclico</p>
            <h3 className="text-lg font-headline font-extrabold text-on-surface">5 itens do dia</h3>
            <p className="mt-1 text-sm text-on-surface-variant">
              Sorteio de {cyclicDayKey} baseado na Curva ABC. Use para manter contagem diaria sem precisar escolher SKU.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              const next = cyclicInventoryRows[0];
              if (!next) {
                showToast('Nao ha itens suficientes para o inventario ciclico.', 'info');
                return;
              }
              onSelectSku(next.item.sku);
              showToast(`Abrindo o primeiro item do inventario ciclico: ${next.item.sku}.`, 'success');
            }}
            className="h-11 px-4 rounded-xl bg-surface-container-highest text-primary font-bold flex items-center justify-center gap-2"
          >
            <ArrowRight size={18} />
            Abrir primeiro
          </button>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {cyclicInventoryRows.map(row => (
            <button
              key={`cyclic-${row.item.sku}`}
              type="button"
              onClick={() => onSelectSku(row.item.sku)}
              className="text-left rounded-xl border border-outline-variant/20 bg-surface-container-lowest px-4 py-4 hover:bg-surface-container-high transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-bold uppercase tracking-wider text-outline">SKU {row.item.sku}</p>
                  <p className="mt-1 font-semibold text-on-surface truncate">{normalizeUserFacingText(row.item.name)}</p>
                </div>
                <span className="shrink-0 rounded-full bg-primary/10 px-2 py-1 text-[11px] font-bold text-primary">
                  {row.abcRecord?.className ? `ABC ${row.abcRecord.className}` : 'ABC -'}
                </span>
              </div>
              <div className="mt-3 text-[11px] font-semibold text-on-surface-variant flex flex-col gap-1">
                <span>{normalizeLocationText(row.item.location)}</span>
                <span>{formatVehicleType(row.item)}</span>
                <span className={row.needsRecount ? 'text-error' : ''}>
                  {row.needsRecount && row.openDivergence
                    ? `Divergencia ${formatDivergenceDelta(row.openDivergence.delta)}`
                    : row.countedToday
                      ? 'Ja contado hoje'
                      : 'Pendente hoje'}
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3 mb-6">
        <label className="flex flex-col gap-2 text-xs font-bold uppercase tracking-wider text-outline">
          Localizacao
          <select
            className="h-12 rounded-xl border border-outline-variant/20 bg-surface-container-low px-4 text-sm text-on-surface"
            value={focusLocation}
            onChange={event => setFocusLocation(event.target.value)}
          >
            <option value="all">Todas as localizacoes</option>
            {locationOptions.map(location => (
              <option key={location} value={location}>
                {location}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-2 text-xs font-bold uppercase tracking-wider text-outline">
          Tipo do veiculo
          <select
            className="h-12 rounded-xl border border-outline-variant/20 bg-surface-container-low px-4 text-sm text-on-surface"
            value={focusVehicleType}
            onChange={event => setFocusVehicleType(event.target.value)}
          >
            <option value="all">Todos os tipos</option>
            {vehicleTypeOptions.map(type => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-2 text-xs font-bold uppercase tracking-wider text-outline">
          Status do estoque
          <select
            className="h-12 rounded-xl border border-outline-variant/20 bg-surface-container-low px-4 text-sm text-on-surface"
            value={focusStatus}
            onChange={event => setFocusStatus(event.target.value as InventoryStatusFilter)}
          >
            <option value="all">Todos os status</option>
            <option value="critical">Estoque critico</option>
            <option value="reorder">Repor em breve</option>
            <option value="healthy">Estoque saudavel</option>
          </select>
        </label>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <OperationColumn
          title="Fila de contagem do dia"
          description="Comece pelos itens ainda nao conferidos no foco atual."
          emptyMessage="Nao ha pendencias neste recorte hoje."
          tone="default"
          rows={pendingQueue}
          actionLabel="Contar agora"
          onSelectSku={onSelectSku}
          renderMeta={row => (
            <>
              <span>{normalizeLocationText(row.item.location)}</span>
              <span>{formatVehicleType(row.item)}</span>
              <span>{normalizeUserFacingText(row.liveStatus)}</span>
            </>
          )}
        />

        <OperationColumn
          title="Recontagem prioritaria"
          description="Divergencias ficam abertas ate um ajuste de recontagem."
          emptyMessage="Nao ha divergencias abertas neste recorte."
          tone="warning"
          rows={recountQueue}
          actionLabel="Recontar"
          onSelectSku={onSelectSku}
          renderMeta={row => (
            <>
              <span>
                Diferenca {row.openDivergence ? formatDivergenceDelta(row.openDivergence.delta) : '0 un'}
              </span>
              <span>Detectada {row.openDivergence ? formatLogTime(row.openDivergence.date) : '--:--'}</span>
              {row.openDivergence?.referenceCode ? <span>{row.openDivergence.referenceCode}</span> : null}
            </>
          )}
        />

        <OperationColumn
          title="Ja contados hoje"
          description="Ultimos SKUs registrados hoje dentro do foco atual."
          emptyMessage="Ainda nao houve contagem para este recorte hoje."
          tone="success"
          rows={countedTodayRows}
          actionLabel="Abrir SKU"
          onSelectSku={onSelectSku}
          renderMeta={row => (
            <>
              <span>{row.latestLog ? formatLogTime(row.latestLog.date) : '--:--'}</span>
              <span>Saldo contado {row.latestLog?.quantityAfter ?? row.item.quantity}</span>
            </>
          )}
        />
      </div>
    </section>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  description,
  tone = 'default'
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  description: string;
  tone?: 'default' | 'warning';
}) {
  const toneClass =
    tone === 'warning'
      ? 'bg-amber-50 text-amber-800 border-amber-200'
      : 'bg-surface-container-low text-on-surface border-outline-variant/15';

  return (
    <div className={`rounded-xl border px-4 py-4 ${toneClass}`}>
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider">
        {icon}
        <span>{label}</span>
      </div>
      <p className="mt-3 text-2xl font-headline font-bold">{value}</p>
      <p className="mt-1 text-xs opacity-80">{description}</p>
    </div>
  );
}

function OperationColumn({
  title,
  description,
  emptyMessage,
  rows,
  actionLabel,
  onSelectSku,
  renderMeta,
  tone
}: {
  title: string;
  description: string;
  emptyMessage: string;
  rows: OperationRow[];
  actionLabel: string;
  onSelectSku: (sku: string) => void;
  renderMeta: (row: OperationRow) => React.ReactNode;
  tone: 'default' | 'warning' | 'success';
}) {
  const toneClass =
    tone === 'warning'
      ? 'border-amber-200 bg-amber-50/70'
      : tone === 'success'
        ? 'border-emerald-200 bg-emerald-50/60'
        : 'border-outline-variant/15 bg-surface-container-low';

  return (
    <div className={`rounded-2xl border p-4 ${toneClass}`}>
      <div className="mb-4">
        <h3 className="text-lg font-headline font-bold text-on-surface">{title}</h3>
        <p className="mt-1 text-xs text-on-surface-variant">{description}</p>
      </div>

      <div className="space-y-3">
        {rows.length > 0 ? (
          rows.map(row => (
            <button
              key={`${title}-${row.item.sku}`}
              type="button"
              onClick={() => onSelectSku(row.item.sku)}
              className="w-full rounded-xl border border-outline-variant/15 bg-surface-container-lowest px-4 py-3 text-left hover:border-primary/30 hover:bg-primary-container/10 transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-on-surface">{row.item.sku}</p>
                  <p className="mt-1 text-sm text-on-surface line-clamp-2">
                    {normalizeUserFacingText(row.item.name)}
                  </p>
                </div>
                <ArrowRight size={16} className="text-primary shrink-0 mt-1" />
              </div>

              <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-on-surface-variant">
                {renderMeta(row)}
              </div>

              {row.abcRecord && row.abcPolicy ? (
                <div className="mt-3 rounded-lg bg-primary-container/25 px-3 py-2 text-[11px] font-bold text-primary">
                  ABC {row.abcRecord.className} #{row.abcRecord.rank} | min {row.abcPolicy.minimumStock} | max{' '}
                  {row.abcPolicy.maximumStock}
                </div>
              ) : null}

              <div className="mt-3 text-xs font-bold text-primary">{actionLabel}</div>
            </button>
          ))
        ) : (
          <div className="rounded-xl bg-surface-container-lowest px-4 py-5 text-sm text-on-surface-variant">
            {emptyMessage}
          </div>
        )}
      </div>
    </div>
  );
}

function matchesInventoryStatusFilter(status: InventoryItem['status'], filter: InventoryStatusFilter) {
  if (filter === 'all') return true;

  const normalizedStatus = normalizeStatus(status);
  if (filter === 'critical') return normalizedStatus === 'critical';
  if (filter === 'reorder') return normalizedStatus === 'reorder';
  return normalizedStatus === 'healthy';
}

function normalizeStatus(status: string) {
  const normalized = normalizeUserFacingText(status)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

  if (normalized.includes('critico')) return 'critical';
  if (normalized.includes('repor')) return 'reorder';
  return 'healthy';
}

function getStatusPriority(status: string) {
  const normalized = normalizeStatus(status);
  if (normalized === 'critical') return 3;
  if (normalized === 'reorder') return 2;
  return 1;
}

function getEffectiveVehicleType(item: InventoryItem) {
  return normalizeOperationalVehicleType(item.vehicleType || getVehicleTypeFromModel(item.vehicleModel || '')) || 'Sem tipo';
}

function formatVehicleType(item: InventoryItem) {
  return getEffectiveVehicleType(item);
}

function isNoLocation(value: unknown) {
  const normalized = normalizeUserFacingText(normalizeLocationText(value))
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

  return normalized === 'sem localizacao';
}

function isSameCalendarDay(firstDate: string, secondDate: Date) {
  const first = new Date(firstDate);
  if (Number.isNaN(first.getTime())) return false;
  return getCalendarDateKey(first) === getCalendarDateKey(secondDate);
}

function getCalendarDateKey(value: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(value);
}

function formatLogTime(date: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: APP_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(date));
}

function isOperationalInventoryLog(log: InventoryLog) {
  if (log.source === 'ajuste' || log.source === 'divergencia') return true;
  if (log.source) return false;
  return !log.referenceCode;
}

interface OperationRow {
  item: InventoryItem;
  latestLog: InventoryLog | null;
  openDivergence: OpenDivergence | null;
  liveStatus: InventoryItem['status'];
  abcRecord: ReturnType<typeof getAbcAnalysisForSku>;
  abcPolicy: ReturnType<typeof getAdaptiveAbcStockPolicy>;
  absDelta: number;
  needsRecount: boolean;
  countedToday: boolean;
  priorityScore: number;
}

function getCalendarDayKey(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  return formatter.format(date);
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

function pickDailyCycleRows(rows: OperationRow[], count: number, seedKey: string) {
  if (count <= 0) return [];
  if (rows.length <= count) return rows.slice(0, count);

  const rng = mulberry32(hashToSeed(seedKey));
  const scored = rows.map(row => {
    const baseWeight = Math.max(1, Number(getAbcClassPriority(row.item.sku)) || 1);
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
