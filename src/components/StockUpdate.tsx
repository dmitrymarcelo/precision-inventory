import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser';
import { Camera, CheckCircle2, Circle, History, Info, Loader2, MapPin, MinusCircle, PackagePlus, PlusCircle, Printer, Save, Search, X } from 'lucide-react';
import { openBarcodePrintWindow } from '../barcodeLabels';
import { ProductImage } from '../productVisuals';
import {
  decodeFileCode,
  decodeVideoSnapshotCode as assistDecodeVideoSnapshotCode,
  getScannerReader,
  isExpectedScannerError,
  playConfirmTone,
  prepareScannerVideo,
  resolveScannedCode,
  startPreparedScanner,
  type DetectedScan
} from '../barcodeUtils';
import { classifyInventoryCategory } from '../categoryCatalog';
import { InventoryItem, InventoryLog, InventorySettings } from '../types';
import { calculateItemStatus, getItemAlertSettings } from '../inventoryRules';
import { getVehicleTypeFromModel, listVehicleTypes, normalizeOperationalVehicleType } from '../vehicleCatalog';
import { normalizeLocationText, normalizeUserFacingText } from '../textUtils';

const APP_TIME_ZONE = 'America/Manaus';
type StockOperationMode = 'adjustment' | 'receiving';

export default function StockUpdate({
  showToast,
  canAdjustStock,
  canReceiveStock,
  items,
  setItems,
  logs,
  setLogs,
  selectedSku,
  settings,
  ocrAliases,
  setOcrAliases
}: {
  showToast: (m: string, t?: 'success' | 'info') => void,
  canAdjustStock: boolean,
  canReceiveStock: boolean,
  items: InventoryItem[],
  setItems: React.Dispatch<React.SetStateAction<InventoryItem[]>>,
  logs: InventoryLog[],
  setLogs: React.Dispatch<React.SetStateAction<InventoryLog[]>>,
  selectedSku: string | null,
  settings: InventorySettings,
  ocrAliases: Record<string, string>,
  setOcrAliases: React.Dispatch<React.SetStateAction<Record<string, string>>>
}) {
  const [currentSku, setCurrentSku] = useState(selectedSku || '');
  const [searchQuery, setSearchQuery] = useState(selectedSku || '');
  const [operationMode, setOperationMode] = useState<StockOperationMode>(
    canAdjustStock ? 'adjustment' : 'receiving'
  );
  const [quantity, setQuantity] = useState<number | ''>('');
  const [receivedQuantity, setReceivedQuantity] = useState<number | ''>('');
  const [location, setLocation] = useState('');
  const [vehicleType, setVehicleType] = useState('');
  const [alertCriticalLimit, setAlertCriticalLimit] = useState<number | ''>('');
  const [alertReorderLimit, setAlertReorderLimit] = useState<number | ''>('');
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isScannerBusy, setIsScannerBusy] = useState(false);
  const [scannerStatus, setScannerStatus] = useState('Leitor pronto para QR Code.');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createSku, setCreateSku] = useState('');
  const [createName, setCreateName] = useState('');
  const [createLocation, setCreateLocation] = useState('');
  const [createQuantity, setCreateQuantity] = useState<number | ''>('');
  const [createSourceCategory, setCreateSourceCategory] = useState('');
  const [createVehicleType, setCreateVehicleType] = useState('');
  const [createImageUrl, setCreateImageUrl] = useState('');
  const [createCriticalLimit, setCreateCriticalLimit] = useState<number | ''>('');
  const [createReorderLimit, setCreateReorderLimit] = useState<number | ''>('');
  const [createActive, setCreateActive] = useState(false);
  const [createError, setCreateError] = useState('');
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
  const displayVehicleType = item ? normalizeOperationalVehicleType(item.vehicleType || getVehicleTypeFromModel(item.vehicleModel)) : '';
  const displayStatus = item ? normalizeUserFacingText(item.status) : '';
  const availableVehicleTypes = useMemo(
    () =>
      Array.from(
        new Set([
          ...listVehicleTypes().map(type => normalizeOperationalVehicleType(type))
        ])
      ).sort((first, second) => first.localeCompare(second, 'pt-BR')),
    []
  );
  const latestUpdateToday = useMemo(() => {
    const today = new Date();
    const sameDayLogs = itemLogs.filter(log => isSameCalendarDay(log.date, today));
    if (!sameDayLogs.length) return null;

    return sameDayLogs.reduce((latest, current) =>
      new Date(current.date).getTime() > new Date(latest.date).getTime() ? current : latest
    );
  }, [itemLogs]);
  const isReceivingMode = operationMode === 'receiving';
  const canMutate = isReceivingMode ? canReceiveStock : canAdjustStock;
  const canCreateItem = canAdjustStock && Boolean(searchQuery.trim()) && !item;

  useEffect(() => {
    if (operationMode === 'adjustment' && !canAdjustStock && canReceiveStock) {
      setOperationMode('receiving');
    } else if (operationMode === 'receiving' && !canReceiveStock && canAdjustStock) {
      setOperationMode('adjustment');
    }
  }, [canAdjustStock, canReceiveStock, operationMode]);

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
    const searchCandidates = getSkuSearchCandidates(searchQuery);
    const exactMatch = items.find(i => searchCandidates.has(i.sku.trim().toLowerCase()));
    setCurrentSku(exactMatch?.sku || '');
  }, [items, searchQuery]);

  useEffect(() => {
    if (!isCreateOpen) {
      setCreateError('');
    }
  }, [isCreateOpen]);

  useEffect(() => {
    if (item) {
      setLocation(normalizeLocationText(item.location));
      setVehicleType(normalizeOperationalVehicleType(item.vehicleType || getVehicleTypeFromModel(item.vehicleModel)));
      setQuantity(item.quantity);
      setReceivedQuantity('');
      const itemSettings = getItemAlertSettings(item, settings);
      setAlertCriticalLimit(itemSettings.criticalLimit);
      setAlertReorderLimit(itemSettings.reorderLimit);
    } else {
      setLocation('');
      setVehicleType('');
      setQuantity('');
      setReceivedQuantity('');
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

        const controls = await startPreparedScanner(
          reader,
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
          },
          value => {
            if (!cancelled) setScannerStatus(value);
          }
        );

        if (cancelled) {
          controls.stop();
          return;
        }

        scannerControlsRef.current = controls;
        const videoReady = await prepareScannerVideo(video, 200);
        if (!videoReady && !cancelled) {
          setScannerStatus('Aguardando imagem da câmera. Se ficar preto, o sistema vai continuar tentando ler.');
        }
        setIsScannerBusy(false);
        if (videoReady) {
          setScannerStatus('Aponte o QR Code. O item vai abrir automaticamente.');
        }

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
    stopScannerSession();
    setIsScannerBusy(true);
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

    if (!canMutate) {
      showToast('Sem permissão para salvar alterações no estoque.', 'info');
      return;
    }

    if (!isReceivingMode && quantity === '') {
      showToast('Insira a quantidade atual contada para este item.', 'info');
      return;
    }

    if (isReceivingMode && receivedQuantity === '') {
      showToast('Informe a quantidade recebida para dar entrada no estoque.', 'info');
      return;
    }

    const countedQuantity = Number(quantity);
    const incomingQuantity = Number(receivedQuantity);
    const newQuantity = isReceivingMode ? item.quantity + incomingQuantity : countedQuantity;

    if (!isReceivingMode && countedQuantity < 0) {
      showToast('A quantidade atual não pode ser negativa.', 'info');
      return;
    }

    if (isReceivingMode && (!Number.isFinite(incomingQuantity) || incomingQuantity <= 0)) {
      showToast('A quantidade recebida precisa ser maior que zero.', 'info');
      return;
    }

    const criticalLimit = Number(alertCriticalLimit);
    const reorderLimit = Number(alertReorderLimit);
    if (canAdjustStock) {
      if (!Number.isFinite(criticalLimit) || !Number.isFinite(reorderLimit)) {
        showToast('Informe limites válidos para a regra dos alertas.', 'info');
        return;
      }

      if (reorderLimit < criticalLimit) {
        showToast('O limite de reposição precisa ser maior ou igual ao limite crítico.', 'info');
        return;
      }
    }

    const delta = isReceivingMode ? incomingQuantity : newQuantity - item.quantity;
    const newLocation = canAdjustStock ? normalizeLocationText(location.trim() || item.location) : item.location;
    const normalizedVehicleType = canAdjustStock ? normalizeOperationalVehicleType(vehicleType.trim()) : item.vehicleType || '';
    const now = new Date().toISOString();

    setItems(prevItems => prevItems.map(i => {
      if (i.sku !== item.sku) return i;

      const updatedItem = canAdjustStock
        ? {
            ...i,
            quantity: newQuantity,
            location: newLocation,
            vehicleModel: '',
            vehicleType: normalizedVehicleType,
            alertCriticalLimit: criticalLimit,
            alertReorderLimit: reorderLimit,
            updatedAt: now
          }
        : {
            ...i,
            quantity: newQuantity,
            updatedAt: now
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
        date: new Date().toISOString(),
        source: isReceivingMode ? 'recebimento' : 'ajuste'
      },
      ...prevLogs
    ]);

    setQuantity(newQuantity);
    setReceivedQuantity('');
    if (canAdjustStock) {
      setLocation(newLocation);
      setVehicleType(normalizedVehicleType);
      setAlertCriticalLimit(criticalLimit);
      setAlertReorderLimit(reorderLimit);
    }
    showToast(
      isReceivingMode
        ? `Recebimento registrado: +${incomingQuantity} un. Saldo atual ${newQuantity} un.`
        : `Estoque salvo: ${newQuantity} un., local ${newLocation}, limites ${criticalLimit}/${reorderLimit}.`,
      'success'
    );
  };

  const changeQuantityInput = (delta: number) => {
    if (!item) return;

    if (isReceivingMode) {
      setReceivedQuantity(Math.max(0, Number(receivedQuantity || 0) + delta));
      return;
    }

    setQuantity(Math.max(0, Number(quantity || item.quantity) + delta));
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

  const openCreateItem = () => {
    if (!canMutate) {
      showToast('Sem permissão para cadastrar itens.', 'info');
      return;
    }

    const formattedSku = formatSku(searchQuery);
    if (!formattedSku) {
      showToast('Informe um SKU para cadastrar o item.', 'info');
      return;
    }

    setCreateSku(formattedSku);
    setCreateName('');
    setCreateLocation('');
    setCreateQuantity('');
    setCreateSourceCategory('');
    setCreateVehicleType('');
    setCreateImageUrl('');
    setCreateCriticalLimit(settings.criticalLimit);
    setCreateReorderLimit(settings.reorderLimit);
    setCreateActive(false);
    setCreateError('');
    setIsCreateOpen(true);
  };

  const handleCreateItem = () => {
    if (!canMutate) {
      showToast('Sem permissão para cadastrar itens.', 'info');
      return;
    }

    setCreateError('');
    const sku = formatSku(createSku);
    const name = normalizeUserFacingText(createName);
    const quantityValue = Number(createQuantity);
    const locationValue = normalizeLocationText(createLocation || 'Sem localização');
    const sourceCategory = normalizeUserFacingText(createSourceCategory || 'Sem grupo');
    const vehicleTypeValue = normalizeOperationalVehicleType(createVehicleType);
    const imageUrl = normalizeImageUrl(createImageUrl);
    const criticalLimit = Number(createCriticalLimit);
    const reorderLimit = Number(createReorderLimit);

    if (!sku) {
      setCreateError('Informe um SKU válido.');
      return;
    }
    if (!name) {
      setCreateError('Informe o nome do item.');
      return;
    }
    if (!Number.isFinite(quantityValue) || quantityValue < 0) {
      setCreateError('Informe um saldo inicial válido (0 ou maior).');
      return;
    }
    if (!Number.isFinite(criticalLimit) || !Number.isFinite(reorderLimit)) {
      setCreateError('Informe limites válidos para a regra dos alertas.');
      return;
    }
    if (reorderLimit < criticalLimit) {
      setCreateError('O limite de reposição precisa ser maior ou igual ao limite crítico.');
      return;
    }

    const skuCandidates = getSkuSearchCandidates(sku);
    const exists = itemsRef.current.some(existing => skuCandidates.has(String(existing.sku).trim().toLowerCase()));
    if (exists) {
      setCreateError('Este SKU já existe na base.');
      return;
    }

    const { category, sourceCategory: classifiedSourceCategory } = classifyInventoryCategory(name, sourceCategory);
    const now = new Date().toISOString();

    const newItem: InventoryItem = {
      sku,
      name,
      quantity: quantityValue,
      updatedAt: now,
      isActiveInWarehouse: createActive ? true : undefined,
      category,
      sourceCategory: classifiedSourceCategory,
      imageUrl,
      vehicleModel: '',
      vehicleType: vehicleTypeValue,
      location: locationValue,
      status: 'Estoque Saudável',
      alertCriticalLimit: criticalLimit,
      alertReorderLimit: reorderLimit
    };

    const withStatus: InventoryItem = { ...newItem, status: calculateItemStatus(newItem, settings) };

    setItems(previous => [withStatus, ...previous]);
    setLogs(previous => [
      {
        id: `${sku}-${Date.now()}`,
        sku,
        itemName: name,
        previousQuantity: 0,
        delta: quantityValue,
        quantityAfter: quantityValue,
        location: locationValue,
        date: now,
        source: 'ajuste',
        referenceCode: 'Cadastro'
      },
      ...previous
    ]);
    setSearchQuery(sku);
    setIsCreateOpen(false);
    showToast(`Item cadastrado: SKU ${sku}.`, 'success');
  };

  return (
    <>
      <section className="mb-4 bg-surface-container-lowest p-3 sm:p-4 rounded-xl shadow-[0_8px_24px_rgba(36,52,69,0.04)] border border-outline-variant/20">
        <div className="flex flex-col gap-3 mb-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex flex-col gap-1 lg:max-w-3xl">
            <span className="text-primary font-label text-[11px] font-semibold uppercase tracking-wider">Estoque</span>
            <h2 className="text-xl md:text-2xl font-extrabold text-on-surface font-headline tracking-tighter">
              {isReceivingMode ? 'Receber material no estoque' : 'Digite o código do item'}
            </h2>
            <p className="text-xs sm:text-sm text-on-surface-variant max-w-2xl">
              {isReceivingMode
                ? 'Abra o SKU e informe a quantidade que chegou para somar ao saldo atual.'
                : 'Digite o SKU exato ou use o leitor para abrir o item imediatamente.'}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 rounded-xl bg-surface-container-low p-1 lg:min-w-[340px]">
            <button
              type="button"
              onClick={() => setOperationMode('adjustment')}
              disabled={!canAdjustStock}
              className={`h-10 rounded-lg px-3 text-xs sm:text-sm font-bold transition-colors ${
                !isReceivingMode
                  ? 'bg-primary text-on-primary shadow-sm'
                  : 'text-on-surface-variant hover:bg-surface-container-high'
              } disabled:opacity-60`}
            >
              Atualziar Estoque
            </button>
            <button
              type="button"
              onClick={() => setOperationMode('receiving')}
              disabled={!canReceiveStock}
              className={`h-10 rounded-lg px-3 text-xs sm:text-sm font-bold transition-colors flex items-center justify-center gap-2 ${
                isReceivingMode
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-on-surface-variant hover:bg-surface-container-high'
              } disabled:opacity-60`}
            >
              <PackagePlus size={16} />
              Recebimento
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_160px] gap-2 items-stretch">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-outline" size={20} />
            <input
              className="w-full h-11 pl-11 pr-4 bg-surface-container-highest border-none rounded-lg focus:ring-2 focus:ring-primary/40 focus:bg-surface-container-lowest transition-all text-on-surface font-mono"
              placeholder="Ex.: 06682"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <button
            type="button"
            onClick={startScanner}
            className="h-11 w-full px-4 rounded-lg bg-primary text-on-primary font-bold flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
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

            <div className="mt-3 grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_210px] gap-3 items-center">
              <div className="relative h-56 sm:h-64 md:h-60 rounded-xl overflow-hidden bg-black">
                <video
                  ref={videoRef}
                  className="w-full h-full object-cover"
                  muted
                  playsInline
                  autoPlay
                />
                <div className="absolute left-1/2 top-1/2 h-[min(62vw,220px)] w-[min(62vw,220px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border-2 border-emerald-300/80 shadow-[0_0_0_999px_rgba(0,0,0,0.24)]" />
              </div>
              <div className="text-[11px] leading-relaxed text-inverse-on-surface">
                Encoste o QR Code no quadro verde e espere o bip de confirmação.
              </div>

            </div>
          </div>
        )}

        {searchQuery.trim() && !item && (
          <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-3">
            <p className="text-sm text-error font-semibold flex-1">
              Nenhum item encontrado para o SKU informado.
            </p>
            {canCreateItem ? (
              <button
                type="button"
                onClick={openCreateItem}
                className="h-11 px-4 rounded-lg bg-primary text-on-primary font-bold flex items-center justify-center gap-2"
              >
                <PlusCircle size={18} />
                Cadastrar item
              </button>
            ) : null}
          </div>
        )}
      </section>

      {isCreateOpen && (
        <div className="fixed inset-0 z-[120] bg-black/40 flex items-end sm:items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl bg-surface-container-lowest border border-outline-variant/20 shadow-[0_18px_48px_rgba(36,52,69,0.22)] overflow-hidden">
            <div className="p-5 border-b border-outline-variant/15 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">Cadastro de item</p>
                <p className="mt-1 font-extrabold text-on-surface">SKU {createSku}</p>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateOpen(false)}
                className="w-10 h-10 rounded-xl bg-surface-container-highest text-on-surface-variant font-bold flex items-center justify-center"
                aria-label="Fechar cadastro"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-3">
              {createError ? <div className="text-sm font-semibold text-error">{createError}</div> : null}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  value={createSku}
                  onChange={event => setCreateSku(event.target.value)}
                  placeholder="SKU"
                  className="w-full h-12 rounded-xl px-4 bg-surface-container-lowest border border-outline-variant/20 focus:ring-2 focus:ring-primary/40 font-mono"
                  inputMode="numeric"
                />
                <input
                  value={createQuantity}
                  onChange={event => setCreateQuantity(event.target.value === '' ? '' : Number(event.target.value))}
                  placeholder="Saldo inicial"
                  className="w-full h-12 rounded-xl px-4 bg-surface-container-lowest border border-outline-variant/20 focus:ring-2 focus:ring-primary/40 font-bold"
                  type="number"
                  min="0"
                />
              </div>

              <input
                value={createName}
                onChange={event => setCreateName(event.target.value)}
                placeholder="Nome do item"
                className="w-full h-12 rounded-xl px-4 bg-surface-container-lowest border border-outline-variant/20 focus:ring-2 focus:ring-primary/40 font-semibold"
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  value={createLocation}
                  onChange={event => setCreateLocation(event.target.value)}
                  placeholder="Localização"
                  className="w-full h-12 rounded-xl px-4 bg-surface-container-lowest border border-outline-variant/20 focus:ring-2 focus:ring-primary/40 font-mono"
                />
                <input
                  value={createSourceCategory}
                  onChange={event => setCreateSourceCategory(event.target.value)}
                  placeholder="Grupo/Categoria de origem (ex.: Grupo 0001)"
                  className="w-full h-12 rounded-xl px-4 bg-surface-container-lowest border border-outline-variant/20 focus:ring-2 focus:ring-primary/40"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <select
                  value={createVehicleType}
                  onChange={event => setCreateVehicleType(event.target.value)}
                  className="w-full h-12 rounded-xl px-4 bg-surface-container-lowest border border-outline-variant/20 focus:ring-2 focus:ring-primary/40 font-bold"
                >
                  <option value="">Tipo do veículo (opcional)</option>
                  {availableVehicleTypes.map(type => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
                <input
                  value={createImageUrl}
                  onChange={event => setCreateImageUrl(event.target.value)}
                  placeholder="Imagem URL (opcional)"
                  className="w-full h-12 rounded-xl px-4 bg-surface-container-lowest border border-outline-variant/20 focus:ring-2 focus:ring-primary/40"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  value={createCriticalLimit}
                  onChange={event => setCreateCriticalLimit(event.target.value === '' ? '' : Number(event.target.value))}
                  placeholder="Limite crítico"
                  className="w-full h-12 rounded-xl px-4 bg-surface-container-lowest border border-outline-variant/20 focus:ring-2 focus:ring-primary/40 font-bold"
                  type="number"
                  min="0"
                />
                <input
                  value={createReorderLimit}
                  onChange={event => setCreateReorderLimit(event.target.value === '' ? '' : Number(event.target.value))}
                  placeholder="Limite reposição"
                  className="w-full h-12 rounded-xl px-4 bg-surface-container-lowest border border-outline-variant/20 focus:ring-2 focus:ring-primary/40 font-bold"
                  type="number"
                  min="0"
                />
              </div>

              <label className="flex items-center gap-3 text-sm font-bold text-on-surface">
                <input
                  type="checkbox"
                  checked={createActive}
                  onChange={event => setCreateActive(event.target.checked)}
                  className="h-5 w-5"
                />
                Marcar como ativo no armazém
              </label>

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  className="flex-1 h-12 rounded-xl bg-surface-container-highest text-on-surface-variant font-bold"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleCreateItem}
                  className="flex-1 h-12 rounded-xl bg-primary text-on-primary font-bold"
                >
                  Cadastrar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {item ? (
        <>
          <section className="mb-6">
            <div className="flex flex-col gap-1">
              <span className="text-primary font-label text-[11px] font-semibold uppercase tracking-wider">Item encontrado</span>
              <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
                <h2 className="text-2xl md:text-3xl font-extrabold text-on-surface font-headline tracking-tighter">{displayName}</h2>
                <div className="flex flex-wrap items-center justify-start md:justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (!canAdjustStock) {
                        showToast('Sem permissão para apontar itens ativos.', 'info');
                        return;
                      }

                      const now = new Date().toISOString();
                      const nextActive = item.isActiveInWarehouse !== true;
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
                    disabled={!canAdjustStock}
                    className={`inline-flex items-center gap-3 h-14 px-7 rounded-full text-lg font-extrabold transition-colors ${
                      item.isActiveInWarehouse
                        ? 'bg-blue-600 text-white'
                        : 'bg-surface-container-highest text-on-surface-variant'
                    } disabled:opacity-60`}
                    title={item.isActiveInWarehouse ? 'Remover dos ativos' : 'Marcar como ativo'}
                  >
                    {item.isActiveInWarehouse ? <CheckCircle2 size={24} /> : <Circle size={24} />}
                    Ativo
                  </button>
                  <span className="text-on-surface-variant font-mono bg-surface-container px-3 py-1 rounded-lg text-sm">
                    SKU: {item.sku}
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-1 xl:grid-cols-[minmax(0,1.65fr)_minmax(280px,0.85fr)] gap-4">
              <div className="bg-surface-container-lowest p-5 lg:p-6 rounded-2xl shadow-[0_8px_24px_rgba(36,52,69,0.04)] relative overflow-hidden">
                <div className="relative z-10 grid grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)] gap-5">
                  <ProductImage item={item} size="hero" />
                  <div>
                    <p className="text-sm text-on-surface-variant mb-2">Dados do item pesquisado</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-4 gap-4">
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
                </div>
                <div className="absolute top-0 right-0 w-32 h-32 bg-primary-container/20 rounded-full -mr-16 -mt-16 blur-3xl"></div>
              </div>
              <div className="bg-surface-container-high p-5 lg:p-6 rounded-2xl flex flex-col justify-center items-center text-center min-h-36 xl:min-h-full">
                <span className="text-sm text-on-surface-variant font-medium">Unidades Disponíveis</span>
                <span className={`text-4xl md:text-5xl font-extrabold font-headline mt-2 ${item.quantity === 0 ? 'text-error' : 'text-primary'}`}>{item.quantity}</span>
              </div>
            </div>
          </section>

          <section className="space-y-6 xl:space-y-7">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              <div className="flex flex-col gap-3">
                <label className="text-xs font-bold uppercase tracking-widest text-outline pl-1" htmlFor="qty">
                  {isReceivingMode ? 'Quantidade recebida' : 'Quantidade atual contada'}
                </label>
                <div className="group relative">
                  <input
                    className="w-full bg-surface-container-highest border-none rounded-xl h-16 text-2xl md:text-3xl font-extrabold px-5 text-on-surface focus:ring-2 focus:ring-primary/40 focus:bg-surface-container-lowest transition-all"
                    id="qty"
                    min="0"
                    placeholder={isReceivingMode ? '0' : String(item.quantity)}
                    type="number"
                    value={isReceivingMode ? receivedQuantity : quantity}
                    onChange={(e) => {
                      const nextValue = e.target.value === '' ? '' : Number(e.target.value);
                      if (isReceivingMode) {
                        setReceivedQuantity(nextValue);
                        return;
                      }
                      setQuantity(nextValue);
                    }}
                  />
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 flex flex-col gap-1">
                    <PlusCircle onClick={() => changeQuantityInput(1)} className="text-outline group-focus-within:text-primary cursor-pointer hover:text-primary transition-colors" size={24} />
                    <MinusCircle onClick={() => changeQuantityInput(-1)} className="text-outline group-focus-within:text-primary cursor-pointer hover:text-primary transition-colors" size={24} />
                  </div>
                </div>
                <p className="text-[11px] text-on-surface-variant pl-1">
                  {isReceivingMode
                    ? `O valor informado sera somado ao saldo atual de ${item.quantity} un.`
                    : 'O valor informado substitui o saldo atual deste item.'}
                </p>
                {isReceivingMode && Number(receivedQuantity || 0) > 0 && (
                  <div className="rounded-xl bg-emerald-50 border border-emerald-100 px-4 py-3 text-sm font-bold text-emerald-800">
                    Saldo apos recebimento: {item.quantity + Number(receivedQuantity || 0)} un.
                  </div>
                )}
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
                    disabled={!canAdjustStock}
                  />
                  <div className="absolute right-4 top-1/2 -translate-y-1/2">
                    <MapPin className="text-outline group-focus-within:text-primary" size={28} />
                  </div>
                </div>
                <p className="text-[11px] text-on-surface-variant pl-1">
                  {canAdjustStock
                    ? 'Confirme ou corrija a localização atual antes de salvar.'
                    : 'Consulta/recebimento: localização bloqueada.'}
                </p>
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
                      disabled={!canAdjustStock}
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
                      disabled={!canAdjustStock}
                    />
                  </div>
                )}
                <p className="text-[11px] text-on-surface-variant pl-1">
                  {canAdjustStock
                    ? 'O sistema agora salva diretamente o tipo do veiculo neste item para facilitar a separacao operacional.'
                    : 'Consulta/recebimento: tipo de veículo bloqueado.'}
                </p>
              </div>
            </div>

            <section className="bg-surface-container-lowest p-5 lg:p-6 rounded-2xl border border-outline-variant/20 shadow-sm">
              <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.8fr)] gap-4 xl:items-end">
                <div>
                  <h3 className="font-headline font-bold text-xl md:text-2xl tracking-tight">Regra dos Alertas deste item</h3>
                  <p className="text-sm text-on-surface-variant mt-1">
                    Estes limites valem somente para o SKU {item.sku}. Crítico usa saldo até o limite crítico; reposição usa saldo acima do crítico e até o limite de reposição.
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 min-w-0">
                  <label className="flex flex-col gap-2 text-xs font-bold uppercase text-outline">
                    Limite crítico
                    <input
                      className="h-12 rounded-lg border border-outline-variant/30 bg-surface-container-lowest px-4 text-base text-on-surface focus:ring-2 focus:ring-primary/30"
                      type="number"
                      min="0"
                      value={alertCriticalLimit}
                      onChange={(event) => setAlertCriticalLimit(event.target.value === '' ? '' : Number(event.target.value))}
                      disabled={!canAdjustStock}
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
                      disabled={!canAdjustStock}
                    />
                  </label>
                </div>
              </div>
            </section>

            <div
              className={`border p-4 rounded-2xl flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between ${
                latestUpdateToday
                  ? 'bg-primary-container/35 border-primary/20'
                  : 'bg-surface-container-low border-outline-variant/15'
              }`}
            >
              <div className="flex items-start gap-3">
                <Info className={`${latestUpdateToday ? 'text-primary' : 'text-primary-dim'} mt-1 shrink-0`} size={24} />
                <div>
                  <h4 className="font-bold text-on-primary-container text-sm">
                    {latestUpdateToday
                      ? 'Aviso: este SKU já teve alteração hoje'
                      : isReceivingMode
                        ? 'Recebimento pronto para lançar'
                        : 'Atualização pronta para salvar'}
                  </h4>
                  <p className="text-on-surface-variant text-xs mt-1 leading-relaxed">
                    {latestUpdateToday
                      ? (
                        <>
                          A última alteração do dia foi registrada às {formatLogTime(latestUpdateToday.date)} com saldo contado de{' '}
                          {latestUpdateToday.quantityAfter} un.
                        </>
                      )
                      : isReceivingMode
                      ? (
                        <>
                          O recebimento será registrado como entrada do SKU {item.sku}, somando a quantidade recebida ao saldo atual.
                        </>
                      )
                      : (
                        <>
                          A alteração será registrada como ajuste de contagem do SKU {item.sku}, com saldo anterior, saldo contado e diferença.
                        </>
                      )}
                  </p>
                </div>
              </div>
            </div>

            <div
              className="pt-1 grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_280px]"
            >
              <button
                onClick={handleUpdateStock}
                className="w-full bg-gradient-to-br from-primary to-primary-dim text-on-primary h-14 rounded-xl font-bold text-base md:text-lg shadow-[0_12px_32px_rgba(62,95,146,0.2)] active:scale-[0.98] transition-transform flex items-center justify-center gap-3"
              >
                {isReceivingMode ? <PackagePlus size={20} /> : <Save size={20} />}
                {isReceivingMode ? 'Registrar Recebimento' : 'Atualizar Estoque'}
              </button>
              <button
                onClick={handlePrintCurrentLabel}
                className="w-full bg-surface-container-highest text-primary h-12 xl:h-14 rounded-xl font-bold text-sm md:text-base border border-outline-variant/20 active:scale-[0.98] transition-transform flex items-center justify-center gap-3"
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
                  <div key={log.id} className="grid grid-cols-1 md:grid-cols-6 gap-3 bg-surface-container-low p-3 rounded-lg">
                    <div>
                      <span className="text-[10px] font-bold uppercase text-outline block">Data</span>
                      <span className="text-sm font-semibold text-on-surface">{formatLogDate(log.date)}</span>
                    </div>
                    <div>
                      <span className="text-[10px] font-bold uppercase text-outline block">Tipo</span>
                      <span className="text-sm font-semibold text-on-surface">{getLogSourceLabel(log.source)}</span>
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
    timeZone: APP_TIME_ZONE,
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(date));
}

