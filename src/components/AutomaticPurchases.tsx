import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Package, Plus, Search, ShoppingCart, X } from 'lucide-react';
import { InventoryItem, InventoryLog, InventorySettings, PurchaseRequest, PurchaseRequestStatus } from '../types';
import { calculateItemStatus, getItemAlertSettings } from '../inventoryRules';
import { getAbcAnalysisForSku, getAdaptiveAbcStockPolicy } from '../abcAnalysis';
import { normalizeUserFacingText } from '../textUtils';
import { getVehicleTypeFromModel, normalizeOperationalVehicleType } from '../vehicleCatalog';

interface AutomaticPurchasesProps {
  items: InventoryItem[];
  logs: InventoryLog[];
  settings: InventorySettings;
  purchases: PurchaseRequest[];
  setPurchases: React.Dispatch<React.SetStateAction<PurchaseRequest[]>>;
  canManagePurchases: boolean;
  showToast: (message: string, type?: 'success' | 'info') => void;
  onSelectSku: (sku: string) => void;
}

type PurchaseTab = 'fila' | 'manuais' | 'aguardando';
type PurchaseClassification = 'critico' | 'reposicao' | 'manual' | 'kit-preventiva';

type PurchasePackageGroup = {
  key: string;
  type: string;
  classification: PurchaseClassification;
  label: string;
  description: string;
  badgeClassName: string;
  items: PurchaseRequest[];
  totalSuggested: number;
};

const ACTIVE_PURCHASE_STATUSES = new Set<PurchaseRequestStatus>([
  'Sugestao',
  'Manual',
  'Em analise',
  'Aprovada',
  'Comprada',
  'Recebida parcial'
]);

const REVIEWABLE_PURCHASE_STATUSES = new Set<PurchaseRequestStatus>(['Sugestao', 'Manual', 'Em analise']);
const WAITING_PURCHASE_STATUSES = new Set<PurchaseRequestStatus>(['Aprovada', 'Comprada', 'Recebida parcial']);
const AUTOMATIC_QUEUE_STATUSES = new Set<PurchaseRequestStatus>(['Sugestao', 'Em analise']);

function normalizeSku(value: unknown) {
  return String(value || '').trim();
}

function getSkuCandidates(value: unknown) {
  const raw = normalizeSku(value);
  const digits = raw.replace(/\D/g, '');
  const candidates = new Set<string>();
  if (raw) candidates.add(raw);
  if (digits) {
    candidates.add(digits);
    candidates.add(digits.padStart(5, '0'));
    candidates.add(digits.replace(/^0+/, '') || '0');
  }
  return candidates;
}

function findItemBySku(items: InventoryItem[], sku: string) {
  const candidates = getSkuCandidates(sku);
  return items.find(item => {
    const itemCandidates = getSkuCandidates(item.sku);
    for (const candidate of itemCandidates) {
      if (candidates.has(candidate)) return true;
    }
    return false;
  });
}

function normalizePurchaseType(value: unknown) {
  const text = normalizeUserFacingText(value);
  if (!text) return '';

  const comparable = text
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (comparable === 'VW') return 'SAVEIRO/GOL';
  if (comparable === 'CHEVROLET' || comparable === 'S10') return 'S-10';
  if (comparable === 'OLEO' || comparable === 'OLEOS') return 'OLEO';

  return normalizeOperationalVehicleType(text) || text;
}

function getEffectivePurchaseType(item: InventoryItem | undefined) {
  if (!item) return 'Sem tipo vinculado';

  return (
    normalizePurchaseType(item.vehicleType) ||
    normalizePurchaseType(getVehicleTypeFromModel(item.vehicleModel || '')) ||
    'Sem tipo vinculado'
  );
}

function getPurchaseClassification(purchase: PurchaseRequest): PurchaseClassification {
  if (purchase.source === 'alerta-critico') return 'critico';
  if (purchase.source === 'reposicao') return 'reposicao';
  if (purchase.source === 'kit-preventiva') return 'kit-preventiva';
  return 'manual';
}

