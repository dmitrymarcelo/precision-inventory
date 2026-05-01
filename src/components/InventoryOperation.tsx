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
import { InventoryItem, InventoryLog } from '../types';
import { getVehicleTypeFromModel, normalizeOperationalVehicleType } from '../vehicleCatalog';
import { normalizeLocationText, normalizeUserFacingText } from '../textUtils';

const APP_TIME_ZONE = 'America/Manaus';
const MAX_VISIBLE_OPERATION_ITEMS = 6;

interface InventoryOperationProps {
  items: InventoryItem[];
  logs: InventoryLog[];
  onSelectSku: (sku: string) => void;
  showToast: (message: string, type?: 'success' | 'info') => void;
}

type InventoryStatusFilter = 'all' | 'critical' | 'reorder' | 'healthy';

export default function InventoryOperation({
  items,
  logs,
  onSelectSku,
  showToast
}: InventoryOperationProps) {
  const [focusLocation, setFocusLocation] = useState('all');
  const [focusVehicleType, setFocusVehicleType] = useState('all');
  const [focusStatus, setFocusStatus] = useState<InventoryStatusFilter>('all');

  const activeItems = useMemo(() => items.filter(item => item.isActiveInWarehouse === true), [items]);

  const locationOptions = useMemo(
    () =>
      Array.from(new Set(activeItems.map(item => normalizeLocationText(item.location))))
        .sort((first, second) => first.localeCompare(second, 'pt-BR')),
    [activeItems]
  );

  const vehicleTypeOptions = useMemo(
    () =>
      Array.from(
        new Set(
          activeItems
            .map(item => getEffectiveVehicleType(item))
            .filter(Boolean)
        )
      ).sort((first, second) => first.localeCompare(second, 'pt-BR')),
    [activeItems]
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
      activeItems.filter(item => {
        const matchesLocation = focusLocation === 'all' || normalizeLocationText(item.location) === focusLocation;
        const matchesVehicleType =
          focusVehicleType === 'all' || getEffectiveVehicleType(item) === focusVehicleType;
        const matchesStatus = matchesInventoryStatusFilter(item, focusStatus);

        return matchesLocation && matchesVehicleType && matchesStatus;
      }),
    [activeItems, focusLocation, focusStatus, focusVehicleType]
  );

  const operationRows = useMemo(
    () =>
      filteredItems.map(item => {
        const latestLog = latestLogBySku.get(item.sku) || null;
        const absDelta = latestLog ? Math.abs(latestLog.delta) : 0;
        const needsRecount = latestLog?.source === 'divergencia';
        const priorityScore =
          getStatusPriority(item.status) * 1000 +
          (isNoLocation(item.location) ? 200 : 0) +
          absDelta * 10 +
          (item.quantity <= 0 ? 50 : 0);

        return {
          item,
          latestLog,
          absDelta,
          needsRecount,
          countedToday: Boolean(latestLog),
          priorityScore
        };
      }),
    [filteredItems, latestLogBySku]
  );

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

      <div className="grid gap-3 md:grid-cols-4 mb-5">
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
              <span>{normalizeUserFacingText(row.item.status)}</span>
            </>
          )}
        />

        <OperationColumn
          title="Recontagem prioritaria"
          description="Itens com divergencia de saldo pedem uma segunda conferencia."
          emptyMessage="Nao ha divergencias abertas neste recorte."
          tone="warning"
          rows={recountQueue}
          actionLabel="Recontar"
          onSelectSku={onSelectSku}
          renderMeta={row => (
            <>
              <span>
                Diferenca {row.latestLog && row.latestLog.delta > 0 ? '+' : ''}
                {row.latestLog?.delta ?? 0}
              </span>
              <span>Ultima contagem {row.latestLog ? formatLogTime(row.latestLog.date) : '--:--'}</span>
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

function matchesInventoryStatusFilter(item: InventoryItem, filter: InventoryStatusFilter) {
  if (filter === 'all') return true;

  const normalizedStatus = normalizeStatus(item.status);
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
  absDelta: number;
  needsRecount: boolean;
  countedToday: boolean;
  priorityScore: number;
}