function getSkuSearchCandidates(value: string) {
  const raw = value.trim().toLowerCase();
  const candidates = new Set<string>();
  if (!raw) return candidates;

  candidates.add(raw);
  const digits = raw.replace(/[^\d]/g, '');
  if (digits) {
    candidates.add(digits);
    if (digits.length < 5) {
      candidates.add(digits.padStart(5, '0'));
    }
  }

  return candidates;
}

function formatSku(value: string) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const digits = raw.replace(/[^\d]/g, '');
  if (digits) {
    return digits.length < 5 ? digits.padStart(5, '0') : digits;
  }
  return raw;
}

function normalizeImageUrl(value: string) {
  const url = normalizeUserFacingText(value);
  if (!url) return '';
  return /^https?:\/\//i.test(url) || url.startsWith('/') ? url : '';
}

function formatLogTime(date: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: APP_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(date));
}

function getLogSourceLabel(source?: InventoryLog['source']) {
  if (source === 'recebimento') return 'Recebimento';
  if (source === 'solicitacao') return 'Solicitação';
  if (source === 'divergencia') return 'Divergência';
  return 'Ajuste';
}

function isSameCalendarDay(firstDate: string, secondDate: Date) {
  const first = new Date(firstDate);
  if (Number.isNaN(first.getTime())) return false;

  return getCalendarDateKey(first) === getCalendarDateKey(secondDate);
}

function getCalendarDateKey(value: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(value);
}