function getPurchaseClassificationMeta(classification: PurchaseClassification) {
  if (classification === 'critico') {
    return {
      label: 'Crítico',
      description: 'Pacote urgente: item abaixo do mínimo calculado.',
      badgeClassName: 'bg-error-container text-on-error-container',
      priority: 0
    };
  }

  if (classification === 'reposicao') {
    return {
      label: 'Repor',
      description: 'Pacote de reposição: item abaixo do máximo recomendado.',
      badgeClassName: 'bg-tertiary-container text-on-tertiary-container',
      priority: 1
    };
  }

  if (classification === 'kit-preventiva') {
    return {
      label: 'Kit preventiva',
      description: 'Pacote vinculado a necessidade de kit preventivo.',
      badgeClassName: 'bg-primary-container text-on-primary-container',
      priority: 2
    };
  }

  return {
    label: 'Manual',
    description: 'Pacote criado pela equipe para compra manual.',
    badgeClassName: 'bg-secondary-container text-on-secondary-container',
    priority: 3
  };
}

function buildSuggestionReason(item: InventoryItem, source: PurchaseRequest['source'], settings: InventorySettings, logs: InventoryLog[]) {
  const abc = getAbcAnalysisForSku(item.sku);
  const policy = getAdaptiveAbcStockPolicy(item.sku, logs);
  const statusLabel = source === 'alerta-critico' ? 'Crítico' : 'Reposição';
  const maxLimit = policy?.maximumStock ?? settings.reorderLimit;
  const minLimit = policy?.minimumStock ?? settings.criticalLimit;
  const parts = [
    `${statusLabel}: saldo ${item.quantity}, mínimo ${minLimit}, máximo ${maxLimit}`,
    `sugerido comprar até recompor o máximo`
  ];

  if (abc) {
    parts.push(`Curva ABC ${abc.className}, rank ${abc.rank}`);
  }

  if (policy?.recentOutflowQuantity) {
    parts.push(`saídas recentes: ${policy.recentOutflowQuantity}`);
  }

  return parts.join(' | ');
}

function comparePurchases(first: PurchaseRequest, second: PurchaseRequest) {
  const firstClassification = getPurchaseClassificationMeta(getPurchaseClassification(first));
  const secondClassification = getPurchaseClassificationMeta(getPurchaseClassification(second));
  if (firstClassification.priority !== secondClassification.priority) {
    return firstClassification.priority - secondClassification.priority;
  }

  const firstAbc = getAbcAnalysisForSku(first.sku);
  const secondAbc = getAbcAnalysisForSku(second.sku);
  const firstRank = firstAbc?.rank ?? Number.MAX_SAFE_INTEGER;
  const secondRank = secondAbc?.rank ?? Number.MAX_SAFE_INTEGER;
  if (firstRank !== secondRank) return firstRank - secondRank;

  if (first.suggestedQuantity !== second.suggestedQuantity) {
    return second.suggestedQuantity - first.suggestedQuantity;
  }

  return new Date(second.updatedAt).getTime() - new Date(first.updatedAt).getTime();
}

