import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ClipboardCheck,
  Clock,
  FileText,
  Link2,
  Package,
  Plus,
  Printer,
  Search,
  ShoppingCart,
  Upload,
  X
} from 'lucide-react';
import {
  InventoryItem,
  InventoryLog,
  InventorySettings,
  PurchaseQuotation,
  PurchaseQuotationLinkedItem,
  PurchaseRequest,
  PurchaseRequestStatus
} from '../types';
import { calculateItemStatus, getItemAlertSettings } from '../inventoryRules';
import { getAbcAnalysisForSku, getAdaptiveAbcStockPolicy } from '../abcAnalysis';
import { normalizeUserFacingText } from '../textUtils';
import { getVehicleTypeFromModel, normalizeOperationalVehicleType } from '../vehicleCatalog';

interface AutomaticPurchasesProps {
  items: InventoryItem[];
  logs: InventoryLog[];
  settings: InventorySettings;
  purchases: PurchaseRequest[];
  setPurchases: React.Dispatch<React.SetStateAction<PurchaseRequest[]>>;
  canManagePurchases: boolean;
  showToast: (message: string, type?: 'success' | 'info') => void;
  onSelectSku: (sku: string) => void;
}

type PurchaseTab = 'fila' | 'manuais' | 'aguardando';
type PurchaseClassification = 'critico' | 'reposicao' | 'manual' | 'kit-preventiva';

type PurchasePackageGroup = {
  key: string;
  type: string;
  classification: PurchaseClassification;
  label: string;
  description: string;
  badgeClassName: string;
  items: PurchaseRequest[];
  totalSuggested: number;
};

type QuotationFormRow = {
  id: string;
  supplierName: string;
  contactInfo: string;
  quoteNumber: string;
  quotedAt: string;
  validUntil: string;
  unitPrice: string;
  freightCost: string;
  deliveryDays: string;
  paymentTerms: string;
  technicalScore: string;
  notes: string;
  status: PurchaseQuotation['status'];
  isSelected: boolean;
  sourceFileName: string;
  sourceFileImportedAt: string;
  linkedItems: PurchaseQuotationLinkedItem[];
};

const ACTIVE_PURCHASE_STATUSES = new Set<PurchaseRequestStatus>([
  'Sugestao',
  'Manual',
  'Em analise',
  'Aprovada',
  'Comprada',
  'Recebida parcial'
]);

const REVIEWABLE_PURCHASE_STATUSES = new Set<PurchaseRequestStatus>(['Sugestao', 'Manual', 'Em analise']);
const WAITING_PURCHASE_STATUSES = new Set<PurchaseRequestStatus>(['Aprovada', 'Comprada', 'Recebida parcial']);
const AUTOMATIC_QUEUE_STATUSES = new Set<PurchaseRequestStatus>(['Sugestao', 'Em analise']);

function normalizeSku(value: unknown) {
  return String(value || '').trim();
}

function getSkuCandidates(value: unknown) {
  const raw = normalizeSku(value);
  const digits = raw.replace(/\D/g, '');
  const candidates = new Set<string>();
  if (raw) candidates.add(raw);
  if (digits) {
    candidates.add(digits);
    candidates.add(digits.padStart(5, '0'));
    candidates.add(digits.replace(/^0+/, '') || '0');
  }
  return candidates;
}

function findItemBySku(items: InventoryItem[], sku: string) {
  const candidates = getSkuCandidates(sku);
  return items.find(item => {
    const itemCandidates = getSkuCandidates(item.sku);
    for (const candidate of itemCandidates) {
      if (candidates.has(candidate)) return true;
    }
    return false;
  });
}

function normalizePurchaseType(value: unknown) {
  const text = normalizeUserFacingText(value);
  if (!text) return '';

  const comparable = text
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (comparable === 'VW') return 'SAVEIRO/GOL';
  if (comparable === 'CHEVROLET' || comparable === 'S10') return 'S-10';
  if (comparable === 'OLEO' || comparable === 'OLEOS') return 'OLEO';

  return normalizeOperationalVehicleType(text) || text;
}

function getEffectivePurchaseType(item: InventoryItem | undefined) {
  if (!item) return 'Sem tipo vinculado';

  return (
    normalizePurchaseType(item.vehicleType) ||
    normalizePurchaseType(getVehicleTypeFromModel(item.vehicleModel || '')) ||
    'Sem tipo vinculado'
  );
}

function getPurchaseClassification(purchase: PurchaseRequest): PurchaseClassification {
  if (purchase.source === 'alerta-critico') return 'critico';
  if (purchase.source === 'reposicao') return 'reposicao';
  if (purchase.source === 'kit-preventiva') return 'kit-preventiva';
  return 'manual';
}

function getPurchaseClassificationMeta(classification: PurchaseClassification) {
  if (classification === 'critico') {
    return {
      label: 'Crítico',
      description: 'Pacote urgente: item abaixo do mínimo calculado.',
      badgeClassName: 'bg-error-container text-on-error-container',
      priority: 0
    };
  }

  if (classification === 'reposicao') {
    return {
      label: 'Repor',
      description: 'Pacote de reposição: item abaixo do máximo recomendado.',
      badgeClassName: 'bg-tertiary-container text-on-tertiary-container',
      priority: 1
    };
  }

  if (classification === 'kit-preventiva') {
    return {
      label: 'Kit preventiva',
      description: 'Pacote vinculado a necessidade de kit preventivo.',
      badgeClassName: 'bg-primary-container text-on-primary-container',
      priority: 2
    };
  }

  return {
    label: 'Manual',
    description: 'Pacote criado pela equipe para compra manual.',
    badgeClassName: 'bg-secondary-container text-on-secondary-container',
    priority: 3
  };
}

function getMatchConfidenceLabel(value: PurchaseQuotationLinkedItem['matchConfidence']) {
  if (value === 'alta') return 'Reconhecido automaticamente';
  if (value === 'media') return 'Possível correspondência';
  return 'Selecionado manualmente';
}

function getTodayInputDate() {
  return new Date().toISOString().slice(0, 10);
}

function createEmptyQuotationRow(index: number): QuotationFormRow {
  return {
    id: `cot-${Date.now()}-${index}`,
    supplierName: '',
    contactInfo: '',
    quoteNumber: '',
    quotedAt: getTodayInputDate(),
    validUntil: '',
    unitPrice: '',
    freightCost: '',
    deliveryDays: '',
    paymentTerms: '',
    technicalScore: '3',
    notes: '',
    status: 'Recebida',
    isSelected: false,
    sourceFileName: '',
    sourceFileImportedAt: '',
    linkedItems: []
  };
}

function quotationToFormRow(quotation: PurchaseQuotation): QuotationFormRow {
  return {
    id: quotation.id,
    supplierName: quotation.supplierName || '',
    contactInfo: quotation.contactInfo || '',
    quoteNumber: quotation.quoteNumber || '',
    quotedAt: quotation.quotedAt?.slice(0, 10) || getTodayInputDate(),
    validUntil: quotation.validUntil?.slice(0, 10) || '',
    unitPrice: Number.isFinite(quotation.unitPrice) ? String(quotation.unitPrice) : '',
    freightCost: Number.isFinite(quotation.freightCost) ? String(quotation.freightCost) : '',
    deliveryDays: Number.isFinite(quotation.deliveryDays) ? String(quotation.deliveryDays) : '',
    paymentTerms: quotation.paymentTerms || '',
    technicalScore: Number.isFinite(quotation.technicalScore) ? String(quotation.technicalScore) : '3',
    notes: quotation.notes || '',
    status: quotation.status || 'Recebida',
    isSelected: quotation.isSelected === true,
    sourceFileName: quotation.sourceFileName || '',
    sourceFileImportedAt: quotation.sourceFileImportedAt || '',
    linkedItems: quotation.linkedItems || []
  };
}

function buildInitialQuotationRows(purchase: PurchaseRequest | null) {
  const rows = (purchase?.quotations || []).map(quotationToFormRow);
  while (rows.length < 3) {
    rows.push(createEmptyQuotationRow(rows.length + 1));
  }
  return rows;
}

function parsePositiveNumber(value: string) {
  const normalized = String(value || '').replace(',', '.');
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function parseOptionalPositiveNumber(value: string) {
  const parsed = parsePositiveNumber(value);
  return parsed > 0 ? parsed : undefined;
}

function clampScore(value: string) {
  const parsed = Number.parseFloat(String(value || '').replace(',', '.'));
  if (!Number.isFinite(parsed)) return 3;
  return Math.min(5, Math.max(1, parsed));
}

function isCompleteQuotationRow(row: QuotationFormRow) {
  return (
    row.status === 'Recebida' &&
    normalizeUserFacingText(row.supplierName).length > 0 &&
    parsePositiveNumber(row.unitPrice) > 0
  );
}

function getQuotationTotalFromRow(row: QuotationFormRow) {
  return parsePositiveNumber(row.unitPrice) + parsePositiveNumber(row.freightCost);
}

function getQuotationTotal(quotation: PurchaseQuotation) {
  return (Number(quotation.unitPrice) || 0) + (Number(quotation.freightCost) || 0);
}

function buildQuotationPayload(
  row: QuotationFormRow,
  isSelected: boolean,
  linkedItems: PurchaseQuotationLinkedItem[],
  options?: { id?: string; unitPrice?: number; notesSuffix?: string }
): PurchaseQuotation {
  const baseNotes = normalizeUserFacingText(row.notes);
  const notes = [baseNotes, options?.notesSuffix].filter(Boolean).join(' | ');

  return {
    id: options?.id || row.id,
    supplierName: normalizeUserFacingText(row.supplierName),
    contactInfo: normalizeUserFacingText(row.contactInfo) || undefined,
    quoteNumber: normalizeUserFacingText(row.quoteNumber) || undefined,
    quotedAt: row.quotedAt ? new Date(`${row.quotedAt}T12:00:00`).toISOString() : new Date().toISOString(),
    validUntil: row.validUntil ? new Date(`${row.validUntil}T12:00:00`).toISOString() : undefined,
    unitPrice: options?.unitPrice ?? parsePositiveNumber(row.unitPrice),
    freightCost: parseOptionalPositiveNumber(row.freightCost),
    deliveryDays: parseOptionalPositiveNumber(row.deliveryDays),
    paymentTerms: normalizeUserFacingText(row.paymentTerms) || undefined,
    technicalScore: clampScore(row.technicalScore),
    notes: notes || undefined,
    status: row.status,
    isSelected,
    sourceFileName: row.sourceFileName || undefined,
    sourceFileImportedAt: row.sourceFileImportedAt || undefined,
    linkedItems
  };
}

function countCompleteQuotationRows(rows: QuotationFormRow[]) {
  return rows.filter(isCompleteQuotationRow).length;
}

function hasMinimumQuotations(purchase: PurchaseRequest) {
  return (
    (purchase.quotations || []).filter(
      quotation => quotation.status === 'Recebida' && quotation.supplierName && quotation.unitPrice > 0
    ).length >= 3
  );
}

function getSelectedQuotation(purchase: PurchaseRequest) {
  return (purchase.quotations || []).find(quotation => quotation.id === purchase.selectedQuotationId || quotation.isSelected);
}

function calculateQuotationScore(row: QuotationFormRow, completeRows: QuotationFormRow[]) {
  if (!isCompleteQuotationRow(row)) return 0;

  const lowestTotal = Math.min(...completeRows.map(getQuotationTotalFromRow));
  const shortestDelivery = Math.min(
    ...completeRows.map(candidate => parsePositiveNumber(candidate.deliveryDays)).filter(days => days > 0)
  );
  const total = getQuotationTotalFromRow(row);
  const deliveryDays = parsePositiveNumber(row.deliveryDays);
  const priceScore = total > 0 && lowestTotal > 0 ? Math.min(5, (lowestTotal / total) * 5) : 3;
  const deliveryScore =
    deliveryDays > 0 && Number.isFinite(shortestDelivery) && shortestDelivery > 0
      ? Math.min(5, (shortestDelivery / deliveryDays) * 5)
      : 3;
  const technicalScore = clampScore(row.technicalScore);

  return priceScore * 0.45 + technicalScore * 0.35 + deliveryScore * 0.2;
}

function getBestQuotationRow(rows: QuotationFormRow[]) {
  const completeRows = rows.filter(isCompleteQuotationRow);
  if (completeRows.length === 0) return null;

  return completeRows
    .map(row => ({ row, score: calculateQuotationScore(row, completeRows), total: getQuotationTotalFromRow(row) }))
    .sort((first, second) => {
      if (second.score !== first.score) return second.score - first.score;
      return first.total - second.total;
    })[0]?.row || null;
}

async function extractPdfTextFromFile(file: File) {
  const [pdfjsLib, pdfWorker] = await Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.mjs?url')
  ]);

  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker.default;
  const data = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjsLib.getDocument({ data });
  const pdf = await loadingTask.promise;
  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageText = content.items
      .map(item => ('str' in item ? String(item.str) : ''))
      .filter(Boolean)
      .join(' ');
    pages.push(pageText);
  }

  return normalizeUserFacingText(pages.join('\n'));
}

