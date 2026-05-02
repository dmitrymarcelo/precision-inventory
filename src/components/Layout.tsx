import React, { useEffect, useRef, useState } from 'react';
import {
  Archive,
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
  ScanLine,
  Shield,
  ShoppingCart,
  Users
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { MaterialRequest } from '../types';
import { normalizeUserFacingText } from '../textUtils';

interface LayoutProps {
  children: React.ReactNode;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  requests: MaterialRequest[];
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
  requests,
  authRole,
  onLogout,
  cloudStatus
}: LayoutProps) {
  const [supportsFullscreen, setSupportsFullscreen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);
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

  const openRequestCount = requests.filter(request => {
    if (request.deletedAt) return false;
    const status = normalizeUserFacingText(request.status);
    return status !== 'Atendida' && status !== 'Estornada';
  }).length;

  useEffect(() => {
    const root = document.documentElement;
    setSupportsFullscreen(Boolean(root?.requestFullscreen) && Boolean(document.exitFullscreen));
    const handleChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', handleChange);
    handleChange();
    return () => document.removeEventListener('fullscreenchange', handleChange);
  }, []);

  useEffect(() => {
    if (!isProfileMenuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!profileMenuRef.current?.contains(event.target as Node)) {
        setIsProfileMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsProfileMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isProfileMenuOpen]);

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
  return (
    <div className="min-h-screen pb-24 md:pb-0 flex flex-col">
      <header className="fixed top-0 w-full z-50 bg-slate-50/85 dark:bg-slate-950/85 backdrop-blur-xl shadow-sm dark:shadow-none h-14">
        <div className="flex items-center justify-between px-4 md:px-5 py-3 w-full h-full">
          <div className="flex items-center">
            <Archive className="text-blue-900 dark:text-blue-200" size={22} aria-label="Precision Inventory" />
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
            </div>

            <div className="relative" ref={profileMenuRef}>
              <button
                type="button"
                onClick={() => setIsProfileMenuOpen(current => !current)}
                className="h-9 w-9 rounded-full bg-surface-container-highest overflow-hidden flex items-center justify-center text-on-primary-container font-bold text-xs ring-2 ring-transparent hover:ring-primary/25 transition-all"
                aria-label="Abrir menu do usuário"
                aria-expanded={isProfileMenuOpen}
              >
                <img
                  className="w-full h-full object-cover"
                  src="https://lh3.googleusercontent.com/aida-public/AB6AXuA53BVqxrhuHCQBP8pavZTZAxJbROOTQlQhmuTSmCwtBKqmcZOcl0kpBR7jDWKQqLhSoHwEqquURsCPMvdogYH2hvrMlzBhi5st5M--BTMV1QUhEHP-vIY1dasbWxaIawKZgWrQd3kHaz_8gF7SVHucQoSb_KPIY-LhcfIoc82I30inE_6G_HSJJukJvrGuH8brjXJCst0cZtvdFsSk-6CMcyDeV64XONOFTPb9ATY5yr4Jsxha093eVfjR4hLj5yhN8GwuzmBqEGoA"
                  alt="Usuário"
                />
              </button>

              {isProfileMenuOpen && (
                <div className="absolute right-0 mt-3 w-64 overflow-hidden rounded-2xl border border-outline-variant/20 bg-surface-container-lowest shadow-[0_18px_48px_rgba(36,52,69,0.18)] z-[80]">
                  <div className="p-4 border-b border-outline-variant/15">
                    <p className="text-[11px] font-bold uppercase tracking-widest text-primary">Conta</p>
                    <div className="mt-3 grid gap-2 text-sm">
                      <div className="flex items-center justify-between gap-3 rounded-xl bg-surface-container-low px-3 py-2">
                        <span className="inline-flex items-center gap-2 text-on-surface-variant font-semibold">
                          <Shield size={16} />
                          Permissão
                        </span>
                        <strong className="text-on-surface">{roleLabel}</strong>
                      </div>
                      <div className={`flex items-center justify-between gap-3 rounded-xl px-3 py-2 ${cloudTone}`}>
                        <span className="inline-flex items-center gap-2 font-semibold">
                          <Cloud size={16} />
                          Sistema
                        </span>
                        <strong>{cloudLabel}</strong>
                      </div>
                    </div>
                  </div>

                  <div className="p-2">
                    {authRole === 'admin' && (
                      <button
                        type="button"
                        onClick={() => {
                          setIsProfileMenuOpen(false);
                          setActiveTab('users');
                        }}
                        className="w-full flex items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-bold text-on-surface hover:bg-surface-container-low transition-colors"
                      >
                        <Users size={18} className="text-primary" />
                        Usuários
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setIsProfileMenuOpen(false);
                        onLogout();
                      }}
                      className="w-full flex items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-bold text-error hover:bg-error-container/30 transition-colors"
                    >
                      <LogOut size={18} />
                      Sair
                    </button>
                  </div>
                </div>
              )}
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
