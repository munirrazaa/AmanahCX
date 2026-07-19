/**
 * Super Admin — platform-wide workspace management
 *
 * Only accessible to users with role = 'super_admin'.
 * Lists all tenants, shows usage stats, allows creating workspaces,
 * updating plans, managing modules, suspending/activating tenants.
 */

import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Shield, Plus, Search, MoreVertical, Users, TrendingUp,
  Loader2, X, Check, AlertTriangle, Building2, BarChart3,
  Package, Ban, Play, KeyRound, Trash2, RefreshCw, FileText,
  BarChart2, Receipt, ClipboardList, Edit2, Eye, EyeOff,
  Lock, Calendar, ChevronDown, ChevronRight, Download, ShoppingCart,
  Hourglass, BadgeCheck, XCircle, CheckCircle, Phone,
  ToggleLeft, ToggleRight, Bell, Bot,
} from 'lucide-react';
import { api } from '../services/api';
import { useIsSuperAdmin } from '../hooks/useRole';
import { Navigate } from 'react-router-dom';
import { PermissionsMatrix } from '../components/PermissionsMatrix';
import type { ModuleDef } from '../components/PermissionsMatrix';

// ── Reusable confirm modal ─────────────────────────────────────────────────
function ConfirmModal({ title, message, confirmLabel = 'Delete', onConfirm, onCancel }: {
  title: string; message: string; confirmLabel?: string;
  onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 bg-red-50 rounded-full flex items-center justify-center shrink-0">
            <AlertTriangle className="w-5 h-5 text-red-500" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
            <p className="text-xs text-gray-500 mt-1">{message}</p>
          </div>
        </div>
        <div className="flex gap-2 justify-end pt-1">
          <button onClick={onCancel}
            className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={onConfirm}
            className="px-4 py-2 text-sm text-white bg-red-600 rounded-lg hover:bg-red-700">
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

const PLANS = ['free', 'starter', 'professional', 'enterprise'] as const;
const PLAN_COLORS: Record<string, string> = {
  free: 'bg-gray-100 text-gray-600',
  starter: 'bg-blue-50 text-blue-700',
  professional: 'bg-brand-50 text-brand-700',
  enterprise: 'bg-purple-50 text-purple-700',
};
const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-50 text-green-700',
  trial: 'bg-amber-50 text-amber-700',
  suspended: 'bg-red-50 text-red-600',
  cancelled: 'bg-gray-100 text-gray-500',
};

// Full module catalog — keep in sync with MODULE_CATALOG in super-admin.ts
// Must stay in sync with MODULE_CATALOG in packages/api/src/routes/super-admin.ts —
// ticketing and voice_bot were missing here for a while, which made them
// impossible to license from this screen at all (found 2026-07-13).
const ALL_MODULES: Array<{ key: string; label: string; description: string; always?: boolean; icon: string }> = [
  { key: 'crm',          label: 'Core CRM',            icon: '🏢', description: 'Contacts, companies, deals, activities and analytics.',        always: true  },
  { key: 'ticketing',    label: 'Ticketing & Support', icon: '🎫', description: 'Multi-department helpdesk with SLA timers, queues, routing and CSAT.'   },
  { key: 'voice_bot',    label: 'Voice Bot',           icon: '🎙️', description: 'AI voice agent over SIP — self-hosted or Retell AI / Vapi / Bland.ai.'  },
  { key: 'emails',       label: 'Email Inbox',         icon: '📧', description: 'Shared team email inbox with assignment and SLA tracking.'              },
  { key: 'integrations', label: 'Integrations',        icon: '🔌', description: 'SMS gateways, webhooks, Zapier/Make and API bridges.'                  },
  { key: 'analytics',    label: 'Advanced Analytics',  icon: '📊', description: 'Cross-module reports, heatmaps and performance dashboards.'             },
  { key: 'sales',        label: 'Sales Module',        icon: '💼', description: 'Sales pipeline, invoicing, payments and forecasting.'                    },
];

// ── Pricing plan presets ─────────────────────────────────────────────────────
// PLAN_MODULE_MAP drives auto-selection in the Create Workspace modal
// and the visual Deal Builder in the Catalogue tab.
const PLAN_PRICING: Record<string, { price: string; tagline: string; color: string; highlight?: boolean }> = {
  free:         { price: '$0',   tagline: 'Try before you buy',           color: '#64748b' },
  starter:      { price: '$49',  tagline: 'Growing teams',                color: '#2563eb' },
  professional: { price: '$89',  tagline: 'High-volume contact centres',  color: '#29ABE2', highlight: true },
  enterprise:   { price: 'Custom', tagline: 'Large / regulated orgs',     color: '#7c3aed' },
};

// Module keys that a plan includes (from super-admin.ts included_in_plans)
const PLAN_MODULE_MAP: Record<string, string[]> = {
  free:         ['crm'],
  starter:      ['crm', 'ticketing', 'emails', 'integrations'],
  professional: ['crm', 'ticketing', 'emails', 'integrations', 'sales', 'voice_bot', 'analytics'],
  enterprise:   ['crm', 'ticketing', 'emails', 'integrations', 'sales', 'voice_bot', 'analytics'],
};

// Catalogue cards — extended descriptions for the visual Catalogue tab
const CATALOGUE_MODULES: Array<{
  key: string; label: string; icon: string; tier: string; tierColor: string;
  description: string; features: string[]; price: string; category: 'core' | 'addon' | 'horizontal';
}> = [
  {
    key: 'crm', label: 'Core CRM', icon: '🏢', tier: 'Free+', tierColor: '#22c55e', category: 'core',
    price: 'Included in all plans',
    description: 'The customer record at the heart of everything. Contacts, companies, deals, activities and a shared team inbox in one place.',
    features: ['Contact & company records', 'Deal pipeline management', 'Activity timeline', 'CRM Analytics dashboard'],
  },
  {
    key: 'ticketing', label: 'Ticketing & Support', icon: '🎫', tier: 'Starter+', tierColor: '#2563eb', category: 'addon',
    price: 'Included from Starter',
    description: 'Omnichannel ticketing with SLA policies, CSAT surveys and queue management for support teams.',
    features: ['Omnichannel ticket creation', 'SLA policies & breach alerts', 'CSAT surveys on close', 'Queue & priority management', 'Ticket-level reports'],
  },
  {
    key: 'emails', label: 'Email Inbox', icon: '📧', tier: 'Starter+', tierColor: '#2563eb', category: 'addon',
    price: 'Included from Starter',
    description: 'Shared team email inbox with assignment, threading, template library and open-tracking analytics.',
    features: ['Shared team inbox', 'Thread assignment & handoff', 'Email templates', 'Open / bounce tracking', 'Email analytics dashboard'],
  },
  {
    key: 'integrations', label: 'Integrations', icon: '🔌', tier: 'Starter+', tierColor: '#2563eb', category: 'addon',
    price: 'Included from Starter',
    description: 'Pre-built connectors to SMS gateways, Slack, Zapier/Make, WhatsApp and generic webhooks.',
    features: ['20+ pre-built connectors', 'Webhook delivery tracking', 'Zapier / Make support', 'Integration health dashboard'],
  },
  {
    key: 'sales', label: 'Sales & Invoicing', icon: '💼', tier: 'Professional+', tierColor: '#29ABE2', category: 'addon',
    price: 'Included from Professional',
    description: 'Sales pipeline, invoicing, payments, contact billing and revenue forecasting in one module.',
    features: ['Sales pipeline & forecasting', 'Invoice creation & PDF export', 'Payment tracking', 'Sales contacts & billing', 'Revenue reports'],
  },
  {
    key: 'voice_bot', label: 'Voice Bot', icon: '🤖', tier: 'Professional+', tierColor: '#29ABE2', category: 'addon',
    price: 'Included from Professional',
    description: 'AI-powered inbound call handling via SIP. Auto-creates contacts, tickets and call transcripts.',
    features: ['SIP / provider integration', 'Auto contact & ticket creation', 'Call transcripts & sentiment', 'Bot configuration UI', 'Anonymous caller handling'],
  },
  {
    key: 'analytics', label: 'Advanced Analytics', icon: '📊', tier: 'All plans', tierColor: '#64748b', category: 'horizontal',
    price: 'Included in all plans',
    description: 'Cross-module reports, team performance dashboards, pipeline funnels and data export. Gets richer as more modules activate.',
    features: ['Cross-module reporting', 'Team performance reports', 'Pipeline funnel analysis', 'CSAT & SLA trends', 'CSV / PDF export'],
  },
];

// ── Catalogue tab ─────────────────────────────────────────────────────────────
function CatalogueTab() {
  const [subTab, setSubTab] = useState<'modules' | 'plans' | 'builder'>('modules');
  const [builderModules, setBuilderModules] = useState<string[]>(['crm']);

  const toggleBuilder = (key: string) => {
    if (key === 'crm') return; // always on
    setBuilderModules(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  };

  const applyPlan = (plan: string) => {
    setBuilderModules(PLAN_MODULE_MAP[plan] ?? ['crm']);
    setSubTab('builder');
  };

  const MODULE_PRICES: Record<string, number> = {
    crm: 0, ticketing: 0, emails: 0, integrations: 0, // included in plan base
    sales: 15, voice_bot: 20, analytics: 0,
  };

  const basePriceForModules = (mods: string[]) => {
    if (mods.includes('voice_bot') || mods.includes('sales')) return 89;
    if (mods.some(m => ['ticketing', 'emails', 'integrations'].includes(m))) return 49;
    return 0;
  };

  const addonPrice = builderModules.reduce((s, m) => s + (MODULE_PRICES[m] ?? 0), 0);
  const totalBase  = basePriceForModules(builderModules);

  return (
    <div className="space-y-4">
      {/* Sub-tabs */}
      <div className="flex gap-1 border-b border-gray-100 pb-0">
        {([
          { key: 'modules', label: 'Module Catalogue' },
          { key: 'plans',   label: 'Pricing Plans' },
          { key: 'builder', label: 'Deal Builder' },
        ] as const).map(({ key, label }) => (
          <button key={key} onClick={() => setSubTab(key)}
            className={`px-4 py-2 text-sm rounded-t-lg border-b-2 transition-colors ${
              subTab === key
                ? 'border-brand-500 text-brand-700 bg-brand-50 font-semibold'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            {label}
          </button>
        ))}
        <div className="flex-1" />
        <span className="self-center text-xs text-gray-400 pr-1">Source: packages/api/src/routes/super-admin.ts</span>
      </div>

      {/* Module Catalogue */}
      {subTab === 'modules' && (
        <div className="space-y-6">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Core Module — always active</p>
            <div className="grid grid-cols-1 gap-3">
              {CATALOGUE_MODULES.filter(m => m.category === 'core').map(m => (
                <CatalogueCard key={m.key} mod={m} onApplyPlan={() => setSubTab('plans')} />
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Add-on modules — require Core CRM</p>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {CATALOGUE_MODULES.filter(m => m.category === 'addon').map(m => (
                <CatalogueCard key={m.key} mod={m} onApplyPlan={() => setSubTab('plans')} />
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Horizontal modules — work across all active modules</p>
            <div className="grid grid-cols-1 gap-3">
              {CATALOGUE_MODULES.filter(m => m.category === 'horizontal').map(m => (
                <CatalogueCard key={m.key} mod={m} onApplyPlan={() => setSubTab('plans')} />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Pricing Plans */}
      {subTab === 'plans' && (
        <div>
          <p className="text-sm text-gray-500 mb-4">Pick a plan to pre-load the right modules in the Deal Builder. Prices are per seat per month.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {PLANS.map(plan => {
              const p = PLAN_PRICING[plan];
              const mods = PLAN_MODULE_MAP[plan] ?? [];
              return (
                <div key={plan} className={`bg-white rounded-2xl overflow-hidden border-2 transition-shadow hover:shadow-md ${
                  p.highlight ? 'border-brand-400' : 'border-gray-200'
                }`}>
                  <div className="p-4" style={{ background: p.highlight ? p.color : undefined }}>
                    <p className={`text-xs font-semibold uppercase tracking-wider ${p.highlight ? 'text-white/70' : 'text-gray-500'}`}>
                      {plan}
                    </p>
                    <p className={`text-3xl font-black mt-1 ${p.highlight ? 'text-white' : 'text-gray-900'}`}>
                      {p.price}{p.price !== 'Custom' && <span className="text-sm font-normal opacity-60"> /seat/mo</span>}
                    </p>
                    <p className={`text-xs mt-1 ${p.highlight ? 'text-white/70' : 'text-gray-400'}`}>{p.tagline}</p>
                  </div>
                  <div className="p-4 space-y-1.5">
                    {CATALOGUE_MODULES
                      .filter(m => mods.includes(m.key))
                      .map(m => (
                        <div key={m.key} className="flex items-center gap-1.5 text-xs text-gray-600">
                          <Check className="w-3 h-3 text-green-500 shrink-0" />
                          {m.label}
                        </div>
                      ))}
                    {CATALOGUE_MODULES
                      .filter(m => !mods.includes(m.key))
                      .map(m => (
                        <div key={m.key} className="flex items-center gap-1.5 text-xs text-gray-300">
                          <X className="w-3 h-3 shrink-0" /> {m.label}
                        </div>
                      ))}
                    <button onClick={() => applyPlan(plan)}
                      className="w-full mt-3 py-2 text-xs font-semibold rounded-lg transition-colors"
                      style={{ background: p.color, color: '#fff' }}>
                      Load in Deal Builder →
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Deal Builder */}
      {subTab === 'builder' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-3">
            <p className="text-sm text-gray-500 mb-1">Toggle modules to build a custom package. Core CRM is always included.</p>
            {CATALOGUE_MODULES.map(m => {
              const on = builderModules.includes(m.key);
              const locked = m.key === 'crm';
              return (
                <div key={m.key} onClick={() => toggleBuilder(m.key)}
                  className={`flex items-start gap-4 p-4 rounded-xl border-2 transition-all cursor-pointer ${
                    on ? 'border-brand-300 bg-brand-50/30' : 'border-gray-100 bg-white hover:border-gray-200'
                  } ${locked ? 'cursor-default' : ''}`}>
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-lg shrink-0 ${
                    on ? 'bg-brand-100' : 'bg-gray-100'
                  }`}>{m.icon}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-gray-900">{m.label}</p>
                      {locked && <span className="text-[10px] bg-gray-200 text-gray-500 px-1.5 py-0.5 rounded-full">Always On</span>}
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full ml-auto" style={{ background: `${m.tierColor}18`, color: m.tierColor }}>
                        {m.tier}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">{m.description}</p>
                  </div>
                  <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 mt-0.5 transition-colors ${
                    on ? 'border-brand-500 bg-brand-500' : 'border-gray-300'
                  }`}>
                    {on && <Check className="w-3 h-3 text-white" />}
                  </div>
                </div>
              );
            })}
          </div>
          {/* Summary card */}
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border-2 border-brand-200 p-5 sticky top-0">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Package Summary</p>
              <div className="space-y-1.5 mb-4">
                {builderModules.map(key => {
                  const m = CATALOGUE_MODULES.find(c => c.key === key);
                  return m ? (
                    <div key={key} className="flex items-center gap-2 text-xs">
                      <span>{m.icon}</span>
                      <span className="flex-1 text-gray-700">{m.label}</span>
                      <span className="text-green-600 font-semibold">✓</span>
                    </div>
                  ) : null;
                })}
              </div>
              <div className="border-t border-gray-100 pt-3 space-y-1">
                <div className="flex justify-between text-xs text-gray-500">
                  <span>Base plan</span>
                  <span>${totalBase}/seat/mo</span>
                </div>
                {addonPrice > 0 && (
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>Add-ons</span>
                    <span>+${addonPrice}/seat/mo</span>
                  </div>
                )}
                <div className="flex justify-between text-sm font-bold text-brand-700 pt-1">
                  <span>Estimated total</span>
                  <span>${totalBase + addonPrice}/seat/mo</span>
                </div>
              </div>
              <div className="mt-4 p-3 bg-gray-50 rounded-lg">
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Entitlement JSON</p>
                <pre className="text-[10px] text-gray-600 whitespace-pre-wrap break-all leading-4">
                  {JSON.stringify({ active_modules: builderModules }, null, 2)}
                </pre>
              </div>
              <p className="text-[10px] text-gray-400 mt-3">
                Use "New Workspace" to provision a workspace with this module set.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CatalogueCard({ mod, onApplyPlan }: { mod: typeof CATALOGUE_MODULES[0]; onApplyPlan: () => void }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 hover:border-gray-200 transition-colors">
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center text-xl shrink-0">{mod.icon}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-gray-900">{mod.label}</p>
            <span className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ background: `${mod.tierColor}18`, color: mod.tierColor }}>
              {mod.tier}
            </span>
            <span className="text-xs text-gray-400 ml-auto">{mod.price}</span>
          </div>
          <p className="text-xs text-gray-500 mt-1 leading-relaxed">{mod.description}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2.5">
            {mod.features.map(f => (
              <span key={f} className="flex items-center gap-1 text-[11px] text-gray-500">
                <Check className="w-3 h-3 text-green-500" />{f}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const SYSTEM_ROLES_META = [
  { base_role: 'tenant_admin', name: 'Admin',   color: '#dc2626', desc: 'Full workspace access' },
  { base_role: 'manager',      name: 'Manager', color: '#d97706', desc: 'Team management & records' },
  { base_role: 'agent',        name: 'Agent',   color: '#2563eb', desc: 'Day-to-day CRM operations' },
  { base_role: 'viewer',       name: 'Viewer',  color: '#6b7280', desc: 'Read-only access' },
];

// ── Shared Roles Step (used in Create modal and standalone Manage Roles modal) ─
function RolesStep({
  modules,
  rolePerms,
  onChange,
}: {
  modules: ModuleDef[];
  rolePerms: Record<string, Record<string, boolean>>;
  onChange: (base_role: string, perms: Record<string, boolean>) => void;
}) {
  const [activeTab, setActiveTab] = useState('agent');
  return (
    <div>
      <p className="text-xs text-gray-500 mb-3">
        Configure default permissions for each role in this tenant. The tenant admin can further adjust them later.
      </p>
      {/* Role tabs */}
      <div className="flex gap-1 mb-4 border-b border-gray-100 pb-0">
        {SYSTEM_ROLES_META.map((r) => (
          <button
            key={r.base_role}
            type="button"
            onClick={() => setActiveTab(r.base_role)}
            className={`px-3 py-2 text-xs font-medium rounded-t-lg border-b-2 transition-colors ${
              activeTab === r.base_role
                ? 'border-brand-500 text-brand-700 bg-brand-50'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: r.color }} />
            {r.name}
          </button>
        ))}
      </div>
      {/* Active role permissions */}
      {SYSTEM_ROLES_META.filter((r) => r.base_role === activeTab).map((r) => (
        <div key={r.base_role}>
          <p className="text-xs text-gray-400 mb-3">{r.desc}</p>
          <div className="max-h-64 overflow-y-auto">
            <PermissionsMatrix
              modules={modules}
              permissions={rolePerms[r.base_role] ?? {}}
              onChange={(perms) => onChange(r.base_role, perms)}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Manage Roles modal (for existing tenants) ──────────────────────────────
function TenantRolesModal({ tenant, onClose }: { tenant: any; onClose: () => void }) {
  const { data: modules = [] } = useQuery<ModuleDef[]>({
    queryKey: ['role-modules'],
    queryFn: () => api.get('/api/v1/roles/modules').then((r) => r.data.data),
  });

  const { data: existingRoles = [] } = useQuery<any[]>({
    queryKey: ['sa-tenant-roles', tenant.id],
    queryFn: () => api.get(`/super-admin/tenants/${tenant.id}/roles`).then((r) => r.data.data),
  });

  const [rolePerms, setRolePerms] = useState<Record<string, Record<string, boolean>>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (existingRoles.length > 0 && !loaded) {
      const map: Record<string, Record<string, boolean>> = {};
      for (const r of existingRoles) {
        if (r.base_role) map[r.base_role] = r.permissions ?? {};
      }
      setRolePerms(map);
      setLoaded(true);
    }
  }, [existingRoles, loaded]);

  const saveMutation = useMutation({
    mutationFn: () => api.post(`/super-admin/tenants/${tenant.id}/roles`, { roles: buildRolesPayload(rolePerms) }),
    onSuccess: onClose,
  });

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="font-semibold text-gray-900">Manage Roles — {tenant.name}</h2>
            <p className="text-xs text-gray-400 mt-0.5">Configure default permissions for each role in this workspace</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        {modules.length === 0 ? (
          <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
        ) : (
          <RolesStep
            modules={modules}
            rolePerms={rolePerms}
            onChange={(base_role, perms) => setRolePerms((p) => ({ ...p, [base_role]: perms }))}
          />
        )}
        {saveMutation.isError && (
          <p className="mt-3 text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">
            {(saveMutation.error as any)?.response?.data?.error?.message ?? 'Save failed'}
          </p>
        )}
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
          <button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}
            className="flex-1 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700 disabled:opacity-50 flex items-center justify-center gap-2">
            {saveMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            Save Role Permissions
          </button>
        </div>
      </div>
    </div>
  );
}

function buildRolesPayload(rolePerms: Record<string, Record<string, boolean>>) {
  return SYSTEM_ROLES_META.map((r) => ({
    base_role: r.base_role,
    name: r.name,
    color: r.color,
    permissions: rolePerms[r.base_role] ?? {},
  }));
}

// ── Create Workspace Modal ─────────────────────────────────────────────────
function CreateWorkspaceModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: '', slug: '', plan: 'starter', adminEmail: '', adminName: '', adminPassword: '' });
  const [autoGenPw, setAutoGenPw] = useState(true);
  const [slugTouched, setSlugTouched] = useState(false);
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>([]);
  const [step, setStep] = useState<'details' | 'sector' | 'modules'>('details');
  const [sector, setSector] = useState('other');
  const [result, setResult] = useState<{ slug: string; adminEmail: string; tempPassword?: string; emailSent?: boolean } | null>(null);

  // Licensable module + feature catalog — the single source of truth (from the API).
  // Adding a module there makes it appear here automatically.
  type CatalogModule = { key: string; label: string; description: string; always?: boolean; features: { key: string; label: string }[] };
  const { data: catalog = [] } = useQuery<CatalogModule[]>({
    queryKey: ['license-catalog'],
    queryFn: () => api.get('/super-admin/modules').then((r) => r.data.data),
  });

  // Pre-select all features of always-on modules (e.g. Core CRM) once the catalog loads.
  useEffect(() => {
    if (catalog.length === 0 || selectedFeatures.length > 0) return;
    const alwaysFeatures = catalog.filter((m) => m.always).flatMap((m) => m.features.map((f) => f.key));
    if (alwaysFeatures.length) setSelectedFeatures(alwaysFeatures);
  }, [catalog]);

  const mutation = useMutation({
    // No roles payload — the backend auto-seeds the standard roles with sensible
    // defaults. The tenant admin tailors who-can-do-what later, under Roles.
    mutationFn: () => api.post('/super-admin/tenants', {
      ...form,
      adminPassword: autoGenPw ? undefined : (form.adminPassword || undefined),
      entitledFeatures: selectedFeatures,
      sector,
    }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['sa-tenants'] });
      const d = res.data.data;
      setResult({ slug: d.slug, adminEmail: form.adminEmail, tempPassword: d.tempPassword, emailSent: d.emailSent });
    },
  });

  const autoSlug = (name: string) =>
    name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  // Feature-area selection (the entitlement). Modules are derived: licensed if ≥1 feature on.
  const toggleFeature = (key: string) =>
    setSelectedFeatures(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);

  const toggleModuleAll = (mod: CatalogModule) => {
    const fkeys = mod.features.map(f => f.key);
    const allOn = fkeys.every(k => selectedFeatures.includes(k));
    setSelectedFeatures(prev => allOn
      ? prev.filter(k => !fkeys.includes(k))
      : Array.from(new Set([...prev, ...fkeys])));
  };

  const pwValid = autoGenPw || form.adminPassword.length >= 8;
  const detailsValid = form.name && form.slug && form.adminEmail && form.adminName && pwValid;
  const selectedModuleCount = catalog.filter(m => m.features.some(f => selectedFeatures.includes(f.key))).length;

  const STEP_LABELS: Record<string, string> = {
    details: 'Step 1 of 3 — Workspace & admin details',
    sector:  'Step 2 of 3 — Industry sector',
    modules: 'Step 3 of 3 — Licensed modules & features',
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="font-semibold text-gray-900">{result ? 'Workspace Created' : 'Create Workspace'}</h2>
            {!result && <p className="text-xs text-gray-400 mt-0.5">{STEP_LABELS[step]}</p>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        {/* ── Success screen — surfaces the temp password once ── */}
        {result && (
          <div className="space-y-4">
            <div className="flex flex-col items-center text-center py-2">
              <div className="w-12 h-12 bg-green-50 rounded-full flex items-center justify-center mb-3">
                <Check className="w-6 h-6 text-green-600" />
              </div>
              <p className="font-semibold text-gray-900">{form.name} is ready</p>
              <p className="text-xs text-gray-400 mt-0.5">The tenant admin can sign in now with these credentials.</p>
            </div>
            <div className="bg-gray-50 border border-gray-100 rounded-xl divide-y divide-gray-100 text-sm">
              <div className="flex justify-between px-4 py-2.5"><span className="text-gray-400">Workspace</span><span className="font-mono text-gray-700">{result.slug}</span></div>
              <div className="flex justify-between px-4 py-2.5"><span className="text-gray-400">Admin email</span><span className="font-mono text-gray-700">{result.adminEmail}</span></div>
              {result.tempPassword ? (
                <div className="flex justify-between items-center px-4 py-2.5">
                  <span className="text-gray-400">Temp password</span>
                  <span className="font-mono font-semibold text-gray-900 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded">{result.tempPassword}</span>
                </div>
              ) : (
                <div className="flex justify-between px-4 py-2.5"><span className="text-gray-400">Password</span><span className="text-gray-500">Set by you</span></div>
              )}
            </div>
            {result.tempPassword && (
              <p className="text-xs flex items-start gap-1.5 text-amber-600">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                {result.emailSent
                  ? 'Password emailed to the customer. Copy it above as a backup — it is shown only once.'
                  : 'No system email configured — copy this password and share it securely with the customer. They should change it on first login.'}
              </p>
            )}
            <button onClick={onClose} className="w-full py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700">Done</button>
          </div>
        )}

        {!result && (<>
        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-5">
          {(['details','sector','modules'] as const).map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                step === s ? 'bg-brand-600 text-white' :
                (['details','sector','modules'].indexOf(step) > i) ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-400'
              }`}>{i + 1}</div>
              {i < 2 && <div className="h-px w-6 bg-gray-200" />}
            </div>
          ))}
        </div>

        {/* Step 1 — Details */}
        {step === 'details' && (
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Company / Workspace Name</label>
              <input value={form.name}
                onChange={(e) => {
                  const name = e.target.value;
                  setForm({ ...form, name, slug: slugTouched ? form.slug : autoSlug(name) });
                }}
                placeholder="Acme Corp"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Slug (subdomain)</label>
              <div className="flex items-center border border-gray-200 rounded-lg focus-within:border-brand-400 overflow-hidden">
                <input value={form.slug}
                  onChange={(e) => { setSlugTouched(true); setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }); }}
                  placeholder="acme"
                  className="flex-1 px-3 py-2 text-sm outline-none" />
                <span className="px-3 py-2 text-xs text-gray-400 bg-gray-50 border-l border-gray-200">.crmplatform.io</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Admin Name</label>
                <input value={form.adminName} onChange={(e) => setForm({ ...form, adminName: e.target.value })}
                  placeholder="John Smith"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Plan</label>
                <select value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400 capitalize">
                  {PLANS.map((p) => <option key={p} value={p} className="capitalize">{p}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Admin Email</label>
              <input value={form.adminEmail} onChange={(e) => setForm({ ...form, adminEmail: e.target.value })}
                type="email" placeholder="admin@acme.com"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400" />
            </div>
            {/* Admin password — auto-generate (shown once) or set manually */}
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Admin Password</label>
              <label className="flex items-center gap-2 mb-2 cursor-pointer">
                <input type="checkbox" checked={autoGenPw} onChange={(e) => setAutoGenPw(e.target.checked)} className="accent-brand-600" />
                <span className="text-xs text-gray-600">Auto-generate a temporary password (shown once after creation)</span>
              </label>
              {!autoGenPw && (
                <input value={form.adminPassword} onChange={(e) => setForm({ ...form, adminPassword: e.target.value })}
                  type="text" placeholder="Min 8 characters"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400" />
              )}
            </div>
          </div>
        )}

        {/* Step 2 — Sector */}
        {step === 'sector' && (
          <div className="space-y-3">
            <p className="text-xs text-gray-500 mb-3">Choose the industry this workspace operates in. This controls the custom fields that appear on contacts, companies, deals and tickets — and the SLA policy names in the support module.</p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { id: 'banking',          label: 'Banking & Finance',   icon: '🏦' },
                { id: 'telecom',          label: 'Telecommunications',  icon: '📡' },
                { id: 'public_transport', label: 'Public Transport',    icon: '🚌' },
                { id: 'logistics',        label: 'Logistics & Freight', icon: '🚚' },
                { id: 'insurance',        label: 'Insurance',           icon: '🛡️' },
                { id: 'education',        label: 'Education',           icon: '🎓' },
                { id: 'ecommerce',        label: 'E-Commerce / Retail', icon: '🛒' },
                { id: 'other',            label: 'Other / General',     icon: '🌐' },
              ].map(s => (
                <button key={s.id}
                  onClick={() => setSector(s.id)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all ${
                    sector === s.id
                      ? 'border-brand-500 bg-brand-50 text-brand-700 font-semibold'
                      : 'border-gray-200 text-gray-700 hover:border-brand-300 hover:bg-gray-50'
                  }`}>
                  <span className="text-xl">{s.icon}</span>
                  <span className="text-sm">{s.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 3 — Module licensing */}
        {step === 'modules' && (
          <div>
            {/* Plan-preset quick selector */}
            <div className="mb-4">
              <p className="text-xs font-medium text-gray-600 mb-2">Quick-select by plan</p>
              <div className="grid grid-cols-4 gap-2">
                {PLANS.map(plan => {
                  const p = PLAN_PRICING[plan];
                  const mods = PLAN_MODULE_MAP[plan] ?? [];
                  // active if all modules for this plan are selected (and no more)
                  const isActive = mods.every(m =>
                    catalog.find(c => c.key === m)?.features.every(f => selectedFeatures.includes(f.key))
                  );
                  return (
                    <button key={plan} type="button"
                      onClick={() => {
                        const features = catalog
                          .filter(c => mods.includes(c.key))
                          .flatMap(c => c.features.map(f => f.key));
                        // always keep always-on features
                        const alwaysFeatures = catalog.filter(c => c.always).flatMap(c => c.features.map(f => f.key));
                        setSelectedFeatures(Array.from(new Set([...alwaysFeatures, ...features])));
                      }}
                      className={`py-2 px-1 rounded-lg border-2 text-center transition-all ${
                        isActive ? 'border-brand-400 bg-brand-50' : 'border-gray-200 hover:border-gray-300'
                      }`}>
                      <p className="text-xs font-bold capitalize text-gray-800">{plan}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">{p.price}{p.price !== 'Custom' ? '/seat' : ''}</p>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 mb-4">
              <p className="text-xs text-amber-700 flex items-start gap-1.5">
                <Package className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>Allocate only the modules and feature-areas this customer <strong>agreed and paid for</strong>. This becomes their licensed entitlement — who can create/edit/delete within these is set later under Roles.</span>
              </p>
            </div>
            <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
              {catalog.map((m) => {
                const fkeys = m.features.map(f => f.key);
                const onCount = fkeys.filter(k => selectedFeatures.includes(k)).length;
                const allOn = onCount === fkeys.length && fkeys.length > 0;
                const moduleOn = onCount > 0 || m.always;
                return (
                  <div key={m.key} className={`rounded-xl border ${moduleOn ? 'border-brand-200 bg-brand-50/40' : 'border-gray-100'}`}>
                    {/* Module header — toggles all its features */}
                    <label className="flex items-center gap-3 p-3 cursor-pointer">
                      <input type="checkbox" checked={allOn}
                        ref={(el) => { if (el) el.indeterminate = onCount > 0 && !allOn; }}
                        onChange={() => toggleModuleAll(m)} className="accent-brand-600 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-gray-800">{m.label}</p>
                          {m.always && <span className="text-[10px] bg-gray-200 text-gray-500 px-1.5 py-0.5 rounded-full">Always On</span>}
                          <span className="text-[10px] text-gray-400">{onCount}/{fkeys.length} features</span>
                        </div>
                        <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{m.description}</p>
                      </div>
                    </label>
                    {/* Feature-area checkboxes */}
                    <div className="px-3 pb-3 pl-9 grid grid-cols-2 gap-x-4 gap-y-1.5">
                      {m.features.map((f) => (
                        <label key={f.key} className="flex items-center gap-2 cursor-pointer">
                          <input type="checkbox" checked={selectedFeatures.includes(f.key)}
                            onChange={() => toggleFeature(f.key)} className="accent-brand-600 shrink-0" />
                          <span className="text-xs text-gray-700">{f.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-gray-400 mt-3">
              {selectedModuleCount} module{selectedModuleCount !== 1 ? 's' : ''} · {selectedFeatures.length} feature{selectedFeatures.length !== 1 ? 's' : ''} allocated
            </p>
          </div>
        )}

        {mutation.isError && (
          <p className="mt-3 text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">
            {(mutation.error as any)?.response?.data?.error?.message ?? 'Failed to create workspace'}
          </p>
        )}

        <div className="flex gap-2 mt-6">
          {step === 'details' && (
            <>
              <button onClick={onClose} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
              <button onClick={() => setStep('sector')} disabled={!detailsValid}
                className="flex-1 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700 disabled:opacity-50 flex items-center justify-center gap-2">
                Next: Choose Sector →
              </button>
            </>
          )}
          {step === 'sector' && (
            <>
              <button onClick={() => setStep('details')} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">← Back</button>
              <button onClick={() => setStep('modules')}
                className="flex-1 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700 flex items-center justify-center gap-2">
                Next: Allocate Modules →
              </button>
            </>
          )}
          {step === 'modules' && (
            <>
              <button onClick={() => setStep('sector')} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">← Back</button>
              <button
                onClick={() => mutation.mutate()}
                disabled={mutation.isPending}
                className="flex-1 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700 disabled:opacity-50 flex items-center justify-center gap-2">
                {mutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                Create Workspace
              </button>
            </>
          )}
        </div>
        </>)}
      </div>
    </div>
  );
}

// ── Tenant row actions popover ─────────────────────────────────────────────
function TenantActions({ tenant, onClose }: { tenant: any; onClose: () => void }) {
  const qc = useQueryClient();

  const planMutation = useMutation({
    mutationFn: ({ id, plan }: { id: string; plan: string }) =>
      api.patch(`/super-admin/tenants/${id}/plan`, { plan }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sa-tenants'] }); onClose(); },
  });

  const suspendMutation = useMutation({
    mutationFn: (id: string) => api.post(`/super-admin/tenants/${id}/suspend`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sa-tenants'] }); onClose(); },
  });

  const activateMutation = useMutation({
    mutationFn: (id: string) => api.post(`/super-admin/tenants/${id}/activate`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sa-tenants'] }); onClose(); },
  });

  const modulesMutation = useMutation({
    mutationFn: ({ id, modules }: { id: string; modules: string[] }) =>
      api.patch(`/super-admin/tenants/${id}/modules`, { modules }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sa-tenants'] }); onClose(); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/super-admin/tenants/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sa-tenants'] }); onClose(); },
  });

  const [activeModules, setActiveModules] = useState<string[]>(tenant.active_modules ?? ['crm']);
  const [showModules, setShowModules] = useState(false);

  // Catalog (cached) — used to label the workspace's agreed feature entitlement.
  const { data: licenseCatalog = [] } = useQuery<Array<{ key: string; label: string; features: { key: string; label: string }[] }>>({
    queryKey: ['license-catalog'],
    queryFn: () => api.get('/super-admin/modules').then((r) => r.data.data),
  });
  const entitledFeatures: string[] = Array.isArray(tenant.entitled_features) ? tenant.entitled_features : [];
  const featureLabel = (key: string) =>
    licenseCatalog.flatMap((m) => m.features).find((f) => f.key === key)?.label ?? key;
  const resetPasswordMutation = useMutation({
    mutationFn: (id: string) => api.post(`/super-admin/tenants/${id}/reset-admin-password`),
  });

  const [showManageRoles, setShowManageRoles] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showUsers, setShowUsers] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showResetResult, setShowResetResult] = useState(false);
  const [showVoiceBotMinutes, setShowVoiceBotMinutes] = useState(false);
  const [showOwnership, setShowOwnership] = useState(false);

  return (
    // Click-away overlay and the menu are SIBLINGS: the menu anchors to the
    // ⋮ button's cell (the td is `relative`), not to the full-screen overlay.
    // The previous structure nested the menu inside the fixed inset-0 overlay
    // with top:100% — 100% of the VIEWPORT — so it always rendered just below
    // the screen and the menu was unusable since day one (found 2026-07-13).
    <div onClick={(e) => e.stopPropagation()}>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute right-2 top-9 w-56 bg-white rounded-xl shadow-xl border border-gray-100 py-1 z-50 max-h-[70vh] overflow-y-auto">

        {/* Plan change */}
        <div className="px-3 py-2 border-b border-gray-50">
          <p className="text-xs font-semibold text-gray-400 mb-2">Change Plan</p>
          <div className="grid grid-cols-2 gap-1">
            {PLANS.map((p) => (
              <button key={p}
                onClick={() => planMutation.mutate({ id: tenant.id, plan: p })}
                className={`py-1 px-2 rounded text-xs capitalize transition-colors ${
                  tenant.plan === p ? 'bg-brand-100 text-brand-700 font-medium' : 'hover:bg-gray-50 text-gray-600'
                }`}>
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* Modules */}
        <button onClick={() => setShowModules(!showModules)}
          className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-50">
          <Package className="w-4 h-4 text-gray-400" />
          <span>Licensed Modules</span>
          <span className="ml-auto text-xs bg-brand-50 text-brand-600 px-1.5 py-0.5 rounded-full font-medium">
            {activeModules.length}
          </span>
        </button>
        {showModules && (
          <div className="px-3 pb-3 space-y-1.5 border-t border-gray-50 pt-2">
            {/* Agreed feature entitlement (read-only) captured at workspace creation */}
            <div className="mb-2">
              <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Agreed Features</p>
              {entitledFeatures.length === 0 ? (
                <p className="text-[10px] text-gray-400">No specific features recorded (legacy workspace).</p>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {entitledFeatures.map((k) => (
                    <span key={k} className="text-[10px] bg-brand-50 text-brand-700 px-1.5 py-0.5 rounded-full">{featureLabel(k)}</span>
                  ))}
                </div>
              )}
            </div>
            <p className="text-[10px] text-gray-400 mb-2 leading-relaxed">
              Check only modules this tenant has <strong>paid for</strong>.
              Unchecked modules are hidden from their workspace.
            </p>
            {ALL_MODULES.map((m) => {
              const isOn = activeModules.includes(m.key);
              return (
                <label key={m.key} className={`flex items-start gap-2 py-1.5 px-1.5 rounded-lg cursor-pointer transition-colors ${
                  isOn ? 'bg-brand-50' : 'hover:bg-gray-50'
                }`}>
                  <input type="checkbox"
                    checked={isOn}
                    disabled={m.always}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? [...activeModules, m.key]
                        : activeModules.filter((x) => x !== m.key);
                      setActiveModules(next);
                    }}
                    className="accent-brand-600 mt-0.5 shrink-0" />
                  <span className="text-base shrink-0 leading-none mt-0.5">{m.icon}</span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className={`text-xs font-medium ${isOn ? 'text-gray-800' : 'text-gray-500'}`}>{m.label}</span>
                      {m.always && <span className="text-[9px] bg-gray-200 text-gray-500 px-1 py-0.5 rounded">Always On</span>}
                    </div>
                    <p className="text-[10px] text-gray-400 leading-relaxed mt-0.5">{m.description}</p>
                  </div>
                </label>
              );
            })}
            {modulesMutation.isError && (
              <p className="text-[10px] text-red-600 bg-red-50 px-2 py-1 rounded">
                {(modulesMutation.error as any)?.response?.data?.error?.message ?? 'Save failed'}
              </p>
            )}
            <button
              onClick={() => modulesMutation.mutate({ id: tenant.id, modules: activeModules })}
              disabled={modulesMutation.isPending}
              className="mt-1 w-full py-1.5 bg-brand-600 text-white rounded text-xs hover:bg-brand-700 disabled:opacity-50 flex items-center justify-center gap-1.5">
              {modulesMutation.isPending ? <><Loader2 className="w-3 h-3 animate-spin" />Saving…</> : <><Check className="w-3 h-3" />Apply Licensed Modules</>}
            </button>
          </div>
        )}

        {/* Manage Roles */}
        <button onClick={() => setShowManageRoles(true)}
          className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-50">
          <KeyRound className="w-4 h-4 text-gray-400" />
          <span>Manage Role Permissions</span>
        </button>

        {/* Edit workspace */}
        <button onClick={() => setShowEdit(true)}
          className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-50">
          <Edit2 className="w-4 h-4 text-gray-400" /> Edit Workspace
        </button>

        {/* Reset admin password */}
        {showResetResult && resetPasswordMutation.data ? (
          <div className="px-3 py-2 border-t border-gray-50 space-y-1.5">
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">New Temp Password</p>
            <p className="font-mono text-xs bg-amber-50 border border-amber-100 px-2 py-1 rounded text-gray-900 select-all">
              {resetPasswordMutation.data.data?.data?.tempPassword}
            </p>
            <p className="text-[10px] text-gray-400">
              {resetPasswordMutation.data.data?.data?.emailSent
                ? `Emailed to ${resetPasswordMutation.data.data?.data?.adminEmail}`
                : 'No system email configured — share this securely'}
            </p>
            <button onClick={() => { setShowResetResult(false); resetPasswordMutation.reset(); }}
              className="text-[10px] text-gray-400 hover:text-gray-600 underline">Dismiss</button>
          </div>
        ) : (
          <button
            onClick={() => {
              resetPasswordMutation.mutate(tenant.id, {
                onSuccess: () => setShowResetResult(true),
              });
            }}
            disabled={resetPasswordMutation.isPending}
            className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            <KeyRound className="w-4 h-4 text-gray-400" />
            {resetPasswordMutation.isPending ? 'Resetting…' : 'Reset Admin Password'}
          </button>
        )}

        {/* Users */}
        <button onClick={() => setShowUsers(!showUsers)}
          className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-50">
          <Users className="w-4 h-4 text-gray-400" /> Manage Users
          {showUsers ? <ChevronDown className="w-3 h-3 ml-auto text-gray-400" /> : <ChevronRight className="w-3 h-3 ml-auto text-gray-400" />}
        </button>

        {/* Voice Bot minutes — only relevant once the tenant is licensed for it */}
        {(tenant.active_modules ?? []).includes('voice_bot') && (
          <button onClick={() => setShowVoiceBotMinutes(true)}
            className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-50">
            <Phone className="w-4 h-4 text-gray-400" /> Voice Bot Minutes
          </button>
        )}

        {/* Centralized ownership — who configures Voice Bot / Integrations for this tenant */}
        <button onClick={() => setShowOwnership(true)}
          className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-50">
          <Lock className="w-4 h-4 text-gray-400" /> Config Ownership
        </button>

        {/* Status actions */}
        <div className="border-t border-gray-50 mt-1 pt-1">
          {tenant.status !== 'suspended' ? (
            <button onClick={() => suspendMutation.mutate(tenant.id)}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-red-600 hover:bg-red-50">
              <Ban className="w-4 h-4" /> Suspend Workspace
            </button>
          ) : (
            <button onClick={() => activateMutation.mutate(tenant.id)}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-green-600 hover:bg-green-50">
              <Play className="w-4 h-4" /> Reactivate Workspace
            </button>
          )}
          {confirmDelete ? (
            <div className="px-3 py-2 space-y-1">
              <p className="text-xs text-red-700 font-semibold">Delete "{tenant.name}"?</p>
              <p className="text-[10px] text-red-500">This is irreversible. All data will be lost.</p>
              <div className="flex gap-1 mt-1">
                <button onClick={() => setConfirmDelete(false)} className="flex-1 py-1 text-xs border border-gray-200 rounded hover:bg-gray-50">Cancel</button>
                <button onClick={() => deleteMutation.mutate(tenant.id)} disabled={deleteMutation.isPending}
                  className="flex-1 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50">
                  {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setConfirmDelete(true)}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-red-700 hover:bg-red-50">
              <Trash2 className="w-4 h-4" /> Delete Workspace
            </button>
          )}
        </div>
      </div>
      {showManageRoles && (
        <TenantRolesModal tenant={tenant} onClose={() => { setShowManageRoles(false); onClose(); }} />
      )}
      {showEdit && (
        <EditWorkspaceModal tenant={tenant} onClose={() => { setShowEdit(false); onClose(); }} />
      )}
      {showUsers && (
        <TenantUsersModal tenant={tenant} onClose={() => { setShowUsers(false); onClose(); }} />
      )}
      {showVoiceBotMinutes && (
        <VoiceBotMinutesModal tenant={tenant} onClose={() => { setShowVoiceBotMinutes(false); onClose(); }} />
      )}
      {showOwnership && (
        <ConfigOwnershipModal tenant={tenant} onClose={() => { setShowOwnership(false); onClose(); }} />
      )}
    </div>
  );
}

// ── Config Ownership Modal — Phase 1 of the shared hold/push model ─────────
// Lets a Super Admin decide, per tenant, whether Voice Bot and each of the
// three Integrations categories are configured by the tenant admin (as
// always) or held centrally. When held, this same modal is where the
// Super Admin edits the tenant's Voice Bot directly.
function ConfigOwnershipModal({ tenant, onClose }: { tenant: any; onClose: () => void }) {
  const qc = useQueryClient();
  const [voiceBotOwnership, setVoiceBotOwnership] = useState<string>(tenant.settings?.voice_bot_ownership ?? 'tenant_admin');
  const [integrationOwnership, setIntegrationOwnership] = useState<{ connectors: string; webhooks: string; api_keys: string }>({
    connectors: tenant.settings?.integration_ownership?.connectors ?? 'tenant_admin',
    webhooks:   tenant.settings?.integration_ownership?.webhooks   ?? 'tenant_admin',
    api_keys:   tenant.settings?.integration_ownership?.api_keys   ?? 'tenant_admin',
  });

  const { data: botConfig } = useQuery({
    queryKey: ['sa-voice-bot-config', tenant.id],
    queryFn: () => api.get(`/super-admin/tenants/${tenant.id}/voice-bot-config`).then(r => r.data.data),
    enabled: voiceBotOwnership === 'super_admin',
  });
  const { data: voices } = useQuery<Array<{ id: string; voice_id: string; label: string }>>({
    queryKey: ['sa-voice-bot-voices'],
    queryFn: () => api.get('/super-admin/voice-bot-voices').then(r => r.data.data),
    enabled: voiceBotOwnership === 'super_admin',
  });
  const [botForm, setBotForm] = useState<any>(null);
  const blankBotForm = {
    botName: 'Nadia', greetingMessage: '', systemPrompt: '', tone: 'professional', speakingRate: 0.9,
    voiceId: 'helpdesk-agent', language: 'ur-PK', guardrails: '', isActive: true, recordingEnabled: false,
    selfServiceIntents: [] as string[], sipTrunkProvider: '', sipTrunkNumber: '', sipUri: '',
    sipTrunkUsername: '', sipTrunkPassword: '', sipTrunkNickname: '', outboundTransport: 'TCP',
    maxConcurrentCalls: '', humanTransferDestination: '', holdMessage: '',
  };
  useEffect(() => {
    if (botConfig) {
      setBotForm({
        botName: botConfig.bot_name ?? 'Nadia',
        greetingMessage: botConfig.greeting_message ?? '',
        systemPrompt: botConfig.system_prompt ?? '',
        tone: botConfig.tone ?? 'professional',
        speakingRate: Number(botConfig.speaking_rate ?? 0.9),
        voiceId: botConfig.voice_id ?? 'helpdesk-agent',
        language: botConfig.language ?? 'ur-PK',
        guardrails: botConfig.guardrails ?? '',
        isActive: botConfig.is_active ?? true,
        recordingEnabled: botConfig.recording_enabled ?? false,
        selfServiceIntents: botConfig.self_service_intents ?? [],
        sipTrunkProvider: botConfig.sip_trunk_provider ?? '',
        sipTrunkNumber: botConfig.sip_trunk_number ?? '',
        sipUri: botConfig.sip_uri ?? '',
        sipTrunkUsername: botConfig.sip_trunk_username ?? '',
        sipTrunkPassword: botConfig.sip_trunk_password ?? '',
        sipTrunkNickname: botConfig.sip_trunk_nickname ?? '',
        outboundTransport: botConfig.outbound_transport ?? 'TCP',
        maxConcurrentCalls: botConfig.max_concurrent_calls != null ? String(botConfig.max_concurrent_calls) : '',
        humanTransferDestination: botConfig.human_transfer_destination ?? '',
        holdMessage: botConfig.hold_message ?? '',
      });
    } else if (voiceBotOwnership === 'super_admin' && botForm === null) {
      setBotForm(blankBotForm);
    }
  }, [botConfig, voiceBotOwnership]);

  // Knowledge base — same table the tenant page uses, scoped to this tenant
  const { data: kbEntries } = useQuery<Array<{ id: string; title: string; content: string; keywords: string[]; is_active: boolean }>>({
    queryKey: ['sa-voice-bot-kb', tenant.id],
    queryFn: () => api.get(`/super-admin/tenants/${tenant.id}/voice-bot-knowledge-base`).then(r => r.data.data),
    enabled: voiceBotOwnership === 'super_admin',
  });
  // Phase 2: knowledge base entries can come from text, a crawled URL, or
  // an uploaded PDF/DOCX (text extracted server-side) — same three sources
  // the tenant-side page already supports, now with parity here too.
  const [kbMode, setKbMode] = useState<'text' | 'url' | 'file'>('text');
  const [kbTitle, setKbTitle] = useState('');
  const [kbContent, setKbContent] = useState('');
  const [kbKeywords, setKbKeywords] = useState('');
  const [kbUrl, setKbUrl] = useState('');
  const [kbFile, setKbFile] = useState<File | null>(null);
  const resetKbForm = () => { setKbTitle(''); setKbContent(''); setKbKeywords(''); setKbUrl(''); setKbFile(null); };

  const addKbMut = useMutation({
    mutationFn: () => api.post(`/super-admin/tenants/${tenant.id}/voice-bot-knowledge-base`, {
      title: kbTitle, content: kbContent, keywords: kbKeywords.split(',').map(k => k.trim()).filter(Boolean),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sa-voice-bot-kb', tenant.id] }); resetKbForm(); },
  });
  const importUrlKbMut = useMutation({
    mutationFn: () => api.post(`/super-admin/tenants/${tenant.id}/voice-bot-knowledge-base/import-url`, {
      title: kbTitle, url: kbUrl, keywords: kbKeywords.split(',').map(k => k.trim()).filter(Boolean),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sa-voice-bot-kb', tenant.id] }); resetKbForm(); },
  });
  const uploadKbMut = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append('file', kbFile!);
      fd.append('title', kbTitle);
      fd.append('keywords', kbKeywords);
      return api.post(`/super-admin/tenants/${tenant.id}/voice-bot-knowledge-base/upload`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sa-voice-bot-kb', tenant.id] }); resetKbForm(); },
  });
  const kbSubmitMut = kbMode === 'url' ? importUrlKbMut : kbMode === 'file' ? uploadKbMut : addKbMut;
  const kbCanSubmit = kbMode === 'text' ? !!(kbTitle && kbContent && kbKeywords)
    : kbMode === 'url' ? !!(kbTitle && kbUrl && kbKeywords)
    : !!(kbTitle && kbFile && kbKeywords);
  const toggleKbMut = useMutation({
    mutationFn: ({ id: entryId, isActive }: { id: string; isActive: boolean }) =>
      api.put(`/super-admin/tenants/${tenant.id}/voice-bot-knowledge-base/${entryId}`, { isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sa-voice-bot-kb', tenant.id] }),
  });
  const deleteKbMut = useMutation({
    mutationFn: (entryId: string) => api.delete(`/super-admin/tenants/${tenant.id}/voice-bot-knowledge-base/${entryId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sa-voice-bot-kb', tenant.id] }),
  });

  const saveOwnershipMut = useMutation({
    mutationFn: async () => {
      await api.patch(`/super-admin/tenants/${tenant.id}/voice-bot-ownership`, { ownership: voiceBotOwnership });
      await api.patch(`/super-admin/tenants/${tenant.id}/integration-ownership`, integrationOwnership);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sa-tenants'] }),
  });

  const [smsGatewayEnabled, setSmsGatewayEnabled] = useState<boolean>(tenant.settings?.connectors?.platform_sms?.enabled ?? false);
  const smsGatewayMut = useMutation({
    mutationFn: (enabled: boolean) => api.patch(`/super-admin/tenants/${tenant.id}/sms-gateway`, { enabled }),
    onSuccess: (_data, enabled) => { setSmsGatewayEnabled(enabled); qc.invalidateQueries({ queryKey: ['sa-tenants'] }); },
  });

  // Branded hold audio — played to the caller while the bot does back-office
  // work mid-call (e.g. creating a ticket), stopped the instant it's ready.
  const [holdAudioFile, setHoldAudioFile] = useState<File | null>(null);
  const uploadHoldAudioMut = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append('file', holdAudioFile!);
      return api.post(`/super-admin/tenants/${tenant.id}/voice-bot-hold-audio`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sa-voice-bot-config', tenant.id] }); setHoldAudioFile(null); },
  });
  const removeHoldAudioMut = useMutation({
    mutationFn: () => api.delete(`/super-admin/tenants/${tenant.id}/voice-bot-hold-audio`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sa-voice-bot-config', tenant.id] }),
  });

  const saveBotConfigMut = useMutation({
    // Empty-string fields mean "left blank", not "clear this out" — omit them
    // so the backend's COALESCE keeps whatever was already saved.
    mutationFn: () => {
      const payload = Object.fromEntries(
        Object.entries(botForm).filter(([, v]) => v !== ''),
      );
      return api.put(`/super-admin/tenants/${tenant.id}/voice-bot-config`, payload);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sa-voice-bot-config', tenant.id] }),
  });

  const radioRow = (label: string, value: string, onChange: (v: string) => void) => (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm text-gray-700">{label}</span>
      <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
        {(['tenant_admin', 'super_admin'] as const).map(v => (
          <button key={v} onClick={() => onChange(v)}
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${value === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
            {v === 'tenant_admin' ? 'Tenant Admin' : 'Super Admin'}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 flex flex-col" style={{ maxHeight: '90vh' }}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Config Ownership — {tenant.name}</h3>
            <p className="text-xs text-gray-400">Who configures each area for this workspace</p>
          </div>
          <button onClick={onClose}><X className="w-4 h-4 text-gray-400" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-1">
          {radioRow('Voice Bot', voiceBotOwnership, setVoiceBotOwnership)}
          <div className="border-t border-gray-50" />
          {radioRow('Channels & Services', integrationOwnership.connectors, v => setIntegrationOwnership(o => ({ ...o, connectors: v })))}
          {radioRow('Webhooks', integrationOwnership.webhooks, v => setIntegrationOwnership(o => ({ ...o, webhooks: v })))}
          {radioRow('API Keys', integrationOwnership.api_keys, v => setIntegrationOwnership(o => ({ ...o, api_keys: v })))}

          <div className="pt-2">
            <button onClick={() => saveOwnershipMut.mutate()} disabled={saveOwnershipMut.isPending}
              className="w-full py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {saveOwnershipMut.isPending ? 'Saving…' : 'Save Ownership Settings'}
            </button>
            {saveOwnershipMut.isSuccess && <p className="text-xs text-green-600 text-center mt-1">Saved.</p>}
          </div>

          <div className="border-t border-gray-100 pt-4 mt-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Platform SMS Gateway</p>
            <p className="text-xs text-gray-400 mb-3">
              When enabled, this tenant can send SMS through AmanahCX's shared gateway with zero setup on their end —
              used automatically whenever they haven't configured their own SMS connector.
            </p>
            <label className="flex items-center justify-between p-3 bg-gray-50 rounded-lg cursor-pointer">
              <span className="text-sm text-gray-700">Enable shared SMS gateway</span>
              <button
                type="button"
                onClick={() => smsGatewayMut.mutate(!smsGatewayEnabled)}
                disabled={smsGatewayMut.isPending}
                className={`w-10 h-6 rounded-full transition-colors relative disabled:opacity-50 ${smsGatewayEnabled ? 'bg-brand-500' : 'bg-gray-300'}`}
              >
                <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${smsGatewayEnabled ? 'translate-x-5' : 'translate-x-1'}`} />
              </button>
            </label>
            {smsGatewayMut.isSuccess && <p className="text-xs text-green-600 mt-1">Saved.</p>}
            {smsGatewayMut.isError && <p className="text-xs text-red-500 mt-1">Failed to save.</p>}
          </div>

          {voiceBotOwnership === 'super_admin' && botForm && (
            <div className="mt-5 pt-4 border-t border-gray-100">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Edit Voice Bot Directly</p>
              <div className="space-y-2.5">
                <input value={botForm.botName} onChange={e => setBotForm((f: any) => ({ ...f, botName: e.target.value }))}
                  placeholder="Bot Name" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                <textarea value={botForm.greetingMessage} onChange={e => setBotForm((f: any) => ({ ...f, greetingMessage: e.target.value }))}
                  placeholder="Greeting message" rows={2} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm resize-none" />
                <textarea value={botForm.systemPrompt} onChange={e => setBotForm((f: any) => ({ ...f, systemPrompt: e.target.value }))}
                  placeholder="System prompt / behaviour instructions" rows={3} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm resize-none" />
                <div className="flex gap-2">
                  <select value={botForm.tone} onChange={e => setBotForm((f: any) => ({ ...f, tone: e.target.value }))}
                    className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
                    {['professional', 'friendly', 'empathetic', 'formal'].map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <input type="number" step="0.05" min="0.5" max="2" value={botForm.speakingRate}
                    onChange={e => setBotForm((f: any) => ({ ...f, speakingRate: Number(e.target.value) }))}
                    className="w-24 px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                </div>
                <div className="flex gap-2">
                  <select value={botForm.voiceId} onChange={e => setBotForm((f: any) => ({ ...f, voiceId: e.target.value }))}
                    className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
                    {(voices ?? []).map(v => <option key={v.id} value={v.voice_id}>{v.label}</option>)}
                    {(voices ?? []).length === 0 && <option value={botForm.voiceId}>{botForm.voiceId}</option>}
                  </select>
                  <input value={botForm.language} onChange={e => setBotForm((f: any) => ({ ...f, language: e.target.value }))}
                    placeholder="Language (e.g. ur-PK)" className="w-32 px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                </div>
                <textarea value={botForm.guardrails} onChange={e => setBotForm((f: any) => ({ ...f, guardrails: e.target.value }))}
                  placeholder="Guardrails — hard limits" rows={2} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm resize-none" />

                <div className="flex items-center justify-between py-1">
                  <span className="text-sm text-gray-600">Record calls (audio)</span>
                  <button onClick={() => setBotForm((f: any) => ({ ...f, recordingEnabled: !f.recordingEnabled }))}>
                    {botForm.recordingEnabled
                      ? <ToggleRight className="w-7 h-7 text-green-500" />
                      : <ToggleLeft className="w-7 h-7 text-gray-300" />}
                  </button>
                </div>

                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-1.5">Self-Service Intents (No Ticket)</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {[
                      { value: 'balance_inquiry', label: 'Balance / Account' },
                      { value: 'order_status', label: 'Order Status' },
                      { value: 'branch_hours', label: 'Branch Hours' },
                      { value: 'installment_info', label: 'Installment / EMI' },
                      { value: 'faq', label: 'General FAQ' },
                    ].map(opt => {
                      const selected = (botForm.selfServiceIntents ?? []).includes(opt.value);
                      return (
                        <label key={opt.value} className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                          <input type="checkbox" checked={selected} onChange={() => {
                            const cur = botForm.selfServiceIntents ?? [];
                            setBotForm((f: any) => ({ ...f, selfServiceIntents: selected ? cur.filter((i: string) => i !== opt.value) : [...cur, opt.value] }));
                          }} className="w-3.5 h-3.5" />
                          {opt.label}
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="pt-2 border-t border-gray-50">
                  <p className="text-xs font-semibold text-gray-500 mb-1.5">SIP Trunk Connection</p>
                  <div className="grid grid-cols-2 gap-2">
                    <input value={botForm.sipTrunkProvider} onChange={e => setBotForm((f: any) => ({ ...f, sipTrunkProvider: e.target.value }))}
                      placeholder="Provider (e.g. Telecard)" className="px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                    <input value={botForm.sipTrunkNumber} onChange={e => setBotForm((f: any) => ({ ...f, sipTrunkNumber: e.target.value }))}
                      placeholder="Phone Number" className="px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                    <input value={botForm.sipUri} onChange={e => setBotForm((f: any) => ({ ...f, sipUri: e.target.value }))}
                      placeholder="Termination URI" className="col-span-2 px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                    <input value={botForm.sipTrunkUsername} onChange={e => setBotForm((f: any) => ({ ...f, sipTrunkUsername: e.target.value }))}
                      placeholder="Username" className="px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                    <input value={botForm.sipTrunkPassword} onChange={e => setBotForm((f: any) => ({ ...f, sipTrunkPassword: e.target.value }))}
                      placeholder="Password" type="password" className="px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                    <input value={botForm.sipTrunkNickname} onChange={e => setBotForm((f: any) => ({ ...f, sipTrunkNickname: e.target.value }))}
                      placeholder="Nickname" className="px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                    <select value={botForm.outboundTransport} onChange={e => setBotForm((f: any) => ({ ...f, outboundTransport: e.target.value }))}
                      className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
                      {['TCP', 'UDP'].map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                </div>

                <div className="pt-2 border-t border-gray-50">
                  <p className="text-xs font-semibold text-gray-500 mb-1.5">Capacity</p>
                  <input value={botForm.maxConcurrentCalls} type="number" min={1}
                    onChange={e => setBotForm((f: any) => ({ ...f, maxConcurrentCalls: e.target.value }))}
                    placeholder="Max concurrent calls for this tenant (blank = unlimited)"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                  <p className="text-[11px] text-gray-400 mt-1">
                    Caps how many calls Nadia will answer for this tenant at once — protects other
                    tenants sharing the same server from being crowded out during a busy period.
                  </p>
                  <input value={botForm.humanTransferDestination}
                    onChange={e => setBotForm((f: any) => ({ ...f, humanTransferDestination: e.target.value }))}
                    placeholder="Human transfer destination (e.g. +9221xxxxxxx or sip:queue@host)"
                    className="w-full mt-2 px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                  <p className="text-[11px] text-gray-400 mt-1">
                    Where Nadia hands a call off when she can't take it herself (minutes exhausted
                    or over capacity). Leave blank until confirmed with the trunk/call-center
                    provider — a live call is transferred here immediately, so it must be the
                    call center's own real inbound address, not a random number.
                  </p>
                </div>

                <div className="pt-2 border-t border-gray-50">
                  <p className="text-xs font-semibold text-gray-500 mb-1.5">Hold Experience</p>
                  <input value={botForm.holdMessage}
                    onChange={e => setBotForm((f: any) => ({ ...f, holdMessage: e.target.value }))}
                    placeholder='Hold message (e.g. "Please wait while I create your ticket")'
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                  <p className="text-[11px] text-gray-400 mt-1 mb-2">
                    Spoken while the bot creates a ticket. If a hold audio clip is uploaded below,
                    the clip plays instead and stops the moment the bot is ready to speak.
                  </p>
                  {botConfig?.hold_audio_filename ? (
                    <div className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                      <p className="text-xs text-gray-700 truncate">🎵 {botConfig.hold_audio_filename}</p>
                      <button onClick={() => removeHoldAudioMut.mutate()}
                        className="text-xs text-red-600 hover:underline shrink-0">Remove</button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <input type="file" accept="audio/*,.mp3,.wav,.ogg,.m4a"
                        onChange={e => setHoldAudioFile(e.target.files?.[0] ?? null)}
                        className="flex-1 text-xs text-gray-600 file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-gray-100 file:text-gray-700" />
                      <button onClick={() => uploadHoldAudioMut.mutate()}
                        disabled={!holdAudioFile || uploadHoldAudioMut.isPending}
                        className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 rounded-lg disabled:opacity-50 shrink-0">
                        {uploadHoldAudioMut.isPending ? 'Uploading…' : 'Upload'}
                      </button>
                    </div>
                  )}
                  {uploadHoldAudioMut.isError && <p className="text-[11px] text-red-600 mt-1">
                    {(uploadHoldAudioMut.error as any)?.response?.data?.error || 'Upload failed — audio files only, max 5 MB.'}
                  </p>}
                </div>

                <button onClick={() => saveBotConfigMut.mutate()} disabled={saveBotConfigMut.isPending}
                  className="w-full py-2 text-sm font-semibold text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50">
                  {saveBotConfigMut.isPending ? 'Saving…' : 'Save Bot Configuration'}
                </button>
                {saveBotConfigMut.isSuccess && <p className="text-xs text-green-600 text-center mt-1">Saved.</p>}
              </div>

              <div className="mt-5 pt-4 border-t border-gray-100">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Knowledge Base</p>
                {(kbEntries ?? []).length > 0 && (
                  <div className="space-y-1.5 mb-3">
                    {kbEntries!.map(e => (
                      <div key={e.id} className="flex items-start justify-between gap-2 bg-gray-50 rounded-lg px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-gray-800 truncate">{e.title}</p>
                          <p className="text-[11px] text-gray-500 truncate">{e.content}</p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button onClick={() => toggleKbMut.mutate({ id: e.id, isActive: !e.is_active })}>
                            {e.is_active ? <ToggleRight className="w-5 h-5 text-green-500" /> : <ToggleLeft className="w-5 h-5 text-gray-300" />}
                          </button>
                          <button onClick={() => deleteKbMut.mutate(e.id)}><Trash2 className="w-3.5 h-3.5 text-gray-400 hover:text-red-500" /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="space-y-1.5">
                  <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5 mb-1">
                    {(['text', 'url', 'file'] as const).map(m => (
                      <button key={m} onClick={() => setKbMode(m)}
                        className={`flex-1 px-2 py-1.5 text-xs font-medium rounded-md transition-colors ${kbMode === m ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
                        {m === 'text' ? 'Add Text' : m === 'url' ? 'Add Web Page' : 'Upload File'}
                      </button>
                    ))}
                  </div>

                  <input value={kbTitle} onChange={e => setKbTitle(e.target.value)} placeholder="Title (e.g. Branch Hours)"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />

                  {kbMode === 'text' && (
                    <textarea value={kbContent} onChange={e => setKbContent(e.target.value)} placeholder="Answer Nadia should give" rows={2}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm resize-none" />
                  )}
                  {kbMode === 'url' && (
                    <input value={kbUrl} onChange={e => setKbUrl(e.target.value)} placeholder="https://example.com/faq"
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                  )}
                  {kbMode === 'file' && (
                    <input type="file" accept=".pdf,.docx" onChange={e => setKbFile(e.target.files?.[0] ?? null)}
                      className="w-full text-xs text-gray-600 file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-gray-100 file:text-gray-700" />
                  )}

                  <input value={kbKeywords} onChange={e => setKbKeywords(e.target.value)} placeholder="Keywords, comma separated"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                  <button onClick={() => kbSubmitMut.mutate()} disabled={!kbCanSubmit || kbSubmitMut.isPending}
                    className="w-full py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">
                    {kbSubmitMut.isPending ? 'Adding…' : '+ Add Entry'}
                  </button>
                  {kbSubmitMut.isError && <p className="text-xs text-red-600 text-center">
                    {(kbSubmitMut.error as any)?.response?.data?.error || 'Failed to add — check the file/URL and try again.'}
                  </p>}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Voice Bot Minutes Modal ─────────────────────────────────────────────────
function VoiceBotMinutesModal({ tenant, onClose }: { tenant: any; onClose: () => void }) {
  const [minutesToAdd, setMinutesToAdd] = useState('');
  const [note, setNote] = useState('');

  const { data: usage, isLoading, refetch } = useQuery<{
    allocatedMinutes: number; consumedMinutes: number; remainingMinutes: number; callCount: number;
    topups: Array<{ id: string; minutes_added: number; note: string | null; created_at: string; created_by_name: string | null }>;
  }>({
    queryKey: ['sa-voice-bot-usage', tenant.id],
    queryFn: () => api.get(`/super-admin/tenants/${tenant.id}/voice-bot-usage`).then(r => r.data.data),
  });

  const topUpMutation = useMutation({
    mutationFn: () => api.post(`/super-admin/tenants/${tenant.id}/voice-bot-minutes`, {
      minutesToAdd: Number(minutesToAdd),
      note: note || undefined,
    }),
    onSuccess: () => { refetch(); setMinutesToAdd(''); setNote(''); },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 flex flex-col" style={{ maxHeight: '85vh' }}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Voice Bot Minutes — {tenant.name}</h3>
            <p className="text-xs text-gray-400 font-mono">{tenant.slug}</p>
          </div>
          <button onClick={onClose}><X className="w-4 h-4 text-gray-400" /></button>
        </div>
        <div className="overflow-y-auto flex-1 p-6 space-y-5">
          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="bg-gray-50 rounded-xl py-3">
                  <p className="text-lg font-bold text-gray-900">{usage?.allocatedMinutes.toFixed(0) ?? 0}</p>
                  <p className="text-[10px] text-gray-400">Allocated</p>
                </div>
                <div className="bg-gray-50 rounded-xl py-3">
                  <p className="text-lg font-bold text-gray-900">{usage?.consumedMinutes.toFixed(0) ?? 0}</p>
                  <p className="text-[10px] text-gray-400">Consumed</p>
                </div>
                <div className={`rounded-xl py-3 ${(usage?.remainingMinutes ?? 0) <= 0 ? 'bg-red-50' : 'bg-brand-50'}`}>
                  <p className={`text-lg font-bold ${(usage?.remainingMinutes ?? 0) <= 0 ? 'text-red-600' : 'text-brand-600'}`}>{usage?.remainingMinutes.toFixed(0) ?? 0}</p>
                  <p className="text-[10px] text-gray-400">Remaining</p>
                </div>
              </div>

              <div className="border border-gray-100 rounded-xl p-4">
                <p className="text-xs font-semibold text-gray-700 mb-2">Add Minutes</p>
                <div className="flex gap-2 mb-2">
                  <input type="number" min="1" placeholder="e.g. 1000" value={minutesToAdd}
                    onChange={e => setMinutesToAdd(e.target.value)}
                    className="w-28 border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-brand-400" />
                  <input type="text" placeholder="Note (optional, e.g. invoice #)" value={note}
                    onChange={e => setNote(e.target.value)}
                    className="flex-1 border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-brand-400" />
                  <button onClick={() => topUpMutation.mutate()}
                    disabled={!minutesToAdd || Number(minutesToAdd) <= 0 || topUpMutation.isPending}
                    className="px-3 py-1.5 bg-brand-600 text-white text-xs rounded-lg hover:bg-brand-700 disabled:opacity-40 whitespace-nowrap">
                    {topUpMutation.isPending ? 'Adding…' : 'Top Up'}
                  </button>
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-gray-700 mb-2">Top-Up History</p>
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {(usage?.topups ?? []).length === 0 && <p className="text-[11px] text-gray-400">No top-ups recorded yet.</p>}
                  {usage?.topups.map(t => (
                    <div key={t.id} className="flex items-center justify-between text-[11px] bg-gray-50 rounded-lg px-3 py-1.5">
                      <span className="text-gray-700">+{Number(t.minutes_added).toFixed(0)} min {t.note ? `— ${t.note}` : ''}</span>
                      <span className="text-gray-400">{new Date(t.created_at).toLocaleDateString('en-GB')}{t.created_by_name ? ` · ${t.created_by_name}` : ''}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Edit Workspace Modal ───────────────────────────────────────────────────
function EditWorkspaceModal({ tenant, onClose }: { tenant: any; onClose: () => void }) {
  const qc = useQueryClient();
  const [name,   setName]   = useState(tenant.name);
  const [sector, setSector] = useState(tenant.sector ?? '');
  const [status, setStatus] = useState(tenant.status);
  const [error,  setError]  = useState('');

  const mutation = useMutation({
    mutationFn: () => api.patch(`/super-admin/tenants/${tenant.id}`, { name, sector, status }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sa-tenants'] }); onClose(); },
    onError: (e: any) => setError(e?.response?.data?.error?.message ?? 'Update failed'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">Edit Workspace</h3>
          <button onClick={onClose}><X className="w-4 h-4 text-gray-400" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1">Name</label>
            <input value={name} onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1">Sector</label>
            <select value={sector} onChange={e => setSector(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400 bg-white">
              {['banking','telecom','transport','logistics','insurance','education','ecommerce','other'].map(s => (
                <option key={s} value={s} className="capitalize">{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1">Status</label>
            <select value={status} onChange={e => setStatus(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400 bg-white">
              {['active','trial','suspended','cancelled'].map(s => (
                <option key={s} value={s} className="capitalize">{s}</option>
              ))}
            </select>
          </div>
          {error && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
        </div>
        <div className="flex gap-2 justify-end pt-1">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending}
            className="px-4 py-2 text-sm text-white bg-brand-600 rounded-lg hover:bg-brand-700 disabled:opacity-50">
            {mutation.isPending ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Tenant Users Modal ─────────────────────────────────────────────────────
function TenantUsersModal({ tenant, onClose }: { tenant: any; onClose: () => void }) {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editUser,   setEditUser]   = useState<any>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  const { data: users = [], isLoading, refetch } = useQuery<any[]>({
    queryKey: ['sa-tenant-users', tenant.id],
    queryFn: () => api.get(`/super-admin/tenants/${tenant.id}/users`).then(r => r.data.data),
  });

  const deleteMutation = useMutation({
    mutationFn: (uid: string) => api.delete(`/super-admin/users/${uid}`),
    onSuccess: () => { refetch(); setConfirmDel(null); },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 flex flex-col" style={{ maxHeight: '85vh' }}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Users — {tenant.name}</h3>
            <p className="text-xs text-gray-400 font-mono">{tenant.slug}</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowCreate(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 text-white text-xs rounded-lg hover:bg-brand-700">
              <Plus className="w-3.5 h-3.5" /> Add User
            </button>
            <button onClick={onClose}><X className="w-4 h-4 text-gray-400" /></button>
          </div>
        </div>
        <div className="overflow-y-auto flex-1">
          {isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
          ) : (
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-100 sticky top-0">
                <tr>
                  {['Name','Email','Role','Status','Created',''].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-gray-400">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {users.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-xs text-gray-400">No users found.</td></tr>
                )}
                {users.map((u: any) => (
                  <tr key={u.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 text-xs font-medium text-gray-900">{u.name}</td>
                    <td className="px-4 py-2.5 text-xs font-mono text-gray-600">{u.email}</td>
                    <td className="px-4 py-2.5 text-xs capitalize text-gray-600">{u.role?.replace('_', ' ')}</td>
                    <td className="px-4 py-2.5">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold capitalize ${u.is_active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{u.is_active ? 'Active' : 'Inactive'}</span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-400">{new Date(u.created_at).toLocaleDateString('en-GB')}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => setEditUser(u)}
                          className="p-1 text-gray-400 hover:text-brand-600 rounded"><Edit2 className="w-3.5 h-3.5" /></button>
                        {confirmDel === u.id ? (
                          <div className="flex gap-1">
                            <button onClick={() => setConfirmDel(null)} className="text-[10px] px-1.5 py-0.5 border border-gray-200 rounded">Cancel</button>
                            <button onClick={() => deleteMutation.mutate(u.id)}
                              className="text-[10px] px-1.5 py-0.5 bg-red-600 text-white rounded">Confirm</button>
                          </div>
                        ) : (
                          <button onClick={() => setConfirmDel(u.id)}
                            className="p-1 text-gray-400 hover:text-red-600 rounded"><Trash2 className="w-3.5 h-3.5" /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      {showCreate && <CreateUserModal tenantId={tenant.id} onClose={() => { setShowCreate(false); refetch(); }} />}
      {editUser   && <EditUserModal   user={editUser}      onClose={() => { setEditUser(null);   refetch(); }} />}
    </div>
  );
}

// ── Create User Modal ──────────────────────────────────────────────────────
function CreateUserModal({ tenantId, onClose }: { tenantId: string; onClose: () => void }) {
  const [form, setForm] = useState({ name: '', email: '', role: 'admin', password: '' });
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const mutation = useMutation({
    mutationFn: () => api.post(`/super-admin/tenants/${tenantId}/users`, form),
    onSuccess: onClose,
    onError: (e: any) => setError(e?.response?.data?.error?.message ?? 'Create failed'),
  });
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm(f => ({ ...f, [k]: e.target.value }));
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">Add User</h3>
          <button onClick={onClose}><X className="w-4 h-4 text-gray-400" /></button>
        </div>
        <div className="space-y-3">
          {[['Name','name','text'],['Email','email','email']].map(([label, key, type]) => (
            <div key={key}>
              <label className="text-xs font-medium text-gray-500 block mb-1">{label}</label>
              <input type={type} value={(form as any)[key]} onChange={set(key)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400" />
            </div>
          ))}
          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1">Role</label>
            <select value={form.role} onChange={set('role')}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400 bg-white">
              {['admin','manager','agent'].map(r => <option key={r} value={r} className="capitalize">{r}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1">Password</label>
            <div className="relative">
              <input type={showPw ? 'text' : 'password'} value={form.password} onChange={set('password')}
                className="w-full px-3 py-2 pr-9 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400" />
              <button type="button" onClick={() => setShowPw(v => !v)}
                className="absolute right-2.5 top-2.5 text-gray-400">{showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
            </div>
          </div>
          {error && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending}
            className="px-4 py-2 text-sm text-white bg-brand-600 rounded-lg hover:bg-brand-700 disabled:opacity-50">
            {mutation.isPending ? 'Creating…' : 'Create User'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Edit User Modal ────────────────────────────────────────────────────────
function EditUserModal({ user, onClose }: { user: any; onClose: () => void }) {
  const [form, setForm] = useState({ name: user.name, email: user.email, role: user.role, is_active: user.is_active ?? true, password: '' });
  const [showPw, setShowPw] = useState(false);
  const [changePass, setChangePass] = useState(false);
  const [error, setError] = useState('');
  const mutation = useMutation({
    mutationFn: () => api.patch(`/super-admin/users/${user.id}`, {
      name: form.name, email: form.email, role: form.role, status: form.is_active ? 'active' : 'inactive',
      ...(changePass && form.password ? { password: form.password } : {}),
    }),
    onSuccess: onClose,
    onError: (e: any) => setError(e?.response?.data?.error?.message ?? 'Update failed'),
  });
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm(f => ({ ...f, [k]: e.target.value }));
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">Edit User</h3>
          <button onClick={onClose}><X className="w-4 h-4 text-gray-400" /></button>
        </div>
        <div className="space-y-3">
          {[['Name','name','text'],['Email','email','email']].map(([label, key, type]) => (
            <div key={key}>
              <label className="text-xs font-medium text-gray-500 block mb-1">{label}</label>
              <input type={type} value={(form as any)[key]} onChange={set(key)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400" />
            </div>
          ))}
          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1">Role</label>
            <select value={form.role} onChange={set('role')}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400 bg-white">
              {['admin','manager','agent','sales_manager','sales_agent','support_manager','support_agent'].map(r => (
                <option key={r} value={r}>{r.replace('_', ' ')}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1">Status</label>
            <select value={form.is_active ? 'active' : 'inactive'} onChange={e => setForm(f => ({ ...f, is_active: e.target.value === 'active' }))}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400 bg-white">
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          <div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={changePass} onChange={e => setChangePass(e.target.checked)} className="accent-brand-600" />
              <span className="text-xs text-gray-600">Reset password</span>
            </label>
            {changePass && (
              <div className="relative mt-2">
                <input type={showPw ? 'text' : 'password'} value={form.password} onChange={set('password')}
                  placeholder="New password (min 8 chars)"
                  className="w-full px-3 py-2 pr-9 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400" />
                <button type="button" onClick={() => setShowPw(v => !v)}
                  className="absolute right-2.5 top-2.5 text-gray-400">{showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
              </div>
            )}
          </div>
          {error && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending}
            className="px-4 py-2 text-sm text-white bg-brand-600 rounded-lg hover:bg-brand-700 disabled:opacity-50">
            {mutation.isPending ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Dashboard tab ─────────────────────────────────────────────────────────
const PLAN_COLORS_BAR: Record<string, string> = {
  free: 'bg-gray-300', starter: 'bg-blue-400',
  professional: 'bg-brand-500', enterprise: 'bg-purple-500',
};
const PLAN_LABELS = ['free','starter','professional','enterprise'];

function DashboardTab() {
  const { data: m, isLoading } = useQuery({
    queryKey: ['sa-metrics'],
    queryFn: () => api.get('/super-admin/metrics').then((r) => r.data.data),
    staleTime: 60_000,
  });

  if (isLoading || !m) {
    return <div className="flex justify-center py-24"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;
  }

  const totalActive = parseInt(m.active_tenants) || 0;
  const planMax = Math.max(...PLAN_LABELS.map((p) => parseInt(m[`${p}_plan`]) || 0), 1);
  const maxGrowth = Math.max(...(m.monthlyGrowth ?? []).map((r: any) => parseInt(r.count)), 1);

  return (
    <div className="space-y-6">
      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Workspaces', value: m.total_tenants,    sub: `${m.new_tenants_30d} new this month`, color: 'bg-brand-500',  icon: Building2 },
          { label: 'Active Tenants',   value: m.active_tenants,   sub: `${m.trial_tenants} on trial`,          color: 'bg-green-500',  icon: Check },
          { label: 'Est. MRR',         value: `£${(m.mrr ?? 0).toLocaleString()}`, sub: 'active plans only',  color: 'bg-purple-500', icon: TrendingUp },
          { label: 'Platform Users',   value: m.total_users,      sub: `${m.new_users_30d} joined (30d)`,      color: 'bg-blue-500',   icon: Users },
        ].map(({ label, value, sub, color, icon: Icon }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-100 p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-gray-400 font-medium">{label}</p>
              <div className={`w-7 h-7 ${color} rounded-lg flex items-center justify-center`}>
                <Icon className="w-3.5 h-3.5 text-white" />
              </div>
            </div>
            <p className="text-2xl font-bold text-gray-900">{value ?? '—'}</p>
            <p className="text-xs text-gray-400 mt-1">{sub}</p>
          </div>
        ))}
      </div>

      {/* Suspended alert */}
      {parseInt(m.suspended_tenants) > 0 && (
        <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 flex items-center gap-3">
          <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
          <p className="text-sm text-red-700">
            <strong>{m.suspended_tenants}</strong> workspace{m.suspended_tenants !== '1' ? 's are' : ' is'} currently suspended
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Plan distribution */}
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Plan Distribution</p>
          <div className="space-y-3">
            {PLAN_LABELS.map((p) => {
              const count = parseInt(m[`${p}_plan`]) || 0;
              const pct   = totalActive > 0 ? Math.round((count / planMax) * 100) : 0;
              return (
                <div key={p} className="flex items-center gap-3">
                  <span className="text-xs font-medium text-gray-500 w-24 capitalize shrink-0">{p}</span>
                  <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${PLAN_COLORS_BAR[p]}`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs font-semibold text-gray-700 w-6 text-right shrink-0">{count}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Monthly growth chart */}
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">New Tenants — Last 6 Months</p>
          {(m.monthlyGrowth ?? []).length === 0 ? (
            <p className="text-sm text-gray-300 text-center py-8">No data yet</p>
          ) : (
            <div className="flex items-end gap-2 h-28">
              {(m.monthlyGrowth ?? []).map((row: any) => {
                const h = Math.max(4, Math.round((parseInt(row.count) / maxGrowth) * 100));
                return (
                  <div key={row.month} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-xs font-semibold text-gray-600">{row.count}</span>
                    <div className="w-full bg-brand-500 rounded-t-md" style={{ height: `${h}%` }} />
                    <span className="text-[10px] text-gray-400">{row.month}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Module adoption */}
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Module Adoption (Active Tenants)</p>
          <div className="space-y-2.5">
            {(m.moduleAdoption ?? []).map((row: any) => {
              const pct = totalActive > 0 ? Math.round((parseInt(row.cnt) / totalActive) * 100) : 0;
              return (
                <div key={row.module} className="flex items-center gap-3">
                  <span className="text-xs font-medium text-gray-600 w-24 capitalize shrink-0">{row.module}</span>
                  <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-brand-400 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs text-gray-500 w-16 text-right shrink-0">{row.cnt} ({pct}%)</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Recent tenants */}
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Recently Created Workspaces</p>
          <div className="space-y-2">
            {(m.recentTenants ?? []).map((t: any) => (
              <div key={t.id} className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-lg bg-brand-50 flex items-center justify-center shrink-0">
                  <span className="text-xs font-bold text-brand-600">{t.name[0]?.toUpperCase()}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{t.name}</p>
                  <p className="text-[10px] text-gray-400">{new Date(t.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                </div>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full capitalize font-medium shrink-0 ${PLAN_COLORS[t.plan] ?? 'bg-gray-100 text-gray-500'}`}>{t.plan}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full capitalize font-medium shrink-0 ${STATUS_COLORS[t.status] ?? 'bg-gray-100 text-gray-500'}`}>{t.status}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Sync Entitlements Modal ────────────────────────────────────────────────
function SyncEntitlementsModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [applyModules, setApplyModules]     = useState(true);
  const [applyPermissions, setApplyPermissions] = useState(true);
  const [result, setResult] = useState<any>(null);

  const { data: preview, isLoading } = useQuery({
    queryKey: ['sync-preview'],
    queryFn: () => api.get('/super-admin/sync-entitlements/preview').then((r) => r.data.data),
  });

  const applyMutation = useMutation({
    mutationFn: () => api.post('/super-admin/sync-entitlements/apply', {
      apply_modules: applyModules,
      apply_permissions: applyPermissions,
    }),
    onSuccess: (res) => {
      setResult(res.data.data);
      qc.invalidateQueries({ queryKey: ['sa-tenants'] });
    },
  });

  const hasChanges = (preview?.moduleChanges?.length ?? 0) + (preview?.roleChanges?.length ?? 0) > 0;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl p-6 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="font-semibold text-gray-900">Sync Entitlements</h2>
            <p className="text-xs text-gray-400 mt-0.5">Review and apply module + permission updates across all tenants</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        {result ? (
          /* ── Done state ── */
          <div className="text-center py-8">
            <div className="w-12 h-12 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-3">
              <Check className="w-6 h-6 text-green-600" />
            </div>
            <p className="font-semibold text-gray-900 mb-1">Sync complete</p>
            <div className="flex justify-center gap-6 mt-3 text-sm text-gray-600">
              <span><strong>{result.modulesUpdated}</strong> tenants got new modules</span>
              <span><strong>{result.rolesUpdated}</strong> roles updated</span>
              <span><strong>{result.tenantsNotified}</strong> tenants notified to review</span>
            </div>
            <button onClick={onClose} className="mt-6 px-6 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700">Done</button>
          </div>
        ) : isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
        ) : !hasChanges ? (
          <div className="text-center py-10 text-gray-400">
            <Check className="w-10 h-10 mx-auto mb-2 text-green-400" />
            <p className="text-sm font-medium text-gray-600">Everything is up to date</p>
            <p className="text-xs mt-1">All tenants have the correct modules and permission keys for their plan</p>
          </div>
        ) : (
          <>
            {/* Options */}
            <div className="flex gap-3 mb-5">
              <label className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer flex-1 ${applyModules ? 'border-brand-200 bg-brand-50' : 'border-gray-200'}`}>
                <input type="checkbox" checked={applyModules} onChange={(e) => setApplyModules(e.target.checked)} className="accent-brand-600" />
                <div>
                  <p className="text-sm font-medium text-gray-800">Module entitlements</p>
                  <p className="text-xs text-gray-400">{preview?.moduleChanges?.length ?? 0} tenants affected</p>
                </div>
              </label>
              <label className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer flex-1 ${applyPermissions ? 'border-brand-200 bg-brand-50' : 'border-gray-200'}`}>
                <input type="checkbox" checked={applyPermissions} onChange={(e) => setApplyPermissions(e.target.checked)} className="accent-brand-600" />
                <div>
                  <p className="text-sm font-medium text-gray-800">Permission keys</p>
                  <p className="text-xs text-gray-400">{preview?.roleChanges?.length ?? 0} tenants have roles with missing keys</p>
                </div>
              </label>
            </div>

            {/* Module changes */}
            {applyModules && preview?.moduleChanges?.length > 0 && (
              <div className="mb-4">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Modules to assign</p>
                <div className="border border-gray-100 rounded-xl overflow-hidden">
                  {preview.moduleChanges.map((c: any, i: number) => (
                    <div key={c.tenant_id} className={`flex items-center gap-3 px-4 py-2.5 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{c.tenant_name}</p>
                      </div>
                      <div className="flex gap-1 flex-wrap justify-end">
                        {c.add_modules.map((m: string) => (
                          <span key={m} className="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded-full">+ {m}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Role permission changes */}
            {applyPermissions && preview?.roleChanges?.length > 0 && (
              <div className="mb-4">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Roles with missing permission keys</p>
                <div className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 mb-2">
                  <p className="text-xs text-blue-700">
                    Missing keys are filled using the role's <strong>base role defaults</strong> — system roles (Admin/Manager/Agent/Viewer) and <strong>all custom roles</strong> via their assigned base role. Tenant admins will be notified to review.
                  </p>
                </div>
                <div className="border border-gray-100 rounded-xl overflow-hidden">
                  {preview.roleChanges.map((c: any, i: number) => (
                    <div key={c.tenant_id} className={`flex items-center gap-3 px-4 py-2.5 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{c.tenant_name}</p>
                        <p className="text-xs text-gray-400">{c.roles_affected} role{c.roles_affected !== 1 ? 's' : ''} affected</p>
                      </div>
                      <div className="flex gap-1 flex-wrap justify-end">
                        {c.sample_keys.map((k: string) => (
                          <span key={k} className="text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded font-mono">{k}</span>
                        ))}
                        {c.sample_keys.length === 5 && <span className="text-xs text-gray-400">…</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {applyMutation.isError && (
              <p className="mb-3 text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">
                {(applyMutation.error as any)?.response?.data?.error?.message ?? 'Sync failed'}
              </p>
            )}

            <div className="flex gap-2 mt-4">
              <button onClick={onClose} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
              <button
                onClick={() => applyMutation.mutate()}
                disabled={applyMutation.isPending || (!applyModules && !applyPermissions)}
                className="flex-1 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700 disabled:opacity-50 flex items-center justify-center gap-2">
                {applyMutation.isPending ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Applying…</> : 'Apply Changes'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Platform permission definitions (for sub-admin roles) ─────────────────
export const PLATFORM_MODULE_DEFS: ModuleDef[] = [
  { key: 'tenants', label: 'Tenant Management', icon: '🏢', actions: [
    { key: 'tenants:view',         label: 'View all tenants & metrics',       type: 'read'   },
    { key: 'tenants:create',       label: 'Create new tenant workspaces',     type: 'write'  },
    { key: 'tenants:suspend',      label: 'Suspend & reactivate tenants',     type: 'danger' },
    { key: 'tenants:manage_users', label: 'Manage tenant users & passwords',  type: 'write'  },
  ]},
  { key: 'modules', label: 'Module & Plan Control', icon: '📦', actions: [
    { key: 'modules:manage', label: 'Assign & revoke licensed modules',  type: 'write'  },
    { key: 'plans:manage',   label: 'Change tenant subscription plans',  type: 'write'  },
  ]},
  { key: 'roles', label: 'Roles & Access', icon: '🔑', actions: [
    { key: 'roles:manage',      label: 'Configure tenant role permissions', type: 'write'  },
    { key: 'sub_admins:manage', label: 'Create & manage sub-admin accounts',type: 'write'  },
  ]},
  { key: 'billing', label: 'Billing', icon: '💳', actions: [
    { key: 'billing:view',   label: 'View invoices & payment history',   type: 'read'   },
    { key: 'billing:manage', label: 'Generate & manage tenant invoices', type: 'write'  },
  ]},
  { key: 'voice_bot', label: 'Voice Bot', icon: '🤖', actions: [
    { key: 'voice_bot:manage_agents',         label: 'Create, edit & assign agent templates', type: 'write' },
    { key: 'voice_bot:manage_knowledge_base', label: 'Manage knowledge base entries',          type: 'write' },
    { key: 'voice_bot:manage_tenants',        label: 'Manage per-tenant voice bot usage, cost & config', type: 'write' },
  ]},
  { key: 'integrations', label: 'Integrations', icon: '🔗', actions: [
    { key: 'integrations:manage', label: 'Manage shared SMS gateway & integration ownership', type: 'write' },
  ]},
  { key: 'platform_ops', label: 'Platform Operations', icon: '📊', actions: [
    { key: 'alerts:manage',     label: 'View & acknowledge platform alerts',   type: 'write' },
    { key: 'metrics:view',      label: 'View platform-wide metrics dashboard', type: 'read'  },
    { key: 'reports:view',      label: 'View workspace/backup/audit reports',  type: 'read'  },
    { key: 'entitlements:sync', label: 'Preview & apply entitlement sync',     type: 'danger' },
  ]},
  { key: 'production', label: 'Production', icon: '🚀', actions: [
    { key: 'platform:push', label: 'Push changes to production',         type: 'danger' },
  ]},
];

const PRESET_COLORS_PLATFORM = [
  '#6366f1','#7c3aed','#db2777','#dc2626','#ea580c',
  '#ca8a04','#16a34a','#0891b2','#2563eb','#64748b',
];

// ── Sub-Admin Role modal ───────────────────────────────────────────────────
function PlatformRoleModal({ role, onClose }: { role?: any; onClose: () => void }) {
  const qc = useQueryClient();
  const isEdit = !!role;
  const blank = Object.fromEntries(PLATFORM_MODULE_DEFS.flatMap((m) => m.actions.map((a) => [a.key, false])));
  const [name, setName]             = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [color, setColor]           = useState(role?.color ?? '#6366f1');
  const [permissions, setPermissions] = useState<Record<string, boolean>>(role?.permissions ?? blank);

  const mutation = useMutation({
    mutationFn: () => isEdit
      ? api.patch(`/super-admin/platform-roles/${role.id}`, { name, description, color, permissions })
      : api.post('/super-admin/platform-roles', { name, description, color, permissions }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['platform-roles'] }); onClose(); },
  });

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-gray-900">{isEdit ? 'Edit Sub-Admin Role' : 'Create Sub-Admin Role'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="space-y-4 mb-5">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Role Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Support Admin"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Color</label>
              <div className="flex gap-1.5 flex-wrap">
                {PRESET_COLORS_PLATFORM.map((c) => (
                  <button key={c} type="button" onClick={() => setColor(c)}
                    className={`w-6 h-6 rounded-full border-2 transition-all ${color === c ? 'border-gray-900 scale-110' : 'border-transparent'}`}
                    style={{ background: c }} />
                ))}
              </div>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Description</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of this role's responsibilities"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400" />
          </div>
        </div>

        <div className="mb-1">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Platform Permissions</p>
          <div className="bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-3">
            <p className="text-xs text-amber-700">
              ⚠️ <strong>Push to production</strong> should only be granted to trusted senior admins.
              Sub-admins without this permission can test and configure but cannot deploy.
            </p>
          </div>
          <PermissionsMatrix modules={PLATFORM_MODULE_DEFS} permissions={permissions} onChange={setPermissions} />
        </div>

        {mutation.isError && (
          <p className="mt-3 text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">
            {(mutation.error as any)?.response?.data?.error?.message ?? 'Save failed'}
          </p>
        )}
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
          <button onClick={() => mutation.mutate()} disabled={!name || mutation.isPending}
            className="flex-1 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700 disabled:opacity-50 flex items-center justify-center gap-2">
            {mutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            {isEdit ? 'Save Changes' : 'Create Role'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Platform Alerts tab — currently Voice Bot minute-threshold crossings ──
function PlatformAlertsTab() {
  const qc = useQueryClient();
  const { data: alerts, isLoading } = useQuery<Array<{
    id: string; type: string; title: string; body: string; is_read: boolean; created_at: string; tenant_name: string | null;
  }>>({
    queryKey: ['sa-alerts'],
    queryFn: () => api.get('/super-admin/alerts').then(r => r.data.data),
    refetchInterval: 60_000,
  });
  const markReadMut = useMutation({
    mutationFn: (id: string) => api.patch(`/super-admin/alerts/${id}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sa-alerts'] }),
  });
  const unreadCount = (alerts ?? []).filter(a => !a.is_read).length;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-gray-900">Platform Alerts</h2>
        {unreadCount > 0 && (
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-100">
            {unreadCount} unread
          </span>
        )}
      </div>
      {isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
      ) : (alerts ?? []).length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-10">No alerts yet.</p>
      ) : (
        <div className="space-y-2">
          {alerts!.map(a => (
            <div key={a.id} className={`flex items-start justify-between gap-3 rounded-xl px-4 py-3 border ${a.is_read ? 'bg-white border-gray-100' : 'bg-amber-50 border-amber-100'}`}>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900">{a.title}</p>
                {a.body && <p className="text-xs text-gray-500 mt-0.5">{a.body}</p>}
                <p className="text-[11px] text-gray-400 mt-1">
                  {a.tenant_name ? `${a.tenant_name} · ` : ''}{new Date(a.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
              {!a.is_read && (
                <button onClick={() => markReadMut.mutate(a.id)} className="text-xs text-brand-600 hover:underline shrink-0 whitespace-nowrap">
                  Mark read
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Agent Templates tab (Agent Builder, Phase 1) ───────────────────────────
// Reusable voice-bot "recipes" created once and assigned to any workspace,
// instead of configuring each tenant's bot from scratch. Assigning is a
// one-time copy into that tenant's own config — still editable afterward.
const CHARACTER_OPTIONS = ['professional', 'chirpy', 'funny', 'cordial', 'empathetic', 'formal'];
const TONE_OPTIONS = ['professional', 'friendly', 'empathetic', 'formal'];
const DIRECTION_OPTIONS = ['inbound', 'outbound', 'both'];

function AgentTemplatesTab() {
  const qc = useQueryClient();
  const [modal, setModal] = useState<{ open: boolean; template?: any }>({ open: false });
  const [assignModal, setAssignModal] = useState<{ open: boolean; templateId?: string }>({ open: false });
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const { data: templates = [], isLoading } = useQuery<any[]>({
    queryKey: ['sa-agent-templates'],
    queryFn: () => api.get('/super-admin/agent-templates').then((r) => r.data.data),
  });
  const { data: voices } = useQuery<Array<{ voice_id: string; label: string }>>({
    queryKey: ['sa-voice-bot-voices'],
    queryFn: () => api.get('/super-admin/voice-bot-voices').then((r) => r.data.data),
  });
  const { data: tenantsList } = useQuery<any[]>({
    queryKey: ['sa-tenants-for-assign'],
    queryFn: () => api.get('/super-admin/tenants', { params: { page: 1, pageSize: 200 } }).then((r) => r.data.data),
    enabled: assignModal.open,
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/super-admin/agent-templates/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sa-agent-templates'] }); setConfirmDelete(null); },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-800">Agent Templates</p>
          <p className="text-xs text-gray-400 mt-0.5">Build a voice bot once, assign it to any workspace</p>
        </div>
        <button onClick={() => setModal({ open: true })}
          className="flex items-center gap-2 px-3 py-2 bg-brand-600 text-white text-sm rounded-lg hover:bg-brand-700">
          <Plus className="w-4 h-4" /> Create an Agent
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
      ) : templates.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 py-16 text-center text-gray-400">
          <Bot className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">There are no agents yet.</p>
          <p className="text-xs mt-1">Create an agent to start assigning it to workspaces</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs text-gray-500">
                <th className="px-4 py-2.5 font-medium">Agent Name</th>
                <th className="px-4 py-2.5 font-medium">Sector</th>
                <th className="px-4 py-2.5 font-medium">Voice</th>
                <th className="px-4 py-2.5 font-medium">Direction</th>
                <th className="px-4 py-2.5 font-medium">Assigned</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id} className="border-t border-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{t.name}</td>
                  <td className="px-4 py-3 text-gray-500">{t.sector || '—'}</td>
                  <td className="px-4 py-3 text-gray-500">{t.voice_id || '—'}</td>
                  <td className="px-4 py-3 text-gray-500 capitalize">{t.call_direction}</td>
                  <td className="px-4 py-3 text-gray-500">{t.assigned_count} workspace{t.assigned_count === '1' ? '' : 's'}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 justify-end">
                      <button onClick={() => setAssignModal({ open: true, templateId: t.id })}
                        className="text-xs text-brand-600 hover:underline">Assign</button>
                      <button onClick={() => setModal({ open: true, template: t })}
                        className="text-gray-400 hover:text-gray-700"><Edit2 className="w-4 h-4" /></button>
                      <button onClick={() => setConfirmDelete(t.id)}
                        className="text-gray-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal.open && (
        <AgentTemplateModal
          template={modal.template}
          voices={voices ?? []}
          onClose={() => setModal({ open: false })}
          onSaved={() => { qc.invalidateQueries({ queryKey: ['sa-agent-templates'] }); setModal({ open: false }); }}
        />
      )}

      {assignModal.open && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Assign to workspace</h3>
            <AssignAgentForm
              templateId={assignModal.templateId!}
              tenants={tenantsList ?? []}
              onClose={() => setAssignModal({ open: false })}
              onAssigned={() => { qc.invalidateQueries({ queryKey: ['sa-agent-templates'] }); setAssignModal({ open: false }); }}
            />
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-5">
            <p className="text-sm text-gray-800 mb-4">Delete this agent template? Workspaces already assigned keep their current settings — only the reusable template is removed.</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmDelete(null)} className="px-3 py-1.5 text-sm text-gray-600">Cancel</button>
              <button onClick={() => deleteMut.mutate(confirmDelete)} className="px-3 py-1.5 text-sm bg-red-600 text-white rounded-lg">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AssignAgentForm({ templateId, tenants, onClose, onAssigned }: {
  templateId: string; tenants: any[]; onClose: () => void; onAssigned: () => void;
}) {
  const [tenantId, setTenantId] = useState('');
  const mut = useMutation({
    mutationFn: () => api.post(`/super-admin/agent-templates/${templateId}/assign`, { tenantId }),
    onSuccess: onAssigned,
  });
  return (
    <div className="space-y-3">
      <select value={tenantId} onChange={(e) => setTenantId(e.target.value)}
        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
        <option value="">Select a workspace…</option>
        {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-600">Cancel</button>
        <button onClick={() => mut.mutate()} disabled={!tenantId || mut.isPending}
          className="px-3 py-1.5 text-sm bg-brand-600 text-white rounded-lg disabled:opacity-50">
          {mut.isPending ? 'Assigning…' : 'Assign'}
        </button>
      </div>
      {mut.isSuccess && <p className="text-xs text-green-600 text-right">Assigned.</p>}
    </div>
  );
}

function AgentTemplateModal({ template, voices, onClose, onSaved }: {
  template?: any; voices: Array<{ voice_id: string; label: string }>; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: template?.name ?? '',
    sector: template?.sector ?? '',
    description: template?.description ?? '',
    companyName: template?.company_name ?? '',
    department: template?.department ?? '',
    botEngine: template?.bot_engine ?? 'nadia',
    voiceId: template?.voice_id ?? '',
    tone: template?.tone ?? 'professional',
    character: template?.character ?? 'professional',
    language: template?.language ?? 'ur-PK',
    callDirection: template?.call_direction ?? 'inbound',
    guardrails: template?.guardrails ?? '',
    systemPrompt: template?.system_prompt ?? '',
    greetingMessage: template?.greeting_message ?? '',
    holdMessage: template?.hold_message ?? '',
  });
  const mut = useMutation({
    mutationFn: () => template
      ? api.put(`/super-admin/agent-templates/${template.id}`, form)
      : api.post('/super-admin/agent-templates', form),
    onSuccess: onSaved,
  });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">{template ? 'Edit Agent' : 'Create an Agent'}</h3>
          <button onClick={onClose}><X className="w-4 h-4 text-gray-400" /></button>
        </div>

        <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Agent name"
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
        <input value={form.sector} onChange={(e) => set('sector', e.target.value)}
          placeholder="Sector (e.g. banking, electronics_retail, ecommerce)"
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
        <input value={form.companyName} onChange={(e) => set('companyName', e.target.value)}
          placeholder="Company name (spoken in greeting)"
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
        <input value={form.department} onChange={(e) => set('department', e.target.value)}
          placeholder="Department (optional)"
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />

        <div className="grid grid-cols-2 gap-2">
          <select value={form.botEngine} onChange={(e) => set('botEngine', e.target.value)}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
            <option value="nadia">Nadia</option>
          </select>
          <select value={form.voiceId} onChange={(e) => set('voiceId', e.target.value)}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
            <option value="">Select voice…</option>
            {voices.map((v) => <option key={v.voice_id} value={v.voice_id}>{v.label}</option>)}
          </select>
          <select value={form.tone} onChange={(e) => set('tone', e.target.value)}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
            {TONE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={form.character} onChange={(e) => set('character', e.target.value)}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
            {CHARACTER_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input value={form.language} onChange={(e) => set('language', e.target.value)} placeholder="Language (e.g. ur-PK)"
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          <select value={form.callDirection} onChange={(e) => set('callDirection', e.target.value)}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
            {DIRECTION_OPTIONS.map((d) => <option key={d} value={d} className="capitalize">{d}</option>)}
          </select>
        </div>

        <textarea value={form.greetingMessage} onChange={(e) => set('greetingMessage', e.target.value)}
          placeholder="Greeting message" rows={2}
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
        <input value={form.holdMessage} onChange={(e) => set('holdMessage', e.target.value)}
          placeholder='Hold message (e.g. "Please wait while I create your ticket")'
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
        <textarea value={form.guardrails} onChange={(e) => set('guardrails', e.target.value)}
          placeholder="Guardrails — hard limits" rows={2}
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
        <textarea value={form.systemPrompt} onChange={(e) => set('systemPrompt', e.target.value)}
          placeholder="System prompt / behaviour instructions" rows={4}
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
        <textarea value={form.description} onChange={(e) => set('description', e.target.value)}
          placeholder="Internal description (not spoken to callers)" rows={2}
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />

        <button onClick={() => mut.mutate()} disabled={!form.name || mut.isPending}
          className="w-full py-2 text-sm font-semibold text-white bg-brand-600 rounded-lg hover:bg-brand-700 disabled:opacity-50">
          {mut.isPending ? 'Saving…' : template ? 'Save Changes' : 'Create Agent'}
        </button>
        {mut.isError && <p className="text-xs text-red-600 text-center">Failed to save — check required fields.</p>}
      </div>
    </div>
  );
}

// ── Sub-Admin Roles tab ────────────────────────────────────────────────────
function PlatformRolesTab() {
  const qc = useQueryClient();
  const [modal, setModal] = useState<{ open: boolean; role?: any }>({ open: false });
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const { data: roles = [], isLoading } = useQuery<any[]>({
    queryKey: ['platform-roles'],
    queryFn: () => api.get('/super-admin/platform-roles').then((r) => r.data.data),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/super-admin/platform-roles/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['platform-roles'] }); setConfirmDelete(null); },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-800">Sub-Admin Roles</p>
          <p className="text-xs text-gray-400 mt-0.5">Define what sub-admins are allowed to do on the platform</p>
        </div>
        <button onClick={() => setModal({ open: true })}
          className="flex items-center gap-2 px-3 py-2 bg-brand-600 text-white text-sm rounded-lg hover:bg-brand-700">
          <Plus className="w-4 h-4" /> New Role
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
      ) : roles.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 py-16 text-center text-gray-400">
          <Shield className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No sub-admin roles yet</p>
          <p className="text-xs mt-1">Create a role to start assigning sub-admins</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {roles.map((role) => {
            const enabledCount = Object.values(role.permissions ?? {}).filter(Boolean).length;
            const totalCount   = PLATFORM_MODULE_DEFS.flatMap((m) => m.actions).length;
            return (
              <div key={role.id} className="bg-white rounded-xl border border-gray-100 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-xl shrink-0 flex items-center justify-center text-white text-sm font-bold"
                      style={{ background: role.color }}>
                      {role.name[0]?.toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900">{role.name}</p>
                      {role.description && <p className="text-xs text-gray-400 mt-0.5">{role.description}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                      {enabledCount} / {totalCount} permissions
                    </span>
                    {role.permissions?.['platform:push'] && (
                      <span className="text-xs bg-red-50 text-red-600 px-2 py-0.5 rounded-full font-medium">
                        🚀 Can push to prod
                      </span>
                    )}
                    <button onClick={() => setModal({ open: true, role })}
                      className="p-1.5 text-gray-400 hover:text-brand-600 rounded-lg hover:bg-brand-50 transition-colors">
                      <KeyRound className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => setConfirmDelete(role.id)}
                      className="p-1.5 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                {/* Permission summary */}
                <div className="mt-3 flex gap-1.5 flex-wrap">
                  {PLATFORM_MODULE_DEFS.map((mod) => {
                    const en = mod.actions.filter((a) => role.permissions?.[a.key]).length;
                    if (en === 0) return null;
                    return (
                      <span key={mod.key} className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">
                        {mod.icon} {mod.label} ({en}/{mod.actions.length})
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {modal.open && <PlatformRoleModal role={modal.role} onClose={() => setModal({ open: false })} />}
      {confirmDelete && (
        <ConfirmModal
          title="Delete Sub-Admin Role"
          message="Are you sure you want to delete this role? Sub-admins assigned to it will lose their permissions."
          onConfirm={() => deleteMutation.mutate(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

// ── Sub-Admins tab ─────────────────────────────────────────────────────────
function SubAdminsTab() {
  const qc = useQueryClient();
  const [showInvite, setShowInvite] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const { data: subAdmins = [], isLoading } = useQuery<any[]>({
    queryKey: ['sub-admins'],
    queryFn: () => api.get('/super-admin/sub-admins').then((r) => r.data.data),
  });

  const { data: platformRoles = [] } = useQuery<any[]>({
    queryKey: ['platform-roles'],
    queryFn: () => api.get('/super-admin/platform-roles').then((r) => r.data.data),
  });

  const { data: tenants = [] } = useQuery<any[]>({
    queryKey: ['sa-tenants-all'],
    queryFn: () => api.get('/super-admin/tenants', { params: { pageSize: 200 } }).then((r) => r.data.data),
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      api.patch(`/super-admin/sub-admins/${id}`, { is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sub-admins'] }),
  });

  const assignRole = useMutation({
    mutationFn: ({ id, platform_role_id }: { id: string; platform_role_id: string | null }) =>
      api.patch(`/super-admin/sub-admins/${id}`, { platform_role_id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sub-admins'] }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/super-admin/sub-admins/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sub-admins'] }); setConfirmRemove(null); },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-800">Sub-Admins</p>
          <p className="text-xs text-gray-400 mt-0.5">Platform staff who support tenant operations</p>
        </div>
        <button onClick={() => setShowInvite(true)}
          className="flex items-center gap-2 px-3 py-2 bg-brand-600 text-white text-sm rounded-lg hover:bg-brand-700">
          <Plus className="w-4 h-4" /> Invite Sub-Admin
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
      ) : subAdmins.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 py-16 text-center text-gray-400">
          <Users className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No sub-admins yet</p>
          <p className="text-xs mt-1">Invite your first support admin to get started</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-50">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400">Name</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400">Platform Role</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400">Status</th>
                <th className="w-24 px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {subAdmins.map((u: any) => (
                <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <p className="text-sm font-medium text-gray-900">{u.name}</p>
                    <p className="text-xs text-gray-400">{u.email}</p>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={u.platform_role_id ?? ''}
                      onChange={(e) => assignRole.mutate({ id: u.id, platform_role_id: e.target.value || null })}
                      className="text-xs px-2 py-1 border border-gray-200 rounded-lg outline-none focus:border-brand-400 bg-white"
                    >
                      <option value="">No role assigned</option>
                      {platformRoles.map((r: any) => (
                        <option key={r.id} value={r.id}>{r.name}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => toggleActive.mutate({ id: u.id, is_active: !u.is_active })}
                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${u.is_active ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                      {u.is_active ? 'Active' : 'Disabled'}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => setConfirmRemove(u.id)}
                      className="p-1 text-gray-400 hover:text-red-600 rounded transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showInvite && (
        <InviteSubAdminModal tenants={tenants} platformRoles={platformRoles} onClose={() => setShowInvite(false)} />
      )}
      {confirmRemove && (
        <ConfirmModal
          title="Remove Sub-Admin"
          message="Are you sure you want to remove this sub-admin? They will lose all platform access immediately."
          confirmLabel="Remove"
          onConfirm={() => remove.mutate(confirmRemove)}
          onCancel={() => setConfirmRemove(null)}
        />
      )}
    </div>
  );
}

function InviteSubAdminModal({ tenants, platformRoles, onClose }: { tenants: any[]; platformRoles: any[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: '', email: '', platform_role_id: '', tenant_id: '' });

  const mutation = useMutation({
    mutationFn: () => api.post('/super-admin/sub-admins', {
      name: form.name,
      email: form.email,
      platform_role_id: form.platform_role_id || undefined,
      tenant_id: form.tenant_id,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sub-admins'] }); onClose(); },
  });

  const valid = form.name && form.email && form.tenant_id;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-gray-900">Invite Sub-Admin</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Full Name</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Jane Smith"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Email</label>
            <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
              type="email" placeholder="jane@company.com"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Home Tenant <span className="text-gray-400">(workspace they log in from)</span></label>
            <select value={form.tenant_id} onChange={(e) => setForm({ ...form, tenant_id: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400 bg-white">
              <option value="">Select workspace…</option>
              {tenants.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Platform Role <span className="text-gray-400">(optional)</span></label>
            <select value={form.platform_role_id} onChange={(e) => setForm({ ...form, platform_role_id: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400 bg-white">
              <option value="">No role yet</option>
              {platformRoles.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
        </div>
        {mutation.isError && (
          <p className="mt-3 text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">
            {(mutation.error as any)?.response?.data?.error?.message ?? 'Failed to invite sub-admin'}
          </p>
        )}
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
          <button onClick={() => mutation.mutate()} disabled={!valid || mutation.isPending}
            className="flex-1 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700 disabled:opacity-50 flex items-center justify-center gap-2">
            {mutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            Invite Sub-Admin
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Platform Billing Tab ──────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, string> = {
  draft:     'bg-gray-100 text-gray-600',
  sent:      'bg-blue-50 text-blue-700',
  paid:      'bg-green-50 text-green-700',
  overdue:   'bg-red-50 text-red-700',
  cancelled: 'bg-yellow-50 text-yellow-700',
};

function CreateInvoiceModal({ tenants, onClose }: { tenants: any[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [tenantId, setTenantId] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd]     = useState('');
  const [dueDate, setDueDate]         = useState('');
  const [currency, setCurrency]       = useState('GBP');
  const [notes, setNotes]             = useState('');
  const [items, setItems] = useState([{ description: 'Monthly subscription', quantity: 1, unit_price: 0 }]);

  const total = items.reduce((s, i) => s + i.quantity * i.unit_price, 0);

  const mutation = useMutation({
    mutationFn: () => api.post('/super-admin/platform-invoices', {
      tenant_id: tenantId, period_start: periodStart, period_end: periodEnd,
      due_date: dueDate, currency, items, notes: notes || undefined,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['platform-invoices'] }); onClose(); },
  });

  function addItem() { setItems([...items, { description: '', quantity: 1, unit_price: 0 }]); }
  function removeItem(i: number) { setItems(items.filter((_, idx) => idx !== i)); }
  function updateItem(i: number, field: string, value: any) {
    setItems(items.map((item, idx) => idx === i ? { ...item, [field]: value } : item));
  }

  const canSave = tenantId && periodStart && periodEnd && dueDate && items.every(i => i.description && i.unit_price > 0);

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">New Platform Invoice</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-4">
          {/* Tenant */}
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Tenant (Bill To)</label>
            <select value={tenantId} onChange={e => setTenantId(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-brand-400">
              <option value="">Select tenant…</option>
              {tenants.map(t => <option key={t.id} value={t.id}>{t.name} — {t.plan}</option>)}
            </select>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Period Start', value: periodStart, set: setPeriodStart },
              { label: 'Period End',   value: periodEnd,   set: setPeriodEnd   },
              { label: 'Due Date',     value: dueDate,     set: setDueDate     },
            ].map(({ label, value, set }) => (
              <div key={label}>
                <label className="text-xs font-medium text-gray-600 mb-1 block">{label}</label>
                <input type="date" value={value} onChange={e => set(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-brand-400" />
              </div>
            ))}
          </div>

          {/* Currency */}
          <div className="w-32">
            <label className="text-xs font-medium text-gray-600 mb-1 block">Currency</label>
            <select value={currency} onChange={e => setCurrency(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-brand-400">
              {['GBP','USD','EUR','PKR'].map(c => <option key={c}>{c}</option>)}
            </select>
          </div>

          {/* Line Items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-gray-600">Line Items</label>
              <button onClick={addItem} className="text-xs text-brand-600 hover:text-brand-700 font-medium">+ Add item</button>
            </div>
            <div className="space-y-2">
              {items.map((item, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-center">
                  <input value={item.description} onChange={e => updateItem(i, 'description', e.target.value)}
                    placeholder="Description" className="col-span-6 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-brand-400" />
                  <input type="number" value={item.quantity} min={1} onChange={e => updateItem(i, 'quantity', Number(e.target.value))}
                    className="col-span-2 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-brand-400 text-center" />
                  <input type="number" value={item.unit_price} step="0.01" min={0} onChange={e => updateItem(i, 'unit_price', Number(e.target.value))}
                    placeholder="Price" className="col-span-3 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-brand-400" />
                  <button onClick={() => removeItem(i)} disabled={items.length === 1} className="col-span-1 text-gray-300 hover:text-red-400 disabled:opacity-30">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex justify-end mt-3">
              <span className="text-sm font-semibold text-gray-900">Total: {currency} {total.toFixed(2)}</span>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Notes (optional)</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-brand-400 resize-none" />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
          <button disabled={!canSave || mutation.isPending} onClick={() => mutation.mutate()}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50">
            {mutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            Create Invoice
          </button>
        </div>
      </div>
    </div>
  );
}

function RecordPaymentModal({ invoice, onClose }: { invoice: any; onClose: () => void }) {
  const qc = useQueryClient();
  const [amount, setAmount]     = useState(String(Number(invoice.amount) - Number(invoice.amount_paid || 0)));
  const [date, setDate]         = useState(new Date().toISOString().split('T')[0]);
  const [method, setMethod]     = useState('bank_transfer');
  const [reference, setRef]     = useState('');

  const mutation = useMutation({
    mutationFn: () => api.post(`/super-admin/platform-invoices/${invoice.id}/payments`, {
      amount: Number(amount), payment_date: date, method, reference: reference || undefined,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['platform-invoices'] }); onClose(); },
  });

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Record Payment</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        <div className="px-6 py-4 space-y-4">
          <p className="text-sm text-gray-500">Invoice {invoice.invoice_number} · {invoice.currency} {Number(invoice.amount).toFixed(2)}</p>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Amount Received</label>
            <input type="number" value={amount} onChange={e => setAmount(e.target.value)} step="0.01" min={0}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-brand-400" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Payment Date</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-brand-400" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Method</label>
            <select value={method} onChange={e => setMethod(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-brand-400">
              {['bank_transfer','card','cheque','cash','other'].map(m => <option key={m} value={m}>{m.replace('_',' ')}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Reference (optional)</label>
            <input value={reference} onChange={e => setRef(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-brand-400" />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
          <button disabled={!amount || !date || mutation.isPending} onClick={() => mutation.mutate()}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50">
            {mutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            Record Payment
          </button>
        </div>
      </div>
    </div>
  );
}

function PlatformBillingTab({ tenants }: { tenants: any[] }) {
  const qc = useQueryClient();
  const [showCreate, setShowCreate]     = useState(false);
  const [payInvoice, setPayInvoice]     = useState<any>(null);
  const [confirmDelInv, setConfirmDelInv] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [tenantFilter, setTenantFilter] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['platform-invoices', statusFilter, tenantFilter],
    queryFn: () => api.get('/super-admin/platform-invoices', {
      params: { status: statusFilter || undefined, tenant_id: tenantFilter || undefined, pageSize: 50 },
    }).then(r => r.data),
  });

  const invoices: any[] = data?.data ?? [];

  const markStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/super-admin/platform-invoices/${id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform-invoices'] }),
  });

  const deleteInvoice = useMutation({
    mutationFn: (id: string) => api.delete(`/super-admin/platform-invoices/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['platform-invoices'] }); setConfirmDelInv(null); },
  });

  // Summary KPIs
  const totalOutstanding = invoices.filter(i => ['sent','overdue'].includes(i.status))
    .reduce((s, i) => s + Number(i.amount) - Number(i.amount_paid || 0), 0);
  const totalPaid = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + Number(i.amount), 0);
  const overdueCount = invoices.filter(i => i.status === 'overdue').length;

  return (
    <div className="space-y-6">
      {/* KPI row */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Outstanding',   value: `£${totalOutstanding.toFixed(2)}`, color: 'text-amber-600'  },
          { label: 'Collected',     value: `£${totalPaid.toFixed(2)}`,        color: 'text-green-600'  },
          { label: 'Overdue',       value: String(overdueCount),              color: 'text-red-600'    },
        ].map(k => (
          <div key={k.label} className="bg-white rounded-xl border border-gray-100 p-4">
            <p className="text-xs text-gray-400 mb-1">{k.label}</p>
            <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-2">
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-brand-400 bg-white">
            <option value="">All statuses</option>
            {['draft','sent','paid','overdue','cancelled'].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={tenantFilter} onChange={e => setTenantFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-brand-400 bg-white">
            <option value="">All tenants</option>
            {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white text-sm rounded-lg hover:bg-brand-700">
          <Plus className="w-4 h-4" /> New Invoice
        </button>
      </div>

      {/* Invoice table */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              {['Invoice #','Tenant','Period','Amount','Paid','Due Date','Status','Actions'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {isLoading && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></td></tr>
            )}
            {!isLoading && invoices.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400 text-sm">No invoices yet. Create one to get started.</td></tr>
            )}
            {invoices.map(inv => {
              const amtPaid = Number(inv.amount_paid || 0);
              const balance = Number(inv.amount) - amtPaid;
              return (
                <tr key={inv.id} className="hover:bg-gray-50/50">
                  <td className="px-4 py-3 font-mono text-xs text-gray-700">{inv.invoice_number}</td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900 text-xs">{inv.tenant_name}</p>
                    <span className="text-[10px] capitalize text-gray-400">{inv.tenant_plan}</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {inv.period_start?.slice(0,10)} – {inv.period_end?.slice(0,10)}
                  </td>
                  <td className="px-4 py-3 font-semibold text-gray-900 text-xs">{inv.currency} {Number(inv.amount).toFixed(2)}</td>
                  <td className="px-4 py-3 text-xs text-green-600">{amtPaid > 0 ? `${inv.currency} ${amtPaid.toFixed(2)}` : '—'}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{inv.due_date?.slice(0,10)}</td>
                  <td className="px-4 py-3">
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full capitalize ${STATUS_BADGE[inv.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {inv.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      {inv.status === 'draft' && (
                        <button onClick={() => markStatus.mutate({ id: inv.id, status: 'sent' })}
                          title="Mark as Sent" className="p-1 rounded text-blue-500 hover:bg-blue-50 text-xs font-medium">
                          Send
                        </button>
                      )}
                      {['sent','overdue'].includes(inv.status) && balance > 0 && (
                        <button onClick={() => setPayInvoice(inv)}
                          title="Record Payment" className="p-1 rounded text-green-600 hover:bg-green-50 text-xs font-medium">
                          Pay
                        </button>
                      )}
                      {inv.status === 'sent' && (
                        <button onClick={() => markStatus.mutate({ id: inv.id, status: 'overdue' })}
                          title="Mark Overdue" className="p-1 rounded text-red-500 hover:bg-red-50 text-xs font-medium">
                          Overdue
                        </button>
                      )}
                      {inv.status === 'draft' && (
                        <button onClick={() => setConfirmDelInv(inv.id)}
                          className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showCreate && <CreateInvoiceModal tenants={tenants} onClose={() => setShowCreate(false)} />}
      {payInvoice  && <RecordPaymentModal invoice={payInvoice} onClose={() => setPayInvoice(null)} />}
      {confirmDelInv && (
        <ConfirmModal
          title="Delete Draft Invoice"
          message="Are you sure you want to delete this draft invoice? This action cannot be undone."
          onConfirm={() => deleteInvoice.mutate(confirmDelInv)}
          onCancel={() => setConfirmDelInv(null)}
        />
      )}
    </div>
  );
}

// ── Super Admin Reports ────────────────────────────────────────────────────
function SuperAdminReports() {
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 8) + '01';

  const [section, setSection] = useState<'tenant-details' | 'backup' | 'invoices-all' | 'invoices-tenant' | 'audit' | 'voice-bot-cost'>('tenant-details');
  const [costMonth, setCostMonth] = useState(today.slice(0, 7)); // YYYY-MM
  const [dateFrom, setDateFrom] = useState(monthStart);
  const [dateTo,   setDateTo]   = useState(today);
  const [selectedTenant, setSelectedTenant] = useState('');
  const [auditEntity, setAuditEntity] = useState('');
  const [auditAction, setAuditAction]  = useState('');

  const params = { from: dateFrom || undefined, to: dateTo || undefined };

  const { data: tenantList = [] } = useQuery<any[]>({
    queryKey: ['sa-tenants-list'],
    queryFn: () => api.get('/super-admin/tenants', { params: { pageSize: 200 } }).then(r => r.data.data ?? []),
  });

  const { data: wsData,     isLoading: wsLoading }     = useQuery<any[]>({
    queryKey: ['sa-rep-tenants', dateFrom, dateTo],
    queryFn: () => api.get('/super-admin/reports/workspaces', { params }).then(r => r.data.data),
    enabled: section === 'tenant-details',
  });
  const { data: bkData,     isLoading: bkLoading }     = useQuery<any[]>({
    queryKey: ['sa-rep-backups'],
    queryFn: () => api.get('/super-admin/reports/backups').then(r => r.data.data),
    enabled: section === 'backup',
  });
  const { data: invAllData, isLoading: invAllLoading } = useQuery<any[]>({
    queryKey: ['sa-rep-inv-all', dateFrom, dateTo],
    queryFn: () => api.get('/super-admin/reports/invoices', { params }).then(r => r.data.data),
    enabled: section === 'invoices-all',
  });
  const { data: invTenData, isLoading: invTenLoading } = useQuery<any[]>({
    queryKey: ['sa-rep-inv-ten', dateFrom, dateTo, selectedTenant],
    queryFn: () => api.get('/super-admin/reports/invoices', { params: { ...params, tenant_id: selectedTenant || undefined } }).then(r => r.data.data),
    enabled: section === 'invoices-tenant' && !!selectedTenant,
  });
  const { data: auditData, isLoading: auditLoading, refetch: refetchAudit } = useQuery<any[]>({
    queryKey: ['sa-rep-audit', auditEntity, auditAction],
    queryFn: () => api.get('/super-admin/reports/audit', { params: { entity: auditEntity || undefined, action: auditAction || undefined } }).then(r => r.data.data),
    enabled: section === 'audit',
  });
  const { data: costReport, isLoading: costLoading } = useQuery<{ period: string; tenants: any[]; totalCostAllTenants: number }>({
    queryKey: ['sa-rep-voicebot-cost', costMonth],
    queryFn: () => api.get('/super-admin/voice-bot/cost-report', { params: { month: costMonth } }).then(r => r.data.data),
    enabled: section === 'voice-bot-cost',
  });

  const fmtDate     = (d: string) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const fmtDateTime = (d: string) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  const fmtBytes    = (b: number) => !b ? '—' : b < 1_048_576 ? `${(b/1024).toFixed(1)} KB` : `${(b/1_048_576).toFixed(1)} MB`;

  const SECTIONS = [
    { key: 'tenant-details',   label: 'Tenant Details',        icon: Building2     },
    { key: 'backup',           label: 'Backup Report',         icon: RefreshCw     },
    { key: 'invoices-all',     label: 'All Invoices',          icon: FileText      },
    { key: 'invoices-tenant',  label: 'Tenant Invoices',       icon: Receipt       },
    { key: 'audit',            label: 'Audit Log',             icon: ClipboardList },
    { key: 'voice-bot-cost',   label: 'Voice Bot Cost',        icon: Phone         },
  ] as const;

  const STATUS_BADGE: Record<string, string> = {
    active: 'bg-green-50 text-green-700',   trial: 'bg-amber-50 text-amber-700',
    suspended: 'bg-red-50 text-red-600',    cancelled: 'bg-gray-100 text-gray-500',
    draft: 'bg-gray-100 text-gray-600',     sent: 'bg-blue-50 text-blue-700',
    paid: 'bg-green-50 text-green-700',     overdue: 'bg-red-50 text-red-600',
    partial: 'bg-amber-50 text-amber-700',  unpaid: 'bg-red-50 text-red-600',
    ok: 'bg-green-50 text-green-700',       never: 'bg-red-50 text-red-600',
    not_due: 'bg-gray-100 text-gray-600',   no_due_date: 'bg-gray-100 text-gray-500',
  };

  const thCls = 'px-4 py-3 text-left text-xs font-semibold text-gray-400 whitespace-nowrap';
  const tdCls = 'px-4 py-3 text-xs text-gray-700';

  const needsDates = ['tenant-details','invoices-all','invoices-tenant'].includes(section);

  // Invoice helper
  function InvoiceTable({ data, loading }: { data: any[] | undefined; loading: boolean }) {
    if (loading) return <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>;
    const rows = data ?? [];
    return (
      <table className="w-full">
        <thead className="bg-gray-50 border-b border-gray-100 sticky top-0">
          <tr>
            {['Invoice #','Date','Tenant','Tenant ID','Amount','Amount Paid','Unpaid','Balance Due','Currency','Due Date','Due Status','Payment Status'].map(h => (
              <th key={h} className={thCls}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {rows.length === 0 && <tr><td colSpan={12} className="px-4 py-12 text-center text-xs text-gray-400">No invoices in this period.</td></tr>}
          {rows.map((inv: any) => {
            const amt  = Number(inv.amount);
            const paid = Number(inv.amount_paid ?? 0);
            const bal  = amt - paid;
            const unpaid = amt - paid;
            return (
              <tr key={inv.id} className="hover:bg-gray-50">
                <td className={tdCls + ' font-mono text-brand-600'}>{inv.invoice_number}</td>
                <td className={tdCls + ' whitespace-nowrap'}>{fmtDate(inv.created_at)}</td>
                <td className={tdCls}><p className="font-medium text-gray-900">{inv.tenant_name}</p></td>
                <td className={tdCls + ' font-mono text-gray-400 text-[10px]'}>{inv.tenant_id?.slice(0,8)}…</td>
                <td className={tdCls + ' font-semibold whitespace-nowrap'}>{inv.currency} {amt.toFixed(2)}</td>
                <td className={tdCls + ' text-green-600 whitespace-nowrap'}>{paid > 0 ? `${inv.currency} ${paid.toFixed(2)}` : '—'}</td>
                <td className={tdCls + (unpaid > 0 ? ' text-red-600 font-semibold' : ' text-gray-400') + ' whitespace-nowrap'}>{unpaid > 0 ? `${inv.currency} ${unpaid.toFixed(2)}` : '—'}</td>
                <td className={tdCls + (bal > 0 ? ' text-red-600 font-semibold' : ' text-gray-400') + ' whitespace-nowrap'}>{bal > 0 ? `${inv.currency} ${bal.toFixed(2)}` : '✓ Nil'}</td>
                <td className={tdCls}>{inv.currency}</td>
                <td className={tdCls + ' whitespace-nowrap'}>{fmtDate(inv.due_date)}</td>
                <td className={tdCls}>
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full capitalize ${STATUS_BADGE[inv.due_status] ?? 'bg-gray-100 text-gray-600'}`}>
                    {inv.due_status?.replace('_', ' ')}
                  </span>
                </td>
                <td className={tdCls}>
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full capitalize ${STATUS_BADGE[inv.payment_status] ?? 'bg-gray-100 text-gray-600'}`}>
                    {inv.payment_status}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  }

  return (
    <div className="space-y-5">
      {/* Section tabs */}
      <div className="flex gap-2 flex-wrap">
        {SECTIONS.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setSection(key as any)}
            className={`flex items-center gap-2 px-4 py-2 text-sm rounded-xl border transition-colors ${
              section === key
                ? 'bg-brand-600 text-white border-brand-600 font-semibold'
                : 'bg-white text-gray-600 border-gray-200 hover:border-brand-400 hover:text-brand-600'
            }`}>
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Date range + optional tenant filter */}
      <div className="bg-white border border-gray-100 rounded-xl px-5 py-4 flex flex-wrap items-end gap-4">
        {needsDates && (
          <>
            <div>
              <label className="text-xs font-medium text-gray-400 block mb-1">From</label>
              <div className="flex items-center gap-1.5 border border-gray-200 rounded-lg px-3 py-2">
                <Calendar className="w-3.5 h-3.5 text-gray-400" />
                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                  className="text-sm outline-none bg-transparent" />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-400 block mb-1">To</label>
              <div className="flex items-center gap-1.5 border border-gray-200 rounded-lg px-3 py-2">
                <Calendar className="w-3.5 h-3.5 text-gray-400" />
                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                  className="text-sm outline-none bg-transparent" />
              </div>
            </div>
          </>
        )}
        {section === 'invoices-tenant' && (
          <div>
            <label className="text-xs font-medium text-gray-400 block mb-1">Tenant</label>
            <select value={selectedTenant} onChange={e => setSelectedTenant(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400 bg-white min-w-48">
              <option value="">— Select Tenant —</option>
              {tenantList.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        )}
        {section === 'audit' && (
          <>
            <div>
              <label className="text-xs font-medium text-gray-400 block mb-1">Entity Type</label>
              <input value={auditEntity} onChange={e => setAuditEntity(e.target.value)}
                placeholder="e.g. ticket"
                className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400 w-40" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-400 block mb-1">Action</label>
              <input value={auditAction} onChange={e => setAuditAction(e.target.value)}
                placeholder="e.g. status_changed"
                className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400 w-44" />
            </div>
            <button onClick={() => refetchAudit()}
              className="flex items-center gap-1.5 px-3 py-2 bg-brand-600 text-white text-sm rounded-lg hover:bg-brand-700">
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </button>
          </>
        )}
        {needsDates && (
          <div className="ml-auto flex gap-2">
            {[
              { label: 'This month', f: monthStart, t: today },
              { label: 'Last 30d',   f: new Date(Date.now()-30*86400000).toISOString().slice(0,10), t: today },
              { label: 'This year',  f: today.slice(0,4)+'-01-01', t: today },
            ].map(({ label, f, t }) => (
              <button key={label} onClick={() => { setDateFrom(f); setDateTo(t); }}
                className="px-3 py-2 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600">{label}</button>
            ))}
          </div>
        )}
      </div>

      {/* ── Tenant Details ── */}
      {section === 'tenant-details' && (
        <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
          {wsLoading ? <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div> : (
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-100 sticky top-0">
                <tr>
                  {['Workspace','Slug','Sector','Plan','Status','Modules','Users (Active)','Contacts','Open Deals','Storage','Created','Last Backup'].map(h => (
                    <th key={h} className={thCls}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {(wsData ?? []).length === 0 && <tr><td colSpan={12} className="px-4 py-12 text-center text-xs text-gray-400">No tenants in this period.</td></tr>}
                {(wsData ?? []).map((w: any) => (
                  <tr key={w.id} className="hover:bg-gray-50">
                    <td className={tdCls + ' font-semibold text-gray-900 whitespace-nowrap'}>{w.name}</td>
                    <td className={tdCls + ' font-mono text-brand-600'}>{w.slug}</td>
                    <td className={tdCls + ' capitalize'}>{w.sector?.replace('_', ' ') ?? '—'}</td>
                    <td className={tdCls + ' capitalize'}>{w.plan}</td>
                    <td className={tdCls}>
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full capitalize ${STATUS_BADGE[w.status] ?? 'bg-gray-100 text-gray-600'}`}>{w.status}</span>
                    </td>
                    <td className={tdCls}>
                      <div className="flex gap-1 flex-wrap">
                        {(w.active_modules ?? []).map((m: string) => (
                          <span key={m} className="text-[10px] bg-brand-50 text-brand-600 px-1 py-0.5 rounded capitalize">{m}</span>
                        ))}
                      </div>
                    </td>
                    <td className={tdCls + ' text-center'}>{w.active_users}/{w.user_count}</td>
                    <td className={tdCls + ' text-center'}>{w.contact_count}</td>
                    <td className={tdCls + ' text-center'}>{w.open_deals}</td>
                    <td className={tdCls}>{fmtBytes(Number(w.storage_bytes))}</td>
                    <td className={tdCls + ' whitespace-nowrap'}>{fmtDate(w.created_at)}</td>
                    <td className={tdCls + ' whitespace-nowrap'}>
                      {w.last_backup_at ? fmtDate(w.last_backup_at) : <span className="text-red-500 font-semibold text-[10px]">Never</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Backup Report ── */}
      {section === 'backup' && (
        <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
          {bkLoading ? <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div> : (
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-100 sticky top-0">
                <tr>
                  {['Workspace','Slug','Status','Last Backup','Days Since Backup','Backup Status'].map(h => (
                    <th key={h} className={thCls}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {(bkData ?? []).length === 0 && <tr><td colSpan={6} className="px-4 py-12 text-center text-xs text-gray-400">No data.</td></tr>}
                {(bkData ?? []).map((bk: any) => {
                  const days = bk.days_since_backup != null ? Math.round(Number(bk.days_since_backup)) : null;
                  const overdue = bk.backup_status === 'overdue' || bk.backup_status === 'never';
                  return (
                    <tr key={bk.id} className={overdue ? 'bg-red-50 hover:bg-red-100' : 'hover:bg-gray-50'}>
                      <td className={tdCls + ' font-semibold text-gray-900'}>{bk.name}</td>
                      <td className={tdCls + ' font-mono text-brand-600'}>{bk.slug}</td>
                      <td className={tdCls}>
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full capitalize ${STATUS_BADGE[bk.status] ?? 'bg-gray-100 text-gray-600'}`}>{bk.status}</span>
                      </td>
                      <td className={tdCls + ' whitespace-nowrap'}>{bk.last_backup_at ? fmtDate(bk.last_backup_at) : <span className="text-red-600 font-semibold">Never</span>}</td>
                      <td className={tdCls + (overdue ? ' text-red-600 font-bold' : '')}>
                        {days != null ? `${days} day${days !== 1 ? 's' : ''}` : '—'}
                      </td>
                      <td className={tdCls}>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${STATUS_BADGE[bk.backup_status] ?? 'bg-gray-100 text-gray-600'}`}>
                          {bk.backup_status === 'never' ? '⚠ Never Backed Up' : bk.backup_status === 'overdue' ? '⚠ Overdue' : '✓ OK'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── All Invoices ── */}
      {section === 'invoices-all' && (
        <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
          <InvoiceTable data={invAllData} loading={invAllLoading} />
        </div>
      )}

      {/* ── Tenant Invoices ── */}
      {section === 'invoices-tenant' && (
        <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
          {!selectedTenant ? (
            <div className="py-12 text-center text-xs text-gray-400">Select a tenant above to view their invoices.</div>
          ) : (
            <InvoiceTable data={invTenData} loading={invTenLoading} />
          )}
        </div>
      )}

      {/* ── Audit Log ── */}
      {section === 'audit' && (
        <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
          {auditLoading ? <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div> : (
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-100 sticky top-0">
                <tr>
                  {['Timestamp','Tenant','Actor','Role','Entity','Action','Detail'].map(h => (
                    <th key={h} className={thCls}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {(auditData ?? []).length === 0 && <tr><td colSpan={7} className="px-4 py-12 text-center text-xs text-gray-400">No audit entries found.</td></tr>}
                {(auditData ?? []).map((a: any) => (
                  <tr key={a.id} className="hover:bg-gray-50">
                    <td className={tdCls + ' whitespace-nowrap text-gray-500'}>{fmtDateTime(a.created_at)}</td>
                    <td className={tdCls}><p className="font-medium text-gray-900">{a.tenant_name ?? '—'}</p><p className="text-[10px] text-gray-400">{a.tenant_slug}</p></td>
                    <td className={tdCls}><p className="font-medium">{a.actor_name ?? 'System'}</p><p className="text-[10px] text-gray-400">{a.actor_email}</p></td>
                    <td className={tdCls + ' capitalize text-gray-500'}>{a.actor_role?.replace('_', ' ') ?? '—'}</td>
                    <td className={tdCls + ' capitalize text-gray-600'}>{a.entity_type?.replace('_', ' ') ?? '—'}</td>
                    <td className={tdCls}>
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 capitalize">{a.action?.replace('_', ' ')}</span>
                    </td>
                    <td className={tdCls + ' text-gray-400 max-w-xs truncate'}>
                      {a.new_value ? (typeof a.new_value === 'object' ? JSON.stringify(a.new_value).slice(0, 80) : String(a.new_value).slice(0, 80)) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Voice Bot Cost ── */}
      {section === 'voice-bot-cost' && (
        <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Month</label>
            <input type="month" value={costMonth} onChange={(e) => setCostMonth(e.target.value)}
              className="border border-gray-200 rounded-lg px-2 py-1 text-sm" />
            {costReport && (
              <span className="ml-auto text-sm font-semibold text-gray-700">
                Total: ${costReport.totalCostAllTenants.toFixed(2)}
              </span>
            )}
          </div>
          {costLoading ? <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div> : (
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-100 sticky top-0">
                <tr>
                  {['Tenant', 'Minutes Used', 'Calls', 'Rate / min', 'Total Cost'].map(h => (
                    <th key={h} className={thCls}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {(costReport?.tenants ?? []).length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-12 text-center text-xs text-gray-400">No voice-bot-licensed tenants found.</td></tr>
                )}
                {(costReport?.tenants ?? []).map((row: any) => (
                  <tr key={row.tenantId} className="hover:bg-gray-50">
                    <td className={tdCls + ' font-medium text-gray-900'}>{row.tenantName}</td>
                    <td className={tdCls}>{row.minutesUsed}</td>
                    <td className={tdCls}>{row.callCount}</td>
                    <td className={tdCls}>{row.costPerMinute > 0 ? `$${row.costPerMinute.toFixed(4)}` : <span className="text-gray-400">Not set</span>}</td>
                    <td className={tdCls + ' font-semibold'}>${row.totalCost.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

// ── Super Admin Settings (Password Management) ────────────────────────────
function SuperAdminSettings() {
  const [selectedTenant, setSelectedTenant] = useState('');
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [editUser, setEditUser] = useState<any>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  const { data: tenantList = [] } = useQuery<any[]>({
    queryKey: ['sa-tenants-list-settings'],
    queryFn: () => api.get('/super-admin/tenants', { params: { pageSize: 200 } }).then(r => r.data.data ?? []),
  });

  const { data: users = [], isLoading: usersLoading, refetch: refetchUsers } = useQuery<any[]>({
    queryKey: ['sa-settings-users', selectedTenant],
    queryFn: () => api.get(`/super-admin/tenants/${selectedTenant}/users`).then(r => r.data.data),
    enabled: !!selectedTenant,
  });

  const { data: pwLog = [], isLoading: logLoading, refetch: refetchLog } = useQuery<any[]>({
    queryKey: ['sa-pw-log', selectedTenant],
    queryFn: () => api.get('/super-admin/password-log', { params: { tenant_id: selectedTenant || undefined } }).then(r => r.data.data),
  });

  const deleteMutation = useMutation({
    mutationFn: (uid: string) => api.delete(`/super-admin/users/${uid}`),
    onSuccess: () => { refetchUsers(); setConfirmDel(null); },
  });

  const fmtDateTime = (d: string) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

  return (
    <div className="space-y-6">
      {/* Tenant selector */}
      <div className="bg-white rounded-xl border border-gray-100 px-5 py-4 flex items-end gap-4">
        <div className="flex-1 max-w-xs">
          <label className="text-xs font-medium text-gray-400 block mb-1">Select Tenant / Workspace</label>
          <select value={selectedTenant} onChange={e => setSelectedTenant(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400 bg-white">
            <option value="">— All Tenants —</option>
            {tenantList.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        {selectedTenant && (
          <button onClick={() => setShowCreateUser(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-brand-600 text-white text-sm rounded-lg hover:bg-brand-700">
            <Plus className="w-4 h-4" /> Add Tenant User
          </button>
        )}
      </div>

      {/* Users table */}
      {selectedTenant && (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-50 flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Tenant Users — {tenantList.find(t => t.id === selectedTenant)?.name}
            </p>
          </div>
          {usersLoading ? (
            <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
          ) : (
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  {['Name','Email','Role','Status','Created','Actions'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-gray-400">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {users.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-xs text-gray-400">No users in this workspace.</td></tr>}
                {users.map((u: any) => (
                  <tr key={u.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 text-xs font-medium text-gray-900">{u.name}</td>
                    <td className="px-4 py-2.5 text-xs font-mono text-gray-600">{u.email}</td>
                    <td className="px-4 py-2.5 text-xs capitalize text-gray-600">{u.role?.replace(/_/g, ' ')}</td>
                    <td className="px-4 py-2.5">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold capitalize ${u.is_active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{u.is_active ? 'Active' : 'Inactive'}</span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-400">{new Date(u.created_at).toLocaleDateString('en-GB')}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <button onClick={() => setEditUser(u)}
                          className="flex items-center gap-1 text-xs text-brand-600 hover:underline">
                          <Edit2 className="w-3 h-3" /> Edit / Reset Password
                        </button>
                        {confirmDel === u.id ? (
                          <div className="flex gap-1">
                            <button onClick={() => setConfirmDel(null)} className="text-[10px] px-1.5 py-0.5 border border-gray-200 rounded">Cancel</button>
                            <button onClick={() => deleteMutation.mutate(u.id)}
                              className="text-[10px] px-1.5 py-0.5 bg-red-600 text-white rounded">Confirm Delete</button>
                          </div>
                        ) : (
                          <button onClick={() => setConfirmDel(u.id)} className="text-xs text-red-500 hover:underline">Delete</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Password change log */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-50 flex items-center justify-between">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-2">
            <Lock className="w-3.5 h-3.5" /> Password Change Log {selectedTenant && `— ${tenantList.find(t => t.id === selectedTenant)?.name}`}
          </p>
          <button onClick={() => refetchLog()} className="text-xs text-gray-400 hover:text-brand-600 flex items-center gap-1">
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
        </div>
        {logLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
        ) : pwLog.length === 0 ? (
          <p className="text-center text-xs text-gray-400 py-8">No password changes recorded yet.</p>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                {['Date / Time','Tenant','User','Email','Role','Action','Changed By','Notes'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-gray-400">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {pwLog.map((l: any) => (
                <tr key={l.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap">{fmtDateTime(l.created_at)}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-700">{l.tenant_name ?? '—'}</td>
                  <td className="px-4 py-2.5 text-xs font-medium text-gray-900">{l.user_name ?? '—'}</td>
                  <td className="px-4 py-2.5 text-xs font-mono text-gray-500">{l.user_email ?? '—'}</td>
                  <td className="px-4 py-2.5 text-xs capitalize text-gray-600">{l.user_role?.replace(/_/g,' ') ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full capitalize ${l.action === 'created' ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>{l.action}</span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-500">{l.admin_name ?? 'Super Admin'}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-400">{l.notes ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showCreateUser && selectedTenant && (
        <CreateUserModal tenantId={selectedTenant} onClose={() => { setShowCreateUser(false); refetchUsers(); refetchLog(); }} />
      )}
      {editUser && (
        <EditUserModal user={editUser} onClose={() => { setEditUser(null); refetchUsers(); refetchLog(); }} />
      )}
    </div>
  );
}

// ── Super Admin — Orders Management tab ───────────────────────────────────

const ORDER_STATUS_CFG: Record<string, { label: string; cls: string; icon: React.ElementType }> = {
  pending:      { label: 'Pending Review', cls: 'bg-amber-50 text-amber-700 border-amber-200',       icon: Hourglass   },
  under_review: { label: 'Under Review',   cls: 'bg-blue-50 text-blue-700 border-blue-200',          icon: Hourglass   },
  approved:     { label: 'Approved',       cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: BadgeCheck  },
  rejected:     { label: 'Rejected',       cls: 'bg-red-50 text-red-700 border-red-200',             icon: XCircle     },
  cancelled:    { label: 'Cancelled',      cls: 'bg-gray-100 text-gray-500 border-gray-200',         icon: X           },
};

const ORDER_TYPE_LABELS: Record<string, string> = {
  storage_extension: 'Storage Extension',
  new_module:        'New Module',
  feature_request:   'Feature Request',
  plan_upgrade:      'Plan Upgrade',
};

interface SuperOrder {
  id: number; tenant_id: string; tenant_name?: string;
  order_type: string; status: string; description: string;
  requested_module?: string; requested_features?: string[]; requested_days?: number;
  quoted_amount?: number; currency?: string;
  payment_confirmed: boolean; payment_ref?: string; admin_note?: string;
  requested_by_name?: string; requested_at: string; reviewed_at?: string;
}

function ReviewOrderModal({ order, onClose }: { order: SuperOrder; onClose: () => void }) {
  const qc = useQueryClient();
  const [note, setNote]         = useState(order.admin_note ?? '');
  const [payRef, setPayRef]     = useState(order.payment_ref ?? '');
  const [amount, setAmount]     = useState(order.quoted_amount?.toString() ?? '');
  const [payConfirmed, setPayConfirmed] = useState(order.payment_confirmed);

  const reviewMut  = useMutation({ mutationFn: () => api.patch(`/api/v1/governance/orders/${order.id}/review`,  { admin_note: note || undefined, quoted_amount: amount ? Number(amount) : undefined }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['super-orders'] }); onClose(); } });
  const approveMut = useMutation({ mutationFn: () => api.patch(`/api/v1/governance/orders/${order.id}/approve`, { admin_note: note || undefined, payment_ref: payRef || undefined, payment_confirmed: payConfirmed }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['super-orders'] }); onClose(); } });
  const rejectMut  = useMutation({ mutationFn: () => api.patch(`/api/v1/governance/orders/${order.id}/reject`,  { admin_note: note || undefined }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['super-orders'] }); onClose(); } });

  const busy = reviewMut.isPending || approveMut.isPending || rejectMut.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-900">Review Order #{order.id}</h3>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div className="bg-gray-50 rounded-xl p-4 space-y-1">
            <p className="text-xs text-gray-500">Tenant: <span className="font-medium text-gray-700">{order.tenant_name ?? order.tenant_id}</span></p>
            <p className="text-xs text-gray-500">Type: <span className="font-medium text-gray-700">{ORDER_TYPE_LABELS[order.order_type] ?? order.order_type}</span></p>
            {order.requested_module   && <p className="text-xs text-gray-500">Module: <span className="font-medium text-gray-700">{order.requested_module}</span></p>}
            {order.requested_days     && <p className="text-xs text-gray-500">Days: <span className="font-medium text-gray-700">+{order.requested_days}</span></p>}
            {order.requested_features?.length ? <p className="text-xs text-gray-500">Features: <span className="font-medium text-gray-700">{order.requested_features.join(', ')}</span></p> : null}
            <p className="text-xs text-gray-600 mt-2 border-t border-gray-200 pt-2">{order.description}</p>
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">Quoted Amount (USD)</label>
              <input type="number" min={0} step={0.01} value={amount} onChange={e => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">Payment Reference</label>
              <input type="text" value={payRef} onChange={e => setPayRef(e.target.value)}
                placeholder="Invoice / transaction ID…"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400" />
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={payConfirmed} onChange={e => setPayConfirmed(e.target.checked)}
                className="rounded accent-brand-600" />
              <span className="text-sm text-gray-700">Payment confirmed</span>
            </label>
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">Admin Note (visible to tenant)</label>
              <textarea rows={3} value={note} onChange={e => setNote(e.target.value)}
                placeholder="Optional note for the tenant…"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand-400" />
            </div>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between gap-2">
          <div className="flex gap-2">
            {['pending'].includes(order.status) && (
              <button onClick={() => reviewMut.mutate()} disabled={busy}
                className="px-3 py-2 rounded-xl text-xs font-semibold border border-blue-200 text-blue-700 hover:bg-blue-50 disabled:opacity-40">
                Mark Under Review
              </button>
            )}
            {['pending','under_review'].includes(order.status) && (
              <button onClick={() => rejectMut.mutate()} disabled={busy}
                className="px-3 py-2 rounded-xl text-xs font-semibold border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-40">
                Reject
              </button>
            )}
          </div>
          <div className="flex gap-2 ml-auto">
            <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm text-gray-600 hover:bg-gray-50 border border-gray-200">Cancel</button>
            {['pending','under_review'].includes(order.status) && (
              <button onClick={() => approveMut.mutate()} disabled={busy || !payConfirmed}
                className="px-4 py-2 rounded-xl text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40">
                {approveMut.isPending ? 'Approving…' : 'Approve & Provision'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SuperAdminOrdersTab() {
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter,   setTypeFilter]   = useState('');
  const [reviewing, setReviewing]       = useState<SuperOrder | null>(null);

  const { data: orders = [], isLoading } = useQuery<SuperOrder[]>({
    queryKey: ['super-orders', statusFilter, typeFilter],
    queryFn: () => api.get('/api/v1/governance/orders', {
      params: { ...(statusFilter && { status: statusFilter }), ...(typeFilter && { type: typeFilter }) },
    }).then(r => r.data.data),
  });

  const counts = {
    pending:      orders.filter(o => o.status === 'pending').length,
    under_review: orders.filter(o => o.status === 'under_review').length,
    approved:     orders.filter(o => o.status === 'approved').length,
    rejected:     orders.filter(o => o.status === 'rejected').length,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-brand-600" /> Tenant Orders
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">Review and approve upgrade requests from workspaces</p>
        </div>
      </div>

      {/* KPI chips */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Awaiting Review', value: counts.pending,      cls: counts.pending > 0 ? 'border-amber-200 bg-amber-50 text-amber-700' : '' },
          { label: 'Under Review',    value: counts.under_review, cls: counts.under_review > 0 ? 'border-blue-200 bg-blue-50 text-blue-700' : '' },
          { label: 'Approved',        value: counts.approved,     cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
          { label: 'Rejected',        value: counts.rejected,     cls: 'border-gray-200 bg-gray-50 text-gray-500' },
        ].map(k => (
          <div key={k.label} className={`rounded-xl border px-4 py-3 ${k.cls || 'border-gray-100 bg-white'}`}>
            <p className="text-xs opacity-70">{k.label}</p>
            <p className="text-2xl font-bold mt-0.5">{k.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400">
          <option value="">All Statuses</option>
          {Object.entries(ORDER_STATUS_CFG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
          className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400">
          <option value="">All Types</option>
          {Object.entries(ORDER_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      {/* Table */}
      {isLoading && <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-brand-400" /></div>}
      {!isLoading && orders.length === 0 && (
        <div className="text-center py-16 bg-white rounded-2xl border border-dashed border-gray-200">
          <ShoppingCart className="w-10 h-10 mx-auto text-gray-200 mb-3" />
          <p className="text-gray-500 font-medium">No orders match the filter</p>
        </div>
      )}
      {!isLoading && orders.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-xs text-gray-400 font-medium uppercase tracking-wider">
                <th className="text-left px-4 py-3">#</th>
                <th className="text-left px-4 py-3">Tenant</th>
                <th className="text-left px-4 py-3">Type</th>
                <th className="text-left px-4 py-3">Details</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Payment</th>
                <th className="text-left px-4 py-3">Submitted</th>
                <th className="text-left px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {orders.map(o => {
                const cfg = ORDER_STATUS_CFG[o.status] ?? ORDER_STATUS_CFG.pending;
                const StatusIcon = cfg.icon;
                return (
                  <tr key={o.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                    <td className="px-4 py-3 text-gray-400 font-mono text-xs">{o.id}</td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-800 text-xs">{o.tenant_name ?? o.tenant_id.slice(0,8)}</p>
                      <p className="text-gray-400 text-[10px]">{o.requested_by_name}</p>
                    </td>
                    <td className="px-4 py-3 text-gray-700 text-xs">{ORDER_TYPE_LABELS[o.order_type] ?? o.order_type}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs max-w-xs">
                      <p className="line-clamp-2">{o.description}</p>
                      {o.requested_module && <p className="text-gray-400 mt-0.5">Module: {o.requested_module}</p>}
                      {o.requested_days   && <p className="text-gray-400 mt-0.5">+{o.requested_days} days</p>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium ${cfg.cls}`}>
                        <StatusIcon className="w-3 h-3" />{cfg.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {o.payment_confirmed
                        ? <span className="inline-flex items-center gap-1 text-xs text-emerald-700"><CheckCircle className="w-3 h-3" />Confirmed</span>
                        : o.quoted_amount
                          ? <span className="text-xs text-amber-600">Quoted {o.currency ?? 'USD'} {Number(o.quoted_amount).toFixed(2)}</span>
                          : <span className="text-xs text-gray-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400">
                      {new Date(o.requested_at).toLocaleDateString('en-US', { day:'2-digit', month:'short', year:'numeric' })}
                    </td>
                    <td className="px-4 py-3">
                      {['pending','under_review'].includes(o.status) && (
                        <button onClick={() => setReviewing(o)}
                          className="text-xs px-3 py-1.5 rounded-lg border border-brand-200 text-brand-700 hover:bg-brand-50 font-medium">
                          Review
                        </button>
                      )}
                      {['approved','rejected'].includes(o.status) && (
                        <button onClick={() => setReviewing(o)}
                          className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50">
                          View
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {reviewing && <ReviewOrderModal order={reviewing} onClose={() => setReviewing(null)} />}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────
export function SuperAdmin() {
  const isSuperAdmin = useIsSuperAdmin();
  if (!isSuperAdmin) return <Navigate to="/dashboard" replace />;

  const qc = useQueryClient();
  // The tab list itself now lives in the sidebar (App.tsx's SuperAdminSidebarNav) —
  // reading it from the URL instead of local state keeps the two in sync.
  const [searchParams] = useSearchParams();
  const activeTab = (searchParams.get('tab') ?? 'dashboard') as
    'dashboard' | 'tenants' | 'roles' | 'sub-admins' | 'billing' | 'reports' | 'catalogue' | 'orders' | 'settings' | 'alerts' | 'agent-templates';
  const [search, setSearch] = useState('');
  const [planFilter, setPlanFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [showSync, setShowSync]     = useState(false);
  const [openActions, setOpenActions] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['sa-tenants', search, planFilter, statusFilter, page],
    queryFn: () => api.get('/super-admin/tenants', {
      params: { page, pageSize: 20, search: search || undefined, plan: planFilter || undefined, status: statusFilter || undefined },
    }).then((r) => r.data),
    enabled: activeTab === 'tenants' || activeTab === 'billing',
  });

  const tenants = data?.data ?? [];
  const meta = data?.meta ?? {};

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-6 py-4 shrink-0">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center">
              <Shield className="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-gray-900">Super Admin</h1>
              <p className="text-xs text-gray-400">Platform-wide workspace management</p>
            </div>
          </div>
          {activeTab === 'tenants' && (
            <div className="flex gap-2">
              <button onClick={() => setShowSync(true)}
                className="flex items-center gap-2 px-3 py-2 border border-gray-200 text-gray-600 text-sm rounded-lg hover:bg-gray-50">
                <RefreshCw className="w-4 h-4" /> Sync Entitlements
              </button>
              <button onClick={() => setShowCreate(true)}
                className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white text-sm rounded-lg hover:bg-brand-700">
                <Plus className="w-4 h-4" /> New Workspace
              </button>
            </div>
          )}
        </div>
        {/* Section tabs used to live here as a horizontally-scrolling bar that
            overflowed off-screen — moved to the sidebar (App.tsx's
            SuperAdminSidebarNav), which was otherwise sitting empty. 2026-07-17. */}
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {activeTab === 'dashboard'  && <DashboardTab />}
        {activeTab === 'billing'    && <PlatformBillingTab tenants={tenants} />}
        {activeTab === 'catalogue'  && <CatalogueTab />}
        {activeTab === 'orders'     && <SuperAdminOrdersTab />}
        {activeTab === 'roles'      && <PlatformRolesTab />}
        {activeTab === 'sub-admins' && <SubAdminsTab />}
        {activeTab === 'reports'    && <SuperAdminReports />}
        {activeTab === 'settings'   && <SuperAdminSettings />}
        {activeTab === 'alerts'     && <PlatformAlertsTab />}
        {activeTab === 'agent-templates' && <AgentTemplatesTab />}

        {/* Filters */}
        {activeTab === 'tenants' && <div className="flex gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-1 min-w-48 bg-white border border-gray-200 rounded-lg px-3 py-2">
            <Search className="w-4 h-4 text-gray-400 shrink-0" />
            <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search workspaces…"
              className="flex-1 text-sm outline-none bg-transparent" />
          </div>
          <select value={planFilter} onChange={(e) => { setPlanFilter(e.target.value); setPage(1); }}
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none bg-white focus:border-brand-400">
            <option value="">All Plans</option>
            {PLANS.map((p) => <option key={p} value={p} className="capitalize">{p}</option>)}
          </select>
          <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none bg-white focus:border-brand-400">
            <option value="">All Statuses</option>
            {['active','trial','suspended','cancelled'].map((s) => (
              <option key={s} value={s} className="capitalize">{s}</option>
            ))}
          </select>
        </div>}

        {/* Table */}
        {/* overflow-visible so the per-row ⋮ actions dropdown isn't clipped */}
        {activeTab === 'tenants' && <div className="bg-white rounded-xl border border-gray-100 overflow-visible">
          {isLoading ? (
            <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 text-brand-400 animate-spin" /></div>
          ) : tenants.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <Building2 className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No workspaces found</p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-50">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400">Workspace</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400">Plan</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400">Modules</th>
                  {/* Only user count — a workspace's contacts/deals are the
                      tenant's own business data, not the platform operator's
                      concern (removed 2026-07-13 per owner). */}
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400">
                    <span className="flex items-center justify-end gap-1"><Users className="w-3 h-3" />Users</span>
                  </th>
                  <th className="w-10 px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {tenants.map((t: any) => (
                  <tr key={t.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <p className="text-sm font-semibold text-gray-900">{t.name}</p>
                      <p className="text-xs text-gray-400 font-mono">{t.slug}.crmplatform.io</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full capitalize font-medium ${PLAN_COLORS[t.plan] ?? 'bg-gray-100 text-gray-600'}`}>
                        {t.plan}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full capitalize font-medium ${STATUS_COLORS[t.status] ?? 'bg-gray-100 text-gray-500'}`}>
                        {t.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 flex-wrap">
                        {(t.active_modules ?? ['crm']).map((m: string) => (
                          <span key={m} className="text-xs bg-brand-50 text-brand-600 px-1.5 py-0.5 rounded capitalize">{m}</span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-sm text-gray-600 font-medium">{t.user_count ?? 0}</span>
                    </td>
                    <td className="px-4 py-3 relative">
                      <button onClick={() => setOpenActions(openActions === t.id ? null : t.id)}
                        className="p-1 text-gray-400 hover:text-gray-600 rounded">
                        <MoreVertical className="w-4 h-4" />
                      </button>
                      {openActions === t.id && (
                        <TenantActions tenant={t} onClose={() => setOpenActions(null)} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>}

        {/* Pagination */}
        {activeTab === 'tenants' && meta.total > 20 && (
          <div className="flex items-center justify-between text-sm text-gray-500">
            <span>{meta.total} workspaces</span>
            <div className="flex gap-2">
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                className="px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40">Prev</button>
              <span className="px-3 py-1.5">Page {page} of {Math.ceil(meta.total / 20)}</span>
              <button disabled={page >= Math.ceil(meta.total / 20)} onClick={() => setPage(p => p + 1)}
                className="px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40">Next</button>
            </div>
          </div>
        )}
      </div>

      {showCreate && <CreateWorkspaceModal onClose={() => setShowCreate(false)} />}
      {showSync   && <SyncEntitlementsModal onClose={() => setShowSync(false)} />}
    </div>
  );
}
