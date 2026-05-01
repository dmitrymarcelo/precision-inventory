import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser';
import {
  ArrowRight,
  Barcode,
  Camera,
  CheckCircle2,
  ClipboardList,
  Eye,
  LoaderCircle,
  Lock,
  Maximize2,
  Minimize2,
  MoreVertical,
  PackagePlus,
  PanelTop,
  Pencil,
  Plus,
  PackageCheck,
  Search,
  Send,
  Trash2,
  Truck,
  X
} from 'lucide-react';
import {
  decodeFileCode,
  decodeVideoSnapshotCode,
  getScannerReader,
  isExpectedScannerError,
  playConfirmTone,
  prepareScannerVideo,
  resolveScannedCode,
  startPreparedScanner,
  type DetectedScan
} from '../barcodeUtils';
import { InventoryItem, MaterialRequest, MaterialRequestAuditActor, MaterialRequestAuditEntry, VehicleRecord } from '../types';
import {
  createEmptyRequest,
  createRequestItem,
  getRequestProgress,
  materialRequestNeedsStockAttention,
  recalculateRequestStatus,
  updateRequestItemQuantity,
  upsertRequestState
} from '../requestUtils';
import { ProductImage } from '../productVisuals';
import { getVehicleTypeFromModel, listVehicleCatalogByType, normalizeOperationalVehicleType } from '../vehicleCatalog';
import { findVehicleByPlate, normalizePlate } from '../vehicleBase';
import { preventiveKitCatalog } from '../preventiveKitCatalog';
import { normalizeLocationText, normalizeUserFacingText } from '../textUtils';

interface RequestManagerProps {
  items: InventoryItem[];
  requests: MaterialRequest[];
  vehicles: VehicleRecord[];
  setRequests: React.Dispatch<React.SetStateAction<MaterialRequest[]>>;
  externalRequestId?: string | null;
  canCreateRequests: boolean;
  canEditExistingRequests: boolean;
  canDeleteRequests: boolean;
  canOpenSeparation: boolean;
  auditActor: MaterialRequestAuditActor;
  showToast: (message: string, type?: 'success' | 'info') => void;
  onOpenSeparation: (requestId: string) => void;
  onSelectSku: (sku: string) => void;
  onOpenPanel: () => void;
  onOpenVehicleParts: (type?: string) => void;
}

