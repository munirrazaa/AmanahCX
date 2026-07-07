/**
 * Orders & Upgrades page — tenant_admin view
 *
 * Tenant admin can:
 *  • View all their orders and statuses
 *  • Place a new order from the full module/feature catalog
 *  • Cancel a pending order
 *
 * Order types:
 *  storage_extension — extend recording retention period (days)
 *  new_module        — purchase a full product module
 *  feature_request   — request individual features within a module
 *  plan_upgrade      — upgrade subscription plan
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ShoppingCart, Plus, Loader2, CheckCircle, Clock,
  X, ChevronDown, ChevronRight, Package,
  AlertTriangle, XCircle, Hourglass, BadgeCheck,
} from 'lucide-react';
import { api } from '../services/api';

// ── Types ─────────────────────────────────────────────────────────────────────

interface CatalogFeature {
  key: string; label: string; purchased: boolean;
}
interface CatalogModule {
  key: string; label: string; description: string; purchased: boolean;
  features: CatalogFeature[];
}

interface Order {
  id: number;
  order_type: string;
  status: string;
  description: string;
  requested_module?: string;
  requested_features?: string[];
  requested_days?: number;
  quoted_amount?: number;
  currency?: string;
  payment_confirmed: boolean;
  admin_note?: string;
  requested_by_name?: string;
  reviewed_by_name?: string;
  requested_at: string;
  reviewed_at?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_CFG: Record<string, { label: string; cls: string; icon: React.ElementType }> = {
  pending:      { label: 'Pending Review', cls: 'bg-amber-50 text-amber-700 border-amber-200',   icon: Hourglass   },
  under_review: { label: 'Under Review',   cls: 'bg-blue-50 text-blue-700 border-blue-200',      icon: Clock       },
  approved:     { label: 'Approved',       cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: BadgeCheck },
  rejected:     { label: 'Not Approved',   cls: 'bg-red-50 text-red-700 border-red-200',         icon: XCircle     },
  cancelled:    { label: 'Cancelled',      cls: 'bg-gray-100 text-gray-500 border-gray-200',     icon: X           },
};

const ORDER_TYPE_LABELS: Record<string, string> = {
  storage_extension: 'Storage Extension',
  new_module:        'New Module',
  feature_request:   'Feature Request',
  plan_upgrade:      'Plan Upgrade',
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ── New Order modal ───────────────────────────────────────────────────────────

function NewOrderModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [step, setStep]               = useState<1|2>(1);
  const [orderType, setOrderType]     = useState('');
  const [description, setDescription] = useState('');
  const [selModule, setSelModule]     = useState('');
  const [selFeatures, setSelFeatures] = useState<string[]>([]);
  const [extDays, setExtDays]         = useState(90);
  const [expandedMod, setExpandedMod] = useState<string>('');

  const { data: catalog = [] } = useQuery<CatalogModule[]>({
    queryKey: ['governance-catalog'],
    queryFn:  () => api.get('/api/v1/governance/catalog').then(r => r.data.data),
  });

  const submitMut = useMutation({
    mutationFn: () => api.post('/api/v1/governance/orders', {
      order_type:         orderType,
      description,
      requested_module:   orderType === 'new_module'       ? selModule        : undefined,
      requested_features: orderType === 'feature_request'  ? selFeatures      : undefined,
      requested_days:     orderType === 'storage_extension' ? extDays         : undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tenant-orders'] });
      onClose();
    },
  });

  const canProceed = orderType !== '';
  const canSubmit  =
    description.trim().length > 0 &&
    (orderType !== 'new_module'       || selModule !== '') &&
    (orderType !== 'feature_request'  || selFeatures.length > 0) &&
    (orderType !== 'storage_extension'|| extDays > 0);

  const unpurchasedModules = catalog.filter(m => !m.purchased);
  const unpurchasedFeatures = catalog.flatMap(m =>
    m.features.filter(f => !f.purchased).map(f => ({ ...f, moduleName: m.label, moduleKey: m.key })),
  );

  const toggleFeature = (key: string) =>
    setSelFeatures(prev => prev.includes(key) ? prev.filter(x => x !== key) : [...prev, key]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <h2 className="text-base font-semibold text-gray-900">New Order / Upgrade Request</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          {/* Step 1 — order type */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">What are you requesting?</p>
            <div className="grid grid-cols-2 gap-3">
              {[
                { key: 'new_module',        label: 'New Module',          desc: 'Add a new product module to your workspace', icon: Package },
                { key: 'feature_request',   label: 'Individual Feature',  desc: 'Request specific features within a module',  icon: CheckCircle },
                { key: 'storage_extension', label: 'Storage Extension',   desc: 'Extend your recording retention period',     icon: Clock },
                { key: 'plan_upgrade',      label: 'Plan Upgrade',        desc: 'Upgrade to a higher subscription tier',      icon: BadgeCheck },
              ].map(({ key, label, desc, icon: Icon }) => (
                <button key={key} onClick={() => { setOrderType(key); setSelModule(''); setSelFeatures([]); }}
                  className={`text-left p-4 rounded-xl border-2 transition-all ${
                    orderType === key
                      ? 'border-brand-500 bg-brand-50'
                      : 'border-gray-100 hover:border-brand-200 hover:bg-gray-50'
                  }`}>
                  <Icon className={`w-5 h-5 mb-2 ${orderType === key ? 'text-brand-600' : 'text-gray-400'}`} />
                  <p className={`text-sm font-semibold ${orderType === key ? 'text-brand-800' : 'text-gray-800'}`}>{label}</p>
                  <p className={`text-xs mt-0.5 ${orderType === key ? 'text-brand-600' : 'text-gray-400'}`}>{desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Step 2 — details based on order type */}
          {orderType === 'new_module' && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                Select Module <span className="text-gray-400 font-normal">(modules not yet in your workspace)</span>
              </p>
              {unpurchasedModules.length === 0 ? (
                <p className="text-sm text-gray-400 py-4 text-center">You already have all available modules.</p>
              ) : (
                <div className="space-y-2">
                  {unpurchasedModules.map(m => (
                    <button key={m.key} onClick={() => setSelModule(m.key)}
                      className={`w-full text-left px-4 py-3 rounded-xl border-2 transition-all ${
                        selModule === m.key
                          ? 'border-brand-500 bg-brand-50'
                          : 'border-gray-100 hover:border-gray-200'
                      }`}>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className={`text-sm font-semibold ${selModule === m.key ? 'text-brand-800' : 'text-gray-800'}`}>{m.label}</p>
                          <p className="text-xs text-gray-400 mt-0.5">{m.description}</p>
                        </div>
                        {selModule === m.key && <CheckCircle className="w-4 h-4 text-brand-600 shrink-0 ml-2" />}
                      </div>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {m.features.map(f => (
                          <span key={f.key} className="text-[10px] px-2 py-0.5 bg-white border border-gray-200 rounded-full text-gray-500">
                            {f.label}
                          </span>
                        ))}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {orderType === 'feature_request' && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                Select Features <span className="text-gray-400 font-normal">(features not yet activated)</span>
              </p>
              {unpurchasedFeatures.length === 0 ? (
                <p className="text-sm text-gray-400 py-4 text-center">All available features are already active.</p>
              ) : (
                <div className="space-y-2">
                  {/* Group by module */}
                  {catalog.map(m => {
                    const avail = m.features.filter(f => !f.purchased);
                    if (!avail.length) return null;
                    const expanded = expandedMod === m.key;
                    return (
                      <div key={m.key} className="border border-gray-100 rounded-xl overflow-hidden">
                        <button
                          className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-gray-50"
                          onClick={() => setExpandedMod(expanded ? '' : m.key)}>
                          <span className="text-sm font-medium text-gray-700">{m.label}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-400">{avail.length} available</span>
                            {expanded ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                          </div>
                        </button>
                        {expanded && (
                          <div className="border-t border-gray-100 px-4 py-3 space-y-2">
                            {avail.map(f => (
                              <label key={f.key} className="flex items-center gap-3 cursor-pointer">
                                <input type="checkbox" checked={selFeatures.includes(f.key)}
                                  onChange={() => toggleFeature(f.key)}
                                  className="rounded accent-brand-600" />
                                <span className="text-sm text-gray-700">{f.label}</span>
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {orderType === 'storage_extension' && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Additional Days Requested</p>
              <div className="flex items-center gap-3">
                {[30, 90, 180, 365].map(d => (
                  <button key={d} onClick={() => setExtDays(d)}
                    className={`px-4 py-2 rounded-xl text-sm font-semibold border-2 transition-all ${
                      extDays === d ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'
                    }`}>
                    +{d} days
                  </button>
                ))}
                <input type="number" min={1} max={3650} value={extDays}
                  onChange={e => setExtDays(Number(e.target.value))}
                  className="w-24 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400" />
              </div>
              <p className="text-xs text-gray-400 mt-2">Super admin will quote the price based on the number of days requested.</p>
            </div>
          )}

          {orderType === 'plan_upgrade' && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Available Plans</p>
              {['Starter', 'Professional', 'Enterprise'].map(plan => (
                <div key={plan} className="px-4 py-3 rounded-xl border border-gray-100 bg-gray-50">
                  <p className="text-sm font-semibold text-gray-800">{plan}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {plan === 'Starter'       && 'CRM + Ticketing + Email Inbox'}
                    {plan === 'Professional'  && 'All Starter features + Voice Bot + Sales & Invoicing + Integrations'}
                    {plan === 'Enterprise'    && 'All Professional features + Advanced Analytics + dedicated support'}
                  </p>
                </div>
              ))}
              <p className="text-xs text-gray-400 mt-2">Describe the plan you want in the details box below. Super admin will quote accordingly.</p>
            </div>
          )}

          {/* Description — always shown once order type chosen */}
          {orderType && (
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider block mb-2">
                Additional Details <span className="text-red-400">*</span>
              </label>
              <textarea rows={3} value={description} onChange={e => setDescription(e.target.value)}
                placeholder={
                  orderType === 'storage_extension' ? 'Briefly explain why you need the extension (e.g. regulatory audit, ongoing dispute)…'
                  : orderType === 'new_module'      ? 'Briefly describe your intended use case for this module…'
                  : orderType === 'feature_request' ? 'Describe what you need these features for…'
                  : 'Describe your requirements and expected usage…'
                }
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand-400" />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between shrink-0">
          <p className="text-xs text-gray-400">Super admin will review and quote a price. Access is granted after payment confirmation.</p>
          <div className="flex gap-2 shrink-0 ml-4">
            <button onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm text-gray-600 hover:bg-gray-50 border border-gray-200">
              Cancel
            </button>
            <button onClick={() => submitMut.mutate()} disabled={!canSubmit || submitMut.isPending}
              className="px-4 py-2 rounded-xl text-sm font-semibold bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-40">
              {submitMut.isPending ? 'Submitting…' : 'Submit Request'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Order card ────────────────────────────────────────────────────────────────

function OrderCard({ order }: { order: Order }) {
  const qc  = useQueryClient();
  const cfg = STATUS_CFG[order.status] ?? STATUS_CFG.pending;
  const Icon = cfg.icon;

  const cancelMut = useMutation({
    mutationFn: () => api.patch(`/api/v1/governance/orders/${order.id}/cancel`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tenant-orders'] }),
  });

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-sm font-semibold text-gray-900">
              {ORDER_TYPE_LABELS[order.order_type] ?? order.order_type}
            </span>
            <span className={`text-xs px-2 py-0.5 rounded-full border font-medium flex items-center gap-1 ${cfg.cls}`}>
              <Icon className="w-3 h-3" />
              {cfg.label}
            </span>
            {order.payment_confirmed && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                Payment confirmed
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500">Submitted {fmtDate(order.requested_at)}</p>
        </div>
        {order.status === 'pending' && (
          <button onClick={() => cancelMut.mutate()} disabled={cancelMut.isPending}
            className="text-xs px-3 py-1 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40 shrink-0">
            Cancel
          </button>
        )}
      </div>

      <p className="text-sm text-gray-700">{order.description}</p>

      {order.requested_module && (
        <p className="text-xs text-gray-500"><span className="font-medium">Module:</span> {order.requested_module}</p>
      )}
      {order.requested_features?.length ? (
        <div className="flex flex-wrap gap-1">
          {order.requested_features.map(f => (
            <span key={f} className="text-xs px-2 py-0.5 bg-brand-50 text-brand-700 rounded-full border border-brand-100">{f}</span>
          ))}
        </div>
      ) : null}
      {order.requested_days && (
        <p className="text-xs text-gray-500"><span className="font-medium">Days requested:</span> +{order.requested_days}</p>
      )}

      {order.quoted_amount && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
          <p className="text-xs text-amber-700">
            <span className="font-semibold">Quoted:</span>{' '}
            {order.currency ?? 'USD'} {Number(order.quoted_amount).toFixed(2)}
            {' — '}approval will be granted after payment confirmation.
          </p>
        </div>
      )}

      {order.admin_note && (
        <div className="bg-gray-50 border border-gray-100 rounded-xl px-3 py-2">
          <p className="text-xs text-gray-600"><span className="font-medium">Admin note:</span> {order.admin_note}</p>
        </div>
      )}
    </div>
  );
}

// ── Catalog reference panel ───────────────────────────────────────────────────

function CatalogPanel({ catalog }: { catalog: CatalogModule[] }) {
  const [expanded, setExpanded] = useState<string>('');
  return (
    <div className="space-y-2">
      {catalog.map(m => {
        const isOpen = expanded === m.key;
        return (
          <div key={m.key} className={`rounded-xl border overflow-hidden ${m.purchased ? 'border-emerald-200 bg-emerald-50/30' : 'border-gray-100'}`}>
            <button
              className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50/50 transition-colors"
              onClick={() => setExpanded(isOpen ? '' : m.key)}>
              <div className="flex items-center gap-2">
                <span className={`text-sm font-semibold ${m.purchased ? 'text-emerald-800' : 'text-gray-800'}`}>{m.label}</span>
                {m.purchased
                  ? <span className="text-[10px] px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded-full font-medium">Active</span>
                  : <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded-full">Not purchased</span>}
              </div>
              {isOpen ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
            </button>
            {isOpen && (
              <div className="border-t border-gray-100 px-4 py-3 space-y-2">
                <p className="text-xs text-gray-500 mb-2">{m.description}</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {m.features.map(f => (
                    <div key={f.key} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs ${
                      f.purchased ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-50 text-gray-500'
                    }`}>
                      {f.purchased
                        ? <CheckCircle className="w-3 h-3 text-emerald-500 shrink-0" />
                        : <div className="w-3 h-3 rounded-full border border-gray-300 shrink-0" />}
                      {f.label}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function OrdersPage() {
  const qc = useQueryClient();
  const [showNew, setShowNew]   = useState(false);
  const [viewTab, setViewTab]   = useState<'orders' | 'catalog'>('orders');

  const { data: orders = [], isLoading: ordersLoading } = useQuery<Order[]>({
    queryKey: ['tenant-orders'],
    queryFn:  () => api.get('/api/v1/governance/orders').then(r => r.data.data),
  });
  const { data: catalog = [], isLoading: catLoading } = useQuery<CatalogModule[]>({
    queryKey: ['governance-catalog'],
    queryFn:  () => api.get('/api/v1/governance/catalog').then(r => r.data.data),
  });

  const activeModules   = catalog.filter(m => m.purchased).length;
  const pendingOrders   = orders.filter(o => ['pending','under_review'].includes(o.status)).length;
  const approvedOrders  = orders.filter(o => o.status === 'approved').length;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-brand-50 border border-brand-100">
            <ShoppingCart className="w-5 h-5 text-brand-600" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Orders & Upgrades</h1>
            <p className="text-sm text-gray-500 mt-0.5">Request new modules, features, or storage extensions</p>
          </div>
        </div>
        <button onClick={() => setShowNew(true)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold bg-brand-600 text-white hover:bg-brand-700">
          <Plus className="w-4 h-4" /> New Request
        </button>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Active Modules',  value: activeModules,  cls: 'text-emerald-700', sub: 'of ' + catalog.length + ' total' },
          { label: 'Pending Orders',  value: pendingOrders,  cls: pendingOrders > 0 ? 'text-amber-700' : 'text-gray-700', sub: 'awaiting review' },
          { label: 'Approved Orders', value: approvedOrders, cls: 'text-brand-700',   sub: 'all time' },
        ].map(k => (
          <div key={k.label} className="bg-white rounded-2xl border border-gray-100 px-5 py-4">
            <p className="text-xs text-gray-400">{k.label}</p>
            <p className={`text-2xl font-bold mt-0.5 ${k.cls}`}>{k.value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{k.sub}</p>
          </div>
        ))}
      </div>

      {/* Tab bar */}
      <div className="flex gap-0 border-b border-gray-200">
        {([
          { id: 'orders',  label: 'My Orders' },
          { id: 'catalog', label: 'Module & Feature Catalog' },
        ] as const).map(t => (
          <button key={t.id} onClick={() => setViewTab(t.id)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              viewTab === t.id
                ? 'border-brand-500 text-brand-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Orders list */}
      {viewTab === 'orders' && (
        <>
          {ordersLoading && <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-brand-400" /></div>}
          {!ordersLoading && orders.length === 0 && (
            <div className="text-center py-16 bg-white rounded-2xl border border-dashed border-gray-200">
              <ShoppingCart className="w-10 h-10 mx-auto text-gray-200 mb-3" />
              <p className="text-gray-500 font-medium">No orders yet</p>
              <p className="text-sm text-gray-400 mt-1 mb-4">Request a new module, feature, or storage extension</p>
              <button onClick={() => setShowNew(true)}
                className="px-4 py-2 rounded-xl text-sm font-semibold bg-brand-600 text-white hover:bg-brand-700">
                Place First Order
              </button>
            </div>
          )}
          {!ordersLoading && orders.length > 0 && (
            <div className="space-y-4">
              {orders.map(o => <OrderCard key={o.id} order={o} />)}
            </div>
          )}
        </>
      )}

      {/* Catalog */}
      {viewTab === 'catalog' && (
        <>
          {catLoading && <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-brand-400" /></div>}
          {!catLoading && (
            <>
              <p className="text-sm text-gray-500">
                Green = already active in your workspace. To add anything listed as "Not purchased", click <strong>New Request</strong>.
              </p>
              <CatalogPanel catalog={catalog} />
            </>
          )}
        </>
      )}

      {showNew && <NewOrderModal onClose={() => setShowNew(false)} />}
    </div>
  );
}