function normalizeSearchText(value: unknown) {
  return normalizeUserFacingText(value)
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildLinkedQuotationId(row: QuotationFormRow, purchaseId: string) {
  const basis = normalizeSearchText(`${purchaseId} ${row.sourceFileName || ''} ${row.quoteNumber || ''} ${row.supplierName || row.id}`)
    .replace(/\s+/g, '-')
    .slice(0, 96);
  return `pdf-${basis || purchaseId}`;
}

function getQuotationPrintGroupKey(row: QuotationFormRow) {
  const sourceFileKey = normalizeSearchText(row.sourceFileName || '');
  const quoteNumberKey = normalizeSearchText(row.quoteNumber || '');
  const supplierKey = normalizeSearchText(row.supplierName || '');

  if (sourceFileKey || quoteNumberKey || supplierKey) {
    return [sourceFileKey, quoteNumberKey, supplierKey].filter(Boolean).join('|');
  }

  return row.id;
}

function createQuotationBudgetItem(
  purchase: PurchaseRequest,
  items: InventoryItem[],
  options?: {
    quantity?: number;
    unitPrice?: number;
    matchConfidence?: PurchaseQuotationLinkedItem['matchConfidence'];
  }
): PurchaseQuotationLinkedItem {
  const item = findItemBySku(items, purchase.sku);
  const quantity = options?.quantity ?? purchase.suggestedQuantity;
  const unitPrice = options?.unitPrice;

  return {
    id: `budget-${purchase.id}`,
    purchaseId: purchase.id,
    sku: purchase.sku,
    itemName: normalizeUserFacingText(purchase.itemName),
    purchaseType: getEffectivePurchaseType(item),
    classification: getPurchaseClassificationMeta(getPurchaseClassification(purchase)).label,
    quantity,
    unitPrice,
    totalPrice: unitPrice && quantity ? unitPrice * quantity : undefined,
    matchConfidence: options?.matchConfidence || 'manual',
    selected: true
  };
}

function mergeQuotationBudgetItems(items: PurchaseQuotationLinkedItem[]) {
  return items.reduce<PurchaseQuotationLinkedItem[]>((merged, item) => {
    const existingIndex = merged.findIndex(
      current => current.purchaseId === item.purchaseId || current.sku === item.sku
    );

    if (existingIndex < 0) {
      merged.push(item);
      return merged;
    }

    const existing = merged[existingIndex];
    merged[existingIndex] = {
      ...existing,
      ...item,
      quantity: item.quantity ?? existing.quantity,
      unitPrice: item.unitPrice ?? existing.unitPrice,
      totalPrice: item.totalPrice ?? existing.totalPrice,
      selected: true
    };
    return merged;
  }, []);
}

function findPurchaseForLinkedItem(linkedItem: PurchaseQuotationLinkedItem, purchases: PurchaseRequest[]) {
  if (linkedItem.purchaseId) {
    const byId = purchases.find(purchase => purchase.id === linkedItem.purchaseId);
    if (byId) return byId;
  }

  const linkedCandidates = getSkuCandidates(linkedItem.sku);
  return purchases.find(purchase => {
    const purchaseCandidates = getSkuCandidates(purchase.sku);
    for (const candidate of linkedCandidates) {
      if (purchaseCandidates.has(candidate)) return true;
    }
    return false;
  });
}

function getMatchedQuotationForLinkedItem(referenceRow: QuotationFormRow, targetPurchase: PurchaseRequest) {
  const quotations = (targetPurchase.quotations || []).filter(quotation => Number(quotation.unitPrice) > 0);
  if (quotations.length === 0) return undefined;

  const referenceFile = normalizeSearchText(referenceRow.sourceFileName || '');
  const referenceQuote = normalizeSearchText(referenceRow.quoteNumber || '');
  const referenceSupplier = normalizeSearchText(referenceRow.supplierName || '');

  return quotations
    .map((quotation, index) => {
      const quotationFile = normalizeSearchText(quotation.sourceFileName || '');
      const quotationNumber = normalizeSearchText(quotation.quoteNumber || '');
      const quotationSupplier = normalizeSearchText(quotation.supplierName || '');
      let score = 0;

      if (referenceFile && referenceFile === quotationFile) score += 30;
      if (referenceQuote && referenceQuote === quotationNumber) score += 25;
      if (referenceSupplier && referenceSupplier === quotationSupplier) score += 20;
      if (quotation.id === targetPurchase.selectedQuotationId || quotation.isSelected) score += 10;
      if (quotation.status === 'Recebida') score += 5;

      return { quotation, score, index };
    })
    .sort((first, second) => second.score - first.score || first.index - second.index)[0]?.quotation;
}

function enrichLinkedQuotationItem(
  linkedItem: PurchaseQuotationLinkedItem,
  referenceRow: QuotationFormRow,
  purchases: PurchaseRequest[],
  items: InventoryItem[]
): PurchaseQuotationLinkedItem {
  const targetPurchase = findPurchaseForLinkedItem(linkedItem, purchases);
  if (!targetPurchase) return linkedItem;

  const item = findItemBySku(items, targetPurchase.sku);
  const matchedQuotation = getMatchedQuotationForLinkedItem(referenceRow, targetPurchase);
  const quantity = linkedItem.quantity ?? targetPurchase.suggestedQuantity;
  const unitPrice = linkedItem.unitPrice ?? matchedQuotation?.unitPrice;
  const totalPrice = linkedItem.totalPrice ?? (unitPrice && quantity ? unitPrice * quantity : undefined);

  return {
    ...linkedItem,
    purchaseId: targetPurchase.id,
    sku: targetPurchase.sku,
    itemName: normalizeUserFacingText(linkedItem.itemName || targetPurchase.itemName),
    purchaseType: linkedItem.purchaseType || getEffectivePurchaseType(item),
    classification: linkedItem.classification || getPurchaseClassificationMeta(getPurchaseClassification(targetPurchase)).label,
    quantity,
    unitPrice,
    totalPrice
  };
}

function buildQuotationBudgetItems(
  row: QuotationFormRow,
  currentPurchase: PurchaseRequest,
  items: InventoryItem[],
  purchases: PurchaseRequest[]
) {
  const currentUnitPrice = parsePositiveNumber(row.unitPrice) || undefined;
  const currentItem = createQuotationBudgetItem(currentPurchase, items, {
    unitPrice: currentUnitPrice,
    matchConfidence: 'manual'
  });

  return mergeQuotationBudgetItems([
    currentItem,
    ...row.linkedItems
      .filter(item => item.selected)
      .map(item => enrichLinkedQuotationItem(item, row, purchases, items))
  ]);
}

function upsertQuotation(quotations: PurchaseQuotation[], quotation: PurchaseQuotation) {
  const existingIndex = quotations.findIndex(existing => {
    if (existing.id === quotation.id) return true;
    if (!existing.sourceFileName || !quotation.sourceFileName) return false;

    const sameFile = existing.sourceFileName === quotation.sourceFileName;
    const sameQuote = (existing.quoteNumber || '') === (quotation.quoteNumber || '');
    const sameSupplier = normalizeSearchText(existing.supplierName) === normalizeSearchText(quotation.supplierName);
    return sameFile && sameQuote && sameSupplier;
  });

  if (existingIndex < 0) return [...quotations, quotation];

  return quotations.map((existing, index) =>
    index === existingIndex
      ? {
          ...existing,
          ...quotation,
          id: existing.id
        }
      : existing
  );
}

function parseBrazilianMoney(value: string) {
  const raw = String(value || '').replace(/[^\d,.-]/g, '');
  if (!raw) return 0;

  const hasComma = raw.includes(',');
  const normalized = hasComma ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, '');
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function extractMoneyValues(text: string) {
  const matches = Array.from(
    text.matchAll(/(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2}|\d{1,7},\d{2}|\d{1,7}\.\d{2})/g)
  );

  return matches
    .map(match => parseBrazilianMoney(match[1]))
    .filter(value => value > 0 && value < 100000000);
}