export default function RequestManager({
  items,
  requests,
  vehicles,
  setRequests,
  externalRequestId = null,
  canCreateRequests,
  canEditExistingRequests,
  canDeleteRequests,
  canOpenSeparation,
  auditActor,
  showToast,
  onOpenSeparation,
  onSelectSku,
  onOpenPanel,
  onOpenVehicleParts
}: RequestManagerProps) {
  const getEffectiveVehicleType = (item: InventoryItem) =>
    normalizeOperationalVehicleType(item.vehicleType || getVehicleTypeFromModel(item.vehicleModel || ''));
  const getEffectiveVehicleModel = (item: InventoryItem) => normalizeUserFacingText(item.vehicleModel || '');

  const [draft, setDraft] = useState<MaterialRequest>(createEmptyRequest());
  const [editingRequestId, setEditingRequestId] = useState<string | null>(null);
  const [itemQuery, setItemQuery] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isTypeModelPickerOpen, setIsTypeModelPickerOpen] = useState(false);
  const [pickerType, setPickerType] = useState('');
  const [pickerModel, setPickerModel] = useState('');
  const [pickerItemQuery, setPickerItemQuery] = useState('');
  const [pickerSelectedSkus, setPickerSelectedSkus] = useState<string[]>([]);
  const [pickerKitId, setPickerKitId] = useState('');
  const [openRequestMenuId, setOpenRequestMenuId] = useState<string | null>(null);
  const [isPlateSuggestionOpen, setIsPlateSuggestionOpen] = useState(false);
  const ignoredExternalIdRef = useRef<string | null>(null);
  const [isSkuScannerOpen, setIsSkuScannerOpen] = useState(false);
  const [isSkuScannerBusy, setIsSkuScannerBusy] = useState(false);
  const [skuScannerStatus, setSkuScannerStatus] = useState('Leitor pronto para QR Code.');
  const [isSkuScannerFullscreen, setIsSkuScannerFullscreen] = useState(false);
  const skuScannerContainerRef = useRef<HTMLDivElement>(null);
  const skuVideoRef = useRef<HTMLVideoElement>(null);
  const skuPhotoInputRef = useRef<HTMLInputElement>(null);
  const skuScannerControlsRef = useRef<IScannerControls | null>(null);
  const skuScannerReaderRef = useRef<BrowserMultiFormatReader | null>(null);
  const skuScanLockedRef = useRef(false);
  const skuAssistBusyRef = useRef(false);
  const skuAudioContextRef = useRef<AudioContext | null>(null);
  const itemsRef = useRef(items);
  const aliasRef = useRef<Record<string, string>>({});

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const matchedVehicle = useMemo(
    () => findVehicleByPlate(vehicles, draft.vehiclePlate),
    [vehicles, draft.vehiclePlate]
  );

  const matchedVehicleModel = useMemo(() => {
    if (!matchedVehicle) return '';
    const normalizedTarget = 'modelo';
    const modelFromDetails =
      Object.entries(matchedVehicle.details || {}).find(([label]) => {
        const normalized = normalizeUserFacingText(label).trim().toLowerCase();
        return normalized === normalizedTarget;
      })?.[1] || '';
    return modelFromDetails || matchedVehicle.description || '';
  }, [matchedVehicle]);

  const normalizedVehicles = useMemo(
    () =>
      vehicles.map(vehicle => ({
        vehicle,
        plate: normalizePlate(vehicle.plate)
      })),
    [vehicles]
  );

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
    if (document.fullscreenElement && document.fullscreenElement === skuScannerContainerRef.current) {
      void document.exitFullscreen?.().catch(() => undefined);
    }
    stopSkuScannerSession();
    setIsSkuScannerOpen(false);
    setSkuScannerStatus('Leitor pronto para QR Code.');
  };

  const toggleSkuScannerFullscreen = async () => {
    const container = skuScannerContainerRef.current;
    if (!container) return;

    if (document.fullscreenElement) {
      await document.exitFullscreen?.().catch(() => undefined);
      return;
    }

    const request = container.requestFullscreen?.bind(container);
    if (!request) {
      showToast('Seu navegador não suporta tela cheia aqui.', 'info');
      return;
    }

    await request().catch(() => {
      showToast('Não consegui abrir a tela cheia.', 'info');
    });
  };

  const applyDetectedSku = (detected: DetectedScan, shouldCloseScanner: boolean) => {
    if (!canMutateDraft) {
      showToast('Esta solicitação está bloqueada para edição.', 'info');
      if (shouldCloseScanner) closeSkuScanner();
      return;
    }

    if (detected.matchedSku) {
      setItemQuery(detected.matchedSku);

      const item = itemsRef.current.find(entry => entry.sku === detected.matchedSku) || null;
      if (!item) {
        setSkuScannerStatus(`Li ${detected.matchedSku}, mas ele não está na base carregada.`);
        showToast(`SKU ${detected.matchedSku} não encontrado na base.`, 'info');
        if (shouldCloseScanner) closeSkuScanner();
        return;
      }

      detected.candidates.forEach(candidate => {
        aliasRef.current[candidate] = detected.matchedSku as string;
      });

      addItemToDraft(item);
      setSkuScannerStatus(`Código ${detected.matchedSku} confirmado.`);
      void playConfirmTone(skuAudioContextRef);
      if ('vibrate' in navigator) {
        navigator.vibrate?.(60);
      }
      if (shouldCloseScanner) {
        closeSkuScanner();
      }
      return;
    }

    if (detected.detectedCode) {
      setSkuScannerStatus(`Li ${detected.detectedCode}, mas esse código não está na base carregada.`);
      showToast(`Código ${detected.detectedCode} não encontrado na base.`, 'info');
      return;
    }

    setSkuScannerStatus('Não consegui ler o código. Tente aproximar um pouco mais.');
    showToast('Não consegui ler o código da etiqueta.', 'info');
  };

  const startSkuScanner = async () => {
    if (isDraftReadOnly) return;
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
      const detected = await decodeFileCode(file, itemsRef.current, aliasRef.current, setSkuScannerStatus);
      applyDetectedSku(detected, false);
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
              const detected = resolveScannedCode(result.getText(), itemsRef.current, aliasRef.current);
              skuScanLockedRef.current = true;
              applyDetectedSku(detected, true);
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
              itemsRef.current,
              aliasRef.current,
              value => {
                if (!cancelled && !skuScanLockedRef.current) {
                  setSkuScannerStatus(value);
                }
              }
            );

            if (!cancelled && detected?.matchedSku && !skuScanLockedRef.current) {
              skuScanLockedRef.current = true;
              applyDetectedSku(detected, true);
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

  useEffect(() => {
    const onChange = () => {
      setIsSkuScannerFullscreen(document.fullscreenElement === skuScannerContainerRef.current);
    };
    document.addEventListener('fullscreenchange', onChange);
    onChange();
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  useEffect(() => () => {
    stopSkuScannerSession();
    skuAudioContextRef.current?.close().catch(() => undefined);
    skuAudioContextRef.current = null;
  }, []);

  const plateSuggestions = useMemo(() => {
    if (!isPlateSuggestionOpen) return [];
    const query = normalizePlate(draft.vehiclePlate);
    if (query.length < 1) return [];
    if (!normalizedVehicles.length) return [];

    const matches = normalizedVehicles
      .filter(entry => entry.plate.includes(query))
      .sort((a, b) => {
        const aStarts = a.plate.startsWith(query);
        const bStarts = b.plate.startsWith(query);
        if (aStarts !== bStarts) return aStarts ? -1 : 1;
        return a.plate.localeCompare(b.plate, 'pt-BR');
      })
      .slice(0, 8)
      .map(entry => entry.vehicle);

    return matches;
  }, [draft.vehiclePlate, isPlateSuggestionOpen, normalizedVehicles]);

  const stockBySku = useMemo(() => new Map(items.map(item => [item.sku, item.quantity])), [items]);
  const vehicleTypeCards = useMemo(() => {
    const catalogGroups = listVehicleCatalogByType();
    const itemTypes = Array.from(new Set(items.map(item => getEffectiveVehicleType(item)).filter(Boolean)));
    const mergedTypes = Array.from(new Set([...catalogGroups.map(group => group.type), ...itemTypes]))
      .filter(Boolean)
      .sort((first, second) => first.localeCompare(second, 'pt-BR'));

    return mergedTypes
      .map(type => {
        const typeItems = items.filter(item => getEffectiveVehicleType(item) === type);
        const modelCount = new Set(typeItems.map(item => normalizeUserFacingText(item.vehicleModel || '')).filter(Boolean))
          .size;

        return {
          type,
          itemCount: typeItems.length,
          modelCount
        };
      })
      .filter(card => Boolean(card.type));
  }, [items]);

  const pickerTypeOptions = useMemo(
    () =>
      vehicleTypeCards
        .filter(card => card.itemCount > 0)
        .map(card => card.type)
        .sort((first, second) => first.localeCompare(second, 'pt-BR')),
    [vehicleTypeCards]
  );

  const pickerModelOptions = useMemo(() => {
    const EMPTY_MODEL_KEY = '__sem_modelo__';

    const scopedItems = pickerType
      ? items.filter(item => getEffectiveVehicleType(item) === pickerType)
      : items.filter(item => Boolean(getEffectiveVehicleType(item)));

    const modelCounts = new Map<string, number>();
    let withoutModelCount = 0;

    scopedItems.forEach(item => {
      const model = getEffectiveVehicleModel(item);
      if (!model) {
        withoutModelCount += 1;
        return;
      }
      modelCounts.set(model, (modelCounts.get(model) ?? 0) + 1);
    });

    const models = Array.from(modelCounts.entries())
      .sort(
        (first, second) => second[1] - first[1] || first[0].localeCompare(second[0], 'pt-BR')
      )
      .map(([model, count]) => ({ key: model, label: model, itemCount: count }));

    if (withoutModelCount > 0) {
      models.push({ key: EMPTY_MODEL_KEY, label: 'Sem modelo vinculado', itemCount: withoutModelCount });
    }

    return models;
  }, [items, pickerType]);

  const pickerVisibleItems = useMemo(() => {
    const EMPTY_MODEL_KEY = '__sem_modelo__';

    const query = pickerItemQuery.trim().toLowerCase();

    if (!pickerType && !pickerModel && !query) return [];

    let scopedItems = items.slice();

    if (pickerType) {
      scopedItems = scopedItems.filter(item => getEffectiveVehicleType(item) === pickerType);
    } else {
      scopedItems = scopedItems.filter(item => Boolean(getEffectiveVehicleType(item)));
    }

    if (pickerModel) {
      scopedItems = scopedItems.filter(item => {
        const model = getEffectiveVehicleModel(item);
        if (pickerModel === EMPTY_MODEL_KEY) return !model;
        return model === pickerModel;
      });
    }

    const filtered = query
      ? scopedItems.filter(item => {
          const haystack = [
            item.sku,
            normalizeUserFacingText(item.name),
            normalizeLocationText(item.location),
            normalizeUserFacingText(item.category)
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          return haystack.includes(query);
        })
      : scopedItems;

    return filtered
      .slice()
      .sort((a, b) => normalizeUserFacingText(a.name).localeCompare(normalizeUserFacingText(b.name), 'pt-BR'))
      .slice(0, 80);
  }, [items, pickerItemQuery, pickerModel, pickerType]);

  const filteredItems = useMemo(() => {
    const query = itemQuery.trim().toLowerCase();
    if (!query) return [];

    return items
      .filter(item =>
        item.sku.toLowerCase().includes(query) ||
        normalizeUserFacingText(item.name).toLowerCase().includes(query) ||
        normalizeUserFacingText(item.vehicleModel).toLowerCase().includes(query) ||
        getEffectiveVehicleType(item).toLowerCase().includes(query) ||
        normalizeLocationText(item.location).toLowerCase().includes(query) ||
        item.category.toLowerCase().includes(query)
      )
      .slice(0, 8);
  }, [items, itemQuery]);

  const recentRequests = useMemo(
    () =>
      [...requests]
        .filter(request => !request.deletedAt)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [requests]
  );

  const draftProgress = getRequestProgress(draft);
  const persistedEditingRequest = editingRequestId
    ? requests.find(request => request.id === editingRequestId) || null
    : null;
  const isDraftReadOnly = persistedEditingRequest
    ? isRequestLocked(persistedEditingRequest.status) || !canEditExistingRequests
    : false;
  const canMutateDraft = persistedEditingRequest
    ? canEditExistingRequests && canEditRequest(persistedEditingRequest.status)
    : canCreateRequests;
  const draftSkuSet = useMemo(() => new Set(draft.items.map(item => item.sku)), [draft.items]);
  const pickerSelectedSet = useMemo(() => new Set(pickerSelectedSkus), [pickerSelectedSkus]);

  const appendAuditEntry = (request: MaterialRequest, entry: Omit<MaterialRequestAuditEntry, 'id'>) => {
    const trail = Array.isArray(request.auditTrail) ? request.auditTrail : [];
    const last = trail.length > 0 ? trail[trail.length - 1] : null;
    const lastAt = last ? new Date(last.at).getTime() : 0;
    const nextAt = new Date(entry.at).getTime();
    const isDuplicate =
      last &&
      last.event === entry.event &&
      (last.actor?.matricula || '') === (entry.actor?.matricula || '') &&
      (last.detail || '') === (entry.detail || '') &&
      Math.abs(nextAt - lastAt) <= 60_000;

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

  const formatAuditEvent = (event: MaterialRequestAuditEntry['event']) => {
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
        return 'Atualização';
    }
  };

  const formatAuditTimestamp = (iso: string) => {
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

  const normalizeSkuForKit = (value: string) => {
    const text = String(value || '').trim();
    if (/^\d+$/.test(text) && text.length < 5) {
      return text.padStart(5, '0');
    }
    return text;
  };

  const stockItemByNormalizedSku = useMemo(
    () => new Map(items.map(item => [normalizeSkuForKit(item.sku), item])),
    [items]
  );

  const pickerKitCards = useMemo(() => {
    return preventiveKitCatalog.map(kit => {
      const supported = kit.items.map(component => {
        const item = stockItemByNormalizedSku.get(normalizeSkuForKit(component.sku)) || null;
        const availableQuantity = item?.quantity ?? 0;
        return item ? Math.floor(availableQuantity / component.requiredQuantity) : 0;
      });
      const availableKits = supported.length > 0 ? Math.min(...supported) : 0;
      return {
        id: kit.id,
        name: kit.name,
        availableKits
      };
    });
  }, [stockItemByNormalizedSku]);

  type PickerKitEntry = {
    sku: string;
    description: string;
    requiredQuantity: number;
    item: InventoryItem | null;
    availableQuantity: number;
  };

  const pickerVisibleKitEntries = useMemo((): PickerKitEntry[] => {
    if (!pickerKitId) return [];
    const kit = preventiveKitCatalog.find(entry => entry.id === pickerKitId) || null;
    if (!kit) return [];
    const query = pickerItemQuery.trim().toLowerCase();

    const entries = kit.items.map(component => {
      const item = stockItemByNormalizedSku.get(normalizeSkuForKit(component.sku)) || null;
      const availableQuantity = item?.quantity ?? 0;
      return {
        sku: component.sku,
        description: component.description,
        requiredQuantity: component.requiredQuantity,
        item,
        availableQuantity
      };
    });

    const filtered = query
      ? entries.filter(entry => {
          const haystack = [
            entry.sku,
            normalizeUserFacingText(entry.description),
            normalizeUserFacingText(entry.item?.name),
            normalizeLocationText(entry.item?.location),
            normalizeUserFacingText(entry.item?.category)
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          return haystack.includes(query);
        })
      : entries;

    return filtered.slice(0, 80);
  }, [pickerItemQuery, pickerKitId, stockItemByNormalizedSku]);

  const openTypeModelPicker = (presetType?: string) => {
    if (!canMutateDraft) {
      showToast(
        persistedEditingRequest
          ? 'Esta solicitação está bloqueada para edição.'
          : 'Sem permissão para criar solicitação.',
        'info'
      );
      return;
    }

    setIsTypeModelPickerOpen(true);
    setPickerKitId('');
    setPickerType(presetType ? normalizeOperationalVehicleType(presetType) : '');
    setPickerModel('');
    setPickerItemQuery('');
    setPickerSelectedSkus([]);
  };

  const closeTypeModelPicker = () => {
    setIsTypeModelPickerOpen(false);
    setPickerKitId('');
    setPickerType('');
    setPickerModel('');
    setPickerItemQuery('');
    setPickerSelectedSkus([]);
  };

  const togglePickerSku = (sku: string) => {
    setPickerSelectedSkus(current =>
      current.includes(sku) ? current.filter(value => value !== sku) : [...current, sku]
    );
  };

  const addSelectedPickerItems = () => {
    if (!canMutateDraft) {
      showToast('Esta solicitação está bloqueada para edição.', 'info');
      return;
    }

    const selectedItems = pickerSelectedSkus
      .map(sku => items.find(item => item.sku === sku) || null)
      .filter((value): value is InventoryItem => Boolean(value));

    if (!selectedItems.length) {
      showToast('Selecione pelo menos um item para adicionar.', 'info');
      return;
    }

    let added = 0;
    let withoutStock = 0;
    let alreadyInRequest = 0;

    setDraft(current => {
      const currentSkuSet = new Set(current.items.map(entry => entry.sku));
      const nextItems = [...current.items];

      selectedItems.forEach(item => {
        if (currentSkuSet.has(item.sku)) {
          alreadyInRequest += 1;
          return;
        }
        if (item.quantity <= 0) {
          withoutStock += 1;
          return;
        }
        nextItems.push(createRequestItem(item));
        currentSkuSet.add(item.sku);
        added += 1;
      });

      return {
        ...current,
        items: nextItems,
        updatedAt: new Date().toISOString()
      };
    });

    const parts: string[] = [];
    if (added > 0) parts.push(`${added} adicionados`);
    if (alreadyInRequest > 0) parts.push(`${alreadyInRequest} já estavam`);
    if (withoutStock > 0) parts.push(`${withoutStock} sem saldo`);
    showToast(parts.length ? parts.join(' • ') : 'Nenhum item adicionado.', added > 0 ? 'success' : 'info');
    closeTypeModelPicker();
  };

  const addKitToDraft = (kitId: string) => {
    if (!canMutateDraft) {
      showToast(
        persistedEditingRequest
          ? 'Esta solicitação está bloqueada para edição.'
          : 'Sem permissão para criar solicitação.',
        'info'
      );
      return;
    }

    const kit = preventiveKitCatalog.find(entry => entry.id === kitId) || null;
    if (!kit) {
      showToast('Kit não encontrado.', 'info');
      return;
    }

    let added = 0;
    let alreadyInRequest = 0;
    let missing = 0;
    let insufficientStock = 0;

    setDraft(current => {
      const currentSkuSet = new Set(current.items.map(entry => entry.sku));
      const nextItems = [...current.items];

      kit.items.forEach(component => {
        const item = stockItemByNormalizedSku.get(normalizeSkuForKit(component.sku)) || null;
        if (!item) {
          missing += 1;
          return;
        }

        if (currentSkuSet.has(item.sku)) {
          alreadyInRequest += 1;
          return;
        }

        if (item.quantity < component.requiredQuantity) {
          insufficientStock += 1;
          return;
        }

        nextItems.push({
          ...createRequestItem(item),
          requestedQuantity: component.requiredQuantity,
          separatedQuantity: 0
        });
        currentSkuSet.add(item.sku);
        added += 1;
      });

      return {
        ...current,
        items: nextItems,
        updatedAt: new Date().toISOString()
      };
    });

    const parts: string[] = [];
    if (added > 0) parts.push(`${added} itens do kit adicionados`);
    if (alreadyInRequest > 0) parts.push(`${alreadyInRequest} já estavam`);
    if (insufficientStock > 0) parts.push(`${insufficientStock} sem saldo`);
    if (missing > 0) parts.push(`${missing} não encontrados`);
    showToast(parts.length ? parts.join(' • ') : 'Nenhum item adicionado.', added > 0 ? 'success' : 'info');
  };

  const clearDraftForNextRequest = (requestIdToIgnore = externalRequestId) => {
    ignoredExternalIdRef.current = requestIdToIgnore;
    setDraft(createEmptyRequest());
    setEditingRequestId(null);
    setItemQuery('');
    setIsPlateSuggestionOpen(false);
    setOpenRequestMenuId(null);
  };

  const startNewRequest = () => {
    if (!canCreateRequests) {
      showToast('Sem permissão para criar solicitações.', 'info');
      return;
    }
    clearDraftForNextRequest();
  };

  const loadRequest = (request: MaterialRequest) => {
    setEditingRequestId(request.id);
    setDraft({
      ...request,
      items: request.items.map(item => ({ ...item }))
    });
    setItemQuery('');
  };

  useEffect(() => {
    ignoredExternalIdRef.current = null;
  }, [externalRequestId]);

  useEffect(() => {
    if (!externalRequestId) return;
    if (ignoredExternalIdRef.current === externalRequestId) return;
    if (editingRequestId === externalRequestId) return;

    const request = requests.find(entry => entry.id === externalRequestId) || null;
    if (!request) return;

    setEditingRequestId(request.id);
    setDraft({
      ...request,
      items: request.items.map(item => ({ ...item }))
    });
    setItemQuery('');
  }, [externalRequestId, editingRequestId, requests]);

  const saveDraft = async (openSeparationAfterSave = false) => {
    if (!canMutateDraft) {
      showToast(
        persistedEditingRequest
          ? 'Esta solicitação está bloqueada para edição.'
          : 'Sem permissão para criar solicitação.',
        'info'
      );
      return null;
    }

    if (!draft.vehiclePlate.trim()) {
      showToast('Informe a placa do veículo para abrir a solicitação.', 'info');
      return null;
    }

    const costCenter = matchedVehicle?.costCenter || draft.costCenter.trim();
    if (!costCenter) {
      showToast('Informe ou importe o centro de custo vinculado à placa.', 'info');
      return null;
    }

    if (!draft.items.length) {
      showToast('Adicione pelo menos um item antes de salvar.', 'info');
      return null;
    }

    const now = new Date().toISOString();
    const vehicleModel = (matchedVehicleModel || draft.vehicleDescription || '').trim();
    const auditEvent: MaterialRequestAuditEntry['event'] = draft.id ? 'request_updated' : 'request_created';
    const requestBase: MaterialRequest = appendAuditEntry(
      {
        ...draft,
        vehiclePlate: normalizePlate(draft.vehiclePlate),
        costCenter,
        vehicleDescription: vehicleModel,
        vehicleDetails: matchedVehicle?.details || draft.vehicleDetails || {},
        requester: normalizePlate(draft.vehiclePlate),
        destination: costCenter
      },
      {
        at: now,
        event: auditEvent,
        actor: auditActor,
        detail: `${draft.items.length} itens`
      }
    );

    const nextDraft = upsertRequestState(
      requestBase,
      requests.filter(request => request.id !== draft.id)
    );
    nextDraft.status = recalculateRequestStatus(nextDraft);

    setIsSaving(true);

    try {
      setRequests(previous => {
        const others = previous.filter(request => request.id !== nextDraft.id);
        return [nextDraft, ...others].sort(
          (first, second) => new Date(second.updatedAt).getTime() - new Date(first.updatedAt).getTime()
        );
      });

      clearDraftForNextRequest(nextDraft.id);
      showToast(`Solicitação ${nextDraft.code} salva com sucesso.`, 'success');

      if (openSeparationAfterSave && canOpenSeparation) {
        onOpenSeparation(nextDraft.id);
      }

      return nextDraft;
    } finally {
      setIsSaving(false);
    }
  };

  const addItemToDraft = (item: InventoryItem) => {
    if (!canMutateDraft) {
      showToast('Esta solicitação está bloqueada para edição.', 'info');
      return;
    }

    if (item.quantity <= 0) {
      showToast(`O item ${item.sku} está sem saldo e não pode entrar na solicitação.`, 'info');
      return;
    }

    const alreadyAdded = draft.items.some(requestItem => requestItem.sku === item.sku);
    if (alreadyAdded) {
      showToast(`O item ${item.sku} já está nesta solicitação.`, 'info');
      return;
    }

    setDraft(current => ({
      ...current,
      items: [...current.items, createRequestItem(item)],
      updatedAt: new Date().toISOString()
    }));
    setItemQuery('');
  };

  const removeItemFromDraft = (itemId: string) => {
    if (!canMutateDraft) {
      showToast('Esta solicitação está bloqueada para edição.', 'info');
      return;
    }

    setDraft(current => ({
      ...current,
      items: current.items.filter(item => item.id !== itemId),
      updatedAt: new Date().toISOString()
    }));
  };

  const deleteRequest = (request: MaterialRequest) => {
    if (!canDeleteRequests) {
      showToast('Somente administradores podem excluir solicitações.', 'info');
      return;
    }
    if (!canEditRequest(request.status)) {
      showToast('Pedidos já entregues ficam bloqueados e seguem apenas para consulta.', 'info');
      return;
    }

    const confirmed = window.confirm(`Excluir a solicitação ${request.code}? Essa ação remove o pedido da fila atual.`);
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
    if (editingRequestId === request.id) {
      startNewRequest();
    }
    showToast(`Solicitação ${request.code} excluída.`, 'success');
  };

  const duplicateRequestAsNew = (request: MaterialRequest) => {
    if (!canCreateRequests) {
      showToast('Sem permissão para criar solicitações.', 'info');
      return;
    }

    const now = new Date().toISOString();
    const duplicatedItems = request.items.map(item => ({
      ...item,
      id: `${item.sku}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      separatedQuantity: 0
    }));

    setEditingRequestId(null);
    setDraft({
      ...createEmptyRequest(),
      vehiclePlate: request.vehiclePlate || '',
      costCenter: request.costCenter || '',
      vehicleDescription: request.vehicleDescription || '',
      vehicleDetails: request.vehicleDetails || {},
      priority: request.priority || 'Normal',
      notes: request.notes || '',
      items: duplicatedItems,
      createdAt: now,
      updatedAt: now
    });
    setItemQuery('');
    showToast(`Solicitação ${request.code} duplicada. Revise e salve como nova.`, 'success');
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.2fr)_420px] gap-6">
      <section className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 shadow-sm p-5 md:p-6">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6">
          <div>
            <span className="text-primary font-label text-[11px] font-semibold uppercase tracking-wider">
              Solicitação de peças
            </span>
            <h2 className="text-2xl md:text-3xl font-extrabold text-on-surface font-headline tracking-tight mt-1">
              Abra a solicitação pela placa do veículo
            </h2>
            <p className="text-sm text-on-surface-variant mt-2 max-w-2xl">
              A placa chama o centro de custo e os dados do veículo automaticamente. Depois você só adiciona
              os itens e envia para separação.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <button
              type="button"
              onClick={onOpenPanel}
              className="h-11 px-4 rounded-lg bg-surface-container-highest text-primary font-semibold flex items-center gap-2"
            >
              <PanelTop size={18} />
              Painel
            </button>
            <button
              type="button"
              onClick={startNewRequest}
              className="h-11 px-4 rounded-lg bg-surface-container-highest text-primary font-semibold flex items-center gap-2"
            >
              <PackagePlus size={18} />
              Nova solicitação
            </button>
          </div>
        </div>

        {persistedEditingRequest && isDraftReadOnly && (
          <div className="mb-5 rounded-xl border border-outline-variant/20 bg-surface-container-low px-4 py-4 flex items-start gap-3">
            <Lock size={18} className="text-primary shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-on-surface">Solicitação em modo consulta</p>
              <p className="text-sm text-on-surface-variant mt-1">
                Este pedido já foi entregue. Ele fica bloqueado para edição e exclusão, mantendo apenas o histórico para consultas futuras.
              </p>
            </div>
          </div>
        )}

        <div className="mt-4 rounded-xl bg-surface-container-low border border-outline-variant/15 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Truck size={18} className="text-primary" />
            <h3 className="font-headline font-bold text-lg text-on-surface">Dados do veículo</h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="flex flex-col gap-2 text-sm font-semibold text-on-surface">
              Placa confirmada
              <div className="relative">
                <input
                  className="h-12 w-full rounded-lg border border-outline-variant/20 bg-surface-container-lowest px-4 text-sm text-on-surface focus:ring-2 focus:ring-primary/30"
                  value={draft.vehiclePlate}
                  disabled={isDraftReadOnly}
                  onFocus={() => setIsPlateSuggestionOpen(true)}
                  onBlur={() => {
                    window.setTimeout(() => setIsPlateSuggestionOpen(false), 120);
                  }}
                  onChange={event =>
                    setDraft(current => ({
                      ...current,
                      vehiclePlate: normalizePlate(event.target.value)
                    }))
                  }
                  placeholder="Ex.: AAA0A00"
                  autoComplete="off"
                  inputMode="text"
                />

                {isPlateSuggestionOpen && !isDraftReadOnly && normalizePlate(draft.vehiclePlate).length >= 1 && (
                  <div
                    className="absolute z-40 mt-2 w-full rounded-xl border border-outline-variant/20 bg-surface-container-lowest shadow-[0_12px_36px_rgba(36,52,69,0.18)] overflow-hidden"
                    onMouseDown={event => event.preventDefault()}
                  >
                    {vehicles.length === 0 ? (
                      <div className="px-4 py-4 text-sm text-on-surface-variant">
                        Base de veículos vazia. Importe em <strong>Usuários</strong> → Painel da base de veículos.
                      </div>
                    ) : plateSuggestions.length > 0 ? (
                      plateSuggestions.map(vehicle => (
                        <button
                          key={vehicle.id}
                          type="button"
                          onClick={() => {
                            const normalizedTarget = 'modelo';
                            const modelFromDetails =
                              Object.entries(vehicle.details || {}).find(([label]) => {
                                const normalized = normalizeUserFacingText(label).trim().toLowerCase();
                                return normalized === normalizedTarget;
                              })?.[1] || '';
                            const model = (modelFromDetails || vehicle.description || '').trim();
                            setDraft(current => ({
                              ...current,
                              vehiclePlate: normalizePlate(vehicle.plate),
                              costCenter: vehicle.costCenter,
                              vehicleDescription: model || current.vehicleDescription || '',
                              vehicleDetails: vehicle.details || current.vehicleDetails || {},
                              updatedAt: new Date().toISOString()
                            }));
                            setIsPlateSuggestionOpen(false);
                          }}
                          className="w-full px-4 py-3 text-left hover:bg-surface-container-low transition-colors"
                        >
                          <p className="font-semibold text-on-surface text-sm">{normalizePlate(vehicle.plate)}</p>
                          <p className="text-xs text-on-surface-variant mt-1 truncate">
                            {normalizeUserFacingText(vehicle.costCenter)}
                            {vehicle.description ? ` • ${normalizeUserFacingText(vehicle.description)}` : ''}
                          </p>
                        </button>
                      ))
                    ) : (
                      <div className="px-4 py-4 text-sm text-on-surface-variant">
                        Nenhuma placa encontrada para “{normalizePlate(draft.vehiclePlate)}”.
                      </div>
                    )}
                  </div>
                )}
              </div>
            </label>

            <label className="flex flex-col gap-2 text-sm font-semibold text-on-surface">
              Modelo
              <input
                className="h-12 rounded-lg border border-outline-variant/20 bg-surface-container-lowest px-4 text-sm text-on-surface focus:ring-2 focus:ring-primary/30"
                value={matchedVehicleModel || draft.vehicleDescription}
                disabled={isDraftReadOnly || Boolean(matchedVehicleModel)}
                onChange={event =>
                  setDraft(current => ({
                    ...current,
                    vehicleDescription: event.target.value
                  }))
                }
                placeholder="Modelo do veículo"
              />
            </label>

            <label className="flex flex-col gap-2 text-sm font-semibold text-on-surface">
              Centro de custo
              <input
                className="h-12 rounded-lg border border-outline-variant/20 bg-surface-container-lowest px-4 text-sm text-on-surface focus:ring-2 focus:ring-primary/30"
                value={matchedVehicle?.costCenter || draft.costCenter}
                disabled={isDraftReadOnly || Boolean(matchedVehicle)}
                onChange={event =>
                  setDraft(current => ({
                    ...current,
                    costCenter: event.target.value
                  }))
                }
                placeholder="Centro de custo vinculado à placa"
              />
            </label>
          </div>

          {matchedVehicle ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {Object.entries(matchedVehicle.details)
                .filter(([label]) => normalizeUserFacingText(label).trim().toLowerCase() !== 'modelo')
                .slice(0, 6)
                .map(([label, value]) => (
                  <VehicleInfoCard key={label} label={label} value={normalizeUserFacingText(value)} />
                ))}
            </div>
          ) : (
            <div className="mt-3 rounded-lg bg-surface-container-lowest px-4 py-4 text-sm text-on-surface-variant">
              Digite a placa para buscar o centro de custo na base de veículos. Se ainda não existir base importada,
              clique em <strong>Usuários</strong> e carregue a planilha.
            </div>
          )}

          <div className="mt-4">
            <button
              type="button"
              onClick={() => {
                if (isTypeModelPickerOpen) {
                  closeTypeModelPicker();
                  return;
                }
                openTypeModelPicker();
              }}
              className="w-full rounded-lg border border-outline-variant/15 bg-surface-container-lowest px-4 py-3 text-left hover:bg-surface-container-low transition-colors"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-bold uppercase tracking-widest text-outline">Atalho</p>
                  <p className="font-semibold text-on-surface truncate">Navegação por tipo e modelo</p>
                </div>
                <ArrowRight className="text-primary shrink-0" size={18} />
              </div>
            </button>

            {isTypeModelPickerOpen && (
              <div className="mt-3 rounded-xl border border-outline-variant/15 bg-surface-container-lowest p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-bold uppercase tracking-widest text-outline">Seleção rápida</p>
                    <p className="font-semibold text-on-surface truncate">
                      Marque as peças (checkbox) e adicione em lote
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={closeTypeModelPicker}
                    className="h-10 w-10 rounded-lg bg-surface-container-low text-on-surface flex items-center justify-center"
                    aria-label="Fechar seleção rápida"
                  >
                    <X size={18} />
                  </button>
                </div>

                {pickerTypeOptions.length === 0 ? (
                  <div className="mt-3 rounded-xl bg-surface-container-low p-6 text-center text-on-surface-variant text-sm">
                    Nenhum item está com tipo/modelo de veículo preenchido para navegar.
                  </div>
                ) : (
                  <>
                    {pickerKitCards.length > 0 && (
                      <div className="mt-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-xs font-bold uppercase tracking-widest text-outline">Kits preventivos</p>
                            <p className="text-sm font-semibold text-on-surface-variant truncate">
                              Toque em um modelo para marcar as peças do kit
                            </p>
                          </div>
                          {pickerKitId ? (
                            <button
                              type="button"
                              onClick={() => {
                                setPickerKitId('');
                                setPickerSelectedSkus([]);
                              }}
                              className="h-10 px-3 rounded-lg bg-surface-container-highest text-on-surface font-semibold text-sm"
                            >
                              Limpar kit
                            </button>
                          ) : null}
                        </div>

                        <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                          {pickerKitCards.map(card => {
                            const selected = pickerKitId === card.id;
                            const tone = selected
                              ? 'border-primary bg-primary-container/15'
                              : 'border-outline-variant/15 bg-surface-container-lowest hover:bg-surface-container-low';

                            return (
                              <button
                                key={card.id}
                                type="button"
                                onClick={() => {
                                  if (pickerKitId === card.id) {
                                    setPickerKitId('');
                                    setPickerSelectedSkus([]);
                                    return;
                                  }

                                  const kit = preventiveKitCatalog.find(entry => entry.id === card.id) || null;
                                  if (!kit) return;

                                  const selectedSkus: string[] = [];
                                  kit.items.forEach(component => {
                                    const item =
                                      stockItemByNormalizedSku.get(normalizeSkuForKit(component.sku)) || null;
                                    if (!item) return;
                                    if (item.quantity <= 0) return;
                                    if (draftSkuSet.has(item.sku)) return;
                                    selectedSkus.push(item.sku);
                                  });

                                  setPickerKitId(card.id);
                                  setPickerType('');
                                  setPickerModel('');
                                  setPickerItemQuery('');
                                  setPickerSelectedSkus(selectedSkus);
                                }}
                                className={`rounded-lg border px-3 py-3 text-left transition-colors ${tone}`}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <p className="text-[10px] font-bold uppercase tracking-widest text-outline">
                                      Kit
                                    </p>
                                    <p className="mt-1 text-sm font-headline font-extrabold text-on-surface leading-tight truncate">
                                      {card.name}
                                    </p>
                                    <p className="mt-1 text-[11px] text-on-surface-variant font-semibold">
                                      {card.availableKits} kits hoje
                                    </p>
                                  </div>
                                  <PackageCheck size={18} className="text-primary shrink-0" />
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                      <label className="flex flex-col gap-2 text-sm font-semibold text-on-surface">
                        Tipo
                        <select
                          className="h-12 rounded-lg bg-surface-container-lowest px-3 border border-outline-variant/20 text-sm"
                          value={pickerType}
                          onChange={event => {
                            setPickerKitId('');
                            setPickerType(event.target.value);
                            setPickerModel('');
                            setPickerItemQuery('');
                            setPickerSelectedSkus([]);
                          }}
                        >
                          <option value="">Todos os tipos</option>
                          {pickerTypeOptions.map(type => (
                            <option key={type} value={type}>
                              {type}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="flex flex-col gap-2 text-sm font-semibold text-on-surface">
                        Modelo
                        <select
                          className="h-12 rounded-lg bg-surface-container-lowest px-3 border border-outline-variant/20 text-sm"
                          value={pickerModel}
                          onChange={event => {
                            setPickerKitId('');
                            setPickerModel(event.target.value);
                            setPickerItemQuery('');
                            setPickerSelectedSkus([]);
                          }}
                        >
                          <option value="">Todos os modelos</option>
                          {pickerModelOptions.map(option => (
                            <option key={option.key} value={option.key}>
                              {option.label} ({option.itemCount})
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <div className="mt-3 relative">
                      <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-outline" size={18} />
                      <input
                        className="w-full h-12 rounded-lg bg-surface-container-lowest pl-11 pr-4 border border-outline-variant/20 text-sm focus:ring-2 focus:ring-primary/30"
                        value={pickerItemQuery}
                        onChange={event => setPickerItemQuery(event.target.value)}
                        placeholder="Filtrar por SKU, nome, categoria ou localização"
                      />
                    </div>

                    <div className="mt-3 text-xs font-semibold text-on-surface-variant">
                      Selecionados: {pickerSelectedSkus.length}
                    </div>

                    <div className="mt-3 space-y-2 max-h-72 overflow-auto pr-1">
                      {pickerKitId ? (
                        pickerVisibleKitEntries.length > 0 ? (
                          pickerVisibleKitEntries.map(entry => {
                            const item = entry.item;
                            const hasStock = (item?.quantity ?? 0) > 0;
                            const alreadyAdded = item ? draftSkuSet.has(item.sku) : false;
                            const selectable = Boolean(item) && hasStock && !alreadyAdded;
                            const checked = item ? pickerSelectedSet.has(item.sku) : false;

                            return (
                              <label
                                key={`kit-${pickerKitId}-${entry.sku}`}
                                className={`block rounded-xl border px-4 py-3 transition-colors ${
                                  selectable
                                    ? 'bg-surface-container-lowest border-outline-variant/15 hover:border-primary/25 hover:bg-primary-container/10'
                                    : !item || !hasStock
                                      ? 'bg-error-container/15 border-error/25 text-on-surface-variant'
                                      : 'bg-surface-container-low border-outline-variant/10 text-on-surface-variant'
                                }`}
                              >
                                <div className="flex items-start gap-3">
                                  <input
                                    type="checkbox"
                                    className="mt-1 h-5 w-5"
                                    checked={checked}
                                    disabled={!selectable}
                                    onChange={() => {
                                      if (!item || !selectable) return;
                                      togglePickerSku(item.sku);
                                    }}
                                  />
                                  {item ? <ProductImage item={item} size="list" /> : <div className="h-10 w-10 rounded-lg bg-surface-container-low" />}
                                  <div className="min-w-0 flex-1">
                                    <p className="font-semibold text-sm text-on-surface truncate">
                                      {normalizeUserFacingText(item?.name || entry.description)}
                                    </p>
                                    <p className="text-xs text-on-surface-variant truncate mt-0.5">
                                      SKU {entry.sku} • exige {entry.requiredQuantity} • saldo {entry.availableQuantity}
                                      {item ? ` • ${normalizeLocationText(item.location)}` : ''}
                                    </p>
                                    {!item && (
                                      <p className="text-[11px] font-semibold text-error mt-1">
                                        Item não localizado na base: bloqueado
                                      </p>
                                    )}
                                    {item && !hasStock && (
                                      <p className="text-[11px] font-semibold text-error mt-1">
                                        Sem saldo: item bloqueado para solicitação
                                      </p>
                                    )}
                                    {alreadyAdded && (
                                      <p className="text-[11px] font-semibold text-on-surface-variant mt-1">
                                        Já está nesta solicitação
                                      </p>
                                    )}
                                  </div>
                                </div>
                              </label>
                            );
                          })
                        ) : (
                          <div className="rounded-xl bg-surface-container-low p-6 text-center text-on-surface-variant text-sm">
                            Nenhum item encontrado neste kit para este filtro.
                          </div>
                        )
                      ) : pickerVisibleItems.length > 0 ? (
                        pickerVisibleItems.map(item => {
                          const hasStock = item.quantity > 0;
                          const alreadyAdded = draftSkuSet.has(item.sku);
                          const selectable = hasStock && !alreadyAdded;
                          const checked = pickerSelectedSet.has(item.sku);

                          return (
                            <label
                              key={item.sku}
                              className={`block rounded-xl border px-4 py-3 transition-colors ${
                                selectable
                                  ? 'bg-surface-container-lowest border-outline-variant/15 hover:border-primary/25 hover:bg-primary-container/10'
                                  : !hasStock
                                    ? 'bg-error-container/15 border-error/25 text-on-surface-variant'
                                    : 'bg-surface-container-low border-outline-variant/10 text-on-surface-variant'
                              }`}
                            >
                              <div className="flex items-start gap-3">
                                <input
                                  type="checkbox"
                                  className="mt-1 h-5 w-5"
                                  checked={checked}
                                  disabled={!selectable}
                                  onChange={() => {
                                    if (!selectable) return;
                                    togglePickerSku(item.sku);
                                  }}
                                />
                                <ProductImage item={item} size="list" />
                                <div className="min-w-0 flex-1">
                                  <p className="font-semibold text-sm text-on-surface truncate">
                                    {normalizeUserFacingText(item.name)}
                                  </p>
                                  <p className="text-xs text-on-surface-variant truncate mt-0.5">
                                    SKU {item.sku} • {normalizeLocationText(item.location)} • saldo {item.quantity}
                                  </p>
                                  {!hasStock && (
                                    <p className="text-[11px] font-semibold text-error mt-1">
                                      Sem saldo: item bloqueado para solicitação
                                    </p>
                                  )}
                                  {alreadyAdded && (
                                    <p className="text-[11px] font-semibold text-on-surface-variant mt-1">
                                      Já está nesta solicitação
                                    </p>
                                  )}
                                </div>
                              </div>
                            </label>
                          );
                        })
                      ) : (
                        <div className="rounded-xl bg-surface-container-low p-6 text-center text-on-surface-variant text-sm">
                          Selecione um kit ou um tipo/modelo, ou use o filtro para listar as peças.
                        </div>
                      )}
                    </div>

                    <div className="mt-3 flex flex-col sm:flex-row gap-2">
                      <button
                        type="button"
                        onClick={() => setPickerSelectedSkus([])}
                        disabled={pickerSelectedSkus.length === 0}
                        className="h-11 px-4 rounded-lg bg-surface-container-highest text-on-surface font-semibold disabled:opacity-60"
                      >
                        Limpar seleção
                      </button>
                      <button
                        type="button"
                        onClick={addSelectedPickerItems}
                        disabled={pickerSelectedSkus.length === 0}
                        className="flex-1 h-11 px-4 rounded-lg bg-primary text-on-primary font-bold disabled:opacity-60"
                      >
                        Adicionar selecionados
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => onOpenVehicleParts(pickerType || undefined)}
                      className="mt-3 w-full h-11 px-4 rounded-lg bg-surface-container-lowest text-primary font-semibold"
                    >
                      Abrir Peças/Modelo (consulta)
                    </button>
                  </>
                )}
              </div>
            )}

            {vehicleTypeCards.length > 0 ? (
              <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                {vehicleTypeCards.map(card => (
                  <button
                    key={card.type}
                    type="button"
                    onClick={() => openTypeModelPicker(card.type)}
                    className="rounded-lg border border-outline-variant/15 bg-surface-container-lowest px-3 py-3 text-left hover:bg-surface-container-low transition-colors"
                  >
                    <p className="text-[10px] font-bold uppercase tracking-widest text-outline">Tipo</p>
                    <p className="mt-1 text-sm font-headline font-extrabold text-on-surface leading-tight">
                      {card.type}
                    </p>
                    <p className="mt-1 text-[11px] text-on-surface-variant font-semibold">
                      {card.modelCount} modelos • {card.itemCount} peças
                    </p>
                  </button>
                ))}
              </div>
            ) : null}

            {preventiveKitCatalog.length > 0 && (
              <div className="mt-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-bold uppercase tracking-widest text-outline">Kits preventivas</p>
                    <p className="text-sm font-semibold text-on-surface-variant truncate">
                      Clique no kit para adicionar as peças em lote
                    </p>
                  </div>
                </div>

                <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                  {pickerKitCards.map(card => (
                    <button
                      key={`quick-kit-${card.id}`}
                      type="button"
                      onClick={() => addKitToDraft(card.id)}
                      className="rounded-lg border border-outline-variant/15 bg-surface-container-lowest px-3 py-3 text-left hover:bg-surface-container-low transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-outline">Kit</p>
                          <p className="mt-1 text-sm font-headline font-extrabold text-on-surface leading-tight truncate">
                            {card.name}
                          </p>
                          <p className="mt-1 text-[11px] text-on-surface-variant font-semibold">
                            {card.availableKits} kits hoje
                          </p>
                        </div>
                        <PackageCheck size={18} className="text-primary shrink-0" />
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 bg-surface-container-low rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Search size={18} className="text-primary" />
            <h3 className="font-headline font-bold text-lg text-on-surface">Adicionar itens</h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_180px] gap-2 items-stretch">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-outline" size={18} />
              <input
                className="w-full h-12 rounded-lg bg-surface-container-lowest pl-11 pr-4 border border-outline-variant/20 text-sm focus:ring-2 focus:ring-primary/30"
                value={itemQuery}
                disabled={isDraftReadOnly}
                onChange={event => setItemQuery(event.target.value)}
                placeholder="Busque por SKU, nome, categoria ou localização"
              />
            </div>
            <button
              type="button"
              onClick={startSkuScanner}
              disabled={isDraftReadOnly}
              className="h-12 w-full px-4 rounded-lg bg-primary text-on-primary font-bold flex items-center justify-center gap-2 disabled:opacity-60 active:scale-[0.98] transition-transform"
            >
              {isSkuScannerBusy ? <LoaderCircle className="animate-spin" size={18} /> : <Camera size={18} />}
              Ler etiqueta
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

          {(isSkuScannerOpen || isSkuScannerBusy) && !isDraftReadOnly && (
            <div
              ref={skuScannerContainerRef}
              className="mt-3 rounded-lg bg-inverse-surface text-on-primary border border-white/8 px-3 py-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-bold">
                    {isSkuScannerBusy ? <LoaderCircle className="animate-spin" size={16} /> : <Barcode size={16} />}
                    Leitor ativo
                  </div>
                  <p className="text-[11px] text-inverse-on-surface mt-1">{skuScannerStatus}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => void toggleSkuScannerFullscreen()}
                    className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center"
                    aria-label={isSkuScannerFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
                  >
                    {isSkuScannerFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                  </button>
                  <button
                    type="button"
                    onClick={closeSkuScanner}
                    className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center"
                    aria-label="Fechar leitor"
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>

              <div className="mt-3">
                <div className="relative h-56 sm:h-64 rounded-xl overflow-hidden bg-black">
                  <video
                    ref={skuVideoRef}
                    className="w-full h-full object-cover"
                    playsInline
                    muted
                    autoPlay
                  />
                </div>
              </div>
            </div>
          )}

          {filteredItems.length > 0 && !isDraftReadOnly && (
            <div className="mt-3 grid gap-2">
              {filteredItems.map(item => {
                const hasStock = item.quantity > 0;

                return (
                  <button
                    key={item.sku}
                    type="button"
                    onClick={() => addItemToDraft(item)}
                    disabled={!hasStock}
                    className={`w-full rounded-lg border px-4 py-3 text-left transition-colors ${
                      hasStock
                        ? 'bg-surface-container-lowest border-outline-variant/15 hover:border-primary/25 hover:bg-primary-container/15'
                        : 'bg-error-container/15 border-error/25 text-on-surface-variant cursor-not-allowed opacity-90'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex items-center gap-3">
                        <ProductImage item={item} size="list" />
                        <div className="min-w-0">
                        <p className="font-semibold text-sm text-on-surface truncate">{normalizeUserFacingText(item.name)}</p>
                        <p className="text-xs text-on-surface-variant truncate">
                          SKU {item.sku} • {normalizeLocationText(item.location)} • saldo {item.quantity}
                        </p>
                        </div>
                      </div>
                      <span
                        className={`shrink-0 inline-flex items-center gap-1 font-semibold text-sm ${
                          hasStock ? 'text-primary' : 'text-error'
                        }`}
                      >
                        <Plus size={16} />
                        {hasStock ? 'Adicionar' : 'Sem saldo'}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-6">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <h3 className="font-headline font-bold text-lg text-on-surface">Itens desta solicitação</h3>
              <p className="text-xs text-on-surface-variant">
                {draft.items.length} itens • {draftProgress.requested} unidades solicitadas
              </p>
            </div>
            {editingRequestId && draft.code && (
              <span className="text-xs font-bold uppercase tracking-wider text-primary bg-primary-container px-3 py-1 rounded-full">
                {draft.code}
              </span>
            )}
          </div>

          {draft.items.length > 0 ? (
            <div className="space-y-3">
              {draft.items.map(requestItem => {
                const availableQuantity = stockBySku.get(requestItem.sku) ?? 0;

                return (
                  <div
                    key={requestItem.id}
                    className="rounded-xl border border-outline-variant/15 bg-surface-container-low p-4"
                  >
                    <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
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
                        <p className={`text-[11px] font-semibold mt-2 ${availableQuantity > 0 ? 'text-on-surface-variant' : 'text-error'}`}>
                          Saldo disponível: {availableQuantity}
                        </p>
                      </div>

                      <div className="flex items-center gap-3">
                        <label className="text-xs font-bold uppercase text-outline">
                          Quantidade
                          <input
                            type="number"
                            min="1"
                            max={Math.max(availableQuantity, 1)}
                            className="mt-1 h-11 w-24 rounded-lg border border-outline-variant/20 bg-surface-container-lowest px-3 text-sm font-semibold"
                            value={requestItem.requestedQuantity}
                            disabled={isDraftReadOnly}
                            onChange={event =>
                              setDraft(current => ({
                                ...updateRequestItemQuantity(
                                  current,
                                  requestItem.id,
                                  Math.max(1, Math.min(Math.max(availableQuantity, 1), Number(event.target.value || 0)))
                                ),
                                updatedAt: new Date().toISOString()
                              }))
                            }
                          />
                        </label>

                        <button
                          type="button"
                          onClick={() => removeItemFromDraft(requestItem.id)}
                          disabled={isDraftReadOnly}
                          className="mt-5 h-11 w-11 rounded-lg bg-error-container/40 text-error flex items-center justify-center"
                          aria-label={`Remover ${normalizeUserFacingText(requestItem.itemName)}`}
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-xl bg-surface-container-low p-8 text-center text-on-surface-variant">
              Busque um item acima e adicione o que precisa sair do estoque.
            </div>
          )}
        </div>

        {(draft.auditTrail?.length || 0) > 0 && (
          <div className="mt-6 rounded-xl border border-outline-variant/15 bg-surface-container-low p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-widest text-outline">Histórico</p>
                <p className="text-sm font-semibold text-on-surface-variant truncate">
                  Quem criou e quem separou (data/hora)
                </p>
              </div>
            </div>

            <div className="mt-3 space-y-2">
              {[...(draft.auditTrail || [])]
                .slice()
                .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
                .slice(0, 20)
                .map(entry => (
                  <div key={entry.id} className="rounded-lg bg-surface-container-lowest px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-on-surface text-sm">{formatAuditEvent(entry.event)}</p>
                        <p className="text-xs text-on-surface-variant mt-1 truncate">
                          {normalizeUserFacingText(entry.actor?.name) || 'Usuário'}{' '}
                          {entry.actor?.matricula ? `• ${entry.actor.matricula}` : ''}
                          {entry.detail ? ` • ${normalizeUserFacingText(entry.detail)}` : ''}
                        </p>
                      </div>
                      <span className="text-xs font-bold text-on-surface-variant shrink-0">
                        {formatAuditTimestamp(entry.at)}
                      </span>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        <div className="mt-6 flex flex-col md:flex-row gap-3">
          {canMutateDraft ? (
            <>
              <button
                type="button"
                onClick={() => void saveDraft(false)}
                className="flex-1 h-12 rounded-lg bg-primary text-on-primary font-bold flex items-center justify-center gap-2"
              >
                {isSaving ? <LoaderCircle size={18} className="animate-spin" /> : <CheckCircle2 size={18} />}
                Salvar solicitação
              </button>
              {canOpenSeparation && (
                <button
                  type="button"
                  onClick={() => void saveDraft(true)}
                  className="flex-1 h-12 rounded-lg bg-surface-container-highest text-primary font-bold flex items-center justify-center gap-2"
                >
                  <Send size={18} />
                  Salvar e ir para separação
                </button>
              )}
              {persistedEditingRequest && canDeleteRequests && (
                <button
                  type="button"
                  onClick={() => deleteRequest(persistedEditingRequest)}
                  className="h-12 px-4 rounded-lg bg-error-container/40 text-error font-bold flex items-center justify-center gap-2"
                >
                  <Trash2 size={18} />
                  Excluir
                </button>
              )}
            </>
          ) : (
            <div className="flex-1 h-12 rounded-lg bg-surface-container-highest text-on-surface-variant font-bold flex items-center justify-center gap-2">
              <Lock size={18} />
              Solicitação bloqueada para consulta
            </div>
          )}
        </div>
      </section>

      <aside className="space-y-4" />
    </div>
  );
}

function VehicleInfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface-container-lowest px-4 py-3">
      <p className="text-[11px] font-bold uppercase tracking-wider text-outline">{label}</p>
      <p className="font-semibold text-on-surface mt-1">{value}</p>
    </div>
  );
}

function priorityClassName(priority: MaterialRequest['priority']) {
  switch (priority) {
    case 'Urgente':
      return 'inline-flex items-center rounded-full bg-error-container px-3 py-1 text-[11px] font-bold text-on-error-container';
    case 'Alta':
      return 'inline-flex items-center rounded-full bg-primary-container px-3 py-1 text-[11px] font-bold text-on-primary-container';
    case 'Baixa':
      return 'inline-flex items-center rounded-full bg-surface-container-high px-3 py-1 text-[11px] font-bold text-on-surface-variant';
    default:
      return 'inline-flex items-center rounded-full bg-surface-container-highest px-3 py-1 text-[11px] font-bold text-on-surface-variant';
  }
}

function statusClassName(status: MaterialRequest['status']) {
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
}

function canEditRequest(status: MaterialRequest['status']) {
  const normalized = normalizeUserFacingText(status);
  return normalized !== 'Atendida' && normalized !== 'Estornada';
}

function isRequestLocked(status: MaterialRequest['status']) {
  return !canEditRequest(status);
}
