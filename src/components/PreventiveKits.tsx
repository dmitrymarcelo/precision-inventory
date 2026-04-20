import React, { useMemo, useState } from 'react';
import { AlertTriangle, Gauge, PackageCheck, Search } from 'lucide-react';
import { InventoryItem } from '../types';
import { preventiveKitCatalog } from '../preventiveKitCatalog';
import { normalizeLocationText, normalizeUserFacingText } from '../textUtils';

interface PreventiveKitsProps {
  items: InventoryItem[];
  onSelectSku: (sku: string) => void;
}

function normalizeSku(value: string) {
  const text = String(value || '').trim();
  if (/^\d+$/.test(text) && text.length < 5) {
    return text.padStart(5, '0');
  }
  return text;
}

export default function PreventiveKits({ items, onSelectSku }: PreventiveKitsProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const stockBySku = useMemo(
    () => new Map(items.map(item => [normalizeSku(item.sku), item])),
    [items]
  );

  const kitSummaries = useMemo(
    () =>
      preventiveKitCatalog.map(kit => {
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
    [stockBySku]
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
                <button
                  key={`${kit.id}-${component.sku}`}
                  type="button"
                  onClick={() => onSelectSku(component.sku)}
                  className="rounded-xl border border-outline-variant/15 bg-surface-container-low p-4 text-left hover:bg-surface-container-high transition-colors"
                >
                  <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-outline">{component.sku}</span>
                        <span className="text-[11px] font-bold uppercase tracking-wider text-outline">
                          exige {component.requiredQuantity}
                        </span>
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
                </button>
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
    </>
  );
}
