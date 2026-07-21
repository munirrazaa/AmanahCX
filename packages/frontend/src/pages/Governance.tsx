/**
 * Governance — Data & Privacy Policies
 *
 * G-F5: GDPR voice recording retention policy management.
 * Accessible to tenant_admin and policy_admin.
 *
 * Features:
 *  • View all retention policies with draft/published badges
 *  • Create a new policy (draft)
 *  • Edit draft policies
 *  • Publish / unpublish toggle
 *  • Delete draft policies
 *  • Expiry countdown for published policies
 *  • Link to Orders page when expiry is near
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  BookOpen, Plus, Loader2, CheckCircle, Clock, AlertTriangle,
  Edit2, Trash2, X, Shield, ExternalLink, Layers,
} from 'lucide-react';
import { api } from '../services/api';
import { useIsTenantAdmin, useIsPolicyAdmin } from '../hooks/useRole';
import { Link } from 'react-router-dom';
import { TicketSla } from './TicketSla';
import { MilestoneSettings } from './MilestoneSettings';

// ── Types ─────────────────────────────────────────────────────────────────────

interface RetentionPolicy {
  id: number;
  policy_name: string;
  retention_days: number;
  legal_basis: string;
  processing_purpose: string;
  data_categories: string[];
  third_party_transfers: boolean;
  third_parties?: string;
  policy_status: 'draft' | 'published';
  published_at?: string;
  published_by_name?: string;
  expires_at?: string;
  last_warned_at?: string;
  created_by_name?: string;
  created_at: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const LEGAL_BASIS_LABELS: Record<string, string> = {
  consent:              'Consent',
  legitimate_interest:  'Legitimate Interest',
  legal_obligation:     'Legal Obligation',
  vital_interests:      'Vital Interests',
  public_task:          'Public Task',
  contract:             'Contract',
};

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ── Create / Edit modal ───────────────────────────────────────────────────────

const EMPTY_FORM = {
  policy_name: '',
  retention_days: 90,
  legal_basis: 'legitimate_interest',
  processing_purpose: 'Customer service quality assurance and dispute resolution',
  data_categories: ['voice_recordings', 'call_transcripts'],
  third_party_transfers: false,
  third_parties: '',
};

function PolicyModal({
  policy,
  onClose,
}: { policy?: RetentionPolicy; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState(() =>
    policy
      ? {
          policy_name: policy.policy_name,
          retention_days: policy.retention_days,
          legal_basis: policy.legal_basis,
          processing_purpose: policy.processing_purpose,
          data_categories: policy.data_categories,
          third_party_transfers: policy.third_party_transfers,
          third_parties: policy.third_parties ?? '',
        }
      : { ...EMPTY_FORM },
  );

  const saveMut = useMutation({
    mutationFn: () =>
      policy
        ? api.patch(`/api/v1/governance/retention-policies/${policy.id}`, form)
        : api.post('/api/v1/governance/retention-policies', form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['retention-policies'] }); onClose(); },
  });

  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));
  const cats = form.data_categories as string[];
  const toggleCat = (c: string) =>
    set('data_categories', cats.includes(c) ? cats.filter(x => x !== c) : [...cats, c]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">
            {policy ? 'Edit Policy' : 'Create Recording Retention Policy'}
          </h2>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Policy Name</label>
            <input value={form.policy_name} onChange={e => set('policy_name', e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
              placeholder="e.g. Standard Call Recording Policy" />
          </div>

          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">
              Retention Period (days) <span className="text-gray-400 font-normal">— how long recordings are kept</span>
            </label>
            <input type="number" min={1} max={3650}
              value={form.retention_days} onChange={e => set('retention_days', Number(e.target.value))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400" />
          </div>

          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Legal Basis for Processing (GDPR Art. 6)</label>
            <select value={form.legal_basis} onChange={e => set('legal_basis', e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400">
              {Object.entries(LEGAL_BASIS_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Processing Purpose</label>
            <textarea rows={2} value={form.processing_purpose}
              onChange={e => set('processing_purpose', e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand-400" />
          </div>

          <div>
            <label className="text-xs font-medium text-gray-600 block mb-2">Data Categories Covered</label>
            <div className="flex flex-wrap gap-2">
              {['voice_recordings', 'call_transcripts', 'call_metadata', 'agent_notes'].map(c => (
                <button key={c} type="button" onClick={() => toggleCat(c)}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                    cats.includes(c)
                      ? 'bg-brand-100 text-brand-700 border-brand-300'
                      : 'bg-gray-50 text-gray-500 border-gray-200 hover:border-gray-300'
                  }`}>
                  {c.replace(/_/g, ' ')}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input type="checkbox" checked={form.third_party_transfers}
                onChange={e => set('third_party_transfers', e.target.checked)}
                className="rounded accent-brand-600" />
              Recordings are transferred to or processed by third parties
            </label>
            {form.third_party_transfers && (
              <input value={form.third_parties ?? ''}
                onChange={e => set('third_parties', e.target.value)}
                className="mt-2 w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
                placeholder="Name the third parties (e.g. Retell AI, AWS S3)" />
            )}
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          <button onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm text-gray-600 hover:bg-gray-50 border border-gray-200">
            Cancel
          </button>
          <button onClick={() => saveMut.mutate()} disabled={!form.policy_name || saveMut.isPending}
            className="px-4 py-2 rounded-xl text-sm font-semibold bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-40">
            {saveMut.isPending ? 'Saving…' : (policy ? 'Save Changes' : 'Create Policy (Draft)')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Policy Card ───────────────────────────────────────────────────────────────

function PolicyCard({
  policy,
  canEdit,
  onEdit,
}: { policy: RetentionPolicy; canEdit: boolean; onEdit: () => void }) {
  const qc = useQueryClient();
  const isPublished = policy.policy_status === 'published';
  const daysLeft    = policy.expires_at ? daysUntil(policy.expires_at) : null;
  const nearExpiry  = daysLeft !== null && daysLeft <= 30;
  const expired     = daysLeft !== null && daysLeft <= 0;

  const publishMut = useMutation({
    mutationFn: () => api.patch(`/api/v1/governance/retention-policies/${policy.id}/publish`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['retention-policies'] }),
  });
  const deleteMut = useMutation({
    mutationFn: () => api.delete(`/api/v1/governance/retention-policies/${policy.id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['retention-policies'] }),
  });

  return (
    <div className={`bg-white rounded-2xl border p-5 space-y-3 ${
      expired ? 'border-red-300' : nearExpiry ? 'border-amber-300' : 'border-gray-100'
    }`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h3 className="font-semibold text-gray-900">{policy.policy_name}</h3>
            {isPublished ? (
              <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-medium">
                Published
              </span>
            ) : (
              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 font-medium">
                Draft
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500">{policy.processing_purpose}</p>
        </div>
        {canEdit && (
          <div className="flex gap-1 shrink-0">
            {canEdit && (
              <button onClick={() => publishMut.mutate()} disabled={publishMut.isPending}
                className={`px-2 py-1 rounded-lg text-xs font-semibold border transition-colors ${
                  isPublished
                    ? 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
                    : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                }`}>
                {publishMut.isPending ? '…' : (isPublished ? 'Unpublish' : 'Publish')}
              </button>
            )}
            {!isPublished && (
              <>
                <button onClick={onEdit} className="p-1.5 text-gray-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg">
                  <Edit2 className="w-4 h-4" />
                </button>
                <button onClick={() => { if (confirm('Delete this policy?')) deleteMut.mutate(); }}
                  disabled={deleteMut.isPending}
                  className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg">
                  <Trash2 className="w-4 h-4" />
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Expiry warning */}
      {isPublished && expired && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
          <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-xs font-semibold text-red-700">Retention period has expired</p>
            <p className="text-xs text-red-600 mt-0.5">
              New recordings are not covered under this policy.{' '}
              <Link to="/orders" className="underline">Place a Storage Extension order →</Link>
            </p>
          </div>
        </div>
      )}
      {isPublished && nearExpiry && !expired && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
          <Clock className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-xs font-semibold text-amber-700">Expiring in {daysLeft} day{daysLeft === 1 ? '' : 's'}</p>
            <p className="text-xs text-amber-600 mt-0.5">
              Expires {fmtDate(policy.expires_at!)}.{' '}
              <Link to="/orders" className="underline">Request an extension →</Link>
            </p>
          </div>
        </div>
      )}

      {/* Details grid */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-gray-50 rounded-xl px-3 py-2">
          <p className="text-[10px] text-gray-400 uppercase tracking-wider">Retention</p>
          <p className="text-sm font-bold text-gray-800">{policy.retention_days} days</p>
        </div>
        <div className="bg-gray-50 rounded-xl px-3 py-2">
          <p className="text-[10px] text-gray-400 uppercase tracking-wider">Legal Basis</p>
          <p className="text-sm font-medium text-gray-700">{LEGAL_BASIS_LABELS[policy.legal_basis] ?? policy.legal_basis}</p>
        </div>
        {isPublished && policy.expires_at && (
          <div className="bg-gray-50 rounded-xl px-3 py-2">
            <p className="text-[10px] text-gray-400 uppercase tracking-wider">Expires</p>
            <p className={`text-sm font-bold ${expired ? 'text-red-600' : nearExpiry ? 'text-amber-600' : 'text-gray-800'}`}>
              {fmtDate(policy.expires_at)}
            </p>
          </div>
        )}
        {isPublished && policy.published_at && (
          <div className="bg-gray-50 rounded-xl px-3 py-2">
            <p className="text-[10px] text-gray-400 uppercase tracking-wider">Published</p>
            <p className="text-sm text-gray-700">{fmtDate(policy.published_at)} by {policy.published_by_name ?? '—'}</p>
          </div>
        )}
      </div>

      {/* Data categories */}
      <div className="flex flex-wrap gap-1.5">
        {policy.data_categories.map(c => (
          <span key={c} className="text-xs px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full border border-blue-100">
            {c.replace(/_/g, ' ')}
          </span>
        ))}
        {policy.third_party_transfers && (
          <span className="text-xs px-2 py-0.5 bg-orange-50 text-orange-700 rounded-full border border-orange-100">
            3rd party transfers
          </span>
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

function DataPrivacyPolicies() {
  const isAdmin      = useIsTenantAdmin();
  const isPolicyAdm  = useIsPolicyAdmin();
  // Backend (governance.ts isPolicyAdmin()) already treats tenant_admin as an
  // implicit bypass for governance actions — the frontend was out of sync,
  // hiding the edit/create controls from tenant_admin even though the API
  // would have accepted the request. Fixed 2026-07-21.
  const canEdit      = isPolicyAdm || isAdmin;
  const qc           = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing]       = useState<RetentionPolicy | undefined>(undefined);

  const { data: policies = [], isLoading } = useQuery<RetentionPolicy[]>({
    queryKey: ['retention-policies'],
    queryFn:  () => api.get('/api/v1/governance/retention-policies').then(r => r.data.data),
  });

  const hasPublished = policies.some(p => p.policy_status === 'published');

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Page header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-brand-50 border border-brand-100">
            <BookOpen className="w-5 h-5 text-brand-600" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Data & Privacy Policies</h1>
            <p className="text-sm text-gray-500 mt-0.5">GDPR Record of Processing Activities — voice recording retention</p>
          </div>
        </div>
        {canEdit && (
          <button onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold bg-brand-600 text-white hover:bg-brand-700">
            <Plus className="w-4 h-4" /> New Policy
          </button>
        )}
      </div>

      {/* GDPR requirement notice */}
      <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 flex gap-3">
        <Shield className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-blue-800">GDPR Article 30 — Record of Processing Activities</p>
          <p className="text-sm text-blue-700 mt-1">
            Organisations that record calls must document <strong>why</strong> they store recordings, <strong>how long</strong> they keep them,
            and <strong>who can access them</strong>. This policy must be <strong>published</strong> before call recordings are retained.
            {!hasPublished && (
              <span className="block mt-1 font-semibold text-blue-900">
                ⚠️ No published policy exists. Recording storage is not currently governed.
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Policy list */}
      {isLoading && (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-brand-400" />
        </div>
      )}
      {!isLoading && policies.length === 0 && (
        <div className="text-center py-12 bg-white rounded-2xl border border-dashed border-gray-200">
          <BookOpen className="w-10 h-10 mx-auto text-gray-200 mb-3" />
          <p className="text-gray-500 font-medium">No retention policies yet</p>
          <p className="text-sm text-gray-400 mt-1 mb-4">Create one to document how long call recordings are kept</p>
          {canEdit && (
            <button onClick={() => setShowCreate(true)}
              className="px-4 py-2 rounded-xl text-sm font-semibold bg-brand-600 text-white hover:bg-brand-700">
              Create First Policy
            </button>
          )}
        </div>
      )}
      {!isLoading && policies.length > 0 && (
        <div className="space-y-4">
          {policies.map(p => (
            <PolicyCard key={p.id} policy={p} canEdit={canEdit} onEdit={() => setEditing(p)} />
          ))}
        </div>
      )}

      {/* Link to Orders */}
      <div className="bg-gray-50 rounded-2xl border border-gray-100 p-4 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-800">Need to extend your retention period?</p>
          <p className="text-sm text-gray-500">Place a Storage Extension order — super admin approves once payment is confirmed.</p>
        </div>
        <Link to="/orders"
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold bg-white border border-gray-200 text-gray-700 hover:bg-gray-100 shrink-0 ml-4">
          <ExternalLink className="w-3.5 h-3.5" /> Go to Orders
        </Link>
      </div>

      {/* Modals */}
      {showCreate && <PolicyModal onClose={() => setShowCreate(false)} />}
      {editing    && <PolicyModal policy={editing} onClose={() => setEditing(undefined)} />}
    </div>
  );
}

// ── Governance Hub ──────────────────────────────────────────────────────────
// Consolidates every governance-related area — Data & Privacy Policies, SLA
// Policies, and Milestones — into one page with one sidebar entry, instead of
// three scattered locations (two separate sidebar links + a tab buried inside
// General Settings). Governance is a role (policy_admin), not a set of
// unrelated features, so it should live in one place. Every tab keeps working
// exactly as it did standalone — this is a navigation consolidation only, not
// a rewrite of any of the three areas. Moved 2026-07-21.
const GOV_TABS = [
  { id: 'privacy',    label: 'Data & Privacy', icon: BookOpen },
  { id: 'sla',        label: 'SLA Policies',   icon: Clock    },
  { id: 'milestones', label: 'Milestones',     icon: Layers   },
] as const;

export function GovernanceHub() {
  const [tab, setTab] = useState<typeof GOV_TABS[number]['id']>('privacy');

  return (
    <div className="flex h-full">
      <div className="w-52 border-r border-gray-100 p-3 space-y-0.5 shrink-0">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-3 mb-3">Governance</p>
        {GOV_TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors text-left ${
              tab === id ? 'bg-brand-50 text-brand-700 font-medium' : 'text-gray-600 hover:bg-gray-50'
            }`}>
            <Icon className="w-4 h-4 shrink-0" />
            {label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto">
        {tab === 'privacy'    && <DataPrivacyPolicies />}
        {tab === 'sla'        && <TicketSla />}
        {tab === 'milestones' && <MilestoneSettings />}
      </div>
    </div>
  );
}
