import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser';
import { Barcode, Camera, History, LoaderCircle, Printer, RotateCcw, Search, X } from 'lucide-react';
import {
  decodeFileCode,
  decodeVideoSnapshotCode,
  getScannerReader,
  isExpectedScannerError,
  playConfirmTone,
  prepareScannerVideo,
  resolveScannedCode,
  startPreparedScanner
} from '../barcodeUtils';
import { InventoryItem, InventoryLog, InventorySettings, MaterialRequest, MaterialRequestAuditActor, MaterialRequestAuditEntry } from '../types';
import { calculateItemStatus } from '../inventoryRules';
import { getRequestProgress, recalculateRequestStatus } from '../requestUtils';
import { normalizeLocationText, normalizeUserFacingText } from '../textUtils';
import { formatDivergenceDelta, getRequestDivergenceLogs } from '../divergenceRules';

interface RequestHistoryProps {
  requests: MaterialRequest[];
  logs: InventoryLog[];
  items: InventoryItem[];
  setItems: React.Dispatch<React.SetStateAction<InventoryItem[]>>;
  setLogs: React.Dispatch<React.SetStateAction<InventoryLog[]>>;
  setRequests: React.Dispatch<React.SetStateAction<MaterialRequest[]>>;
  settings: InventorySettings;
  auditActor: MaterialRequestAuditActor;
  canReverseRequests: boolean;
  onSelectSku: (sku: string) => void;
  showToast: (message: string, type?: 'success' | 'info') => void;
}

