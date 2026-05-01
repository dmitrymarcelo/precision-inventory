import React, { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  Bell,
  ClipboardList,
  ClipboardPlus,
  Cloud,
  History,
  LayoutDashboard,
  LogOut,
  Maximize2,
  Minimize2,
  Package,
  PackageCheck,
  PackageSearch,
  ScanLine,
  Shield,
  ShoppingCart,
  TriangleAlert,
  Users
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { InventoryItem, InventorySettings, MaterialRequest } from '../types';
import { calculateItemStatus } from '../inventoryRules';
import { normalizeLocationText, normalizeUserFacingText } from '../textUtils';

interface LayoutProps {
  children: React.ReactNode;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  items: InventoryItem[];
  settings: InventorySettings;
  requests: MaterialRequest[];
  onSelectSku: (sku: string) => void;
  authRole: 'consulta' | 'operacao' | 'admin';
  onLogout: () => void;
  cloudStatus: 'loading' | 'online' | 'offline' | 'saving';
}

type NavigationItem = {
  key: string;
  label: string;
  icon: LucideIcon;
  badge?: number;
};

export default function Layout({
  children,
  activeTab,
  setActiveTab,
  items,
  settings,
  requests,
  onSelectSku,
  authRole,
  onLogout,
  cloudStatus
}: LayoutProps) {
  const [isAlertsOpen, setIsAlertsOpen] = useState(false);
  const [supportsFullscreen, setSupportsFullscreen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const roleLabel = authRole === 'admin' ? 'Admin' : authRole === 'operacao' ? 'Operação' : 'Consulta';
  const cloudLabel =
    cloudStatus === 'online'
      ? 'Online'
      : cloudStatus === 'saving'
        ? 'Salvando'
        : cloudStatus === 'loading'
          ? 'Conectando'
          : 'Local';
  const cloudTone =
    cloudStatus === 'online'
      ? 'bg-primary-container text-on-primary-container'
      : cloudStatus === 'saving' || cloudStatus === 'loading'
        ? 'bg-surface-container-highest text-on-surface-variant'
        : 'bg-error-container text-on-error-container';

  const alertItems = useMemo(
    () =>
      items
        .filter(item => item.isActiveInWarehouse === true)
        .map(item => ({ item, status: calculateItemStatus(item, settings) }))
        .filter(({ status }) => status === 'Estoque Crítico' || status === 'Repor em Breve'),
    [items, settings]
  );
  const criticalCount = alertItems.filter(({ status }) => status === 'Estoque Crítico').length;
  const reorderCount = alertItems.filter(({ status }) => status === 'Repor em Breve').length;
  const openRequestCount = requests.filter(request => {
    if (request.deletedAt) return false;
    const status = normalizeUserFacingText(request.status);
    return status !== 'Atendida' && status !== 'Estornada';
  }).length;

  const handleAlertSelect = (sku: string) => {
    setIsAlertsOpen(false);
    onSelectSku(sku);
  };

  useEffect(() => {
    const root = document.documentElement;
    setSupportsFullscreen(Boolean(root?.requestFullscreen) && Boolean(document.exitFullscreen));
    const handleChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', handleChange);
    handleChange();
    return () => document.removeEventListener('fullscreenchange', handleChange);
  }, []);

  const toggleFullscreen = async () => {
    if (!supportsFullscreen) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }
      await document.documentElement.requestFullscreen();
    } catch {
      return;
    }
  };

  const navigationItems: NavigationItem[] = [
    { key: 'dashboard', label: 'Painel', icon: LayoutDashboard },
    { key: 'vehicle-parts', label: 'Peças/Modelo', icon: Package },
    { key: 'preventive-kits', label: 'Kit Preventivas', icon: PackageCheck },
    { key: 'requests', label: 'Solicitações', icon: ShoppingCart }
  ];
  if (authRole !== 'consulta') {
    navigationItems.push({
      key: 'separation',
      label: 'Separação',
      icon: ScanLine,
      badge: openRequestCount > 0 ? openRequestCount : undefined
    });
    navigationItems.push({ key: 'inventory', label: 'Estoque', icon: ClipboardList });
  }
  if (authRole === 'admin') {
    navigationItems.push({ key: 'inventory-operations', label: 'Inventário Operacional', icon: ClipboardPlus });
  }
  if (authRole !== 'consulta') {
    navigationItems.push({ key: 'request-history', label: 'Histórico', icon: History });
  }
  if (authRole === 'admin') {
    navigationItems.push({ key: 'users', label: 'Usuários', icon: Users });
  }

  return (
    <div className="min-h-screen pb-24 md:pb-0 flex flex-col">
      <header className="fixed top-0 w-full z-50 bg-slate-50/85 dark:bg-slate-950/85 backdrop-blur-xl shadow-sm dark:shadow-none h-14">
        <div className="flex items-center justify-between px-4 md:px-5 py-3 w-full h-full">
          <div className="flex items-center gap-3">
            <Archive className="text-blue-900 dark:text-blue-200" size={22} />
            <h1 className="font-headline font-bold tracking-tight text-lg text-blue-900 dark:text-blue-100">
              Precision Inventory
            </h1>
          </div>

          <div className="hidden lg:flex items-center gap-2 mr-4">
            {navigationItems.map(item => {
              const Icon = item.icon;
              const isActive = activeTab === item.key;

              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setActiveTab(item.key)}
                  className={`relative h-10 px-3 rounded-lg text-sm font-semibold flex items-center gap-2 transition-colors ${
                    isActive
                      ? 'bg-primary-container text-on-primary-container'
                      : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                  }`}
                >
                  <Icon size={18} />
                  {item.label}
                  {item.badge ? (
                    <span className="inline-flex min-w-5 h-5 px-1 items-center justify-center rounded-full bg-error text-on-error text-[10px] font-bold">
                      {item.badge > 99 ? '99+' : item.badge}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-3">
            <div className="relative flex items-center gap-1">
              <button
                type="button"
                onClick={() => setIsAlertsOpen(current => !current)}
                className="relative p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors active:scale-95 duration-150 text-slate-500"
                aria-label="Abrir alertas de estoque"
              >
                <Bell size={20} />
                {alertItems.length > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-error text-on-error text-[10px] font-bold flex items-center justify-center">
                    {alertItems.length > 99 ? '99+' : alertItems.length}
                  </span>
                )}
              </button>

              {supportsFullscreen && (
                <button
                  type="button"
                  onClick={() => void toggleFullscreen()}
                  className="relative p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors active:scale-95 duration-150 text-slate-500"
                  aria-label={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
                >
                  {isFullscreen ? <Minimize2 size={20} /> : <Maximize2 size={20} />}
                </button>
              )}

              {isAlertsOpen && (
                <div className="absolute right-0 mt-3 w-[min(calc(100vw-2rem),360px)] bg-surface-container-lowest border border-outline-variant/20 rounded-xl shadow-[0_18px_48px_rgba(36,52,69,0.18)] overflow-hidden z-[80]">
                  <div className="p-4 border-b border-outline-variant/20">
                    <div className="flex items-center justify-between">
                      <h2 className="font-headline font-bold text-on-surface">Alertas de estoque</h2>
                      <span className="text-xs font-bold text-error">{alertItems.length} itens</span>
                    </div>
                    <p className="text-xs text-on-surface-variant mt-1">
                      {criticalCount} críticos e {reorderCount} para repor.
                    </p>
                  </div>

                  <div className="max-h-96 overflow-y-auto p-2">
                    {alertItems.length > 0 ? (
                      alertItems.slice(0, 12).map(({ item, status }) => (
                        <button
                          key={item.sku}
                          type="button"
                          onClick={() => handleAlertSelect(item.sku)}
                          className="w-full text-left p-3 rounded-lg flex items-center gap-3 hover:bg-surface-container-low transition-colors"
                        >
                          <div className="w-10 h-10 rounded-lg bg-surface-container-low flex items-center justify-center shrink-0">
                            {status === 'Estoque Crítico' ? (
                              <TriangleAlert className="text-error" size={20} />
                            ) : (
                              <PackageSearch className="text-primary" size={20} />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-bold text-on-surface truncate">{normalizeUserFacingText(item.name)}</p>
                            <p className="text-xs text-on-surface-variant truncate">
                              SKU {item.sku} • {normalizeLocationText(item.location)}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className={`text-sm font-bold ${status === 'Estoque Crítico' ? 'text-error' : 'text-primary'}`}>
                              {item.quantity}
                            </p>
                            <p className="text-[10px] text-on-surface-variant uppercase">un</p>
                          </div>
                        </button>
                      ))
                    ) : (
                      <div className="p-6 text-center text-sm text-on-surface-variant">
                        Nenhum alerta ativo agora.
                      </div>
                    )}
                  </div>

                  {alertItems.length > 12 && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsAlertsOpen(false);
                        setActiveTab('dashboard');
                      }}
                      className="w-full p-3 bg-surface-container-low text-primary font-bold text-sm hover:bg-surface-container-high transition-colors"
                    >
                      Ver todos no Painel
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="hidden sm:flex items-center gap-2">
              <span
                className={`inline-flex items-center gap-2 h-9 px-3 rounded-xl text-xs font-bold uppercase tracking-wider ${
                  authRole === 'operacao'
                    ? 'bg-primary-container text-on-primary-container'
                    : 'bg-surface-container-highest text-on-surface-variant'
                }`}
              >
                <Shield size={16} />
                {roleLabel}
              </span>
              <button
                type="button"
                onClick={onLogout}
                className="inline-flex items-center gap-2 h-9 px-3 rounded-xl bg-surface-container-highest text-on-surface-variant font-bold text-xs uppercase tracking-wider hover:bg-surface-container-high transition-colors"
              >
                <LogOut size={16} />
                Sair
              </button>
            </div>

            <div className="h-8 w-8 rounded-full bg-surface-container-highest overflow-hidden flex items-center justify-center text-on-primary-container font-bold text-xs">
              <img
                className="w-full h-full object-cover"
                src="https://lh3.googleusercontent.com/aida-public/AB6AXuA53BVqxrhuHCQBP8pavZTZAxJbROOTQlQhmuTSmCwtBKqmcZOcl0kpBR7jDWKQqLhSoHwEqquURsCPMvdogYH2hvrMlzBhi5st5M--BTMV1QUhEHP-vIY1dasbWxaIawKZgWrQd3kHaz_8gF7SVHucQoSb_KPIY-LhcfIoc82I30inE_6G_HSJJukJvrGuH8brjXJCst0cZtvdFsSk-6CMcyDeV64XONOFTPb9ATY5yr4Jsxha093eVfjR4hLj5yhN8GwuzmBqEGoA"
                alt="Usuário"
              />
            </div>
          </div>
        </div>
        <div className="bg-slate-200/50 dark:bg-slate-800/50 h-[1px] w-full mb-px" />
      </header>

      <main className="flex-grow pt-20 pb-8 px-3 sm:px-4 lg:px-6 xl:px-8 2xl:px-10 max-w-[1720px] 2xl:max-w-[1880px] mx-auto w-full">
        {children}
      </main>

      <nav className="lg:hidden fixed bottom-0 left-0 w-full overflow-x-auto bg-slate-50/85 dark:bg-slate-900/85 backdrop-blur-xl z-50 shadow-[0_-4px_12px_rgba(36,52,69,0.06)] border-t border-slate-200 dark:border-slate-800">
        <div className="min-w-max px-3 py-3 flex items-center gap-2">
          {navigationItems.map(item => {
            const Icon = item.icon;
            const isActive = activeTab === item.key;

            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setActiveTab(item.key)}
                className={`relative flex flex-col items-center justify-center px-4 py-2 rounded-xl active:scale-90 transition-transform duration-200 ${
                  isActive
                    ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-900 dark:text-blue-100'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                <Icon size={20} className="mb-1" />
                <span className="font-label text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap">
                  {item.label}
                </span>
                {item.badge ? (
                  <span className="absolute top-1 right-1 min-w-4 h-4 px-1 rounded-full bg-error text-on-error text-[9px] font-bold flex items-center justify-center">
                    {item.badge > 99 ? '99+' : item.badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
