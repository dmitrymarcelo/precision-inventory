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
  const [activeTab, setActiveTab] = useState<'fila' | 'manuais' | 'aguardando'>('fila');
  const [searchQuery, setSearchQuery] = useState('');
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [manualSku, setManualSku] = useState('');
  const [manualQuantity, setManualQuantity] = useState('');
  const [manualReason, setManualReason] = useState('');

  const getEffectiveVehicleType = (item: InventoryItem) =>
    normalizeOperationalVehicleType(item.vehicleType || getVehicleTypeFromModel(item.vehicleModel || ''));

  // Generate suggestions based on current inventory
  const suggestions = useMemo(() => {
    const generated: PurchaseRequest[] = [];
    const now = new Date().toISOString();

    items.forEach(item => {
      if (item.isActiveInWarehouse === false) return;

      const itemSettings = getItemAlertSettings(item, settings, logs);
      const status = calculateItemStatus(item, settings, logs);
      
      let source: PurchaseRequest['source'] | null = null;
      let reason = '';
      
      if (status === 'Estoque Crítico') {
        source = 'alerta-critico';
        reason = 'Estoque abaixo do limite crítico';
      } else if (status === 'Repor em Breve') {
        source = 'reposicao';
        reason = 'Estoque atingiu limite de reposição';
      }

      if (source) {
        // Check if there's already an active purchase for this SKU
        const existingActive = purchases.find(
          p => p.sku === item.sku && 
          ['Sugestao', 'Manual', 'Em analise', 'Aprovada', 'Comprada', 'Recebida parcial'].includes(p.status)
        );

        if (!existingActive) {
          const maxLimit = itemSettings.reorderLimit * 2; // Simple max calculation
          const suggestedQuantity = Math.max(0, maxLimit - item.quantity);

          if (suggestedQuantity > 0) {
            generated.push({
              id: `sug-${item.sku}-${Date.now()}`,
              sku: item.sku,
              itemName: item.name,
              status: 'Sugestao',
              source,
              suggestedQuantity,
              reason,
              createdAt: now,
              updatedAt: now
            });
          }
        }
      }
    });

    return generated;
  }, [items, settings, logs, purchases]);

  const allPurchases = useMemo(() => {
    const combined = [...purchases];
    
    // Add suggestions that aren't in purchases yet
    suggestions.forEach(sug => {
      if (!combined.find(p => p.sku === sug.sku && p.status === 'Sugestao')) {
        combined.push(sug);
      }
    });

    return combined.sort((a, b) => {
      if (a.status === 'Sugestao' && b.status !== 'Sugestao') return -1;
      if (a.status !== 'Sugestao' && b.status === 'Sugestao') return 1;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }, [purchases, suggestions]);

  const filteredPurchases = useMemo(() => {
    let filtered = allPurchases;

    if (activeTab === 'fila') {
      filtered = filtered.filter(p => ['Sugestao', 'Em analise'].includes(p.status));
    } else if (activeTab === 'manuais') {
      filtered = filtered.filter(p => p.source === 'manual' && ['Manual', 'Em analise'].includes(p.status));
    } else if (activeTab === 'aguardando') {
      filtered = filtered.filter(p => ['Aprovada', 'Comprada', 'Recebida parcial'].includes(p.status));
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        p => p.sku.toLowerCase().includes(query) || p.itemName.toLowerCase().includes(query)
      );
    }

    return filtered;
  }, [allPurchases, activeTab, searchQuery]);

  const groupedPurchases = useMemo(() => {
    const groups = new Map<string, PurchaseRequest[]>();
    
    filteredPurchases.forEach(purchase => {
      const item = items.find(i => i.sku === purchase.sku);
      const type = item ? (getEffectiveVehicleType(item) || 'Sem tipo') : 'Sem tipo';
      
      const current = groups.get(type);
      if (current) {
        current.push(purchase);
      } else {
        groups.set(type, [purchase]);
      }
    });

    return Array.from(groups.entries())
      .map(([type, groupedItems]) => ({
        type,
        items: groupedItems
      }))
      .sort((first, second) => first.type.localeCompare(second.type, 'pt-BR'));
  }, [filteredPurchases, items]);

  const handleStatusChange = (purchase: PurchaseRequest, newStatus: PurchaseRequestStatus) => {
    if (!canManagePurchases) {
      showToast('Sem permissão para gerenciar compras.', 'info');
      return;
    }

    const now = new Date().toISOString();
    
    setPurchases(prev => {
      const existing = prev.find(p => p.id === purchase.id);
      if (existing) {
        return prev.map(p => p.id === purchase.id ? { ...p, status: newStatus, updatedAt: now } : p);
      } else {
        // It was a suggestion, now we save it
        return [...prev, { ...purchase, status: newStatus, updatedAt: now }];
      }
    });
    
    showToast(`Status alterado para ${newStatus}`, 'success');
  };

  const handleCreateManual = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManagePurchases) return;

    const item = items.find(i => i.sku === manualSku);
    if (!item) {
      showToast('SKU não encontrado.', 'info');
      return;
    }

    const qty = parseInt(manualQuantity, 10);
    if (isNaN(qty) || qty <= 0) {
      showToast('Quantidade inválida.', 'info');
      return;
    }

    const now = new Date().toISOString();
    const newPurchase: PurchaseRequest = {
      id: `man-${manualSku}-${Date.now()}`,
      sku: manualSku,
      itemName: item.name,
      status: 'Manual',
      source: 'manual',
      suggestedQuantity: qty,
      reason: manualReason || 'Pedido manual',
      createdAt: now,
      updatedAt: now
    };

    setPurchases(prev => [...prev, newPurchase]);
    setIsManualModalOpen(false);
    setManualSku('');
    setManualQuantity('');
    setManualReason('');
    showToast('Pedido manual criado com sucesso.', 'success');
  };

  const stats = useMemo(() => {
    return {
      urgentes: allPurchases.filter(p => p.source === 'alerta-critico' && ['Sugestao', 'Em analise'].includes(p.status)).length,
      reposicao: allPurchases.filter(p => p.source === 'reposicao' && ['Sugestao', 'Em analise'].includes(p.status)).length,
      manuais: allPurchases.filter(p => p.source === 'manual' && ['Manual', 'Em analise'].includes(p.status)).length,
      aguardando: allPurchases.filter(p => ['Aprovada', 'Comprada', 'Recebida parcial'].includes(p.status)).length
    };
  }, [allPurchases]);

  return (
    <div className="max-w-7xl mx-auto p-4 pb-24 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-on-surface flex items-center gap-2">
            <ShoppingCart className="w-7 h-7 text-primary" />
            Compras Automáticas
          </h1>
          <p className="text-on-surface-variant mt-1">
            Fila de compras baseada em alertas e Curva ABC
          </p>
        </div>
        {canManagePurchases && (
          <button
            onClick={() => setIsManualModalOpen(true)}
            className="flex items-center justify-center gap-2 px-4 py-2 bg-primary text-on-primary rounded-xl font-medium hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-5 h-5" />
            Pedido Manual
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-error-container text-on-error-container p-4 rounded-2xl">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-5 h-5" />
            <span className="font-medium">Urgentes</span>
          </div>
          <div className="text-3xl font-bold">{stats.urgentes}</div>
        </div>
        <div className="bg-tertiary-container text-on-tertiary-container p-4 rounded-2xl">
          <div className="flex items-center gap-2 mb-2">
            <Package className="w-5 h-5" />
            <span className="font-medium">Reposição</span>
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
      </div>

      <div className="bg-surface-container rounded-2xl overflow-hidden flex flex-col">
        <div className="flex border-b border-outline-variant overflow-x-auto">
          <button
            onClick={() => setActiveTab('fila')}
            className={`flex-1 min-w-[120px] py-4 px-4 text-sm font-medium text-center border-b-2 transition-colors ${
              activeTab === 'fila'
                ? 'border-primary text-primary'
                : 'border-transparent text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest'
            }`}
          >
            Fila Automática
          </button>
          <button
            onClick={() => setActiveTab('manuais')}
            className={`flex-1 min-w-[120px] py-4 px-4 text-sm font-medium text-center border-b-2 transition-colors ${
              activeTab === 'manuais'
                ? 'border-primary text-primary'
                : 'border-transparent text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest'
            }`}
          >
            Pedidos Manuais
          </button>
          <button
            onClick={() => setActiveTab('aguardando')}
            className={`flex-1 min-w-[120px] py-4 px-4 text-sm font-medium text-center border-b-2 transition-colors ${
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
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Buscar por SKU ou nome..."
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
            groupedPurchases.map(group => (
              <div key={group.type} className="space-y-3">
                <h2 className="text-sm font-bold uppercase tracking-widest text-primary flex items-center gap-2">
                  <Package className="w-4 h-4" />
                  {group.type}
                  <span className="bg-primary/10 text-primary px-2 py-0.5 rounded-full text-xs">
                    {group.items.length}
                  </span>
                </h2>
                <div className="space-y-3">
                  {group.items.map(purchase => {
                    const item = items.find(i => i.sku === purchase.sku);
                    const currentQty = item?.quantity || 0;
                    
                    return (
                      <div key={purchase.id} className="bg-surface p-4 rounded-xl border border-outline-variant flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-mono text-sm text-primary bg-primary/10 px-2 py-0.5 rounded">
                              {purchase.sku}
                            </span>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                              purchase.source === 'alerta-critico' ? 'bg-error-container text-on-error-container' :
                              purchase.source === 'reposicao' ? 'bg-tertiary-container text-on-tertiary-container' :
                              'bg-secondary-container text-on-secondary-container'
                            }`}>
                              {purchase.source === 'alerta-critico' ? 'Urgente' : 
                               purchase.source === 'reposicao' ? 'Reposição' : 'Manual'}
                            </span>
                            <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-surface-variant text-on-surface-variant">
                              {purchase.status}
                            </span>
                          </div>
                          <h3 className="font-medium text-on-surface">{purchase.itemName}</h3>
                          <p className="text-sm text-on-surface-variant mt-1">
                            Saldo atual: <strong className="text-on-surface">{currentQty}</strong> | 
                            Sugerido: <strong className="text-primary">{purchase.suggestedQuantity}</strong>
                          </p>
                          <p className="text-xs text-on-surface-variant mt-1 italic">
                            Motivo: {purchase.reason}
                          </p>
                        </div>
                        
                        <div className="flex flex-wrap gap-2 w-full sm:w-auto">
                          {canManagePurchases && (
                            <>
                              {['Sugestao', 'Manual'].includes(purchase.status) && (
                                <button
                                  onClick={() => handleStatusChange(purchase, 'Aprovada')}
                                  className="flex-1 sm:flex-none px-3 py-1.5 bg-primary text-on-primary rounded-lg text-sm font-medium hover:bg-primary/90"
                                >
                                  Aprovar
                                </button>
                              )}
                              {purchase.status === 'Aprovada' && (
                                <button
                                  onClick={() => handleStatusChange(purchase, 'Comprada')}
                                  className="flex-1 sm:flex-none px-3 py-1.5 bg-tertiary text-on-tertiary rounded-lg text-sm font-medium hover:bg-tertiary/90"
                                >
                                  Marcar Comprada
                                </button>
                              )}
                              {['Sugestao', 'Manual', 'Em analise', 'Aprovada'].includes(purchase.status) && (
                                <button
                                  onClick={() => handleStatusChange(purchase, 'Cancelada')}
                                  className="flex-1 sm:flex-none px-3 py-1.5 bg-error text-on-error rounded-lg text-sm font-medium hover:bg-error/90"
                                >
                                  Cancelar
                                </button>
                              )}
                            </>
                          )}
                          <button
                            onClick={() => onSelectSku(purchase.sku)}
                            className="flex-1 sm:flex-none px-3 py-1.5 bg-surface-variant text-on-surface-variant rounded-lg text-sm font-medium hover:bg-surface-variant/80"
                          >
                            Ver Estoque
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {isManualModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-surface-container w-full max-w-md rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between p-4 border-b border-outline-variant">
              <h2 className="text-lg font-bold text-on-surface">Novo Pedido Manual</h2>
              <button
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
                  onChange={e => setManualSku(e.target.value)}
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
                  onChange={e => setManualQuantity(e.target.value)}
                  className="w-full px-3 py-2 bg-surface text-on-surface rounded-xl border border-outline-variant focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                  placeholder="Ex: 10"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-on-surface mb-1">Motivo / Observação</label>
                <textarea
                  required
                  value={manualReason}
                  onChange={e => setManualReason(e.target.value)}
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