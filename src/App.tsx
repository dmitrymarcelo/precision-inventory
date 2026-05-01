/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { CheckCircle2, Cloud, Info } from 'lucide-react';
import Layout from './components/Layout';
import Dashboard from './components/Dashboard';
import StockWorkspace from './components/StockWorkspace';
import InventoryOperation from './components/InventoryOperation';
import RequestManager from './components/RequestManager';
import RequestHistory from './components/RequestHistory';
import MaterialSeparation from './components/MaterialSeparation';
import VehiclePartsBrowser from './components/VehiclePartsBrowser';
import PreventiveKits from './components/PreventiveKits';
import UserManager from './components/UserManager';
import {
  InventoryItem,
  InventoryLog,
  InventorySettings,
  MaterialRequest,
  VehicleRecord
} from './types';
import { calculateItemStatus, defaultInventorySettings } from './inventoryRules';
import { CloudInventoryState, loadCloudState, saveCloudState } from './cloudState';
import { sanitizeRequests } from './requestUtils';
import { sanitizeVehicles } from './vehicleBase';
import { classifyInventoryCategory } from './categoryCatalog';
import { getVehicleTypeFromModel, normalizeOfficialVehicleModel, normalizeOperationalVehicleType } from './vehicleCatalog';
import { normalizeInventoryStatus, normalizeLocationText, normalizeUserFacingText } from './textUtils';

const initialData: InventoryItem[] = [
  { sku: '01074', name: 'CATALISADOR PARA TINTAS', quantity: 11, category: 'Grupo 0004', location: 'Sem localização', status: 'Repor em Breve' },
  { sku: '01167', name: 'FITA CREPE 48X50', quantity: 44, category: 'Grupo 0004', location: 'I4', status: 'Estoque Saudável' },
  { sku: '01220', name: 'LIXA A-275 P80 SECO', quantity: 183, category: 'Grupo 0004', location: 'I2', status: 'Estoque Saudável' },
  { sku: '02509', name: 'DISCO DE FREIO DIANTEIRO', quantity: 11, category: 'Grupo 0001', location: 'Sem localização', status: 'Repor em Breve' },
  { sku: '02998', name: 'LUZ OLHO DE TUBARÃO', quantity: 29, category: 'Grupo 0006', location: 'Sem localização', status: 'Estoque Saudável' },
  { sku: '03709', name: 'PIVÔ S. SUP. - HILUX', quantity: 31, category: 'Grupo 0001', location: 'Sem localização', status: 'Estoque Saudável' },
  { sku: '06682', name: 'FILTRO DE AR CONDICIONADO (CABINE) - S10 2.4L/3.6L 8V', quantity: 0, category: 'Grupo 0001', location: 'I6', status: 'Estoque Crítico' },
  { sku: '00964', name: 'BALDE 20 LT DE ÓLEO 68', quantity: 0, category: 'Grupo 0016', location: 'A2', status: 'Estoque Crítico' },
  { sku: '01891', name: 'CABO FLEX 1,5MM - PRETO', quantity: 0, category: 'Grupo 0006', location: 'A1', status: 'Estoque Crítico' },
  { sku: '03186', name: 'PLUG MACHO 2P 10A', quantity: 41, category: 'Grupo 0006', location: 'L2', status: 'Estoque Saudável' },
  { sku: '03907', name: 'ADESIVO 20G SOLUFIX CIANO MULT', quantity: 36, category: 'Grupo 0004', location: 'Sem localização', status: 'Estoque Saudável' }
];

const storageKey = 'precisionInventory.react.items.v1';
const logsStorageKey = 'precisionInventory.react.logs.v1';
const settingsStorageKey = 'precisionInventory.react.settings.v1';
const requestsStorageKey = 'precisionInventory.react.requests.v1';
const vehiclesStorageKey = 'precisionInventory.react.vehicles.v1';
const localUpdatedAtStorageKey = 'precisionInventory.local.updatedAt.v1';
const localDirtyStorageKey = 'precisionInventory.local.dirty.v1';
const cloudOutboxStorageKey = 'precisionInventory.cloud.outbox.v1';
const syncEventsStorageKey = 'precisionInventory.sync.events.v1';
const authSessionStorageKey = 'precisionInventory.auth.session.v1';
const authPinStorageKey = 'precisionInventory.auth.pin.v1';
const cloudRefreshIntervalMs = 5000;
const cloudFocusRefreshCooldownMs = 1200;
const validTabs = [
  'dashboard',
  'vehicle-parts',
  'preventive-kits',
  'requests',
  'request-history',
  'separation',
  'inventory',
  'inventory-operations',
  'users'
];

function getInitialTab() {
  const tab = new URLSearchParams(window.location.search).get('tab');
  if (tab === 'update') return 'inventory';
  return tab && validTabs.includes(tab) ? tab : 'dashboard';
}

function getInitialSku() {
  return new URLSearchParams(window.location.search).get('sku');
}

function getInitialRequestId() {
  return new URLSearchParams(window.location.search).get('request');
}

function getInitialInventoryFilter() {
  return new URLSearchParams(window.location.search).get('filter') || '';
}

function normalizeStoredItems(items: InventoryItem[]) {
  if (!Array.isArray(items)) {
    return initialData.map(normalizeInventoryItemRecord);
  }
  return items.map(normalizeInventoryItemRecord);
}

function normalizeStoredLogs(logs: InventoryLog[]) {
  if (!Array.isArray(logs)) return [];

  return logs
    .filter((value): value is InventoryLog => Boolean(value && typeof value === 'object'))
    .map(log => ({
      ...log,
      sku: String(log.sku || ''),
      itemName: normalizeUserFacingText(log.itemName),
      location: normalizeLocationText(log.location),
      source:
        log.source === 'ajuste' ||
        log.source === 'recebimento' ||
        log.source === 'solicitacao' ||
        log.source === 'divergencia'
          ? log.source
          : undefined,
      referenceCode: log.referenceCode ? normalizeUserFacingText(log.referenceCode) : undefined
    }))
    .filter(log => Boolean(log.id && log.sku));
}

