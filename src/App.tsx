/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Cloud, Info } from 'lucide-react';
import Layout from './components/Layout';
import Dashboard from './components/Dashboard';
import InventoryList from './components/InventoryList';
import StockUpdate from './components/StockUpdate';
import RequestManager from './components/RequestManager';
import MaterialSeparation from './components/MaterialSeparation';
import VehiclePartsBrowser from './components/VehiclePartsBrowser';
import PreventiveKits from './components/PreventiveKits';
import {
  InventoryItem,
  InventoryLog,
  InventorySettings,
  MaterialRequest,
  VehicleRecord
} from './types';
import { calculateItemStatus, defaultInventorySettings } from './inventoryRules';
import { loadCloudState, saveCloudState } from './cloudState';
import { sanitizeRequests } from './requestUtils';
import { sanitizeVehicles } from './vehicleBase';
import { classifyInventoryCategory } from './categoryCatalog';
import { getVehicleTypeFromModel, normalizeOfficialVehicleModel } from './vehicleCatalog';
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

const labelSampleItem = initialData.find(item => item.sku === '06682') as InventoryItem;
const storageKey = 'precisionInventory.react.items.v1';
const logsStorageKey = 'precisionInventory.react.logs.v1';
const settingsStorageKey = 'precisionInventory.react.settings.v1';
const requestsStorageKey = 'precisionInventory.react.requests.v1';
const vehiclesStorageKey = 'precisionInventory.react.vehicles.v1';
const validTabs = ['dashboard', 'update', 'vehicle-parts', 'preventive-kits', 'requests', 'separation', 'inventory'];

function getInitialTab() {
  const tab = new URLSearchParams(window.location.search).get('tab');
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
  const normalizedItems = items.map(normalizeInventoryItemRecord);
  const alreadyHasLabelSample = normalizedItems.some(item => item.sku === labelSampleItem.sku);
  if (!alreadyHasLabelSample && items.length <= 10) {
    return [...normalizedItems, normalizeInventoryItemRecord(labelSampleItem)];
  }
  return normalizedItems;
}

function normalizeInventoryItemRecord(item: InventoryItem): InventoryItem {
  const name = normalizeUserFacingText(item.name);
  const sourceCategory = normalizeUserFacingText(item.sourceCategory || item.category);
  const classified = classifyInventoryCategory(name, sourceCategory);
  const vehicleModel = normalizeOfficialVehicleModel(item.vehicleModel || '');

  return {
    ...item,
    name,
    vehicleModel,
    vehicleType: normalizeUserFacingText(item.vehicleType || getVehicleTypeFromModel(vehicleModel)),
    location: normalizeImportedLocation(item.location),
    category: classified.category,
    sourceCategory: classified.sourceCategory,
    status: normalizeInventoryStatus(item.status)
  };
}

