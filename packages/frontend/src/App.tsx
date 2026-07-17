import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, NavLink, Link, useSearchParams } from 'react-router-dom';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard, Users, Building2, TrendingUp, Phone,
  CheckSquare, BarChart3, Settings as SettingsIcon, Zap, Shield,
  LogOut, CreditCard, BarChart2, LifeBuoy, List, Clock, Mail, Bot, Package,
  FileText, Layers, MessageCircle, Key, Bell, Lock, ChevronDown, ChevronRight,
  FileSpreadsheet, ShoppingCart, BookOpen, Tag, MapPin,
} from 'lucide-react';
import { useAuthStore } from './store/auth.store';
import { useIsSuperAdmin, useIsAdmin, useIsTenantAdmin, useHasRole, useIsPolicyAdmin } from './hooks/useRole';
import { useApplyAppearance } from './hooks/useApplyAppearance';
import { api } from './services/api';
import { NotificationBell } from './components/NotificationBell';
import { CallWidget } from './components/CallWidget';
import { Dashboard }    from './pages/Dashboard';
import { VoiceCalls }   from './pages/VoiceCalls';
import { Billing }      from './pages/Billing';
import { LoginPage }    from './pages/Login';
import { RegisterPage } from './pages/Register';
import { Contacts }     from './pages/Contacts';
import { Companies }    from './pages/Companies';
import { Deals }        from './pages/Deals';
import { Activities }   from './pages/Activities';
import { Analytics }    from './pages/Analytics';
import { Integrations } from './pages/Integrations';
import { Settings, ModulesSettings, RoutingSettings } from './pages/Settings';
import { SuperAdmin }       from './pages/SuperAdmin';
import { VoiceAnalytics }   from './pages/VoiceAnalytics';
import { Tickets }          from './pages/Tickets';
import { TicketQueues }     from './pages/TicketQueues';
import { Wallboard }        from './pages/Wallboard';
import { TicketSla }        from './pages/TicketSla';
import { Emails }           from './pages/Emails';
import { VoiceBotConfig }  from './pages/VoiceBotConfig';
import { VoiceBotCalls }   from './pages/VoiceBotCalls';
import { VoiceBotTickets } from './pages/VoiceBotTickets';
import { ContactDetail }   from './pages/ContactDetail';
import { ForgotPassword }  from './pages/ForgotPassword';
import { ResetPassword }   from './pages/ResetPassword';
import { RolesPage }          from './pages/Roles';
import { PersonalSettings }   from './pages/PersonalSettings';
import { TenantAdminDashboard } from './pages/TenantAdminDashboard';
import { Departments }          from './pages/Departments';
import { AdminUsers }           from './pages/admin/AdminUsers';
// Sales & Invoicing module
import { SalesDashboard }    from './pages/sales/SalesDashboard';
import { InvoiceList }       from './pages/sales/InvoiceList';
import { InvoiceCreate }     from './pages/sales/InvoiceCreate';
import { InvoiceDetail }     from './pages/sales/InvoiceDetail';
import { SalesContacts }     from './pages/sales/SalesContacts';
import { SalesPayments }     from './pages/sales/SalesPayments';
import { SalesReports }      from './pages/sales/SalesReports';
import { SalesTemplates }    from './pages/sales/SalesTemplates';
import { SalesBuilder }      from './pages/sales/SalesBuilder';
import { SalesSettingsPage } from './pages/sales/SalesSettings';
import { TeamReports }       from './pages/TeamReports';
import { FieldTeamView }     from './pages/FieldTeamView';
import { TicketReports }     from './pages/TicketReports';
import { Reports }           from './pages/Reports';
import { EmailAnalytics }    from './pages/EmailAnalytics';
import { IntegrationHealth } from './pages/IntegrationHealth';
import { TeamMessaging }     from './pages/TeamMessaging';
import CsatSurvey            from './pages/CsatSurvey';
import { GovernancePage }    from './pages/Governance';
import { OrdersPage }        from './pages/Orders';
import { CustomFieldsPage }  from './pages/CustomFields';

// Exported so auth.store.ts can wipe all cached data on logout — otherwise a
// different account logging in on the same tab (e.g. tenant admin -> super
// admin) briefly renders the previous account's cached queries.
export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

// ── Icon resolver ─────────────────────────────────────────────────────────
// Maps icon name strings (from the API) to Lucide components.
const ICON_MAP: Record<string, React.ElementType> = {
  LayoutDashboard, Users, Building2, TrendingUp, Phone,
  CheckSquare, BarChart3, BarChart2, Zap, CreditCard,
  LifeBuoy, List, Clock, Shield, Mail, Bot,
  FileText, Layers, MessageCircle, Settings: SettingsIcon,
};
function resolveIcon(name: string): React.ElementType {
  return ICON_MAP[name] ?? LayoutDashboard;
}

// ── Module nav item type ──────────────────────────────────────────────────
interface NavItem {
  path: string;
  label: string;
  icon: string;
}
interface ActiveModule {
  id: string;
  label: string;
  icon: string;
  navItems: NavItem[];
}


const AGENT_STATUSES = [
  { value: 'online', label: 'Online',  dot: 'bg-emerald-400' },
  { value: 'busy',   label: 'Busy',    dot: 'bg-red-400'     },
  { value: 'away',   label: 'Away',    dot: 'bg-yellow-400'  },
  { value: 'offline',label: 'Offline', dot: 'bg-gray-400'    },
] as const;

