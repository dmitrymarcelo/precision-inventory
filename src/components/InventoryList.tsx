import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Circle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  Filter,
  MapPin,
  Package,
  Printer,
  Search,
  Tag,
  Upload,
  Warehouse,
  X
} from 'lucide-react';
import { readSheet } from 'read-excel-file/browser';
import { openBarcodePrintWindow } from '../barcodeLabels';
import { classifyInventoryCategory } from '../categoryCatalog';
import { ProductImage } from '../productVisuals';
import { InventoryItem, InventorySettings } from '../types';
import { calculateInventoryStatus, calculateItemStatus } from '../inventoryRules';
import { getVehicleTypeFromModel, normalizeOfficialVehicleModel, normalizeOperationalVehicleType } from '../vehicleCatalog';
import { normalizeInventoryStatus, normalizeLocationText, normalizeUserFacingText } from '../textUtils';

interface InventoryListProps {
  showToast: (message: string, type?: 'success' | 'info') => void;
  canEdit: boolean;
  items: InventoryItem[];
  setItems: React.Dispatch<React.SetStateAction<InventoryItem[]>>;
  onSelectSku: (sku: string) => void;
  settings: InventorySettings;
  externalSearchQuery?: string;
  onExternalSearchQueryChange?: (value: string) => void;
}

const ACTIVE_ONLY_FILTER_TOKEN = 'active-only';

