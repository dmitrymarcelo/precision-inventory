import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser';
import {
  Barcode,
  Camera,
  ChevronRight,
  Loader2,
  Minus,
  PackageCheck,
  Search,
  ShieldAlert,
  X
} from 'lucide-react';
import { InventoryItem, InventoryLog, InventorySettings, MaterialRequest } from '../types';
import { calculateItemStatus } from '../inventoryRules';
import {
  bumpSeparatedQuantity,
  fillPendingQuantity,
  getRequestProgress,
  recalculateRequestStatus
} from '../requestUtils';
import {
  decodeVideoSnapshotCode,
  decodeFileCode,
  getScannerReader,
  isExpectedScannerError,
  playConfirmTone,
  resolveScannedCode
} from '../barcodeUtils';
import { normalizeLocationText, normalizeUserFacingText } from '../textUtils';

interface MaterialSeparationProps {
  items: InventoryItem[];
  setItems: React.Dispatch<React.SetStateAction<InventoryItem[]>>;
  logs: InventoryLog[];
  setLogs: React.Dispatch<React.SetStateAction<InventoryLog[]>>;
  requests: MaterialRequest[];
  setRequests: React.Dispatch<React.SetStateAction<MaterialRequest[]>>;
  selectedRequestId: string | null;
  setSelectedRequestId: (requestId: string | null) => void;
  settings: InventorySettings;
  showToast: (message: string, type?: 'success' | 'info') => void;
  ocrAliases: Record<string, string>;
  setOcrAliases: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  onSelectSku: (sku: string) => void;
}

