import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  ClipboardList,
  Droplets,
  PackageSearch,
  ShoppingCart,
  TrendingUp,
  TriangleAlert,
  X
} from 'lucide-react';
import { InventoryItem, InventoryLog, InventorySettings, MaterialRequest } from '../types';
import { calculateItemStatus, getItemAlertSettings } from '../inventoryRules';
import { getRequestProgress } from '../requestUtils';
import { normalizeLocationText, normalizeUserFacingText } from '../textUtils';
import { getVehicleTypeFromModel, normalizeOperationalVehicleType } from '../vehicleCatalog';
import { getAbcAnalysisForSku, getAbcSortRank, getAdaptiveAbcStockPolicy } from '../abcAnalysis';
import { ABC_ANALYSIS_UPDATED_AT } from '../abcAnalysisData';

type AlertList = 'critical' | 'reorder';
const ALERT_LIST_PREVIEW_LIMIT = 10;
const APP_TIME_ZONE = 'America/Manaus';

const fluidLevelDefinitions = [
  { sku: '66640', capacityLiters: 200, storageLabel: 'Tambor 200 L' },
  { sku: '17273', capacityLiters: 200, storageLabel: 'Tambor 200 L' },
  { sku: '53652', capacityLiters: 200, storageLabel: 'Tambor 200 L' },
  { sku: '55998', capacityLiters: 200, storageLabel: 'Tambor 200 L' },
  { sku: '60790', capacityLiters: 200, storageLabel: 'Tambor 200 L' },
  { sku: '81682', capacityLiters: 200, storageLabel: 'Tambor 200 L' },
  { sku: '06083', capacityLiters: 1000, storageLabel: 'ARLA32 1000 L' }
];

interface DashboardProps {
  items: InventoryItem[];
  logs: InventoryLog[];
  settings: InventorySettings;
  requests: MaterialRequest[];
  authRole: 'consulta' | 'operacao' | 'admin';
  onSelectSku: (sku: string) => void;
  onOpenSeparation: (requestId: string) => void;
  onOpenRequest: (requestId: string) => void;
  onOpenInventoryFilter: (filter: string) => void;
}

