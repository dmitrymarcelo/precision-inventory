import React, { useMemo, useState } from 'react';
import { AlertTriangle, Gauge, PackageCheck, Pencil, Search, Trash2, X } from 'lucide-react';
import { InventoryItem, InventorySettings, PreventiveKitDefinition, PreventiveKitItem } from '../types';
import { resolvePreventiveKitCatalog } from '../preventiveKitCatalog';
import { normalizeLocationText, normalizeUserFacingText } from '../textUtils';

interface PreventiveKitsProps {
  items: InventoryItem[];
  onSelectSku: (sku: string) => void;
  settings: InventorySettings;
  setSettings: React.Dispatch<React.SetStateAction<InventorySettings>>;
  canManagePreventiveKits: boolean;
  showToast: (message: string, type?: 'success' | 'info') => void;
}

function normalizeSku(value: string) {
  const text = String(value || '').trim();
  if (/^\d+$/.test(text) && text.length < 5) {
    return text.padStart(5, '0');
  }
  return text;
}

export default function PreventiveKits({
  items,
  onSelectSku,
  settings,
  setSettings,
  canManagePreventiveKits,
  showToast
}: PreventiveKitsProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [editingItem, setEditingItem] = useState<{ kitId: string; sku: string } | null>(null);
  const [editingSku, setEditingSku] = useState('');
  const [editingDescription, setEditingDescription] = useState('');
  const [editingQuantity, setEditingQuantity] = useState('1');

  const kitCatalog = useMemo(() => resolvePreventiveKitCatalog(settings), [settings]);

  const stockBySku = useMemo(
    () => new Map(items.map(item => [normalizeSku(item.sku), item])),
    [items]
  );

  const ensureEditableCatalog = (currentSettings: InventorySettings) => {
    const existingCustom = currentSettings.preventiveKits;
    const base = Array.isArray(existingCustom) && existingCustom.length > 0 ? existingCustom : kitCatalog;
    const cloned: PreventiveKitDefinition[] = base.map(kit => ({
      id: String(kit.id),
      name: String(kit.name),
      items: (kit.items || []).map(component => ({
        sku: String(component.sku),
        description: String(component.description),
        requiredQuantity: Number(component.requiredQuantity) || 1
      }))
    }));
    return cloned;
  };

  const startEdit = (kitId: string, item: PreventiveKitItem) => {
    setEditingItem({ kitId, sku: item.sku });
    setEditingSku(item.sku);
    setEditingDescription(item.description);
    setEditingQuantity(String(item.requiredQuantity));
  };

  const commitEdit = () => {
    if (!editingItem) return;
    const kitId = editingItem.kitId;
    const originalSku = editingItem.sku;
    const nextSku = normalizeSku(editingSku);
    const nextDescription = normalizeUserFacingText(editingDescription);
    const parsedQuantity = Number.parseInt(String(editingQuantity || '').trim(), 10);
    const nextQuantity = Number.isFinite(parsedQuantity) && parsedQuantity > 0 ? parsedQuantity : 0;

    if (!nextSku) {
      showToast('Informe o SKU.', 'info');
      return;
    }
    if (!nextQuantity) {
      showToast('Informe a quantidade por kit.', 'info');
      return;
    }

    const validationCatalog = ensureEditableCatalog(settings);
    const validationKit = validationCatalog.find(kit => kit.id === kitId) || null;
    if (!validationKit) {
      showToast('Kit não encontrado.', 'info');
      return;
    }
    const validationItem = validationKit.items.find(entry => normalizeSku(entry.sku) === normalizeSku(originalSku)) || null;
    if (!validationItem) {
      showToast('Item não encontrado no kit.', 'info');
      return;
    }
    const hasCollision =
      normalizeSku(originalSku) !== nextSku && validationKit.items.some(entry => normalizeSku(entry.sku) === nextSku);
    if (hasCollision) {
      showToast('Este SKU já existe neste kit.', 'info');
      return;
    }

    setSettings(previous => {
      const catalog = ensureEditableCatalog(previous);
      const kitIndex = catalog.findIndex(kit => kit.id === kitId);
      if (kitIndex < 0) return previous;

      const kit = catalog[kitIndex];
      const itemIndex = kit.items.findIndex(entry => normalizeSku(entry.sku) === normalizeSku(originalSku));
      if (itemIndex < 0) return previous;

      const nextItem: PreventiveKitItem = {
        sku: nextSku,
        description: nextDescription || kit.items[itemIndex].description,
        requiredQuantity: nextQuantity
      };
      kit.items[itemIndex] = nextItem;
      kit.items = [...kit.items];
      catalog[kitIndex] = { ...kit, items: kit.items };

      return { ...previous, preventiveKits: catalog };
    });

    showToast('Item do kit atualizado.', 'success');
    setEditingItem(null);
  };

  const removeItem = (kitId: string, sku: string) => {
    const confirmRemove = window.confirm(`Remover o SKU ${sku} deste kit?`);
    if (!confirmRemove) return;

    setSettings(previous => {
      const catalog = ensureEditableCatalog(previous);
      const kitIndex = catalog.findIndex(kit => kit.id === kitId);
      if (kitIndex < 0) return previous;

      const kit = catalog[kitIndex];
      const nextItems = kit.items.filter(entry => normalizeSku(entry.sku) !== normalizeSku(sku));
      catalog[kitIndex] = { ...kit, items: nextItems };
      return { ...previous, preventiveKits: catalog };
    });

    showToast('Item removido do kit.', 'success');
  };

  const kitSummaries = useMemo(
    () =>
      kitCatalog.map(kit => {
        const components = kit.items.map(component => {
          const item = stockBySku.get(normalizeSku(component.sku)) || null;
          const availableQuantity = item?.quantity ?? 0;
          const supportedKits = Math.floor(availableQuantity / component.requiredQuantity);

          return {
            ...component,
            item,
            availableQuantity,
            supportedKits,
            shortage: Math.max(0, component.requiredQuantity - availableQuantity)
          };
        });

        const availableKits = components.length > 0 ? Math.min(...components.map(component => component.supportedKits)) : 0;
        const limitingComponents = components.filter(component => component.supportedKits === availableKits);
        const criticalComponents = components.filter(component => component.availableQuantity < component.requiredQuantity);

        return {
          ...kit,
          components,
          availableKits,
          limitingComponents,
          criticalComponents
        };
      }),
    [kitCatalog, stockBySku]
  );

  const filteredKits = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return kitSummaries;

    return kitSummaries.filter(kit =>
      kit.name.toLowerCase().includes(query) ||
      kit.components.some(component =>
        component.sku.toLowerCase().includes(query) ||
        normalizeUserFacingText(component.description).toLowerCase().includes(query) ||
        normalizeUserFacingText(component.item?.name).toLowerCase().includes(query)
      )
    );
  }, [kitSummaries, searchQuery]);

  const totalAvailableKits = filteredKits.reduce((total, kit) => total + kit.availableKits, 0);
  const kitsAtRisk = filteredKits.filter(kit => kit.availableKits === 0).length;

  return (
    <>
      <header className="mb-6">
        <div className="flex flex-col gap-2">
          <span className="text-primary font-label text-[11px] font-semibold uppercase tracking-wider">
            Kit Preventivas
          </span>
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-on-background">
            Disponibilidade de kits preventivos
          </h1>
          <p className="text-on-surface-variant font-medium max-w-4xl">
            Esta tela calcula quantos kits completos cada modelo consegue montar hoje com base nas quantidades do estoque atual.
          </p>
        </div>
      </header>

      <section className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-outline-variant/20 bg-surface-container-lowest p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-outline">Kits monitorados</p>
              <p className="mt-2 text-3xl font-headline font-bold text-on-surface">{filteredKits.length}</p>
            </div>
            <PackageCheck className="text-primary" size={24} />
          </div>
        </div>
        <div className="rounded-2xl border border-outline-variant/20 bg-surface-container-lowest p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-outline">Kits completos hoje</p>
              <p className="mt-2 text-3xl font-headline font-bold text-primary">{totalAvailableKits}</p>
            </div>
            <Gauge className="text-primary" size={24} />
          </div>
        </div>
        <div className="rounded-2xl border border-outline-variant/20 bg-surface-container-lowest p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-outline">Modelos zerados</p>
              <p className="mt-2 text-3xl font-headline font-bold text-error">{kitsAtRisk}</p>
            </div>
            <AlertTriangle className="text-error" size={24} />
          </div>
        </div>
      </section>

      <section className="mb-6 rounded-2xl border border-outline-variant/20 bg-surface-container-lowest p-4 shadow-sm">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-outline" size={18} />
          <input
            type="text"
            value={searchQuery}
            onChange={event => setSearchQuery(event.target.value)}
            placeholder="Buscar por modelo, codigo ou descricao do item"
            className="w-full h-12 rounded-lg bg-surface-container-low pl-11 pr-4 border border-outline-variant/20 text-sm text-on-surface focus:ring-2 focus:ring-primary/30"
          />
        </div>
      </section>

      <section className="space-y-4">
        {filteredKits.map(kit => (
          <article
            key={kit.id}
            className="rounded-2xl border border-outline-variant/20 bg-surface-container-lowest p-5 shadow-sm"
          >
            <div className="flex flex-col xl:flex-row xl:items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-outline">Modelo</p>
                <h2 className="mt-1 text-2xl font-headline font-bold text-on-surface">{kit.name}</h2>
                <p className="mt-2 text-sm text-on-surface-variant">
                  Disponibilidade atual calculada pelo item mais limitante do kit.
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <div className="rounded-xl bg-surface-container-low px-4 py-3 min-w-[150px]">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-outline">Kits disponiveis</p>
                  <p className={`mt-2 text-3xl font-headline font-bold ${kit.availableKits > 0 ? 'text-primary' : 'text-error'}`}>
                    {kit.availableKits}
                  </p>
                </div>
                <div className="rounded-xl bg-surface-container-low px-4 py-3 min-w-[220px]">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-outline">Item limitante</p>
                  <p className="mt-2 text-sm font-semibold text-on-surface">
                    {kit.limitingComponents.map(component => component.sku).join(', ')}
                  </p>
                  <p className="mt-1 text-xs text-on-surface-variant">
                    {kit.limitingComponents.map(component => normalizeUserFacingText(component.item?.name || component.description)).join(' | ')}
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-3">
              {kit.components.map(component => (
                <div
                  key={`${kit.id}-${component.sku}`}
                  onClick={() => onSelectSku(component.sku)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onSelectSku(component.sku);
                    }
                  }}
                  className="rounded-xl border border-outline-variant/15 bg-surface-container-low p-4 text-left hover:bg-surface-container-high transition-colors"
                >
                  <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-bold text-outline">{component.sku}</span>
                        <span className="text-[11px] font-bold uppercase tracking-wider text-outline">
                          exige {component.requiredQuantity}
                        </span>
                        {canManagePreventiveKits && (
                          <div className="flex items-center gap-2 ml-auto">
                            <button
                              type="button"
                              onClick={event => {
                                event.stopPropagation();
                                startEdit(kit.id, component);
                              }}
                              className="h-9 px-3 rounded-lg bg-surface-container-highest text-on-surface-variant font-bold text-sm inline-flex items-center gap-2 hover:bg-surface-container-low transition-colors"
                            >
                              <Pencil size={16} />
                              Editar
                            </button>
                            <button
                              type="button"
                              onClick={event => {
                                event.stopPropagation();
                                removeItem(kit.id, component.sku);
                              }}
                              className="h-9 px-3 rounded-lg bg-error-container text-on-error-container font-bold text-sm inline-flex items-center gap-2 hover:bg-error-container/80 transition-colors"
                            >
                              <Trash2 size={16} />
                              Remover
                            </button>
                          </div>
                        )}
                      </div>
                      <h3 className="mt-2 text-base font-bold text-on-surface">
                        {normalizeUserFacingText(component.item?.name || component.description)}
                      </h3>
                      <p className="mt-1 text-sm text-on-surface-variant">
                        {component.item
                          ? `${normalizeUserFacingText(component.item.category)} • ${normalizeLocationText(component.item.location)}`
                          : 'Item ainda nao localizado na base de estoque'}
                      </p>
                    </div>

                    <div className="grid grid-cols-3 gap-3 text-center lg:min-w-[320px]">
                      <div className="rounded-lg bg-surface-container-lowest px-3 py-3">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-outline">Saldo</p>
                        <p className="mt-1 text-lg font-headline font-bold text-on-surface">{component.availableQuantity}</p>
                      </div>
                      <div className="rounded-lg bg-surface-container-lowest px-3 py-3">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-outline">Por kit</p>
                        <p className="mt-1 text-lg font-headline font-bold text-on-surface">{component.requiredQuantity}</p>
                      </div>
                      <div className="rounded-lg bg-surface-container-lowest px-3 py-3">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-outline">Suporta</p>
                        <p className={`mt-1 text-lg font-headline font-bold ${component.supportedKits > 0 ? 'text-primary' : 'text-error'}`}>
                          {component.supportedKits}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {kit.criticalComponents.length > 0 && (
              <div className="mt-4 rounded-xl border border-error/20 bg-error-container/15 px-4 py-4 text-sm text-on-surface">
                <p className="font-semibold text-error">Atencao neste kit</p>
                <p className="mt-1 text-on-surface-variant">
                  Faltam quantidades minimas para montar uma preventiva completa em:
                  {' '}
                  {kit.criticalComponents.map(component => `${component.sku} (${component.shortage})`).join(', ')}.
                </p>
              </div>
            )}
          </article>
        ))}

        {filteredKits.length === 0 && (
          <div className="rounded-2xl border border-outline-variant/20 bg-surface-container-lowest p-8 text-center text-on-surface-variant shadow-sm">
            Nenhum kit encontrado para esta busca.
          </div>
        )}
      </section>

      {editingItem && (
        <div className="fixed inset-0 z-[120] bg-black/40 flex items-end sm:items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl bg-surface-container-lowest border border-outline-variant/20 shadow-[0_18px_48px_rgba(36,52,69,0.22)] overflow-hidden">
            <div className="p-5 border-b border-outline-variant/15 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">Editar item do kit</p>
                <p className="mt-1 text-sm font-semibold text-on-surface">Kit: {editingItem.kitId}</p>
              </div>
              <button
                type="button"
                onClick={() => setEditingItem(null)}
                className="h-10 w-10 rounded-xl bg-surface-container-highest text-on-surface-variant flex items-center justify-center"
                aria-label="Fechar"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-1">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-outline">SKU</p>
                  <input
                    value={editingSku}
                    onChange={event => setEditingSku(event.target.value)}
                    className="mt-2 w-full h-12 rounded-xl px-4 bg-surface-container-lowest border border-outline-variant/20 focus:ring-2 focus:ring-primary/40 font-bold"
                    inputMode="numeric"
                  />
                </div>
                <div className="sm:col-span-2">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-outline">Descrição</p>
                  <input
                    value={editingDescription}
                    onChange={event => setEditingDescription(event.target.value)}
                    className="mt-2 w-full h-12 rounded-xl px-4 bg-surface-container-lowest border border-outline-variant/20 focus:ring-2 focus:ring-primary/40"
                  />
                </div>
              </div>

              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-outline">Quantidade por kit</p>
                <input
                  value={editingQuantity}
                  onChange={event => setEditingQuantity(event.target.value)}
                  className="mt-2 w-full h-12 rounded-xl px-4 bg-surface-container-lowest border border-outline-variant/20 focus:ring-2 focus:ring-primary/40 font-bold"
                  inputMode="numeric"
                />
              </div>

              <div className="flex flex-col sm:flex-row gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingItem(null)}
                  className="flex-1 h-12 rounded-xl bg-surface-container-highest text-on-surface-variant font-bold"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={commitEdit}
                  className="flex-1 h-12 rounded-xl bg-primary text-on-primary font-bold"
                >
                  Salvar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
