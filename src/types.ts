export type InventoryStatus =
  | 'Estoque Crítico'
  | 'Repor em Breve'
  | 'Estoque Saudável';

export interface InventoryItem {
  sku: string;
  name: string;
  quantity: number;
  category: string;
  sourceCategory?: string;
  vehicleModel?: string;
  vehicleType?: string;
  location: string;
  status: InventoryStatus;
  alertCriticalLimit?: number;
  alertReorderLimit?: number;
}

export interface InventoryLog {
  id: string;
  sku: string;
  itemName: string;
  previousQuantity: number;
  delta: number;
  quantityAfter: number;
  location: string;
  date: string;
  source?: 'ajuste' | 'solicitacao';
  referenceCode?: string;
}

export interface InventorySettings {
  criticalLimit: number;
  reorderLimit: number;
}

export interface VehicleRecord {
  id: string;
  plate: string;
  costCenter: string;
  description?: string;
  details: Record<string, string>;
}

export type RequestPriority = 'Baixa' | 'Normal' | 'Alta' | 'Urgente';

export type MaterialRequestStatus =
  | 'Aberta'
  | 'Em separação'
  | 'Separada'
  | 'Atendida';

export interface MaterialRequestItem {
  id: string;
  sku: string;
  itemName: string;
  location: string;
  category: string;
  requestedQuantity: number;
  separatedQuantity: number;
}

export interface MaterialRequest {
  id: string;
  code: string;
  vehiclePlate: string;
  costCenter: string;
  vehicleDescription?: string;
  vehicleDetails?: Record<string, string>;
  requester: string;
  sector: string;
  destination: string;
  notes: string;
  priority: RequestPriority;
  status: MaterialRequestStatus;
  createdAt: string;
  updatedAt: string;
  fulfilledAt?: string;
  items: MaterialRequestItem[];
}