export default function Dashboard({
  items,
  logs,
  settings,
  requests,
  authRole,
  onSelectSku,
  onOpenSeparation,
  onOpenRequest,
  onOpenInventoryFilter
}: DashboardProps) {
  const [activeAlertList, setActiveAlertList] = useState<AlertList>('critical');
  const [isAlertListExpanded, setIsAlertListExpanded] = useState(false);
  const [reportSku, setReportSku] = useState<string | null>(null);
  const isConsulta = authRole === 'consulta';
  const getEffectiveVehicleType = (item: InventoryItem) =>
    normalizeOperationalVehicleType(item.vehicleType || getVehicleTypeFromModel(item.vehicleModel || ''));
  const openRequest = (requestId: string) => {
    if (isConsulta) {
      onOpenRequest(requestId);
      return;
    }
    onOpenSeparation(requestId);
  };

  const activeWarehouseItems = useMemo(() => items.filter(item => item.isActiveInWarehouse === true), [items]);
  const totalActiveItems = useMemo(
    () => items.filter(item => item.isActiveInWarehouse === true).length,
    [items]
  );
  const activeAbcItems = useMemo(
    () => activeWarehouseItems.filter(item => Boolean(getAbcAnalysisForSku(item.sku))),
    [activeWarehouseItems]
  );
  const activeAbcSummary = useMemo(() => {
    const summary = { A: 0, B: 0, C: 0 };
    activeAbcItems.forEach(item => {
      const record = getAbcAnalysisForSku(item.sku);
      if (record) summary[record.className] += 1;
    });
    return summary;
  }, [activeAbcItems]);
  const criticalItems = useMemo(
    () => activeWarehouseItems.filter(item => calculateItemStatus(item, settings, logs) === 'Estoque Crítico'),
    [activeWarehouseItems, logs, settings]
  );
  const reorderItems = useMemo(
    () => activeWarehouseItems.filter(item => calculateItemStatus(item, settings, logs) === 'Repor em Breve'),
    [activeWarehouseItems, logs, settings]
  );
  const reportItem = useMemo(
    () => (reportSku ? activeWarehouseItems.find(item => item.sku === reportSku) || null : null),
    [activeWarehouseItems, reportSku]
  );
  const listedItems = activeAlertList === 'critical' ? criticalItems : reorderItems;
  const sortedAlertItems = useMemo(() => {
    return [...listedItems].sort((first, second) => {
      const firstType = getEffectiveVehicleType(first) || 'Sem tipo';
      const secondType = getEffectiveVehicleType(second) || 'Sem tipo';
      const rankComparison = getAbcSortRank(first.sku) - getAbcSortRank(second.sku);
      if (rankComparison !== 0) return rankComparison;
      const typeComparison = firstType.localeCompare(secondType, 'pt-BR');
      if (typeComparison !== 0) return typeComparison;
      return normalizeUserFacingText(first.name).localeCompare(normalizeUserFacingText(second.name), 'pt-BR');
    });
  }, [listedItems]);
  const visibleAlertItems = isAlertListExpanded ? sortedAlertItems : sortedAlertItems.slice(0, ALERT_LIST_PREVIEW_LIMIT);
  const hiddenAlertItemsCount = Math.max(0, listedItems.length - visibleAlertItems.length);
  const visibleAlertGroups = useMemo(() => {
    const groups = new Map<string, InventoryItem[]>();
    visibleAlertItems.forEach(item => {
      const type = getEffectiveVehicleType(item) || 'Sem tipo';
      const current = groups.get(type);
      if (current) {
        current.push(item);
      } else {
        groups.set(type, [item]);
      }
    });

    return Array.from(groups.entries())
      .map(([type, groupedItems]) => ({
        type,
        items: groupedItems,
        rank: Math.min(...groupedItems.map(item => getAbcSortRank(item.sku)))
      }))
      .sort((first, second) => {
        const rankComparison = first.rank - second.rank;
        if (rankComparison !== 0) return rankComparison;
        return first.type.localeCompare(second.type, 'pt-BR');
      });
  }, [visibleAlertItems]);
  const openRequests = requests.filter(request => {
    if (request.deletedAt) return false;
    const status = normalizeUserFacingText(request.status);
    return status !== 'Atendida' && status !== 'Estornada';
  });
  const separatingRequests = requests.filter(request => {
    if (request.deletedAt) return false;
    const status = normalizeUserFacingText(request.status);
    return status === 'Em separação' || status === 'Separada';
  });

  const fluidLevels = useMemo(
    () =>
      fluidLevelDefinitions.map(definition => {
        const item = findItemBySku(items, definition.sku);
        const liters = Math.max(0, Number(item?.quantity || 0));
        const fillPercent = Math.max(0, Math.min(100, (liters / definition.capacityLiters) * 100));
        const percent = Math.min(100, Math.round(fillPercent));

        return {
          ...definition,
          item,
          liters,
          fillPercent,
          percent,
          equivalentContainers: liters / definition.capacityLiters,
          tone: getFluidLevelTone(percent)
        };
      }),
    [items]
  );
  const totalFluidLiters = fluidLevels.reduce((total, level) => total + level.liters, 0);
  const criticalFluidLevels = fluidLevels.filter(level => level.percent <= 30).length;

  const todayFulfilledRequests = useMemo(
    () =>
      [...requests]
        .filter(request => {
          if (request.deletedAt) return false;
          if (normalizeUserFacingText(request.status) !== 'Atendida') return false;
          return isSameOperationalDay(request.fulfilledAt || request.updatedAt, new Date());
        })
        .sort((a, b) => new Date(b.fulfilledAt || b.updatedAt).getTime() - new Date(a.fulfilledAt || a.updatedAt).getTime()),
    [requests]
  );
  const reportRecord = reportItem ? getAbcAnalysisForSku(reportItem.sku) : null;
  const reportPolicy = reportItem ? getAdaptiveAbcStockPolicy(reportItem.sku, logs) : null;
  const reportSettings = reportItem ? getItemAlertSettings(reportItem, settings, logs) : null;
  const reportStatus = reportItem ? calculateItemStatus(reportItem, settings, logs) : null;

  const handleAlertListChange = (list: AlertList) => {
    setActiveAlertList(list);
    setIsAlertListExpanded(false);
  };

  return (
    <>
      {!isConsulta && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <button
            type="button"
            onClick={() => handleAlertListChange('critical')}
            className={`text-left bg-error-container/20 p-5 rounded-xl flex flex-col justify-between border transition-all active:scale-[0.98] min-h-40 ${
              activeAlertList === 'critical'
                ? 'border-error/40 ring-2 ring-error/15'
                : 'border-error-container/10 hover:border-error/30'
            }`}
          >
            <div>
              <div className="flex items-center justify-between mb-4">
                <TriangleAlert className="text-error" size={24} />
                <span className="px-3 py-1 bg-error-container text-on-error-container text-[10px] font-bold rounded-full uppercase">
                  Prioridade
                </span>
              </div>
              <p className="text-sm font-semibold text-on-surface mb-1">Alertas críticos</p>
              <h3 className="text-2xl font-headline font-bold text-on-error-container">{criticalItems.length}</h3>
            </div>
            <p className="text-xs text-on-surface-variant font-medium">Ver lista crítica</p>
          </button>

          <div className="text-left bg-surface-container-high p-5 rounded-xl flex flex-col justify-between border border-transparent min-h-40">
            <div>
              <div className="flex items-center justify-between mb-4">
                <ShoppingCart className="text-primary" size={24} />
                <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-tighter">
                  Operação
                </span>
              </div>
              <p className="text-sm font-semibold text-on-surface mb-1">Solicitações abertas</p>
              <h3 className="text-2xl font-headline font-bold text-primary-dim">{openRequests.length}</h3>
            </div>
            <p className="text-xs text-on-surface-variant font-medium">Pedidos pendentes de atendimento</p>
          </div>
        </div>
      )}

      <section className="mb-8 overflow-hidden rounded-2xl border border-outline-variant/20 bg-surface-container-lowest shadow-sm">
        <div className="relative p-5 md:p-6 bg-gradient-to-br from-surface-container-lowest via-surface-container-low to-primary-container/35">
          <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-4">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full bg-primary-container px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-on-primary-container mb-3">
                <Droplets size={14} />
                Monitor de litros
              </div>
              <h2 className="font-headline text-2xl md:text-3xl font-extrabold tracking-tight text-on-surface">
                Tambores 200 L e ARLA32 1000 L
              </h2>
              <p className="mt-2 text-sm text-on-surface-variant">
                A proporcao usa o saldo atual do SKU em litros contra a capacidade do recipiente.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap xl:justify-end">
              <div className="rounded-xl bg-surface-container-lowest/80 px-4 py-3 border border-white/40">
                <p className="text-[10px] font-bold uppercase tracking-wider text-outline">Total monitorado</p>
                <p className="mt-1 text-2xl font-headline font-bold text-primary">{formatLiters(totalFluidLiters)}</p>
              </div>
              <div className="rounded-xl bg-surface-container-lowest/80 px-4 py-3 border border-white/40">
                <p className="text-[10px] font-bold uppercase tracking-wider text-outline">Ate 30%</p>
                <p className={`mt-1 text-2xl font-headline font-bold ${criticalFluidLevels > 0 ? 'text-error' : 'text-primary'}`}>
                  {criticalFluidLevels}
                </p>
              </div>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7 gap-4">
            {fluidLevels.map(level => (
              <div
                key={level.sku}
                className="group rounded-2xl bg-surface-container-lowest/90 border border-outline-variant/20 p-4 text-left shadow-sm"
                role={!isConsulta ? 'button' : undefined}
                tabIndex={!isConsulta ? 0 : undefined}
                onClick={
                  !isConsulta
                    ? () => {
                        onSelectSku(level.item?.sku || level.sku);
                      }
                    : undefined
                }
                onKeyDown={
                  !isConsulta
                    ? event => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          onSelectSku(level.item?.sku || level.sku);
                        }
                      }
                    : undefined
                }
              >
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-outline">SKU {level.sku}</p>
                    <h3 className="mt-1 text-sm font-bold text-on-surface line-clamp-2 min-h-10">
                      {level.item ? normalizeUserFacingText(level.item.name) : 'Item nao encontrado'}
                    </h3>
                  </div>
                  <span
                    className="shrink-0 rounded-full px-2 py-1 text-[10px] font-bold text-white shadow-sm"
                    style={{ backgroundColor: level.tone.badge }}
                  >
                    {level.percent}%
                  </span>
                </div>

                <div className="flex items-end justify-center gap-4">
                  <div className="relative h-52 w-14 rounded-full bg-slate-200 p-1 shadow-inner border border-slate-300/70 overflow-hidden">
                    <div className="absolute inset-x-2 top-7 bottom-7 rounded-full bg-white/60" />
                    <div
                      className="absolute inset-x-1 bottom-1 rounded-b-full rounded-t-md transition-all duration-500"
                      style={{
                        height: `${level.fillPercent}%`,
                        minHeight: level.liters > 0 ? 14 : 0,
                        background: level.tone.fill
                      }}
                    />
                    <div className="absolute inset-x-0 top-[18%] border-t border-white/60" />
                    <div className="absolute inset-x-0 top-[38%] border-t border-white/60" />
                    <div className="absolute inset-x-0 top-[58%] border-t border-white/60" />
                    <div className="absolute inset-x-0 top-[78%] border-t border-white/60" />
                    <div className="absolute inset-0 flex flex-col justify-between py-7 text-[8px] font-black uppercase tracking-tight text-white/80 text-center pointer-events-none">
                      <span>Max</span>
                      <span>High</span>
                      <span>Med</span>
                      <span>Low</span>
                      <span>No</span>
                    </div>
                  </div>

                  <div className="min-w-0 pb-1">
                    <p className="text-2xl font-headline font-extrabold text-on-surface">{formatLiters(level.liters)}</p>
                    <p className="text-xs font-semibold text-on-surface-variant mt-1">{level.storageLabel}</p>
                    <p className="text-[11px] text-on-surface-variant mt-2">
                      {level.equivalentContainers.toLocaleString('pt-BR', {
                        minimumFractionDigits: 1,
                        maximumFractionDigits: 1
                      })}{' '}
                      recipiente(s)
                    </p>
                    {!level.item && (
                      <p className="mt-2 rounded-lg bg-error-container/40 px-2 py-1 text-[10px] font-bold text-on-error-container">
                        Sem saldo na base
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.15fr)_420px] gap-6">
        <div className="space-y-6">
          {!isConsulta && (
            <section className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 shadow-sm p-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                <div>
                  <h2 className="font-headline font-bold text-xl md:text-2xl tracking-tight">
                    {activeAlertList === 'critical' ? 'Alertas críticos' : 'Repor em breve'}
                  </h2>
                  <p className="text-sm text-on-surface-variant">
                    Clique em um item para ajustar quantidade, localização e regra de alerta.
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleAlertListChange('critical')}
                    className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors ${
                      activeAlertList === 'critical'
                        ? 'bg-error-container text-on-error-container'
                        : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high'
                    }`}
                  >
                    Críticos
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAlertListChange('reorder')}
                    className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors ${
                      activeAlertList === 'reorder'
                        ? 'bg-primary-container text-on-primary-container'
                        : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high'
                    }`}
                  >
                    Repor
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                {visibleAlertItems.length > 0 ? (
                  visibleAlertGroups.map(group => (
                    <div key={group.type} className="rounded-xl bg-surface-container-low p-3">
                      <div className="flex items-center justify-between gap-3 mb-3 px-1">
                        <p className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                          {group.type}
                        </p>
                        <span className="text-[11px] font-bold text-on-surface-variant">{group.items.length}</span>
                      </div>
                      <div className="space-y-2">
                        {group.items.map(item => {
                          const itemStatus = calculateItemStatus(item, settings, logs);
                          const itemSettings = getItemAlertSettings(item, settings, logs);
                          const abcRecord = getAbcAnalysisForSku(item.sku);
                          const abcPolicy = getAdaptiveAbcStockPolicy(item.sku, logs);

                          return (
                            <button
                              key={item.sku}
                              type="button"
                              onClick={() => setReportSku(item.sku)}
                              className="w-full text-left bg-surface-container-lowest p-3 rounded-xl flex items-center gap-3 group hover:bg-surface-container-high transition-colors active:scale-[0.99]"
                            >
                              <div className="w-10 h-10 bg-surface-container-low rounded-lg flex items-center justify-center shadow-sm shrink-0">
                                {itemStatus === 'Estoque Crítico' ? (
                                  <TriangleAlert className="text-error" size={20} />
                                ) : (
                                  <PackageSearch className="text-primary" size={20} />
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-bold text-on-surface truncate">{normalizeUserFacingText(item.name)}</p>
                                <p className="text-xs text-on-surface-variant truncate">
                                  SKU {item.sku} • {normalizeLocationText(item.location)}
                                </p>
                                {abcRecord && abcPolicy ? (
                                  <p className="mt-1 text-[11px] font-bold text-primary">
                                    ABC {abcRecord.className} #{abcRecord.rank} | min {abcPolicy.minimumStock} | max{' '}
                                    {abcPolicy.maximumStock}
                                  </p>
                                ) : null}
                              </div>
                              <div className="text-right shrink-0">
                                <p
                                  className={`text-sm font-bold ${
                                    itemStatus === 'Estoque Crítico' ? 'text-error' : 'text-primary'
                                  }`}
                                >
                                  {item.quantity} un
                                </p>
                                <p className="text-[10px] text-on-surface-variant uppercase font-medium">
                                  limite {itemStatus === 'Estoque Crítico' ? itemSettings.criticalLimit : itemSettings.reorderLimit}
                                </p>
                              </div>
                              <ArrowRight className="text-outline group-hover:text-primary transition-colors shrink-0" size={20} />
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="bg-surface-container-low p-8 rounded-xl text-center text-on-surface-variant">
                    Nenhum item nesta lista no momento.
                  </div>
                )}
                {hiddenAlertItemsCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setIsAlertListExpanded(true)}
                    className="w-full rounded-xl border border-dashed border-primary/30 bg-primary-container/20 px-4 py-3 text-sm font-bold text-primary hover:bg-primary-container/35 transition-colors"
                  >
                    Aparecer mais {hiddenAlertItemsCount} item(ns)
                  </button>
                )}
              </div>
            </section>
          )}

          <section className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 shadow-sm p-5">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="font-headline font-bold text-xl md:text-2xl tracking-tight">Separações em andamento</h2>
                <p className="text-sm text-on-surface-variant">
                  Pedidos com separação iniciada ou já separada, aguardando atendimento final.
                </p>
              </div>
              <span className="inline-flex items-center rounded-full bg-secondary-container px-3 py-1 text-[11px] font-bold text-on-secondary-container">
                {separatingRequests.length} ativas
              </span>
            </div>

            <div className="space-y-3">
              {separatingRequests.length > 0 ? (
                separatingRequests.slice(0, 4).map(request => {
                  const progress = getRequestProgress(request);

                  return (
                    <button
                      key={request.id}
                      type="button"
                      onClick={() => openRequest(request.id)}
                      className="w-full text-left rounded-xl bg-surface-container-low p-4 hover:bg-surface-container-high transition-colors"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-on-surface">{request.code}</p>
                          <p className="text-xs text-on-surface-variant mt-1 truncate">
                          {request.vehiclePlate || 'Sem placa'} • {request.costCenter || 'Sem centro de custo'}
                          </p>
                        </div>
                        <span className="text-xs font-bold text-primary">{progress.percent}%</span>
                      </div>
                      <div className="mt-3 h-2 rounded-full bg-surface-container-high overflow-hidden">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${progress.percent}%` }} />
                      </div>
                    </button>
                  );
                })
              ) : (
                <div className="rounded-xl bg-surface-container-low p-8 text-center text-on-surface-variant">
                  Ainda não temos separações em andamento.
                </div>
              )}
            </div>
          </section>
        </div>

        <aside className="space-y-6">
          <section className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-4">
              <ClipboardList size={18} className="text-primary" />
              <h2 className="font-headline font-bold text-xl tracking-tight">Solicitações atendidas hoje</h2>
            </div>

            <div className="rounded-xl bg-primary-container/35 border border-primary/10 p-5 mb-4">
              <p className="text-xs font-bold uppercase tracking-widest text-primary">Total do dia</p>
              <div className="mt-2 flex items-end justify-between gap-4">
                <strong className="font-headline text-5xl font-extrabold text-primary">
                  {todayFulfilledRequests.length}
                </strong>
                <span className="text-sm font-semibold text-on-surface-variant text-right">
                  solicitações atendidas
                </span>
              </div>
            </div>

            <div className="space-y-3">
              {todayFulfilledRequests.length > 0 ? (
                todayFulfilledRequests.slice(0, 4).map(request => {
                  const progress = getRequestProgress(request);

                  return (
                    <button
                      key={request.id}
                      type="button"
                      onClick={() => openRequest(request.id)}
                      className="w-full text-left rounded-xl bg-surface-container-low p-4 hover:bg-surface-container-high transition-colors"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-on-surface">{request.code}</p>
                          <p className="text-xs text-on-surface-variant mt-1 truncate">
                            {normalizeUserFacingText(request.vehiclePlate) || 'Sem placa'} • {normalizeUserFacingText(request.costCenter) || 'Sem centro de custo'}
                          </p>
                        </div>
                        <span className="text-xs font-bold text-on-surface-variant">{normalizeUserFacingText(request.status)}</span>
                      </div>
                      <p className="text-xs text-on-surface-variant mt-3">
                        {progress.separated}/{progress.requested} unidades separadas • {formatOperationalTime(request.fulfilledAt || request.updatedAt)}
                      </p>
                    </button>
                  );
                })
              ) : (
                <div className="rounded-xl bg-surface-container-low p-8 text-center text-on-surface-variant">
                  Nenhuma solicitação atendida hoje.
                </div>
              )}
            </div>
          </section>
        </aside>
      </div>

      {reportItem && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/50 p-3 sm:p-6">
          <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-2xl bg-surface-container-lowest shadow-2xl border border-outline-variant/20">
            <div className="sticky top-0 z-10 bg-surface-container-lowest border-b border-outline-variant/15 p-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-primary">Relatorio rapido ABC</p>
                <h3 className="mt-1 text-xl font-headline font-extrabold text-on-surface">
                  SKU {reportItem.sku}
                </h3>
                <p className="mt-1 text-sm text-on-surface-variant line-clamp-2">
                  {normalizeUserFacingText(reportItem.name)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReportSku(null)}
                className="h-10 w-10 rounded-xl bg-surface-container-low text-on-surface-variant flex items-center justify-center"
                aria-label="Fechar relatorio"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-4 sm:p-5 space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <ReportMetric label="Status atual" value={normalizeUserFacingText(reportStatus || reportItem.status)} />
                <ReportMetric label="Saldo atual" value={`${reportItem.quantity} un`} />
                <ReportMetric
                  label="Limites usados"
                  value={`min ${reportSettings?.criticalLimit ?? 0} / max ${reportSettings?.reorderLimit ?? 0}`}
                />
              </div>

              {reportRecord && reportPolicy ? (
                <div className="rounded-2xl bg-primary-container/25 border border-primary/10 p-4">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-widest text-primary">
                        Curva ABC {reportRecord.className} | rank #{reportRecord.rank}
                      </p>
                      <p className="mt-1 text-sm text-on-surface-variant">
                        O rank vem da analise tratada de consumo/solicitacao. Quanto menor o rank, maior a prioridade.
                      </p>
                    </div>
                    <div className="rounded-xl bg-surface-container-lowest px-4 py-3 text-right">
                      <p className="text-[10px] font-bold uppercase text-outline">Demanda media</p>
                      <p className="text-xl font-headline font-extrabold text-primary">
                        {formatNumber(reportPolicy.averageMonthlyDemand)} un/mes
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <ReportMetric
                      label="Base da curva"
                      value={`${formatNumber(reportPolicy.baseAverageMonthlyDemand)} un/mes`}
                    />
                    <ReportMetric
                      label="Saidas recentes"
                      value={`${formatNumber(reportPolicy.recentOutflowQuantity)} un em 120 dias`}
                    />
                    <ReportMetric
                      label="Entradas recentes"
                      value={`${formatNumber(reportPolicy.recentInflowQuantity)} un em 120 dias`}
                    />
                    <ReportMetric
                      label="Fonte do calculo"
                      value={formatDemandSource(reportPolicy.demandSource)}
                    />
                  </div>

                  <p className="mt-4 rounded-xl bg-surface-container-lowest px-4 py-3 text-sm text-on-surface-variant">
                    Este SKU esta em alerta porque o saldo atual ({reportItem.quantity}) esta igual ou abaixo do limite
                    calculado para a classe ABC dele. Para esta classe, o sistema transforma a demanda media em minimo
                    e maximo automaticos: minimo {reportPolicy.minimumStock} e maximo {reportPolicy.maximumStock}.
                  </p>
                </div>
              ) : (
                <div className="rounded-2xl bg-surface-container-low border border-outline-variant/15 p-4">
                  <p className="text-sm font-bold text-on-surface">SKU sem registro na Curva ABC tratada.</p>
                  <p className="mt-1 text-sm text-on-surface-variant">
                    Neste caso o alerta usa os limites manuais ou o padrao geral do sistema.
                  </p>
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const sku = reportItem.sku;
                    setReportSku(null);
                    onSelectSku(sku);
                  }}
                  className="h-11 flex-1 rounded-xl bg-primary text-on-primary font-bold"
                >
                  Abrir no Estoque
                </button>
                <button
                  type="button"
                  onClick={() => setReportSku(null)}
                  className="h-11 flex-1 rounded-xl bg-surface-container-high text-on-surface font-bold"
                >
                  Fechar relatorio
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function findItemBySku(items: InventoryItem[], sku: string) {
  const candidates = getSkuCandidates(sku);
  return items.find(item => candidates.has(String(item.sku).trim()));
}

function isSameOperationalDay(value: string | undefined, referenceDate: Date) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return formatOperationalDate(date) === formatOperationalDate(referenceDate);
}

function formatOperationalDate(date: Date) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function formatOperationalTime(value: string | undefined) {
  if (!value) return 'sem hora';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'sem hora';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: APP_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function getSkuCandidates(sku: string) {
  const text = String(sku).trim();
  const digits = text.replace(/\D/g, '');
  const candidates = new Set<string>([text]);

  if (digits) {
    candidates.add(digits);
    candidates.add(digits.padStart(5, '0'));
  }

  return candidates;
}

function ReportMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface-container-low px-4 py-3 border border-outline-variant/15">
      <p className="text-[10px] font-bold uppercase tracking-wider text-outline">{label}</p>
      <p className="mt-1 text-sm font-extrabold text-on-surface">{value}</p>
    </div>
  );
}

function formatNumber(value: number) {
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: value % 1 === 0 ? 0 : 1,
    maximumFractionDigits: 1
  });
}

function formatDemandSource(value: string) {
  if (value === 'curva-abc-e-movimentacao') return 'Curva ABC + movimentacao recente';
  if (value === 'movimentacao') return 'Movimentacao recente';
  return 'Curva ABC tratada';
}

function getFluidLevelTone(percent: number) {
  if (percent <= 15) {
    return {
      badge: '#dc2626',
      fill: 'linear-gradient(180deg, #ef4444 0%, #dc2626 100%)'
    };
  }

  if (percent <= 30) {
    return {
      badge: '#f97316',
      fill: 'linear-gradient(180deg, #fb923c 0%, #ea580c 100%)'
    };
  }

  if (percent <= 60) {
    return {
      badge: '#eab308',
      fill: 'linear-gradient(180deg, #fde047 0%, #f59e0b 100%)'
    };
  }

  return {
    badge: '#22c55e',
    fill: 'linear-gradient(180deg, #84cc16 0%, #22c55e 50%, #16a34a 100%)'
  };
}

function formatLiters(value: number) {
  return `${value.toLocaleString('pt-BR', {
    maximumFractionDigits: 0
  })} L`;
}

function formatShortDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString('pt-BR', {
    timeZone: APP_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
}