function normalizeImportedLocation(location: string) {
  return normalizeLocationText(location);
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
      return storedLogs ? JSON.parse(storedLogs) : [];
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

  useEffect(() => {
    let cancelled = false;

    async function loadOnlineState() {
      try {
        const result = await loadCloudState();
        if (cancelled) return;

        if (result.state) {
          setCloudHasState(true);
          setItems(normalizeStoredItems(result.state.items));
          setLogs(Array.isArray(result.state.logs) ? result.state.logs : []);
          setSettings({ ...defaultInventorySettings, ...result.state.settings });
          setRequests(sanitizeRequests(result.state.requests));
          setVehicles(sanitizeVehicles(result.state.vehicles));
          setOcrAliases(
            result.state.ocrAliases && typeof result.state.ocrAliases === 'object'
              ? result.state.ocrAliases
              : {}
          );
        } else {
          setCloudHasState(false);
        }

        setCloudAvailable(true);
        setCloudStatus('online');
      } catch {
        if (!cancelled) {
          setCloudAvailable(false);
          setCloudStatus('offline');
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
    };
  }, []);

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
    if (!cloudLoaded || !cloudAvailable) return;

    const hasRealStateToSave =
      cloudHasState || items.length > initialData.length || logs.length > 0 || requests.length > 0 || vehicles.length > 0;

    if (!hasRealStateToSave) {
      setCloudStatus('online');
      return;
    }

    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }

    setCloudStatus('saving');
    saveTimerRef.current = window.setTimeout(() => {
      saveCloudState({ items, logs, settings, requests, vehicles, ocrAliases })
        .then(() => {
          setCloudHasState(true);
          setCloudStatus('online');
        })
        .catch(() => setCloudStatus('offline'));
    }, 600);

    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, [items, logs, settings, requests, vehicles, ocrAliases, cloudLoaded, cloudAvailable, cloudHasState]);

  const showToast = (message: string, type: 'success' | 'info' = 'info') => {
    setToast({ message, type });
    window.setTimeout(() => setToast(null), 3000);
  };

  const syncUrl = (tab: string, sku: string | null, requestId: string | null, filter: string) => {
    const url = new URL(window.location.href);

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
    const nextTab = tab === 'search' ? 'update' : tab;
    if (!validTabs.includes(nextTab)) return;

    setActiveTabState(nextTab);
    syncUrl(nextTab, selectedSku, selectedRequestId, inventoryFilter);
  };

  const handleSelectSku = (sku: string) => {
    setSelectedSku(sku);
    setActiveTabState('update');
    syncUrl('update', sku, selectedRequestId, inventoryFilter);
  };

  const handleOpenSeparation = (requestId: string) => {
    setSelectedRequestId(requestId);
    setActiveTabState('separation');
    syncUrl('separation', selectedSku, requestId, inventoryFilter);
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

  return (
    <>
      <Layout
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        items={items}
        settings={settings}
        requests={requests}
        onSelectSku={handleSelectSku}
      >
        {activeTab === 'dashboard' && (
          <Dashboard
            setActiveTab={setActiveTab}
            items={items}
            settings={settings}
            requests={requests}
            vehicles={vehicles}
            setVehicles={setVehicles}
            showToast={showToast}
            onSelectSku={handleSelectSku}
            onOpenSeparation={handleOpenSeparation}
            onOpenInventoryFilter={handleOpenInventoryFilter}
          />
        )}

        {activeTab === 'update' && (
          <StockUpdate
            setActiveTab={setActiveTab}
            showToast={showToast}
            items={items}
            setItems={setItems}
            logs={logs}
            setLogs={setLogs}
            selectedSku={selectedSku}
            settings={settings}
            vehicles={vehicles}
            ocrAliases={ocrAliases}
            setOcrAliases={setOcrAliases}
          />
        )}

        {activeTab === 'vehicle-parts' && (
          <VehiclePartsBrowser
            items={items}
            onSelectSku={handleSelectSku}
          />
        )}

        {activeTab === 'preventive-kits' && (
          <PreventiveKits
            items={items}
            onSelectSku={handleSelectSku}
          />
        )}

        {activeTab === 'requests' && (
          <RequestManager
            items={items}
            requests={requests}
            vehicles={vehicles}
            setRequests={setRequests}
            showToast={showToast}
            onOpenSeparation={handleOpenSeparation}
            onSelectSku={handleSelectSku}
            onOpenPanel={() => setActiveTab('dashboard')}
          />
        )}

        {activeTab === 'separation' && (
          <MaterialSeparation
            items={items}
            setItems={setItems}
            logs={logs}
            setLogs={setLogs}
            requests={requests}
            setRequests={setRequests}
            selectedRequestId={selectedRequestId}
            setSelectedRequestId={handleSelectRequest}
            settings={settings}
            showToast={showToast}
            ocrAliases={ocrAliases}
            setOcrAliases={setOcrAliases}
            onSelectSku={handleSelectSku}
          />
        )}

        {activeTab === 'inventory' && (
          <InventoryList
            setActiveTab={setActiveTab}
            showToast={showToast}
            items={items}
            setItems={setItems}
            onSelectSku={handleSelectSku}
            settings={settings}
            externalSearchQuery={inventoryFilter}
            onExternalSearchQueryChange={handleInventoryFilterChange}
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

      <div
        className={`fixed right-4 bottom-4 z-[90] hidden md:flex items-center gap-2 px-3 py-2 rounded-lg shadow-sm text-xs font-bold ${
          cloudStatus === 'online'
            ? 'bg-primary-container text-on-primary-container'
            : cloudStatus === 'saving' || cloudStatus === 'loading'
              ? 'bg-surface-container-highest text-on-surface-variant'
              : 'bg-error-container text-on-error-container'
        }`}
      >
        <Cloud size={16} />
        {cloudStatus === 'online' && 'Salvo online'}
        {cloudStatus === 'saving' && 'Salvando online'}
        {cloudStatus === 'loading' && 'Conectando'}
        {cloudStatus === 'offline' && 'Modo local'}
      </div>
    </>
  );
}