export default function InventoryList({
  showToast,
  canEdit,
  items,
  setItems,
  onSelectSku,
  settings,
  externalSearchQuery = '',
  onExternalSearchQueryChange
}: InventoryListProps) {
  const MAX_VISIBLE_LABEL_SELECTION_ITEMS = 160;
  const getEffectiveVehicleType = (item: InventoryItem) =>
    normalizeOperationalVehicleType(item.vehicleType || getVehicleTypeFromModel(item.vehicleModel || ''));
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeOnly, setActiveOnly] = useState(false);
  const [isLabelsOpen, setIsLabelsOpen] = useState(false);
  const [selectedLabelSkus, setSelectedLabelSkus] = useState<string[]>([]);
  const [labelSelectionQuery, setLabelSelectionQuery] = useState('');
  const [isPreparingLabels, setIsPreparingLabels] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const itemsPerPage = 100;

  const activeItems = useMemo(() => items.filter(item => item.isActiveInWarehouse === true), [items]);
  const activeSkuCount = activeItems.length;
  const activeUnitTotal = useMemo(
    () => activeItems.reduce((sum, item) => sum + (Number.isFinite(item.quantity) ? item.quantity : 0), 0),
    [activeItems]
  );

  const filteredItems = useMemo(
    () =>
      items.filter(item => {
        if (activeOnly && item.isActiveInWarehouse !== true) return false;

        const query = searchQuery.toLowerCase();
        return (
          normalizeUserFacingText(item.name).toLowerCase().includes(query) ||
          item.sku.toLowerCase().includes(query) ||
          item.category.toLowerCase().includes(query) ||
          normalizeUserFacingText(item.vehicleModel).toLowerCase().includes(query) ||
          getEffectiveVehicleType(item).toLowerCase().includes(query) ||
          item.location.toLowerCase().includes(query)
        );
      }),
    [activeOnly, items, searchQuery]
  );

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / itemsPerPage));
  const paginatedItems = filteredItems.slice((page - 1) * itemsPerPage, page * itemsPerPage);
  const filteredSkuSet = useMemo(() => new Set(filteredItems.map(item => item.sku)), [filteredItems]);
  const selectedLabelSkuSet = useMemo(() => new Set(selectedLabelSkus), [selectedLabelSkus]);
  const selectedLabelItems = useMemo(
    () => filteredItems.filter(item => selectedLabelSkuSet.has(item.sku)),
    [filteredItems, selectedLabelSkuSet]
  );
  const labelSelectionItems = useMemo(() => {
    const query = labelSelectionQuery.trim().toLowerCase();
    if (!query) return filteredItems;

    return filteredItems.filter(item =>
      item.sku.toLowerCase().includes(query) ||
      item.name.toLowerCase().includes(query)
    );
  }, [filteredItems, labelSelectionQuery]);
  const visibleLabelSelectionItems = useMemo(
    () => labelSelectionItems.slice(0, MAX_VISIBLE_LABEL_SELECTION_ITEMS),
    [labelSelectionItems]
  );
  const hiddenLabelSelectionCount = Math.max(0, labelSelectionItems.length - visibleLabelSelectionItems.length);

  useEffect(() => {
    setPage(currentPage => Math.min(currentPage, totalPages));
  }, [totalPages]);

  useEffect(() => {
    if (externalSearchQuery === ACTIVE_ONLY_FILTER_TOKEN) {
      setActiveOnly(true);
      setSearchQuery('');
      setPage(1);
      return;
    }

    setSearchQuery(externalSearchQuery);
    setPage(1);
  }, [externalSearchQuery]);

  useEffect(() => {
    setPage(1);
  }, [activeOnly]);

  useEffect(() => {
    if (!isLabelsOpen) return;
    setSelectedLabelSkus(current => current.filter(sku => filteredSkuSet.has(sku)));
  }, [filteredSkuSet, isLabelsOpen]);

  const handleFilterClick = () => {
    showToast('Os filtros avançados entram no próximo ajuste.', 'info');
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      showToast(`Lendo ${file.name}...`, 'info');
      const extension = file.name.split('.').pop()?.toLowerCase();
      let rows: unknown[][];

      if (extension === 'xlsx' || extension === 'xls') {
        rows = await readXlsxInventoryFile(file);
      } else if (extension === 'csv') {
        rows = await readCsvFile(file);
      } else {
        showToast('Selecione um arquivo .xlsx ou .csv válido.', 'info');
        return;
      }

      const imported = parseInventoryRows(rows, settings);
      if (imported.items.length === 0) {
        showToast('Nenhum item válido foi encontrado no arquivo.', 'info');
        return;
      }

      if (imported.format === 'browse' && items.length > 0) {
        const importedBySku = new Map(imported.items.map(item => [item.sku, item]));
        const existingSkuSet = new Set(items.map(item => item.sku));

        const updatedSkus = Array.from(importedBySku.keys()).filter(sku => existingSkuSet.has(sku));
        const newItems = Array.from(importedBySku.values()).filter(item => !existingSkuSet.has(item.sku));

        setItems(previous => [
          ...previous.map(item => {
            const incoming = importedBySku.get(item.sku);
            if (!incoming) return item;

            return mergeInventoryConferenceItem(item, incoming, settings);
          }),
          ...newItems
        ]);

        showToast(
          `Conferencia aplicada: ${updatedSkus.length} SKUs atualizados e ${newItems.length} novos SKUs adicionados ao estoque.`,
          'success'
        );
      } else {
        setItems(imported.items);
        showToast(`Planilha importada com sucesso. ${imported.items.length} itens carregados.`, 'success');
      }

      setPage(1);
      setSearchQuery('');
      onExternalSearchQueryChange?.('');
    } catch (error) {
      showToast(getInventoryImportErrorMessage(error), 'info');
    } finally {
      event.target.value = '';
    }
  };

  const handleExportCsv = () => {
    if (filteredItems.length === 0) {
      showToast('Não há itens para exportar nesta lista.', 'info');
      return;
    }

    const headers = [
      'SKU',
      'Nome do Item',
      'Imagem URL',
      'Modelo do Veiculo',
      'Tipo do Veiculo',
      'Quantidade Atual',
      'Categoria',
      'Localização',
      'Status',
      'Limite Crítico',
      'Limite de Reposição'
    ];

    const rows = filteredItems.map(item => [
      item.sku,
      item.name,
      item.imageUrl || '',
      normalizeUserFacingText(item.vehicleModel),
      getEffectiveVehicleType(item),
      String(item.quantity),
      item.category,
      item.location,
      item.status,
      String(item.alertCriticalLimit ?? settings.criticalLimit),
      String(item.alertReorderLimit ?? settings.reorderLimit)
    ]);

    const csv = [headers, ...rows].map(columns => columns.map(escapeCsvValue).join(';')).join('\r\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

    link.href = url;
    link.download = `inventario-${stamp}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showToast(`Exportação concluída. ${filteredItems.length} itens enviados para a planilha.`, 'success');
  };

  const handleOpenLabels = () => {
    if (filteredItems.length === 0) {
      showToast('Não há itens na lista atual para gerar etiquetas.', 'info');
      return;
    }

    setSelectedLabelSkus(paginatedItems.map(item => item.sku));
    setLabelSelectionQuery('');
    setIsLabelsOpen(true);
  };

  const handlePrintLabels = async () => {
    if (selectedLabelItems.length === 0) {
      showToast('Não há etiquetas para imprimir nesta lista.', 'info');
      return;
    }

    if (selectedLabelItems.length > 120) {
      showToast('Para usar QR Code sem travar o navegador, faça uma seleção menor de etiquetas.', 'info');
      return;
    }

    const title = searchQuery
      ? `Etiquetas do estoque - filtro ${searchQuery}`
      : 'Etiquetas do estoque';

    const subtitle = `Seleção atual com ${selectedLabelItems.length} etiquetas em QR Code`;

    setIsPreparingLabels(true);
    const opened = await openBarcodePrintWindow(selectedLabelItems, { title, subtitle }).finally(
      () => setIsPreparingLabels(false)
    );
    if (!opened) {
      showToast('Libere a abertura de pop-up para imprimir as etiquetas.', 'info');
      return;
    }

    showToast(`Preparando ${selectedLabelItems.length} etiquetas em QR Code.`, 'success');
  };

  const toggleLabelSelection = (sku: string) => {
    setSelectedLabelSkus(current =>
      current.includes(sku) ? current.filter(value => value !== sku) : [...current, sku]
    );
  };

  const selectCurrentPageLabels = () => {
    const pageSkus = paginatedItems.map(item => item.sku);
    setSelectedLabelSkus(current => Array.from(new Set([...current, ...pageSkus])));
  };

  const selectAllFilteredLabels = () => {
    setSelectedLabelSkus(filteredItems.map(item => item.sku));
  };

  const clearSelectedLabels = () => {
    setSelectedLabelSkus([]);
  };

  const selectVisibleLabelResults = () => {
    setSelectedLabelSkus(current =>
      Array.from(new Set([...current, ...visibleLabelSelectionItems.map(item => item.sku)]))
    );
  };

  return (
    <>
      <header className="mb-6">
        <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-6">
          <div className="xl:max-w-3xl">
            <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-on-background mb-2">
              Central de Estoque
            </h1>
            <p className="text-on-surface-variant font-medium">
              Importe o modelo mata225, consulte os SKUs e gere etiquetas prontas para impressão.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:flex xl:flex-wrap items-start xl:items-center gap-3 xl:justify-end">
            <div className="bg-primary-container text-on-primary-container px-4 py-2 rounded-xl flex items-center gap-2">
              <span className="text-xs font-label font-bold uppercase tracking-widest">Contagem de SKUs</span>
              <span className="text-2xl font-headline font-bold">{items.length}</span>
            </div>

            <div className="bg-surface-container-highest text-primary px-4 py-2 rounded-xl flex items-center gap-2">
              <CheckCircle2 size={18} />
              <div className="flex flex-col">
                <span className="text-xs font-label font-bold uppercase tracking-widest">Ativos</span>
                <span className="text-sm font-semibold text-on-surface">
                  {activeSkuCount} SKUs • {activeUnitTotal} un
                </span>
              </div>
            </div>

            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              ref={fileInputRef}
              onChange={handleFileUpload}
            />

            <button
              type="button"
              onClick={() => {
                if (!canEdit) {
                  showToast('Modo consulta: sem permissão para importar planilhas.', 'info');
                  return;
                }
                fileInputRef.current?.click();
              }}
              disabled={!canEdit}
              className="bg-surface-container-highest text-primary px-4 py-2 rounded-xl flex items-center justify-center gap-2 hover:bg-surface-container-high transition-colors font-semibold shadow-sm whitespace-nowrap disabled:opacity-60 disabled:hover:bg-surface-container-highest"
            >
              <Upload size={18} />
              Importar XLSX/CSV
            </button>

            <button
              type="button"
              onClick={handleExportCsv}
              className="bg-surface-container-highest text-primary px-4 py-2 rounded-xl flex items-center justify-center gap-2 hover:bg-surface-container-high transition-colors font-semibold shadow-sm whitespace-nowrap"
            >
              <Download size={18} />
              Exportar CSV
            </button>

            <button
              type="button"
              onClick={handleOpenLabels}
              className="bg-primary text-on-primary px-4 py-2 rounded-xl flex items-center justify-center gap-2 hover:bg-primary/90 transition-colors font-semibold shadow-sm whitespace-nowrap"
            >
              <Tag size={18} />
              Etiquetas
            </button>
          </div>
        </div>
      </header>

      {isLabelsOpen && (
        <section className="mb-6 rounded-2xl border border-outline-variant/20 bg-surface-container-lowest shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-outline-variant/15 flex flex-col lg:flex-row lg:items-start justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-primary-container px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-on-primary-container mb-3">
                <Tag size={14} />
                QR Code
              </div>
              <h2 className="font-headline text-2xl font-bold tracking-tight text-on-surface">Etiquetas em QR Code</h2>
              <p className="text-sm text-on-surface-variant mt-2 max-w-3xl">
                O painel de etiquetas agora trabalha só com seleção e impressão em QR Code para manter o fluxo mais leve.
              </p>
            </div>

            <div className="flex flex-wrap gap-2 items-center">
              <button
                type="button"
                onClick={() => void handlePrintLabels()}
                disabled={isPreparingLabels}
                className="h-11 px-4 rounded-lg bg-primary text-on-primary font-bold flex items-center gap-2 disabled:opacity-60"
              >
                <Printer size={18} />
                {isPreparingLabels ? 'Preparando...' : 'Imprimir selecionadas'}
              </button>
              <button
                type="button"
                onClick={() => setIsLabelsOpen(false)}
                className="h-11 px-4 rounded-lg bg-surface-container-highest text-on-surface font-semibold flex items-center gap-2"
              >
                <X size={18} />
                Fechar
              </button>
            </div>
          </div>

          <div className="px-5 py-4 bg-surface-container-low/60 border-b border-outline-variant/15 grid gap-3 md:grid-cols-3">
            <div className="rounded-xl bg-surface-container-lowest px-4 py-3">
              <p className="text-[11px] font-bold uppercase tracking-widest text-outline">Etiquetas na lista</p>
              <p className="mt-1 text-2xl font-headline font-bold text-on-surface">{filteredItems.length}</p>
            </div>
            <div className="rounded-xl bg-surface-container-lowest px-4 py-3">
              <p className="text-[11px] font-bold uppercase tracking-widest text-outline">Selecionadas agora</p>
              <p className="mt-1 text-sm font-semibold text-on-surface">
                {selectedLabelItems.length} etiquetas marcadas para impressão
              </p>
            </div>
            <div className="rounded-xl bg-surface-container-lowest px-4 py-3">
              <p className="text-[11px] font-bold uppercase tracking-widest text-outline">Impressoras do sistema</p>
              <p className="mt-1 text-sm font-semibold text-on-surface">
                O diálogo de impressão do navegador mostra as impressoras instaladas no Windows.
              </p>
            </div>
          </div>

          <div className="p-5">
            <div className="flex flex-wrap gap-2 mb-4">
              <button
                type="button"
                onClick={selectCurrentPageLabels}
                className="h-10 px-4 rounded-lg bg-surface-container-highest text-primary font-semibold"
              >
                Selecionar página atual
              </button>
              <button
                type="button"
                onClick={selectVisibleLabelResults}
                className="h-10 px-4 rounded-lg bg-surface-container-highest text-primary font-semibold"
              >
                Selecionar busca
              </button>
              <button
                type="button"
                onClick={selectAllFilteredLabels}
                className="h-10 px-4 rounded-lg bg-surface-container-highest text-primary font-semibold"
              >
                Selecionar lista filtrada
              </button>
              <button
                type="button"
                onClick={clearSelectedLabels}
                className="h-10 px-4 rounded-lg bg-surface-container-highest text-on-surface font-semibold"
              >
                Limpar seleção
              </button>
            </div>

            <div className="grid gap-5">
              <div className="rounded-xl border border-outline-variant/15 bg-surface-container-low p-4">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div>
                    <p className="text-sm font-semibold text-on-surface">Escolha as etiquetas</p>
                    <p className="text-xs text-on-surface-variant">
                      Ao abrir, a página atual já vem marcada e não existe preview na tela para evitar travamento.
                    </p>
                  </div>
                  <span className="text-xs font-bold text-primary">{selectedLabelItems.length} selecionadas</span>
                </div>

                <div className="relative mb-3">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-outline" size={16} />
                  <input
                    type="text"
                    value={labelSelectionQuery}
                    onChange={event => setLabelSelectionQuery(event.target.value)}
                    placeholder="Buscar pelo SKU da etiqueta"
                    className="w-full h-10 rounded-lg border border-outline-variant/20 bg-surface-container-lowest pl-10 pr-3 text-sm text-on-surface focus:ring-2 focus:ring-primary/30"
                  />
                </div>

                <div className="max-h-[420px] overflow-y-auto pr-1 space-y-2">
                  {visibleLabelSelectionItems.map(item => {
                    const checked = selectedLabelSkuSet.has(item.sku);

                    return (
                      <label
                        key={`label-select-${item.sku}`}
                        className={`flex items-start gap-3 rounded-lg border px-3 py-3 cursor-pointer transition-colors ${
                          checked
                            ? 'bg-primary-container/20 border-primary/30'
                            : 'bg-surface-container-lowest border-outline-variant/15 hover:bg-surface-container-highest/50'
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4 rounded border-outline-variant/30 text-primary focus:ring-primary/30"
                          checked={checked}
                          onChange={() => toggleLabelSelection(item.sku)}
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-on-surface">{item.sku}</p>
                  <p className="text-xs text-on-surface-variant line-clamp-2">{normalizeUserFacingText(item.name)}</p>
                  <p className="text-[11px] text-on-surface-variant mt-1">{normalizeLocationText(item.location)}</p>
                        </div>
                      </label>
                    );
                  })}

                  {labelSelectionItems.length === 0 && (
                    <div className="rounded-lg bg-surface-container-lowest px-3 py-5 text-center text-sm text-on-surface-variant">
                      Nenhum SKU encontrado para esta busca.
                    </div>
                  )}
                </div>

                {hiddenLabelSelectionCount > 0 && (
                  <div className="mt-3 rounded-lg bg-surface-container-lowest px-3 py-3 text-xs text-on-surface-variant">
                    Mostrando os primeiros {visibleLabelSelectionItems.length} resultados para evitar travamento.
                    Refine a busca para encontrar os demais {hiddenLabelSelectionCount} itens.
                  </div>
                )}
                <div className="mt-4 rounded-xl border border-outline-variant/15 bg-surface-container-lowest p-4 text-sm text-on-surface-variant">
                  <p className="font-semibold text-on-surface">Modo leve de etiquetas</p>
                  <p className="mt-2">
                    O preview foi removido desta tela para evitar travamento. Aqui você só seleciona os SKUs e manda imprimir.
                  </p>
                  <p className="mt-2">
                    Dica: use a busca para separar por família, localização ou SKU antes de imprimir.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      <section className="mb-6">
        <div className="bg-surface-container-low rounded-2xl p-3 lg:p-4 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_auto] gap-3 items-center">
          <div className="relative w-full">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-outline" size={20} />
            <input
              className="w-full pl-12 pr-4 py-3 bg-surface-container-lowest border-none rounded-lg focus:ring-2 focus:ring-primary/40 placeholder:text-outline text-on-surface font-body shadow-sm"
              placeholder="Buscar por SKU, nome, grupo, modelo, tipo ou localizacao..."
              type="text"
              value={searchQuery}
              onChange={event => {
                setSearchQuery(event.target.value);
                onExternalSearchQueryChange?.(event.target.value);
                setPage(1);
              }}
            />
          </div>

          <div className="grid grid-cols-3 gap-2 w-full xl:w-auto">
            <button
              type="button"
              onClick={handleFilterClick}
              className="flex items-center justify-center gap-2 bg-surface-container-highest px-4 py-3 rounded-lg text-on-surface-variant font-semibold hover:bg-surface-container-high transition-colors whitespace-nowrap"
            >
              <Filter size={20} />
              Categoria
            </button>
            <button
              type="button"
              onClick={handleFilterClick}
              className="flex items-center justify-center gap-2 bg-surface-container-highest px-4 py-3 rounded-lg text-on-surface-variant font-semibold hover:bg-surface-container-high transition-colors whitespace-nowrap"
            >
              <MapPin size={20} />
              Seção
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveOnly(current => {
                  const next = !current;
                  onExternalSearchQueryChange?.(next ? ACTIVE_ONLY_FILTER_TOKEN : searchQuery);
                  return next;
                });
                const message = `Ativos apontados: ${activeSkuCount} SKUs (total ${activeUnitTotal} unidades).`;
                showToast(message, 'success');
              }}
              className={`flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-semibold transition-colors whitespace-nowrap ${
                activeOnly
                  ? 'bg-primary text-on-primary hover:bg-primary/90'
                  : 'bg-surface-container-highest text-on-surface-variant hover:bg-surface-container-high'
              }`}
            >
              <CheckCircle2 size={20} />
              Ativo
            </button>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-0 overflow-hidden rounded-2xl bg-surface-container-low">
        <div className="hidden md:grid md:grid-cols-12 xl:grid-cols-[120px_minmax(0,1.7fr)_150px_minmax(220px,1fr)_170px] xl:[&>div]:col-span-1 gap-4 px-6 py-4 bg-surface-container-high text-xs font-label font-bold uppercase tracking-widest text-on-surface-variant">
          <div className="col-span-2 xl:col-span-1">SKU</div>
          <div className="col-span-4">Identificação do Item</div>
          <div className="col-span-2">Quantidade</div>
          <div className="col-span-2">Localização / Prateleira</div>
          <div className="col-span-2 text-right">Status</div>
        </div>

        {paginatedItems.length > 0 ? (
          paginatedItems.map((item, index) => (
            <div
              key={`${item.sku}-${index}`}
              onClick={() => onSelectSku(item.sku)}
              className="grid grid-cols-1 md:grid-cols-12 xl:grid-cols-[120px_minmax(0,1.7fr)_150px_minmax(220px,1fr)_170px] gap-3 px-4 md:px-5 py-4 bg-surface-container-lowest hover:bg-surface-container/30 transition-colors cursor-pointer group border-b border-outline-variant/10 last:border-0"
            >
              <div className="col-span-2 xl:col-span-1 flex items-center">
                <span className="font-body text-xs font-bold text-outline uppercase">{item.sku}</span>
              </div>

              <div className="col-span-4 xl:col-span-1 flex items-center gap-4 min-w-0">
                <ProductImage item={item} size="list" />
                <div className="min-w-0">
                  <h3 className="font-bold text-on-surface group-hover:text-primary transition-colors line-clamp-1">
                    {normalizeUserFacingText(item.name)}
                  </h3>
                  <p className="text-sm text-outline">Categoria: {normalizeUserFacingText(item.category)}</p>
                  {(normalizeUserFacingText(item.vehicleModel) || getEffectiveVehicleType(item)) && (
                    <p className="text-xs text-on-surface-variant">
                      Veiculo: {normalizeUserFacingText(item.vehicleModel) || 'Sem modelo'}
                      {getEffectiveVehicleType(item) ? ` • ${getEffectiveVehicleType(item)}` : ''}
                    </p>
                  )}
                </div>
              </div>

              <div className="col-span-2 xl:col-span-1 flex items-center">
                <div className={getStatusQuantityTone(item.status)}>
                  <span className="text-xl font-headline font-bold">{item.quantity}</span>
                  <span className="text-xs font-label text-outline block opacity-70">UNIDADES</span>
                </div>
              </div>

              <div className="col-span-2 xl:col-span-1 flex items-center gap-3">
                <Warehouse className="text-primary/60 shrink-0" size={20} />
                <div>
                  <p className="text-sm font-semibold text-on-surface">{normalizeLocationText(item.location)}</p>
                </div>
              </div>

              <div className="col-span-2 xl:col-span-1 flex items-center justify-start xl:justify-end">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={event => {
                      event.stopPropagation();
                      if (!canEdit) {
                        showToast('Modo consulta: sem permissão para apontar itens ativos.', 'info');
                        return;
                      }

                      const nextActive = item.isActiveInWarehouse !== true;
                      const confirmed = window.confirm(
                        nextActive
                          ? `Marcar o SKU ${item.sku} como ativo no armazém?`
                          : `Remover o SKU ${item.sku} dos ativos do armazém?`
                      );
                      if (!confirmed) return;

                      const now = new Date().toISOString();
                      setItems(previous =>
                        previous.map(current =>
                          current.sku === item.sku
                            ? {
                                ...current,
                                isActiveInWarehouse: nextActive,
                                updatedAt: now
                              }
                            : current
                        )
                      );
                      showToast(
                        nextActive
                          ? `SKU ${item.sku} marcado como ativo no armazém.`
                          : `SKU ${item.sku} removido dos ativos do armazém.`,
                        'success'
                      );
                    }}
                    disabled={!canEdit}
                    className={`inline-flex items-center gap-3 h-12 px-5 rounded-full text-base font-extrabold transition-colors ${
                      item.isActiveInWarehouse
                        ? 'bg-blue-600 text-white'
                        : 'bg-surface-container-highest text-on-surface-variant'
                    } disabled:opacity-60`}
                    title={item.isActiveInWarehouse ? 'Remover dos ativos' : 'Marcar como ativo'}
                  >
                    {item.isActiveInWarehouse ? <CheckCircle2 size={22} /> : <Circle size={22} />}
                    Ativo
                  </button>
                  <span
                    className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-tighter ${getStatusBadgeTone(item.status)}`}
                  >
                    {normalizeUserFacingText(item.status)}
                  </span>
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="p-12 text-center text-on-surface-variant">
            <Package size={48} className="mx-auto mb-4 opacity-20" />
            <p className="text-lg font-semibold">Nenhum item encontrado.</p>
            <p className="text-sm">Tente ajustar sua busca ou importe a planilha modelo mata225.</p>
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="mt-6 flex items-center justify-between py-4">
          <p className="text-sm text-on-surface-variant font-medium">
            Mostrando {paginatedItems.length} de {filteredItems.length} resultados
          </p>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page === 1}
              className="w-10 h-10 flex items-center justify-center rounded-lg bg-surface-container-low text-on-surface-variant hover:bg-surface-container transition-colors disabled:opacity-50"
            >
              <ChevronLeft size={20} />
            </button>

            <div className="flex gap-1">
              {Array.from({ length: Math.min(5, totalPages) }, (_, index) => {
                const targetPage = page > 3 ? page - 2 + index : index + 1;
                if (targetPage > totalPages) return null;

                return (
                  <button
                    key={targetPage}
                    type="button"
                    onClick={() => setPage(targetPage)}
                    className={`w-10 h-10 rounded-lg transition-colors ${
                      page === targetPage ? 'bg-primary text-on-primary font-bold' : 'hover:bg-surface-container-low font-medium'
                    }`}
                  >
                    {targetPage}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => setPage(Math.min(totalPages, page + 1))}
              disabled={page === totalPages}
              className="w-10 h-10 flex items-center justify-center rounded-lg bg-surface-container-low text-on-surface-variant hover:bg-surface-container transition-colors disabled:opacity-50"
            >
              <ChevronRight size={20} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}

async function readCsvFile(file: File) {
  const buffer = await file.arrayBuffer();
  const utf8 = new TextDecoder('utf-8').decode(buffer);
  const text = utf8.includes('\uFFFD') ? new TextDecoder('windows-1252').decode(buffer) : utf8;
  const lines = text
    .split(/\r?\n/)
    .filter(line => line.trim());

  const delimiter = detectDelimiter(lines[0] || '');
  return lines.map(line => parseDelimitedLine(line, delimiter));
}

async function readXlsxInventoryFile(file: File) {
  try {
    return await readSheet(file, 'Listagem do Browse');
  } catch {
    return await readSheet(file);
  }
}

function parseInventoryRows(rows: unknown[][], settings: InventorySettings): { format: 'browse' | 'export'; items: InventoryItem[] } {
  const headerIndex = rows.findIndex(row => detectInventoryImportFormat(row.map(normalizeHeader)) !== null);

  if (headerIndex < 0) {
    throw new Error('Não encontrei o cabeçalho esperado. Use o modelo mata225 ou um CSV exportado pelo sistema.');
  }

  const now = new Date().toISOString();
  const headers = rows[headerIndex].map(normalizeHeader);
  const format = detectInventoryImportFormat(headers);
  if (!format) {
    throw new Error('Cabeçalho inválido. Use o modelo mata225 ou um CSV exportado pelo sistema.');
  }

  if (format === 'browse') {
    const productIndex = findColumn(headers, ['produto', 'sku', 'codigo', 'código', 'cod']);
    const descriptionIndex = findColumn(headers, ['descricao', 'descrição', 'nome', 'nome do item']);
    const quantityIndex = findColumn(headers, ['saldo atual', 'saldo', 'quantidade', 'quantidade atual']);
    const groupIndex = findColumn(headers, ['grupo', 'grupo do material', 'grupo material']);
    const locationIndex = findOptionalColumn(headers, [
      'locacao',
      'locacao atual',
      'localizacao',
      'localizacao / prateleira',
      'localizacao prateleira',
      'local',
      'armazem',
      'armazém'
    ]);
    const vehicleModelIndex = findOptionalColumn(headers, [
      'modelo veiculo',
      'modelo do veiculo',
      'modelo',
      'marca_modelo',
      'aplicacao',
      'aplicação'
    ]);

    const imageUrlIndex = findOptionalColumn(headers, ['imagem url', 'url imagem', 'imagem', 'foto', 'foto url', 'image url']);

    const items = rows
      .slice(headerIndex + 1)
      .map(row => {
        const sku = formatSku(row[productIndex]);
        const name = normalizeUserFacingText(row[descriptionIndex]);
        const quantity = parseNumber(row[quantityIndex]);
        const group = toText(row[groupIndex]);
        const rawGroup = group ? `Grupo ${group.padStart(4, '0')}` : 'Sem grupo';
        const extraLocation = locationIndex >= 0 ? normalizeLocationText(row[locationIndex]) : '';
        const location = extraLocation || 'Sem localização';
        const vehicleModel = vehicleModelIndex >= 0 ? normalizeOfficialVehicleModel(row[vehicleModelIndex]) : '';
        const vehicleType = getVehicleTypeFromModel(vehicleModel);
        const imageUrl = imageUrlIndex >= 0 ? normalizeImageUrl(row[imageUrlIndex]) : '';
        const { category, sourceCategory } = classifyInventoryCategory(name, rawGroup);
        const status = calculateInventoryStatus(quantity, settings);

        return {
          sku,
          name,
          quantity,
          updatedAt: now,
          category,
          sourceCategory,
          imageUrl,
          vehicleModel,
          vehicleType,
          location,
          status,
          alertCriticalLimit: settings.criticalLimit,
          alertReorderLimit: settings.reorderLimit
        };
      })
      .filter(item => item.sku && item.name);

    return { format, items };
  }

  const skuIndex = findColumn(headers, ['sku', 'produto', 'codigo', 'código', 'cod']);
  const nameIndex = findColumn(headers, ['nome do item', 'nome', 'descricao', 'descrição']);
  const vehicleModelIndex = findOptionalColumn(headers, ['modelo do veiculo', 'modelo veiculo', 'modelo', 'marca_modelo']);
  const vehicleTypeIndex = findOptionalColumn(headers, ['tipo do veiculo', 'tipo veiculo', 'tipo']);
  const imageUrlIndex = findOptionalColumn(headers, ['imagem url', 'url imagem', 'imagem', 'foto', 'foto url', 'image url']);
  const quantityIndex = findColumn(headers, ['quantidade atual', 'saldo atual', 'quantidade', 'saldo']);
  const categoryIndex = findOptionalColumn(headers, ['categoria']);
  const locationIndex = findColumn(headers, ['localizacao', 'locacao', 'localizacao / prateleira', 'local']);
  const statusIndex = findOptionalColumn(headers, ['status']);
  const criticalIndex = findOptionalColumn(headers, ['limite critico', 'critico', 'limite crítico']);
  const reorderIndex = findOptionalColumn(headers, ['limite de reposicao', 'reposicao', 'limite de reposição']);

  const items = rows
    .slice(headerIndex + 1)
    .map(row => {
      const sku = formatSku(row[skuIndex]);
      const name = normalizeUserFacingText(row[nameIndex]);
      const quantity = parseNumber(row[quantityIndex]);
      const extraLocation = normalizeLocationText(row[locationIndex]);
      const location = extraLocation || 'Sem localização';
      const vehicleModel = vehicleModelIndex >= 0 ? normalizeOfficialVehicleModel(row[vehicleModelIndex]) : '';
      const vehicleType =
        vehicleTypeIndex >= 0
          ? normalizeOperationalVehicleType(row[vehicleTypeIndex])
          : getVehicleTypeFromModel(vehicleModel);
      const imageUrl = imageUrlIndex >= 0 ? normalizeImageUrl(row[imageUrlIndex]) : '';
      const resolvedCategory = categoryIndex >= 0 ? normalizeUserFacingText(row[categoryIndex]) : '';
      const { category, sourceCategory } = classifyInventoryCategory(name, resolvedCategory || 'Sem grupo');
      const status = statusIndex >= 0 ? normalizeInventoryStatus(row[statusIndex]) : calculateInventoryStatus(quantity, settings);
      const alertCriticalLimit =
        criticalIndex >= 0 ? parseNumber(row[criticalIndex]) : settings.criticalLimit;
      const alertReorderLimit =
        reorderIndex >= 0 ? parseNumber(row[reorderIndex]) : settings.reorderLimit;

      return {
        sku,
        name,
        quantity,
        updatedAt: now,
        category,
        sourceCategory,
        imageUrl,
        vehicleModel,
        vehicleType,
        location,
        status,
        alertCriticalLimit,
        alertReorderLimit
      };
    })
    .filter(item => item.sku && item.name);

  return { format, items };
}

function mergeInventoryConferenceItem(
  current: InventoryItem,
  incoming: InventoryItem,
  settings: InventorySettings
): InventoryItem {
  const now = new Date().toISOString();
  const nextItem: InventoryItem = {
    ...current,
    name: incoming.name || current.name,
    quantity: incoming.quantity,
    category: incoming.category || current.category,
    sourceCategory: incoming.sourceCategory || current.sourceCategory,
    imageUrl: incoming.imageUrl || current.imageUrl,
    imageHint: incoming.imageHint || current.imageHint,
    vehicleModel: incoming.vehicleModel || current.vehicleModel,
    vehicleType: incoming.vehicleType || current.vehicleType,
    location: normalizeLocationText(incoming.location || current.location),
    alertCriticalLimit: current.alertCriticalLimit ?? incoming.alertCriticalLimit ?? settings.criticalLimit,
    alertReorderLimit: current.alertReorderLimit ?? incoming.alertReorderLimit ?? settings.reorderLimit,
    updatedAt: incoming.updatedAt || current.updatedAt || now
  };

  return {
    ...nextItem,
    status: calculateItemStatus(nextItem, settings)
  };
}

function detectInventoryImportFormat(headers: string[]) {
  const hasBrowseCore = headers.includes('produto') && headers.includes('descricao') && headers.includes('saldo atual');
  if (hasBrowseCore) return 'browse' as const;

  const hasExportCore = headers.includes('sku') && headers.includes('quantidade atual') && (headers.includes('nome do item') || headers.includes('nome'));
  if (hasExportCore) return 'export' as const;

  return null;
}

function getInventoryImportErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return `Erro ao processar a planilha: ${error.message}`;
  }
  return 'Erro ao processar a planilha. Confira se ela segue o modelo mata225.';
}

function findColumn(headers: string[], names: string[]) {
  const index = headers.findIndex(header => names.includes(header));
  if (index < 0) {
    throw new Error(`Coluna obrigatória ausente: ${names.join(', ')}`);
  }
  return index;
}

function findOptionalColumn(headers: string[], names: string[]) {
  return headers.findIndex(header => names.includes(header));
}

function normalizeHeader(value: unknown) {
  return toText(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function toText(value: unknown) {
  if (value === null || value === undefined) return '';

  let text = String(value).replace(/^\uFEFF/, '').trim();
  if (!text) return '';

  for (let index = 0; index < 3; index += 1) {
    const formulaMatch = text.match(/^=(?:"([\s\S]*)"|'([\s\S]*)')$/);
    if (formulaMatch) {
      text = (formulaMatch[1] ?? formulaMatch[2] ?? '').trim();
      continue;
    }

    if (
      (text.startsWith('"') && text.endsWith('"')) ||
      (text.startsWith("'") && text.endsWith("'"))
    ) {
      text = text.slice(1, -1).trim();
      continue;
    }

    break;
  }

  return text.replace(/""/g, '"').trim();
}

function normalizeImageUrl(value: unknown) {
  const url = toText(value);
  if (!url) return '';
  return /^https?:\/\//i.test(url) || url.startsWith('/') ? url : '';
}

function formatSku(value: unknown) {
  const text = toText(value);
  if (/^\d+$/.test(text) && text.length < 5) {
    return text.padStart(5, '0');
  }
  return text;
}

function parseNumber(value: unknown) {
  if (typeof value === 'number') return value;
  const text = toText(value).replace(/\./g, '').replace(',', '.');
  const parsed = Number.parseFloat(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function escapeCsvValue(value: string) {
  const text = String(value ?? '');
  const escaped = text.replace(/"/g, '""');
  return `"${escaped}"`;
}

function detectDelimiter(line: string) {
  const semicolons = countDelimiter(line, ';');
  const commas = countDelimiter(line, ',');
  return semicolons >= commas ? ';' : ',';
}

function countDelimiter(line: string, delimiter: string) {
  let total = 0;
  let insideQuotes = false;

  for (const char of line) {
    if (char === '"') {
      insideQuotes = !insideQuotes;
      continue;
    }

    if (!insideQuotes && char === delimiter) {
      total += 1;
    }
  }

  return total;
}

function parseDelimitedLine(line: string, delimiter: string) {
  const cells: string[] = [];
  let current = '';
  let insideQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        current += '"';
        index += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
      continue;
    }

    if (!insideQuotes && char === delimiter) {
      cells.push(toText(current));
      current = '';
      continue;
    }

    current += char;
  }

  cells.push(toText(current));
  return cells;
}

function getStatusQuantityTone(status: string) {
  const normalized = normalizeStatusValue(status);
  if (normalized === 'estoque critico') return 'text-error';
  if (normalized === 'repor em breve') return 'text-primary';
  return '';
}

function getStatusBadgeTone(status: string) {
  const normalized = normalizeStatusValue(status);
  if (normalized === 'estoque critico') {
    return 'bg-error-container text-on-error-container';
  }
  if (normalized === 'repor em breve') {
    return 'bg-surface-container-highest text-on-primary-container';
  }
  return 'bg-primary-container text-on-primary-container';
}

function normalizeStatusValue(status: string) {
  return String(status)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\uFFFD/g, 'i')
    .toLowerCase()
    .trim();
}

