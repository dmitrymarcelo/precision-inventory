import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ChevronRight, Package, Search, Truck } from 'lucide-react';
import { InventoryItem } from '../types';
import { ProductImage } from '../productVisuals';
import { getVehicleTypeFromModel, listVehicleCatalogByType, normalizeOperationalVehicleType } from '../vehicleCatalog';
import { normalizeLocationText, normalizeUserFacingText } from '../textUtils';

interface VehiclePartsBrowserProps {
  items: InventoryItem[];
  onSelectSku: (sku: string) => void;
  presetType?: string;
  presetModel?: string;
  presetVersion?: number;
}

const EMPTY_MODEL_KEY = '__sem_modelo__';

export default function VehiclePartsBrowser({ items, onSelectSku, presetType, presetModel, presetVersion }: VehiclePartsBrowserProps) {
  const [selectedType, setSelectedType] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [itemQuery, setItemQuery] = useState('');

  const getEffectiveVehicleType = (item: InventoryItem) =>
    normalizeOperationalVehicleType(item.vehicleType || getVehicleTypeFromModel(item.vehicleModel || ''));
  const getEffectiveVehicleModel = (item: InventoryItem) => normalizeUserFacingText(item.vehicleModel || '');

  const vehicleGroups = useMemo(() => {
    const catalogGroups = listVehicleCatalogByType();
    const itemTypes = Array.from(
      new Set(items.map(item => getEffectiveVehicleType(item)).filter(Boolean))
    );
    const mergedTypes = Array.from(
      new Set([...catalogGroups.map(group => group.type), ...itemTypes])
    ).sort((first, second) => first.localeCompare(second, 'pt-BR'));

    return mergedTypes.map(type => {
      const catalogGroup = catalogGroups.find(group => group.type === type);
      return {
        type,
        entries: catalogGroup?.entries ?? []
      };
    });
  }, [items]);
  const typeCards = useMemo(
    () =>
      vehicleGroups.map(group => {
        const typeItems = items.filter(item => getEffectiveVehicleType(item) === group.type);
        const typeModelsWithItems = new Set(typeItems.map(item => getEffectiveVehicleModel(item)).filter(Boolean)).size;

        return {
          type: group.type,
          models: group.entries,
          itemCount: typeItems.length,
          modelCount: typeModelsWithItems
        };
      }),
    [items, vehicleGroups]
  );

  const selectedTypeGroup = typeCards.find(group => group.type === selectedType) || null;
  const selectedTypeItems = useMemo(
    () => items.filter(item => getEffectiveVehicleType(item) === selectedType),
    [items, selectedType]
  );

  const modelCards = useMemo(() => {
    if (!selectedTypeGroup) return [];

    const cards = selectedTypeGroup.models.map(modelEntry => {
      const modelItems = selectedTypeItems.filter(item => getEffectiveVehicleModel(item) === modelEntry.model);
      return {
        key: modelEntry.model,
        model: modelEntry.model,
        itemCount: modelItems.length
      };
    });

    const itemOnlyModels = Array.from(
      new Set(selectedTypeItems.map(item => getEffectiveVehicleModel(item)).filter(Boolean))
    ).filter(model => !cards.some(card => card.key === model));

    itemOnlyModels.forEach(model => {
      const modelItems = selectedTypeItems.filter(item => getEffectiveVehicleModel(item) === model);
      cards.push({
        key: model,
        model,
        itemCount: modelItems.length
      });
    });

    const withoutModelCount = selectedTypeItems.filter(item => !getEffectiveVehicleModel(item)).length;
    if (withoutModelCount > 0) {
      cards.push({
        key: EMPTY_MODEL_KEY,
        model: 'Sem modelo vinculado',
        itemCount: withoutModelCount
      });
    }

    return cards.sort((first, second) => {
      if (second.itemCount !== first.itemCount) return second.itemCount - first.itemCount;
      return first.model.localeCompare(second.model, 'pt-BR');
    });
  }, [selectedTypeGroup, selectedTypeItems]);

  const visibleItems = useMemo(() => {
    const query = itemQuery.trim().toLowerCase();
    const baseItems = selectedTypeItems.filter(item => {
      if (!selectedModel) return false;

      if (selectedModel === EMPTY_MODEL_KEY) {
        return !getEffectiveVehicleModel(item);
      }

      return getEffectiveVehicleModel(item) === selectedModel;
    });

    if (!query) return baseItems;

    return baseItems.filter(item =>
      item.sku.toLowerCase().includes(query) ||
      normalizeUserFacingText(item.name).toLowerCase().includes(query) ||
      normalizeLocationText(item.location).toLowerCase().includes(query) ||
      normalizeUserFacingText(item.category).toLowerCase().includes(query)
    );
  }, [itemQuery, selectedModel, selectedTypeItems]);

  const selectedModelLabel =
    selectedModel === EMPTY_MODEL_KEY ? 'Sem modelo vinculado' : normalizeUserFacingText(selectedModel);

  const openType = (type: string) => {
    setSelectedType(type);
    setSelectedModel('');
    setItemQuery('');
  };

  const openModel = (model: string) => {
    setSelectedModel(model);
    setItemQuery('');
  };

  const resetToTypes = () => {
    setSelectedType('');
    setSelectedModel('');
    setItemQuery('');
  };

  const resetToModels = () => {
    setSelectedModel('');
    setItemQuery('');
  };

  useEffect(() => {
    if (!presetVersion) return;
    if (presetType) {
      openType(presetType);
      if (presetModel) {
        openModel(presetModel);
      }
    }
  }, [presetModel, presetType, presetVersion]);

  return (
    <>
      <header className="mb-6">
        <div className="flex flex-col gap-2">
          <span className="text-primary font-label text-[11px] font-semibold uppercase tracking-wider">
            Pe\u00e7as/Modelo
          </span>
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-on-background">
            Navegacao por tipo e modelo
          </h1>
          <p className="text-on-surface-variant font-medium max-w-3xl">
            Primeiro escolha o tipo do veiculo. Depois entre no modelo para ver cada peca daquele grupo.
          </p>
        </div>
      </header>

      {!selectedType && (
        <section className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {typeCards.map(group => (
              <button
                key={group.type}
                type="button"
                onClick={() => openType(group.type)}
                className="rounded-2xl border border-outline-variant/20 bg-surface-container-lowest p-5 text-left shadow-sm hover:bg-surface-container-low transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-widest text-outline">Tipo</p>
                    <h2 className="mt-1 text-xl font-headline font-bold text-on-surface">{group.type}</h2>
                  </div>
                  <Truck className="text-primary shrink-0" size={22} />
                </div>
                <div className="mt-4 flex items-center justify-between text-sm">
                  <span className="text-on-surface-variant">{group.modelCount} modelos com peca</span>
                  <span className="font-bold text-primary">{group.itemCount} pecas</span>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {selectedType && !selectedModel && (
        <section className="space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 rounded-2xl border border-outline-variant/20 bg-surface-container-lowest p-5 shadow-sm">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-outline">Tipo selecionado</p>
              <h2 className="mt-1 text-2xl font-headline font-bold text-on-surface">{selectedType}</h2>
              <p className="mt-2 text-sm text-on-surface-variant">
                Escolha um modelo para abrir a lista especifica de pecas.
              </p>
            </div>
            <button
              type="button"
              onClick={resetToTypes}
              className="h-11 px-4 rounded-lg bg-surface-container-highest text-on-surface font-semibold flex items-center justify-center gap-2"
            >
              <ArrowLeft size={18} />
              Voltar para tipos
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {modelCards.map(modelCard => (
              <button
                key={modelCard.key}
                type="button"
                onClick={() => openModel(modelCard.key)}
                className="rounded-2xl border border-outline-variant/20 bg-surface-container-lowest p-5 text-left shadow-sm hover:bg-surface-container-low transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold uppercase tracking-widest text-outline">Modelo</p>
                    <h3 className="mt-1 text-lg font-headline font-bold text-on-surface line-clamp-2">
                      {modelCard.model}
                    </h3>
                  </div>
                  <ChevronRight className="text-primary shrink-0" size={20} />
                </div>
                <p className="mt-4 text-sm font-semibold text-primary">{modelCard.itemCount} pecas</p>
              </button>
            ))}
          </div>
        </section>
      )}

      {selectedType && selectedModel && (
        <section className="space-y-4">
          <div className="rounded-2xl border border-outline-variant/20 bg-surface-container-lowest p-5 shadow-sm">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-outline">Filtro atual</p>
                <h2 className="mt-1 text-2xl font-headline font-bold text-on-surface">
                  {selectedType} <span className="text-outline">/</span> {selectedModelLabel}
                </h2>
                <p className="mt-2 text-sm text-on-surface-variant">
                  Toque em uma peca para abrir o SKU direto na area de Estoque.
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  type="button"
                  onClick={resetToModels}
                  className="h-11 px-4 rounded-lg bg-surface-container-highest text-on-surface font-semibold flex items-center justify-center gap-2"
                >
                  <ArrowLeft size={18} />
                  Voltar para modelos
                </button>
                <button
                  type="button"
                  onClick={resetToTypes}
                  className="h-11 px-4 rounded-lg bg-surface-container-highest text-on-surface font-semibold"
                >
                  Trocar tipo
                </button>
              </div>
            </div>

            <div className="mt-4 relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-outline" size={18} />
              <input
                type="text"
                value={itemQuery}
                onChange={event => setItemQuery(event.target.value)}
                placeholder="Buscar por SKU, nome, categoria ou localizacao"
                className="w-full h-12 rounded-lg bg-surface-container-low pl-11 pr-4 border border-outline-variant/20 text-sm text-on-surface focus:ring-2 focus:ring-primary/30"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3">
            {visibleItems.length > 0 ? (
              visibleItems.map(item => (
                <button
                  key={`${selectedType}-${selectedModel}-${item.sku}`}
                  type="button"
                  onClick={() => onSelectSku(item.sku)}
                  className="rounded-2xl border border-outline-variant/20 bg-surface-container-lowest p-4 text-left shadow-sm hover:bg-surface-container-low transition-colors"
                >
                  <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
                    <div className="min-w-0 flex gap-3">
                      <ProductImage item={item} size="card" />
                      <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <Package className="text-primary shrink-0" size={18} />
                        <span className="font-mono text-xs font-bold text-outline">{item.sku}</span>
                      </div>
                      <h3 className="text-lg font-bold text-on-surface">{normalizeUserFacingText(item.name)}</h3>
                      <p className="mt-1 text-sm text-on-surface-variant">
                        {normalizeUserFacingText(item.category)} • {normalizeLocationText(item.location)}
                      </p>
                    </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-2xl font-headline font-bold text-primary">{item.quantity}</p>
                      <p className="text-[11px] font-bold uppercase tracking-wider text-outline">unidades</p>
                    </div>
                  </div>
                </button>
              ))
            ) : (
              <div className="rounded-2xl border border-outline-variant/20 bg-surface-container-lowest p-8 text-center text-on-surface-variant shadow-sm">
                Nenhuma peca encontrada para este modelo com o filtro atual.
              </div>
            )}
          </div>
        </section>
      )}
    </>
  );
}