export default function AutomaticPurchases({
  items,
  logs,
  settings,
  purchases,
  setPurchases,
  canManagePurchases,
  showToast,
  onSelectSku
}: AutomaticPurchasesProps) {
  const [activeTab, setActiveTab] = useState<PurchaseTab>('fila');
  const [searchQuery, setSearchQuery] = useState('');
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [manualSku, setManualSku] = useState('');
  const [manualQuantity, setManualQuantity] = useState('');
  const [manualReason, setManualReason] = useState('');

  const suggestions = useMemo(() => {
    const generated: PurchaseRequest[] = [];
    const now = new Date().toISOString();
    const activePurchaseSkus = new Set(
      purchases
        .filter(purchase => ACTIVE_PURCHASE_STATUSES.has(purchase.status))
        .flatMap(purchase => Array.from(getSkuCandidates(purchase.sku)))
    );

    items.forEach(item => {
      if (item.isActiveInWarehouse !== true) return;

      const skuCandidates = getSkuCandidates(item.sku);
      if (Array.from(skuCandidates).some(candidate => activePurchaseSkus.has(candidate))) return;

      const itemSettings = getItemAlertSettings(item, settings, logs);
      const status = normalizeUserFacingText(calculateItemStatus(item, settings, logs));
      const abcPolicy = getAdaptiveAbcStockPolicy(item.sku, logs);
      const maximumStock = abcPolicy?.maximumStock ?? itemSettings.reorderLimit;
      const suggestedQuantity = Math.max(0, Math.ceil(maximumStock - item.quantity));

      if (suggestedQuantity <= 0) return;

      let source: PurchaseRequest['source'] | null = null;
      if (status === 'Estoque Crítico') {
        source = 'alerta-critico';
      } else if (status === 'Repor em Breve') {
        source = 'reposicao';
      }

      if (!source) return;

      generated.push({
        id: `sug-${normalizeSku(item.sku)}-${now}`,
        sku: item.sku,
        itemName: normalizeUserFacingText(item.name),
        status: 'Sugestao',
        source,
        suggestedQuantity,
        reason: buildSuggestionReason(item, source, itemSettings, logs),
        createdAt: now,
        updatedAt: now
      });
    });

    return generated;
  }, [items, settings, logs, purchases]);

  const allPurchases = useMemo(() => {
    const combined = [...purchases];

    suggestions.forEach(suggestion => {
      const hasActivePurchase = combined.some(purchase => {
        if (!ACTIVE_PURCHASE_STATUSES.has(purchase.status)) return false;
        const purchaseCandidates = getSkuCandidates(purchase.sku);
        for (const candidate of getSkuCandidates(suggestion.sku)) {
          if (purchaseCandidates.has(candidate)) return true;
        }
        return false;
      });

      if (!hasActivePurchase) {
        combined.push(suggestion);
      }
    });

    return combined.sort(comparePurchases);
  }, [purchases, suggestions]);

  const filteredPurchases = useMemo(() => {
    let filtered = allPurchases;

    if (activeTab === 'fila') {
      filtered = filtered.filter(
        purchase => purchase.source !== 'manual' && AUTOMATIC_QUEUE_STATUSES.has(purchase.status)
      );
    } else if (activeTab === 'manuais') {
      filtered = filtered.filter(
        purchase => purchase.source === 'manual' && ['Manual', 'Em analise'].includes(purchase.status)
      );
    } else {
      filtered = filtered.filter(purchase => WAITING_PURCHASE_STATUSES.has(purchase.status));
    }

    const query = normalizeUserFacingText(searchQuery).toLowerCase();
    if (!query) return filtered;

    return filtered.filter(purchase => {
      const item = findItemBySku(items, purchase.sku);
      const type = getEffectivePurchaseType(item).toLowerCase();
      const haystack = [
        purchase.sku,
        purchase.itemName,
        item?.name,
        item?.category,
        item?.location,
        type
      ]
        .map(value => normalizeUserFacingText(value).toLowerCase())
        .join(' ');

      return haystack.includes(query);
    });
  }, [allPurchases, activeTab, searchQuery, items]);

  const groupedPurchases = useMemo(() => {
    const groups = new Map<string, PurchasePackageGroup>();

    filteredPurchases.forEach(purchase => {
      const item = findItemBySku(items, purchase.sku);
      const type = getEffectivePurchaseType(item);
      const classification = getPurchaseClassification(purchase);
      const meta = getPurchaseClassificationMeta(classification);
      const key = `${type}__${classification}`;
      const current = groups.get(key);

      if (current) {
        current.items.push(purchase);
        current.totalSuggested += purchase.suggestedQuantity;
        return;
      }

      groups.set(key, {
        key,
        type,
        classification,
        label: meta.label,
        description: meta.description,
        badgeClassName: meta.badgeClassName,
        items: [purchase],
        totalSuggested: purchase.suggestedQuantity
      });
    });

    return Array.from(groups.values())
      .map(group => ({
        ...group,
        items: group.items.sort(comparePurchases)
      }))
      .sort((first, second) => {
        const typeCompare = first.type.localeCompare(second.type, 'pt-BR');
        if (typeCompare !== 0) return typeCompare;
        return (
          getPurchaseClassificationMeta(first.classification).priority -
          getPurchaseClassificationMeta(second.classification).priority
        );
      });
  }, [filteredPurchases, items]);

  const stats = useMemo(() => {
    return {
      urgentes: allPurchases.filter(
        purchase => purchase.source === 'alerta-critico' && AUTOMATIC_QUEUE_STATUSES.has(purchase.status)
      ).length,
      reposicao: allPurchases.filter(
        purchase => purchase.source === 'reposicao' && AUTOMATIC_QUEUE_STATUSES.has(purchase.status)
      ).length,
      manuais: allPurchases.filter(
        purchase => purchase.source === 'manual' && ['Manual', 'Em analise'].includes(purchase.status)
      ).length,
      aguardando: allPurchases.filter(purchase => WAITING_PURCHASE_STATUSES.has(purchase.status)).length,
      pacotes: groupedPurchases.length
    };
  }, [allPurchases, groupedPurchases.length]);

  const handleStatusChange = (purchase: PurchaseRequest, newStatus: PurchaseRequestStatus) => {
    if (!canManagePurchases) {
      showToast('Sem permissão para gerenciar compras.', 'info');
      return;
    }

    const now = new Date().toISOString();

    setPurchases(previous => {
      const existing = previous.find(current => current.id === purchase.id);
      if (existing) {
        return previous.map(current => current.id === purchase.id ? { ...current, status: newStatus, updatedAt: now } : current);
      }

      return [...previous, { ...purchase, status: newStatus, updatedAt: now }];
    });

    showToast(`Status alterado para ${newStatus}.`, 'success');
  };

  const handlePackageStatusChange = (group: PurchasePackageGroup, newStatus: PurchaseRequestStatus) => {
    if (!canManagePurchases) {
      showToast('Sem permissão para gerenciar compras.', 'info');
      return;
    }

    const selected = group.items.filter(purchase => REVIEWABLE_PURCHASE_STATUSES.has(purchase.status));
    if (selected.length === 0) {
      showToast('Este pacote não tem itens liberados para alterar agora.', 'info');
      return;
    }

    const now = new Date().toISOString();
    setPurchases(previous => {
      const byId = new Map(previous.map(purchase => [purchase.id, purchase]));
      selected.forEach(purchase => {
        byId.set(purchase.id, { ...purchase, status: newStatus, updatedAt: now });
      });
      return Array.from(byId.values()).sort(comparePurchases);
    });

    showToast(`Pacote ${group.type} / ${group.label} atualizado para ${newStatus}.`, 'success');
  };

  const handleCreateManual = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canManagePurchases) return;

    const sku = normalizeSku(manualSku);
    const item = findItemBySku(items, sku);
    if (!item) {
      showToast('SKU não encontrado.', 'info');
      return;
    }

    const qty = Number.parseInt(manualQuantity, 10);
    if (!Number.isFinite(qty) || qty <= 0) {
      showToast('Quantidade inválida.', 'info');
      return;
    }

    const now = new Date().toISOString();
    const newPurchase: PurchaseRequest = {
      id: `man-${normalizeSku(item.sku)}-${Date.now()}`,
      sku: item.sku,
      itemName: normalizeUserFacingText(item.name),
      status: 'Manual',
      source: 'manual',
      suggestedQuantity: qty,
      reason: normalizeUserFacingText(manualReason) || 'Pedido manual',
      createdAt: now,
      updatedAt: now
    };

    setPurchases(previous => [...previous, newPurchase].sort(comparePurchases));
    setIsManualModalOpen(false);
    setManualSku('');
    setManualQuantity('');
    setManualReason('');
    showToast('Pedido manual criado com sucesso.', 'success');
  };

  return (
    <div className="max-w-7xl mx-auto p-4 pb-24 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-on-surface flex items-center gap-2">
            <ShoppingCart className="w-7 h-7 text-primary" />
            Compras Automáticas
          </h1>
          <p className="text-on-surface-variant mt-1">
            Pacotes por tipo e prioridade, baseados em alertas, Curva ABC e pedidos manuais.
          </p>
        </div>
        {canManagePurchases && (
          <button
            type="button"
            onClick={() => setIsManualModalOpen(true)}
            className="flex items-center justify-center gap-2 px-4 py-2 bg-primary text-on-primary rounded-xl font-medium hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-5 h-5" />
            Pedido Manual
          </button>
        )}
      </div>

      <div className="rounded-2xl border border-primary/15 bg-primary-container/40 p-4 text-on-primary-container">
        <p className="font-bold">Como o pacote de compra é formado</p>
        <p className="text-sm mt-1">
          O sistema separa automaticamente por tipo do item e por prioridade: primeiro Crítico, depois Repor.
          A quantidade sugerida usa a regra de máximo calculado menos saldo atual, sem dar entrada no estoque.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        <div className="bg-error-container text-on-error-container p-4 rounded-2xl">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-5 h-5" />
            <span className="font-medium">Críticos</span>
          </div>
          <div className="text-3xl font-bold">{stats.urgentes}</div>
        </div>
        <div className="bg-tertiary-container text-on-tertiary-container p-4 rounded-2xl">
          <div className="flex items-center gap-2 mb-2">
            <Package className="w-5 h-5" />
            <span className="font-medium">Repor</span>
          </div>
          <div className="text-3xl font-bold">{stats.reposicao}</div>
        </div>
        <div className="bg-secondary-container text-on-secondary-container p-4 rounded-2xl">
          <div className="flex items-center gap-2 mb-2">
            <Plus className="w-5 h-5" />
            <span className="font-medium">Manuais</span>
          </div>
          <div className="text-3xl font-bold">{stats.manuais}</div>
        </div>
        <div className="bg-primary-container text-on-primary-container p-4 rounded-2xl">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-5 h-5" />
            <span className="font-medium">Aguardando</span>
          </div>
          <div className="text-3xl font-bold">{stats.aguardando}</div>
        </div>
        <div className="bg-surface-container-highest text-on-surface p-4 rounded-2xl">
          <div className="flex items-center gap-2 mb-2">
            <ShoppingCart className="w-5 h-5" />
            <span className="font-medium">Pacotes</span>
          </div>
          <div className="text-3xl font-bold">{stats.pacotes}</div>
        </div>
      </div>

      <div className="bg-surface-container rounded-2xl overflow-hidden flex flex-col">
        <div className="flex border-b border-outline-variant overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveTab('fila')}
            className={`flex-1 min-w-[140px] py-4 px-4 text-sm font-medium text-center border-b-2 transition-colors ${
              activeTab === 'fila'
                ? 'border-primary text-primary'
                : 'border-transparent text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest'
            }`}
          >
            Fila Automática
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('manuais')}
            className={`flex-1 min-w-[140px] py-4 px-4 text-sm font-medium text-center border-b-2 transition-colors ${
              activeTab === 'manuais'
                ? 'border-primary text-primary'
                : 'border-transparent text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest'
            }`}
          >
            Pedidos Manuais
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('aguardando')}
            className={`flex-1 min-w-[140px] py-4 px-4 text-sm font-medium text-center border-b-2 transition-colors ${
              activeTab === 'aguardando'
                ? 'border-primary text-primary'
                : 'border-transparent text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest'
            }`}
          >
            Aguardando
          </button>
        </div>

        <div className="p-4 border-b border-outline-variant">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-on-surface-variant" />
            <input
              type="text"
              value={searchQuery}
              onChange={event => setSearchQuery(event.target.value)}
              placeholder="Buscar por SKU, descrição ou tipo..."
              className="w-full pl-10 pr-4 py-3 bg-surface text-on-surface rounded-xl border border-outline-variant focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
            />
          </div>
        </div>

        <div className="p-4 space-y-6">
          {groupedPurchases.length === 0 ? (
            <div className="text-center py-12 text-on-surface-variant">
              <ShoppingCart className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>Nenhuma compra encontrada nesta categoria.</p>
            </div>
          ) : (
            groupedPurchases.map(group => {
              const canBulkReview = group.items.some(purchase => REVIEWABLE_PURCHASE_STATUSES.has(purchase.status));

              return (
                <section key={group.key} className="rounded-2xl border border-outline-variant bg-surface overflow-hidden">
                  <div className="p-4 bg-surface-container-low flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-base font-bold text-on-surface flex items-center gap-2">
                          <Package className="w-5 h-5 text-primary" />
                          Pacote {group.type}
                        </h2>
                        <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${group.badgeClassName}`}>
                          {group.label}
                        </span>
                      </div>
                      <p className="text-sm text-on-surface-variant mt-2">{group.description}</p>
                      <div className="flex flex-wrap gap-2 mt-3 text-xs font-semibold text-on-surface-variant">
                        <span className="px-2 py-1 rounded-lg bg-surface-container-highest">
                          {group.items.length} SKUs
                        </span>
                        <span className="px-2 py-1 rounded-lg bg-surface-container-highest">
                          {group.totalSuggested} unidades sugeridas
                        </span>
                      </div>
                    </div>

                    {canManagePurchases && canBulkReview && (
                      <div className="flex flex-col sm:flex-row gap-2 w-full lg:w-auto">
                        <button
                          type="button"
                          onClick={() => handlePackageStatusChange(group, 'Em analise')}
                          className="px-3 py-2 bg-surface text-on-surface rounded-xl border border-outline-variant text-sm font-bold hover:bg-surface-container-highest"
                        >
                          Enviar pacote para análise
                        </button>
                        <button
                          type="button"
                          onClick={() => handlePackageStatusChange(group, 'Aprovada')}
                          className="px-3 py-2 bg-primary text-on-primary rounded-xl text-sm font-bold hover:bg-primary/90"
                        >
                          Aprovar pacote
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="p-4 space-y-3">
                    {group.items.map(purchase => {
                      const item = findItemBySku(items, purchase.sku);
                      const currentQty = item?.quantity ?? 0;
                      const itemSettings = item ? getItemAlertSettings(item, settings, logs) : null;
                      const abc = getAbcAnalysisForSku(purchase.sku);
                      const classification = getPurchaseClassification(purchase);
                      const meta = getPurchaseClassificationMeta(classification);

                      return (
                        <div
                          key={purchase.id}
                          className="bg-surface-container-lowest p-4 rounded-xl border border-outline-variant flex flex-col xl:flex-row gap-4 justify-between items-start xl:items-center"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2 mb-2">
                              <span className="font-mono text-sm text-primary bg-primary/10 px-2 py-0.5 rounded">
                                {purchase.sku}
                              </span>
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${meta.badgeClassName}`}>
                                {meta.label}
                              </span>
                              <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-surface-variant text-on-surface-variant">
                                {purchase.status}
                              </span>
                              {abc && (
                                <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-primary-container text-on-primary-container">
                                  ABC {abc.className} · rank {abc.rank}
                                </span>
                              )}
                            </div>
                            <h3 className="font-bold text-on-surface truncate">
                              {normalizeUserFacingText(purchase.itemName)}
                            </h3>
                            <div className="mt-2 grid sm:grid-cols-4 gap-2 text-sm text-on-surface-variant">
                              <span>
                                Saldo: <strong className="text-on-surface">{currentQty}</strong>
                              </span>
                              <span>
                                Comprar: <strong className="text-primary">{purchase.suggestedQuantity}</strong>
                              </span>
                              <span>
                                Mínimo: <strong className="text-on-surface">{itemSettings?.criticalLimit ?? '-'}</strong>
                              </span>
                              <span>
                                Máximo: <strong className="text-on-surface">{itemSettings?.reorderLimit ?? '-'}</strong>
                              </span>
                            </div>
                            <p className="text-xs text-on-surface-variant mt-2">
                              Motivo: {normalizeUserFacingText(purchase.reason)}
                            </p>
                          </div>

                          <div className="flex flex-wrap gap-2 w-full xl:w-auto">
                            {canManagePurchases && (
                              <>
                                {['Sugestao', 'Manual'].includes(purchase.status) && (
                                  <button
                                    type="button"
                                    onClick={() => handleStatusChange(purchase, 'Em analise')}
                                    className="flex-1 xl:flex-none px-3 py-2 bg-surface text-on-surface rounded-lg border border-outline-variant text-sm font-bold hover:bg-surface-container-highest"
                                  >
                                    Analisar
                                  </button>
                                )}
                                {REVIEWABLE_PURCHASE_STATUSES.has(purchase.status) && (
                                  <button
                                    type="button"
                                    onClick={() => handleStatusChange(purchase, 'Aprovada')}
                                    className="flex-1 xl:flex-none px-3 py-2 bg-primary text-on-primary rounded-lg text-sm font-bold hover:bg-primary/90"
                                  >
                                    Aprovar
                                  </button>
                                )}
                                {purchase.status === 'Aprovada' && (
                                  <button
                                    type="button"
                                    onClick={() => handleStatusChange(purchase, 'Comprada')}
                                    className="flex-1 xl:flex-none px-3 py-2 bg-tertiary text-on-tertiary rounded-lg text-sm font-bold hover:bg-tertiary/90"
                                  >
                                    Marcar comprada
                                  </button>
                                )}
                                {['Sugestao', 'Manual', 'Em analise', 'Aprovada'].includes(purchase.status) && (
                                  <button
                                    type="button"
                                    onClick={() => handleStatusChange(purchase, 'Cancelada')}
                                    className="flex-1 xl:flex-none px-3 py-2 bg-error text-on-error rounded-lg text-sm font-bold hover:bg-error/90"
                                  >
                                    Cancelar
                                  </button>
                                )}
                              </>
                            )}
                            <button
                              type="button"
                              onClick={() => onSelectSku(purchase.sku)}
                              className="flex-1 xl:flex-none px-3 py-2 bg-surface-variant text-on-surface-variant rounded-lg text-sm font-bold hover:bg-surface-variant/80"
                            >
                              Ver estoque
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })
          )}
        </div>
      </div>

      {isManualModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-surface-container w-full max-w-md rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between p-4 border-b border-outline-variant">
              <h2 className="text-lg font-bold text-on-surface">Novo Pedido Manual</h2>
              <button
                type="button"
                onClick={() => setIsManualModalOpen(false)}
                className="p-2 text-on-surface-variant hover:text-on-surface hover:bg-surface-variant rounded-full transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateManual} className="p-4 space-y-4 overflow-y-auto">
              <div>
                <label className="block text-sm font-medium text-on-surface mb-1">SKU</label>
                <input
                  type="text"
                  required
                  value={manualSku}
                  onChange={event => setManualSku(event.target.value)}
                  className="w-full px-3 py-2 bg-surface text-on-surface rounded-xl border border-outline-variant focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                  placeholder="Ex: 12345"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-on-surface mb-1">Quantidade</label>
                <input
                  type="number"
                  required
                  min="1"
                  value={manualQuantity}
                  onChange={event => setManualQuantity(event.target.value)}
                  className="w-full px-3 py-2 bg-surface text-on-surface rounded-xl border border-outline-variant focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                  placeholder="Ex: 10"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-on-surface mb-1">Motivo / Observação</label>
                <textarea
                  required
                  value={manualReason}
                  onChange={event => setManualReason(event.target.value)}
                  className="w-full px-3 py-2 bg-surface text-on-surface rounded-xl border border-outline-variant focus:border-primary focus:ring-1 focus:ring-primary outline-none resize-none h-24"
                  placeholder="Por que este item precisa ser comprado?"
                />
              </div>
              <div className="pt-4 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsManualModalOpen(false)}
                  className="px-4 py-2 text-on-surface-variant hover:bg-surface-variant rounded-xl font-medium transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-primary text-on-primary rounded-xl font-medium hover:bg-primary/90 transition-colors"
                >
                  Criar Pedido
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
