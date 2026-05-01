import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser';
import {
  Barcode,
  Camera,
  ChevronRight,
  Loader2,
  Minus,
  PackageCheck,
  Pencil,
  RotateCcw,
  Search,
  ShieldAlert,
  Trash2,
  X
} from 'lucide-react';
import { InventoryItem, InventoryLog, InventorySettings, MaterialRequest, MaterialRequestAuditActor, MaterialRequestAuditEntry } from '../types';
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
  prepareScannerVideo,
  resolveScannedCode,
  startPreparedScanner
} from '../barcodeUtils';
import { normalizeLocationText, normalizeUserFacingText } from '../textUtils';

interface MaterialSeparationProps {
  items: InventoryItem[];
  setItems: React.Dispatch<React.SetStateAction<InventoryItem[]>>;
  logs: InventoryLog[];
  setLogs: React.Dispatch<React.SetStateAction<InventoryLog[]>>;
  requests: MaterialRequest[];
  setRequests: React.Dispatch<React.SetStateAction<MaterialRequest[]>>;
  canEdit: boolean;
  canDeleteRequests: boolean;
  canReverseRequests: boolean;
  auditActor: MaterialRequestAuditActor;
  selectedRequestId: string | null;
  setSelectedRequestId: (requestId: string | null) => void;
  onEditRequest: (requestId: string) => void;
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
  canEdit,
  canDeleteRequests,
  canReverseRequests,
  auditActor,
  selectedRequestId,
  setSelectedRequestId,
  onEditRequest,
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
  const [quantityConfirmation, setQuantityConfirmation] = useState<{
    requestId: string;
    sku: string;
    itemName: string;
    location: string;
    expectedRemaining: number | null;
    separatedAfter: number;
  } | null>(null);
  const [quantityConfirmationValue, setQuantityConfirmationValue] = useState('');
  const [reportedRemainingBySku, setReportedRemainingBySku] = useState<Record<string, number>>({});
  const videoRef = useRef<HTMLVideoElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const scannerControlsRef = useRef<IScannerControls | null>(null);
  const scannerReaderRef = useRef<BrowserMultiFormatReader | null>(null);
  const scanLockedRef = useRef(false);
  const releaseTimerRef = useRef<number | null>(null);
  const canMutate = canEdit;
  const audioContextRef = useRef<AudioContext | null>(null);
  const itemsRef = useRef(items);
  const requestRef = useRef<MaterialRequest | null>(null);
  const aliasRef = useRef(ocrAliases);
  const assistBusyRef = useRef(false);
  const appendAuditEntry = (
    request: MaterialRequest,
    entry: Omit<MaterialRequestAuditEntry, 'id'>,
    toleranceMs = 60_000
  ) => {
    const trail = Array.isArray(request.auditTrail) ? request.auditTrail : [];
    const last = trail.length > 0 ? trail[trail.length - 1] : null;
    const lastAt = last ? new Date(last.at).getTime() : 0;
    const nextAt = new Date(entry.at).getTime();
    const isDuplicate =
      last &&
      last.event === entry.event &&
      (last.actor?.matricula || '') === (entry.actor?.matricula || '') &&
      (last.detail || '') === (entry.detail || '') &&
      Math.abs(nextAt - lastAt) <= toleranceMs;

    if (isDuplicate) return request;

    const nextTrail: MaterialRequestAuditEntry[] = [
      ...trail,
      {
        id: `${entry.event}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ...entry
      }
    ].slice(-200);

    return { ...request, auditTrail: nextTrail };
  };

  const filteredRequests = useMemo(() => {
    const query = requestQuery.trim().toLowerCase();
    const sorted = [...requests].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    const openOnly = sorted.filter(request => {
      if (request.deletedAt) return false;
      const status = normalizeUserFacingText(request.status);
      return status !== 'Atendida' && status !== 'Estornada';
    });

    if (!query) return openOnly;

    return openOnly.filter(request =>
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
    () => requests.find(request => request.id === selectedRequestId && !request.deletedAt) || null,
    [requests, selectedRequestId]
  );

  useEffect(() => {
    setQuantityConfirmation(null);
    setQuantityConfirmationValue('');
    setReportedRemainingBySku({});
  }, [currentRequest?.id]);

  const requestProgress = currentRequest ? getRequestProgress(currentRequest) : null;
  const currentStatus = normalizeUserFacingText(currentRequest?.status);
  const isCurrentRequestLocked = currentStatus === 'Atendida' || currentStatus === 'Estornada';
  const canReverseCurrentRequest = canReverseRequests && currentStatus === 'Atendida';

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
    if (!selectedRequestId || !requests.some(request => request.id === selectedRequestId && !request.deletedAt)) {
      const firstOpenRequest =
        requests.find(request => {
          if (request.deletedAt) return false;
          const status = normalizeUserFacingText(request.status);
          return status !== 'Atendida' && status !== 'Estornada';
        }) ||
        requests[0] ||
        null;
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

        const controls = await startPreparedScanner(
          reader,
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
          setScannerStatus('Leitor ativo. Mire a etiqueta e aguarde o bip.');
        }
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

    const status = normalizeUserFacingText(requestRef.current.status);
    if (status === 'Atendida' || status === 'Estornada') {
      showToast('Esta solicitação está fechada e está disponível somente para consulta.', 'info');
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) {
      photoInputRef.current?.click();
      return;
    }

    setScannerStatus('Preparando leitor...');
    setScannerFeedback('neutral');
    stopScannerSession();
    setIsScannerBusy(true);
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

    const activeStatus = normalizeUserFacingText(activeRequest.status);
    if (activeStatus === 'Atendida' || activeStatus === 'Estornada') {
      setScannerFeedback('error');
      setScannerStatus('Solicitação fechada. O histórico está liberado somente para consulta.');
      showToast('Esta solicitação está fechada e está bloqueada para consulta.', 'info');
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
    const matchedSkuKey = normalizeSku(detected.matchedSku);
    const stockItem =
      itemsRef.current.find(item => normalizeSku(item.sku) === matchedSkuKey) || null;
    const location = normalizeLocationText(stockItem?.location || requestItem.location);
    const expectedRemaining = stockItem ? Math.max(0, stockItem.quantity - nextSeparated) : null;
    const expectedMessage =
      expectedRemaining === null
        ? `SKU ${detected.matchedSku} confirmado para ${normalizeUserFacingText(requestItem.itemName)}. Confira o saldo real na localização ${location}.`
        : buildRemainingMessage(detected.matchedSku, requestItem.itemName, expectedRemaining, location);
    setScannerStatus(expectedMessage);
    showToast(expectedMessage, 'success');
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
    if (activeRequest) {
      if (releaseTimerRef.current) {
        window.clearTimeout(releaseTimerRef.current);
        releaseTimerRef.current = null;
      }
      scanLockedRef.current = true;
      setScannerFeedback('success');
      setQuantityConfirmation({
        requestId: activeRequest.id,
        sku: detected.matchedSku,
        itemName: requestItem.itemName,
        location,
        expectedRemaining,
        separatedAfter: nextSeparated
      });
      setQuantityConfirmationValue(expectedRemaining === null ? '' : String(expectedRemaining));
      return;
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
    if (!currentRequest || isCurrentRequestLocked) return;
    if (!canMutate) {
      showToast('Modo consulta: sem permissão para alterar solicitações.', 'info');
      return;
    }

    const nextRequest = updater(currentRequest);
    const now = new Date().toISOString();
    nextRequest.updatedAt = now;
    nextRequest.status = recalculateRequestStatus(nextRequest);
    const withAudit = appendAuditEntry(
      nextRequest,
      {
        at: now,
        event: 'separation_updated',
        actor: auditActor,
        detail: 'Separação em andamento'
      },
      120_000
    );

    setRequests(previous =>
      previous.map(request => (request.id === withAudit.id ? withAudit : request))
    );
  };

  const finalizeRequest = () => {
    if (!currentRequest) {
      showToast('Abra uma solicitação para concluir a separação.', 'info');
      return;
    }

    if (isCurrentRequestLocked) {
      showToast('Esta solicitação está fechada e está bloqueada para consulta.', 'info');
      return;
    }

    if (!canMutate) {
      showToast('Modo consulta: sem permissão para concluir a separação.', 'info');
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

        const reportedRemaining = reportedRemainingBySku[item.sku];
        const nextQuantity = Number.isFinite(reportedRemaining)
          ? Math.max(0, Math.floor(reportedRemaining))
          : Math.max(0, item.quantity - requestItem.separatedQuantity);

        const updatedItem = {
          ...item,
          quantity: nextQuantity,
          updatedAt: now
        };

        return {
          ...updatedItem,
          status: calculateItemStatus(updatedItem, settings)
        };
      })
    );

    const generatedLogs: InventoryLog[] = currentRequest.items.map(requestItem => {
      const stockItem = stockMap.get(requestItem.sku)!;
      const expectedAfter = Math.max(0, stockItem.quantity - requestItem.separatedQuantity);
      const reportedRemaining = reportedRemainingBySku[requestItem.sku];
      const quantityAfter = Number.isFinite(reportedRemaining) ? Math.max(0, Math.floor(reportedRemaining)) : expectedAfter;

      return {
        id: `${currentRequest.code}-${requestItem.sku}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        sku: requestItem.sku,
        itemName: requestItem.itemName,
        previousQuantity: stockItem.quantity,
        delta: quantityAfter - stockItem.quantity,
        quantityAfter,
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
          ? appendAuditEntry(
              {
                ...request,
                status: 'Atendida',
                fulfilledAt: now,
                updatedAt: now
              },
              {
                at: now,
                event: 'separation_fulfilled',
                actor: auditActor,
                detail: 'Concluiu e baixou estoque'
              }
            )
          : request
      )
    );

    showToast(`Solicitação ${currentRequest.code} concluída e baixada do estoque.`, 'success');
    closeScanner();
    setReportedRemainingBySku({});
    setQuantityConfirmation(null);
    setQuantityConfirmationValue('');
  };

