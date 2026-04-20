import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  Eye,
  LoaderCircle,
  Lock,
  PackagePlus,
  PanelTop,
  Pencil,
  Plus,
  Search,
  Send,
  Trash2,
  Truck
} from 'lucide-react';
import { InventoryItem, MaterialRequest, VehicleRecord } from '../types';
import {
  createEmptyRequest,
  createRequestItem,
  getRequestProgress,
  materialRequestNeedsStockAttention,
  recalculateRequestStatus,
  updateRequestItemQuantity,
  upsertRequestState
} from '../requestUtils';
import { getVehicleTypeFromModel } from '../vehicleCatalog';
import { findVehicleByPlate, normalizePlate } from '../vehicleBase';
import { normalizeLocationText, normalizeUserFacingText } from '../textUtils';

interface RequestManagerProps {
  items: InventoryItem[];
  requests: MaterialRequest[];
  vehicles: VehicleRecord[];
  setRequests: React.Dispatch<React.SetStateAction<MaterialRequest[]>>;
  showToast: (message: string, type?: 'success' | 'info') => void;
  onOpenSeparation: (requestId: string) => void;
  onSelectSku: (sku: string) => void;
  onOpenPanel: () => void;
}

export default function RequestManager({
  items,
  requests,
  vehicles,
  setRequests,
  showToast,
  onOpenSeparation,
  onSelectSku,
  onOpenPanel
}: RequestManagerProps) {
  const getEffectiveVehicleType = (item: InventoryItem) =>
    normalizeUserFacingText(item.vehicleType || getVehicleTypeFromModel(item.vehicleModel || ''));

  const [draft, setDraft] = useState<MaterialRequest>(createEmptyRequest());
  const [editingRequestId, setEditingRequestId] = useState<string | null>(null);
  const [itemQuery, setItemQuery] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const matchedVehicle = useMemo(
    () => findVehicleByPlate(vehicles, draft.vehiclePlate),
    [vehicles, draft.vehiclePlate]
  );

  const stockBySku = useMemo(() => new Map(items.map(item => [item.sku, item.quantity])), [items]);

  const filteredItems = useMemo(() => {
    const query = itemQuery.trim().toLowerCase();
    if (!query) return [];

    return items
      .filter(item =>
        item.sku.toLowerCase().includes(query) ||
        normalizeUserFacingText(item.name).toLowerCase().includes(query) ||
        normalizeUserFacingText(item.vehicleModel).toLowerCase().includes(query) ||
        getEffectiveVehicleType(item).toLowerCase().includes(query) ||
        normalizeLocationText(item.location).toLowerCase().includes(query) ||
        item.category.toLowerCase().includes(query)
      )
      .slice(0, 8);
  }, [items, itemQuery]);

  const recentRequests = useMemo(
    () => [...requests].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [requests]
  );

  const draftProgress = getRequestProgress(draft);
  const persistedEditingRequest = editingRequestId
    ? requests.find(request => request.id === editingRequestId) || null
    : null;
  const isDraftReadOnly = persistedEditingRequest ? isRequestLocked(persistedEditingRequest.status) : false;
  const canMutateDraft = !persistedEditingRequest || canEditRequest(persistedEditingRequest.status);

  const startNewRequest = () => {
    setDraft(createEmptyRequest());
    setEditingRequestId(null);
    setItemQuery('');
  };

  const loadRequest = (request: MaterialRequest) => {
    setEditingRequestId(request.id);
    setDraft({
      ...request,
      items: request.items.map(item => ({ ...item }))
    });
    setItemQuery('');
  };

  const saveDraft = async (openSeparationAfterSave = false) => {
    if (!canMutateDraft) {
      showToast('Esta solicitação já foi fechada e está disponível somente para consulta.', 'info');
      return null;
    }

    if (!draft.vehiclePlate.trim()) {
      showToast('Informe a placa do veículo para abrir a solicitação.', 'info');
      return null;
    }

    const costCenter = matchedVehicle?.costCenter || draft.costCenter.trim();
    if (!costCenter) {
      showToast('Informe ou importe o centro de custo vinculado à placa.', 'info');
      return null;
    }

    if (!draft.items.length) {
      showToast('Adicione pelo menos um item antes de salvar.', 'info');
      return null;
    }

    const nextDraft = upsertRequestState(
      {
        ...draft,
        vehiclePlate: normalizePlate(draft.vehiclePlate),
        costCenter,
        vehicleDescription: matchedVehicle?.description || draft.vehicleDescription || '',
        vehicleDetails: matchedVehicle?.details || draft.vehicleDetails || {},
        requester: normalizePlate(draft.vehiclePlate),
        destination: costCenter
      },
      requests.filter(request => request.id !== draft.id)
    );
    nextDraft.status = recalculateRequestStatus(nextDraft);

    setIsSaving(true);

    try {
      setRequests(previous => {
        const others = previous.filter(request => request.id !== nextDraft.id);
        return [nextDraft, ...others].sort(
          (first, second) => new Date(second.updatedAt).getTime() - new Date(first.updatedAt).getTime()
        );
      });

      setDraft(nextDraft);
      setEditingRequestId(nextDraft.id);
      showToast(`Solicitação ${nextDraft.code} salva com sucesso.`, 'success');

      if (openSeparationAfterSave) {
        onOpenSeparation(nextDraft.id);
      }

      return nextDraft;
    } finally {
      setIsSaving(false);
    }
  };

  const addItemToDraft = (item: InventoryItem) => {
    if (!canMutateDraft) {
      showToast('Esta solicitação está bloqueada para edição.', 'info');
      return;
    }

    if (item.quantity <= 0) {
      showToast(`O item ${item.sku} está sem saldo e não pode entrar na solicitação.`, 'info');
      return;
    }

    const alreadyAdded = draft.items.some(requestItem => requestItem.sku === item.sku);
    if (alreadyAdded) {
      showToast(`O item ${item.sku} já está nesta solicitação.`, 'info');
      return;
    }

    setDraft(current => ({
      ...current,
      items: [...current.items, createRequestItem(item)],
      updatedAt: new Date().toISOString()
    }));
    setItemQuery('');
  };

  const removeItemFromDraft = (itemId: string) => {
    if (!canMutateDraft) {
      showToast('Esta solicitação está bloqueada para edição.', 'info');
      return;
    }

    setDraft(current => ({
      ...current,
      items: current.items.filter(item => item.id !== itemId),
      updatedAt: new Date().toISOString()
    }));
  };

  const deleteRequest = (request: MaterialRequest) => {
    if (!canEditRequest(request.status)) {
      showToast('Pedidos já entregues ficam bloqueados e seguem apenas para consulta.', 'info');
      return;
    }

    const confirmed = window.confirm(`Excluir a solicitação ${request.code}? Essa ação remove o pedido da fila atual.`);
    if (!confirmed) return;

    setRequests(previous => previous.filter(entry => entry.id !== request.id));
    if (editingRequestId === request.id) {
      startNewRequest();
    }
    showToast(`Solicitação ${request.code} excluída.`, 'success');
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.2fr)_420px] gap-6">
      <section className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 shadow-sm p-5 md:p-6">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6">
          <div>
            <span className="text-primary font-label text-[11px] font-semibold uppercase tracking-wider">
              Solicitação de peças
            </span>
            <h2 className="text-2xl md:text-3xl font-extrabold text-on-surface font-headline tracking-tight mt-1">
              Abra a solicitação pela placa do veículo
            </h2>
            <p className="text-sm text-on-surface-variant mt-2 max-w-2xl">
              A placa chama o centro de custo e os dados do veículo automaticamente. Depois você só adiciona
              os itens e envia para separação.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <button
              type="button"
              onClick={onOpenPanel}
              className="h-11 px-4 rounded-lg bg-surface-container-highest text-primary font-semibold flex items-center gap-2"
            >
              <PanelTop size={18} />
              Painel
            </button>
            <button
              type="button"
              onClick={startNewRequest}
              className="h-11 px-4 rounded-lg bg-surface-container-highest text-primary font-semibold flex items-center gap-2"
            >
              <PackagePlus size={18} />
              Nova solicitação
            </button>
          </div>
        </div>

        {persistedEditingRequest && isDraftReadOnly && (
          <div className="mb-5 rounded-xl border border-outline-variant/20 bg-surface-container-low px-4 py-4 flex items-start gap-3">
            <Lock size={18} className="text-primary shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-on-surface">Solicitação em modo consulta</p>
              <p className="text-sm text-on-surface-variant mt-1">
                Este pedido já foi entregue. Ele fica bloqueado para edição e exclusão, mantendo apenas o histórico para consultas futuras.
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="flex flex-col gap-2 text-sm font-semibold text-on-surface">
            Placa do veículo
            <input
              className="h-12 rounded-lg border border-outline-variant/20 bg-surface-container-lowest px-4 text-sm text-on-surface focus:ring-2 focus:ring-primary/30"
              value={draft.vehiclePlate}
              disabled={isDraftReadOnly}
              onChange={event =>
                setDraft(current => ({
                  ...current,
                  vehiclePlate: normalizePlate(event.target.value)
                }))
              }
              placeholder="Ex.: QWE1A23"
            />
          </label>

          <label className="flex flex-col gap-2 text-sm font-semibold text-on-surface">
            Centro de custo
            <input
              className="h-12 rounded-lg border border-outline-variant/20 bg-surface-container-lowest px-4 text-sm text-on-surface focus:ring-2 focus:ring-primary/30"
              value={matchedVehicle?.costCenter || draft.costCenter}
              disabled={isDraftReadOnly}
              onChange={event =>
                setDraft(current => ({
                  ...current,
                  costCenter: event.target.value
                }))
              }
              placeholder="Centro de custo vinculado à placa"
            />
          </label>
        </div>

        <div className="mt-4 rounded-xl bg-surface-container-low border border-outline-variant/15 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Truck size={18} className="text-primary" />
            <h3 className="font-headline font-bold text-lg text-on-surface">Dados do veículo</h3>
          </div>

          {matchedVehicle ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <VehicleInfoCard label="Placa confirmada" value={matchedVehicle.plate} />
              <VehicleInfoCard label="Centro de custo" value={normalizeUserFacingText(matchedVehicle.costCenter)} />

              {matchedVehicle.description ? (
                <div className="md:col-span-2">
                  <VehicleInfoCard label="Descrição" value={normalizeUserFacingText(matchedVehicle.description)} />
                </div>
              ) : null}

              {Object.entries(matchedVehicle.details).slice(0, 6).map(([label, value]) => (
                <VehicleInfoCard key={label} label={label} value={normalizeUserFacingText(value)} />
              ))}
            </div>
          ) : (
            <div className="rounded-lg bg-surface-container-lowest px-4 py-4 text-sm text-on-surface-variant">
              Digite a placa para buscar o centro de custo na base de veículos. Se ainda não existir base importada,
              clique em <strong>Painel</strong> e carregue a planilha.
            </div>
          )}
        </div>

        <div className="mt-6 bg-surface-container-low rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Search size={18} className="text-primary" />
            <h3 className="font-headline font-bold text-lg text-on-surface">Adicionar itens</h3>
          </div>

          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-outline" size={18} />
            <input
              className="w-full h-12 rounded-lg bg-surface-container-lowest pl-11 pr-4 border border-outline-variant/20 text-sm focus:ring-2 focus:ring-primary/30"
              value={itemQuery}
              disabled={isDraftReadOnly}
              onChange={event => setItemQuery(event.target.value)}
              placeholder="Busque por SKU, nome, categoria ou localização"
            />
          </div>

          {filteredItems.length > 0 && !isDraftReadOnly && (
            <div className="mt-3 grid gap-2">
              {filteredItems.map(item => {
                const hasStock = item.quantity > 0;

                return (
                  <button
                    key={item.sku}
                    type="button"
                    onClick={() => addItemToDraft(item)}
                    disabled={!hasStock}
                    className={`w-full rounded-lg border px-4 py-3 text-left transition-colors ${
                      hasStock
                        ? 'bg-surface-container-lowest border-outline-variant/15 hover:border-primary/25 hover:bg-primary-container/15'
                        : 'bg-error-container/15 border-error/25 text-on-surface-variant cursor-not-allowed opacity-90'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-sm text-on-surface truncate">{normalizeUserFacingText(item.name)}</p>
                        <p className="text-xs text-on-surface-variant truncate">
                          SKU {item.sku} • {normalizeLocationText(item.location)} • saldo {item.quantity}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 inline-flex items-center gap-1 font-semibold text-sm ${
                          hasStock ? 'text-primary' : 'text-error'
                        }`}
                      >
                        <Plus size={16} />
                        {hasStock ? 'Adicionar' : 'Sem saldo'}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-6">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <h3 className="font-headline font-bold text-lg text-on-surface">Itens desta solicitação</h3>
              <p className="text-xs text-on-surface-variant">
                {draft.items.length} itens • {draftProgress.requested} unidades solicitadas
              </p>
            </div>
            {editingRequestId && draft.code && (
              <span className="text-xs font-bold uppercase tracking-wider text-primary bg-primary-container px-3 py-1 rounded-full">
                {draft.code}
              </span>
            )}
          </div>

          {draft.items.length > 0 ? (
            <div className="space-y-3">
              {draft.items.map(requestItem => {
                const availableQuantity = stockBySku.get(requestItem.sku) ?? 0;

                return (
                  <div
                    key={requestItem.id}
                    className="rounded-xl border border-outline-variant/15 bg-surface-container-low p-4"
                  >
                    <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
                      <div className="min-w-0">
                        <button
                          type="button"
                          onClick={() => onSelectSku(requestItem.sku)}
                          className="text-left font-semibold text-on-surface hover:text-primary transition-colors"
                        >
                          {normalizeUserFacingText(requestItem.itemName)}
                        </button>
                        <p className="text-xs text-on-surface-variant mt-1">
                          SKU {requestItem.sku} • {normalizeLocationText(requestItem.location)} • {normalizeUserFacingText(requestItem.category)}
                        </p>
                        <p className={`text-[11px] font-semibold mt-2 ${availableQuantity > 0 ? 'text-on-surface-variant' : 'text-error'}`}>
                          Saldo disponível: {availableQuantity}
                        </p>
                      </div>

                      <div className="flex items-center gap-3">
                        <label className="text-xs font-bold uppercase text-outline">
                          Quantidade
                          <input
                            type="number"
                            min="1"
                            max={Math.max(availableQuantity, 1)}
                            className="mt-1 h-11 w-24 rounded-lg border border-outline-variant/20 bg-surface-container-lowest px-3 text-sm font-semibold"
                            value={requestItem.requestedQuantity}
                            disabled={isDraftReadOnly}
                            onChange={event =>
                              setDraft(current => ({
                                ...updateRequestItemQuantity(
                                  current,
                                  requestItem.id,
                                  Math.max(1, Math.min(Math.max(availableQuantity, 1), Number(event.target.value || 0)))
                                ),
                                updatedAt: new Date().toISOString()
                              }))
                            }
                          />
                        </label>

                        <button
                          type="button"
                          onClick={() => removeItemFromDraft(requestItem.id)}
                          disabled={isDraftReadOnly}
                          className="mt-5 h-11 w-11 rounded-lg bg-error-container/40 text-error flex items-center justify-center"
                          aria-label={`Remover ${normalizeUserFacingText(requestItem.itemName)}`}
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-xl bg-surface-container-low p-8 text-center text-on-surface-variant">
              Busque um item acima e adicione o que precisa sair do estoque.
            </div>
          )}
        </div>

        <div className="mt-6 flex flex-col md:flex-row gap-3">
          {canMutateDraft ? (
            <>
              <button
                type="button"
                onClick={() => void saveDraft(false)}
                className="flex-1 h-12 rounded-lg bg-primary text-on-primary font-bold flex items-center justify-center gap-2"
              >
                {isSaving ? <LoaderCircle size={18} className="animate-spin" /> : <CheckCircle2 size={18} />}
                Salvar solicitação
              </button>
              <button
                type="button"
                onClick={() => void saveDraft(true)}
                className="flex-1 h-12 rounded-lg bg-surface-container-highest text-primary font-bold flex items-center justify-center gap-2"
              >
                <Send size={18} />
                Salvar e ir para separação
              </button>
              {persistedEditingRequest && (
                <button
                  type="button"
                  onClick={() => deleteRequest(persistedEditingRequest)}
                  className="h-12 px-4 rounded-lg bg-error-container/40 text-error font-bold flex items-center justify-center gap-2"
                >
                  <Trash2 size={18} />
                  Excluir
                </button>
              )}
            </>
          ) : (
            <div className="flex-1 h-12 rounded-lg bg-surface-container-highest text-on-surface-variant font-bold flex items-center justify-center gap-2">
              <Lock size={18} />
              Solicitação bloqueada para consulta
            </div>
          )}
        </div>
      </section>

      <aside className="space-y-4">
        <section className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <ClipboardList size={18} className="text-primary" />
            <h3 className="font-headline font-bold text-lg text-on-surface">Solicitações recentes</h3>
          </div>

          <div className="space-y-3">
            {recentRequests.length > 0 ? (
              recentRequests.map(request => {
                const progress = getRequestProgress(request);
                const needsAttention = materialRequestNeedsStockAttention(request, items, {
                  criticalLimit: 0,
                  reorderLimit: 20
                });

                return (
                  <div
                    key={request.id}
                    className="rounded-xl border border-outline-variant/15 bg-surface-container-low p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-on-surface">{request.code}</p>
                        <p className="text-xs text-on-surface-variant mt-1 truncate">
                          {request.vehiclePlate || 'Sem placa'} • {request.costCenter || 'Sem centro de custo'}
                        </p>
                      </div>
                      <span className={priorityClassName(request.priority)}>{request.priority}</span>
                    </div>

                    <div className="mt-3 h-2 rounded-full bg-surface-container-high overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{ width: `${progress.percent}%` }}
                      />
                    </div>

                    <div className="mt-3 flex items-center justify-between gap-3 text-xs text-on-surface-variant">
                      <span>{request.items.length} itens</span>
                      <span>{progress.separated}/{progress.requested} separados</span>
                    </div>

                    <div className="mt-3 flex items-center justify-between gap-3">
                      <span className={statusClassName(request.status)}>{normalizeUserFacingText(request.status)}</span>
                      {needsAttention && (
                        <span className="text-[11px] font-semibold text-error">Atenção no saldo</span>
                      )}
                    </div>

                    <div className="mt-4 flex gap-2">
                      <button
                        type="button"
                        onClick={() => loadRequest(request)}
                        className="flex-1 h-10 rounded-lg bg-surface-container-lowest text-on-surface font-semibold text-sm"
                      >
                        {canEditRequest(request.status) ? (
                          <span className="inline-flex items-center gap-2">
                            <Pencil size={15} />
                            Editar
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-2">
                            <Eye size={15} />
                            Consultar
                          </span>
                        )}
                      </button>
                      {canEditRequest(request.status) ? (
                        <>
                          <button
                            type="button"
                            onClick={() => onOpenSeparation(request.id)}
                            className="flex-1 h-10 rounded-lg bg-primary text-on-primary font-semibold text-sm flex items-center justify-center gap-2"
                          >
                            Separar
                            <ArrowRight size={16} />
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteRequest(request)}
                            className="h-10 w-10 rounded-lg bg-error-container/40 text-error flex items-center justify-center"
                            aria-label={`Excluir ${request.code}`}
                          >
                            <Trash2 size={16} />
                          </button>
                        </>
                      ) : (
                        <div className="flex-1 h-10 rounded-lg bg-surface-container-highest text-on-surface-variant font-semibold text-sm flex items-center justify-center gap-2">
                          <Lock size={15} />
                          Histórico
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="rounded-xl bg-surface-container-low p-8 text-center text-on-surface-variant">
                Ainda não temos solicitações salvas.
              </div>
            )}
          </div>
        </section>
      </aside>
    </div>
  );
}

function VehicleInfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface-container-lowest px-4 py-3">
      <p className="text-[11px] font-bold uppercase tracking-wider text-outline">{label}</p>
      <p className="font-semibold text-on-surface mt-1">{value}</p>
    </div>
  );
}

function priorityClassName(priority: MaterialRequest['priority']) {
  switch (priority) {
    case 'Urgente':
      return 'inline-flex items-center rounded-full bg-error-container px-3 py-1 text-[11px] font-bold text-on-error-container';
    case 'Alta':
      return 'inline-flex items-center rounded-full bg-primary-container px-3 py-1 text-[11px] font-bold text-on-primary-container';
    case 'Baixa':
      return 'inline-flex items-center rounded-full bg-surface-container-high px-3 py-1 text-[11px] font-bold text-on-surface-variant';
    default:
      return 'inline-flex items-center rounded-full bg-surface-container-highest px-3 py-1 text-[11px] font-bold text-on-surface-variant';
  }
}

function statusClassName(status: MaterialRequest['status']) {
  const normalized = normalizeUserFacingText(status);
  switch (normalized) {
    case 'Atendida':
      return 'inline-flex items-center rounded-full bg-primary-container px-3 py-1 text-[11px] font-bold text-on-primary-container';
    case 'Separada':
      return 'inline-flex items-center rounded-full bg-surface-container-high px-3 py-1 text-[11px] font-bold text-primary';
    case 'Em separação':
      return 'inline-flex items-center rounded-full bg-secondary-container px-3 py-1 text-[11px] font-bold text-on-secondary-container';
    default:
      return 'inline-flex items-center rounded-full bg-surface-container-highest px-3 py-1 text-[11px] font-bold text-on-surface-variant';
  }
}

function canEditRequest(status: MaterialRequest['status']) {
  return normalizeUserFacingText(status) !== 'Atendida';
}

function isRequestLocked(status: MaterialRequest['status']) {
  return !canEditRequest(status);
}
