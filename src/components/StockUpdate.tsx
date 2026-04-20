import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser';
import { Camera, History, Info, Loader2, MapPin, MinusCircle, PlusCircle, Printer, Save, Search, X } from 'lucide-react';
import { openBarcodePrintWindow } from '../barcodeLabels';
import {
  decodeFileCode,
  decodeVideoSnapshotCode as assistDecodeVideoSnapshotCode,
  getScannerReader,
  isExpectedScannerError,
  playConfirmTone,
  resolveScannedCode,
  type DetectedScan
} from '../barcodeUtils';
import { classifyInventoryCategory } from '../categoryCatalog';
import { InventoryItem, InventoryLog, InventorySettings, VehicleRecord } from '../types';
import { calculateItemStatus, getItemAlertSettings } from '../inventoryRules';
import { getVehicleTypeFromModel, listVehicleTypes } from '../vehicleCatalog';
import { normalizeLocationText, normalizeUserFacingText } from '../textUtils';

export default function StockUpdate({
  showToast,
  items,
  setItems,
  logs,
  setLogs,
  selectedSku,
  settings,
  vehicles,
  ocrAliases,
  setOcrAliases
}: {
  setActiveTab: (tab: string) => void,
  showToast: (m: string, t?: 'success' | 'info') => void,
  items: InventoryItem[],
  setItems: React.Dispatch<React.SetStateAction<InventoryItem[]>>,
  logs: InventoryLog[],
  setLogs: React.Dispatch<React.SetStateAction<InventoryLog[]>>,
  selectedSku: string | null,
  settings: InventorySettings,
  vehicles: VehicleRecord[],
  ocrAliases: Record<string, string>,
  setOcrAliases: React.Dispatch<React.SetStateAction<Record<string, string>>>
}) {
  const [currentSku, setCurrentSku] = useState(selectedSku || '');
  const [searchQuery, setSearchQuery] = useState(selectedSku || '');
  const [quantity, setQuantity] = useState<number | ''>('');
  const [location, setLocation] = useState('');
  const [vehicleType, setVehicleType] = useState('');
  const [alertCriticalLimit, setAlertCriticalLimit] = useState<number | ''>('');
  const [alertReorderLimit, setAlertReorderLimit] = useState<number | ''>('');
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isScannerBusy, setIsScannerBusy] = useState(false);
  const [scannerStatus, setScannerStatus] = useState('Leitor pronto para QR Code.');
  const videoRef = useRef<HTMLVideoElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const scannerControlsRef = useRef<IScannerControls | null>(null);
  const scannerReaderRef = useRef<BrowserMultiFormatReader | null>(null);
  const scanLockedRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const itemsRef = useRef(items);
  const aliasRef = useRef(ocrAliases);
  const assistBusyRef = useRef(false);

  const item = items.find(i => i.sku === currentSku) || null;
  const itemLogs = item ? logs.filter(log => log.sku === item.sku) : [];
  const itemCategory = item ? classifyInventoryCategory(item.name, item.sourceCategory || item.category) : null;
  const displayName = item ? normalizeUserFacingText(item.name) : '';
  const displayLocation = item ? normalizeLocationText(item.location) : '';
  const displayVehicleType = item ? normalizeUserFacingText(item.vehicleType || getVehicleTypeFromModel(item.vehicleModel)) : '';
  const displayStatus = item ? normalizeUserFacingText(item.status) : '';
  const availableVehicleTypes = useMemo(() => listVehicleTypes(), []);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    aliasRef.current = ocrAliases;
  }, [ocrAliases]);

  useEffect(() => {
    if (selectedSku) {
      setCurrentSku(selectedSku);
      setSearchQuery(selectedSku);
    }
  }, [selectedSku]);

  useEffect(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    const exactMatch = items.find(i => i.sku.trim().toLowerCase() === normalizedQuery);
    setCurrentSku(exactMatch?.sku || '');
  }, [items, searchQuery]);

  useEffect(() => {
    if (item) {
      setLocation(normalizeLocationText(item.location));
      setVehicleType(normalizeUserFacingText(item.vehicleType || getVehicleTypeFromModel(item.vehicleModel)));
      setQuantity(item.quantity);
      const itemSettings = getItemAlertSettings(item, settings);
      setAlertCriticalLimit(itemSettings.criticalLimit);
      setAlertReorderLimit(itemSettings.reorderLimit);
    } else {
      setLocation('');
      setVehicleType('');
      setQuantity('');
      setAlertCriticalLimit('');
      setAlertReorderLimit('');
    }
  }, [item, settings]);

  useEffect(() => {
    if (!isScannerOpen) return;

    let cancelled = false;

    const bootScanner = async () => {
      const video = videoRef.current;
      if (!video) return;

      try {
        const reader = getScannerReader(scannerReaderRef);
        setIsScannerBusy(true);
        setScannerStatus('Abrindo leitor...');
        scanLockedRef.current = false;

        const controls = await reader.decodeFromConstraints(
          {
            audio: false,
            video: {
              facingMode: { ideal: 'environment' },
              width: { ideal: 1280 },
              height: { ideal: 720 }
            }
          },
          video,
          (result, error) => {
            if (cancelled || scanLockedRef.current) return;

            if (result) {
              const detected = resolveScannedCode(result.getText(), itemsRef.current, aliasRef.current);
              if (detected.matchedSku) {
                scanLockedRef.current = true;
                setScannerStatus(`Código ${detected.matchedSku} confirmado.`);
                applyDetectedCode(detected, true);
              } else if (detected.detectedCode) {
              setScannerStatus(`Li ${detected.detectedCode}, mas ele não está na base online.`);
              }
              return;
            }

            if (error && !isExpectedScannerError(error)) {
              setScannerStatus('Ajuste o enquadramento do QR Code.');
            }
          }
        );

        if (cancelled) {
          controls.stop();
          return;
        }

        scannerControlsRef.current = controls;
        setIsScannerBusy(false);
        setScannerStatus('Aponte o QR Code. O item vai abrir automaticamente.');

        const assistTimer = window.setInterval(async () => {
          const snapshotVideo = videoRef.current;
          if (
            cancelled ||
            !snapshotVideo ||
            scanLockedRef.current ||
            assistBusyRef.current ||
            snapshotVideo.readyState < 2
          ) {
            return;
          }

          assistBusyRef.current = true;
          try {
            const detected = await assistDecodeVideoSnapshotCode(
              snapshotVideo,
              itemsRef.current,
              aliasRef.current,
              value => {
                if (!cancelled && !scanLockedRef.current) {
                  setScannerStatus(value);
                }
              }
            );

            if (!cancelled && detected?.matchedSku && !scanLockedRef.current) {
              scanLockedRef.current = true;
              applyDetectedCode(detected, true);
            }
          } finally {
            assistBusyRef.current = false;
          }
        }, 800);

        const originalStop = controls.stop.bind(controls);
        controls.stop = () => {
          window.clearInterval(assistTimer);
          originalStop();
        };
      } catch {
        if (cancelled) return;
        stopScannerSession();
        setIsScannerOpen(false);
        showToast('Não foi possível abrir a câmera. Vou usar foto da etiqueta.', 'info');
        photoInputRef.current?.click();
      }
    };

    const timer = window.setTimeout(bootScanner, 50);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      stopScannerSession();
    };
  }, [isScannerOpen, showToast]);

  useEffect(() => () => {
    stopScannerSession();
    audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;
  }, []);

  const stopScannerSession = () => {
    scannerControlsRef.current?.stop();
    scannerControlsRef.current = null;
    scanLockedRef.current = false;
    assistBusyRef.current = false;
    if (videoRef.current) {
      BrowserMultiFormatReader.cleanVideoSource(videoRef.current);
    }
    setIsScannerBusy(false);
  };

  const closeScanner = () => {
    stopScannerSession();
    setIsScannerOpen(false);
    setScannerStatus('Leitor pronto para QR Code.');
  };

  const startScanner = async () => {
    if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) {
      photoInputRef.current?.click();
      return;
    }

    setScannerStatus('Preparando leitor...');
    setIsScannerOpen(true);
  };

  const readCodeFromPhoto = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsScannerBusy(true);
    setScannerStatus('Lendo foto da etiqueta...');

    try {
      const detected = await decodeFileCode(file, itemsRef.current, aliasRef.current, setScannerStatus);
      applyDetectedCode(detected, false);
    } catch {
      showToast('Não consegui identificar o código nesta foto.', 'info');
    } finally {
      setIsScannerBusy(false);
      event.target.value = '';
    }
  };

  const applyDetectedCode = (detected: DetectedScan, shouldCloseScanner: boolean) => {
    if (detected.matchedSku) {
      setSearchQuery(detected.matchedSku);
      setCurrentSku(detected.matchedSku);
      setScannerStatus(`Código ${detected.matchedSku} confirmado.`);
      setOcrAliases(current => {
        const next = { ...current };
        detected.candidates.forEach(candidate => {
          next[candidate] = detected.matchedSku as string;
        });
        return next;
      });
      void playConfirmTone(audioContextRef);
      if ('vibrate' in navigator) {
        navigator.vibrate?.(60);
      }
      if (shouldCloseScanner) {
        closeScanner();
      }
      showToast(`Código ${detected.matchedSku} encontrado na base.`, 'success');
    } else if (detected.detectedCode) {
      setScannerStatus(`Li ${detected.detectedCode}, mas esse código não está na base carregada.`);
      showToast(`Código ${detected.detectedCode} não encontrado na base.`, 'info');
    } else {
      setScannerStatus('Não consegui ler o código. Tente aproximar um pouco mais.');
      showToast('Não consegui ler o código da etiqueta.', 'info');
    }
  };

  const handleUpdateStock = () => {
    if (!item) {
      showToast('Digite o SKU exato para carregar o item.', 'info');
      return;
    }

    if (quantity === '') {
      showToast('Insira a quantidade atual contada para este item.', 'info');
      return;
    }

    const newQuantity = Number(quantity);

    if (newQuantity < 0) {
      showToast('A quantidade atual não pode ser negativa.', 'info');
      return;
    }

    const criticalLimit = Number(alertCriticalLimit);
    const reorderLimit = Number(alertReorderLimit);

    if (!Number.isFinite(criticalLimit) || !Number.isFinite(reorderLimit)) {
      showToast('Informe limites válidos para a regra dos alertas.', 'info');
      return;
    }

    if (reorderLimit < criticalLimit) {
      showToast('O limite de reposição precisa ser maior ou igual ao limite crítico.', 'info');
      return;
    }

    const delta = newQuantity - item.quantity;
    const newLocation = normalizeLocationText(location.trim() || item.location);
    const normalizedVehicleType = normalizeUserFacingText(vehicleType.trim());

    setItems(prevItems => prevItems.map(i => {
      if (i.sku !== item.sku) return i;

      const updatedItem = {
        ...i,
        quantity: newQuantity,
        location: newLocation,
        vehicleModel: '',
        vehicleType: normalizedVehicleType,
        alertCriticalLimit: criticalLimit,
        alertReorderLimit: reorderLimit
      };
      return { ...updatedItem, status: calculateItemStatus(updatedItem, settings) };
    }));

    setLogs(prevLogs => [
      {
        id: `${item.sku}-${Date.now()}`,
        sku: item.sku,
        itemName: item.name,
        previousQuantity: item.quantity,
        delta,
        quantityAfter: newQuantity,
        location: newLocation,
        date: new Date().toISOString()
      },
      ...prevLogs
    ]);

    showToast(`Saldo atualizado: ${item.quantity} para ${newQuantity} un.`, 'success');
    setQuantity('');
  };

  const handlePrintCurrentLabel = async () => {
    if (!item) {
      showToast('Carregue um item antes de imprimir a etiqueta.', 'info');
      return;
    }

    const opened = await openBarcodePrintWindow([item], {
      title: `Etiqueta do SKU ${item.sku}`,
      subtitle: `${displayName} • ${displayLocation}`
    });

    if (!opened) {
      showToast('Libere a abertura de pop-up para imprimir a etiqueta.', 'info');
      return;
    }

    showToast(`Etiqueta do SKU ${item.sku} enviada para impressão.`, 'success');
  };

  return (
    <>
      <section className="mb-6 bg-surface-container-lowest p-5 md:p-6 rounded-xl shadow-[0_8px_24px_rgba(36,52,69,0.04)] border border-outline-variant/20">
        <div className="flex flex-col gap-2 mb-6">
          <span className="text-primary font-label text-[11px] font-semibold uppercase tracking-wider">Atualziar Estoque</span>
          <h2 className="text-2xl md:text-3xl font-extrabold text-on-surface font-headline tracking-tighter">Digite o código do item</h2>
          <p className="text-sm text-on-surface-variant max-w-2xl">
            Digite o SKU exato ou use o leitor para abrir o item imediatamente.
          </p>
        </div>

        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-outline" size={22} />
            <input
              className="w-full h-12 pl-11 pr-4 bg-surface-container-highest border-none rounded-lg focus:ring-2 focus:ring-primary/40 focus:bg-surface-container-lowest transition-all text-on-surface font-mono"
              placeholder="Ex.: 06682"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <button
            type="button"
            onClick={startScanner}
            className="h-12 px-4 rounded-lg bg-primary text-on-primary font-bold flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
          >
            {isScannerBusy ? <Loader2 className="animate-spin" size={18} /> : <Camera size={20} />}
            Ler etiqueta
          </button>
          <input
            ref={photoInputRef}
            className="hidden"
            type="file"
            accept="image/*"
            capture="environment"
            onChange={readCodeFromPhoto}
          />
        </div>

        {isScannerOpen && (
          <div className="mt-3 rounded-lg bg-inverse-surface text-on-primary border border-white/8 px-3 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-bold">
                  {isScannerBusy ? <Loader2 className="animate-spin" size={16} /> : <Camera size={16} />}
                  Leitor ativo
                </div>
                <p className="text-[11px] text-inverse-on-surface mt-1">{scannerStatus}</p>
              </div>
              <button
                type="button"
                onClick={closeScanner}
                className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center shrink-0"
                aria-label="Fechar leitor"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-3 grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_180px] gap-3 items-center">
              <div className="relative h-28 md:h-24 rounded-lg overflow-hidden bg-black">
                <video
                  ref={videoRef}
                  className="w-full h-full object-cover"
                  muted
                  playsInline
                  autoPlay
                />
                <div className="absolute inset-x-5 top-1/2 -translate-y-1/2 h-10 border border-emerald-300/80 rounded-md shadow-[0_0_0_999px_rgba(0,0,0,0.22)]" />
              </div>
              <div className="text-[11px] leading-relaxed text-inverse-on-surface">
                Encoste o QR Code no quadro verde e espere o bip de confirmação.
              </div>

            </div>
          </div>
        )}

        {searchQuery.trim() && !item && (
          <p className="mt-3 text-sm text-error font-semibold">
            Nenhum item encontrado para o SKU informado.
          </p>
        )}
      </section>

      {item ? (
        <>
          <section className="mb-6">
            <div className="flex flex-col gap-1">
              <span className="text-primary font-label text-[11px] font-semibold uppercase tracking-wider">Item encontrado</span>
              <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
                <h2 className="text-2xl md:text-3xl font-extrabold text-on-surface font-headline tracking-tighter">{displayName}</h2>
                <span className="text-on-surface-variant font-mono bg-surface-container px-3 py-1 rounded-lg text-sm">SKU: {item.sku}</span>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2 bg-surface-container-lowest p-5 rounded-xl shadow-[0_8px_24px_rgba(36,52,69,0.04)] relative overflow-hidden">
                <div className="relative z-10">
                  <p className="text-sm text-on-surface-variant mb-2">Dados do item pesquisado</p>
                  <div className="flex flex-wrap gap-4">
                    <div className="flex flex-col">
                      <span className="text-[10px] uppercase font-bold text-outline">Categoria</span>
                      <span className="font-semibold">{normalizeUserFacingText(itemCategory?.category) || normalizeUserFacingText(item.category)}</span>
                      {itemCategory?.sourceCategory ? (
                        <span className="text-xs text-on-surface-variant mt-1">
                          Origem da base: {normalizeUserFacingText(itemCategory.sourceCategory)}
                        </span>
                      ) : (
                        <span className="text-xs text-on-surface-variant mt-1">
                          Classificação automática pela taxonomia do estoque.
                        </span>
                      )}
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[10px] uppercase font-bold text-outline">Localização / Prateleira</span>
                      <span className="font-semibold">{displayLocation}</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[10px] uppercase font-bold text-outline">Tipo do veiculo</span>
                      <span className="font-semibold">{displayVehicleType || 'Sem tipo vinculado'}</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[10px] uppercase font-bold text-outline">Status</span>
                      <span className={`font-semibold ${
                        displayStatus === 'Estoque Crítico' ? 'text-error' :
                        displayStatus === 'Repor em Breve' ? 'text-primary' :
                        'text-on-surface'
                      }`}>{displayStatus}</span>
                    </div>
                  </div>
                </div>
                <div className="absolute top-0 right-0 w-32 h-32 bg-primary-container/20 rounded-full -mr-16 -mt-16 blur-3xl"></div>
              </div>
              <div className="bg-surface-container-high p-5 rounded-xl flex flex-col justify-center items-center text-center min-h-36">
                <span className="text-sm text-on-surface-variant font-medium">Unidades Disponíveis</span>
                <span className={`text-4xl md:text-5xl font-extrabold font-headline mt-2 ${item.quantity === 0 ? 'text-error' : 'text-primary'}`}>{item.quantity}</span>
              </div>
            </div>
          </section>

          <section className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="flex flex-col gap-3">
                <label className="text-xs font-bold uppercase tracking-widest text-outline pl-1" htmlFor="qty">Quantidade atual contada</label>
                <div className="group relative">
                  <input
                    className="w-full bg-surface-container-highest border-none rounded-xl h-16 text-2xl md:text-3xl font-extrabold px-5 text-on-surface focus:ring-2 focus:ring-primary/40 focus:bg-surface-container-lowest transition-all"
                    id="qty"
                    min="0"
                    placeholder={String(item.quantity)}
                    type="number"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value === '' ? '' : Number(e.target.value))}
                  />
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 flex flex-col gap-1">
                    <PlusCircle onClick={() => setQuantity(Number(quantity || item.quantity) + 1)} className="text-outline group-focus-within:text-primary cursor-pointer hover:text-primary transition-colors" size={24} />
                    <MinusCircle onClick={() => setQuantity(Math.max(0, Number(quantity || item.quantity) - 1))} className="text-outline group-focus-within:text-primary cursor-pointer hover:text-primary transition-colors" size={24} />
                  </div>
                </div>
                <p className="text-[11px] text-on-surface-variant pl-1">O valor informado substitui o saldo atual deste item.</p>
              </div>

              <div className="flex flex-col gap-3">
                <label className="text-xs font-bold uppercase tracking-widest text-outline pl-1" htmlFor="loc">Localização / Prateleira atual</label>
                <div className="group relative">
                  <input
                    className="w-full bg-surface-container-highest border-none rounded-xl h-16 text-2xl md:text-3xl font-extrabold px-5 pr-14 text-on-surface focus:ring-2 focus:ring-primary/40 focus:bg-surface-container-lowest transition-all uppercase"
                    id="loc"
                    placeholder="A1-42-B"
                    type="text"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                  />
                  <div className="absolute right-4 top-1/2 -translate-y-1/2">
                    <MapPin className="text-outline group-focus-within:text-primary" size={28} />
                  </div>
                </div>
                <p className="text-[11px] text-on-surface-variant pl-1">Confirme ou corrija a localização atual antes de salvar.</p>
              </div>

              <div className="flex flex-col gap-3">
                <label className="text-xs font-bold uppercase tracking-widest text-outline pl-1" htmlFor="vehicle-type-main">Tipo do veiculo</label>
                {availableVehicleTypes.length > 0 ? (
                  <div className="group relative">
                    <select
                      className="w-full bg-surface-container-highest border-none rounded-xl h-16 text-base md:text-lg font-bold px-5 text-on-surface focus:ring-2 focus:ring-primary/40 focus:bg-surface-container-lowest transition-all"
                      id="vehicle-type-main"
                      value={vehicleType}
                      onChange={(event) => setVehicleType(event.target.value)}
                    >
                      <option value="">Selecione o tipo do veiculo</option>
                      {availableVehicleTypes.map(type => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="group relative">
                    <input
                      className="w-full bg-surface-container-highest border-none rounded-xl h-16 text-lg md:text-xl font-extrabold px-5 text-on-surface focus:ring-2 focus:ring-primary/40 focus:bg-surface-container-lowest transition-all"
                      id="vehicle-type-main"
                      type="text"
                      placeholder="Digite o tipo do veiculo"
                      value={vehicleType}
                      onChange={(event) => setVehicleType(event.target.value)}
                    />
                  </div>
                )}
                <p className="text-[11px] text-on-surface-variant pl-1">
                  O sistema agora salva diretamente o tipo do veiculo neste item para facilitar a separacao operacional.
                </p>
              </div>
            </div>

            <section className="bg-surface-container-lowest p-5 rounded-xl border border-outline-variant/20 shadow-sm">
              <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                  <h3 className="font-headline font-bold text-xl md:text-2xl tracking-tight">Regra dos Alertas deste item</h3>
                  <p className="text-sm text-on-surface-variant mt-1">
                    Estes limites valem somente para o SKU {item.sku}. Crítico usa saldo até o limite crítico; reposição usa saldo acima do crítico e até o limite de reposição.
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 min-w-0 md:min-w-[360px]">
                  <label className="flex flex-col gap-2 text-xs font-bold uppercase text-outline">
                    Limite crítico
                    <input
                      className="h-12 rounded-lg border border-outline-variant/30 bg-surface-container-lowest px-4 text-base text-on-surface focus:ring-2 focus:ring-primary/30"
                      type="number"
                      min="0"
                      value={alertCriticalLimit}
                      onChange={(event) => setAlertCriticalLimit(event.target.value === '' ? '' : Number(event.target.value))}
                    />
                  </label>
                  <label className="flex flex-col gap-2 text-xs font-bold uppercase text-outline">
                    Limite de reposição
                    <input
                      className="h-12 rounded-lg border border-outline-variant/30 bg-surface-container-lowest px-4 text-base text-on-surface focus:ring-2 focus:ring-primary/30"
                      type="number"
                      min="0"
                      value={alertReorderLimit}
                      onChange={(event) => setAlertReorderLimit(event.target.value === '' ? '' : Number(event.target.value))}
                    />
                  </label>
                </div>
              </div>
            </section>

            <div className="bg-surface-container-low border border-outline-variant/15 p-4 rounded-xl flex items-start gap-3">
              <Info className="text-primary-dim mt-1 shrink-0" size={24} />
              <div>
                <h4 className="font-bold text-on-primary-container text-sm">Verificação do Sistema Pronta</h4>
                <p className="text-on-surface-variant text-xs mt-1 leading-relaxed">
                  A alteração será registrada como ajuste de contagem do SKU {item.sku}, com saldo anterior, saldo contado e diferença.
                </p>
              </div>
            </div>

            <div className="pt-1">
              <button
                onClick={handleUpdateStock}
                className="w-full bg-gradient-to-br from-primary to-primary-dim text-on-primary h-14 rounded-xl font-bold text-base md:text-lg shadow-[0_12px_32px_rgba(62,95,146,0.2)] active:scale-[0.98] transition-transform flex items-center justify-center gap-3"
              >
                <Save size={20} />
                Atualizar Estoque
              </button>
              <button
                onClick={handlePrintCurrentLabel}
                className="mt-3 w-full bg-surface-container-highest text-primary h-12 rounded-xl font-bold text-sm md:text-base border border-outline-variant/20 active:scale-[0.98] transition-transform flex items-center justify-center gap-3"
              >
                <Printer size={18} />
                Imprimir Etiqueta
              </button>
            </div>
          </section>

          <section className="mt-8 bg-surface-container-lowest p-5 rounded-xl shadow-[0_8px_24px_rgba(36,52,69,0.04)] border border-outline-variant/20">
            <div className="flex items-center gap-3 mb-5">
              <History className="text-primary" size={22} />
              <div>
                <h3 className="font-headline font-bold text-xl md:text-2xl tracking-tight">Ver Logs de Alterações</h3>
                <p className="text-xs text-on-surface-variant">Mostrando somente alterações do SKU {item.sku}.</p>
              </div>
            </div>

            {itemLogs.length > 0 ? (
              <div className="space-y-3">
                {itemLogs.map(log => (
                  <div key={log.id} className="grid grid-cols-1 md:grid-cols-5 gap-3 bg-surface-container-low p-3 rounded-lg">
                    <div>
                      <span className="text-[10px] font-bold uppercase text-outline block">Data</span>
                      <span className="text-sm font-semibold text-on-surface">{formatLogDate(log.date)}</span>
                    </div>
                    <div>
                      <span className="text-[10px] font-bold uppercase text-outline block">Saldo anterior</span>
                      <span className="text-sm font-semibold text-on-surface">{log.previousQuantity ?? log.quantityAfter - log.delta} un</span>
                    </div>
                    <div>
                      <span className="text-[10px] font-bold uppercase text-outline block">Saldo contado</span>
                      <span className="text-sm font-semibold text-on-surface">{log.quantityAfter} un</span>
                    </div>
                    <div>
                      <span className="text-[10px] font-bold uppercase text-outline block">Diferença</span>
                      <span className={`text-sm font-bold ${log.delta < 0 ? 'text-error' : log.delta > 0 ? 'text-primary' : 'text-on-surface-variant'}`}>{log.delta > 0 ? '+' : ''}{log.delta} un</span>
                    </div>
                    <div>
                      <span className="text-[10px] font-bold uppercase text-outline block">Localização</span>
                      <span className="text-sm font-semibold text-on-surface">{normalizeLocationText(log.location)}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-surface-container-low p-6 rounded-lg text-center text-on-surface-variant">
                Nenhuma alteração registrada para este SKU ainda.
              </div>
            )}
          </section>
        </>
      ) : (
        <section className="bg-surface-container-low p-8 rounded-xl text-center text-on-surface-variant">
          Digite um SKU exato ou use o leitor para carregar o formulário de atualização e os logs do item.
        </section>
      )}
    </>
  );
}

function formatLogDate(date: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(date));
}