  const reverseRequest = () => {
    if (!currentRequest) {
      showToast('Abra uma solicitação para estornar.', 'info');
      return;
    }
    if (!canReverseRequests) {
      showToast('Somente administradores podem estornar solicitações atendidas.', 'info');
      return;
    }
    if (normalizeUserFacingText(currentRequest.status) !== 'Atendida') {
      showToast('Somente solicitações atendidas podem ser estornadas.', 'info');
      return;
    }

    const confirmed = window.confirm(
      `Estornar a solicitação ${currentRequest.code}? Isso devolve ao estoque as quantidades baixadas.`
    );
    if (!confirmed) return;

    const now = new Date().toISOString();
    const requestCode = currentRequest.code;

    const latestRequestLogBySku = new Map<string, InventoryLog>();
    logs.forEach(log => {
      if (log.source !== 'solicitacao') return;
      if (String(log.referenceCode || '') !== requestCode) return;
      const existing = latestRequestLogBySku.get(log.sku);
      if (!existing) {
        latestRequestLogBySku.set(log.sku, log);
        return;
      }
      const existingAt = new Date(existing.date).getTime();
      const candidateAt = new Date(log.date).getTime();
      if (candidateAt >= existingAt) {
        latestRequestLogBySku.set(log.sku, log);
      }
    });

    const requestItemBySku = new Map(currentRequest.items.map(item => [item.sku, item]));
    const restockAmountBySku = new Map<string, number>();

    currentRequest.items.forEach(requestItem => {
      const log = latestRequestLogBySku.get(requestItem.sku);
      const fromLog = log ? Math.max(0, Math.floor(Math.abs(Number(log.delta) || 0))) : 0;
      const fallback = Math.max(0, Math.floor(requestItem.separatedQuantity || 0));
      const amount = fromLog > 0 ? fromLog : fallback;
      if (amount > 0) {
        restockAmountBySku.set(requestItem.sku, amount);
      }
    });

    setItems(previous =>
      previous.map(item => {
        const amount = restockAmountBySku.get(item.sku);
        if (!amount) return item;
        const updatedItem = {
          ...item,
          quantity: Math.max(0, item.quantity + amount),
          updatedAt: now
        };
        return { ...updatedItem, status: calculateItemStatus(updatedItem, settings) };
      })
    );

    setLogs(previous => {
      const nextLogs: InventoryLog[] = [];
      const stockMap = new Map(itemsRef.current.map(item => [item.sku, item]));

      restockAmountBySku.forEach((amount, sku) => {
        const requestItem = requestItemBySku.get(sku);
        if (!requestItem) return;
        const stockItem = stockMap.get(sku);
        if (!stockItem) return;

        nextLogs.push({
          id: `estorno-${requestCode}-${sku}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          sku,
          itemName: requestItem.itemName,
          previousQuantity: stockItem.quantity,
          delta: amount,
          quantityAfter: stockItem.quantity + amount,
          location: requestItem.location,
          date: now,
          source: 'recebimento',
          referenceCode: `ESTORNO ${requestCode}`
        });
      });

      return [...nextLogs, ...previous];
    });

    setRequests(previous =>
      previous.map(request =>
        request.id === currentRequest.id
          ? appendAuditEntry(
              {
                ...request,
                status: 'Estornada',
                reversedAt: now,
                updatedAt: now
              },
              {
                at: now,
                event: 'separation_reversed',
                actor: auditActor,
                detail: 'Estorno realizado'
              }
            )
          : request
      )
    );

    closeScanner();
    setReportedRemainingBySku({});
    setQuantityConfirmation(null);
    setQuantityConfirmationValue('');
    showToast(`Solicitação ${currentRequest.code} estornada. Estoque devolvido.`, 'success');
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[360px_minmax(0,1fr)] gap-6">
      <aside className="space-y-4">
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
                const editableStatus = normalizeUserFacingText(request.status) !== 'Atendida' && normalizeUserFacingText(request.status) !== 'Estornada';

                return (
                  <div
                    key={request.id}
                    className={`w-full rounded-xl border transition-colors ${
                      selected
                        ? 'border-primary bg-primary-container/15'
                        : 'border-outline-variant/15 bg-surface-container-low hover:bg-surface-container-high'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedRequestId(request.id)}
                      className="w-full text-left p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-on-surface">{request.code}</p>
                          <p className="text-xs text-on-surface-variant mt-1 truncate">
                            {normalizeUserFacingText(request.vehiclePlate) || 'Sem placa'} •{' '}
                            {normalizeUserFacingText(request.costCenter) || 'Sem centro de custo'}
                          </p>
                        </div>
                        <span className={statusClassName(request.status)}>{normalizeUserFacingText(request.status)}</span>
                      </div>

                      <div className="mt-3 h-2 rounded-full bg-surface-container-high overflow-hidden">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${progress.percent}%` }} />
                      </div>

                      <div className="mt-3 flex items-center justify-between text-xs text-on-surface-variant">
                        <span>
                          {progress.separated}/{progress.requested} separados
                        </span>
                        <span>{request.items.length} itens</span>
                      </div>
                    </button>

                    {editableStatus && (canEdit || canDeleteRequests) && (
                      <div className="px-4 pb-4 flex gap-2">
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => onEditRequest(request.id)}
                            className="flex-1 h-10 rounded-lg bg-surface-container-lowest text-on-surface font-semibold text-sm flex items-center justify-center gap-2"
                          >
                            <Pencil size={16} />
                            Editar
                          </button>
                        )}
                        {canDeleteRequests && (
                          <button
                            type="button"
                            onClick={() => {
                              const confirmed = window.confirm(`Remover a solicitação ${request.code}?`);
                              if (!confirmed) return;
                              const now = new Date().toISOString();
                              setRequests(previous =>
                                previous.map(entry =>
                                  entry.id === request.id
                                    ? {
                                        ...entry,
                                        deletedAt: now,
                                        updatedAt: now
                                      }
                                    : entry
                                )
                              );
                              if (selectedRequestId === request.id) {
                                setSelectedRequestId(null);
                              }
                              showToast(`Solicitação ${request.code} removida.`, 'success');
                            }}
                            className="h-10 px-3 rounded-lg bg-error-container/40 text-error font-semibold text-sm flex items-center justify-center gap-2"
                          >
                            <Trash2 size={16} />
                            Remover
                          </button>
                        )}
                      </div>
                    )}
                  </div>
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
                    <p className="font-semibold text-on-surface">
                      {currentStatus === 'Estornada' ? 'Solicitação estornada' : 'Solicitação concluída'}
                    </p>
                    <p className="text-sm text-on-surface-variant mt-1">
                      {currentStatus === 'Estornada'
                        ? 'Este pedido foi estornado. O histórico fica disponível somente para consulta.'
                        : 'Este pedido já foi entregue. A tela fica disponível somente para consulta do histórico e das quantidades separadas.'}
                    </p>
                    {canReverseCurrentRequest && (
                      <button
                        type="button"
                        onClick={reverseRequest}
                        className="mt-3 h-11 w-full px-4 rounded-lg bg-sky-100 text-sky-950 font-bold flex items-center justify-center gap-2"
                      >
                        <RotateCcw size={18} />
                        Estornar solicitação
                      </button>
                    )}
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

                  <div className="mt-3 grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_240px] gap-3 items-center">
                    <div className="relative h-56 sm:h-64 md:h-60 rounded-xl overflow-hidden bg-black">
                      <video
                        ref={videoRef}
                        className="w-full h-full object-cover"
                        muted
                        playsInline
                        autoPlay
                      />
                      <div
                        className={`absolute left-1/2 top-1/2 h-[min(62vw,220px)] w-[min(62vw,220px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border-2 shadow-[0_0_0_999px_rgba(0,0,0,0.24)] ${
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

              {!isCurrentRequestLocked && requestProgress && requestProgress.pending > 0 && (
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

      {quantityConfirmation ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-lg rounded-2xl bg-surface-container-lowest border border-outline-variant/20 shadow-xl p-5">
            <p className="text-xs font-bold uppercase tracking-widest text-primary">Conferência de saldo</p>
            <h3 className="font-headline font-bold text-xl text-on-surface mt-2">
              {normalizeUserFacingText(quantityConfirmation.itemName)}
            </h3>
            <p className="text-sm text-on-surface-variant mt-2">
              SKU {quantityConfirmation.sku} • Localização {quantityConfirmation.location}
            </p>

            <div className="mt-4 rounded-xl bg-surface-container-low p-4">
              <p className="text-xs font-bold uppercase tracking-widest text-outline">Sistema (após retirar 1)</p>
              <p className="text-2xl font-headline font-bold text-on-surface mt-2">
                {quantityConfirmation.expectedRemaining === null ? '--' : `${quantityConfirmation.expectedRemaining} un`}
              </p>
            </div>

            <div className="mt-4">
              <label className="block text-xs font-bold uppercase tracking-widest text-outline mb-2">
                Quantidade real na locação
              </label>
              <input
                type="number"
                inputMode="numeric"
                className="w-full h-12 rounded-lg bg-surface-container-highest border border-outline-variant/20 px-4 text-on-surface font-bold"
                value={quantityConfirmationValue}
                onChange={event => setQuantityConfirmationValue(event.target.value)}
              />
              {quantityConfirmation.expectedRemaining !== null &&
              Number.isFinite(Number(quantityConfirmationValue)) &&
              Math.floor(Number(quantityConfirmationValue)) !== quantityConfirmation.expectedRemaining ? (
                <p className="text-[11px] text-error mt-2 font-semibold">
                  Divergência detectada: valor diferente do sistema.
                </p>
              ) : null}
            </div>

            <form
              className="mt-5 flex flex-col-reverse sm:flex-row gap-2 justify-end"
              onSubmit={event => {
                event.preventDefault();

                const active = quantityConfirmation;
                if (!active || !currentRequest || active.requestId !== currentRequest.id) {
                  setQuantityConfirmation(null);
                  setQuantityConfirmationValue('');
                  lockScannerBriefly('neutral', 250);
                  return;
                }

                const parsed = Number(quantityConfirmationValue);
                if (!Number.isFinite(parsed) || parsed < 0) {
                  showToast('Informe uma quantidade válida (0 ou maior).', 'info');
                  return;
                }

                const reportedRemaining = Math.floor(parsed);
                const expectedRemaining = active.expectedRemaining;
                const isDivergent = expectedRemaining !== null && reportedRemaining !== expectedRemaining;

                setReportedRemainingBySku(previous => ({
                  ...previous,
                  [active.sku]: reportedRemaining
                }));

                if (isDivergent) {
                  const now = new Date().toISOString();
                  setLogs(previous => [
                    {
                      id: `div-${currentRequest.code}-${active.sku}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                      sku: active.sku,
                      itemName: active.itemName,
                      previousQuantity: expectedRemaining,
                      delta: reportedRemaining - expectedRemaining,
                      quantityAfter: reportedRemaining,
                      location: active.location,
                      date: now,
                      source: 'divergencia',
                      referenceCode: currentRequest.code,
                      expectedQuantityAfter: expectedRemaining,
                      reportedQuantityAfter: reportedRemaining
                    },
                    ...previous
                  ]);
                }

                const confirmationMessage = buildRemainingMessage(active.sku, active.itemName, reportedRemaining, active.location);
                setScannerStatus(confirmationMessage);
                showToast(confirmationMessage, 'success');
                setQuantityConfirmation(null);
                setQuantityConfirmationValue('');
                lockScannerBriefly('success', 900);
              }}
            >
              <button
                type="button"
                className="h-11 px-4 rounded-lg bg-surface-container-highest text-on-surface font-bold"
                onClick={() => {
                  const active = quantityConfirmation;
                  if (active?.expectedRemaining !== null && active?.expectedRemaining !== undefined) {
                    setReportedRemainingBySku(previous => ({
                      ...previous,
                      [active.sku]: active.expectedRemaining as number
                    }));
                    const confirmationMessage = buildRemainingMessage(
                      active.sku,
                      active.itemName,
                      active.expectedRemaining,
                      active.location
                    );
                    setScannerStatus(confirmationMessage);
                    showToast(confirmationMessage, 'success');
                  }
                  setQuantityConfirmation(null);
                  setQuantityConfirmationValue('');
                  lockScannerBriefly('success', 900);
                }}
              >
                Usar saldo do sistema
              </button>
              <button
                type="submit"
                className="h-11 px-4 rounded-lg bg-primary text-on-primary font-bold"
              >
                {quantityConfirmation.expectedRemaining !== null &&
                Number.isFinite(Number(quantityConfirmationValue)) &&
                Math.floor(Number(quantityConfirmationValue)) !== quantityConfirmation.expectedRemaining
                  ? 'Registrar divergência'
                  : 'Confirmar'}
              </button>
            </form>

            <p className="text-[11px] text-on-surface-variant mt-3">
              Se estiver diferente do sistema, digite o valor real e confirme. A divergência fica registrada e será aplicada ao baixar o estoque.
            </p>
          </div>
        </div>
      ) : null}
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

function buildRemainingMessage(sku: string, itemName: string, remaining: number, location: string) {
  return `SKU ${sku} confirmado para ${normalizeUserFacingText(itemName)}. Restam ${remaining} na localização ${location}.`;
}

function statusClassName(status: MaterialRequest['status']) {
  const normalized = normalizeUserFacingText(status);
  switch (normalized) {
    case 'Atendida':
      return 'inline-flex items-center rounded-full bg-emerald-100 px-3 py-1 text-[11px] font-bold text-emerald-950';
    case 'Estornada':
      return 'inline-flex items-center rounded-full bg-sky-100 px-3 py-1 text-[11px] font-bold text-sky-950';
    case 'Aberta':
      return 'inline-flex items-center rounded-full bg-yellow-100 px-3 py-1 text-[11px] font-bold text-yellow-950';
    case 'Separada':
      return 'inline-flex items-center rounded-full bg-surface-container-high px-3 py-1 text-[11px] font-bold text-primary';
    case 'Em separação':
      return 'inline-flex items-center rounded-full bg-secondary-container px-3 py-1 text-[11px] font-bold text-on-secondary-container';
    default:
      return 'inline-flex items-center rounded-full bg-surface-container-highest px-3 py-1 text-[11px] font-bold text-on-surface-variant';
  }
}

function normalizeSku(value: string | null | undefined) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const digits = raw.replace(/[^\d]/g, '');
  if (digits) return digits.replace(/^0+/, '') || '0';
  return raw.toLowerCase().replace(/\s+/g, '');
}