export default function MaterialSeparation({
  items,
  setItems,
  logs,
  setLogs,
  requests,
  setRequests,
  selectedRequestId,
  setSelectedRequestId,
  settings,
  showToast,
  ocrAliases,
  setOcrAliases,
  onSelectSku
}: MaterialSeparationProps) {
  const [requestQuery, setRequestQuery] = useState('');
  const [scannerStatus, setScannerStatus] = useState('Leitor pronto para apoiar a separação com QR Code.');
  const [scannerFeedback, setScannerFeedback] = useState<'neutral' | 'success' | 'error'>('neutral');
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isScannerBusy, setIsScannerBusy] = useState(false);
  const [lastConfirmedSku, setLastConfirmedSku] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const scannerControlsRef = useRef<IScannerControls | null>(null);
  const scannerReaderRef = useRef<BrowserMultiFormatReader | null>(null);
  const scanLockedRef = useRef(false);
  const releaseTimerRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const itemsRef = useRef(items);
  const requestRef = useRef<MaterialRequest | null>(null);
  const aliasRef = useRef(ocrAliases);
  const assistBusyRef = useRef(false);

  const filteredRequests = useMemo(() => {
    const query = requestQuery.trim().toLowerCase();
    const sorted = [...requests].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    if (!query) return sorted;

    return sorted.filter(request =>
      request.code.toLowerCase().includes(query) ||
      normalizeUserFacingText(request.vehiclePlate).toLowerCase().includes(query) ||
      normalizeUserFacingText(request.costCenter).toLowerCase().includes(query) ||
      request.items.some(
        item =>
          item.sku.toLowerCase().includes(query) ||
          normalizeUserFacingText(item.itemName).toLowerCase().includes(query)
      )
    );
  }, [requestQuery, requests]);

  const currentRequest = useMemo(
    () => requests.find(request => request.id === selectedRequestId) || null,
    [requests, selectedRequestId]
  );

  const requestProgress = currentRequest ? getRequestProgress(currentRequest) : null;
  const isCurrentRequestLocked = normalizeUserFacingText(currentRequest?.status) === 'Atendida';

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    aliasRef.current = ocrAliases;
  }, [ocrAliases]);

  useEffect(() => {
    requestRef.current = currentRequest;
  }, [currentRequest]);

  useEffect(() => {
    if (!selectedRequestId || !requests.some(request => request.id === selectedRequestId)) {
      const firstOpenRequest =
        requests.find(request => normalizeUserFacingText(request.status) !== 'Atendida') || requests[0] || null;
      setSelectedRequestId(firstOpenRequest ? firstOpenRequest.id : null);
    }
  }, [requests, selectedRequestId, setSelectedRequestId]);

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
        setScannerFeedback('neutral');
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
              void handleDetectedCode(result.getText());
              return;
            }

            if (error && !isExpectedScannerError(error)) {
              setScannerStatus('Ajuste o enquadramento do código para continuar.');
            }
          }
        );

        if (cancelled) {
          controls.stop();
          return;
        }

        scannerControlsRef.current = controls;
        setIsScannerBusy(false);
        setScannerStatus('Leitor ativo. Mire a etiqueta e aguarde o bip.');
        setScannerFeedback('neutral');

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
            const detected = await decodeVideoSnapshotCode(
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
              await handleResolvedScan(detected);
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
        showToast('A câmera não abriu. Vou usar foto da etiqueta como apoio.', 'info');
        photoInputRef.current?.click();
      }
    };

    const timer = window.setTimeout(bootScanner, 50);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      stopScannerSession();
    };
  }, [isScannerOpen]);

  useEffect(
    () => () => {
      stopScannerSession();
      audioContextRef.current?.close().catch(() => undefined);
      audioContextRef.current = null;
    },
    []
  );

  const stopScannerSession = () => {
    scannerControlsRef.current?.stop();
    scannerControlsRef.current = null;
    scanLockedRef.current = false;
    assistBusyRef.current = false;
    if (releaseTimerRef.current) {
      window.clearTimeout(releaseTimerRef.current);
      releaseTimerRef.current = null;
    }
    if (videoRef.current) {
      BrowserMultiFormatReader.cleanVideoSource(videoRef.current);
    }
    setIsScannerBusy(false);
  };

  const closeScanner = () => {
    stopScannerSession();
    setIsScannerOpen(false);
    setScannerStatus('Leitor pronto para apoiar a separação com QR Code.');
    setScannerFeedback('neutral');
  };

  const startScanner = () => {
    if (!requestRef.current) {
      showToast('Abra uma solicitação antes de iniciar a separação.', 'info');
      return;
    }

    if (normalizeUserFacingText(requestRef.current.status) === 'Atendida') {
      showToast('Esta solicitação já foi entregue e está bloqueada para consulta.', 'info');
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) {
      photoInputRef.current?.click();
      return;
    }

    setScannerStatus('Preparando leitor...');
    setScannerFeedback('neutral');
    setIsScannerOpen(true);
  };

  const handlePhotoRead = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsScannerBusy(true);
    setScannerStatus('Lendo foto da etiqueta...');
    setScannerFeedback('neutral');

    try {
      const detected = await decodeFileCode(file, itemsRef.current, aliasRef.current, setScannerStatus);
      await handleResolvedScan(detected);
    } catch {
      setScannerFeedback('error');
      showToast('Não consegui identificar o código nesta foto.', 'info');
    } finally {
      setIsScannerBusy(false);
      event.target.value = '';
    }
  };

  const handleDetectedCode = async (rawCode: string) => {
    const detected = resolveScannedCode(rawCode, itemsRef.current, aliasRef.current);
    await handleResolvedScan(detected);
  };

  const handleResolvedScan = async (detected: ReturnType<typeof resolveScannedCode>) => {
    const activeRequest = requestRef.current;

    if (!activeRequest) {
      setScannerFeedback('error');
      showToast('Nenhuma solicitação aberta para separação.', 'info');
      return;
    }

    if (normalizeUserFacingText(activeRequest.status) === 'Atendida') {
      setScannerFeedback('error');
      setScannerStatus('Solicitação entregue. O histórico está liberado somente para consulta.');
      showToast('Esta solicitação já foi entregue e está bloqueada para consulta.', 'info');
      return;
    }

    if (!detected.matchedSku) {
      setScannerStatus(
        detected.detectedCode
          ? `Li ${detected.detectedCode}, mas ele não está na base carregada.`
          : 'Não consegui ler o código. Tente aproximar mais.'
      );
      lockScannerBriefly('error', 1200);
      showToast('Código não encontrado na base.', 'info');
      return;
    }

    const requestItem = activeRequest.items.find(item => item.sku === detected.matchedSku);
    if (!requestItem) {
      setScannerStatus(`O SKU ${detected.matchedSku} não faz parte desta separação.`);
      lockScannerBriefly('error', 1200);
      showToast(`O SKU ${detected.matchedSku} não pertence a esta solicitação.`, 'info');
      return;
    }

    const nextSeparated = requestItem.separatedQuantity + 1;
    if (nextSeparated > requestItem.requestedQuantity) {
      setScannerStatus(`O SKU ${detected.matchedSku} já está completo nesta separação.`);
      lockScannerBriefly('error', 1200);
      showToast(`O item ${detected.matchedSku} já foi separado por completo.`, 'info');
      return;
    }

    const { request: updatedRequest } = bumpSeparatedQuantity(activeRequest, detected.matchedSku, 1);
    const nextRequest = {
      ...updatedRequest,
      updatedAt: new Date().toISOString()
    };
    nextRequest.status = recalculateRequestStatus(nextRequest);

    setRequests(previous =>
      previous.map(request => (request.id === nextRequest.id ? nextRequest : request))
    );
    setLastConfirmedSku(detected.matchedSku);
    setScannerStatus(`SKU ${detected.matchedSku} confirmado para ${normalizeUserFacingText(requestItem.itemName)}.`);
    setOcrAliases(current => {
      const next = { ...current };
      detected.candidates.forEach(candidate => {
        next[candidate] = detected.matchedSku as string;
      });
      return next;
    });
    await playConfirmTone(audioContextRef);
    if ('vibrate' in navigator) {
      navigator.vibrate?.(60);
    }
    lockScannerBriefly('success', 900);
  };

  const lockScannerBriefly = (feedback: 'neutral' | 'success' | 'error' = 'neutral', resetDelay = 750) => {
    scanLockedRef.current = true;
    setScannerFeedback(feedback);

    if (releaseTimerRef.current) {
      window.clearTimeout(releaseTimerRef.current);
    }

    releaseTimerRef.current = window.setTimeout(() => {
      scanLockedRef.current = false;
      setScannerFeedback('neutral');
    }, resetDelay);
  };

  const updateCurrentRequest = (updater: (request: MaterialRequest) => MaterialRequest) => {
    if (!currentRequest || normalizeUserFacingText(currentRequest.status) === 'Atendida') return;

    const nextRequest = updater(currentRequest);
    nextRequest.updatedAt = new Date().toISOString();
    nextRequest.status = recalculateRequestStatus(nextRequest);

    setRequests(previous =>
      previous.map(request => (request.id === nextRequest.id ? nextRequest : request))
    );
  };

  const finalizeRequest = () => {
    if (!currentRequest) {
      showToast('Abra uma solicitação para concluir a separação.', 'info');
      return;
    }

    if (normalizeUserFacingText(currentRequest.status) === 'Atendida') {
      showToast('Esta solicitação já foi entregue e está bloqueada para consulta.', 'info');
      return;
    }

    const pendingItems = currentRequest.items.filter(item => item.separatedQuantity < item.requestedQuantity);
    if (pendingItems.length > 0) {
      showToast('Ainda existem itens pendentes nesta separação.', 'info');
      return;
    }

    const stockMap = new Map(items.map(item => [item.sku, item]));
    const insufficientItems = currentRequest.items.filter(requestItem => {
      const stockItem = stockMap.get(requestItem.sku);
      return !stockItem || stockItem.quantity < requestItem.separatedQuantity;
    });

    if (insufficientItems.length > 0) {
      const [firstItem] = insufficientItems;
      showToast(`Saldo insuficiente para concluir ${firstItem.sku}.`, 'info');
      return;
    }

    const now = new Date().toISOString();
    const requestItemsBySku = new Map(currentRequest.items.map(requestItem => [requestItem.sku, requestItem]));

    setItems(previous =>
      previous.map(item => {
        const requestItem = requestItemsBySku.get(item.sku);
        if (!requestItem) return item;

        const updatedItem = {
          ...item,
          quantity: Math.max(0, item.quantity - requestItem.separatedQuantity)
        };

        return {
          ...updatedItem,
          status: calculateItemStatus(updatedItem, settings)
        };
      })
    );

    const generatedLogs: InventoryLog[] = currentRequest.items.map(requestItem => {
      const stockItem = stockMap.get(requestItem.sku)!;
      return {
        id: `${currentRequest.code}-${requestItem.sku}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        sku: requestItem.sku,
        itemName: requestItem.itemName,
        previousQuantity: stockItem.quantity,
        delta: requestItem.separatedQuantity * -1,
        quantityAfter: Math.max(0, stockItem.quantity - requestItem.separatedQuantity),
        location: requestItem.location,
        date: now,
        source: 'solicitacao',
        referenceCode: currentRequest.code
      };
    });

    setLogs(previous => [...generatedLogs, ...previous]);
    setRequests(previous =>
      previous.map(request =>
        request.id === currentRequest.id
          ? {
              ...request,
              status: 'Atendida',
              fulfilledAt: now,
              updatedAt: now
            }
          : request
      )
    );

    showToast(`Solicitação ${currentRequest.code} concluída e baixada do estoque.`, 'success');
    closeScanner();
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[360px_minmax(0,1fr)] gap-6">
      <aside className="space-y-4">
        <section className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 shadow-sm p-5">
          <span className="text-primary font-label text-[11px] font-semibold uppercase tracking-wider">
            Separação de material
          </span>
          <h2 className="text-2xl font-extrabold text-on-surface font-headline tracking-tight mt-1">
            Operação guiada por etiqueta
          </h2>
          <p className="text-sm text-on-surface-variant mt-2">
            Escolha uma solicitação e use o leitor como coletor. Cada leitura confirma o código certo e soma
            na separação em tempo real.
          </p>
        </section>

        <section className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 shadow-sm p-5">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-outline" size={18} />
            <input
              className="w-full h-12 rounded-lg bg-surface-container-low pl-11 pr-4 border border-outline-variant/20 text-sm focus:ring-2 focus:ring-primary/30"
              value={requestQuery}
              onChange={event => setRequestQuery(event.target.value)}
              placeholder="Buscar solicitação, placa, centro de custo ou SKU"
            />
          </div>

          <div className="mt-4 space-y-3 max-h-[calc(100vh-18rem)] overflow-y-auto pr-1">
            {filteredRequests.length > 0 ? (
              filteredRequests.map(request => {
                const progress = getRequestProgress(request);
                const selected = request.id === currentRequest?.id;

                return (
                  <button
                    key={request.id}
                    type="button"
                    onClick={() => setSelectedRequestId(request.id)}
                    className={`w-full text-left rounded-xl border p-4 transition-colors ${
                      selected
                        ? 'border-primary bg-primary-container/15'
                        : 'border-outline-variant/15 bg-surface-container-low hover:bg-surface-container-high'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-on-surface">{request.code}</p>
                        <p className="text-xs text-on-surface-variant mt-1 truncate">
                          {normalizeUserFacingText(request.vehiclePlate) || 'Sem placa'} • {normalizeUserFacingText(request.costCenter) || 'Sem centro de custo'}
                        </p>
                      </div>
                      <span className={statusClassName(request.status)}>{normalizeUserFacingText(request.status)}</span>
                    </div>

                    <div className="mt-3 h-2 rounded-full bg-surface-container-high overflow-hidden">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${progress.percent}%` }} />
                    </div>

                    <div className="mt-3 flex items-center justify-between text-xs text-on-surface-variant">
                      <span>{progress.separated}/{progress.requested} separados</span>
                      <span>{request.items.length} itens</span>
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="rounded-xl bg-surface-container-low p-8 text-center text-on-surface-variant">
                Nenhuma solicitação encontrada.
              </div>
            )}
          </div>
        </section>
      </aside>

      <section className="space-y-4">
        {currentRequest ? (
          <>
            <section className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 shadow-sm p-5 md:p-6">
              <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-primary font-label text-[11px] font-semibold uppercase tracking-wider">
                      Solicitação ativa
                    </span>
                    <span className={statusClassName(currentRequest.status)}>{normalizeUserFacingText(currentRequest.status)}</span>
                  </div>
                  <h3 className="text-2xl font-extrabold text-on-surface font-headline tracking-tight mt-2">
                    {currentRequest.code}
                  </h3>
                  <p className="text-sm text-on-surface-variant mt-2">
                    {normalizeUserFacingText(currentRequest.vehiclePlate) || 'Sem placa'} • {normalizeUserFacingText(currentRequest.costCenter) || 'Sem centro de custo'}
                  </p>
                  {currentRequest.vehicleDescription && (
                    <p className="text-sm text-on-surface mt-3 bg-surface-container-low rounded-lg px-4 py-3">
                      {normalizeUserFacingText(currentRequest.vehicleDescription)}
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-3 min-w-0 md:min-w-[300px]">
                  <SummaryCard label="Itens" value={String(currentRequest.items.length)} />
                  <SummaryCard label="Separados" value={String(requestProgress?.separated ?? 0)} />
                  <SummaryCard label="Pendentes" value={String(requestProgress?.pending ?? 0)} />
                </div>
              </div>

              {isCurrentRequestLocked && (
                <div className="mt-4 rounded-xl border border-outline-variant/20 bg-surface-container-low px-4 py-4 flex items-start gap-3">
                  <ShieldAlert size={18} className="text-primary shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-on-surface">Solicitação concluída</p>
                    <p className="text-sm text-on-surface-variant mt-1">
                      Este pedido já foi entregue. A tela fica disponível somente para consulta do histórico e das quantidades separadas.
                    </p>
                  </div>
                </div>
              )}
            </section>

            <section className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 shadow-sm p-5">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div>
                  <h3 className="font-headline font-bold text-xl text-on-surface">Leitor para separação</h3>
                  <p className="text-sm text-on-surface-variant mt-1">
                    O leitor só confirma o item se o código estiver correto para esta solicitação.
                  </p>
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={startScanner}
                    disabled={isCurrentRequestLocked}
                    className="h-11 px-4 rounded-lg bg-primary text-on-primary font-bold flex items-center gap-2"
                  >
                    {isScannerBusy ? <Loader2 size={18} className="animate-spin" /> : <Camera size={18} />}
                    Ler etiqueta
                  </button>
                  {isScannerOpen && (
                    <button
                      type="button"
                      onClick={closeScanner}
                      className="h-11 px-4 rounded-lg bg-surface-container-highest text-primary font-semibold"
                    >
                      Fechar leitor
                    </button>
                  )}
                </div>
              </div>

              <input
                ref={photoInputRef}
                className="hidden"
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handlePhotoRead}
              />

              {(isScannerOpen || isScannerBusy) && (
                <div
                  className={`mt-4 rounded-xl px-4 py-4 border ${
                    scannerFeedback === 'error'
                      ? 'bg-error-dim/90 text-on-error border-error'
                      : scannerFeedback === 'success'
                        ? 'bg-emerald-950/90 text-emerald-50 border-emerald-400'
                        : 'bg-inverse-surface text-on-primary border-white/10'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 font-bold text-sm">
                        {isScannerBusy ? <Loader2 className="animate-spin" size={16} /> : <Barcode size={16} />}
                        Leitor em operação
                      </div>
                      <p
                        className={`text-[11px] mt-1 ${
                          scannerFeedback === 'error'
                            ? 'text-on-error/80'
                            : scannerFeedback === 'success'
                              ? 'text-emerald-100/80'
                              : 'text-inverse-on-surface'
                        }`}
                      >
                        {scannerStatus}
                      </p>
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

                  <div className="mt-3 grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_220px] gap-3 items-center">
                    <div className="relative h-28 rounded-lg overflow-hidden bg-black">
                      <video
                        ref={videoRef}
                        className="w-full h-full object-cover"
                        muted
                        playsInline
                        autoPlay
                      />
                      <div
                        className={`absolute inset-x-5 top-1/2 -translate-y-1/2 h-10 rounded-md shadow-[0_0_0_999px_rgba(0,0,0,0.22)] ${
                          scannerFeedback === 'error'
                            ? 'border border-red-400'
                            : scannerFeedback === 'success'
                              ? 'border border-emerald-300/90'
                              : 'border border-sky-300/80'
                        }`}
                      />
                    </div>
                    <div
                      className={`text-xs leading-relaxed ${
                        scannerFeedback === 'error'
                          ? 'text-on-error/80'
                          : scannerFeedback === 'success'
                            ? 'text-emerald-100/80'
                            : 'text-inverse-on-surface'
                      }`}
                    >
                      Verde confirma o QR Code certo. Vermelho avisa quando a leitura não pertence a este pedido.
                    </div>
                  </div>
                </div>
              )}
            </section>

            <section className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 shadow-sm p-5">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
                <div>
                  <h3 className="font-headline font-bold text-xl text-on-surface">Itens para separar</h3>
                  <p className="text-sm text-on-surface-variant mt-1">
                    O leitor soma as peças automaticamente, mas você também pode ajustar manualmente aqui.
                  </p>
                </div>
                  <button
                    type="button"
                    onClick={finalizeRequest}
                    disabled={isCurrentRequestLocked}
                    className="h-11 px-4 rounded-lg bg-primary text-on-primary font-bold flex items-center gap-2 disabled:opacity-60"
                  >
                  <PackageCheck size={18} />
                  Concluir e baixar estoque
                </button>
              </div>

              <div className="space-y-3">
                {currentRequest.items.map(requestItem => {
                  const isHighlighted = lastConfirmedSku === requestItem.sku;
                  const separatedDone = requestItem.separatedQuantity >= requestItem.requestedQuantity;

                  return (
                    <div
                      key={requestItem.id}
                      className={`rounded-xl border p-4 transition-colors ${
                        isHighlighted
                          ? 'border-primary bg-primary-container/15'
                          : 'border-outline-variant/15 bg-surface-container-low'
                      }`}
                    >
                      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
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
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              updateCurrentRequest(request =>
                                bumpSeparatedQuantity(request, requestItem.sku, -1).request
                              )
                            }
                            disabled={isCurrentRequestLocked}
                            className="h-10 w-10 rounded-lg bg-surface-container-lowest text-on-surface flex items-center justify-center"
                          >
                            <Minus size={18} />
                          </button>

                          <div className="min-w-[132px] rounded-lg bg-surface-container-lowest px-4 py-2 text-center">
                            <p className="text-[11px] font-bold uppercase text-outline">Separado</p>
                            <p className="font-headline font-bold text-lg text-on-surface">
                              {requestItem.separatedQuantity}/{requestItem.requestedQuantity}
                            </p>
                          </div>

                          <button
                            type="button"
                            onClick={() =>
                              updateCurrentRequest(request =>
                                bumpSeparatedQuantity(request, requestItem.sku, 1).request
                              )
                            }
                            disabled={isCurrentRequestLocked}
                            className="h-10 w-10 rounded-lg bg-surface-container-lowest text-on-surface flex items-center justify-center"
                          >
                            <ChevronRight size={18} />
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              updateCurrentRequest(request => fillPendingQuantity(request, requestItem.id))
                            }
                            disabled={isCurrentRequestLocked}
                            className="h-10 px-4 rounded-lg bg-surface-container-highest text-primary font-semibold text-sm"
                          >
                            Completar
                          </button>
                        </div>
                      </div>

                      <div className="mt-3 h-2 rounded-full bg-surface-container-high overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            separatedDone ? 'bg-emerald-500' : 'bg-primary'
                          }`}
                          style={{
                            width: `${Math.min(
                              100,
                              Math.round((requestItem.separatedQuantity / requestItem.requestedQuantity) * 100)
                            )}%`
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              {normalizeUserFacingText(currentRequest.status) !== 'Atendida' && requestProgress && requestProgress.pending > 0 && (
                <div className="mt-4 rounded-xl bg-error-container/20 border border-error-container/20 px-4 py-3 flex items-start gap-3">
                  <ShieldAlert size={18} className="text-error shrink-0 mt-0.5" />
                  <p className="text-sm text-on-surface">
                    Ainda faltam <strong>{requestProgress.pending}</strong> unidades para concluir esta separação.
                  </p>
                </div>
              )}
            </section>
          </>
        ) : (
          <section className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 shadow-sm p-8 text-center text-on-surface-variant">
            Escolha uma solicitação para iniciar a separação.
          </section>
        )}
      </section>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface-container-low p-4 text-center">
      <p className="text-[11px] font-bold uppercase tracking-wider text-outline">{label}</p>
      <p className="font-headline font-bold text-2xl text-on-surface mt-1">{value}</p>
    </div>
  );
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