function extractFirstDate(text: string) {
  const match = text.match(/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
  if (!match) return '';

  const day = match[1].padStart(2, '0');
  const month = match[2].padStart(2, '0');
  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  return `${year}-${month}-${day}`;
}

function extractDateByLabel(lines: string[], labels: string[]) {
  const normalizedLabels = labels.map(normalizeSearchText);
  const line = lines.find(candidate => {
    const normalized = normalizeSearchText(candidate);
    return normalizedLabels.some(label => normalized.includes(label)) && extractFirstDate(candidate);
  });
  return line ? extractFirstDate(line) : '';
}

function extractQuoteNumber(lines: string[]) {
  const joined = lines.join(' ');
  const match = joined.match(/(?:cotacao|cotação|orcamento|orçamento|proposta|pedido|n[ºo.]?)\s*(?:n[ºo.]?)?\s*[:#-]?\s*([A-Z0-9./-]{3,})/i);
  return match ? match[1].trim() : '';
}

function extractContact(lines: string[]) {
  const email = lines.join(' ').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
  const phone = lines.join(' ').match(/(?:\(?\d{2}\)?\s*)?(?:9\s*)?\d{4}[-.\s]?\d{4}/)?.[0];
  return [email, phone].filter(Boolean).join(' | ');
}

function extractSupplierName(lines: string[]) {
  const ignored = ['COTACAO', 'COTAÇÃO', 'ORCAMENTO', 'ORÇAMENTO', 'PROPOSTA', 'PEDIDO', 'DATA', 'VALIDADE', 'CNPJ', 'CPF'];
  const candidate = lines.find(line => {
    const normalized = normalizeSearchText(line);
    return normalized.length >= 4 && normalized.length <= 80 && !ignored.some(word => normalized.includes(word));
  });

  return candidate ? normalizeUserFacingText(candidate) : '';
}

function extractDeliveryDays(lines: string[]) {
  const line = lines.find(candidate => /prazo|entrega|dispon/i.test(candidate));
  const match = line?.match(/(\d{1,3})\s*(?:dia|dias|d\.?u\.?)/i);
  return match ? match[1] : '';
}

function extractPaymentTerms(lines: string[]) {
  const line = lines.find(candidate => /pagamento|condi[cç][aã]o|boleto|pix|cart[aã]o|avista|à vista/i.test(candidate));
  return line ? normalizeUserFacingText(line).slice(0, 120) : '';
}

function getSignificantWords(value: unknown) {
  return normalizeSearchText(value)
    .split(' ')
    .filter(word => word.length >= 4 && !['PARA', 'COM', 'SEM', 'UNIDADE', 'UNIDADES'].includes(word))
    .slice(0, 6);
}

function findBestLineForPurchase(lines: string[], purchase: PurchaseRequest) {
  const skuCandidates = Array.from(getSkuCandidates(purchase.sku)).map(normalizeSearchText).filter(Boolean);
  const bySku = lines.find(line => {
    const normalized = normalizeSearchText(line);
    return skuCandidates.some(candidate => normalized.includes(candidate));
  });
  if (bySku) return { line: bySku, confidence: 'alta' as const };

  const words = getSignificantWords(purchase.itemName);
  const byName = lines.find(line => {
    const normalized = normalizeSearchText(line);
    const matches = words.filter(word => normalized.includes(word)).length;
    return matches >= Math.min(2, words.length);
  });

  return byName ? { line: byName, confidence: 'media' as const } : null;
}

function extractQuantityFromLine(line: string) {
  const unitMatch = line.match(/(?:^|\s)(\d{1,5})(?:[,.]\d+)?\s*(?:UN|UND|UNID|PC|P[ÇC]A|LT|L|KG)\b/i);
  if (unitMatch) return Number.parseInt(unitMatch[1], 10);

  const firstNumber = line.match(/(?:^|\s)(\d{1,5})(?:\s+)/);
  return firstNumber ? Number.parseInt(firstNumber[1], 10) : undefined;
}

function detectQuotationLinkedItems(
  text: string,
  purchases: PurchaseRequest[],
  items: InventoryItem[],
  currentPurchase: PurchaseRequest
) {
  const lines = text.split(/\n| {2,}/).map(line => normalizeUserFacingText(line)).filter(line => line.length > 3);
  const candidates = [currentPurchase, ...purchases.filter(purchase => purchase.id !== currentPurchase.id)];
  const linked: PurchaseQuotationLinkedItem[] = [];
  const seen = new Set<string>();

  for (const purchase of candidates) {
    const match = findBestLineForPurchase(lines, purchase);
    if (!match || seen.has(purchase.id)) continue;

    const item = findItemBySku(items, purchase.sku);
    const moneyValues = extractMoneyValues(match.line);
    const unitPrice = moneyValues.length ? moneyValues[moneyValues.length - 1] : undefined;
    const quantity = extractQuantityFromLine(match.line);
    const classification = getPurchaseClassificationMeta(getPurchaseClassification(purchase)).label;

    linked.push({
      id: `link-${purchase.id}-${Date.now()}-${linked.length}`,
      purchaseId: purchase.id,
      sku: purchase.sku,
      itemName: normalizeUserFacingText(purchase.itemName),
      purchaseType: getEffectivePurchaseType(item),
      classification,
      quantity,
      unitPrice,
      totalPrice: unitPrice && quantity ? unitPrice * quantity : undefined,
      lineText: match.line.slice(0, 240),
      matchConfidence: match.confidence,
      selected: true
    });
    seen.add(purchase.id);
  }

  return linked;
}

function parseQuotationPdfText(
  text: string,
  file: File,
  row: QuotationFormRow,
  purchase: PurchaseRequest,
  purchases: PurchaseRequest[],
  items: InventoryItem[]
): QuotationFormRow {
  const lines = text
    .split(/\n| {2,}/)
    .map(line => normalizeUserFacingText(line))
    .filter(line => line.length > 2);
  const linkedItems = detectQuotationLinkedItems(text, purchases, items, purchase);
  const linkedCurrentItem = linkedItems.find(item => item.purchaseId === purchase.id);
  const moneyValues = extractMoneyValues(text);
  const freightLine = lines.find(line => /frete|taxa|envio/i.test(line));
  const freightValue = freightLine ? extractMoneyValues(freightLine)[0] : undefined;
  const quoteUnitPrice = linkedCurrentItem?.unitPrice || moneyValues[0] || 0;
  const extractedQuotedAt = extractDateByLabel(lines, ['data', 'emissao', 'emissão']);
  const extractedValidUntil = extractDateByLabel(lines, ['validade', 'valido', 'válido']);
  const mergedLinkedItems = [...linkedItems];

  row.linkedItems.forEach(existing => {
    const alreadyDetected = mergedLinkedItems.some(
      item => item.purchaseId === existing.purchaseId || item.sku === existing.sku
    );
    if (!alreadyDetected) mergedLinkedItems.push(existing);
  });

  return {
    ...row,
    supplierName: row.supplierName || extractSupplierName(lines),
    contactInfo: row.contactInfo || extractContact(lines),
    quoteNumber: row.quoteNumber || extractQuoteNumber(lines),
    quotedAt: extractedQuotedAt || row.quotedAt || getTodayInputDate(),
    validUntil: extractedValidUntil || row.validUntil,
    unitPrice: row.unitPrice || (quoteUnitPrice ? String(quoteUnitPrice.toFixed(2)) : ''),
    freightCost: row.freightCost || (freightValue ? String(freightValue.toFixed(2)) : ''),
    deliveryDays: row.deliveryDays || extractDeliveryDays(lines),
    paymentTerms: row.paymentTerms || extractPaymentTerms(lines),
    notes: [row.notes, `PDF importado: ${file.name}`].filter(Boolean).join(' | '),
    sourceFileName: file.name,
    sourceFileImportedAt: new Date().toISOString(),
    linkedItems: mergedLinkedItems
  };
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatCurrency(value: unknown) {
  return `R$ ${(Number(value) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
}

function buildSuggestionReason(item: InventoryItem, source: PurchaseRequest['source'], settings: InventorySettings, logs: InventoryLog[]) {
  const abc = getAbcAnalysisForSku(item.sku);
  const policy = getAdaptiveAbcStockPolicy(item.sku, logs);
  const statusLabel = source === 'alerta-critico' ? 'Crítico' : 'Reposição';
  const maxLimit = policy?.maximumStock ?? settings.reorderLimit;
  const minLimit = policy?.minimumStock ?? settings.criticalLimit;
  const parts = [
    `${statusLabel}: saldo ${item.quantity}, mínimo ${minLimit}, máximo ${maxLimit}`,
    `sugerido comprar até recompor o máximo`
  ];

  if (abc) {
    parts.push(`Curva ABC ${abc.className}, rank ${abc.rank}`);
  }

  if (policy?.recentOutflowQuantity) {
    parts.push(`saídas recentes: ${policy.recentOutflowQuantity}`);
  }

  return parts.join(' | ');
}

function comparePurchases(first: PurchaseRequest, second: PurchaseRequest) {
  const firstClassification = getPurchaseClassificationMeta(getPurchaseClassification(first));
  const secondClassification = getPurchaseClassificationMeta(getPurchaseClassification(second));
  if (firstClassification.priority !== secondClassification.priority) {
    return firstClassification.priority - secondClassification.priority;
  }

  const firstAbc = getAbcAnalysisForSku(first.sku);
  const secondAbc = getAbcAnalysisForSku(second.sku);
  const firstRank = firstAbc?.rank ?? Number.MAX_SAFE_INTEGER;
  const secondRank = secondAbc?.rank ?? Number.MAX_SAFE_INTEGER;
  if (firstRank !== secondRank) return firstRank - secondRank;

  if (first.suggestedQuantity !== second.suggestedQuantity) {
    return second.suggestedQuantity - first.suggestedQuantity;
  }

  return new Date(second.updatedAt).getTime() - new Date(first.updatedAt).getTime();
}

export default function AutomaticPurchases({
  items,
  logs,
  settings,
  purchases,
  setPurchases,
  canManagePurchases,
  showToast,
  onSelectSku
}: AutomaticPurchasesProps) {
  const [activeTab, setActiveTab] = useState<PurchaseTab>('fila');
  const [searchQuery, setSearchQuery] = useState('');
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [manualSku, setManualSku] = useState('');
  const [manualQuantity, setManualQuantity] = useState('');
  const [manualReason, setManualReason] = useState('');
  const [quotePurchase, setQuotePurchase] = useState<PurchaseRequest | null>(null);
  const [quoteRows, setQuoteRows] = useState<QuotationFormRow[]>(() => buildInitialQuotationRows(null));
  const [quotationDecisionNote, setQuotationDecisionNote] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [importingPdfRowId, setImportingPdfRowId] = useState<string | null>(null);
  const [manualLinkTargets, setManualLinkTargets] = useState<Record<string, string>>({});

  const suggestions = useMemo(() => {
    const generated: PurchaseRequest[] = [];
    const now = new Date().toISOString();
    const activePurchaseSkus = new Set(
      purchases
        .filter(purchase => ACTIVE_PURCHASE_STATUSES.has(purchase.status))
        .flatMap(purchase => Array.from(getSkuCandidates(purchase.sku)))
    );

    items.forEach(item => {
      if (item.isActiveInWarehouse !== true) return;

      const skuCandidates = getSkuCandidates(item.sku);
      if (Array.from(skuCandidates).some(candidate => activePurchaseSkus.has(candidate))) return;

      const itemSettings = getItemAlertSettings(item, settings, logs);
      const status = normalizeUserFacingText(calculateItemStatus(item, settings, logs));
      const abcPolicy = getAdaptiveAbcStockPolicy(item.sku, logs);
      const maximumStock = abcPolicy?.maximumStock ?? itemSettings.reorderLimit;
      const suggestedQuantity = Math.max(0, Math.ceil(maximumStock - item.quantity));

      if (suggestedQuantity <= 0) return;

      let source: PurchaseRequest['source'] | null = null;
      if (status === 'Estoque Crítico') {
        source = 'alerta-critico';
      } else if (status === 'Repor em Breve') {
        source = 'reposicao';
      }

      if (!source) return;

      generated.push({
        id: `sug-${normalizeSku(item.sku)}-${now}`,
        sku: item.sku,
        itemName: normalizeUserFacingText(item.name),
        status: 'Sugestao',
        source,
        suggestedQuantity,
        reason: buildSuggestionReason(item, source, itemSettings, logs),
        createdAt: now,
        updatedAt: now
      });
    });

    return generated;
  }, [items, settings, logs, purchases]);

  const allPurchases = useMemo(() => {
    const combined = [...purchases];

    suggestions.forEach(suggestion => {
      const hasActivePurchase = combined.some(purchase => {
        if (!ACTIVE_PURCHASE_STATUSES.has(purchase.status)) return false;
        const purchaseCandidates = getSkuCandidates(purchase.sku);
        for (const candidate of getSkuCandidates(suggestion.sku)) {
          if (purchaseCandidates.has(candidate)) return true;
        }
        return false;
      });

      if (!hasActivePurchase) {
        combined.push(suggestion);
      }
    });

    return combined.sort(comparePurchases);
  }, [purchases, suggestions]);

  const filteredPurchases = useMemo(() => {
    let filtered = allPurchases;

    if (activeTab === 'fila') {
      filtered = filtered.filter(
        purchase => purchase.source !== 'manual' && AUTOMATIC_QUEUE_STATUSES.has(purchase.status)
      );
    } else if (activeTab === 'manuais') {
      filtered = filtered.filter(
        purchase => purchase.source === 'manual' && ['Manual', 'Em analise'].includes(purchase.status)
      );
    } else {
      filtered = filtered.filter(purchase => WAITING_PURCHASE_STATUSES.has(purchase.status));
    }

    const query = normalizeUserFacingText(searchQuery).toLowerCase();
    if (!query) return filtered;

    return filtered.filter(purchase => {
      const item = findItemBySku(items, purchase.sku);
      const type = getEffectivePurchaseType(item).toLowerCase();
      const haystack = [
        purchase.sku,
        purchase.itemName,
        item?.name,
        item?.category,
        item?.location,
        type
      ]
        .map(value => normalizeUserFacingText(value).toLowerCase())
        .join(' ');

      return haystack.includes(query);
    });
  }, [allPurchases, activeTab, searchQuery, items]);

  const groupedPurchases = useMemo(() => {
    const groups = new Map<string, PurchasePackageGroup>();

    filteredPurchases.forEach(purchase => {
      const item = findItemBySku(items, purchase.sku);
      const type = getEffectivePurchaseType(item);
      const classification = getPurchaseClassification(purchase);
      const meta = getPurchaseClassificationMeta(classification);
      const key = `${type}__${classification}`;
      const current = groups.get(key);

      if (current) {
        current.items.push(purchase);
        current.totalSuggested += purchase.suggestedQuantity;
        return;
      }

      groups.set(key, {
        key,
        type,
        classification,
        label: meta.label,
        description: meta.description,
        badgeClassName: meta.badgeClassName,
        items: [purchase],
        totalSuggested: purchase.suggestedQuantity
      });
    });

    return Array.from(groups.values())
      .map(group => ({
        ...group,
        items: group.items.sort(comparePurchases)
      }))
      .sort((first, second) => {
        const typeCompare = first.type.localeCompare(second.type, 'pt-BR');
        if (typeCompare !== 0) return typeCompare;
        return (
          getPurchaseClassificationMeta(first.classification).priority -
          getPurchaseClassificationMeta(second.classification).priority
        );
      });
  }, [filteredPurchases, items]);

  const stats = useMemo(() => {
    return {
      urgentes: allPurchases.filter(
        purchase => purchase.source === 'alerta-critico' && AUTOMATIC_QUEUE_STATUSES.has(purchase.status)
      ).length,
      reposicao: allPurchases.filter(
        purchase => purchase.source === 'reposicao' && AUTOMATIC_QUEUE_STATUSES.has(purchase.status)
      ).length,
      manuais: allPurchases.filter(
        purchase => purchase.source === 'manual' && ['Manual', 'Em analise'].includes(purchase.status)
      ).length,
      aguardando: allPurchases.filter(purchase => WAITING_PURCHASE_STATUSES.has(purchase.status)).length,
      pacotes: groupedPurchases.length
    };
  }, [allPurchases, groupedPurchases.length]);

  const quotationSelectablePurchases = useMemo(
    () =>
      allPurchases.filter(purchase =>
        ['Sugestao', 'Manual', 'Em analise', 'Aprovada', 'Comprada', 'Recebida parcial'].includes(purchase.status)
      ),
    [allPurchases]
  );

  const openQuotationForm = (purchase: PurchaseRequest) => {
    if (!canManagePurchases) {
      showToast('Sem permissão para gerenciar cotações.', 'info');
      return;
    }

    const now = new Date().toISOString();
    const nextStatus = ['Sugestao', 'Manual'].includes(purchase.status) ? 'Em analise' : purchase.status;
    const purchaseInAnalysis: PurchaseRequest = { ...purchase, status: nextStatus, updatedAt: now };

    setPurchases(previous => {
      const existing = previous.find(current => current.id === purchase.id);
      if (existing) {
        return previous.map(current => current.id === purchase.id ? purchaseInAnalysis : current).sort(comparePurchases);
      }

      return [...previous, purchaseInAnalysis].sort(comparePurchases);
    });

    setQuotePurchase(purchaseInAnalysis);
    setQuoteRows(buildInitialQuotationRows(purchaseInAnalysis));
    setQuotationDecisionNote(purchase.quotationDecisionNote || '');
    setManualLinkTargets({});
  };

  const updateQuotationRow = (rowId: string, field: keyof QuotationFormRow, value: string | boolean) => {
    setQuoteRows(previous =>
      previous.map(row => {
        if (field === 'isSelected') {
          return { ...row, isSelected: row.id === rowId ? Boolean(value) : false };
        }

        return row.id === rowId ? { ...row, [field]: value } : row;
      })
    );
  };

  const saveQuotationForm = (event: React.FormEvent) => {
    event.preventDefault();
    if (!quotePurchase) return;

    const completeRows = quoteRows.filter(isCompleteQuotationRow);
    if (completeRows.length < 3) {
      showToast('Informe no mínimo 3 cotações completas com fornecedor e valor unitário.', 'info');
      return;
    }

    const bestRow = getBestQuotationRow(quoteRows);
    const selectedRow = completeRows.find(row => row.isSelected) || bestRow;
    if (!selectedRow) {
      showToast('Selecione a cotação escolhida ou use a melhor sugestão.', 'info');
      return;
    }

    const now = new Date().toISOString();
    const quotations: PurchaseQuotation[] = completeRows.map(row =>
      buildQuotationPayload(row, row.id === selectedRow.id, buildQuotationBudgetItems(row, quotePurchase, items, allPurchases))
    );
    const linkedQuotationUpdates = completeRows.flatMap(row =>
      row.linkedItems
        .filter(linkedItem => linkedItem.selected && linkedItem.purchaseId && linkedItem.purchaseId !== quotePurchase.id)
        .map(linkedItem => {
          const targetPurchase = allPurchases.find(purchase => purchase.id === linkedItem.purchaseId);
          if (!targetPurchase) return null;
          const budgetItems = buildQuotationBudgetItems(row, quotePurchase, items, allPurchases);
          const targetBudgetItem = budgetItems.find(
            item => item.purchaseId === targetPurchase.id || item.sku === targetPurchase.sku
          );

          return {
            targetPurchase,
            quotation: buildQuotationPayload(
              row,
              false,
              budgetItems,
              {
                id: buildLinkedQuotationId(row, targetPurchase.id),
                unitPrice: targetBudgetItem?.unitPrice ?? linkedItem.unitPrice ?? 0,
                notesSuffix: `Cotação vinculada automaticamente pelo PDF do SKU ${quotePurchase.sku}.`
              }
            )
          };
        })
        .filter((entry): entry is { targetPurchase: PurchaseRequest; quotation: PurchaseQuotation } => Boolean(entry))
    );

    const updatedPurchase: PurchaseRequest = {
      ...quotePurchase,
      status: ['Sugestao', 'Manual'].includes(quotePurchase.status) ? 'Em analise' : quotePurchase.status,
      quotations,
      selectedQuotationId: selectedRow.id,
      quotationDecisionNote: normalizeUserFacingText(quotationDecisionNote) || undefined,
      updatedAt: now
    };

    setPurchases(previous => {
      const purchasesById = new Map(previous.map(current => [current.id, current]));
      purchasesById.set(quotePurchase.id, updatedPurchase);

      linkedQuotationUpdates.forEach(({ targetPurchase, quotation }) => {
        const current = purchasesById.get(targetPurchase.id) || targetPurchase;
        const nextStatus = ['Sugestao', 'Manual'].includes(current.status) ? 'Em analise' : current.status;
        purchasesById.set(targetPurchase.id, {
          ...current,
          status: nextStatus,
          quotations: upsertQuotation(current.quotations || [], quotation),
          updatedAt: now
        });
      });

      return Array.from(purchasesById.values()).sort(comparePurchases);
    });

    setQuotePurchase(null);
    const linkedTargetCount = new Set(linkedQuotationUpdates.map(update => update.targetPurchase.id)).size;
    showToast(
      linkedTargetCount > 0
        ? `Cotações salvas e vinculadas a ${linkedTargetCount} item(ns) reconhecido(s) no PDF.`
        : 'Cotações salvas. O item está pronto para aprovação.',
      'success'
    );
  };

  const handleQuotationPdfImport = async (rowId: string, file: File | null) => {
    if (!file || !quotePurchase) return;
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      showToast('Selecione um arquivo PDF.', 'info');
      return;
    }

    const row = quoteRows.find(candidate => candidate.id === rowId);
    if (!row) return;

    setImportingPdfRowId(rowId);
    try {
      const text = await extractPdfTextFromFile(file);
      if (text.length < 20) {
        showToast('Não consegui ler texto neste PDF. Se for imagem escaneada, preencha manualmente.', 'info');
        return;
      }

      const parsedRow = parseQuotationPdfText(text, file, row, quotePurchase, allPurchases, items);
      setQuoteRows(previous => previous.map(candidate => candidate.id === rowId ? parsedRow : candidate));
      showToast('PDF lido e cotação preenchida automaticamente.', 'success');
    } catch {
      showToast('Não consegui importar este PDF. Tente outro arquivo ou preencha manualmente.', 'info');
    } finally {
      setImportingPdfRowId(null);
    }
  };

  const toggleLinkedItem = (rowId: string, linkId: string) => {
    setQuoteRows(previous =>
      previous.map(row =>
        row.id === rowId
          ? {
              ...row,
              linkedItems: row.linkedItems.map(item =>
                item.id === linkId ? { ...item, selected: !item.selected } : item
              )
            }
          : row
      )
    );
  };

  const addManualLinkedItem = (rowId: string) => {
    const purchaseId = manualLinkTargets[rowId];
    const purchase = quotationSelectablePurchases.find(candidate => candidate.id === purchaseId);
    if (!purchase) {
      showToast('Selecione um item para vincular à cotação.', 'info');
      return;
    }

    const item = findItemBySku(items, purchase.sku);
    const classification = getPurchaseClassificationMeta(getPurchaseClassification(purchase)).label;
    const linkedItem: PurchaseQuotationLinkedItem = {
      id: `manual-${purchase.id}-${Date.now()}`,
      purchaseId: purchase.id,
      sku: purchase.sku,
      itemName: normalizeUserFacingText(purchase.itemName),
      purchaseType: getEffectivePurchaseType(item),
      classification,
      matchConfidence: 'manual',
      selected: true
    };

    setQuoteRows(previous =>
      previous.map(row => {
        if (row.id !== rowId) return row;
        if (row.linkedItems.some(current => current.purchaseId === purchase.id || current.sku === purchase.sku)) return row;
        return { ...row, linkedItems: [...row.linkedItems, linkedItem] };
      })
    );
    setManualLinkTargets(previous => ({ ...previous, [rowId]: '' }));
  };

  const printQuotationMap = () => {
    if (!quotePurchase) return;

    const groupedRows = quoteRows
      .filter(row => isCompleteQuotationRow(row) || row.supplierName || row.sourceFileName)
      .map(row => ({ row, groupKey: getQuotationPrintGroupKey(row) }))
      .reduce<Array<{ representative: QuotationFormRow; rows: QuotationFormRow[] }>>((groups, entry) => {
        const existingGroup = groups.find(group => getQuotationPrintGroupKey(group.representative) === entry.groupKey);
        if (existingGroup) {
          existingGroup.rows.push(entry.row);
          return groups;
        }
        groups.push({ representative: entry.row, rows: [entry.row] });
        return groups;
      }, []);

    const rowsHtml = groupedRows
      .map((group, index) => {
        const representative = group.representative;
        const selected = group.rows.some(row => row.isSelected) ? 'Fornecedor escolhido' : '';
        const budgetItems = mergeQuotationBudgetItems(
          group.rows.flatMap(row => buildQuotationBudgetItems(row, quotePurchase, items, allPurchases))
        );
        const budgetItemsHtml = budgetItems
          .map(item => {
            const total = item.totalPrice || (item.unitPrice && item.quantity ? item.unitPrice * item.quantity : undefined);
            return `
              <tr>
                <td>${escapeHtml(item.sku)}</td>
                <td>${escapeHtml(item.itemName)}</td>
                <td>${escapeHtml(item.quantity || '-')}</td>
                <td>${item.unitPrice ? formatCurrency(item.unitPrice) : '-'}</td>
                <td>${total ? formatCurrency(total) : '-'}</td>
                <td>${escapeHtml([item.purchaseType, item.classification].filter(Boolean).join(' / ') || '-')}</td>
              </tr>
            `;
          })
          .join('');

        return `
          <section class="quote ${group.rows.some(row => row.isSelected) ? 'selected' : ''}">
            <div class="quote-title">
              <h2>Orcamento ${index + 1} - ${escapeHtml(representative.supplierName || 'Fornecedor nao informado')}${budgetItems.length > 1 ? ` (${budgetItems.length} itens)` : ''}</h2>
              <strong>${escapeHtml(selected)}</strong>
            </div>
            <div class="grid">
              <p><span>Nro cotacao</span>${escapeHtml(representative.quoteNumber || '-')}</p>
              <p><span>Data</span>${escapeHtml(representative.quotedAt || '-')}</p>
              <p><span>Validade</span>${escapeHtml(representative.validUntil || '-')}</p>
              <p><span>Valor unitario</span>${formatCurrency(parsePositiveNumber(representative.unitPrice))}</p>
              <p><span>Frete/taxas</span>${formatCurrency(parsePositiveNumber(representative.freightCost))}</p>
              <p><span>Total comparado</span>${formatCurrency(getQuotationTotalFromRow(representative))}</p>
              <p><span>Prazo</span>${escapeHtml(representative.deliveryDays || '-')} dias</p>
              <p><span>Pagamento</span>${escapeHtml(representative.paymentTerms || '-')}</p>
              <p><span>Nota tecnica</span>${escapeHtml(representative.technicalScore || '-')}</p>
            </div>
            <p class="notes">${escapeHtml(representative.notes || '')}</p>
            ${
              budgetItemsHtml
                ? `<p class="notes"><strong>Itens deste orcamento:</strong> ${budgetItems.length}</p><table><thead><tr><th>SKU</th><th>Item</th><th>Qtd.</th><th>Valor unit.</th><th>Total</th><th>Tipo / grupo</th></tr></thead><tbody>${budgetItemsHtml}</tbody></table>`
                : ''
            }
          </section>
        `;
      })
      .join('');

    const printWindow = window.open('', '_blank', 'width=1120,height=800');
    if (!printWindow) {
      showToast('O navegador bloqueou a janela de impressao.', 'info');
      return;
    }

    printWindow.document.write(`
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>Mapa de cotacao ${escapeHtml(quotePurchase.sku)}</title>
          <style>
            body { font-family: Inter, Arial, sans-serif; color: #13233a; margin: 32px; }
            header { border-bottom: 3px solid #1f4f8f; padding-bottom: 16px; margin-bottom: 20px; }
            h1 { margin: 0; font-size: 26px; }
            .meta { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-top: 14px; }
            .meta p, .grid p { border: 1px solid #d7e2f2; border-radius: 10px; padding: 10px; margin: 0; }
            span { display: block; color: #5c6f8a; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 4px; }
            .quote { border: 1px solid #d7e2f2; border-radius: 16px; padding: 16px; margin: 16px 0; break-inside: avoid; }
            .selected { border-color: #1f4f8f; box-shadow: inset 0 0 0 2px #1f4f8f; }
            .quote-title { display: flex; justify-content: space-between; gap: 16px; align-items: center; }
            .quote h2 { margin: 0 0 12px; font-size: 18px; }
            .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
            .notes { color: #52627a; font-size: 13px; }
            table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 12px; }
            th, td { border: 1px solid #d7e2f2; padding: 8px; text-align: left; }
            th { background: #e9f1ff; }
            footer { margin-top: 36px; display: grid; grid-template-columns: 1fr 1fr; gap: 40px; }
            .sign { border-top: 1px solid #8090a8; padding-top: 8px; text-align: center; color: #5c6f8a; }
            @media print { button { display: none; } body { margin: 18mm; } }
          </style>
        </head>
        <body>
          <header>
            <h1>Mapa de cotacao</h1>
            <p>${escapeHtml(quotePurchase.sku)} - ${escapeHtml(quotePurchase.itemName)}</p>
            <div class="meta">
              <p><span>Quantidade sugerida</span>${quotePurchase.suggestedQuantity}</p>
              <p><span>Status</span>${escapeHtml(quotePurchase.status)}</p>
              <p><span>Data</span>${new Date().toLocaleString('pt-BR')}</p>
              <p><span>Criterio</span>Preco 45% / tecnica 35% / prazo 20%</p>
            </div>
          </header>
          ${rowsHtml}
          <section class="quote">
            <h2>Justificativa da escolha</h2>
            <p>${escapeHtml(quotationDecisionNote || quotePurchase.quotationDecisionNote || 'Sem justificativa informada.')}</p>
          </section>
          <footer>
            <div class="sign">Compras</div>
            <div class="sign">Aprovacao</div>
          </footer>
          <script>window.print();</script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const handleStatusChange = (purchase: PurchaseRequest, newStatus: PurchaseRequestStatus) => {
    if (!canManagePurchases) {
      showToast('Sem permissão para gerenciar compras.', 'info');
      return;
    }

    if (newStatus === 'Aprovada' && !hasMinimumQuotations(purchase)) {
      showToast('Antes de aprovar, registre no mínimo 3 cotações para este item.', 'info');
      openQuotationForm(purchase);
      return;
    }

    const now = new Date().toISOString();

    setPurchases(previous => {
      const existing = previous.find(current => current.id === purchase.id);
      if (existing) {
        return previous.map(current => current.id === purchase.id ? { ...current, status: newStatus, updatedAt: now } : current);
      }

      return [...previous, { ...purchase, status: newStatus, updatedAt: now }];
    });

    showToast(`Status alterado para ${newStatus}.`, 'success');
  };

  const handlePackageStatusChange = (group: PurchasePackageGroup, newStatus: PurchaseRequestStatus) => {
    if (!canManagePurchases) {
      showToast('Sem permissão para gerenciar compras.', 'info');
      return;
    }

    const selected = group.items.filter(purchase => REVIEWABLE_PURCHASE_STATUSES.has(purchase.status));
    if (selected.length === 0) {
      showToast('Este pacote não tem itens liberados para alterar agora.', 'info');
      return;
    }

    if (newStatus === 'Aprovada') {
      const missingQuotation = selected.find(purchase => !hasMinimumQuotations(purchase));
      if (missingQuotation) {
        showToast('Para aprovar o pacote, cada item precisa ter no mínimo 3 cotações.', 'info');
        openQuotationForm(missingQuotation);
        return;
      }
    }

    const now = new Date().toISOString();
    setPurchases(previous => {
      const byId = new Map(previous.map(purchase => [purchase.id, purchase]));
      selected.forEach(purchase => {
        byId.set(purchase.id, { ...purchase, status: newStatus, updatedAt: now });
      });
      return Array.from(byId.values()).sort(comparePurchases);
    });

    showToast(`Pacote ${group.type} / ${group.label} atualizado para ${newStatus}.`, 'success');
  };

  const handleCreateManual = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canManagePurchases) return;

    const sku = normalizeSku(manualSku);
    const item = findItemBySku(items, sku);
    if (!item) {
      showToast('SKU não encontrado.', 'info');
      return;
    }

    const qty = Number.parseInt(manualQuantity, 10);
    if (!Number.isFinite(qty) || qty <= 0) {
      showToast('Quantidade inválida.', 'info');
      return;
    }

    const now = new Date().toISOString();
    const newPurchase: PurchaseRequest = {
      id: `man-${normalizeSku(item.sku)}-${Date.now()}`,
      sku: item.sku,
      itemName: normalizeUserFacingText(item.name),
      status: 'Manual',
      source: 'manual',
      suggestedQuantity: qty,
      reason: normalizeUserFacingText(manualReason) || 'Pedido manual',
      createdAt: now,
      updatedAt: now
    };

    setPurchases(previous => [...previous, newPurchase].sort(comparePurchases));
    setIsManualModalOpen(false);
    setManualSku('');
    setManualQuantity('');
    setManualReason('');
    showToast('Pedido manual criado com sucesso.', 'success');
  };

  const completeQuoteRows = quoteRows.filter(isCompleteQuotationRow);
  const bestQuoteRow = getBestQuotationRow(quoteRows);

  return (
    <div className="max-w-7xl mx-auto p-4 pb-24 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-on-surface flex items-center gap-2">
            <ShoppingCart className="w-7 h-7 text-primary" />
            Compras Automáticas
          </h1>
          <p className="text-on-surface-variant mt-1">
            Pacotes por tipo e prioridade, baseados em alertas, Curva ABC e pedidos manuais.
          </p>
        </div>
        {canManagePurchases && (
          <button
            type="button"
            onClick={() => setIsManualModalOpen(true)}
            className="flex items-center justify-center gap-2 px-4 py-2 bg-primary text-on-primary rounded-xl font-medium hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-5 h-5" />
            Pedido Manual
          </button>
        )}
      </div>

      <div className="rounded-2xl border border-primary/15 bg-primary-container/40 p-4 text-on-primary-container">
        <p className="font-bold">Como o pacote de compra é formado</p>
        <p className="text-sm mt-1">
          O sistema separa automaticamente por tipo do item e por prioridade: primeiro Crítico, depois Repor.
          A quantidade sugerida usa a regra de máximo calculado menos saldo atual, sem dar entrada no estoque.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        <div className="bg-error-container text-on-error-container p-4 rounded-2xl">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-5 h-5" />
            <span className="font-medium">Críticos</span>
          </div>
          <div className="text-3xl font-bold">{stats.urgentes}</div>
        </div>
        <div className="bg-tertiary-container text-on-tertiary-container p-4 rounded-2xl">
          <div className="flex items-center gap-2 mb-2">
            <Package className="w-5 h-5" />
            <span className="font-medium">Repor</span>
          </div>
          <div className="text-3xl font-bold">{stats.reposicao}</div>
        </div>
        <div className="bg-secondary-container text-on-secondary-container p-4 rounded-2xl">
          <div className="flex items-center gap-2 mb-2">
            <Plus className="w-5 h-5" />
            <span className="font-medium">Manuais</span>
          </div>
          <div className="text-3xl font-bold">{stats.manuais}</div>
        </div>
        <div className="bg-primary-container text-on-primary-container p-4 rounded-2xl">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-5 h-5" />
            <span className="font-medium">Aguardando</span>
          </div>
          <div className="text-3xl font-bold">{stats.aguardando}</div>
        </div>
        <div className="bg-surface-container-highest text-on-surface p-4 rounded-2xl">
          <div className="flex items-center gap-2 mb-2">
            <ShoppingCart className="w-5 h-5" />
            <span className="font-medium">Pacotes</span>
          </div>
          <div className="text-3xl font-bold">{stats.pacotes}</div>
        </div>
      </div>

      <div className="bg-surface-container rounded-2xl overflow-hidden flex flex-col">
        <div className="flex border-b border-outline-variant overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveTab('fila')}
            className={`flex-1 min-w-[140px] py-4 px-4 text-sm font-medium text-center border-b-2 transition-colors ${
              activeTab === 'fila'
                ? 'border-primary text-primary'
                : 'border-transparent text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest'
            }`}
          >
            Fila Automática
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('manuais')}
            className={`flex-1 min-w-[140px] py-4 px-4 text-sm font-medium text-center border-b-2 transition-colors ${
              activeTab === 'manuais'
                ? 'border-primary text-primary'
                : 'border-transparent text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest'
            }`}
          >
            Pedidos Manuais
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('aguardando')}
            className={`flex-1 min-w-[140px] py-4 px-4 text-sm font-medium text-center border-b-2 transition-colors ${
              activeTab === 'aguardando'
                ? 'border-primary text-primary'
                : 'border-transparent text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest'
            }`}
          >
            Aguardando
          </button>
        </div>

        <div className="p-4 border-b border-outline-variant">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-on-surface-variant" />
            <input
              type="text"
              value={searchQuery}
              onChange={event => setSearchQuery(event.target.value)}
              placeholder="Buscar por SKU, descrição ou tipo..."
              className="w-full pl-10 pr-4 py-3 bg-surface text-on-surface rounded-xl border border-outline-variant focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
            />
          </div>
        </div>

        <div className="p-4 space-y-6">
          {groupedPurchases.length === 0 ? (
            <div className="text-center py-12 text-on-surface-variant">
              <ShoppingCart className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>Nenhuma compra encontrada nesta categoria.</p>
            </div>
          ) : (
            groupedPurchases.map(group => {
              const canBulkReview = group.items.some(purchase => REVIEWABLE_PURCHASE_STATUSES.has(purchase.status));
              const isExpanded = expandedGroups[group.key] !== false;

              return (
                <section key={group.key} className="rounded-2xl border border-outline-variant bg-surface overflow-hidden">
                  <div className="p-4 bg-surface-container-low flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-base font-bold text-on-surface flex items-center gap-2">
                          <Package className="w-5 h-5 text-primary" />
                          Pacote {group.type}
                        </h2>
                        <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${group.badgeClassName}`}>
                          {group.label}
                        </span>
                      </div>
                      <p className="text-sm text-on-surface-variant mt-2">{group.description}</p>
                      <div className="flex flex-wrap gap-2 mt-3 text-xs font-semibold text-on-surface-variant">
                        <span className="px-2 py-1 rounded-lg bg-surface-container-highest">
                          {group.items.length} SKUs
                        </span>
                        <span className="px-2 py-1 rounded-lg bg-surface-container-highest">
                          {group.totalSuggested} unidades sugeridas
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-2 w-full lg:w-auto">
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedGroups(previous => ({ ...previous, [group.key]: !isExpanded }))
                        }
                        className="px-3 py-2 bg-surface text-on-surface rounded-xl border border-outline-variant text-sm font-bold hover:bg-surface-container-highest flex items-center justify-center gap-2"
                      >
                        <ChevronDown className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                        {isExpanded ? 'Recolher' : 'Abrir'} {group.label}
                      </button>
                      {canManagePurchases && canBulkReview && (
                        <>
                        <button
                          type="button"
                          onClick={() => handlePackageStatusChange(group, 'Em analise')}
                          className="px-3 py-2 bg-surface text-on-surface rounded-xl border border-outline-variant text-sm font-bold hover:bg-surface-container-highest"
                        >
                          Enviar pacote para análise
                        </button>
                        <button
                          type="button"
                          onClick={() => handlePackageStatusChange(group, 'Aprovada')}
                          className="px-3 py-2 bg-primary text-on-primary rounded-xl text-sm font-bold hover:bg-primary/90"
                        >
                          Aprovar pacote
                        </button>
                        </>
                      )}
                    </div>
                  </div>

                  {isExpanded && (
                  <div className="p-4 space-y-3">
                    {group.items.map(purchase => {
                      const item = findItemBySku(items, purchase.sku);
                      const currentQty = item?.quantity ?? 0;
                      const itemSettings = item ? getItemAlertSettings(item, settings, logs) : null;
                      const abc = getAbcAnalysisForSku(purchase.sku);
                      const classification = getPurchaseClassification(purchase);
                      const meta = getPurchaseClassificationMeta(classification);
                      const quoteCount = (purchase.quotations || []).filter(
                        quotation => quotation.status === 'Recebida' && quotation.supplierName && quotation.unitPrice > 0
                      ).length;
                      const selectedQuotation = getSelectedQuotation(purchase);

                      return (
                        <div
                          key={purchase.id}
                          className="bg-surface-container-lowest p-4 rounded-xl border border-outline-variant flex flex-col xl:flex-row gap-4 justify-between items-start xl:items-center"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2 mb-2">
                              <span className="font-mono text-sm text-primary bg-primary/10 px-2 py-0.5 rounded">
                                {purchase.sku}
                              </span>
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${meta.badgeClassName}`}>
                                {meta.label}
                              </span>
                              <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-surface-variant text-on-surface-variant">
                                {purchase.status}
                              </span>
                              {abc && (
                                <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-primary-container text-on-primary-container">
                                  ABC {abc.className} · rank {abc.rank}
                                </span>
                              )}
                            </div>
                            <h3 className="font-bold text-on-surface truncate">
                              {normalizeUserFacingText(purchase.itemName)}
                            </h3>
                            <div className="mt-2 grid sm:grid-cols-4 gap-2 text-sm text-on-surface-variant">
                              <span>
                                Saldo: <strong className="text-on-surface">{currentQty}</strong>
                              </span>
                              <span>
                                Comprar: <strong className="text-primary">{purchase.suggestedQuantity}</strong>
                              </span>
                              <span>
                                Mínimo: <strong className="text-on-surface">{itemSettings?.criticalLimit ?? '-'}</strong>
                              </span>
                              <span>
                                Máximo: <strong className="text-on-surface">{itemSettings?.reorderLimit ?? '-'}</strong>
                              </span>
                            </div>
                            <p className="text-xs text-on-surface-variant mt-2">
                              Motivo: {normalizeUserFacingText(purchase.reason)}
                            </p>
                            <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
                              <span className={`px-2 py-1 rounded-lg ${
                                quoteCount >= 3
                                  ? 'bg-primary-container text-on-primary-container'
                                  : 'bg-error-container text-on-error-container'
                              }`}>
                                Cotações {quoteCount}/3
                              </span>
                              {selectedQuotation && (
                                <span className="px-2 py-1 rounded-lg bg-surface-container-highest text-on-surface-variant">
                                  Escolhida: {selectedQuotation.supplierName} · R$ {getQuotationTotal(selectedQuotation).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex flex-wrap gap-2 w-full xl:w-auto">
                            {canManagePurchases && (
                              <>
                                {['Sugestao', 'Manual', 'Em analise', 'Aprovada', 'Comprada', 'Recebida parcial'].includes(purchase.status) && (
                                  <button
                                    type="button"
                                    onClick={() => openQuotationForm(purchase)}
                                    className="flex-1 xl:flex-none px-3 py-2 bg-surface text-on-surface rounded-lg border border-outline-variant text-sm font-bold hover:bg-surface-container-highest"
                                  >
                                    {quoteCount >= 3 ? 'Ver cotações' : 'Analisar'}
                                  </button>
                                )}
                                {REVIEWABLE_PURCHASE_STATUSES.has(purchase.status) && (
                                  <button
                                    type="button"
                                    onClick={() => handleStatusChange(purchase, 'Aprovada')}
                                    className="flex-1 xl:flex-none px-3 py-2 bg-primary text-on-primary rounded-lg text-sm font-bold hover:bg-primary/90"
                                  >
                                    Aprovar
                                  </button>
                                )}
                                {purchase.status === 'Aprovada' && (
                                  <button
                                    type="button"
                                    onClick={() => handleStatusChange(purchase, 'Comprada')}
                                    className="flex-1 xl:flex-none px-3 py-2 bg-tertiary text-on-tertiary rounded-lg text-sm font-bold hover:bg-tertiary/90"
                                  >
                                    Marcar comprada
                                  </button>
                                )}
                                {['Sugestao', 'Manual', 'Em analise', 'Aprovada'].includes(purchase.status) && (
                                  <button
                                    type="button"
                                    onClick={() => handleStatusChange(purchase, 'Cancelada')}
                                    className="flex-1 xl:flex-none px-3 py-2 bg-error text-on-error rounded-lg text-sm font-bold hover:bg-error/90"
                                  >
                                    Cancelar
                                  </button>
                                )}
                              </>
                            )}
                            <button
                              type="button"
                              onClick={() => onSelectSku(purchase.sku)}
                              className="flex-1 xl:flex-none px-3 py-2 bg-surface-variant text-on-surface-variant rounded-lg text-sm font-bold hover:bg-surface-variant/80"
                            >
                              Ver estoque
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  )}
                </section>
              );
            })
          )}
        </div>
      </div>

      {isManualModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-surface-container w-full max-w-md rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between p-4 border-b border-outline-variant">
              <h2 className="text-lg font-bold text-on-surface">Novo Pedido Manual</h2>
              <button
                type="button"
                onClick={() => setIsManualModalOpen(false)}
                className="p-2 text-on-surface-variant hover:text-on-surface hover:bg-surface-variant rounded-full transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateManual} className="p-4 space-y-4 overflow-y-auto">
              <div>
                <label className="block text-sm font-medium text-on-surface mb-1">SKU</label>
                <input
                  type="text"
                  required
                  value={manualSku}
                  onChange={event => setManualSku(event.target.value)}
                  className="w-full px-3 py-2 bg-surface text-on-surface rounded-xl border border-outline-variant focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                  placeholder="Ex: 12345"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-on-surface mb-1">Quantidade</label>
                <input
                  type="number"
                  required
                  min="1"
                  value={manualQuantity}
                  onChange={event => setManualQuantity(event.target.value)}
                  className="w-full px-3 py-2 bg-surface text-on-surface rounded-xl border border-outline-variant focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                  placeholder="Ex: 10"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-on-surface mb-1">Motivo / Observação</label>
                <textarea
                  required
                  value={manualReason}
                  onChange={event => setManualReason(event.target.value)}
                  className="w-full px-3 py-2 bg-surface text-on-surface rounded-xl border border-outline-variant focus:border-primary focus:ring-1 focus:ring-primary outline-none resize-none h-24"
                  placeholder="Por que este item precisa ser comprado?"
                />
              </div>
              <div className="pt-4 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsManualModalOpen(false)}
                  className="px-4 py-2 text-on-surface-variant hover:bg-surface-variant rounded-xl font-medium transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-primary text-on-primary rounded-xl font-medium hover:bg-primary/90 transition-colors"
                >
                  Criar Pedido
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {quotePurchase && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/55 backdrop-blur-sm">
          <div className="bg-surface-container w-full max-w-6xl rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[94vh]">
            <div className="flex items-start justify-between gap-4 p-4 border-b border-outline-variant bg-surface-container-low">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-primary">Mapa de cotações</p>
                <h2 className="text-xl font-bold text-on-surface mt-1">
                  {quotePurchase.sku} · {normalizeUserFacingText(quotePurchase.itemName)}
                </h2>
                <p className="text-sm text-on-surface-variant mt-1">
                  Registre no mínimo 3 cotações comparáveis antes de aprovar a compra.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setQuotePurchase(null)}
                className="p-2 text-on-surface-variant hover:text-on-surface hover:bg-surface-variant rounded-full transition-colors"
                aria-label="Fechar cotações"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={saveQuotationForm} className="overflow-y-auto">
              <div className="p-4 grid lg:grid-cols-[1fr_280px] gap-4">
                <div className="space-y-4">
                  <div className="rounded-2xl border border-outline-variant bg-surface p-4">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                      <div>
                        <p className="font-bold text-on-surface flex items-center gap-2">
                          <ClipboardCheck className="w-5 h-5 text-primary" />
                          Cotações obrigatórias
                        </p>
                        <p className="text-sm text-on-surface-variant mt-1">
                          Compare preço, prazo e aderência técnica. O menor preço não precisa ser o escolhido se outro fornecedor entregar melhor valor.
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                          completeQuoteRows.length >= 3
                            ? 'bg-primary-container text-on-primary-container'
                            : 'bg-error-container text-on-error-container'
                        }`}>
                          {completeQuoteRows.length}/3 completas
                        </span>
                        {bestQuoteRow && (
                          <button
                            type="button"
                            onClick={() => updateQuotationRow(bestQuoteRow.id, 'isSelected', true)}
                            className="px-3 py-1 rounded-full text-xs font-bold bg-surface-container-highest text-on-surface hover:bg-surface-variant"
                          >
                            Usar melhor sugestão
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {quoteRows.map((row, index) => {
                    const completeRows = quoteRows.filter(isCompleteQuotationRow);
                    const score = calculateQuotationScore(row, completeRows);
                    const total = getQuotationTotalFromRow(row);
                    const isBest = bestQuoteRow?.id === row.id && isCompleteQuotationRow(row);

                    return (
                      <section
                        key={row.id}
                        className={`rounded-2xl border p-4 bg-surface ${
                          row.isSelected
                            ? 'border-primary shadow-[0_0_0_1px_rgba(37,99,235,0.25)]'
                            : 'border-outline-variant'
                        }`}
                      >
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-bold text-on-surface">Cotação {index + 1}</h3>
                            {isBest && (
                              <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-primary-container text-on-primary-container">
                                melhor sugestão
                              </span>
                            )}
                            {row.isSelected && (
                              <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-tertiary-container text-on-tertiary-container">
                                escolhida
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <label className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold border border-primary/30 bg-primary-container text-on-primary-container ${
                              importingPdfRowId === row.id ? 'opacity-70 cursor-wait' : 'cursor-pointer hover:bg-primary/15'
                            }`}>
                              <Upload className="w-4 h-4" />
                              {importingPdfRowId === row.id ? 'Lendo PDF...' : 'Importar PDF'}
                              <input
                                type="file"
                                accept="application/pdf,.pdf"
                                className="hidden"
                                disabled={importingPdfRowId === row.id}
                                onChange={event => {
                                  const file = event.currentTarget.files?.[0] ?? null;
                                  void handleQuotationPdfImport(row.id, file);
                                  event.currentTarget.value = '';
                                }}
                              />
                            </label>
                            <button
                              type="button"
                              onClick={printQuotationMap}
                              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold bg-surface-container-highest text-on-surface hover:bg-surface-variant"
                            >
                              <Printer className="w-4 h-4" />
                              Imprimir mapa
                            </button>
                            <label className="inline-flex items-center gap-2 text-sm font-bold text-on-surface">
                              <input
                                type="radio"
                                name="selectedQuotation"
                                checked={row.isSelected}
                                onChange={() => updateQuotationRow(row.id, 'isSelected', true)}
                                disabled={!isCompleteQuotationRow(row)}
                              />
                              Selecionar fornecedor
                            </label>
                          </div>
                        </div>

                        {row.sourceFileName && (
                          <div className="mb-4 inline-flex max-w-full items-center gap-2 rounded-xl bg-surface-container-low px-3 py-2 text-xs font-bold text-on-surface-variant">
                            <FileText className="w-4 h-4 text-primary shrink-0" />
                            <span className="truncate">PDF importado: {row.sourceFileName}</span>
                          </div>
                        )}

                        <div className="grid md:grid-cols-3 gap-3">
                          <div>
                            <label className="block text-xs font-bold uppercase tracking-wider text-on-surface-variant mb-1">
                              Fornecedor
                            </label>
                            <input
                              type="text"
                              value={row.supplierName}
                              onChange={event => updateQuotationRow(row.id, 'supplierName', event.target.value)}
                              className="w-full px-3 py-2 bg-surface-container-lowest text-on-surface rounded-xl border border-outline-variant focus:border-primary outline-none"
                              placeholder="Nome do fornecedor"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-bold uppercase tracking-wider text-on-surface-variant mb-1">
                              Contato
                            </label>
                            <input
                              type="text"
                              value={row.contactInfo}
                              onChange={event => updateQuotationRow(row.id, 'contactInfo', event.target.value)}
                              className="w-full px-3 py-2 bg-surface-container-lowest text-on-surface rounded-xl border border-outline-variant focus:border-primary outline-none"
                              placeholder="Telefone, e-mail ou vendedor"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-bold uppercase tracking-wider text-on-surface-variant mb-1">
                              Nº cotação
                            </label>
                            <input
                              type="text"
                              value={row.quoteNumber}
                              onChange={event => updateQuotationRow(row.id, 'quoteNumber', event.target.value)}
                              className="w-full px-3 py-2 bg-surface-container-lowest text-on-surface rounded-xl border border-outline-variant focus:border-primary outline-none"
                              placeholder="Opcional"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-bold uppercase tracking-wider text-on-surface-variant mb-1">
                              Data
                            </label>
                            <input
                              type="date"
                              value={row.quotedAt}
                              onChange={event => updateQuotationRow(row.id, 'quotedAt', event.target.value)}
                              className="w-full px-3 py-2 bg-surface-container-lowest text-on-surface rounded-xl border border-outline-variant focus:border-primary outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-bold uppercase tracking-wider text-on-surface-variant mb-1">
                              Validade
                            </label>
                            <input
                              type="date"
                              value={row.validUntil}
                              onChange={event => updateQuotationRow(row.id, 'validUntil', event.target.value)}
                              className="w-full px-3 py-2 bg-surface-container-lowest text-on-surface rounded-xl border border-outline-variant focus:border-primary outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-bold uppercase tracking-wider text-on-surface-variant mb-1">
                              Status
                            </label>
                            <select
                              value={row.status}
                              onChange={event => updateQuotationRow(row.id, 'status', event.target.value)}
                              className="w-full px-3 py-2 bg-surface-container-lowest text-on-surface rounded-xl border border-outline-variant focus:border-primary outline-none"
                            >
                              <option value="Recebida">Recebida</option>
                              <option value="Pendente">Pendente</option>
                              <option value="Recusada">Recusada</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-bold uppercase tracking-wider text-on-surface-variant mb-1">
                              Valor unitário
                            </label>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={row.unitPrice}
                              onChange={event => updateQuotationRow(row.id, 'unitPrice', event.target.value)}
                              className="w-full px-3 py-2 bg-surface-container-lowest text-on-surface rounded-xl border border-outline-variant focus:border-primary outline-none"
                              placeholder="0,00"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-bold uppercase tracking-wider text-on-surface-variant mb-1">
                              Frete / taxas
                            </label>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={row.freightCost}
                              onChange={event => updateQuotationRow(row.id, 'freightCost', event.target.value)}
                              className="w-full px-3 py-2 bg-surface-container-lowest text-on-surface rounded-xl border border-outline-variant focus:border-primary outline-none"
                              placeholder="0,00"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-bold uppercase tracking-wider text-on-surface-variant mb-1">
                              Prazo em dias
                            </label>
                            <input
                              type="number"
                              min="0"
                              step="1"
                              value={row.deliveryDays}
                              onChange={event => updateQuotationRow(row.id, 'deliveryDays', event.target.value)}
                              className="w-full px-3 py-2 bg-surface-container-lowest text-on-surface rounded-xl border border-outline-variant focus:border-primary outline-none"
                              placeholder="Ex: 5"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-bold uppercase tracking-wider text-on-surface-variant mb-1">
                              Nota técnica 1-5
                            </label>
                            <input
                              type="number"
                              min="1"
                              max="5"
                              step="0.5"
                              value={row.technicalScore}
                              onChange={event => updateQuotationRow(row.id, 'technicalScore', event.target.value)}
                              className="w-full px-3 py-2 bg-surface-container-lowest text-on-surface rounded-xl border border-outline-variant focus:border-primary outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-bold uppercase tracking-wider text-on-surface-variant mb-1">
                              Condição de pagamento
                            </label>
                            <input
                              type="text"
                              value={row.paymentTerms}
                              onChange={event => updateQuotationRow(row.id, 'paymentTerms', event.target.value)}
                              className="w-full px-3 py-2 bg-surface-container-lowest text-on-surface rounded-xl border border-outline-variant focus:border-primary outline-none"
                              placeholder="À vista, 30 dias..."
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-bold uppercase tracking-wider text-on-surface-variant mb-1">
                              Total comparado
                            </label>
                            <div className="px-3 py-2 rounded-xl bg-surface-container-highest text-on-surface font-bold">
                              R$ {total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                            </div>
                          </div>
                          <div className="md:col-span-3">
                            <label className="block text-xs font-bold uppercase tracking-wider text-on-surface-variant mb-1">
                              Observações
                            </label>
                            <textarea
                              value={row.notes}
                              onChange={event => updateQuotationRow(row.id, 'notes', event.target.value)}
                              className="w-full px-3 py-2 bg-surface-container-lowest text-on-surface rounded-xl border border-outline-variant focus:border-primary outline-none resize-none h-20"
                              placeholder="Condição especial, marca, garantia, disponibilidade..."
                            />
                          </div>
                        </div>

                        {row.linkedItems.length > 0 && (
                          <div className="mt-4 rounded-2xl border border-primary/20 bg-primary-container/20 p-3">
                            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2 mb-3">
                              <div>
                                <p className="font-bold text-on-surface flex items-center gap-2">
                                  <Link2 className="w-4 h-4 text-primary" />
                                  Itens reconhecidos nesta cotação
                                </p>
                                <p className="text-xs text-on-surface-variant">
                                  Marque os itens que pertencem a esta compra. O PDF pode trazer vários SKUs do mesmo fornecedor.
                                </p>
                              </div>
                              <span className="text-xs font-bold text-primary">
                                {row.linkedItems.filter(item => item.selected).length} selecionados
                              </span>
                            </div>
                            <div className="grid gap-2">
                              {row.linkedItems.map(linkedItem => (
                                <label
                                  key={linkedItem.id}
                                  className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border p-3 cursor-pointer ${
                                    linkedItem.selected
                                      ? 'border-primary bg-surface'
                                      : 'border-outline-variant bg-surface-container-lowest'
                                  }`}
                                >
                                  <div className="flex items-start gap-3">
                                    <input
                                      type="checkbox"
                                      checked={linkedItem.selected}
                                      onChange={() => toggleLinkedItem(row.id, linkedItem.id)}
                                      className="mt-1"
                                    />
                                    <div>
                                      <p className="font-bold text-on-surface">
                                        {linkedItem.sku} - {linkedItem.itemName}
                                      </p>
                                      <p className="text-xs text-on-surface-variant">
                                        {linkedItem.purchaseType || 'Sem tipo vinculado'} • {linkedItem.classification || 'Sem grupo'} • {getMatchConfidenceLabel(linkedItem.matchConfidence)}
                                      </p>
                                      {linkedItem.lineText && (
                                        <p className="mt-1 text-[11px] text-on-surface-variant line-clamp-2">
                                          Linha do PDF: {linkedItem.lineText}
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                  <div className="text-xs sm:text-right text-on-surface-variant">
                                    {linkedItem.quantity ? <p>Qtd: <strong>{linkedItem.quantity}</strong></p> : null}
                                    {linkedItem.unitPrice ? <p>Unit.: <strong>{formatCurrency(linkedItem.unitPrice)}</strong></p> : null}
                                    {linkedItem.totalPrice ? <p>Total: <strong>{formatCurrency(linkedItem.totalPrice)}</strong></p> : null}
                                  </div>
                                </label>
                              ))}
                            </div>
                          </div>
                        )}

                        <div className="mt-4 rounded-2xl border border-dashed border-outline-variant bg-surface-container-low p-3">
                          <div className="flex flex-col lg:flex-row lg:items-end gap-3">
                            <div className="flex-1">
                              <label className="block text-xs font-bold uppercase tracking-wider text-on-surface-variant mb-1">
                                Vincular item manualmente
                              </label>
                              <select
                                value={manualLinkTargets[row.id] || ''}
                                onChange={event => setManualLinkTargets(previous => ({ ...previous, [row.id]: event.target.value }))}
                                className="w-full px-3 py-2 bg-surface-container-lowest text-on-surface rounded-xl border border-outline-variant focus:border-primary outline-none"
                              >
                                <option value="">Selecione quando o PDF não reconhecer o item</option>
                                {quotationSelectablePurchases
                                  .filter(purchase => !row.linkedItems.some(linkedItem => linkedItem.purchaseId === purchase.id || linkedItem.sku === purchase.sku))
                                  .map(purchase => {
                                    const item = findItemBySku(items, purchase.sku);
                                    const classification = getPurchaseClassificationMeta(getPurchaseClassification(purchase)).label;
                                    return (
                                      <option key={purchase.id} value={purchase.id}>
                                        {getEffectivePurchaseType(item)} / {classification} - {purchase.sku} - {normalizeUserFacingText(purchase.itemName)}
                                      </option>
                                    );
                                  })}
                              </select>
                            </div>
                            <button
                              type="button"
                              onClick={() => addManualLinkedItem(row.id)}
                              className="px-4 py-2 rounded-xl bg-surface text-on-surface border border-outline-variant font-bold hover:bg-surface-container-highest"
                            >
                              Vincular
                            </button>
                          </div>
                          <p className="mt-2 text-xs text-on-surface-variant">
                            Use este campo quando a cotação tiver outros itens do pacote, mas o texto do PDF não vier claro o suficiente.
                          </p>
                        </div>

                        <div className="mt-3 text-xs text-on-surface-variant">
                          Pontuação sugerida: <strong className="text-on-surface">{score.toFixed(2)}</strong> / 5
                          <span className="ml-2">Preço 45%, técnica 35%, prazo 20%.</span>
                        </div>
                      </section>
                    );
                  })}

                  <button
                    type="button"
                    onClick={() => setQuoteRows(previous => [...previous, createEmptyQuotationRow(previous.length + 1)])}
                    className="w-full px-4 py-3 rounded-xl border border-dashed border-primary/50 text-primary font-bold hover:bg-primary/5 flex items-center justify-center gap-2"
                  >
                    <Plus className="w-4 h-4" />
                    Adicionar cotação extra
                  </button>
                </div>

                <aside className="space-y-4">
                  <div className="rounded-2xl border border-outline-variant bg-surface p-4 sticky top-4">
                    <p className="font-bold text-on-surface">Resumo da análise</p>
                    <div className="mt-3 space-y-3 text-sm">
                      <div className="flex justify-between gap-3">
                        <span className="text-on-surface-variant">Quantidade</span>
                        <strong className="text-on-surface">{quotePurchase.suggestedQuantity}</strong>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span className="text-on-surface-variant">Cotações completas</span>
                        <strong className={completeQuoteRows.length >= 3 ? 'text-primary' : 'text-error'}>
                          {completeQuoteRows.length}/3
                        </strong>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span className="text-on-surface-variant">Melhor sugestão</span>
                        <strong className="text-right text-on-surface">
                          {bestQuoteRow ? normalizeUserFacingText(bestQuoteRow.supplierName) : 'Aguardando'}
                        </strong>
                      </div>
                      {bestQuoteRow && (
                        <div className="rounded-xl bg-primary-container/50 text-on-primary-container p-3">
                          <p className="font-bold">Critério automático</p>
                          <p className="text-xs mt-1">
                            O sistema pondera menor total, nota técnica e prazo. A escolha final continua humana.
                          </p>
                        </div>
                      )}
                      <div>
                        <label className="block text-xs font-bold uppercase tracking-wider text-on-surface-variant mb-1">
                          Justificativa da escolha
                        </label>
                        <textarea
                          value={quotationDecisionNote}
                          onChange={event => setQuotationDecisionNote(event.target.value)}
                          className="w-full px-3 py-2 bg-surface-container-lowest text-on-surface rounded-xl border border-outline-variant focus:border-primary outline-none resize-none h-28"
                          placeholder="Ex: escolhido por menor custo total e entrega imediata."
                        />
                      </div>
                    </div>

                    <div className="mt-5 flex flex-col gap-2">
                      <button
                        type="submit"
                        className="w-full px-4 py-3 bg-primary text-on-primary rounded-xl font-bold hover:bg-primary/90 disabled:opacity-60"
                        disabled={completeQuoteRows.length < 3}
                      >
                        Salvar cotações
                      </button>
                      <button
                        type="button"
                        onClick={() => setQuotePurchase(null)}
                        className="w-full px-4 py-3 bg-surface-container-highest text-on-surface rounded-xl font-bold hover:bg-surface-variant"
                      >
                        Fechar sem salvar
                      </button>
                    </div>
                  </div>
                </aside>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}


