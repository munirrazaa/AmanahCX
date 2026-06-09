/**
 * Super Admin — platform-wide workspace management
 *
 * Only accessible to users with role = 'super_admin'.
 * Lists all tenants, shows usage stats, allows creating workspaces,
 * updating plans, managing modules, suspending/activating tenants.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Shield, Plus, Search, MoreVertical, Users, TrendingUp,
  Loader2, X, Check, AlertTriangle, Building2, BarChart3,
  Package, Ban, Play,
} from 'lucide-react';
import { api } from '../services/api';
import { useIsSuperAdmin } from '../hooks/useRole';
import { Navigate } from 'react-router-dom';

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

const ALL_MODULES = ['crm', 'voice', 'ticketing'];
const MODULE_LABELS: Record<string, string> = { crm: 'CRM', voice: 'Voice', ticketing: 'Ticketing' };

// ── Create Workspace Modal ─────────────────────────────────────────────────
function CreateWorkspaceModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: '', slug: '', plan: 'starter', adminEmail: '', adminName: '' });
  const [slugTouched, setSlugTouched] = useState(false);

  const mutation = useMutation({
    mutationFn: (body: typeof form) => api.post('/super-admin/tenants', body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sa-tenants'] }); onClose(); },
  });

  const autoSlug = (name: string) =>
    name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-gray-900">Create Workspace</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

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
        </div>

        {mutation.isError && (
          <p className="mt-3 text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">
            {(mutation.error as any)?.response?.data?.error?.message ?? 'Failed to create workspace'}
          </p>
        )}

        <div className="flex gap-2 mt-6">
          <button onClick={onClose} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
          <button
            onClick={() => mutation.mutate(form)}
            disabled={!form.name || !form.slug || !form.adminEmail || mutation.isPending}
            className="flex-1 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700 disabled:opacity-50 flex items-center justify-center gap-2">
            {mutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            Create Workspace
          </button>
        </div>
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

  const [activeModules, setActiveModules] = useState<string[]>(tenant.active_modules ?? ['crm']);
  const [showModules, setShowModules] = useState(false);

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div className="absolute right-0 mt-1 w-56 bg-white rounded-xl shadow-xl border border-gray-100 py-1 z-50 overflow-hidden"
        style={{ top: '100%' }}
        onClick={(e) => e.stopPropagation()}>

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
          <Package className="w-4 h-4 text-gray-400" /> Manage Modules
        </button>
        {showModules && (
          <div className="px-3 pb-2 space-y-1">
            {ALL_MODULES.map((m) => (
              <label key={m} className="flex items-center gap-2 py-1 cursor-pointer">
                <input type="checkbox"
                  checked={activeModules.includes(m)}
                  disabled={m === 'crm'}  // CRM always on
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...activeModules, m]
                      : activeModules.filter((x) => x !== m);
                    setActiveModules(next);
                  }}
                  className="accent-brand-600" />
                <span className="text-xs text-gray-700">{MODULE_LABELS[m]}</span>
                {m === 'crm' && <span className="text-xs text-gray-400">(always on)</span>}
              </label>
            ))}
            <button
              onClick={() => modulesMutation.mutate({ id: tenant.id, modules: activeModules })}
              disabled={modulesMutation.isPending}
              className="mt-1 w-full py-1.5 bg-brand-600 text-white rounded text-xs hover:bg-brand-700 disabled:opacity-50">
              {modulesMutation.isPending ? 'Saving…' : 'Apply Modules'}
            </button>
          </div>
        )}

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
        </div>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────
export function SuperAdmin() {
  const isSuperAdmin = useIsSuperAdmin();
  if (!isSuperAdmin) return <Navigate to="/dashboard" replace />;

  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [planFilter, setPlanFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [openActions, setOpenActions] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['sa-tenants', search, planFilter, statusFilter, page],
    queryFn: () => api.get('/super-admin/tenants', {
      params: { page, pageSize: 20, search: search || undefined, plan: planFilter || undefined, status: statusFilter || undefined },
    }).then((r) => r.data),
  });

  const { data: metrics } = useQuery({
    queryKey: ['sa-metrics'],
    queryFn: () => api.get('/super-admin/metrics').then((r) => r.data.data),
    staleTime: 60_000,
  });

  const tenants = data?.data ?? [];
  const meta = data?.meta ?? {};

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-6 py-4 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center">
              <Shield className="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-gray-900">Super Admin</h1>
              <p className="text-xs text-gray-400">Platform-wide workspace management</p>
            </div>
          </div>
          <button onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white text-sm rounded-lg hover:bg-brand-700">
            <Plus className="w-4 h-4" /> New Workspace
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Metrics */}
        {metrics && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Total Workspaces', value: metrics.total_tenants, icon: Building2, color: 'text-brand-600' },
              { label: 'Active',           value: metrics.active_tenants, icon: Check, color: 'text-green-600' },
              { label: 'On Trial',         value: metrics.trial_tenants, icon: AlertTriangle, color: 'text-amber-600' },
              { label: 'New (30d)',         value: metrics.new_tenants_30d, icon: TrendingUp, color: 'text-blue-600' },
            ].map(({ label, value, icon: Icon, color }) => (
              <div key={label} className="bg-white rounded-xl border border-gray-100 p-4">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs text-gray-400">{label}</p>
                  <Icon className={`w-4 h-4 ${color}`} />
                </div>
                <p className="text-2xl font-bold text-gray-900">{value ?? '—'}</p>
              </div>
            ))}
          </div>
        )}

        {/* Plan breakdown */}
        {metrics && (
          <div className="bg-white rounded-xl border border-gray-100 p-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Plan Distribution</p>
            <div className="grid grid-cols-4 gap-3">
              {PLANS.map((p) => (
                <div key={p} className="text-center">
                  <p className="text-xl font-bold text-gray-900">{metrics[`${p}_plan`] ?? 0}</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${PLAN_COLORS[p]}`}>{p}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="flex gap-3 flex-wrap">
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
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
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
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400">
                    <span className="flex items-center justify-end gap-3">
                      <span className="flex items-center gap-1"><Users className="w-3 h-3" />Users</span>
                      <span className="flex items-center gap-1"><Users className="w-3 h-3" />Contacts</span>
                      <span className="flex items-center gap-1"><TrendingUp className="w-3 h-3" />Deals</span>
                    </span>
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
                      <span className="inline-flex gap-5 text-sm text-gray-600">
                        <span className="font-medium">{t.user_count ?? 0}</span>
                        <span className="font-medium">{t.contact_count ?? 0}</span>
                        <span className="font-medium">{t.open_deals ?? 0}</span>
                      </span>
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
        </div>

        {/* Pagination */}
        {meta.total > 20 && (
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
    </div>
  );
}
