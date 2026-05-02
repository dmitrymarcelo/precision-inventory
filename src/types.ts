export type InventoryStatus =
  | 'Estoque Crítico'
  | 'Repor em Breve'
  | 'Estoque Saudável';

export interface InventoryItem {
  sku: string;
  name: string;
  quantity: number;
  isActiveInWarehouse?: boolean;
  updatedAt?: string;
  category: string;
  sourceCategory?: string;
  imageUrl?: string;
  imageHint?: string;
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
  source?: 'ajuste' | 'recebimento' | 'solicitacao' | 'divergencia';
  referenceCode?: string;
  expectedQuantityAfter?: number;
  reportedQuantityAfter?: number;
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
  | 'Atendida'
  | 'Estornada';

export type MaterialRequestAuditActor = {
  id?: string;
  matricula?: string;
  name?: string;
  role?: string;
};

export type MaterialRequestAuditEvent =
  | 'request_created'
  | 'request_updated'
  | 'separation_updated'
  | 'separation_fulfilled'
  | 'separation_reversed';

export type MaterialRequestAuditEntry = {
  id: string;
  at: string;
  event: MaterialRequestAuditEvent;
  actor: MaterialRequestAuditActor;
  detail?: string;
};

export type MaterialRequestItem = {
  id: string;
  sku: string;
  itemName: string;
  location: string;
  category: string;
  requestedQuantity: number;
  separatedQuantity: number;
};

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
  reversedAt?: string;
  deletedAt?: string;
  auditTrail?: MaterialRequestAuditEntry[];
  items: MaterialRequestItem[];
}

export type PurchaseRequestStatus =
  | 'Sugestao'
  | 'Manual'
  | 'Em analise'
  | 'Aprovada'
  | 'Comprada'
  | 'Recebida parcial'
  | 'Recebida total'
  | 'Cancelada';

export type PurchaseQuotationStatus = 'Pendente' | 'Recebida' | 'Recusada';

export interface PurchaseQuotation {
  id: string;
  supplierName: string;
  contactInfo?: string;
  quoteNumber?: string;
  quotedAt: string;
  validUntil?: string;
  unitPrice: number;
  freightCost?: number;
  deliveryDays?: number;
  paymentTerms?: string;
  technicalScore?: number;
  notes?: string;
  status: PurchaseQuotationStatus;
  isSelected?: boolean;
  sourceFileName?: string;
  sourceFileImportedAt?: string;
  linkedItems?: PurchaseQuotationLinkedItem[];
}

export interface PurchaseQuotationLinkedItem {
  id: string;
  purchaseId?: string;
  sku: string;
  itemName: string;
  purchaseType?: string;
  classification?: string;
  quantity?: number;
  unitPrice?: number;
  totalPrice?: number;
  lineText?: string;
  matchConfidence: 'alta' | 'media' | 'manual';
  selected: boolean;
}

export interface PurchaseRequest {
  id: string;
  sku: string;
  itemName: string;
  status: PurchaseRequestStatus;
  source: 'alerta-critico' | 'reposicao' | 'manual' | 'kit-preventiva';
  suggestedQuantity: number;
  approvedQuantity?: number;
  receivedQuantity?: number;
  reason: string;
  manualBatchId?: string;
  vehiclePlate?: string;
  costCenter?: string;
  vehicleDescription?: string;
  vehicleDetails?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  approvedBy?: string;
  quotations?: PurchaseQuotation[];
  selectedQuotationId?: string;
  quotationDecisionNote?: string;
  cancelledReason?: string;
}
