import React, { useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  ClipboardList,
  Download,
  PackageCheck,
  PackageSearch,
  ScanLine,
  ShoppingCart,
  TrendingUp,
  TriangleAlert,
  Truck,
  Upload
} from 'lucide-react';
import { readSheet } from 'read-excel-file/browser';
import { InventoryItem, InventorySettings, MaterialRequest, VehicleRecord } from '../types';
import { calculateItemStatus, getItemAlertSettings } from '../inventoryRules';
import { getRequestProgress } from '../requestUtils';
import { parseVehicleRows, readCsvRows } from '../vehicleBase';
import { normalizeLocationText, normalizeUserFacingText } from '../textUtils';

type AlertList = 'critical' | 'reorder';

interface DashboardProps {
  setActiveTab: (tab: string) => void;
  items: InventoryItem[];
  settings: InventorySettings;
  requests: MaterialRequest[];
  vehicles: VehicleRecord[];
  setVehicles: React.Dispatch<React.SetStateAction<VehicleRecord[]>>;
  showToast: (message: string, type?: 'success' | 'info') => void;
  onSelectSku: (sku: string) => void;
  onOpenSeparation: (requestId: string) => void;
  onOpenInventoryFilter: (filter: string) => void;
}

export default function Dashboard({
  setActiveTab,
  items,
  settings,
  requests,
  vehicles,
  setVehicles,
  showToast,
  onSelectSku,
  onOpenSeparation,
  onOpenInventoryFilter
}: DashboardProps) {
  const [activeAlertList, setActiveAlertList] = useState<AlertList>('critical');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const totalItems = items.length;
  const criticalItems = items.filter(item => calculateItemStatus(item, settings) === 'Estoque Crítico');
  const reorderItems = items.filter(item => calculateItemStatus(item, settings) === 'Repor em Breve');
  const listedItems = activeAlertList === 'critical' ? criticalItems : reorderItems;
  const openRequests = requests.filter(request => normalizeUserFacingText(request.status) !== 'Atendida');
  const separatingRequests = requests.filter(request => {
    const status = normalizeUserFacingText(request.status);
    return status === 'Em separação' || status === 'Separada';
  });

  const recentRequests = useMemo(
    () => [...requests].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()).slice(0, 4),
    [requests]
  );

  const handleVehicleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      showToast(`Lendo base de veículos: ${file.name}...`, 'info');
      const extension = file.name.split('.').pop()?.toLowerCase();
      let rows: unknown[][];

      if (extension === 'xlsx' || extension === 'xls') {
        rows = await readSheet(file);
      } else if (extension === 'csv') {
        rows = await readCsvRows(file);
      } else {
        showToast('Selecione um arquivo .xlsx ou .csv válido para a base de veículos.', 'info');
        return;
      }

      const importedVehicles = parseVehicleRows(rows);
      if (!importedVehicles.length) {
        showToast('Nenhum veículo válido foi encontrado no arquivo.', 'info');
        return;
      }

      setVehicles(importedVehicles);
      showToast(`Base de veículos importada com sucesso. ${importedVehicles.length} registros carregados.`, 'success');
    } catch {
      showToast('Não consegui ler a base de veículos. Confira se o arquivo tem placa e centro de custo.', 'info');
    } finally {
      event.target.value = '';
    }
  };

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <button
          type="button"
          onClick={() => onOpenInventoryFilter('')}
          className="md:col-span-2 xl:col-span-2 text-left bg-surface-container-lowest p-6 rounded-xl shadow-[0_8px_24px_rgba(36,52,69,0.08)] relative overflow-hidden group active:scale-[0.99] transition-all hover:bg-surface-container-lowest/80"
        >
          <div className="relative z-10">
            <p className="text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-2 font-label">
              Nível global de estoque (SKUs)
            </p>
            <h2 className="text-5xl md:text-6xl font-headline font-extrabold text-primary mb-2 tracking-tighter">
              {totalItems}
            </h2>
            <div className="flex items-center gap-2 text-primary-dim font-semibold text-sm">
              <TrendingUp size={16} />
              <span>Abrir inventário mestre</span>
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setActiveAlertList('critical')}
          className={`text-left bg-error-container/20 p-5 rounded-xl flex flex-col justify-between border transition-all active:scale-[0.98] min-h-40 ${
            activeAlertList === 'critical' ? 'border-error/40 ring-2 ring-error/15' : 'border-error-container/10 hover:border-error/30'
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

        <button
          type="button"
          onClick={() => setActiveTab('requests')}
          className="text-left bg-surface-container-high p-5 rounded-xl flex flex-col justify-between border border-transparent hover:border-primary/20 transition-all active:scale-[0.98] min-h-40"
        >
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
          <p className="text-xs text-on-surface-variant font-medium">Criar ou revisar pedidos</p>
        </button>
        <button
          onClick={() => setActiveTab('preventive-kits')}
          className="bg-surface-container-lowest text-primary p-4 rounded-xl flex items-center justify-center gap-3 active:scale-95 transition-all border border-outline-variant/20 shadow-sm hover:bg-surface-container-low"
        >
          <PackageCheck size={22} />
          <span className="font-headline font-bold text-base md:text-lg tracking-tight text-on-surface">Kit Preventivas</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 mb-8">
        <button
          onClick={() => setActiveTab('update')}
          className="bg-gradient-to-br from-primary to-primary-dim text-on-primary p-4 rounded-xl flex items-center justify-center gap-3 active:scale-95 transition-all shadow-lg"
        >
          <PackageSearch size={22} />
          <span className="font-headline font-bold text-base md:text-lg tracking-tight">Atualziar Estoque</span>
        </button>
        <button
          onClick={() => setActiveTab('requests')}
          className="bg-surface-container-lowest text-primary p-4 rounded-xl flex items-center justify-center gap-3 active:scale-95 transition-all border border-outline-variant/20 shadow-sm hover:bg-surface-container-low"
        >
          <ShoppingCart size={22} />
          <span className="font-headline font-bold text-base md:text-lg tracking-tight text-on-surface">Solicitação de Peças</span>
        </button>
        <button
          onClick={() => setActiveTab('separation')}
          className="bg-surface-container-lowest text-primary p-4 rounded-xl flex items-center justify-center gap-3 active:scale-95 transition-all border border-outline-variant/20 shadow-sm hover:bg-surface-container-low"
        >
          <ScanLine size={22} />
          <span className="font-headline font-bold text-base md:text-lg tracking-tight text-on-surface">Separação de Material</span>
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.15fr)_420px] gap-6">
        <div className="space-y-6">
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
                  onClick={() => setActiveAlertList('critical')}
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
                  onClick={() => setActiveAlertList('reorder')}
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
              {listedItems.length > 0 ? (
                listedItems.map(item => {
                  const itemStatus = calculateItemStatus(item, settings);
                  const itemSettings = getItemAlertSettings(item, settings);

                  return (
                    <button
                      key={item.sku}
                      type="button"
                      onClick={() => onSelectSku(item.sku)}
                      className="w-full text-left bg-surface-container-low p-3 rounded-xl flex items-center gap-3 group hover:bg-surface-container-high transition-colors active:scale-[0.99]"
                    >
                      <div className="w-10 h-10 bg-surface-container-lowest rounded-lg flex items-center justify-center shadow-sm shrink-0">
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
                      </div>
                      <div className="text-right shrink-0">
                        <p className={`text-sm font-bold ${itemStatus === 'Estoque Crítico' ? 'text-error' : 'text-primary'}`}>
                          {item.quantity} un
                        </p>
                        <p className="text-[10px] text-on-surface-variant uppercase font-medium">
                          limite {itemStatus === 'Estoque Crítico' ? itemSettings.criticalLimit : itemSettings.reorderLimit}
                        </p>
                      </div>
                      <ArrowRight className="text-outline group-hover:text-primary transition-colors shrink-0" size={20} />
                    </button>
                  );
                })
              ) : (
                <div className="bg-surface-container-low p-8 rounded-xl text-center text-on-surface-variant">
                  Nenhum item nesta lista no momento.
                </div>
              )}
            </div>
          </section>

          <section className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 shadow-sm p-5">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="font-headline font-bold text-xl md:text-2xl tracking-tight">Separações em andamento</h2>
                <p className="text-sm text-on-surface-variant">Pedidos já em operação para o time do estoque.</p>
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
                      onClick={() => onOpenSeparation(request.id)}
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
              <Truck size={18} className="text-primary" />
              <h2 className="font-headline font-bold text-xl tracking-tight">Painel da base de veículos</h2>
            </div>

            <p className="text-sm text-on-surface-variant">
              Importe a planilha com placa, centro de custo e demais características. Essa base alimenta a
              Solicitação de Peças automaticamente.
            </p>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-surface-container-low p-4">
                <p className="text-[11px] font-bold uppercase tracking-wider text-outline">Veículos</p>
                <p className="font-headline font-bold text-2xl text-on-surface mt-1">{vehicles.length}</p>
              </div>
              <div className="rounded-xl bg-surface-container-low p-4">
                <p className="text-[11px] font-bold uppercase tracking-wider text-outline">Centros de custo</p>
                <p className="font-headline font-bold text-2xl text-on-surface mt-1">
                  {new Set(vehicles.map(vehicle => vehicle.costCenter)).size}
                </p>
              </div>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={handleVehicleImport}
            />

            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="h-11 rounded-lg bg-primary text-on-primary font-bold flex items-center justify-center gap-2"
              >
                <Upload size={18} />
                Importar base de veículos
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('requests')}
                className="h-11 rounded-lg bg-surface-container-highest text-primary font-semibold flex items-center justify-center gap-2"
              >
                <Download size={18} />
                Abrir Solicitação de Peças
              </button>
            </div>

            <div className="mt-4 space-y-2">
              {vehicles.length > 0 ? (
                vehicles.slice(0, 4).map(vehicle => (
                  <div key={vehicle.id} className="rounded-lg bg-surface-container-low px-4 py-3">
                    <p className="font-semibold text-on-surface">{vehicle.plate}</p>
                    <p className="text-xs text-on-surface-variant">
                      {normalizeUserFacingText(vehicle.costCenter)}
                      {vehicle.description ? ` • ${normalizeUserFacingText(vehicle.description)}` : ''}
                    </p>
                  </div>
                ))
              ) : (
                <div className="rounded-lg bg-surface-container-low px-4 py-4 text-sm text-on-surface-variant">
                  Ainda não existe base de veículos importada.
                </div>
              )}
            </div>
          </section>

          <section className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-4">
              <Truck size={18} className="text-primary" />
              <h2 className="font-headline font-bold text-xl tracking-tight">Pe\u00e7as/Modelo</h2>
            </div>

            <p className="text-sm text-on-surface-variant mb-4">
              Abra a nova aba de navegacao por tipo e modelo para o cliente entrar primeiro no tipo do veiculo e depois no modelo.
            </p>

            <button
              type="button"
              onClick={() => setActiveTab('vehicle-parts')}
              className="w-full rounded-xl bg-surface-container-low px-4 py-5 text-left hover:bg-surface-container-high transition-colors"
            >
              <p className="text-xs font-bold uppercase tracking-wider text-outline">Nova aba</p>
              <p className="mt-1 text-lg font-headline font-bold text-on-surface">Entrar em Pe\u00e7as/Modelo</p>
              <p className="mt-2 text-sm text-on-surface-variant">
                Navegue por tipo, depois por modelo, e veja cada peca especifica daquele grupo.
              </p>
            </button>
          </section>

          <section className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-4">
              <ClipboardList size={18} className="text-primary" />
              <h2 className="font-headline font-bold text-xl tracking-tight">Últimas solicitações</h2>
            </div>

            <div className="space-y-3">
              {recentRequests.length > 0 ? (
                recentRequests.map(request => {
                  const progress = getRequestProgress(request);

                  return (
                    <button
                      key={request.id}
                      type="button"
                      onClick={() => onOpenSeparation(request.id)}
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
                        {progress.separated}/{progress.requested} unidades separadas
                      </p>
                    </button>
                  );
                })
              ) : (
                <div className="rounded-xl bg-surface-container-low p-8 text-center text-on-surface-variant">
                  Nenhuma solicitação registrada ainda.
                </div>
              )}
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}