function normalizeInventoryItemRecord(item: InventoryItem): InventoryItem {
  const name = normalizeUserFacingText(item.name);
  const sourceCategory = normalizeUserFacingText(item.sourceCategory || item.category);
  const classified = classifyInventoryCategory(name, sourceCategory);
  const vehicleModel = normalizeOfficialVehicleModel(item.vehicleModel || '');
  const updatedAt = typeof item.updatedAt === 'string' ? item.updatedAt : undefined;

  return {
    ...item,
    name,
    isActiveInWarehouse: item.isActiveInWarehouse === true,
    updatedAt,
    imageUrl: normalizeImageUrl(item.imageUrl),
    imageHint: normalizeUserFacingText(item.imageHint),
    vehicleModel,
    vehicleType: normalizeOperationalVehicleType(item.vehicleType || getVehicleTypeFromModel(vehicleModel)),
    location: normalizeImportedLocation(item.location),
    category: classified.category,
    sourceCategory: classified.sourceCategory,
    status: normalizeInventoryStatus(item.status)
  };
}

function normalizeImportedLocation(location: string) {
  return normalizeLocationText(location);
}

function normalizeImageUrl(value: string | undefined) {
  const url = normalizeUserFacingText(value);
  if (!url) return '';
  return /^https?:\/\//i.test(url) || url.startsWith('/') ? url : '';
}

type UserRole = 'consulta' | 'operacao' | 'admin';
type AuthSession = { role: UserRole; token?: string; userId?: string; matricula?: string; name?: string; mustChangePassword?: boolean; mode?: 'password' };

type SyncEvent = { at: string; event: string; detail?: string };
type CloudOutbox = { state: CloudInventoryState; queuedAt: string; localUpdatedAt: string };

