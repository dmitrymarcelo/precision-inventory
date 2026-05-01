import React, { useEffect, useMemo, useRef, useState } from 'react';
import { KeyRound, Pencil, RefreshCcw, Truck, Upload, UserPlus, Users } from 'lucide-react';
import { readSheet } from 'read-excel-file/browser';
import { normalizeUserFacingText } from '../textUtils';
import { VehicleRecord } from '../types';
import { parseVehicleRows, readCsvRows } from '../vehicleBase';

type UserRole = 'consulta' | 'operacao' | 'admin';

type UserRecord = {
  id: string;
  matricula: string;
  name: string;
  role: UserRole;
  active: number;
  createdAt: string;
  updatedAt: string;
};

export default function UserManager({
  token,
  canManageUsers,
  showToast,
  vehicles,
  setVehicles
}: {
  token: string;
  canManageUsers: boolean;
  showToast: (message: string, type?: 'success' | 'info') => void;
  vehicles: VehicleRecord[];
  setVehicles: React.Dispatch<React.SetStateAction<VehicleRecord[]>>;
}) {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [newMatricula, setNewMatricula] = useState('');
  const [newNome, setNewNome] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('consulta');
  const [newSenha, setNewSenha] = useState('');
  const [newSenhaConfirm, setNewSenhaConfirm] = useState('');

  const [editUserId, setEditUserId] = useState<string | null>(null);
  const [editNome, setEditNome] = useState('');
  const [editRole, setEditRole] = useState<UserRole>('consulta');
  const [editActive, setEditActive] = useState(true);

  const [resetUserId, setResetUserId] = useState<string | null>(null);
  const [resetSenha, setResetSenha] = useState('');
  const [resetConfirm, setResetConfirm] = useState('');

  const editTarget = useMemo(() => users.find(u => u.id === editUserId) || null, [users, editUserId]);
  const resetTarget = useMemo(() => users.find(u => u.id === resetUserId) || null, [users, resetUserId]);

  const loadUsers = async () => {
    if (!canManageUsers) return;
    setError('');
    setLoading(true);
    try {
      const response = await fetch('/api/users', { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' });
      const data = (await response.json()) as { ok: boolean; message?: string; users?: UserRecord[] };
      if (!response.ok || !data.ok) {
        setError(data?.message || 'Não foi possível carregar usuários.');
        return;
      }
      setUsers(Array.isArray(data.users) ? data.users : []);
    } catch {
      setError('Falha de conexão.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadUsers();
  }, [token, canManageUsers]);

  const handleVehicleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      showToast(`Lendo base de veículos: ${file.name}...`, 'info');
      const extension = file.name.split('.').pop()?.toLowerCase();
      let rows: unknown[][];

      if (extension === 'xlsx' || extension === 'xls') {
        rows = await readSheet(file);
      } else if (extension === 'csv' || extension === 'txt' || extension === 'tsv') {
        rows = await readCsvRows(file);
      } else {
        showToast('Selecione um arquivo .xlsx, .csv, .txt ou .tsv válido para a base de veículos.', 'info');
        return;
      }

      const importedVehicles = parseVehicleRows(rows);
      if (!importedVehicles.length) {
        showToast('Nenhum veículo válido foi encontrado no arquivo.', 'info');
        return;
      }

      setVehicles(importedVehicles);
      showToast(`Base de veículos importada com sucesso. ${importedVehicles.length} registros carregados.`, 'success');
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : '';
      showToast(
        message
          ? `Não consegui importar a base de veículos. ${message}`
          : 'Não consegui importar a base de veículos. Confira se o arquivo tem placa e centro de custo.',
        'info'
      );
    } finally {
      event.target.value = '';
    }
  };

  const handleCreate = async () => {
    setError('');
    const matricula = newMatricula.trim().replace(/\s+/g, '');
    const nome = newNome.trim();

    if (!matricula || !nome || !newSenha) {
      setError('Informe matrícula, nome e senha.');
      return;
    }
    if (newSenha.length < 4) {
      setError('Senha muito curta (mínimo 4).');
      return;
    }
    if (newSenha !== newSenhaConfirm) {
      setError('As senhas não conferem.');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ matricula, nome, role: newRole, senha: newSenha })
      });
      const data = (await response.json()) as { ok: boolean; message?: string };
      if (!response.ok || !data.ok) {
        setError(data?.message || 'Não foi possível cadastrar.');
        return;
      }

      setNewMatricula('');
      setNewNome('');
      setNewRole('consulta');
      setNewSenha('');
      setNewSenhaConfirm('');
      showToast('Usuário cadastrado.', 'success');
      await loadUsers();
    } catch {
      setError('Falha de conexão.');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleActive = async (user: UserRecord) => {
    setError('');
    setLoading(true);
    try {
      const response = await fetch('/api/users', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ id: user.id, active: user.active !== 1 })
      });
      const data = (await response.json()) as { ok: boolean; message?: string };
      if (!response.ok || !data.ok) {
        setError(data?.message || 'Não foi possível atualizar.');
        return;
      }
      await loadUsers();
    } catch {
      setError('Falha de conexão.');
    } finally {
      setLoading(false);
    }
  };

  const handleChangeRole = async (user: UserRecord, role: UserRole) => {
    setError('');
    setLoading(true);
    try {
      const response = await fetch('/api/users', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ id: user.id, role })
      });
      const data = (await response.json()) as { ok: boolean; message?: string };
      if (!response.ok || !data.ok) {
        setError(data?.message || 'Não foi possível atualizar.');
        return;
      }
      await loadUsers();
    } catch {
      setError('Falha de conexão.');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (!resetTarget) return;
    setError('');
    if (!resetSenha) {
      setError('Informe a nova senha.');
      return;
    }
    if (resetSenha.length < 4) {
      setError('Senha muito curta (mínimo 4).');
      return;
    }
    if (resetSenha !== resetConfirm) {
      setError('As senhas não conferem.');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/users', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ id: resetTarget.id, senha: resetSenha })
      });
      const data = (await response.json()) as { ok: boolean; message?: string };
      if (!response.ok || !data.ok) {
        setError(data?.message || 'Não foi possível atualizar.');
        return;
      }
      setResetUserId(null);
      setResetSenha('');
      setResetConfirm('');
      showToast('Senha atualizada.', 'success');
      await loadUsers();
    } catch {
      setError('Falha de conexão.');
    } finally {
      setLoading(false);
    }
  };

  const openEdit = (user: UserRecord) => {
    setError('');
    setEditUserId(user.id);
    setEditNome(user.name || '');
    setEditRole(user.role);
    setEditActive(user.active === 1);
  };

  const handleSaveEdit = async () => {
    if (!editTarget) return;
    setError('');
    const nome = editNome.trim();
    if (!nome) {
      setError('Informe o nome.');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/users', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ id: editTarget.id, nome, role: editRole, active: editActive })
      });
      const data = (await response.json()) as { ok: boolean; message?: string };
      if (!response.ok || !data.ok) {
        setError(data?.message || 'Não foi possível atualizar.');
        return;
      }
      setEditUserId(null);
      showToast('Usuário atualizado.', 'success');
      await loadUsers();
    } catch {
      setError('Falha de conexão.');
    } finally {
      setLoading(false);
    }
  };

  if (!canManageUsers) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="rounded-2xl border border-outline-variant/20 bg-surface-container-lowest p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <Users size={22} className="text-on-surface-variant" />
            <h2 className="font-headline font-extrabold text-xl text-on-surface">Usuários</h2>
          </div>
          <p className="mt-3 text-sm text-on-surface-variant">Sem permissão para gerenciar usuários.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div className="rounded-2xl border border-outline-variant/20 bg-surface-container-lowest p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Users size={22} className="text-primary" />
            <div>
              <h2 className="font-headline font-extrabold text-xl text-on-surface">Usuários</h2>
              <p className="text-xs text-on-surface-variant">Cadastro e controle por matrícula.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void loadUsers()}
            disabled={loading}
            className="inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-surface-container-highest text-on-surface-variant font-bold text-sm disabled:opacity-60"
          >
            <RefreshCcw size={16} />
            Atualizar
          </button>
        </div>

        {error ? <div className="mt-4 text-sm font-semibold text-error">{error}</div> : null}

        <div className="mt-5 rounded-xl bg-surface-container-low p-4 border border-outline-variant/15">
          <div className="flex items-center gap-2">
            <UserPlus size={18} className="text-primary" />
            <p className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">Novo usuário</p>
          </div>

          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              value={newMatricula}
              onChange={event => setNewMatricula(event.target.value)}
              placeholder="Matrícula"
              className="w-full h-12 rounded-xl px-4 bg-surface-container-lowest border border-outline-variant/20 focus:ring-2 focus:ring-primary/40"
              inputMode="numeric"
            />
            <input
              value={newNome}
              onChange={event => setNewNome(event.target.value)}
              placeholder="Nome"
              className="w-full h-12 rounded-xl px-4 bg-surface-container-lowest border border-outline-variant/20 focus:ring-2 focus:ring-primary/40"
            />
            <select
              value={newRole}
              onChange={event => setNewRole(event.target.value as UserRole)}
              className="w-full h-12 rounded-xl px-4 bg-surface-container-lowest border border-outline-variant/20 focus:ring-2 focus:ring-primary/40 font-bold"
            >
              <option value="consulta">Consulta</option>
              <option value="operacao">Operação</option>
              <option value="admin">Admin</option>
            </select>
            <div className="text-xs text-on-surface-variant flex items-center">
              Dica: admin é quem cadastra e reseta senhas.
            </div>
            <input
              value={newSenha}
              onChange={event => setNewSenha(event.target.value)}
              placeholder="Senha"
              className="w-full h-12 rounded-xl px-4 bg-surface-container-lowest border border-outline-variant/20 focus:ring-2 focus:ring-primary/40"
              type="password"
            />
            <input
              value={newSenhaConfirm}
              onChange={event => setNewSenhaConfirm(event.target.value)}
              placeholder="Confirmar senha"
              className="w-full h-12 rounded-xl px-4 bg-surface-container-lowest border border-outline-variant/20 focus:ring-2 focus:ring-primary/40"
              type="password"
            />
          </div>

          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={loading}
            className="mt-4 w-full h-12 rounded-xl bg-primary text-on-primary font-bold disabled:opacity-60"
          >
            Cadastrar usuário
          </button>
        </div>
      </div>

      <section className="bg-surface-container-lowest rounded-2xl border border-outline-variant/20 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-4">
          <Truck size={18} className="text-primary" />
          <h2 className="font-headline font-bold text-xl tracking-tight">Painel da base de veículos</h2>
        </div>

        <p className="text-sm text-on-surface-variant">
          Importe a planilha com placa, centro de custo e demais características. Essa base alimenta a Solicitação de Peças.
        </p>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-surface-container-low p-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-outline">Veículos</p>
            <p className="font-headline font-bold text-2xl text-on-surface mt-1">{vehicles.length}</p>
          </div>
          <div className="rounded-xl bg-surface-container-low p-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-outline">Centros de custo</p>
            <p className="font-headline font-bold text-2xl text-on-surface mt-1">
              {new Set(vehicles.map(vehicle => vehicle.costCenter)).size}
            </p>
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv,.txt,.tsv"
          className="hidden"
          onChange={handleVehicleImport}
        />

        <div className="mt-4 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="h-11 rounded-lg bg-primary text-on-primary font-bold flex items-center justify-center gap-2"
          >
            <Upload size={18} />
            Importar base de veículos
          </button>
        </div>

        <div className="mt-4 space-y-2">
          {vehicles.length > 0 ? (
            vehicles.slice(0, 4).map(vehicle => (
              <div key={vehicle.id} className="rounded-lg bg-surface-container-low px-4 py-3">
                <p className="font-semibold text-on-surface">{vehicle.plate}</p>
                <p className="text-xs text-on-surface-variant">
                  {normalizeUserFacingText(vehicle.costCenter)}
                  {vehicle.description ? ` • ${normalizeUserFacingText(vehicle.description)}` : ''}
                </p>
              </div>
            ))
          ) : (
            <div className="rounded-lg bg-surface-container-low px-4 py-4 text-sm text-on-surface-variant">
              Ainda não existe base de veículos importada.
            </div>
          )}
        </div>
      </section>

      <div className="rounded-2xl border border-outline-variant/20 bg-surface-container-lowest shadow-sm overflow-hidden">
        <div className="p-5 border-b border-outline-variant/15 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">Lista</p>
            <p className="text-sm text-on-surface-variant mt-1">{users.length} usuários</p>
          </div>
        </div>

        <div className="divide-y divide-outline-variant/10">
          {users.map(user => (
            <div key={user.id} className="p-5 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
              <div className="min-w-0 flex-1">
                <p className="font-extrabold text-on-surface truncate">
                  {normalizeUserFacingText(user.name)} <span className="text-on-surface-variant">• {user.matricula}</span>
                </p>
                <p className="text-xs text-on-surface-variant mt-1">
                  {user.active === 1 ? 'Ativo' : 'Desativado'} • {user.role}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={user.role}
                  onChange={event => void handleChangeRole(user, event.target.value as UserRole)}
                  disabled={loading}
                  className="h-10 px-3 rounded-xl bg-surface-container-highest text-on-surface-variant font-bold text-sm disabled:opacity-60"
                >
                  <option value="consulta">Consulta</option>
                  <option value="operacao">Operação</option>
                  <option value="admin">Admin</option>
                </select>

                <button
                  type="button"
                  onClick={() => setResetUserId(user.id)}
                  disabled={loading}
                  className="inline-flex items-center gap-2 h-10 px-3 rounded-xl bg-surface-container-highest text-on-surface-variant font-bold text-sm disabled:opacity-60"
                >
                  <KeyRound size={16} />
                  Senha
                </button>

                <button
                  type="button"
                  onClick={() => openEdit(user)}
                  disabled={loading}
                  className="inline-flex items-center gap-2 h-10 px-3 rounded-xl bg-surface-container-highest text-on-surface-variant font-bold text-sm disabled:opacity-60"
                >
                  <Pencil size={16} />
                  Editar
                </button>

                <button
                  type="button"
                  onClick={() => void handleToggleActive(user)}
                  disabled={loading}
                  className={`inline-flex items-center gap-2 h-10 px-3 rounded-xl font-bold text-sm disabled:opacity-60 ${
                    user.active === 1 ? 'bg-error-container text-on-error-container' : 'bg-primary-container text-on-primary-container'
                  }`}
                >
                  {user.active === 1 ? 'Desativar' : 'Ativar'}
                </button>
              </div>
            </div>
          ))}

          {users.length === 0 && !loading ? (
            <div className="p-5 text-sm text-on-surface-variant">Nenhum usuário.</div>
          ) : null}
        </div>
      </div>

      {resetTarget ? (
        <div className="fixed inset-0 z-[120] bg-black/40 flex items-end sm:items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-surface-container-lowest border border-outline-variant/20 shadow-[0_18px_48px_rgba(36,52,69,0.22)] overflow-hidden">
            <div className="p-5 border-b border-outline-variant/15">
              <p className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">Resetar senha</p>
              <p className="mt-1 font-extrabold text-on-surface">
                {normalizeUserFacingText(resetTarget.name)} • {resetTarget.matricula}
              </p>
            </div>
            <div className="p-5 space-y-3">
              {error ? <div className="text-sm font-semibold text-error">{error}</div> : null}
              <input
                value={resetSenha}
                onChange={event => setResetSenha(event.target.value)}
                placeholder="Nova senha"
                className="w-full h-12 rounded-xl px-4 bg-surface-container-lowest border border-outline-variant/20 focus:ring-2 focus:ring-primary/40"
                type="password"
              />
              <input
                value={resetConfirm}
                onChange={event => setResetConfirm(event.target.value)}
                placeholder="Confirmar senha"
                className="w-full h-12 rounded-xl px-4 bg-surface-container-lowest border border-outline-variant/20 focus:ring-2 focus:ring-primary/40"
                type="password"
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setResetUserId(null);
                    setResetSenha('');
                    setResetConfirm('');
                    setError('');
                  }}
                  className="flex-1 h-12 rounded-xl bg-surface-container-highest text-on-surface-variant font-bold"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => void handleResetPassword()}
                  disabled={loading}
                  className="flex-1 h-12 rounded-xl bg-primary text-on-primary font-bold disabled:opacity-60"
                >
                  Salvar
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {editTarget ? (
        <div className="fixed inset-0 z-[120] bg-black/40 flex items-end sm:items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-surface-container-lowest border border-outline-variant/20 shadow-[0_18px_48px_rgba(36,52,69,0.22)] overflow-hidden">
            <div className="p-5 border-b border-outline-variant/15">
              <p className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">Editar usuário</p>
              <p className="mt-1 font-extrabold text-on-surface">
                {normalizeUserFacingText(editTarget.name)} • {editTarget.matricula}
              </p>
            </div>
            <div className="p-5 space-y-3">
              {error ? <div className="text-sm font-semibold text-error">{error}</div> : null}
              <input
                value={editNome}
                onChange={event => setEditNome(event.target.value)}
                placeholder="Nome"
                className="w-full h-12 rounded-xl px-4 bg-surface-container-lowest border border-outline-variant/20 focus:ring-2 focus:ring-primary/40"
              />
              <select
                value={editRole}
                onChange={event => setEditRole(event.target.value as UserRole)}
                disabled={loading}
                className="w-full h-12 px-4 rounded-xl bg-surface-container-lowest border border-outline-variant/20 font-bold disabled:opacity-60"
              >
                <option value="consulta">Consulta</option>
                <option value="operacao">Operação</option>
                <option value="admin">Admin</option>
              </select>
              <label className="flex items-center gap-3 text-sm font-bold text-on-surface">
                <input
                  type="checkbox"
                  checked={editActive}
                  onChange={event => setEditActive(event.target.checked)}
                  className="h-5 w-5"
                />
                Ativo
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setEditUserId(null);
                    setError('');
                  }}
                  className="flex-1 h-12 rounded-xl bg-surface-container-highest text-on-surface-variant font-bold"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => void handleSaveEdit()}
                  disabled={loading}
                  className="flex-1 h-12 rounded-xl bg-primary text-on-primary font-bold disabled:opacity-60"
                >
                  Salvar
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
