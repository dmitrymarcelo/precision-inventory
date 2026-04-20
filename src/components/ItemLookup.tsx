import React, { useState } from 'react';
import { ScanBarcode, Search, Info, History, Package, CheckCircle2, AlertTriangle, ArrowRight, MapPin } from 'lucide-react';
import { InventoryItem } from '../types';
import { normalizeLocationText, normalizeUserFacingText } from '../textUtils';

export default function ItemLookup({
  setActiveTab,
  showToast,
  items,
  onSelectSku
}: {
  setActiveTab: (tab: string) => void,
  showToast: (m: string, t?: 'success'|'info') => void,
  items: InventoryItem[],
  onSelectSku: (sku: string) => void
}) {
  const [productCode, setProductCode] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<InventoryItem | null>(null);
  const [recentSearch, setRecentSearch] = useState('SKU-992-XJ21');

  const handleSearch = () => {
    if (!productCode.trim()) {
      showToast('Por favor, insira um código de produto para buscar.', 'info');
      return;
    }

    setIsSearching(true);
    setSearchResult(null);

    setTimeout(() => {
      setIsSearching(false);
      const sku = productCode.trim().toUpperCase();
      setRecentSearch(sku);

      const foundItem = items.find(
        item =>
          item.sku.toUpperCase() === sku ||
          normalizeUserFacingText(item.name).toUpperCase().includes(sku)
      );

      if (foundItem) {
        setSearchResult(foundItem);
        showToast('Item encontrado no sistema.', 'success');
      } else {
        showToast('Nenhum item encontrado com este código.', 'info');
      }
    }, 800);
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
      <section className="md:col-span-8 bg-surface-container-lowest rounded-xl p-8 shadow-[0_8px_24px_rgba(36,52,69,0.04)] flex flex-col gap-8">
        <header>
          <span className="text-xs font-semibold uppercase tracking-widest text-primary mb-2 block">Verificação de Estoque</span>
          <h2 className="text-3xl font-bold tracking-tight text-on-surface">Busca de Item</h2>
        </header>
        <div className="space-y-6">
          <div className="relative group">
            <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2" htmlFor="product_code">
              Digite o Código do Produto ou Nome
            </label>
            <div className="relative">
              <ScanBarcode className="absolute left-4 top-1/2 -translate-y-1/2 text-outline" size={24} />
              <input
                className="w-full h-16 pl-14 pr-6 bg-surface-container-highest border-none rounded-lg text-xl font-mono tracking-wider focus:ring-2 focus:ring-primary/40 focus:bg-surface-container-lowest transition-all"
                id="product_code"
                placeholder="Ex.: 01074 ou CATALISADOR"
                type="text"
                value={productCode}
                onChange={(e) => setProductCode(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              />
            </div>
          </div>
          <button
            onClick={handleSearch}
            disabled={isSearching}
            className="w-full h-14 bg-gradient-to-br from-primary to-primary-dim text-on-primary font-bold rounded-lg shadow-lg flex items-center justify-center gap-3 active:scale-[0.98] transition-transform disabled:opacity-70"
          >
            {isSearching ? (
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
            ) : (
              <Search size={20} />
            )}
            {isSearching ? 'Buscando...' : 'Buscar no Armazém'}
          </button>
        </div>
      </section>

      <aside className="md:col-span-4 flex flex-col gap-6">
        <div className="bg-primary-container/30 p-6 rounded-xl border border-primary-container/50">
          <h3 className="font-bold text-on-primary-container flex items-center gap-2 mb-3">
            <Info size={20} />
            Dicas do Scanner
          </h3>
          <p className="text-sm text-on-primary-container/80 leading-relaxed">
            Segure seu dispositivo a 15cm da etiqueta para um reconhecimento ideal. Certifique-se de que a área está bem iluminada para a detecção do QR Code.
          </p>
        </div>
        <div className="bg-surface-container-low p-6 rounded-xl border border-outline-variant/10 flex items-center gap-4">
          <div className="w-12 h-12 bg-surface-container-lowest rounded-lg flex items-center justify-center shadow-sm shrink-0">
            <History className="text-primary" size={24} />
          </div>
          <div>
            <p className="text-xs font-bold text-on-surface-variant uppercase tracking-tighter">Busca Recente</p>
            <p className="text-sm font-semibold text-on-surface">{recentSearch}</p>
          </div>
        </div>
      </aside>

      <section className="md:col-span-12">
        {isSearching ? (
          <div className="relative overflow-hidden bg-surface-container-low/50 border border-outline-variant/10 rounded-2xl min-h-[400px] flex flex-col items-center justify-center text-center p-12">
            <div className="relative z-10">
              <div className="w-24 h-24 bg-surface-container-highest rounded-full flex items-center justify-center mb-6 mx-auto animate-pulse">
                <Search className="text-primary" size={48} />
              </div>
              <h3 className="text-2xl font-bold text-on-surface mb-2">Buscando no banco de dados...</h3>
              <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-4 opacity-40">
                <div className="h-2 w-full bg-outline-variant rounded-full animate-pulse"></div>
                <div className="h-2 w-full bg-outline-variant rounded-full animate-pulse delay-75"></div>
                <div className="h-2 w-full bg-outline-variant rounded-full animate-pulse delay-150"></div>
                <div className="h-2 w-full bg-outline-variant rounded-full animate-pulse delay-200"></div>
              </div>
            </div>
          </div>
        ) : searchResult ? (
          <div className="bg-surface-container-lowest border border-outline-variant/20 rounded-2xl p-8 shadow-sm flex flex-col md:flex-row gap-8 items-start animate-in fade-in slide-in-from-bottom-4">
            <div className="w-32 h-32 bg-surface-container-highest rounded-xl flex items-center justify-center shrink-0">
              <Package className="text-primary" size={64} />
            </div>
            <div className="flex-1 w-full">
              <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-6">
                <div>
                  <span className="text-xs font-bold text-primary uppercase tracking-widest mb-1 block">SKU: {searchResult.sku}</span>
                  <h3 className="text-2xl font-bold text-on-surface mb-2">{normalizeUserFacingText(searchResult.name)}</h3>
                  <span className="inline-block bg-surface-container-low px-3 py-1 rounded-md text-sm font-medium text-on-surface-variant">
                    {normalizeUserFacingText(searchResult.category)}
                  </span>
                </div>
                <div className="text-left md:text-right">
                  <span className="text-sm font-bold text-on-surface-variant uppercase tracking-widest block mb-1">Estoque Atual</span>
                  <div className={`text-4xl font-extrabold ${searchResult.quantity === 0 ? 'text-error' : searchResult.quantity < 20 ? 'text-primary' : 'text-on-surface'}`}>
                    {searchResult.quantity} <span className="text-base font-medium opacity-70">un</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
                <div className="bg-surface-container-low p-4 rounded-lg flex items-center gap-3">
                  <MapPin className="text-outline" size={20} />
                  <div>
                    <span className="text-[10px] font-bold uppercase text-outline block">Localização</span>
                    <span className="font-semibold text-on-surface">{normalizeLocationText(searchResult.location)}</span>
                  </div>
                </div>
                <div className={`p-4 rounded-lg flex items-center gap-3 ${
                  normalizeUserFacingText(searchResult.status) === 'Estoque Crítico' ? 'bg-error-container/50 text-on-error-container' :
                  normalizeUserFacingText(searchResult.status) === 'Repor em Breve' ? 'bg-surface-container-highest text-on-primary-container' :
                  'bg-primary-container/30 text-on-primary-container'
                }`}>
                  {normalizeUserFacingText(searchResult.status) === 'Estoque Crítico' ? <AlertTriangle size={20} /> : <CheckCircle2 size={20} />}
                  <div>
                    <span className="text-[10px] font-bold uppercase opacity-70 block">Status</span>
                    <span className="font-semibold">{normalizeUserFacingText(searchResult.status)}</span>
                  </div>
                </div>
              </div>

              <button
                onClick={() => onSelectSku(searchResult.sku)}
                className="w-full md:w-auto bg-primary text-on-primary px-8 py-4 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-primary-dim transition-colors"
              >
                Atualizar Estoque deste Item
                <ArrowRight size={20} />
              </button>
            </div>
          </div>
        ) : (
          <div className="relative overflow-hidden bg-surface-container-low/50 border border-outline-variant/10 rounded-2xl min-h-[400px] flex flex-col items-center justify-center text-center p-12">
            <div className="absolute inset-0 z-0 opacity-10">
              <img
                className="w-full h-full object-cover"
                src="https://lh3.googleusercontent.com/aida-public/AB6AXuBL0xSHmhSSZj8FrcuVwTcOpyaULeWTSOjCxjBLESVLoQNR1Jh0oVafONBSd8uJ96Lzjm4wmEPK8rAcawzQ8ZzD9ND5l8HkcXBkymNUE5lvr5bFwfvExMs9KuB8LqTBQPuCtOEKOclAli8uMWc6XwDFdGmwaXz37F9H9mYgbRHcEF2VimKe-ij06r-wk5DeEe9J7-cA7vH8rDNE-qGbCH0wyNXAbgkr9Y7Q19AEHmkIctSPuTyw0HzTah_dkkAPNb3OMJk0y8Pqq329"
                alt="Armazém"
              />
            </div>
            <div className="relative z-10">
              <div className="w-24 h-24 bg-surface-container-highest rounded-full flex items-center justify-center mb-6 mx-auto">
                <Package className="text-outline-variant" size={48} />
              </div>
              <h3 className="text-2xl font-bold text-on-surface mb-2">Detalhes do Item</h3>
              <p className="text-on-surface-variant max-w-md mx-auto leading-relaxed">
                Busque por um código de item acima para ver as especificações técnicas, níveis de estoque atuais e localização no armazém.
              </p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