function LoginScreen({ onLogin }: { onLogin: (session: AuthSession) => void }) {
  const [hasUsers, setHasUsers] = useState<boolean | null>(null);
  const [loginError, setLoginError] = useState('');
  const [bootstrapError, setBootstrapError] = useState('');
  const [loading, setLoading] = useState(false);

  const [matricula, setMatricula] = useState('');
  const [senha, setSenha] = useState('');

  const [bootstrapMatricula, setBootstrapMatricula] = useState('');
  const [bootstrapNome, setBootstrapNome] = useState('');
  const [bootstrapSenha, setBootstrapSenha] = useState('');
  const [bootstrapConfirm, setBootstrapConfirm] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function loadMeta() {
      try {
        const response = await fetch('/api/users?meta=1', { cache: 'no-store' });
        const data = (await response.json()) as { ok: boolean; hasUsers?: boolean };
        if (!cancelled) {
          setHasUsers(response.ok && data?.ok ? Boolean(data?.hasUsers) : null);
        }
      } catch {
        if (!cancelled) {
          setHasUsers(null);
        }
      }
    }
    void loadMeta();
    return () => {
      cancelled = true;
    };
  }, []);

  const handlePasswordLogin = async () => {
    setLoginError('');
    setBootstrapError('');
    setLoading(true);
    try {
      const response = await fetch('/api/auth?action=login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ matricula: matricula.trim(), senha })
      });
      const data = (await response.json()) as {
        ok: boolean;
        message?: string;
        token?: string;
        mustChangePassword?: boolean;
        user?: { id: string; matricula: string; name: string; role: UserRole };
      };

      if (!response.ok || !data?.ok || !data.user || !data.token) {
        setLoginError(data?.message || 'Não foi possível entrar.');
        return;
      }

      onLogin({
        role: data.user.role,
        token: data.token,
        userId: data.user.id,
        matricula: data.user.matricula,
        name: data.user.name,
        mustChangePassword: Boolean(data.mustChangePassword),
        mode: 'password'
      });
    } catch {
      setLoginError('Falha de conexão. Verifique a internet e tente de novo.');
    } finally {
      setLoading(false);
    }
  };

  const handleBootstrap = async () => {
    setLoginError('');
    setBootstrapError('');
    const matriculaValue = bootstrapMatricula.trim();
    const nomeValue = bootstrapNome.trim();

    if (!matriculaValue || !nomeValue || !bootstrapSenha) {
      setBootstrapError('Informe matrícula, nome e senha.');
      return;
    }
    if (bootstrapSenha.length < 4) {
      setBootstrapError('Senha muito curta (mínimo 4).');
      return;
    }
    if (bootstrapSenha !== bootstrapConfirm) {
      setBootstrapError('As senhas não conferem.');
      return;
    }

    setLoading(true);
    try {
      const createResponse = await fetch('/api/users?bootstrap=1', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ matricula: matriculaValue, nome: nomeValue, senha: bootstrapSenha, role: 'admin' })
      });
      const created = (await createResponse.json()) as { ok: boolean; message?: string };
      if (!createResponse.ok || !created.ok) {
        setBootstrapError(created?.message || 'Não foi possível cadastrar.');
        try {
          const metaResponse = await fetch('/api/users?meta=1', { cache: 'no-store' });
          const meta = (await metaResponse.json()) as { ok: boolean; hasUsers?: boolean };
          setHasUsers(metaResponse.ok && meta?.ok ? Boolean(meta?.hasUsers) : null);
        } catch {}
        return;
      }

      const loginResponse = await fetch('/api/auth?action=login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ matricula: matriculaValue, senha: bootstrapSenha })
      });
      const data = (await loginResponse.json()) as {
        ok: boolean;
        message?: string;
        token?: string;
        mustChangePassword?: boolean;
        user?: { id: string; matricula: string; name: string; role: UserRole };
      };

      if (!loginResponse.ok || !data?.ok || !data.user || !data.token) {
        setBootstrapError(data?.message || 'Cadastro feito, mas não consegui entrar.');
        return;
      }

      onLogin({
        role: data.user.role,
        token: data.token,
        userId: data.user.id,
        matricula: data.user.matricula,
        name: data.user.name,
        mustChangePassword: Boolean(data.mustChangePassword),
        mode: 'password'
      });
    } catch {
      setBootstrapError('Falha de conexão. Verifique a internet e tente de novo.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface-container-lowest flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md rounded-2xl border border-outline-variant/20 bg-surface-container-lowest shadow-[0_18px_48px_rgba(36,52,69,0.14)] overflow-hidden">
        <div className="p-6 border-b border-outline-variant/15">
          <h1 className="text-2xl font-headline font-extrabold tracking-tight text-on-surface">Precision Inventory</h1>
          <p className="text-sm text-on-surface-variant mt-2">Acesso por matrícula e senha.</p>
        </div>

        <div className="p-6 space-y-5">
          {hasUsers === false ? (
            <div className="rounded-xl bg-surface-container-low p-4 border border-outline-variant/15">
              <p className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">Primeiro cadastro</p>
              <p className="text-sm text-on-surface-variant mt-1">
                Crie o primeiro usuário (Admin) para liberar o controle de acesso.
              </p>

              <div className="mt-4 space-y-3">
                <input
                  value={bootstrapMatricula}
                  onChange={event => setBootstrapMatricula(event.target.value)}
                  placeholder="Matrícula"
                  className="w-full h-12 rounded-xl px-4 bg-surface-container-lowest border border-outline-variant/20 focus:ring-2 focus:ring-primary/40"
                  inputMode="numeric"
                />
                <input
                  value={bootstrapNome}
                  onChange={event => setBootstrapNome(event.target.value)}
                  placeholder="Nome"
                  className="w-full h-12 rounded-xl px-4 bg-surface-container-lowest border border-outline-variant/20 focus:ring-2 focus:ring-primary/40"
                />
                <input
                  value={bootstrapSenha}
                  onChange={event => setBootstrapSenha(event.target.value)}
                  placeholder="Senha"
                  className="w-full h-12 rounded-xl px-4 bg-surface-container-lowest border border-outline-variant/20 focus:ring-2 focus:ring-primary/40"
                  type="password"
                />
                <input
                  value={bootstrapConfirm}
                  onChange={event => setBootstrapConfirm(event.target.value)}
                  placeholder="Confirmar senha"
                  className="w-full h-12 rounded-xl px-4 bg-surface-container-lowest border border-outline-variant/20 focus:ring-2 focus:ring-primary/40"
                  type="password"
                />

                {bootstrapError ? <div className="text-sm font-semibold text-error">{bootstrapError}</div> : null}

                <button
                  type="button"
                  onClick={handleBootstrap}
                  disabled={loading}
                  className="w-full h-12 rounded-xl bg-primary text-on-primary font-bold disabled:opacity-60"
                >
                  {loading ? 'Cadastrando...' : 'Cadastrar e entrar'}
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-xl bg-surface-container-low p-4 border border-outline-variant/15">
              <p className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">Entrar</p>
              <div className="mt-4 space-y-3">
                <input
                  value={matricula}
                  onChange={event => setMatricula(event.target.value)}
                  placeholder="Matrícula"
                  className="w-full h-12 rounded-xl px-4 bg-surface-container-lowest border border-outline-variant/20 focus:ring-2 focus:ring-primary/40"
                  inputMode="numeric"
                />
                <input
                  value={senha}
                  onChange={event => setSenha(event.target.value)}
                  placeholder="Senha"
                  className="w-full h-12 rounded-xl px-4 bg-surface-container-lowest border border-outline-variant/20 focus:ring-2 focus:ring-primary/40"
                  type="password"
                />

                {loginError ? <div className="text-sm font-semibold text-error">{loginError}</div> : null}

                <button
                  type="button"
                  onClick={handlePasswordLogin}
                  disabled={loading}
                  className="w-full h-12 rounded-xl bg-primary text-on-primary font-bold disabled:opacity-60"
                >
                  {loading ? 'Entrando...' : 'Entrar'}
                </button>
              </div>

              {hasUsers === null ? (
                <div className="mt-4 text-xs text-on-surface-variant">Sem resposta do servidor. Verifique internet.</div>
              ) : null}
            </div>
          )}

        </div>

        <div className="p-4 bg-surface-container-low/60 border-t border-outline-variant/15 text-xs text-on-surface-variant">
          Dica: em celular, use Operação só quando precisar alterar.
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [activeTab, setActiveTabState] = useState(getInitialTab);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'info' } | null>(null);
  const [cloudStatus, setCloudStatus] = useState<'loading' | 'online' | 'offline' | 'saving'>('loading');
  const [cloudLoaded, setCloudLoaded] = useState(false);
  const [cloudAvailable, setCloudAvailable] = useState(false);
  const [cloudHasState, setCloudHasState] = useState(false);
  const [ocrAliases, setOcrAliases] = useState<Record<string, string>>({});
  const saveTimerRef = useRef<number | null>(null);
  const cloudRetryTimerRef = useRef<number | null>(null);
  const outboxWriteTimerRef = useRef<number | null>(null);
  const wasOfflineRef = useRef(false);
  const localUpdatedAtRef = useRef<string>(localStorage.getItem(localUpdatedAtStorageKey) || '');
  const localDirtyRef = useRef<boolean>(localStorage.getItem(localDirtyStorageKey) === '1');
  let initialOutbox: CloudOutbox | null = null;
  try {
    const stored = localStorage.getItem(cloudOutboxStorageKey);
    if (stored) {
      const parsed = JSON.parse(stored) as CloudOutbox;
      initialOutbox = parsed && parsed.state ? parsed : null;
    }
  } catch {
    initialOutbox = null;
  }
  const outboxRef = useRef<CloudOutbox | null>(initialOutbox);
  const [authSession, setAuthSession] = useState<AuthSession | null>(() => {
    try {
      const stored = localStorage.getItem(authSessionStorageKey);
      if (!stored) return null;
      const parsed = JSON.parse(stored) as AuthSession;
      if (!parsed || (parsed.role !== 'consulta' && parsed.role !== 'operacao' && parsed.role !== 'admin')) {
        return null;
      }
      return {
        role: parsed.role,
        token: typeof parsed.token === 'string' ? parsed.token : undefined,
        userId: typeof parsed.userId === 'string' ? parsed.userId : undefined,
        matricula: typeof parsed.matricula === 'string' ? parsed.matricula : undefined,
        name: typeof parsed.name === 'string' ? parsed.name : undefined,
        mustChangePassword: typeof parsed.mustChangePassword === 'boolean' ? parsed.mustChangePassword : undefined,
        mode: parsed.mode === 'password' ? parsed.mode : undefined
      };
    } catch {
      return null;
    }
  });
  const [passwordChangeSenha, setPasswordChangeSenha] = useState('');
  const [passwordChangeConfirm, setPasswordChangeConfirm] = useState('');
  const [passwordChangeError, setPasswordChangeError] = useState('');
  const [passwordChangeSaving, setPasswordChangeSaving] = useState(false);
  const [items, setItems] = useState<InventoryItem[]>(() => {
    try {
      const storedItems = localStorage.getItem(storageKey);
      return storedItems ? normalizeStoredItems(JSON.parse(storedItems)) : normalizeStoredItems(initialData);
    } catch {
      return normalizeStoredItems(initialData);
    }
  });
  const [logs, setLogs] = useState<InventoryLog[]>(() => {
    try {
      const storedLogs = localStorage.getItem(logsStorageKey);
      return storedLogs ? normalizeStoredLogs(JSON.parse(storedLogs)) : [];
    } catch {
      return [];
    }
  });
  const [settings, setSettings] = useState<InventorySettings>(() => {
    try {
      const storedSettings = localStorage.getItem(settingsStorageKey);
      return storedSettings ? { ...defaultInventorySettings, ...JSON.parse(storedSettings) } : defaultInventorySettings;
    } catch {
      return defaultInventorySettings;
    }
  });
  const [requests, setRequests] = useState<MaterialRequest[]>(() => {
    try {
      const storedRequests = localStorage.getItem(requestsStorageKey);
      return sanitizeRequests(storedRequests ? JSON.parse(storedRequests) : []);
    } catch {
      return [];
    }
  });
  const [vehicles, setVehicles] = useState<VehicleRecord[]>(() => {
    try {
      const storedVehicles = localStorage.getItem(vehiclesStorageKey);
      return sanitizeVehicles(storedVehicles ? JSON.parse(storedVehicles) : []);
    } catch {
      return [];
    }
  });
  const [selectedSku, setSelectedSku] = useState<string | null>(getInitialSku);
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(getInitialRequestId);
  const [inventoryFilter, setInventoryFilter] = useState(getInitialInventoryFilter);
  const [vehiclePartsPresetType, setVehiclePartsPresetType] = useState('');
  const [vehiclePartsPresetModel, setVehiclePartsPresetModel] = useState('');
  const [vehiclePartsPresetVersion, setVehiclePartsPresetVersion] = useState(0);

  const showToast = (message: string, type: 'success' | 'info' = 'info') => {
    setToast({ message, type });
    window.setTimeout(() => setToast(null), 3000);
  };

  const mustChangePassword = authSession?.mustChangePassword === true;

  const handleForcePasswordChange = async () => {
    if (!authSession?.token) {
      setPasswordChangeError('Sessão inválida. Saia e entre novamente.');
      return;
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setPasswordChangeError('Sem internet. Conecte o telefone para trocar a senha.');
      return;
    }

    setPasswordChangeError('');
    if (!passwordChangeSenha) {
      setPasswordChangeError('Informe a nova senha.');
      return;
    }
    if (passwordChangeSenha.length < 4) {
      setPasswordChangeError('Senha muito curta (mínimo 4).');
      return;
    }
    if (passwordChangeSenha !== passwordChangeConfirm) {
      setPasswordChangeError('As senhas não conferem.');
      return;
    }

    setPasswordChangeSaving(true);
    try {
      const response = await fetch('/api/auth?action=change-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${authSession.token}` },
        cache: 'no-store',
        body: JSON.stringify({ senha: passwordChangeSenha })
      });
      const raw = await response.text();
      let data: { ok: boolean; message?: string } | null = null;
      try {
        data = raw ? (JSON.parse(raw) as { ok: boolean; message?: string }) : null;
      } catch {
        data = null;
      }

      if (!response.ok || !data?.ok) {
        if (data?.message) {
          setPasswordChangeError(data.message);
        } else if (!raw) {
          setPasswordChangeError(`Não foi possível trocar a senha (HTTP ${response.status}).`);
        } else {
          setPasswordChangeError(`Resposta inválida do servidor. Atualize a página e tente novamente.`);
        }
        return;
      }

      setAuthSession(previous => (previous ? { ...previous, mustChangePassword: false } : previous));
      setPasswordChangeSenha('');
      setPasswordChangeConfirm('');
      showToast('Senha atualizada.', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      setPasswordChangeError(message ? `Falha de conexão: ${message}` : 'Falha de conexão.');
    } finally {
      setPasswordChangeSaving(false);
    }
  };

  useEffect(() => {
    if (!mustChangePassword) {
      setPasswordChangeSenha('');
      setPasswordChangeConfirm('');
      setPasswordChangeError('');
      setPasswordChangeSaving(false);
    }
  }, [mustChangePassword]);

  const appendSyncEvent = (event: string, detail?: string) => {
    try {
      const existing = localStorage.getItem(syncEventsStorageKey);
      const current = existing ? (JSON.parse(existing) as SyncEvent[]) : [];
      const next = [{ at: new Date().toISOString(), event, detail }, ...current].slice(0, 40);
      localStorage.setItem(syncEventsStorageKey, JSON.stringify(next));
    } catch {}
  };

  const setOutbox = (state: CloudInventoryState, queuedAt: string, localUpdatedAt: string) => {
    const outbox: CloudOutbox = { state, queuedAt, localUpdatedAt };
    outboxRef.current = outbox;
    try {
      localStorage.setItem(cloudOutboxStorageKey, JSON.stringify(outbox));
    } catch {}
  };

  const clearOutbox = () => {
    outboxRef.current = null;
    try {
      localStorage.removeItem(cloudOutboxStorageKey);
    } catch {}
  };

  const applyCloudStateIfNewer = (
    result: { state: CloudInventoryState | null; updatedAt: string | null },
    reason: string
  ) => {
    setCloudHasState(Boolean(result.state));
    if (!result.state) return false;

    const localUpdatedAt = new Date(localUpdatedAtRef.current || 0).getTime() || 0;
    const cloudUpdatedAt = new Date(result.updatedAt || 0).getTime() || 0;
    if (!cloudUpdatedAt || cloudUpdatedAt <= localUpdatedAt || localDirtyRef.current || outboxRef.current) {
      return false;
    }

    setItems(normalizeStoredItems(result.state.items));
    setLogs(normalizeStoredLogs(result.state.logs));
    setSettings({ ...defaultInventorySettings, ...result.state.settings });
    setRequests(sanitizeRequests(result.state.requests));
    setVehicles(sanitizeVehicles(result.state.vehicles));
    setOcrAliases(
      result.state.ocrAliases && typeof result.state.ocrAliases === 'object'
        ? result.state.ocrAliases
        : {}
    );

    localUpdatedAtRef.current = result.updatedAt || '';
    if (result.updatedAt) {
      localStorage.setItem(localUpdatedAtStorageKey, result.updatedAt);
    }
    appendSyncEvent('cloud_refresh_applied', reason);
    return true;
  };

  async function flushOutbox(reason: string) {
    const outbox = outboxRef.current;
    if (!outbox) return;
    if (!cloudLoaded) return;
    if (cloudStatus === 'saving') return;

    setCloudStatus('saving');
    appendSyncEvent('flush_start', reason);

    try {
      const result = await saveCloudState(outbox.state, authSession?.token);
      setCloudHasState(true);
      setCloudAvailable(true);
      setCloudStatus('online');
      localDirtyRef.current = false;
      localStorage.removeItem(localDirtyStorageKey);
      localUpdatedAtRef.current = result.updatedAt;
      localStorage.setItem(localUpdatedAtStorageKey, result.updatedAt);
      clearOutbox();
      appendSyncEvent('flush_ok', reason);
      if (wasOfflineRef.current) {
        wasOfflineRef.current = false;
        showToast('Internet voltou. Alterações sincronizadas.', 'success');
      }
    } catch {
      setCloudAvailable(false);
      setCloudStatus('offline');
      wasOfflineRef.current = true;
      appendSyncEvent('flush_fail', reason);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function loadOnlineState() {
      try {
        if (!cloudLoaded) {
          setCloudStatus('loading');
        }
        const result = await loadCloudState();
        if (cancelled) return;

        applyCloudStateIfNewer(result, 'initial_load');

        setCloudAvailable(true);
        setCloudStatus('online');
        if (cloudRetryTimerRef.current) {
          window.clearTimeout(cloudRetryTimerRef.current);
          cloudRetryTimerRef.current = null;
        }
        if (outboxRef.current && localDirtyRef.current) {
          void flushOutbox('initial_load');
        }
      } catch {
        if (!cancelled) {
          setCloudAvailable(false);
          setCloudStatus('offline');
          wasOfflineRef.current = true;
          if (!cloudRetryTimerRef.current) {
            cloudRetryTimerRef.current = window.setTimeout(() => {
              cloudRetryTimerRef.current = null;
              void loadOnlineState();
            }, 4000);
          }
        }
      } finally {
        if (!cancelled) {
          setCloudLoaded(true);
        }
      }
    }

    void loadOnlineState();

    return () => {
      cancelled = true;
      if (cloudRetryTimerRef.current) {
        window.clearTimeout(cloudRetryTimerRef.current);
        cloudRetryTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const handleOnline = () => {
      wasOfflineRef.current = true;
      setCloudStatus('loading');
      void flushOutbox('online_event');
    };
    const handleOffline = () => {
      wasOfflineRef.current = true;
      setCloudAvailable(false);
      setCloudStatus('offline');
      appendSyncEvent('offline');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (authSession) {
      localStorage.setItem(authSessionStorageKey, JSON.stringify(authSession));
    } else {
      localStorage.removeItem(authSessionStorageKey);
    }
  }, [authSession]);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(items));
  }, [items]);

  useEffect(() => {
    localStorage.setItem(logsStorageKey, JSON.stringify(logs));
  }, [logs]);

  useEffect(() => {
    localStorage.setItem(settingsStorageKey, JSON.stringify(settings));
    setItems(previous =>
      previous.map(item => ({
        ...item,
        status: calculateItemStatus(item, settings)
      }))
    );
  }, [settings]);

  useEffect(() => {
    localStorage.setItem(requestsStorageKey, JSON.stringify(requests));
  }, [requests]);

  useEffect(() => {
    localStorage.setItem(vehiclesStorageKey, JSON.stringify(vehicles));
  }, [vehicles]);

  useEffect(() => {
    if (!localDirtyRef.current) return;
    if (outboxWriteTimerRef.current) window.clearTimeout(outboxWriteTimerRef.current);

    outboxWriteTimerRef.current = window.setTimeout(() => {
      outboxWriteTimerRef.current = null;
      const queuedAt = new Date().toISOString();
      const state: CloudInventoryState = { items, logs, settings, requests, vehicles, ocrAliases };
      setOutbox(state, queuedAt, localUpdatedAtRef.current);
      appendSyncEvent('outbox_write');
      if (navigator.onLine) {
        void flushOutbox('outbox_write');
      }
    }, 300);

    return () => {
      if (outboxWriteTimerRef.current) {
        window.clearTimeout(outboxWriteTimerRef.current);
        outboxWriteTimerRef.current = null;
      }
    };
  }, [items, logs, settings, requests, vehicles, ocrAliases]);

  useEffect(() => {
    if (!cloudLoaded || !cloudAvailable) return;
    if (!localDirtyRef.current && !outboxRef.current) {
      setCloudStatus('online');
      return;
    }

    const hasRealStateToSave =
      localDirtyRef.current ||
      items.length > initialData.length ||
      logs.length > 0 ||
      requests.length > 0 ||
      vehicles.length > 0;

    if (!hasRealStateToSave) {
      setCloudStatus('online');
      return;
    }

    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }

    setCloudStatus('saving');
    saveTimerRef.current = window.setTimeout(() => {
      void flushOutbox('autosave');
    }, 600);

    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, [items, logs, settings, requests, vehicles, ocrAliases, cloudLoaded, cloudAvailable, cloudHasState]);

  useEffect(() => {
    if (!cloudLoaded) return;
    if (cloudStatus === 'saving') return;
    if (cloudAvailable && cloudStatus !== 'offline') return;
    if (cloudRetryTimerRef.current) return;

    cloudRetryTimerRef.current = window.setTimeout(async () => {
      cloudRetryTimerRef.current = null;
      try {
        setCloudStatus('loading');
        const result = await loadCloudState();
        applyCloudStateIfNewer(result, 'retry');

        setCloudAvailable(true);
        setCloudStatus('online');
      } catch {
        setCloudAvailable(false);
        setCloudStatus('offline');
      }
    }, 4000);

    return () => {
      if (cloudRetryTimerRef.current) {
        window.clearTimeout(cloudRetryTimerRef.current);
        cloudRetryTimerRef.current = null;
      }
    };
  }, [cloudAvailable, cloudLoaded, cloudStatus]);

  useEffect(() => {
    if (!cloudLoaded || !authSession || mustChangePassword) return;

    let cancelled = false;
    let inFlight = false;
    let lastFocusRefresh = 0;

    const refreshCloudState = async (reason: string) => {
      if (cancelled || inFlight) return;
      if (cloudStatus === 'saving' || localDirtyRef.current || outboxRef.current) return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

      inFlight = true;
      try {
        const result = await loadCloudState();
        if (cancelled) return;
        applyCloudStateIfNewer(result, reason);
        setCloudAvailable(true);
        setCloudStatus('online');
      } catch {
        if (cancelled) return;
        setCloudAvailable(false);
        setCloudStatus('offline');
        appendSyncEvent('cloud_refresh_fail', reason);
      } finally {
        inFlight = false;
      }
    };

    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void refreshCloudState('interval');
      }
    }, cloudRefreshIntervalMs);

    const handleFocusRefresh = () => {
      const now = Date.now();
      if (now - lastFocusRefresh < cloudFocusRefreshCooldownMs) return;
      lastFocusRefresh = now;
      void refreshCloudState('focus');
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        handleFocusRefresh();
      }
    };

    window.addEventListener('focus', handleFocusRefresh);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener('focus', handleFocusRefresh);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [authSession, cloudLoaded, cloudStatus, mustChangePassword]);

  const markLocalDirty = (updatedAt: string) => {
    localDirtyRef.current = true;
    localStorage.setItem(localDirtyStorageKey, '1');
    localUpdatedAtRef.current = updatedAt;
    localStorage.setItem(localUpdatedAtStorageKey, updatedAt);
  };

  const role: UserRole = authSession?.role || 'consulta';
  const auditActor = {
    id: authSession?.userId,
    matricula: authSession?.matricula,
    name: authSession?.name,
    role
  };
  const canAdjustStock = role === 'admin';
  const canReceiveStock = role === 'admin' || role === 'operacao';
  const canOperateSeparation = role === 'admin' || role === 'operacao';
  const canCreateRequests = role === 'admin' || role === 'operacao' || role === 'consulta';
  const canEditExistingRequests = role === 'admin' || role === 'operacao';
  const canDeleteRequests = role === 'admin';
  const canReverseRequests = role === 'admin';
  const canManageUsers = role === 'admin';
  const canWriteItemsAndLogs = role === 'admin' || role === 'operacao';
  const canWriteVehicles = role === 'admin' || role === 'operacao';
  const canWriteSettings = role === 'admin';

  useEffect(() => {
    if (!authSession) return;
    const allowedTabs =
      role === 'admin'
        ? validTabs
        : role === 'operacao'
          ? ['dashboard', 'vehicle-parts', 'preventive-kits', 'requests', 'request-history', 'separation', 'inventory']
          : ['dashboard', 'vehicle-parts', 'preventive-kits', 'requests'];

    if (!allowedTabs.includes(activeTab)) {
      setActiveTab('dashboard');
    }
  }, [activeTab, authSession, role]);
  const setItemsGuarded: React.Dispatch<React.SetStateAction<InventoryItem[]>> = updater => {
    if (!canWriteItemsAndLogs) {
      showToast('Modo consulta: sem permissão para alterar o estoque.', 'info');
      return;
    }
    flushSync(() => {
      setItems(previous => {
        const resolved =
          typeof updater === 'function'
            ? (updater as (prev: InventoryItem[]) => InventoryItem[])(previous)
            : updater;
        const updatedAt = new Date().toISOString();
        markLocalDirty(updatedAt);
        localStorage.setItem(storageKey, JSON.stringify(resolved));
        return resolved;
      });
    });
  };
  const setLogsGuarded: React.Dispatch<React.SetStateAction<InventoryLog[]>> = updater => {
    if (!canWriteItemsAndLogs) {
      showToast('Modo consulta: sem permissão para registrar alterações.', 'info');
      return;
    }
    flushSync(() => {
      setLogs(previous => {
        const resolved =
          typeof updater === 'function'
            ? (updater as (prev: InventoryLog[]) => InventoryLog[])(previous)
            : updater;
        const updatedAt = new Date().toISOString();
        markLocalDirty(updatedAt);
        localStorage.setItem(logsStorageKey, JSON.stringify(resolved));
        return resolved;
      });
    });
  };
  const setSettingsGuarded: React.Dispatch<React.SetStateAction<InventorySettings>> = updater => {
    if (!canWriteSettings) {
      showToast('Modo consulta: sem permissão para alterar configurações.', 'info');
      return;
    }
    flushSync(() => {
      setSettings(previous => {
        const resolved =
          typeof updater === 'function'
            ? (updater as (prev: InventorySettings) => InventorySettings)(previous)
            : updater;
        const updatedAt = new Date().toISOString();
        markLocalDirty(updatedAt);
        localStorage.setItem(settingsStorageKey, JSON.stringify(resolved));
        return resolved;
      });
    });
  };
  const setRequestsGuarded: React.Dispatch<React.SetStateAction<MaterialRequest[]>> = updater => {
    if (!canCreateRequests && !canEditExistingRequests) {
      showToast('Modo consulta: sem permissão para alterar solicitações.', 'info');
      return;
    }
    flushSync(() => {
      setRequests(previous => {
        const resolved =
          typeof updater === 'function'
            ? (updater as (prev: MaterialRequest[]) => MaterialRequest[])(previous)
            : updater;
        const updatedAt = new Date().toISOString();
        markLocalDirty(updatedAt);
        localStorage.setItem(requestsStorageKey, JSON.stringify(resolved));
        return resolved;
      });
    });
  };
  const setVehiclesGuarded: React.Dispatch<React.SetStateAction<VehicleRecord[]>> = updater => {
    if (!canWriteVehicles) {
      showToast('Modo consulta: sem permissão para importar base de veículos.', 'info');
      return;
    }
    flushSync(() => {
      setVehicles(previous => {
        const resolved =
          typeof updater === 'function'
            ? (updater as (prev: VehicleRecord[]) => VehicleRecord[])(previous)
            : updater;
        const updatedAt = new Date().toISOString();
        markLocalDirty(updatedAt);
        localStorage.setItem(vehiclesStorageKey, JSON.stringify(resolved));
        return resolved;
      });
    });
  };
  const setOcrAliasesGuarded: React.Dispatch<React.SetStateAction<Record<string, string>>> = updater => {
    if (!canWriteItemsAndLogs) return;
    markLocalDirty(new Date().toISOString());
    setOcrAliases(updater);
  };

  useEffect(() => {
    const url = new URL(window.location.href);
    const shouldPurge = url.searchParams.get('purgeTests') === '1';
    if (!shouldPurge) return;

    url.searchParams.delete('purgeTests');
    window.history.replaceState(null, '', url);

    if (role !== 'admin') {
      showToast('Somente administradores podem limpar solicitações de teste.', 'info');
      return;
    }

    if (!requests.length) {
      showToast('Não há solicitações para limpar.', 'info');
      return;
    }

    const now = new Date().toISOString();
    setRequestsGuarded(previous =>
      previous.map(request =>
        String(request.code || '').toUpperCase().startsWith('SOL-')
          ? { ...request, deletedAt: now, updatedAt: now }
          : request
      )
    );
    setSelectedRequestId(current => {
      if (!current) return current;
      const candidate = requests.find(request => request.id === current) || null;
      if (!candidate) return null;
      return String(candidate.code || '').toUpperCase().startsWith('SOL-') ? null : current;
    });
    showToast('Solicitações de teste removidas.', 'success');
  }, [requests, role, setRequestsGuarded, showToast]);

  const syncUrl = (tab: string, sku: string | null, requestId: string | null, filter: string) => {
    const url = new URL(window.location.href);
    url.searchParams.delete('purgeTests');

    if (tab === 'dashboard') {
      url.searchParams.delete('tab');
    } else {
      url.searchParams.set('tab', tab);
    }

    if (sku) {
      url.searchParams.set('sku', sku);
    } else {
      url.searchParams.delete('sku');
    }

    if (requestId) {
      url.searchParams.set('request', requestId);
    } else {
      url.searchParams.delete('request');
    }

    if (filter) {
      url.searchParams.set('filter', filter);
    } else {
      url.searchParams.delete('filter');
    }

    window.history.replaceState(null, '', url);
  };

  const setActiveTab = (tab: string) => {
    const nextTab = tab === 'search' || tab === 'update' ? 'inventory' : tab;
    if (!validTabs.includes(nextTab)) return;

    setActiveTabState(nextTab);
    syncUrl(nextTab, selectedSku, selectedRequestId, inventoryFilter);
  };

  const handleSelectSku = (sku: string) => {
    setSelectedSku(sku);
    setActiveTabState('inventory');
    syncUrl('inventory', sku, selectedRequestId, inventoryFilter);
  };

  const handleOpenSeparation = (requestId: string) => {
    setSelectedRequestId(requestId);
    setActiveTabState('separation');
    syncUrl('separation', selectedSku, requestId, inventoryFilter);
  };

  const handleEditRequest = (requestId: string) => {
    flushSync(() => {
      setSelectedRequestId(null);
    });
    setSelectedRequestId(requestId);
    setActiveTabState('requests');
    syncUrl('requests', selectedSku, requestId, inventoryFilter);
  };

  const handleSelectRequest = (requestId: string | null) => {
    setSelectedRequestId(requestId);
    syncUrl(activeTab, selectedSku, requestId, inventoryFilter);
  };

  const handleOpenInventoryFilter = (filter: string) => {
    setInventoryFilter(filter);
    setActiveTabState('inventory');
    syncUrl('inventory', selectedSku, selectedRequestId, filter);
  };

  const handleInventoryFilterChange = (filter: string) => {
    setInventoryFilter(filter);
    syncUrl(activeTab, selectedSku, selectedRequestId, filter);
  };

  const handleOpenVehicleParts = (type?: string) => {
    setVehiclePartsPresetType(type ? normalizeUserFacingText(type) : '');
    setVehiclePartsPresetModel('');
    setVehiclePartsPresetVersion(previous => previous + 1);
    setActiveTabState('vehicle-parts');
    syncUrl('vehicle-parts', selectedSku, selectedRequestId, inventoryFilter);
  };

  if (!authSession) {
    return (
      <LoginScreen
        onLogin={session => setAuthSession(session)}
      />
    );
  }

  return (
    <>
      <Layout
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        items={items}
        settings={settings}
        requests={requests}
        onSelectSku={handleSelectSku}
        authRole={authSession.role}
        cloudStatus={cloudStatus}
        onLogout={() => {
          if (authSession.token) {
            void fetch('/api/auth?action=logout', {
              method: 'POST',
              headers: { authorization: `Bearer ${authSession.token}` }
            });
          }
          setAuthSession(null);
          setActiveTabState('dashboard');
          syncUrl('dashboard', null, null, '');
        }}
      >
        {activeTab === 'dashboard' && (
          <Dashboard
            items={items}
            settings={settings}
            requests={requests}
            authRole={role}
            onSelectSku={handleSelectSku}
            onOpenSeparation={handleOpenSeparation}
            onOpenRequest={handleEditRequest}
            onOpenInventoryFilter={handleOpenInventoryFilter}
          />
        )}

        {activeTab === 'vehicle-parts' && (
          <VehiclePartsBrowser
            items={items}
            onSelectSku={handleSelectSku}
            presetType={vehiclePartsPresetType}
            presetModel={vehiclePartsPresetModel}
            presetVersion={vehiclePartsPresetVersion}
          />
        )}

        {activeTab === 'preventive-kits' && (
          <PreventiveKits
            items={items}
            onSelectSku={handleSelectSku}
          />
        )}

        {activeTab === 'users' && (
          <UserManager
            token={authSession.token || ''}
            canManageUsers={canManageUsers}
            showToast={showToast}
            vehicles={vehicles}
            setVehicles={setVehiclesGuarded}
          />
        )}

        {activeTab === 'requests' && (
          <RequestManager
            items={items}
            requests={requests}
            vehicles={vehicles}
            setRequests={setRequestsGuarded}
            externalRequestId={selectedRequestId}
            canCreateRequests={canCreateRequests}
            canEditExistingRequests={canEditExistingRequests}
            canDeleteRequests={canDeleteRequests}
            canOpenSeparation={canOperateSeparation}
            auditActor={auditActor}
            showToast={showToast}
            onOpenSeparation={handleOpenSeparation}
            onSelectSku={handleSelectSku}
            onOpenPanel={() => setActiveTab('dashboard')}
            onOpenVehicleParts={handleOpenVehicleParts}
          />
        )}

        {activeTab === 'request-history' && (
          <RequestHistory
            requests={requests}
            logs={logs}
            items={items}
            setItems={setItemsGuarded}
            setLogs={setLogsGuarded}
            setRequests={setRequestsGuarded}
            settings={settings}
            auditActor={auditActor}
            canReverseRequests={canReverseRequests}
            onSelectSku={handleSelectSku}
            showToast={showToast}
          />
        )}

        {activeTab === 'separation' && (
          <MaterialSeparation
            items={items}
            setItems={setItemsGuarded}
            logs={logs}
            setLogs={setLogsGuarded}
            requests={requests}
            setRequests={setRequestsGuarded}
            canEdit={canOperateSeparation}
            canDeleteRequests={canEditExistingRequests}
            canReverseRequests={canReverseRequests}
            auditActor={auditActor}
            selectedRequestId={selectedRequestId}
            setSelectedRequestId={handleSelectRequest}
            onEditRequest={handleEditRequest}
            settings={settings}
            showToast={showToast}
            ocrAliases={ocrAliases}
            setOcrAliases={setOcrAliasesGuarded}
            onSelectSku={handleSelectSku}
          />
        )}

        {activeTab === 'inventory' && (
          <StockWorkspace
            showToast={showToast}
            canAdjustStock={canAdjustStock}
            canReceiveStock={canReceiveStock}
            items={items}
            setItems={setItemsGuarded}
            logs={logs}
            setLogs={setLogsGuarded}
            selectedSku={selectedSku}
            onSelectSku={handleSelectSku}
            settings={settings}
            ocrAliases={ocrAliases}
            setOcrAliases={setOcrAliasesGuarded}
            externalSearchQuery={inventoryFilter}
            onExternalSearchQueryChange={handleInventoryFilterChange}
          />
        )}

        {activeTab === 'inventory-operations' && (
          <InventoryOperation
            items={items}
            logs={logs}
            onSelectSku={handleSelectSku}
            showToast={showToast}
          />
        )}
      </Layout>

      {toast && (
        <div className="fixed bottom-24 md:bottom-10 left-1/2 -translate-x-1/2 z-[100] animate-in fade-in slide-in-from-bottom-5 duration-300">
          <div
            className={`flex items-center gap-3 px-6 py-4 rounded-xl shadow-lg text-white font-medium ${
              toast.type === 'success' ? 'bg-green-600' : 'bg-slate-800'
            }`}
          >
            {toast.type === 'success' ? <CheckCircle2 size={20} /> : <Info size={20} />}
            {toast.message}
          </div>
        </div>
      )}

      {mustChangePassword && (
        <div className="fixed inset-0 z-[120] bg-black/40 flex items-end sm:items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-surface-container-lowest border border-outline-variant/20 shadow-[0_18px_48px_rgba(36,52,69,0.22)] overflow-hidden">
            <div className="p-5 border-b border-outline-variant/15">
              <p className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">Primeiro acesso</p>
              <p className="mt-1 font-extrabold text-on-surface">Troque sua senha para continuar</p>
            </div>
            <div className="p-5 space-y-3">
              {passwordChangeError ? (
                <div className="text-sm font-semibold text-error">{passwordChangeError}</div>
              ) : null}
              <input
                value={passwordChangeSenha}
                onChange={event => setPasswordChangeSenha(event.target.value)}
                placeholder="Nova senha"
                className="w-full h-12 rounded-xl px-4 bg-surface-container-lowest border border-outline-variant/20 focus:ring-2 focus:ring-primary/40"
                type="password"
              />
              <input
                value={passwordChangeConfirm}
                onChange={event => setPasswordChangeConfirm(event.target.value)}
                placeholder="Confirmar senha"
                className="w-full h-12 rounded-xl px-4 bg-surface-container-lowest border border-outline-variant/20 focus:ring-2 focus:ring-primary/40"
                type="password"
              />
              <button
                type="button"
                onClick={() => void handleForcePasswordChange()}
                disabled={passwordChangeSaving}
                className="w-full h-12 rounded-xl bg-primary text-on-primary font-bold disabled:opacity-60"
              >
                {passwordChangeSaving ? 'Salvando...' : 'Salvar nova senha'}
              </button>
            </div>
          </div>
        </div>
      )}

    </>
  );
}