function AgentStatusPicker({ isTenantAdmin, isSuperAdmin }: { isTenantAdmin: boolean; isSuperAdmin: boolean }) {
  const [status, setStatus] = React.useState<string>('offline');
  const [open, setOpen]     = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  // Load current status on mount
  React.useEffect(() => {
    if (isTenantAdmin || isSuperAdmin) return;
    api.get('/api/v1/settings/me/status').then(r => {
      if (r.data?.data?.status) setStatus(r.data.data.status);
    }).catch(() => {});
  }, [isTenantAdmin, isSuperAdmin]);

  // Close on outside click
  React.useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  if (isTenantAdmin || isSuperAdmin) return null;

  const current = AGENT_STATUSES.find(s => s.value === status) ?? AGENT_STATUSES[3];

  const pick = async (val: string) => {
    setStatus(val);
    setOpen(false);
    await api.patch('/api/v1/settings/me/status', { status: val });
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
        title="Set your status"
      >
        <span className={`w-2 h-2 rounded-full shrink-0 ${current.dot}`} />
        <span className="text-[10px] text-white/70 font-medium">{current.label}</span>
      </button>
      {open && (
        <div className="absolute bottom-8 left-0 w-36 bg-white rounded-xl shadow-xl border border-gray-100 py-1 z-50">
          {AGENT_STATUSES.map(s => (
            <button
              key={s.value}
              onClick={() => pick(s.value)}
              className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 transition-colors ${status === s.value ? 'font-semibold text-gray-900' : 'text-gray-700'}`}
            >
              <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${s.dot}`} />
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Super Admin's own section nav — lives in the sidebar (see note above) ──
// Uses ?tab=<key> on /super-admin rather than separate routes, matching how
// SuperAdmin.tsx already tracked activeTab (previously local useState, now
// lifted into the URL so the sidebar and page agree on what's selected).
const SUPER_ADMIN_NAV = [
  { key: 'dashboard',  label: 'Dashboard',        icon: BarChart3    },
  { key: 'tenants',    label: 'Tenants',          icon: Building2    },
  { key: 'billing',    label: 'Billing',          icon: TrendingUp   },
  { key: 'catalogue',  label: 'Module Catalogue', icon: Package      },
  { key: 'orders',     label: 'Tenant Orders',    icon: ShoppingCart },
  { key: 'roles',      label: 'Sub-Admin Roles',  icon: Shield       },
  { key: 'sub-admins', label: 'Sub-Admins',       icon: Users        },
  { key: 'reports',    label: 'Reports',          icon: BarChart2    },
  { key: 'alerts',     label: 'Alerts',           icon: Bell         },
  { key: 'settings',   label: 'Settings',         icon: Lock         },
] as const;

function SuperAdminSidebarNav() {
  const [searchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') ?? 'dashboard';
  return (
    <div className="space-y-0.5">
      <p className="px-3 mb-1 text-[10px] font-bold text-brand-300/60 uppercase tracking-widest">Platform</p>
      {SUPER_ADMIN_NAV.map(({ key, label, icon: Icon }) => {
        const isActive = activeTab === key;
        return (
          <Link key={key} to={`/super-admin?tab=${key}`}
            className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all ${
              isActive ? 'text-white font-semibold' : 'text-white/60 hover:text-white hover:bg-white/10'
            }`}
            style={isActive ? {
              background: 'linear-gradient(135deg, rgba(41,171,226,0.25) 0%, rgba(77,139,60,0.15) 100%)',
              borderLeft: '2px solid #29ABE2',
            } : {}}
          >
            <Icon className="w-4 h-4 shrink-0" />
            {label}
          </Link>
        );
      })}
    </div>
  );
}

function Sidebar() {
  const { user, tenant, logout } = useAuthStore();
  const isSuperAdmin  = useIsSuperAdmin();
  const isAdmin       = useIsAdmin();
  const isTenantAdmin = useIsTenantAdmin();
  const isManager     = useHasRole('manager');
  const isPolicyAdmin = useIsPolicyAdmin();
  const [analyticsOpen, setAnalyticsOpen] = React.useState(true);

  // Fetch active modules from the API — drives the sidebar dynamically
  // (super_admin has no workspace, so this endpoint always 403s for them — skip it)
  const { data: modulesData } = useQuery<ActiveModule[]>({
    queryKey: ['modules'],
    queryFn: async () => {
      const res = await api.get('/api/v1/modules');
      return res.data.data;
    },
    staleTime: 60_000,
    enabled: !isSuperAdmin,
  });

  const modules: ActiveModule[] = modulesData ?? [];

  return (
    <div className="w-56 flex flex-col h-full" style={{ background: 'linear-gradient(180deg, #062840 0%, #0a4162 60%, #0f5c85 100%)' }}>

      {/* ── Logo / Workspace ──────────────────────────────────────── */}
      <div className="px-4 py-5 border-b border-white/10">
        {/* Wordmark */}
        <div className="flex items-center gap-2.5 mb-3">
          {/* Brand icon: the X-shape from the logo, simplified */}
          <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
               style={{ background: 'linear-gradient(135deg, #29ABE2 0%, #4D8B3C 100%)' }}>
            <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white" xmlns="http://www.w3.org/2000/svg">
              {/* Simplified X chevron from the logo */}
              <path d="M5 5 L10 12 L5 19 H9 L12 14.5 L15 19 H19 L14 12 L19 5 H15 L12 9.5 L9 5 Z" />
            </svg>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-white leading-tight truncate">AmanahCX</p>
          </div>
        </div>

        {/* Workspace chip */}
        <div className="bg-white/10 rounded-xl px-3 py-2">
          <p className="text-xs font-semibold text-white truncate">{tenant?.name ?? 'Workspace'}</p>
          <p className="text-[10px] capitalize mt-0.5" style={{ color: '#F5C518' }}>
            {tenant?.plan ?? 'free'} plan
          </p>
        </div>
      </div>

      {/* ── Navigation ───────────────────────────────────────────── */}
      <nav className="flex-1 px-2 py-4 space-y-0.5 overflow-y-auto">

        {/* ── Tenant Admin sidebar ─────────────────────────────────── */}
        {isTenantAdmin && (
          <>
            {/* Dashboard */}
            <NavLink to="/admin" end
              className={({ isActive }) => `flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all ${isActive ? 'text-white font-semibold' : 'text-white/60 hover:text-white hover:bg-white/10'}`}
              style={({ isActive }) => isActive ? { background: 'linear-gradient(135deg, rgba(41,171,226,0.25) 0%, rgba(77,139,60,0.15) 100%)', borderLeft: '2px solid #29ABE2' } : {}}
            ><LayoutDashboard className="w-4 h-4 shrink-0" />Dashboard</NavLink>

            {/* People section */}
            <p className="px-3 pt-3 pb-1 text-[10px] font-bold text-brand-300/60 uppercase tracking-widest">People</p>
            <NavLink to="/admin/users"
              className={({ isActive }) => `flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all ${isActive ? 'text-white font-semibold' : 'text-white/60 hover:text-white hover:bg-white/10'}`}
              style={({ isActive }) => isActive ? { background: 'linear-gradient(135deg, rgba(41,171,226,0.25) 0%, rgba(77,139,60,0.15) 100%)', borderLeft: '2px solid #29ABE2' } : {}}
            ><Users className="w-4 h-4 shrink-0" />Users</NavLink>
            <NavLink to="/roles"
              className={({ isActive }) => `flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all ${isActive ? 'text-white font-semibold' : 'text-white/60 hover:text-white hover:bg-white/10'}`}
              style={({ isActive }) => isActive ? { background: 'linear-gradient(135deg, rgba(41,171,226,0.25) 0%, rgba(77,139,60,0.15) 100%)', borderLeft: '2px solid #29ABE2' } : {}}
            ><Shield className="w-4 h-4 shrink-0" />Roles & Permissions</NavLink>
            <NavLink to="/departments"
              className={({ isActive }) => `flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all ${isActive ? 'text-white font-semibold' : 'text-white/60 hover:text-white hover:bg-white/10'}`}
              style={({ isActive }) => isActive ? { background: 'linear-gradient(135deg, rgba(41,171,226,0.25) 0%, rgba(77,139,60,0.15) 100%)', borderLeft: '2px solid #29ABE2' } : {}}
            ><Building2 className="w-4 h-4 shrink-0" />Departments</NavLink>

            {/* Workspace section */}
            <p className="px-3 pt-3 pb-1 text-[10px] font-bold text-brand-300/60 uppercase tracking-widest">Workspace</p>
            <NavLink to="/admin/modules"
              className={({ isActive }) => `flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all ${isActive ? 'text-white font-semibold' : 'text-white/60 hover:text-white hover:bg-white/10'}`}
              style={({ isActive }) => isActive ? { background: 'linear-gradient(135deg, rgba(41,171,226,0.25) 0%, rgba(77,139,60,0.15) 100%)', borderLeft: '2px solid #29ABE2' } : {}}
            ><Layers className="w-4 h-4 shrink-0" />Modules</NavLink>
            {/* Integrations — optional module; only when the workspace is licensed for it */}
            {((tenant as any)?.active_modules ?? []).includes('integrations') && (
              <NavLink to="/integrations"
                className={({ isActive }) => `flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all ${isActive ? 'text-white font-semibold' : 'text-white/60 hover:text-white hover:bg-white/10'}`}
                style={({ isActive }) => isActive ? { background: 'linear-gradient(135deg, rgba(41,171,226,0.25) 0%, rgba(77,139,60,0.15) 100%)', borderLeft: '2px solid #29ABE2' } : {}}
              ><Zap className="w-4 h-4 shrink-0" />Integrations</NavLink>
            )}
            {/* Voice Bot — administrative configuration (name, voice, tone,
                ticket rules); only when the workspace is licensed for it */}
            {((tenant as any)?.active_modules ?? []).includes('voice_bot') && (
              <NavLink to="/voice-bot"
                className={({ isActive }) => `flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all ${isActive ? 'text-white font-semibold' : 'text-white/60 hover:text-white hover:bg-white/10'}`}
                style={({ isActive }) => isActive ? { background: 'linear-gradient(135deg, rgba(41,171,226,0.25) 0%, rgba(77,139,60,0.15) 100%)', borderLeft: '2px solid #29ABE2' } : {}}
              ><Bot className="w-4 h-4 shrink-0" />Voice Bot</NavLink>
            )}
            <NavLink to="/settings"
              end
              className={({ isActive }) => `flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all ${isActive ? 'text-white font-semibold' : 'text-white/60 hover:text-white hover:bg-white/10'}`}
              style={({ isActive }) => isActive ? { background: 'linear-gradient(135deg, rgba(41,171,226,0.25) 0%, rgba(77,139,60,0.15) 100%)', borderLeft: '2px solid #29ABE2' } : {}}
            ><SettingsIcon className="w-4 h-4 shrink-0" />General Settings</NavLink>
            <NavLink to="/admin/routing"
              className={({ isActive }) => `flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all ${isActive ? 'text-white font-semibold' : 'text-white/60 hover:text-white hover:bg-white/10'}`}
              style={({ isActive }) => isActive ? { background: 'linear-gradient(135deg, rgba(41,171,226,0.25) 0%, rgba(77,139,60,0.15) 100%)', borderLeft: '2px solid #29ABE2' } : {}}
            ><Clock className="w-4 h-4 shrink-0" />Routing & SLA</NavLink>
            <NavLink to="/admin/custom-fields"
              className={({ isActive }) => `flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all ${isActive ? 'text-white font-semibold' : 'text-white/60 hover:text-white hover:bg-white/10'}`}
              style={({ isActive }) => isActive ? { background: 'linear-gradient(135deg, rgba(41,171,226,0.25) 0%, rgba(77,139,60,0.15) 100%)', borderLeft: '2px solid #29ABE2' } : {}}
            ><Tag className="w-4 h-4 shrink-0" />Custom Fields</NavLink>
            <NavLink to="/tickets"
              className={({ isActive }) => `flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all ${isActive ? 'text-white font-semibold' : 'text-white/60 hover:text-white hover:bg-white/10'}`}
              style={({ isActive }) => isActive ? { background: 'linear-gradient(135deg, rgba(41,171,226,0.25) 0%, rgba(77,139,60,0.15) 100%)', borderLeft: '2px solid #29ABE2' } : {}}
            ><LifeBuoy className="w-4 h-4 shrink-0" />Tickets</NavLink>

            {/* Governance & Orders section */}
            <p className="px-3 pt-3 pb-1 text-[10px] font-bold text-brand-300/60 uppercase tracking-widest">Governance</p>
            <NavLink to="/governance"
              className={({ isActive }) => `flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all ${isActive ? 'text-white font-semibold' : 'text-white/60 hover:text-white hover:bg-white/10'}`}
              style={({ isActive }) => isActive ? { background: 'linear-gradient(135deg, rgba(41,171,226,0.25) 0%, rgba(77,139,60,0.15) 100%)', borderLeft: '2px solid #29ABE2' } : {}}
            ><BookOpen className="w-4 h-4 shrink-0" />Data & Privacy Policies</NavLink>
            <NavLink to="/orders"
              className={({ isActive }) => `flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all ${isActive ? 'text-white font-semibold' : 'text-white/60 hover:text-white hover:bg-white/10'}`}
              style={({ isActive }) => isActive ? { background: 'linear-gradient(135deg, rgba(41,171,226,0.25) 0%, rgba(77,139,60,0.15) 100%)', borderLeft: '2px solid #29ABE2' } : {}}
            ><ShoppingCart className="w-4 h-4 shrink-0" />Orders & Upgrades</NavLink>

            {/* Security section */}
            <p className="px-3 pt-3 pb-1 text-[10px] font-bold text-brand-300/60 uppercase tracking-widest">Security</p>
            <NavLink to="/settings/personal"
              className={({ isActive }) => `flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all ${isActive ? 'text-white font-semibold' : 'text-white/60 hover:text-white hover:bg-white/10'}`}
              style={({ isActive }) => isActive ? { background: 'linear-gradient(135deg, rgba(41,171,226,0.25) 0%, rgba(77,139,60,0.15) 100%)', borderLeft: '2px solid #29ABE2' } : {}}
            ><Lock className="w-4 h-4 shrink-0" />Security & Password</NavLink>
            <NavLink to="/settings/notifications"
              className={({ isActive }) => `flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all ${isActive ? 'text-white font-semibold' : 'text-white/60 hover:text-white hover:bg-white/10'}`}
              style={({ isActive }) => isActive ? { background: 'linear-gradient(135deg, rgba(41,171,226,0.25) 0%, rgba(77,139,60,0.15) 100%)', borderLeft: '2px solid #29ABE2' } : {}}
            ><Bell className="w-4 h-4 shrink-0" />Notifications</NavLink>
          </>
        )}

        {/* Dashboard — home page for agents/managers; there is no other way
            back to it once you navigate elsewhere in the sidebar. */}
        {!isTenantAdmin && !isSuperAdmin && (
          <NavLink to="/dashboard" end
            className={({ isActive }) => `flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all ${isActive ? 'text-white font-semibold' : 'text-white/60 hover:text-white hover:bg-white/10'}`}
            style={({ isActive }) => isActive ? { background: 'linear-gradient(135deg, rgba(41,171,226,0.25) 0%, rgba(77,139,60,0.15) 100%)', borderLeft: '2px solid #29ABE2' } : {}}
          ><LayoutDashboard className="w-4 h-4 shrink-0" />Dashboard</NavLink>
        )}

        {/* ── Super Admin's own sections — was a horizontally-scrolling tab bar
            crammed into the page header, leaving this entire sidebar empty.
            Moved here 2026-07-17 so it's actually usable and uses the space. ── */}
        {isSuperAdmin && <SuperAdminSidebarNav />}

        {/* ── Operational staff module nav ─────────────────────────── */}
        {!isTenantAdmin && modules.map((mod) => (
          <div key={mod.id}>
            {modules.length > 1 && (
              <p className="px-3 mb-1 text-[10px] font-bold text-brand-300/60 uppercase tracking-widest">
                {mod.label}
              </p>
            )}
            <div className="space-y-0.5">
              {mod.navItems.map((item) => {
                const Icon = resolveIcon(item.icon);
                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    className={({ isActive }) =>
                      `flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all ${
                        isActive
                          ? 'text-white font-semibold shadow-sm'
                          : 'text-white/60 hover:text-white hover:bg-white/10'
                      }`
                    }
                    style={({ isActive }) => isActive ? {
                      background: 'linear-gradient(135deg, rgba(41,171,226,0.25) 0%, rgba(77,139,60,0.15) 100%)',
                      borderLeft: '2px solid #29ABE2',
                    } : {}}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    {item.label}
                  </NavLink>
                );
              })}
            </div>
          </div>
        ))}

        {/* Team Messaging — available to tenant admins and operational staff;
            platform super admins have no tenant/workspace access at all. */}
        {!isSuperAdmin && (
          <NavLink to="/messages"
            className={({ isActive }) =>
              `flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all ${
                isActive ? 'text-white font-semibold' : 'text-white/60 hover:text-white hover:bg-white/10'
              }`
            }
            style={({ isActive }) => isActive ? {
              background: 'linear-gradient(135deg, rgba(41,171,226,0.25) 0%, rgba(77,139,60,0.15) 100%)',
              borderLeft: '2px solid #29ABE2',
            } : {}}
          >
            <MessageCircle className="w-4 h-4 shrink-0" />
            Messaging
          </NavLink>
        )}

        {/* Integrations — admin (keeps the system/network live) or permitted users.
            Billing — Finance/Sales function only: granted by the 'billing:read'
            permission, NOT the admin role. The tenant admin never sees billing. */}
        {(() => {
          const perms = (user as any)?.permissions ?? {};
          const gatedLinks = [
            { to: '/integrations', label: 'Integrations', icon: 'Zap',        key: 'integrations:read', adminBypass: true  },
            { to: '/billing',      label: 'Billing',      icon: 'CreditCard', key: 'billing:read',      adminBypass: false },
          ].filter((l) => !isTenantAdmin && !isSuperAdmin && ((l.adminBypass && isAdmin) || perms[l.key] === true));
          if (gatedLinks.length === 0) return null;
          return (
            <>
              {modules.length > 0 && <div className="border-t border-white/10 mx-1" />}
              <div className="space-y-0.5">
                {gatedLinks.map(({ to, label, icon }) => {
                  const Icon = resolveIcon(icon);
                  return (
                    <NavLink key={to} to={to} end
                      className={({ isActive }) =>
                        `flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all ${
                          isActive ? 'text-white font-semibold' : 'text-white/60 hover:text-white hover:bg-white/10'
                        }`
                      }
                      style={({ isActive }) => isActive ? {
                        background: 'linear-gradient(135deg, rgba(41,171,226,0.25) 0%, rgba(77,139,60,0.15) 100%)',
                        borderLeft: '2px solid #29ABE2',
                      } : {}}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      {label}
                    </NavLink>
                  );
                })}
                {/* Integration Health — sub-link under Integrations */}
                {!isTenantAdmin && !isSuperAdmin && isAdmin && (
                  <NavLink to="/integrations/health"
                    className={({ isActive }) =>
                      `flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all ${
                        isActive ? 'text-white font-semibold' : 'text-white/60 hover:text-white hover:bg-white/10'
                      }`
                    }
                    style={({ isActive }) => isActive ? {
                      background: 'linear-gradient(135deg, rgba(41,171,226,0.25) 0%, rgba(77,139,60,0.15) 100%)',
                      borderLeft: '2px solid #29ABE2',
                    } : {}}
                  >
                    {(() => { const I = resolveIcon('Activity'); return <I className="w-4 h-4 shrink-0" />; })()}
                    Integration Health
                  </NavLink>
                )}
              </div>
            </>
          );
        })()}
      </nav>

      {/* ── Footer: gated admin links + user chip ─────────────────── */}
      <div className="px-2 py-3 border-t border-white/10 space-y-0.5">

        {/* Roles — admins only (not tenant admin, they have it in their own sidebar; not super admin, they have no workspace) */}
        {isAdmin && !isTenantAdmin && !isSuperAdmin && (
          <NavLink to="/roles"
            className={({ isActive }) =>
              `flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all ${
                isActive ? 'text-white font-semibold' : 'text-white/60 hover:text-white hover:bg-white/10'
              }`
            }
            style={({ isActive }) => isActive ? {
              background: 'linear-gradient(135deg, rgba(41,171,226,0.25) 0%, rgba(77,139,60,0.15) 100%)',
              borderLeft: '2px solid #29ABE2',
            } : {}}
          >
            <Shield className="w-4 h-4" />
            Roles
          </NavLink>
        )}

        {/* System Settings — for non-tenant-admin users with settings:read */}
        {!isTenantAdmin && !isSuperAdmin && (isAdmin || (user as any)?.permissions?.['settings:read']) && (
          <NavLink to="/settings"
            className={({ isActive }) =>
              `flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all ${
                isActive ? 'text-white font-semibold' : 'text-white/60 hover:text-white hover:bg-white/10'
              }`
            }
            style={({ isActive }) => isActive ? {
              background: 'linear-gradient(135deg, rgba(41,171,226,0.25) 0%, rgba(77,139,60,0.15) 100%)',
              borderLeft: '2px solid #29ABE2',
            } : {}}
          >
            <SettingsIcon className="w-4 h-4" />
            Settings
          </NavLink>
        )}

        {/* Reports — managers AND agents (not tenant admin) */}
        {!isSuperAdmin && !isTenantAdmin && (
          <NavLink to="/reports"
            className={({ isActive }) =>
              `flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all ${
                isActive ? 'text-white font-semibold' : 'text-white/60 hover:text-white hover:bg-white/10'
              }`
            }
            style={({ isActive }) => isActive ? {
              background: 'linear-gradient(135deg, rgba(41,171,226,0.25) 0%, rgba(77,139,60,0.15) 100%)',
              borderLeft: '2px solid #29ABE2',
            } : {}}
          >
            <FileSpreadsheet className="w-4 h-4 shrink-0" />
            Reports
          </NavLink>
        )}

        {/* Analytics section — managers only */}
        {isManager && !isTenantAdmin && (
          <div>
            <button
              onClick={() => setAnalyticsOpen(o => !o)}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all text-white/60 hover:text-white hover:bg-white/10"
            >
              <BarChart3 className="w-4 h-4 shrink-0" />
              <span className="flex-1 text-left">Analytics</span>
              {analyticsOpen
                ? <ChevronDown className="w-3.5 h-3.5" />
                : <ChevronRight className="w-3.5 h-3.5" />}
            </button>
            {analyticsOpen && (
              <div className="ml-3 mt-0.5 space-y-0.5 border-l border-white/10 pl-3">
                <NavLink to="/dashboard"
                  className={({ isActive }) =>
                    `flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-all ${
                      isActive ? 'text-white font-semibold' : 'text-white/50 hover:text-white hover:bg-white/10'
                    }`
                  }
                  style={({ isActive }) => isActive ? {
                    background: 'linear-gradient(135deg, rgba(41,171,226,0.2) 0%, rgba(77,139,60,0.1) 100%)',
                    borderLeft: '2px solid #29ABE2',
                  } : {}}
                >
                  <LayoutDashboard className="w-3.5 h-3.5 shrink-0" />
                  Ops Dashboard
                </NavLink>
                <NavLink to="/ticket-reports"
                  className={({ isActive }) =>
                    `flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-all ${
                      isActive ? 'text-white font-semibold' : 'text-white/50 hover:text-white hover:bg-white/10'
                    }`
                  }
                  style={({ isActive }) => isActive ? {
                    background: 'linear-gradient(135deg, rgba(41,171,226,0.2) 0%, rgba(77,139,60,0.1) 100%)',
                    borderLeft: '2px solid #29ABE2',
                  } : {}}
                >
                  <BarChart3 className="w-3.5 h-3.5 shrink-0" />
                  Ticket Reports
                </NavLink>
                <NavLink to="/wallboard"
                  className={({ isActive }) =>
                    `flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-all ${
                      isActive ? 'text-white font-semibold' : 'text-white/50 hover:text-white hover:bg-white/10'
                    }`
                  }
                  style={({ isActive }) => isActive ? {
                    background: 'linear-gradient(135deg, rgba(41,171,226,0.2) 0%, rgba(77,139,60,0.1) 100%)',
                    borderLeft: '2px solid #29ABE2',
                  } : {}}
                >
                  <Users className="w-3.5 h-3.5 shrink-0" />
                  Live Wallboard
                </NavLink>
                <NavLink to="/field-team"
                  className={({ isActive }) =>
                    `flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-all ${
                      isActive ? 'text-white font-semibold' : 'text-white/50 hover:text-white hover:bg-white/10'
                    }`
                  }
                  style={({ isActive }) => isActive ? {
                    background: 'linear-gradient(135deg, rgba(41,171,226,0.2) 0%, rgba(77,139,60,0.1) 100%)',
                    borderLeft: '2px solid #29ABE2',
                  } : {}}
                >
                  <MapPin className="w-3.5 h-3.5 shrink-0" />
                  Field Team
                </NavLink>
              </div>
            )}
          </div>
        )}

        {/* SLA Policies — policy_admin (governance role), tenant admin, or manager */}
        {(isPolicyAdmin || isTenantAdmin || isManager) && (
          <NavLink to="/tickets/sla"
            className={({ isActive }) =>
              `flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all ${
                isActive ? 'text-white font-semibold' : 'text-white/60 hover:text-white hover:bg-white/10'
              }`
            }
            style={({ isActive }) => isActive ? {
              background: 'linear-gradient(135deg, rgba(41,171,226,0.25) 0%, rgba(77,139,60,0.15) 100%)',
              borderLeft: '2px solid #29ABE2',
            } : {}}
          >
            <Clock className="w-4 h-4" />
            SLA Policies
          </NavLink>
        )}

        {/* Routing & SLA — managers only (tenant admins have it in their own sidebar) */}
        {isManager && !isTenantAdmin && (
          <NavLink to="/admin/routing"
            className={({ isActive }) =>
              `flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all ${
                isActive ? 'text-white font-semibold' : 'text-white/60 hover:text-white hover:bg-white/10'
              }`
            }
            style={({ isActive }) => isActive ? {
              background: 'linear-gradient(135deg, rgba(41,171,226,0.25) 0%, rgba(77,139,60,0.15) 100%)',
              borderLeft: '2px solid #29ABE2',
            } : {}}
          >
            <Clock className="w-4 h-4" />
            Routing & SLA
          </NavLink>
        )}

        {/* User chip — always visible; avatar links to Personal Settings */}
        <div className="mt-2 px-2 py-2 rounded-xl bg-white/10 flex items-center gap-2">
          <NavLink to="/settings/personal" title="My Settings"
            className="relative w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-xs font-bold text-white hover:ring-2 hover:ring-white/40 transition-all"
            style={{ background: 'linear-gradient(135deg, #29ABE2 0%, #4D8B3C 100%)' }}>
            {user?.name?.[0]?.toUpperCase()}
          </NavLink>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-white truncate">{user?.name}</p>
            <AgentStatusPicker isTenantAdmin={isTenantAdmin} isSuperAdmin={isSuperAdmin} />
          </div>
          {!isSuperAdmin && <NotificationBell />}
          <button onClick={logout} title="Log out"
            className="text-white/40 hover:text-white p-0.5 rounded transition-colors">
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Shared wrapper for standalone tenant-admin pages ─────────────────────────
function AdminPageWrapper({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-100 px-8 py-5">
        <h1 className="text-xl font-bold text-gray-900">{title}</h1>
        <p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>
      </div>
      <div className="px-8 py-6">{children}</div>
    </div>
  );
}

// ── Notifications page ────────────────────────────────────────────────────────
function NotificationsPage() {
  const categories = [
    { id: 'tickets',  label: 'Tickets',           items: ['New ticket assigned to me', 'Ticket status changed', 'Ticket SLA breached', 'Ticket resolved'] },
    { id: 'contacts', label: 'Contacts & Deals',  items: ['New contact added', 'Deal stage changed', 'Deal won / lost'] },
    { id: 'team',     label: 'Team',               items: ['New user invited', 'User activated / deactivated', 'Role changed'] },
    { id: 'system',   label: 'System',             items: ['Module enabled / disabled', 'Integration connected / disconnected'] },
  ];
  const defaults = React.useMemo(() =>
    Object.fromEntries(categories.map(c => [c.id, Object.fromEntries(c.items.map(i => [i, { email: true, inApp: true }]))])),
    [],
  );

  const { data: saved, isLoading } = useQuery<Record<string, Record<string, { email: boolean; inApp: boolean }>>>({
    queryKey: ['notification-preferences'],
    queryFn: async () => (await api.get('/api/v1/settings/notification-preferences')).data.data,
  });

  const [prefs, setPrefs] = React.useState(defaults);
  React.useEffect(() => {
    if (!saved) return;
    // Merge saved values over the defaults so newly-added notification types
    // (added after the user last saved) still default to on.
    setPrefs(p => {
      const merged = { ...p };
      for (const cat of Object.keys(merged)) {
        for (const item of Object.keys(merged[cat])) {
          if (saved[cat]?.[item]) merged[cat] = { ...merged[cat], [item]: saved[cat][item] };
        }
      }
      return merged;
    });
  }, [saved]);

  const toggle = (cat: string, item: string, channel: 'email' | 'inApp') =>
    setPrefs(p => ({ ...p, [cat]: { ...p[cat], [item]: { ...p[cat][item], [channel]: !p[cat][item][channel] } } }));

  const saveMutation = useMutation({
    mutationFn: () => api.patch('/api/v1/settings/notification-preferences', prefs),
  });

  if (isLoading) return <div className="max-w-2xl text-sm text-gray-400">Loading…</div>;

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-6 text-xs font-semibold text-gray-500 uppercase tracking-wide justify-end pr-2">
        <span className="w-14 text-center">Email</span>
        <span className="w-14 text-center">In-App</span>
      </div>
      {categories.map(cat => (
        <div key={cat.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-3 bg-gray-50 border-b border-gray-100">
            <p className="text-xs font-bold text-gray-600 uppercase tracking-wide">{cat.label}</p>
          </div>
          <div className="divide-y divide-gray-50">
            {cat.items.map(item => (
              <div key={item} className="flex items-center px-5 py-3 gap-4">
                <span className="flex-1 text-sm text-gray-700">{item}</span>
                <div className="flex gap-6 shrink-0">
                  {(['email', 'inApp'] as const).map(ch => (
                    <div key={ch} className="w-14 flex justify-center">
                      <button
                        onClick={() => toggle(cat.id, item, ch)}
                        className={`w-9 h-5 rounded-full transition-colors ${prefs[cat.id][item][ch] ? 'bg-blue-500' : 'bg-gray-200'}`}
                      >
                        <span className={`block w-3.5 h-3.5 bg-white rounded-full shadow transition-transform mx-0.5 ${prefs[cat.id][item][ch] ? 'translate-x-4' : 'translate-x-0'}`} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
      <button
        onClick={() => saveMutation.mutate()}
        disabled={saveMutation.isPending}
        className="px-5 py-2.5 text-sm font-semibold text-white rounded-xl disabled:opacity-50"
        style={{ background: 'linear-gradient(135deg,#29ABE2,#1a8cbf)' }}
      >
        {saveMutation.isPending ? 'Saving…' : saveMutation.isSuccess ? 'Saved' : 'Save Preferences'}
      </button>
      {saveMutation.isError && <p className="text-xs text-red-500">Failed to save. Please try again.</p>}
    </div>
  );
}

function AppLayout() {
  const { isAuthenticated, tenant } = useAuthStore();
  const isSuperAdmin = useIsSuperAdmin();
  const isTenantAdmin = useIsTenantAdmin();
  const isManager = useHasRole('manager');
  useApplyAppearance();
  if (!isAuthenticated) return <Navigate to="/login" replace />;

  // Super admins have no operational (ticket/voice) dashboard — their home is the
  // platform admin console. Tenant admins are administrative-only: their home is
  // the workspace Settings console; all operational pages redirect away.
  const homePath = isSuperAdmin ? '/super-admin' : isTenantAdmin ? '/admin' : '/dashboard';

  // Operational pages are off-limits to the tenant admin (separation of duties).
  // Wrap an operational element so it bounces the admin to their console.
  const op = (el: JSX.Element) => (isTenantAdmin ? <Navigate to="/admin" replace /> : el);

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <Routes>
          <Route path="/admin"         element={isTenantAdmin ? <TenantAdminDashboard /> : <Navigate to="/dashboard" replace />} />
          <Route path="/admin/users"   element={isTenantAdmin ? <AdminUsers /> : <Navigate to="/dashboard" replace />} />
          <Route path="/admin/modules" element={isTenantAdmin ? <AdminPageWrapper title="Modules" subtitle="Enable or disable features for your workspace"><ModulesSettings /></AdminPageWrapper> : <Navigate to="/dashboard" replace />} />
          <Route path="/admin/routing" element={(isTenantAdmin || isManager) ? <AdminPageWrapper title="Routing & SLA" subtitle="Configure how tickets and calls are assigned to your team"><RoutingSettings /></AdminPageWrapper> : <Navigate to="/dashboard" replace />} />
          <Route path="/admin/custom-fields" element={isTenantAdmin ? <AdminPageWrapper title="Custom Fields" subtitle="Add sector-specific fields to contacts, tickets, and deals"><CustomFieldsPage /></AdminPageWrapper> : <Navigate to="/dashboard" replace />} />
          <Route path="/dashboard"    element={isSuperAdmin ? <Navigate to="/super-admin" replace /> : op(<Dashboard />)} />
          <Route path="/contacts"     element={op(<Contacts />)} />
          <Route path="/companies"   element={op(<Companies />)} />
          <Route path="/deals"       element={op(<Deals />)} />
          <Route path="/voice"           element={op(<VoiceCalls />)} />
          <Route path="/voice/analytics" element={op(<VoiceAnalytics />)} />
          {/* Tickets: tenant admin gets read-only observer access (backend enforces OBSERVER_ONLY on writes) */}
          <Route path="/tickets"         element={<Tickets />} />
          <Route path="/tickets/queues"  element={op(<TicketQueues />)} />
          {/* SLA policy configuration is settings work (like Voice Bot config), not
              operational ticket data — tenant admins and managers both need it. */}
          <Route path="/tickets/sla"     element={<TicketSla />} />
          <Route path="/emails"            element={op(<Emails />)} />
          <Route path="/emails/analytics" element={op(<EmailAnalytics />)} />
          <Route path="/messages"        element={<TeamMessaging />} />
          {/* Voice Bot pages are open to the tenant admin too — configuring
              the bot is administrative work, and the calls/tickets APIs
              already allow tenant_admin (no op() redirect here). */}
          <Route path="/voice-bot"         element={<VoiceBotConfig />} />
          <Route path="/voice-bot/calls"   element={<VoiceBotCalls />} />
          <Route path="/voice-bot/tickets" element={<VoiceBotTickets />} />
          <Route path="/contacts/:id"      element={op(<ContactDetail />)} />
          <Route path="/activities"  element={op(<Activities />)} />
          <Route path="/analytics"   element={op(<Analytics />)} />
          <Route path="/team-reports"    element={op(<TeamReports />)} />
          <Route path="/ticket-reports" element={op(<TicketReports />)} />
          <Route path="/wallboard"      element={op(<Wallboard />)} />
          <Route path="/field-team"     element={op(<FieldTeamView />)} />
          <Route path="/reports"        element={op(<Reports />)} />
          <Route path="/billing"     element={op(<Billing />)} />
          <Route path="/integrations"        element={((tenant as any)?.active_modules ?? []).includes('integrations') ? <Integrations /> : <Navigate to="/dashboard" replace />} />
          <Route path="/integrations/health" element={((tenant as any)?.active_modules ?? []).includes('integrations') ? <IntegrationHealth /> : <Navigate to="/dashboard" replace />} />
          <Route path="/settings"          element={<Settings />} />
          <Route path="/settings/personal" element={<PersonalSettings />} />
          <Route path="/settings/notifications" element={<AdminPageWrapper title="Notifications" subtitle="Control which alerts and emails you receive"><NotificationsPage /></AdminPageWrapper>} />
          <Route path="/departments"       element={<Departments />} />
          <Route path="/roles"        element={<RolesPage />} />
          <Route path="/super-admin" element={<SuperAdmin />} />
          {/* Sales & Invoicing module */}
          <Route path="/sales/dashboard"  element={op(<SalesDashboard />)} />
          <Route path="/sales/invoices"   element={op(<InvoiceList />)} />
          <Route path="/sales/invoices/new" element={op(<InvoiceCreate />)} />
          <Route path="/sales/invoices/:id" element={op(<InvoiceDetail />)} />
          <Route path="/sales/contacts"   element={op(<SalesContacts />)} />
          <Route path="/sales/payments"   element={op(<SalesPayments />)} />
          <Route path="/sales/reports"    element={op(<SalesReports />)} />
          <Route path="/sales/templates"  element={op(<SalesTemplates />)} />
          <Route path="/sales/builder"    element={op(<SalesBuilder />)} />
          <Route path="/sales/settings"   element={op(<SalesSettingsPage />)} />
          <Route path="/governance"   element={isTenantAdmin ? <GovernancePage /> : <Navigate to="/dashboard" replace />} />
          <Route path="/orders"       element={isTenantAdmin ? <OrdersPage /> : <Navigate to="/dashboard" replace />} />
          <Route path="*"            element={<Navigate to={homePath} replace />} />
        </Routes>
      </main>
      {/* Voice call widget is operational — not for the administrative tenant admin. */}
      {!isTenantAdmin && !isSuperAdmin && <CallWidget />}
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login"           element={<LoginPage />} />
          <Route path="/register"        element={<RegisterPage />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password"  element={<ResetPassword />} />
          <Route path="/csat/:token"     element={<CsatSurvey />} />
          <Route path="/*"               element={<AppLayout />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
