import React, { useMemo, useState } from 'react';
import { Activity, ClipboardList, Cloud, History, PackageSearch } from 'lucide-react';
import { InventoryLog, MaterialRequest } from '../types';
import { buildOperationLogEntries, OperationLogModule, SyncEvent } from '../operationLog';

type OperationLogPanelProps = {
  syncEvents: SyncEvent[];
  inventoryLogs: InventoryLog[];
  requests: MaterialRequest[];
  cloudStatus: 'loading' | 'online' | 'offline' | 'saving';
  hasLocalPending: boolean;
  cloudUpdatePending: boolean;
  onApplyCloudUpdate?: () => void;
};

type Filter = 'all' | OperationLogModule;

export default function OperationLogPanel({
  syncEvents,
  inventoryLogs,
  requests,
  cloudStatus,
  hasLocalPending,
  cloudUpdatePending,
  onApplyCloudUpdate
}: OperationLogPanelProps) {
  const [filter, setFilter] = useState<Filter>('all');
  const entries = useMemo(
    () => buildOperationLogEntries({ syncEvents, inventoryLogs, requests }),
    [inventoryLogs, requests, syncEvents]
  );
  const filteredEntries = filter === 'all' ? entries : entries.filter(entry => entry.module === filter);

  return (
    <section className="space-y-5">
      <div className="rounded-2xl border border-outline-variant/20 bg-surface-container-lowest p-5 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-primary-container px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-on-primary-container">
              <History size={14} />
              Log do sistema
            </div>
            <h2 className="mt-3 text-2xl md:text-3xl font-headline font-extrabold tracking-tight text-on-surface">
              Log operacional do armazém
            </h2>
            <p className="mt-1 text-sm text-on-surface-variant max-w-3xl">
              Acompanhe salvamentos, falhas de sincronizacao, ajustes de estoque e eventos das solicitacoes.
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <StatusCard label="Sistema" value={formatCloudStatus(cloudStatus)} tone={cloudStatus === 'offline' ? 'danger' : 'default'} />
            <StatusCard label="Pendente local" value={hasLocalPending ? 'Sim' : 'Nao'} tone={hasLocalPending ? 'warning' : 'default'} />
            <StatusCard label="Eventos" value={String(entries.length)} tone="default" />
            <StatusCard label="Online novo" value={cloudUpdatePending ? 'Sim' : 'Nao'} tone={cloudUpdatePending ? 'warning' : 'default'} />
          </div>
        </div>

        {cloudUpdatePending && onApplyCloudUpdate ? (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <p className="text-sm font-semibold text-amber-900">
              Existe atualizacao online aguardando aplicacao neste aparelho.
            </p>
            <button type="button" onClick={onApplyCloudUpdate} className="h-10 px-4 rounded-xl bg-primary text-on-primary font-bold">
              Atualizar agora
            </button>
          </div>
        ) : null}
      </div>

      <div className="rounded-2xl border border-outline-variant/20 bg-surface-container-lowest shadow-sm overflow-hidden">
        <div className="p-4 border-b border-outline-variant/15 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">Linha do tempo</p>
            <p className="text-sm text-on-surface-variant mt-1">Mostrando os eventos mais recentes primeiro.</p>
          </div>
          <div className="grid grid-cols-2 sm:flex gap-2">
            <FilterButton label="Tudo" active={filter === 'all'} onClick={() => setFilter('all')} />
            <FilterButton label="Sync" active={filter === 'sync'} onClick={() => setFilter('sync')} />
            <FilterButton label="Estoque" active={filter === 'stock'} onClick={() => setFilter('stock')} />
            <FilterButton label="Solicitacoes" active={filter === 'request'} onClick={() => setFilter('request')} />
          </div>
        </div>

        <div className="divide-y divide-outline-variant/10">
          {filteredEntries.map(entry => {
            const Icon = getModuleIcon(entry.module);
            return (
              <div key={entry.id} className="p-4 flex items-start gap-3">
                <div className={`mt-1 h-10 w-10 rounded-xl flex items-center justify-center ${getToneClass(entry.tone)}`}>
                  <Icon size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-1">
                    <p className="font-extrabold text-on-surface">{entry.title}</p>
                    <time className="text-xs font-bold text-on-surface-variant">{formatEventTime(entry.at)}</time>
                  </div>
                  <p className="mt-1 text-sm text-on-surface-variant">{entry.detail}</p>
                  {entry.actor ? <p className="mt-1 text-xs font-semibold text-primary">Responsavel: {entry.actor}</p> : null}
                </div>
              </div>
            );
          })}

          {filteredEntries.length === 0 ? (
            <div className="p-8 text-center text-sm text-on-surface-variant">
              Nenhum evento encontrado para este filtro.
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function StatusCard({ label, value, tone }: { label: string; value: string; tone: 'default' | 'warning' | 'danger' }) {
  return (
    <div className={`rounded-xl px-4 py-3 ${tone === 'danger' ? 'bg-error-container text-on-error-container' : tone === 'warning' ? 'bg-amber-100 text-amber-950' : 'bg-surface-container-low text-on-surface'}`}>
      <p className="text-[10px] font-bold uppercase tracking-wider opacity-75">{label}</p>
      <p className="mt-1 text-lg font-headline font-extrabold">{value}</p>
    </div>
  );
}

function FilterButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-10 px-3 rounded-xl text-xs font-bold uppercase tracking-wider ${
        active ? 'bg-primary text-on-primary' : 'bg-surface-container-highest text-on-surface-variant'
      }`}
    >
      {label}
    </button>
  );
}

function getModuleIcon(module: OperationLogModule) {
  if (module === 'sync') return Cloud;
  if (module === 'stock') return PackageSearch;
  if (module === 'request') return ClipboardList;
  return Activity;
}

function getToneClass(tone: 'default' | 'success' | 'warning' | 'danger') {
  if (tone === 'success') return 'bg-primary-container text-on-primary-container';
  if (tone === 'warning') return 'bg-amber-100 text-amber-900';
  if (tone === 'danger') return 'bg-error-container text-on-error-container';
  return 'bg-surface-container-highest text-primary';
}

function formatCloudStatus(status: 'loading' | 'online' | 'offline' | 'saving') {
  if (status === 'online') return 'Online';
  if (status === 'saving') return 'Salvando';
  if (status === 'loading') return 'Conectando';
  return 'Local';
}

function formatEventTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Manaus',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}
