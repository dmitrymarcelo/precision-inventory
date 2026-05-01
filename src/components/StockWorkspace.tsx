import React from 'react';
import StockUpdate from './StockUpdate';
import InventoryList from './InventoryList';
import { InventoryItem, InventoryLog, InventorySettings } from '../types';

interface StockWorkspaceProps {
  showToast: (message: string, type?: 'success' | 'info') => void;
  canAdjustStock: boolean;
  canReceiveStock: boolean;
  items: InventoryItem[];
  setItems: React.Dispatch<React.SetStateAction<InventoryItem[]>>;
  logs: InventoryLog[];
  setLogs: React.Dispatch<React.SetStateAction<InventoryLog[]>>;
  selectedSku: string | null;
  onSelectSku: (sku: string) => void;
  settings: InventorySettings;
  ocrAliases: Record<string, string>;
  setOcrAliases: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  externalSearchQuery?: string;
  onExternalSearchQueryChange?: (value: string) => void;
}

export default function StockWorkspace({
  showToast,
  canAdjustStock,
  canReceiveStock,
  items,
  setItems,
  logs,
  setLogs,
  selectedSku,
  onSelectSku,
  settings,
  ocrAliases,
  setOcrAliases,
  externalSearchQuery,
  onExternalSearchQueryChange
}: StockWorkspaceProps) {
  return (
    <div className="space-y-8">
      <StockUpdate
        showToast={showToast}
        canAdjustStock={canAdjustStock}
        canReceiveStock={canReceiveStock}
        items={items}
        setItems={setItems}
        logs={logs}
        setLogs={setLogs}
        selectedSku={selectedSku}
        settings={settings}
        ocrAliases={ocrAliases}
        setOcrAliases={setOcrAliases}
      />

      <InventoryList
        showToast={showToast}
        canEdit={canAdjustStock}
        items={items}
        setItems={setItems}
        onSelectSku={onSelectSku}
        settings={settings}
        externalSearchQuery={externalSearchQuery}
        onExternalSearchQueryChange={onExternalSearchQueryChange}
      />
    </div>
  );
}