export default function RequestHistory({
  requests,
  logs,
  items,
  setItems,
  setLogs,
  setRequests,
  settings,
  auditActor,
  canReverseRequests,
  onSelectSku,
  showToast
}: RequestHistoryProps) {
  const [query, setQuery] = useState('');
  const [filterPlate, setFilterPlate] = useState('');
  const [filterSku, setFilterSku] = useState('');
  const [filterUser, setFilterUser] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [isSkuScannerOpen, setIsSkuScannerOpen] = useState(false);
  const [isSkuScannerBusy, setIsSkuScannerBusy] = useState(false);
  const [skuScannerStatus, setSkuScannerStatus] = useState('Leitor pronto para QR Code.');
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(() => {
    const first = requests.find(request => request?.id && !request.deletedAt);
    return first?.id ? first.id : null;
  });

  const normalizePlateFilter = (value: string) => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const normalizeSkuFilter = (value: string) => String(value || '').trim().replace(/[^\d]/g, '');

  const skuVideoRef = useRef<HTMLVideoElement>(null);
  const skuPhotoInputRef = useRef<HTMLInputElement>(null);
  const skuScannerControlsRef = useRef<IScannerControls | null>(null);
  const skuScannerReaderRef = useRef<BrowserMultiFormatReader | null>(null);
  const skuScanLockedRef = useRef(false);
  const skuAssistBusyRef = useRef(false);
  const skuAudioContextRef = useRef<AudioContext | null>(null);
  const scanItemsRef = useRef<InventoryItem[]>([]);
  const aliasRef = useRef<Record<string, string>>({});
  const itemsRef = useRef(items);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const appendAuditEntry = (
    request: MaterialRequest,
    entry: Omit<MaterialRequestAuditEntry, 'id'>,
    toleranceMs = 120_000
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

  const getActorKey = (actor: { matricula?: string; name?: string } | null | undefined) => {
    const matricula = String(actor?.matricula || '').trim();
    if (matricula) return `m:${matricula}`;
    const name = normalizeUserFacingText(actor?.name).trim().toLowerCase();
    return name ? `n:${name}` : '';
  };

  const userOptions = useMemo(() => {
    const map = new Map<string, { key: string; label: string }>();
    requests.forEach(request => {
      (request.auditTrail || []).forEach(entry => {
        const key = getActorKey(entry.actor);
        if (!key || map.has(key)) return;
        const name = normalizeUserFacingText(entry.actor?.name).trim();
        const matricula = String(entry.actor?.matricula || '').trim();
        const label = matricula ? `${name || 'Usuário'} • ${matricula}` : name || 'Usuário';
        map.set(key, { key, label });
      });
    });
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
  }, [requests]);

  const scanItems = useMemo(() => {
    const skuSet = new Set<string>();
    requests.forEach(request => {
      request.items.forEach(item => {
        if (item?.sku) skuSet.add(String(item.sku));
      });
    });

    return Array.from(skuSet.values()).map(sku => ({ sku } as unknown as InventoryItem));
  }, [requests]);

  useEffect(() => {
    scanItemsRef.current = scanItems;
  }, [scanItems]);

  const stopSkuScannerSession = () => {
    skuScannerControlsRef.current?.stop();
    skuScannerControlsRef.current = null;
    skuScanLockedRef.current = false;
    skuAssistBusyRef.current = false;
    if (skuVideoRef.current) {
      BrowserMultiFormatReader.cleanVideoSource(skuVideoRef.current);
    }
    setIsSkuScannerBusy(false);
  };

  const closeSkuScanner = () => {
    stopSkuScannerSession();
    setIsSkuScannerOpen(false);
    setSkuScannerStatus('Leitor pronto para QR Code.');
  };

  const applyDetectedSku = (rawCode: string) => {
    const detected = resolveScannedCode(rawCode, scanItemsRef.current, aliasRef.current);
    const sku = normalizeSkuFilter(detected.matchedSku || detected.detectedCode || '');
    if (!sku) {
      setSkuScannerStatus('Não consegui identificar o SKU. Tente aproximar um pouco mais.');
      return;
    }

    detected.candidates.forEach(candidate => {
      aliasRef.current[candidate] = sku;
    });

    setFilterSku(sku);
    setSkuScannerStatus(`SKU ${sku} confirmado.`);
    void playConfirmTone(skuAudioContextRef);
    if ('vibrate' in navigator) {
      navigator.vibrate?.(60);
    }
    closeSkuScanner();
  };

  const startSkuScanner = async () => {
    if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) {
      skuPhotoInputRef.current?.click();
      return;
    }
    setSkuScannerStatus('Preparando leitor...');
    stopSkuScannerSession();
    setIsSkuScannerBusy(true);
    setIsSkuScannerOpen(true);
  };

  const readSkuFromPhoto = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsSkuScannerBusy(true);
    setSkuScannerStatus('Lendo foto da etiqueta...');

    try {
      const detected = await decodeFileCode(file, scanItemsRef.current, aliasRef.current, setSkuScannerStatus);
      const sku = normalizeSkuFilter(detected.matchedSku || detected.detectedCode || '');
      if (sku) {
        detected.candidates.forEach(candidate => {
          aliasRef.current[candidate] = sku;
        });
        setFilterSku(sku);
        setSkuScannerStatus(`SKU ${sku} confirmado.`);
        void playConfirmTone(skuAudioContextRef);
        if ('vibrate' in navigator) {
          navigator.vibrate?.(60);
        }
      } else {
        showToast('Não consegui identificar o SKU nesta foto.', 'info');
      }
    } catch {
      showToast('Não consegui identificar o código nesta foto.', 'info');
    } finally {
      setIsSkuScannerBusy(false);
      event.target.value = '';
    }
  };

  useEffect(() => {
    if (!isSkuScannerOpen) return;

    let cancelled = false;

    const bootScanner = async () => {
      const video = skuVideoRef.current;
      if (!video) return;

      try {
        const reader = getScannerReader(skuScannerReaderRef);
        setIsSkuScannerBusy(true);
        setSkuScannerStatus('Abrindo leitor...');
        skuScanLockedRef.current = false;

        const controls = await startPreparedScanner(
          reader,
          video,
          (result, error) => {
            if (cancelled || skuScanLockedRef.current) return;

            if (result) {
              skuScanLockedRef.current = true;
              applyDetectedSku(result.getText());
              return;
            }

            if (error && !isExpectedScannerError(error)) {
              setSkuScannerStatus('Ajuste o enquadramento do código.');
            }
          },
          value => {
            if (!cancelled) setSkuScannerStatus(value);
          }
        );

        if (cancelled) {
          controls.stop();
          return;
        }

        skuScannerControlsRef.current = controls;
        const videoReady = await prepareScannerVideo(video, 200);
        if (!videoReady && !cancelled) {
          setSkuScannerStatus('Aguardando imagem da câmera. Se ficar preto, o sistema vai continuar tentando ler.');
        }
        setIsSkuScannerBusy(false);
        if (videoReady) {
          setSkuScannerStatus('Leitor ativo. Mire a etiqueta e aguarde o bip.');
        }

        const assistTimer = window.setInterval(async () => {
          const snapshotVideo = skuVideoRef.current;
          if (
            cancelled ||
            !snapshotVideo ||
            skuScanLockedRef.current ||
            skuAssistBusyRef.current ||
            snapshotVideo.readyState < 2
          ) {
            return;
          }

          skuAssistBusyRef.current = true;
          try {
            const detected = await decodeVideoSnapshotCode(
              snapshotVideo,
              scanItemsRef.current,
              aliasRef.current,
              value => {
                if (!cancelled && !skuScanLockedRef.current) {
                  setSkuScannerStatus(value);
                }
              }
            );

            if (!cancelled && detected?.detectedCode && !skuScanLockedRef.current) {
              skuScanLockedRef.current = true;
              applyDetectedSku(detected.detectedCode);
            }
          } finally {
            skuAssistBusyRef.current = false;
          }
        }, 800);

        const originalStop = controls.stop.bind(controls);
        controls.stop = () => {
          window.clearInterval(assistTimer);
          originalStop();
        };
      } catch {
        if (cancelled) return;
        stopSkuScannerSession();
        setIsSkuScannerOpen(false);
        showToast('Não foi possível abrir a câmera. Vou usar foto da etiqueta.', 'info');
        skuPhotoInputRef.current?.click();
      }
    };

    const timer = window.setTimeout(bootScanner, 50);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      stopSkuScannerSession();
    };
  }, [isSkuScannerOpen, showToast]);

  useEffect(() => () => {
    stopSkuScannerSession();
    skuAudioContextRef.current?.close().catch(() => undefined);
    skuAudioContextRef.current = null;
  }, []);

  const filteredRequests = useMemo(() => {
    const q = query.trim().toLowerCase();
    const plate = normalizePlateFilter(filterPlate);
    const sku = normalizeSkuFilter(filterSku).toLowerCase();
    const userKey = String(filterUser || '').trim();
    const from = filterDateFrom ? new Date(`${filterDateFrom}T00:00:00`).getTime() : null;
    const to = filterDateTo ? new Date(`${filterDateTo}T23:59:59.999`).getTime() : null;

    const sorted = [...requests]
      .map(request => ({ ...request, status: recalculateRequestStatus(request) }))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    return sorted.filter(request => {
      if (request.deletedAt) return false;
      if (plate) {
        const requestPlate = normalizePlateFilter(request.vehiclePlate);
        if (!requestPlate.includes(plate)) return false;
      }

      if (sku) {
        const matchesSku = request.items.some(item => item.sku.toLowerCase().includes(sku));
        if (!matchesSku) return false;
      }

      if (userKey) {
        const matchesUser = (request.auditTrail || []).some(entry => getActorKey(entry.actor) === userKey);
        if (!matchesUser) return false;
      }

      if (from !== null || to !== null) {
        const timestamps: string[] = [
          String(request.createdAt || ''),
          String(request.updatedAt || ''),
          String(request.fulfilledAt || ''),
          String(request.reversedAt || '')
        ].filter(Boolean);
        (request.auditTrail || []).forEach(entry => {
          if (entry?.at) timestamps.push(String(entry.at));
        });

        const matchesDate = timestamps.some(value => {
          const parsed = new Date(value).getTime();
          if (!Number.isFinite(parsed)) return false;
          if (from !== null && parsed < from) return false;
          if (to !== null && parsed > to) return false;
          return true;
        });
        if (!matchesDate) return false;
      }

      if (!q) return true;

      if (request.code.toLowerCase().includes(q)) return true;
      if (normalizeUserFacingText(request.vehiclePlate).toLowerCase().includes(q)) return true;
      if (normalizeUserFacingText(request.costCenter).toLowerCase().includes(q)) return true;
      if (normalizeUserFacingText(request.vehicleDescription).toLowerCase().includes(q)) return true;
      if (normalizeUserFacingText(request.status).toLowerCase().includes(q)) return true;
      return request.items.some(
        item => item.sku.toLowerCase().includes(q) || normalizeUserFacingText(item.itemName).toLowerCase().includes(q)
      );
    });
  }, [filterDateFrom, filterDateTo, filterPlate, filterSku, filterUser, query, requests, userOptions]);

  useEffect(() => {
    if (!selectedRequestId) {
      setSelectedRequestId(filteredRequests[0]?.id || null);
      return;
    }
    if (!filteredRequests.some(request => request.id === selectedRequestId)) {
      setSelectedRequestId(filteredRequests[0]?.id || null);
    }
  }, [filteredRequests, selectedRequestId]);

  const selectedRequest = useMemo(() => {
    if (!selectedRequestId) return null;
    return filteredRequests.find(request => request.id === selectedRequestId) || null;
  }, [filteredRequests, selectedRequestId]);

  const reverseSelectedRequest = () => {
    if (!selectedRequest) {
      showToast('Selecione uma solicitação para estornar.', 'info');
      return;
    }
    if (!canReverseRequests) {
      showToast('Somente administradores podem estornar solicitações atendidas.', 'info');
      return;
    }
    if (normalizeUserFacingText(selectedRequest.status) !== 'Atendida') {
      showToast('Somente solicitações atendidas podem ser estornadas.', 'info');
      return;
    }

    const confirmed = window.confirm(
      `Estornar a solicitação ${selectedRequest.code}? Isso devolve ao estoque as quantidades baixadas.`
    );
    if (!confirmed) return;

    const now = new Date().toISOString();
    const requestCode = selectedRequest.code;

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

    const requestItemBySku = new Map(selectedRequest.items.map(item => [item.sku, item]));
    const restockAmountBySku = new Map<string, number>();

    selectedRequest.items.forEach(requestItem => {
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
        request.id === selectedRequest.id
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

    showToast(`Solicitação ${selectedRequest.code} estornada. Estoque devolvido.`, 'success');
  };

  const relatedLogs = useMemo(() => {
    if (!selectedRequest) return [];
    const code = String(selectedRequest.code || '').trim();
    const restockCode = `ESTORNO ${code}`;
    return logs
      .filter(log => {
        const ref = String(log.referenceCode || '').trim();
        return ref === code || ref === restockCode;
      })
      .slice()
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [logs, selectedRequest]);

  const selectedDivergenceLogs = useMemo(
    () => getRequestDivergenceLogs(selectedRequest, logs),
    [logs, selectedRequest]
  );

  const formatTimestamp = (iso: string) => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatAuditEvent = (event: string) => {
    switch (event) {
      case 'request_created':
        return 'Solicitação criada';
      case 'request_updated':
        return 'Solicitação salva';
      case 'separation_updated':
        return 'Separação atualizada';
      case 'separation_fulfilled':
        return 'Separação concluída';
      case 'separation_reversed':
        return 'Estorno realizado';
      default:
        return normalizeUserFacingText(event);
    }
  };

  const statusClassName = (status: MaterialRequest['status']) => {
    const normalized = normalizeUserFacingText(status);
    switch (normalized) {
      case 'Atendida':
        return 'inline-flex items-center rounded-full bg-emerald-100 px-3 py-1 text-[11px] font-bold text-emerald-950';
      case 'Estornada':
        return 'inline-flex items-center rounded-full bg-sky-100 px-3 py-1 text-[11px] font-bold text-sky-950';
      case 'Separada':
        return 'inline-flex items-center rounded-full bg-surface-container-high px-3 py-1 text-[11px] font-bold text-primary';
      case 'Em separação':
        return 'inline-flex items-center rounded-full bg-secondary-container px-3 py-1 text-[11px] font-bold text-on-secondary-container';
      default:
        return 'inline-flex items-center rounded-full bg-surface-container-highest px-3 py-1 text-[11px] font-bold text-on-surface-variant';
    }
  };

  const sourceLabel = (source: InventoryLog['source']) => {
    switch (source) {
      case 'solicitacao':
        return 'Solicitação';
      case 'divergencia':
        return 'Divergência';
      case 'recebimento':
        return 'Recebimento';
      case 'ajuste':
        return 'Ajuste';
      default:
        return 'Log';
    }
  };

  const printSelectedRequest = () => {
    if (!selectedRequest) {
      showToast('Selecione uma solicitação para imprimir.', 'info');
      return;
    }

    const printWindow = window.open('', '_blank', 'width=1120,height=780');
    if (!printWindow) {
      showToast('O navegador bloqueou a janela de impressão. Libere pop-ups para imprimir o comprovante.', 'info');
      return;
    }

    const progress = getRequestProgress(selectedRequest);
    const auditRows = [...(selectedRequest.auditTrail || [])]
      .slice()
      .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
      .slice(-80);
    const now = new Date().toISOString();

    const itemRowsHtml = selectedRequest.items
      .map(
        item => `
          <tr>
            <td class="mono">${escapeHtml(item.sku)}</td>
            <td>
              <strong>${escapeHtml(normalizeUserFacingText(item.itemName))}</strong>
              <span>${escapeHtml(normalizeUserFacingText(item.category) || 'Sem categoria')}</span>
            </td>
            <td>${escapeHtml(normalizeLocationText(item.location))}</td>
            <td class="number">${escapeHtml(item.requestedQuantity)}</td>
            <td class="number strong">${escapeHtml(item.separatedQuantity)}</td>
          </tr>
        `
      )
      .join('');

    const auditRowsHtml = auditRows
      .map(
        entry => `
          <tr>
            <td>${escapeHtml(formatTimestamp(entry.at))}</td>
            <td>${escapeHtml(formatAuditEvent(entry.event))}</td>
            <td>
              ${escapeHtml(normalizeUserFacingText(entry.actor?.name) || 'Usuario')}
              ${entry.actor?.matricula ? `<span>${escapeHtml(entry.actor.matricula)}</span>` : ''}
            </td>
            <td>${escapeHtml(normalizeUserFacingText(entry.detail) || '-')}</td>
          </tr>
        `
      )
      .join('');

    const html = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>Comprovante ${escapeHtml(selectedRequest.code)}</title>
  <style>
    @page { size: A4; margin: 12mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: #13233a;
      background: #ffffff;
      font-family: "Segoe UI", Arial, sans-serif;
      font-size: 11px;
      line-height: 1.35;
    }
    .page { width: 100%; }
    .hero {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 18px;
      align-items: start;
      padding: 18px;
      border: 1px solid #d7e2f3;
      border-radius: 18px;
      background: linear-gradient(135deg, #f8fbff 0%, #edf5ff 100%);
    }
    .brand { text-transform: uppercase; letter-spacing: 0.14em; color: #315f9b; font-weight: 800; font-size: 10px; }
    h1 { margin: 6px 0 0; font-size: 24px; line-height: 1.05; letter-spacing: -0.04em; color: #10213b; }
    .subtitle { margin: 8px 0 0; color: #4a5d78; font-size: 12px; }
    .status-card {
      min-width: 168px;
      padding: 14px;
      border-radius: 14px;
      background: #173b70;
      color: #ffffff;
      text-align: right;
    }
    .status-card span { display: block; text-transform: uppercase; letter-spacing: 0.12em; font-size: 9px; opacity: 0.78; }
    .status-card strong { display: block; margin-top: 4px; font-size: 17px; }
    .grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
      margin-top: 12px;
    }
    .tile {
      min-height: 66px;
      padding: 12px;
      border: 1px solid #dbe5f2;
      border-radius: 14px;
      background: #ffffff;
      break-inside: avoid;
    }
    .tile span, .section-title span {
      display: block;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: #60728d;
      font-size: 8px;
      font-weight: 800;
    }
    .tile strong { display: block; margin-top: 5px; font-size: 12px; color: #10213b; }
    .wide { grid-column: span 2; }
    .note {
      margin-top: 12px;
      padding: 12px 14px;
      border-left: 4px solid #315f9b;
      border-radius: 12px;
      background: #f8fbff;
      color: #283d5b;
      break-inside: avoid;
    }
    .section { margin-top: 16px; break-inside: avoid; }
    .section-title {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 8px;
      color: #10213b;
      font-weight: 900;
      font-size: 14px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      overflow: hidden;
      border: 1px solid #dbe5f2;
      border-radius: 12px;
      break-inside: auto;
    }
    thead { display: table-header-group; }
    tr { break-inside: avoid; }
    th {
      padding: 9px 8px;
      background: #173b70;
      color: #ffffff;
      text-align: left;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-size: 8px;
    }
    td {
      padding: 9px 8px;
      border-top: 1px solid #e7eef8;
      vertical-align: top;
      color: #1c2e49;
    }
    td span { display: block; margin-top: 2px; color: #667991; font-size: 9px; }
    tbody tr:nth-child(even) td { background: #f8fbff; }
    .number { text-align: right; white-space: nowrap; }
    .mono { font-family: "Consolas", "Courier New", monospace; font-weight: 800; }
    .strong { font-weight: 900; }
    .positive { color: #176b47; font-weight: 900; }
    .negative { color: #9b2c2c; font-weight: 900; }
    .empty {
      padding: 16px;
      border: 1px dashed #cbd8e9;
      border-radius: 12px;
      color: #60728d;
      text-align: center;
      background: #fbfdff;
    }
    .signatures {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 18px;
      margin-top: 24px;
      break-inside: avoid;
    }
    .signature {
      padding-top: 28px;
      border-top: 1px solid #8190a6;
      color: #3a4d68;
      text-align: center;
      font-weight: 800;
    }
    footer {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      margin-top: 18px;
      padding-top: 10px;
      border-top: 1px solid #dbe5f2;
      color: #60728d;
      font-size: 9px;
    }
    @media print {
      .no-print { display: none !important; }
      body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    }
    @media screen {
      body { background: #eaf1fb; padding: 22px; }
      .page { max-width: 980px; margin: 0 auto; padding: 20px; border-radius: 22px; background: #ffffff; box-shadow: 0 18px 50px rgba(20, 43, 77, 0.18); }
      .no-print { display: flex; justify-content: flex-end; margin-bottom: 14px; }
      .no-print button { border: 0; border-radius: 999px; background: #173b70; color: #ffffff; padding: 10px 16px; font-weight: 800; cursor: pointer; }
    }
  </style>
</head>
<body>
  <main class="page">
    <div class="no-print">
      <button type="button" onclick="window.print()">Imprimir agora</button>
    </div>

    <section class="hero">
      <div>
        <div class="brand">Armazem 28</div>
        <h1>Comprovante de solicitação de peças</h1>
        <p class="subtitle">Documento operacional gerado a partir do Histórico para conferência, assinatura e arquivamento.</p>
      </div>
      <div class="status-card">
        <span>${escapeHtml(selectedRequest.code)}</span>
        <strong>${escapeHtml(normalizeUserFacingText(selectedRequest.status))}</strong>
      </div>
    </section>

    <section class="grid">
      <div class="tile"><span>Placa</span><strong>${escapeHtml(normalizeUserFacingText(selectedRequest.vehiclePlate) || 'Sem placa')}</strong></div>
      <div class="tile"><span>Centro de custo</span><strong>${escapeHtml(normalizeUserFacingText(selectedRequest.costCenter) || 'Sem centro de custo')}</strong></div>
      <div class="tile"><span>Criada</span><strong>${escapeHtml(formatTimestamp(selectedRequest.createdAt))}</strong></div>
      <div class="tile"><span>Atualizada</span><strong>${escapeHtml(formatTimestamp(selectedRequest.updatedAt))}</strong></div>
      <div class="tile"><span>Itens</span><strong>${escapeHtml(selectedRequest.items.length)} itens</strong></div>
      <div class="tile"><span>Progresso</span><strong>${escapeHtml(progress.separated)}/${escapeHtml(progress.requested)} separados (${escapeHtml(progress.percent)}%)</strong></div>
      <div class="tile"><span>Fechamento</span><strong>${escapeHtml(selectedRequest.reversedAt ? formatTimestamp(selectedRequest.reversedAt) : selectedRequest.fulfilledAt ? formatTimestamp(selectedRequest.fulfilledAt) : '-')}</strong></div>
      <div class="tile"><span>Impresso em</span><strong>${escapeHtml(formatTimestamp(now))}</strong></div>
      ${
        selectedRequest.vehicleDescription
          ? `<div class="tile wide"><span>Veiculo</span><strong>${escapeHtml(normalizeUserFacingText(selectedRequest.vehicleDescription))}</strong></div>`
          : ''
      }
      ${selectedRequest.notes ? `<div class="tile wide"><span>Observacoes</span><strong>${escapeHtml(normalizeUserFacingText(selectedRequest.notes))}</strong></div>` : ''}
    </section>

    <section class="section">
      <div class="section-title">Itens da solicitação <span>${escapeHtml(selectedRequest.items.length)} registros</span></div>
      <table>
        <thead>
          <tr>
            <th>SKU</th>
            <th>Descrição</th>
            <th>Localização</th>
            <th class="number">Solicitado</th>
            <th class="number">Separado</th>
          </tr>
        </thead>
        <tbody>${itemRowsHtml}</tbody>
      </table>
    </section>

    <section class="section">
      <div class="section-title">Auditoria da solicitação <span>${escapeHtml(auditRows.length)} registros</span></div>
      ${
        auditRowsHtml
          ? `<table>
              <thead><tr><th>Data/hora</th><th>Evento</th><th>Usuário</th><th>Detalhe</th></tr></thead>
              <tbody>${auditRowsHtml}</tbody>
            </table>`
          : '<div class="empty">Nenhum registro de auditoria encontrado.</div>'
      }
    </section>

    <section class="signatures">
      <div class="signature">Separação / Almoxarifado</div>
      <div class="signature">Solicitante / Recebedor</div>
    </section>

    <footer>
      <span>Documento gerado pelo Armazem 28.</span>
      <span>${escapeHtml(selectedRequest.code)} - ${escapeHtml(formatTimestamp(now))}</span>
    </footer>
  </main>
  <script>
    window.addEventListener('load', () => {
      window.setTimeout(() => window.print(), 250);
    });
  </script>
</body>
</html>`;

    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[380px_minmax(0,1fr)] gap-6">
      <aside className="space-y-4">
        <section className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <History size={18} className="text-primary" />
            <h2 className="font-headline font-bold text-xl tracking-tight text-on-surface">Histórico de solicitações</h2>
          </div>

          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-outline" size={18} />
            <input
              className="w-full h-12 rounded-lg bg-surface-container-low pl-11 pr-4 border border-outline-variant/20 text-sm focus:ring-2 focus:ring-primary/30"
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Buscar por código, placa, centro de custo, SKU ou status"
            />
          </div>

          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="flex flex-col gap-2 text-sm font-semibold text-on-surface">
              Placa
              <input
                className="h-11 rounded-lg bg-surface-container-low pl-4 pr-4 border border-outline-variant/20 text-sm focus:ring-2 focus:ring-primary/30"
                value={filterPlate}
                onChange={event => setFilterPlate(event.target.value)}
                placeholder="Ex.: QZQ0A04"
                inputMode="text"
              />
            </label>

            <label className="flex flex-col gap-2 text-sm font-semibold text-on-surface">
              SKU
              <div className="relative">
                <input
                  className="h-11 w-full rounded-lg bg-surface-container-low pl-4 pr-12 border border-outline-variant/20 text-sm focus:ring-2 focus:ring-primary/30"
                  value={filterSku}
                  onChange={event => setFilterSku(event.target.value)}
                  placeholder="Ex.: 06682"
                  inputMode="numeric"
                />
                <button
                  type="button"
                  onClick={startSkuScanner}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 h-9 w-9 rounded-lg bg-surface-container-highest text-on-surface flex items-center justify-center"
                  aria-label="Ler etiqueta para filtrar SKU"
                >
                  <Camera size={18} />
                </button>
                <input
                  ref={skuPhotoInputRef}
                  className="hidden"
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={readSkuFromPhoto}
                />
              </div>
            </label>

            <label className="flex flex-col gap-2 text-sm font-semibold text-on-surface">
              Usuário
              <select
                className="h-11 rounded-lg bg-surface-container-low px-3 border border-outline-variant/20 text-sm focus:ring-2 focus:ring-primary/30"
                value={filterUser}
                onChange={event => setFilterUser(event.target.value)}
              >
                <option value="">Todos</option>
                {userOptions.map(option => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-2 text-sm font-semibold text-on-surface">
                Data (de)
                <input
                  className="h-11 rounded-lg bg-surface-container-low pl-4 pr-4 border border-outline-variant/20 text-sm focus:ring-2 focus:ring-primary/30"
                  value={filterDateFrom}
                  onChange={event => setFilterDateFrom(event.target.value)}
                  type="date"
                />
              </label>
              <label className="flex flex-col gap-2 text-sm font-semibold text-on-surface">
                Data (até)
                <input
                  className="h-11 rounded-lg bg-surface-container-low pl-4 pr-4 border border-outline-variant/20 text-sm focus:ring-2 focus:ring-primary/30"
                  value={filterDateTo}
                  onChange={event => setFilterDateTo(event.target.value)}
                  type="date"
                />
              </label>
            </div>
          </div>

          {(isSkuScannerOpen || isSkuScannerBusy) && (
            <div className="mt-3 rounded-xl bg-inverse-surface text-on-primary border border-white/10 px-4 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-bold">
                    {isSkuScannerBusy ? <LoaderCircle className="animate-spin" size={16} /> : <Barcode size={16} />}
                    Leitor de SKU
                  </div>
                  <p className="text-[11px] text-inverse-on-surface mt-1">{skuScannerStatus}</p>
                </div>
                <button
                  type="button"
                  onClick={closeSkuScanner}
                  className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center shrink-0"
                  aria-label="Fechar leitor"
                >
                  <X size={18} />
                </button>
              </div>

              {isSkuScannerOpen && (
                <div className="mt-3 relative h-48 sm:h-56 rounded-xl overflow-hidden bg-black">
                  <video
                    ref={skuVideoRef}
                    className="w-full h-full object-cover"
                    playsInline
                    muted
                    autoPlay
                  />
                </div>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              setQuery('');
              setFilterPlate('');
              setFilterSku('');
              setFilterUser('');
              setFilterDateFrom('');
              setFilterDateTo('');
              closeSkuScanner();
            }}
            className="mt-3 h-11 w-full rounded-lg bg-surface-container-highest text-on-surface font-semibold"
          >
            Limpar filtros
          </button>

          <div className="mt-3 text-xs font-semibold text-on-surface-variant">Encontradas: {filteredRequests.length}</div>

          <div className="mt-4 space-y-3 max-h-[calc(100vh-18rem)] overflow-y-auto pr-1">
            {filteredRequests.length > 0 ? (
              filteredRequests.map(request => {
                const progress = getRequestProgress(request);
                const selected = request.id === selectedRequestId;

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
        {selectedRequest ? (
          <>
            <section className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 shadow-sm p-5 md:p-6">
              <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-primary font-label text-[11px] font-semibold uppercase tracking-wider">
                      Solicitação
                    </span>
                    <span className={statusClassName(selectedRequest.status)}>
                      {normalizeUserFacingText(selectedRequest.status)}
                    </span>
                  </div>
                  <h3 className="text-2xl font-extrabold text-on-surface font-headline tracking-tight mt-2">
                    {selectedRequest.code}
                  </h3>
                  <p className="text-sm text-on-surface-variant mt-2">
                    {normalizeUserFacingText(selectedRequest.vehiclePlate) || 'Sem placa'} •{' '}
                    {normalizeUserFacingText(selectedRequest.costCenter) || 'Sem centro de custo'}
                  </p>
                  {selectedRequest.vehicleDescription ? (
                    <p className="text-sm text-on-surface mt-3 bg-surface-container-low rounded-lg px-4 py-3">
                      {normalizeUserFacingText(selectedRequest.vehicleDescription)}
                    </p>
                  ) : null}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 min-w-0">
                  <SummaryCard label="Itens" value={String(selectedRequest.items.length)} />
                  <SummaryCard label="Criada" value={formatTimestamp(selectedRequest.createdAt)} />
                  <SummaryCard label="Atualizada" value={formatTimestamp(selectedRequest.updatedAt)} />
                  <SummaryCard
                    label="Fechamento"
                    value={
                      selectedRequest.reversedAt
                        ? formatTimestamp(selectedRequest.reversedAt)
                        : selectedRequest.fulfilledAt
                          ? formatTimestamp(selectedRequest.fulfilledAt)
                          : '--'
                    }
                  />
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={printSelectedRequest}
                  className="h-11 w-full px-4 rounded-lg bg-primary text-on-primary font-bold flex items-center justify-center gap-2 shadow-sm"
                >
                  <Printer size={18} />
                  Imprimir comprovante
                </button>

                {normalizeUserFacingText(selectedRequest.status) === 'Atendida' && canReverseRequests && (
                  <button
                    type="button"
                    onClick={reverseSelectedRequest}
                    className="h-11 w-full px-4 rounded-lg bg-sky-100 text-sky-950 font-bold flex items-center justify-center gap-2"
                  >
                    <RotateCcw size={18} />
                    Estornar solicitação
                  </button>
                )}
              </div>
            </section>

            {selectedDivergenceLogs.length > 0 ? (
              <section className="bg-error-container/15 rounded-xl border border-error/25 shadow-sm p-5">
                <h3 className="font-headline font-bold text-xl text-on-surface">Divergencias registradas</h3>
                <div className="mt-3 space-y-2">
                  {selectedDivergenceLogs.map(log => (
                    <div key={log.id} className="rounded-xl border border-error/20 bg-surface-container-lowest p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <button
                            type="button"
                            onClick={() => onSelectSku(log.sku)}
                            className="text-left font-semibold text-on-surface hover:text-primary transition-colors"
                          >
                            {normalizeUserFacingText(log.itemName)}
                          </button>
                          <p className="text-xs text-on-surface-variant mt-1">
                            {formatTimestamp(log.date)} - SKU {log.sku} - {normalizeLocationText(log.location)}
                          </p>
                          {log.note ? (
                            <p className="text-[11px] font-semibold text-on-surface-variant mt-2">
                              Motivo: {normalizeUserFacingText(log.note)}
                            </p>
                          ) : null}
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-xs font-bold uppercase text-outline">Diferenca</p>
                          <p className="text-sm font-extrabold text-error">{formatDivergenceDelta(log.delta)}</p>
                          <p className="text-[11px] text-on-surface-variant font-semibold">
                            {log.expectedQuantityAfter ?? '--'} / {log.reportedQuantityAfter ?? log.quantityAfter}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            <section className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 shadow-sm p-5">
              <h3 className="font-headline font-bold text-xl text-on-surface">Itens</h3>
              <div className="mt-3 space-y-2">
                {selectedRequest.items.map(item => (
                  <div
                    key={item.id}
                    className="rounded-xl border border-outline-variant/15 bg-surface-container-low p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <button
                          type="button"
                          onClick={() => onSelectSku(item.sku)}
                          className="text-left font-semibold text-on-surface hover:text-primary transition-colors"
                        >
                          {normalizeUserFacingText(item.itemName)}
                        </button>
                        <p className="text-xs text-on-surface-variant mt-1">
                          SKU {item.sku} • {normalizeLocationText(item.location)} • {normalizeUserFacingText(item.category)}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs font-bold uppercase text-outline">Separado</p>
                        <p className="text-sm font-bold text-on-surface">
                          {item.separatedQuantity}/{item.requestedQuantity}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {(selectedRequest.auditTrail?.length || 0) > 0 && (
              <section className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 shadow-sm p-5">
                <h3 className="font-headline font-bold text-xl text-on-surface">Auditoria</h3>
                <div className="mt-3 space-y-2">
                  {[...(selectedRequest.auditTrail || [])]
                    .slice()
                    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
                    .slice(0, 50)
                    .map(entry => (
                      <div key={entry.id} className="rounded-lg bg-surface-container-lowest px-4 py-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-semibold text-on-surface text-sm">
                              {formatAuditEvent(entry.event)}
                            </p>
                            <p className="text-xs text-on-surface-variant mt-1 truncate">
                              {normalizeUserFacingText(entry.actor?.name) || 'Usuário'}
                              {entry.actor?.matricula ? ` • ${entry.actor.matricula}` : ''}
                              {entry.detail ? ` • ${normalizeUserFacingText(entry.detail)}` : ''}
                            </p>
                          </div>
                          <span className="text-xs font-bold text-on-surface-variant shrink-0">
                            {formatTimestamp(entry.at)}
                          </span>
                        </div>
                      </div>
                    ))}
                </div>
              </section>
            )}

            <section className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 shadow-sm p-5">
              <h3 className="font-headline font-bold text-xl text-on-surface">Logs da solicitação</h3>
              <div className="mt-2 text-xs text-on-surface-variant font-semibold">
                {relatedLogs.length} registros encontrados
              </div>
              {relatedLogs.length > 0 ? (
                <div className="mt-3 space-y-2">
                  {relatedLogs.slice(0, 120).map(log => (
                    <div key={log.id} className="rounded-xl border border-outline-variant/15 bg-surface-container-low p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <button
                            type="button"
                            onClick={() => onSelectSku(log.sku)}
                            className="text-left font-semibold text-on-surface hover:text-primary transition-colors"
                          >
                            {normalizeUserFacingText(log.itemName)}
                          </button>
                          <p className="text-xs text-on-surface-variant mt-1 truncate">
                            {formatTimestamp(log.date)} • {sourceLabel(log.source)} • SKU {log.sku} •{' '}
                            {normalizeLocationText(log.location)}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-xs font-bold uppercase text-outline">Delta</p>
                          <p className={`text-sm font-extrabold ${log.delta < 0 ? 'text-error' : 'text-primary'}`}>
                            {log.delta > 0 ? '+' : ''}
                            {log.delta}
                          </p>
                          <p className="text-[11px] text-on-surface-variant font-semibold">
                            {log.previousQuantity} → {log.quantityAfter}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-3 rounded-xl bg-surface-container-low p-8 text-center text-on-surface-variant">
                  Nenhum log de estoque encontrado para esta solicitação.
                </div>
              )}
            </section>
          </>
        ) : (
          <section className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 shadow-sm p-8 text-center text-on-surface-variant">
            Selecione uma solicitação para ver o histórico completo.
          </section>
        )}
      </section>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface-container-low p-4 border border-outline-variant/15">
      <p className="text-[10px] font-bold uppercase tracking-widest text-outline">{label}</p>
      <p className="mt-1 text-sm font-extrabold text-on-surface leading-tight">{value}</p>
    </div>
  );
}

function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, char => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return char;
    }
  });
}
