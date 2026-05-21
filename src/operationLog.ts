import type { InventoryLog, MaterialRequest, MaterialRequestAuditEntry } from './types';
import { normalizeUserFacingText } from './textUtils';

export type SyncEvent = { at: string; event: string; detail?: string };

export type OperationLogModule = 'sync' | 'stock' | 'request';

export type OperationLogEntry = {
  id: string;
  at: string;
  module: OperationLogModule;
  title: string;
  detail: string;
  actor?: string;
  tone: 'default' | 'success' | 'warning' | 'danger';
};

export function buildOperationLogEntries({
  syncEvents,
  inventoryLogs,
  requests
}: {
  syncEvents: SyncEvent[];
  inventoryLogs: InventoryLog[];
  requests: MaterialRequest[];
}) {
  const entries: OperationLogEntry[] = [
    ...syncEvents.map(toSyncEntry),
    ...inventoryLogs.map(toInventoryEntry),
    ...requests.flatMap(request =>
      (request.auditTrail || []).map(entry => toRequestEntry(request, entry))
    )
  ];

  return entries
    .filter(entry => Boolean(entry.at))
    .sort((first, second) => new Date(second.at).getTime() - new Date(first.at).getTime())
    .slice(0, 160);
}

function toSyncEntry(event: SyncEvent): OperationLogEntry {
  return {
    id: `sync-${event.at}-${event.event}-${event.detail || ''}`,
    at: event.at,
    module: 'sync',
    title: formatSyncEvent(event.event),
    detail: event.detail ? normalizeUserFacingText(event.detail) : 'Evento local deste aparelho.',
    tone: getSyncTone(event.event)
  };
}

function toInventoryEntry(log: InventoryLog): OperationLogEntry {
  const delta = Number(log.delta) || 0;
  const deltaText = delta > 0 ? `+${delta}` : String(delta);
  const source = normalizeUserFacingText(log.source || 'inventario');

  return {
    id: `stock-${log.id}`,
    at: log.date,
    module: 'stock',
    title: `SKU ${log.sku} - ${normalizeUserFacingText(log.itemName)}`,
    detail: `${source}: ${deltaText} un, saldo ${log.quantityAfter} em ${normalizeUserFacingText(log.location)}.`,
    tone: log.source === 'divergencia' ? 'warning' : 'default'
  };
}

function toRequestEntry(request: MaterialRequest, entry: MaterialRequestAuditEntry): OperationLogEntry {
  const actor = [entry.actor?.name, entry.actor?.matricula].filter(Boolean).join(' / ');
  return {
    id: `request-${request.id}-${entry.id}`,
    at: entry.at,
    module: 'request',
    title: `${formatRequestEvent(entry.event)} - ${normalizeUserFacingText(request.code)}`,
    detail:
      entry.detail ||
      `${normalizeUserFacingText(request.vehiclePlate) || 'Sem placa'} / ${normalizeUserFacingText(request.costCenter) || 'Sem centro de custo'}`,
    actor: actor || undefined,
    tone: entry.event === 'separation_fulfilled' ? 'success' : 'default'
  };
}

function formatSyncEvent(event: string) {
  switch (event) {
    case 'backend_active':
      return 'Banco online ativo';
    case 'flush_start':
      return 'Sincronizacao iniciada';
    case 'flush_ok':
      return 'Sincronizacao concluida';
    case 'flush_fail':
      return 'Falha ao sincronizar';
    case 'flush_deferred_newer_outbox':
      return 'Sync antigo preservou alteracao nova';
    case 'outbox_write':
      return 'Alteracao entrou na fila de salvamento';
    case 'journal_queued':
      return 'Operacao entrou na ponte segura';
    case 'journal_flush_ok':
      return 'Ponte segura gravada no servidor';
    case 'journal_flush_fail':
      return 'Falha ao gravar ponte segura';
    case 'journal_applied':
      return 'Operacao confirmada no estado online';
    case 'journal_apply_mark_fail':
      return 'Falha ao marcar ponte como aplicada';
    case 'journal_local_confirmed':
      return 'Ponte local ja confirmada no online';
    case 'journal_reconcile_fail':
      return 'Falha ao conferir ponte local';
    case 'journal_discarded':
      return 'Ponte local descartada';
    case 'backup_exported':
      return 'Backup de emergencia exportado';
    case 'cloud_refresh_applied':
      return 'Estado online aplicado';
    case 'cloud_refresh_forced':
      return 'Atualizacao online forcada';
    case 'cloud_update_ignored':
      return 'Atualizacao online ignorada temporariamente';
    case 'offline':
      return 'Aparelho ficou offline';
    default:
      return normalizeUserFacingText(event.replace(/_/g, ' '));
  }
}

function getSyncTone(event: string): OperationLogEntry['tone'] {
  if (event.includes('fail') || event === 'offline') return 'danger';
  if (event.includes('deferred') || event.includes('ignored')) return 'warning';
  if (event.includes('ok') || event.includes('applied') || event.includes('forced')) return 'success';
  return 'default';
}

function formatRequestEvent(event: MaterialRequestAuditEntry['event']) {
  switch (event) {
    case 'request_created':
      return 'Solicitacao criada';
    case 'request_updated':
      return 'Solicitacao atualizada';
    case 'separation_updated':
      return 'Separacao atualizada';
    case 'separation_fulfilled':
      return 'Solicitacao atendida';
    case 'separation_reversed':
      return 'Solicitacao estornada';
    default:
      return normalizeUserFacingText(event);
  }
}
