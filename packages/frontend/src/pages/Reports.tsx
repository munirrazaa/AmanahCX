/**
 * Reports Hub — downloadable reports for managers and agents
 *
 * Manager reports: Ticket Volume, SLA Performance, Agent Performance,
 *                  CSAT Survey, Issue Categories, Ticket Backlog
 * Agent reports:   My Tickets, My Activity Log, My SLA Performance
 *
 * All reports generate CSV files client-side from existing API data.
 */

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Download, FileSpreadsheet, BarChart3, ShieldAlert,
  Users, Star, Tag, Inbox, Activity, Clock,
  CheckCircle2, AlertTriangle, Loader2, Calendar,
  ChevronDown, TrendingUp, Ticket, Phone,
} from 'lucide-react';
import { api } from '../services/api';
import { useAuthStore } from '../store/auth.store';
import { useHasRole, useIsSuperAdmin, useIsTenantAdmin } from '../hooks/useRole';

// ── brand ─────────────────────────────────────────────────────────────────────
const C = { cyan: '#29ABE2', green: '#4D8B3C', gold: '#F5C518', red: '#ef4444', orange: '#f97316', purple: '#8b5cf6' };

// ── CSV helpers ───────────────────────────────────────────────────────────────
function toCSV(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const escape  = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(','), ...rows.map(r => headers.map(h => escape(r[h])).join(','))].join('\n');
}

function downloadCSV(filename: string, rows: Record<string, unknown>[]) {
  const blob = new Blob([toCSV(rows)], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function fmt(d: string | null | undefined) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtNum(n: unknown, decimals = 1) {
  const v = parseFloat(String(n ?? 0));
  return isNaN(v) ? '' : v.toFixed(decimals);
}

// ── period selector ───────────────────────────────────────────────────────────
const PERIODS = [
  { label: 'Last 7 days',   days: 7   },
  { label: 'Last 30 days',  days: 30  },
  { label: 'Last 90 days',  days: 90  },
  { label: 'Last 6 months', days: 180 },
];

function PeriodSelect({ value, onChange }: { value: number; onChange: (d: number) => void }) {
  const [open, setOpen] = useState(false);
  const cur = PERIODS.find(p => p.days === value) ?? PERIODS[1];
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-3 py-1.5 text-xs border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 bg-white"
      >
        <Calendar className="w-3.5 h-3.5 text-gray-400" />
        {cur.label}
        <ChevronDown className="w-3 h-3 text-gray-400" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-20 py-1 min-w-[140px]">
          {PERIODS.map(p => (
            <button key={p.days}
              onClick={() => { onChange(p.days); setOpen(false); }}
              className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-50 ${p.days === value ? 'font-semibold text-blue-600' : 'text-gray-700'}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── report card shell ─────────────────────────────────────────────────────────
function ReportCard({
  icon: Icon, iconColor, title, description, columns, badge,
  loading, onDownload, children,
}: {
  icon: React.ElementType; iconColor: string;
  title: string; description: string; columns: string[];
  badge?: string; loading?: boolean;
  onDownload: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm flex flex-col">
      <div className="p-5 border-b border-gray-50">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${iconColor}15` }}>
              <Icon className="w-5 h-5" style={{ color: iconColor }} />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 text-sm">{title}</h3>
              {badge && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide"
                  style={{ background: `${iconColor}15`, color: iconColor }}>{badge}</span>
              )}
            </div>
          </div>
          <button
            onClick={onDownload}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-white transition-all hover:opacity-90 disabled:opacity-50 shrink-0"
            style={{ background: `linear-gradient(135deg, ${iconColor}, ${iconColor}cc)` }}
          >
            {loading
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <Download className="w-3.5 h-3.5" />}
            {loading ? 'Generating…' : 'Download CSV'}
          </button>
        </div>
        <p className="text-xs text-gray-500">{description}</p>
      </div>

      {/* Columns preview */}
      <div className="px-5 py-3 bg-gray-50/60 border-b border-gray-50">
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Columns included</p>
        <div className="flex flex-wrap gap-1.5">
          {columns.map(col => (
            <span key={col} className="text-[10px] bg-white border border-gray-200 text-gray-600 px-2 py-0.5 rounded-md font-medium">
              {col}
            </span>
          ))}
        </div>
      </div>

      {/* Live preview */}
      {children && (
        <div className="p-5 flex-1">{children}</div>
      )}
    </div>
  );
}

// ── mini stat ─────────────────────────────────────────────────────────────────
function Mini({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="text-center rounded-xl p-3" style={{ background: `${color}10` }}>
      <p className="text-lg font-bold" style={{ color }}>{value}</p>
      <p className="text-[10px] text-gray-500 font-medium mt-0.5">{label}</p>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MANAGER REPORTS
// ══════════════════════════════════════════════════════════════════════════════

function TicketVolumeReport({ days }: { days: number }) {
  const [loading, setLoading] = useState(false);
  const { data } = useQuery({
    queryKey: ['report-trends', days],
    queryFn: () => api.get('/api/v1/tickets/analytics/trends', { params: { days, period: 'day' } }).then(r => r.data.data ?? []),
    staleTime: 60_000,
  });
  const rows: any[] = data ?? [];
  const total    = rows.reduce((s, r) => s + Number(r.total    ?? 0), 0);
  const resolved = rows.reduce((s, r) => s + Number(r.resolved ?? 0), 0);
  const breached = rows.reduce((s, r) => s + Number(r.sla_breached ?? 0), 0);

  const handleDownload = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/v1/tickets/analytics/trends', { params: { days, period: 'day' } });
      const csvRows = (res.data.data ?? []).map((r: any) => ({
        'Date':           fmt(r.period),
        'Total Tickets':  r.total       ?? 0,
        'Resolved':       r.resolved    ?? 0,
        'SLA Breached':   r.sla_breached ?? 0,
        'Urgent':         r.urgent  ?? 0,
        'High':           r.high    ?? 0,
        'Medium':         r.medium  ?? 0,
        'Low':            r.low     ?? 0,
        'Via Voice Bot':  r.via_voice  ?? 0,
        'Via Email':      r.via_email  ?? 0,
        'Via Manual':     r.via_manual ?? 0,
      }));
      downloadCSV(`ticket-volume-${days}d-${new Date().toISOString().slice(0,10)}.csv`, csvRows);
    } finally { setLoading(false); }
  };

  return (
    <ReportCard
      icon={BarChart3} iconColor={C.cyan}
      title="Ticket Volume Report"
      description="Daily ticket counts broken down by resolution status, priority, and inbound channel."
      columns={['Date','Total Tickets','Resolved','SLA Breached','Urgent','High','Medium','Low','Via Voice Bot','Via Email','Via Manual']}
      badge="Manager"
      loading={loading}
      onDownload={handleDownload}
    >
      <div className="grid grid-cols-3 gap-2">
        <Mini label="Total Tickets" value={total}    color={C.cyan}   />
        <Mini label="Resolved"      value={resolved} color={C.green}  />
        <Mini label="SLA Breached"  value={breached} color={breached > 0 ? C.red : C.green} />
      </div>
    </ReportCard>
  );
}

function SlaPerformanceReport({ days }: { days: number }) {
  const [loading, setLoading] = useState(false);
  const { data } = useQuery({
    queryKey: ['report-resolution', days],
    queryFn: () => api.get('/api/v1/tickets/analytics/resolution', { params: { days, period: 'week' } }).then(r => r.data.data ?? []),
    staleTime: 60_000,
  });
  const rows: any[] = data ?? [];
  const validSla  = rows.filter(r => r.sla_compliance_pct != null);
  const avgSla    = validSla.length ? (validSla.reduce((s, r) => s + Number(r.sla_compliance_pct), 0) / validSla.length).toFixed(1) : '—';
  const validRes  = rows.filter(r => r.avg_resolution_hrs != null);
  const avgRes    = validRes.length ? (validRes.reduce((s, r) => s + Number(r.avg_resolution_hrs), 0) / validRes.length).toFixed(1) : '—';

  const handleDownload = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/v1/tickets/analytics/resolution', { params: { days, period: 'week' } });
      const csvRows = (res.data.data ?? []).map((r: any) => ({
        'Period':                fmt(r.period),
        'Total Tickets':         r.total    ?? 0,
        'Resolved':              r.resolved ?? 0,
        'SLA Compliance %':      fmtNum(r.sla_compliance_pct),
        'Avg Resolution (hrs)':  fmtNum(r.avg_resolution_hrs),
        'Avg First Response (hrs)': fmtNum(r.avg_first_response_hrs),
        'Escalation Rate %':     fmtNum(r.escalation_rate_pct),
      }));
      downloadCSV(`sla-performance-${days}d-${new Date().toISOString().slice(0,10)}.csv`, csvRows);
    } finally { setLoading(false); }
  };

  return (
    <ReportCard
      icon={ShieldAlert} iconColor={C.green}
      title="SLA Performance Report"
      description="Weekly SLA compliance rate, average resolution time, first response time, and escalation rate."
      columns={['Period','Total Tickets','Resolved','SLA Compliance %','Avg Resolution (hrs)','Avg First Response (hrs)','Escalation Rate %']}
      badge="Manager"
      loading={loading}
      onDownload={handleDownload}
    >
      <div className="grid grid-cols-2 gap-2">
        <Mini label="Avg SLA Compliance" value={avgSla === '—' ? '—' : `${avgSla}%`} color={parseFloat(avgSla) >= 80 ? C.green : C.orange} />
        <Mini label="Avg Resolution"     value={avgRes === '—' ? '—' : `${avgRes}h`} color={C.cyan} />
      </div>
    </ReportCard>
  );
}

function AgentPerformanceReport({ days }: { days: number }) {
  const [loading, setLoading] = useState(false);
  const { data } = useQuery({
    queryKey: ['report-team'],
    queryFn: () => api.get('/api/v1/tickets/dashboard/team').then(r => r.data.data),
    staleTime: 60_000,
  });
  const agents: any[] = data?.agents ?? [];

  const handleDownload = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/v1/tickets/dashboard/team');
      const csvRows = (res.data.data?.agents ?? []).map((a: any) => ({
        'Agent Name':          a.name        ?? '',
        'Email':               a.email       ?? '',
        'Department':          a.department  ?? '',
        'Active':              a.is_active ? 'Yes' : 'No',
        'Assigned Tickets':    a.assigned     ?? 0,
        'Accepted':            a.accepted     ?? 0,
        'Pending':             a.pending      ?? 0,
        'Resolved':            a.resolved     ?? 0,
        'Within SLA':          a.within_tat   ?? 0,
        'Approaching SLA':     a.approaching_tat ?? 0,
        'Breached SLA':        a.breached_tat    ?? 0,
        'Calls Today':         a.calls_today     ?? 0,
        'Avg Call Duration (s)': a.avg_call_duration ?? 0,
        'Activities Today':    a.activities_today ?? 0,
        'Avg Sentiment':       a.avg_sentiment    ?? '',
      }));
      downloadCSV(`agent-performance-${new Date().toISOString().slice(0,10)}.csv`, csvRows);
    } finally { setLoading(false); }
  };

  return (
    <ReportCard
      icon={Users} iconColor={C.purple}
      title="Agent Performance Report"
      description="Per-agent breakdown of ticket counts, SLA compliance, call handling, and sentiment scores."
      columns={['Agent Name','Email','Department','Active','Assigned','Accepted','Resolved','Within SLA','Breached SLA','Calls Today','Avg Sentiment']}
      badge="Manager"
      loading={loading}
      onDownload={handleDownload}
    >
      {agents.length > 0 ? (
        <div className="space-y-2">
          {agents.slice(0, 4).map((a: any) => (
            <div key={a.id} className="flex items-center gap-3 py-1.5 border-b border-gray-50 last:border-0">
              <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0"
                   style={{ background: `linear-gradient(135deg,${C.cyan},${C.green})` }}>
                {a.name?.[0]?.toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-gray-800 truncate">{a.name}</p>
                <p className="text-[10px] text-gray-400 capitalize">{a.department ?? 'No dept'}</p>
              </div>
              <div className="flex gap-3 text-[10px] text-gray-500 shrink-0">
                <span className="text-emerald-600 font-semibold">{a.resolved ?? 0} resolved</span>
                {Number(a.breached_tat) > 0 && <span className="text-red-500 font-semibold">{a.breached_tat} breached</span>}
              </div>
            </div>
          ))}
          {agents.length > 4 && <p className="text-[10px] text-gray-400 pt-1">+{agents.length - 4} more agents in download</p>}
        </div>
      ) : (
        <p className="text-xs text-gray-400 text-center py-4">No agent data available</p>
      )}
    </ReportCard>
  );
}

function CsatReport({ days }: { days: number }) {
  const [loading, setLoading] = useState(false);
  const { data: summary } = useQuery({
    queryKey: ['report-csat-summary'],
    queryFn: () => api.get('/api/v1/tickets/csat/summary').then(r => r.data.data),
    staleTime: 60_000,
  });

  const handleDownload = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/v1/tickets/csat');
      const csvRows = (res.data.data ?? []).map((c: any) => ({
        'Date':           fmt(c.responded_at ?? c.sent_at),
        'Ticket #':       c.ticket_number ?? '',
        'Subject':        c.subject       ?? '',
        'Reporter Email': c.reporter_email ?? '',
        'Assigned Agent': c.assignee_name ?? '',
        'Rating (1-5)':   c.rating         ?? '',
        'Comment':        c.comment        ?? '',
        'Survey Sent':    fmt(c.sent_at),
        'Responded At':   fmt(c.responded_at),
      }));
      downloadCSV(`csat-survey-${new Date().toISOString().slice(0,10)}.csv`, csvRows);
    } finally { setLoading(false); }
  };

  const stars = ['5★','4★','3★','2★','1★'];

  return (
    <ReportCard
      icon={Star} iconColor={C.gold}
      title="CSAT Survey Report"
      description="All customer satisfaction survey responses with ratings, comments, and linked ticket details."
      columns={['Date','Ticket #','Subject','Reporter Email','Assigned Agent','Rating (1-5)','Comment','Survey Sent','Responded At']}
      badge="Manager"
      loading={loading}
      onDownload={handleDownload}
    >
      {summary ? (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <Mini label="Avg Rating"       value={summary.avg_rating     ? `${summary.avg_rating}/5`   : '—'} color={C.gold}  />
            <Mini label="Total Responses"  value={summary.total_responses ?? 0}                               color={C.cyan}  />
            <Mini label="Response Rate"    value={summary.response_rate   ? `${summary.response_rate}%` : '—'} color={C.green} />
          </div>
          {summary.distribution && (
            <div className="space-y-1.5">
              {stars.map((s, i) => {
                const rating = 5 - i;
                const count  = summary.distribution[rating] ?? 0;
                const total  = summary.total_responses ?? 0;
                const w      = total > 0 ? Math.round((count / total) * 100) : 0;
                return (
                  <div key={rating} className="flex items-center gap-2 text-[10px]">
                    <span className="text-gray-500 w-5 text-right font-medium">{s}</span>
                    <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${w}%`, background: C.gold }} />
                    </div>
                    <span className="text-gray-400 w-6 text-right">{count}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <p className="text-xs text-gray-400 text-center py-4">No CSAT responses yet</p>
      )}
    </ReportCard>
  );
}

function IssueCategoriesReport({ days }: { days: number }) {
  const [loading, setLoading] = useState(false);
  const { data } = useQuery({
    queryKey: ['report-heatmap', days],
    queryFn: () => api.get('/api/v1/tickets/analytics/heatmap', { params: { days, topN: 20 } }).then(r => r.data.data),
    staleTime: 60_000,
  });
  const tags: any[] = data?.topTags ?? [];

  const handleDownload = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/v1/tickets/analytics/heatmap', { params: { days, topN: 50 } });
      const d   = res.data.data ?? {};
      const tagRows = (d.topTags ?? []).map((t: any) => ({
        'Category / Tag':          t.tag             ?? '',
        'Total Tickets':           t.total           ?? 0,
        'Resolved':                t.resolved        ?? 0,
        'SLA Breached':            t.sla_breached    ?? 0,
        'Avg Resolution (hrs)':    fmtNum(t.avg_resolution_hrs),
        'Breach Rate %':           t.total > 0 ? fmtNum((t.sla_breached / t.total) * 100) : '0.0',
      }));
      downloadCSV(`issue-categories-${days}d-${new Date().toISOString().slice(0,10)}.csv`, tagRows);
    } finally { setLoading(false); }
  };

  return (
    <ReportCard
      icon={Tag} iconColor={C.orange}
      title="Issue Categories Report"
      description="Top recurring ticket tags/categories by volume with average resolution time and SLA breach rate."
      columns={['Category / Tag','Total Tickets','Resolved','SLA Breached','Avg Resolution (hrs)','Breach Rate %']}
      badge="Manager"
      loading={loading}
      onDownload={handleDownload}
    >
      {tags.length > 0 ? (
        <div className="space-y-2">
          {tags.slice(0, 6).map((t: any) => {
            const pct = t.total > 0 ? Math.round((Number(t.sla_breached) / Number(t.total)) * 100) : 0;
            return (
              <div key={t.tag} className="flex items-center justify-between gap-2">
                <span className="text-xs text-gray-700 capitalize truncate">{t.tag}</span>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs font-semibold text-gray-700 w-6 text-right">{t.total}</span>
                  {pct > 0 && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-50 text-red-600">{pct}% breach</span>
                  )}
                </div>
              </div>
            );
          })}
          {tags.length > 6 && <p className="text-[10px] text-gray-400">+{tags.length - 6} more in download</p>}
        </div>
      ) : (
        <p className="text-xs text-gray-400 text-center py-4">No category data yet</p>
      )}
    </ReportCard>
  );
}

function TicketBacklogReport({ days }: { days: number }) {
  const [loading, setLoading] = useState(false);
  const { data } = useQuery({
    queryKey: ['report-backlog'],
    queryFn: () =>
      api.get('/api/v1/tickets', { params: { limit: 10, page: 1 } }).then(r => ({
        tickets: r.data.data ?? [],
        total:   r.data.meta?.total ?? 0,
      })),
    staleTime: 60_000,
  });
  const preview: any[] = data?.tickets ?? [];
  const total          = data?.total   ?? 0;

  const handleDownload = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/v1/tickets', { params: { limit: 500, page: 1 } });
      const csvRows = (res.data.data ?? []).map((t: any) => {
        const created  = t.created_at ? new Date(t.created_at) : null;
        const ageHrs   = created ? Math.round((Date.now() - created.getTime()) / 3_600_000) : '';
        const slaDue   = t.sla_due_at ? new Date(t.sla_due_at) : null;
        const slaStatus = !slaDue ? 'No SLA' : slaDue < new Date() && !['resolved','closed'].includes(t.status) ? 'Breached' : 'Active';
        return {
          'Ticket #':        t.ticket_number   ?? '',
          'Subject':         t.subject         ?? '',
          'Status':          t.status          ?? '',
          'Priority':        t.priority        ?? '',
          'Type':            t.ticket_type     ?? '',
          'Channel':         t.channel         ?? '',
          'Reporter':        t.reporter_email  ?? '',
          'Assigned To':     t.assignee_name   ?? 'Unassigned',
          'Created':         fmt(t.created_at),
          'Age (hrs)':       ageHrs,
          'SLA Due':         fmt(t.sla_due_at),
          'SLA Status':      slaStatus,
        };
      });
      downloadCSV(`ticket-backlog-${new Date().toISOString().slice(0,10)}.csv`, csvRows);
    } finally { setLoading(false); }
  };

  return (
    <ReportCard
      icon={Inbox} iconColor={C.red}
      title="Ticket Backlog Report"
      description="All open tickets with age, SLA deadline, priority, channel, and assignee. Use to identify aged or at-risk tickets."
      columns={['Ticket #','Subject','Status','Priority','Type','Channel','Reporter','Assigned To','Created','Age (hrs)','SLA Due','SLA Status']}
      badge="Manager"
      loading={loading}
      onDownload={handleDownload}
    >
      <div className="space-y-2">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-semibold text-gray-700">{total} open tickets</span>
          {preview.filter((t: any) => t.sla_due_at && new Date(t.sla_due_at) < new Date() && !['resolved','closed'].includes(t.status)).length > 0 && (
            <span className="text-[10px] font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded-full flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              {preview.filter((t: any) => t.sla_due_at && new Date(t.sla_due_at) < new Date() && !['resolved','closed'].includes(t.status)).length} breached
            </span>
          )}
        </div>
        {preview.slice(0, 4).map((t: any) => {
          const breached = t.sla_due_at && new Date(t.sla_due_at) < new Date() && !['resolved','closed'].includes(t.status);
          return (
            <div key={t.id} className="flex items-center gap-2">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${t.priority === 'urgent' ? 'bg-red-500' : t.priority === 'high' ? 'bg-orange-400' : t.priority === 'medium' ? 'bg-yellow-400' : 'bg-gray-300'}`} />
              <span className="text-[10px] font-mono text-gray-400 shrink-0">{t.ticket_number}</span>
              <span className="text-xs text-gray-700 truncate flex-1">{t.subject}</span>
              {breached && <span className="text-[10px] text-red-500 font-bold shrink-0">⚡ SLA</span>}
            </div>
          );
        })}
      </div>
    </ReportCard>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// AGENT REPORTS
// ══════════════════════════════════════════════════════════════════════════════

function MyTicketsReport({ days }: { days: number }) {
  const [loading, setLoading] = useState(false);
  const { data } = useQuery({
    queryKey: ['report-my-tickets'],
    queryFn: () =>
      api.get('/api/v1/tickets', { params: { limit: 10, page: 1 } }).then(r => ({
        tickets: r.data.data ?? [],
        total:   r.data.meta?.total ?? 0,
      })),
    staleTime: 60_000,
  });
  const preview: any[] = data?.tickets ?? [];
  const total          = data?.total   ?? 0;

  const handleDownload = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/v1/tickets', { params: { limit: 500, page: 1 } });
      const csvRows = (res.data.data ?? []).map((t: any) => ({
        'Ticket #':       t.ticket_number  ?? '',
        'Subject':        t.subject        ?? '',
        'Status':         t.status         ?? '',
        'Priority':       t.priority       ?? '',
        'Type':           t.ticket_type    ?? '',
        'Channel':        t.channel        ?? '',
        'Reporter':       t.reporter_email ?? '',
        'Created':        fmt(t.created_at),
        'SLA Due':        fmt(t.sla_due_at),
        'Resolved At':    fmt(t.resolved_at),
      }));
      downloadCSV(`my-tickets-${new Date().toISOString().slice(0,10)}.csv`, csvRows);
    } finally { setLoading(false); }
  };

  return (
    <ReportCard
      icon={Ticket} iconColor={C.cyan}
      title="My Ticket Report"
      description="All tickets assigned to or created by you, with status, priority, channel, and SLA deadline."
      columns={['Ticket #','Subject','Status','Priority','Type','Channel','Reporter','Created','SLA Due','Resolved At']}
      badge="Agent"
      loading={loading}
      onDownload={handleDownload}
    >
      <div className="space-y-2">
        <p className="text-xs font-semibold text-gray-600 mb-2">{total} tickets in your queue</p>
        {preview.slice(0, 4).map((t: any) => (
          <div key={t.id} className="flex items-center gap-2">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${t.priority === 'urgent' ? 'bg-red-500' : t.priority === 'high' ? 'bg-orange-400' : 'bg-gray-300'}`} />
            <span className="text-xs text-gray-700 truncate flex-1">{t.subject}</span>
            <span className="text-[10px] text-gray-400 capitalize shrink-0">{t.status?.replace('_',' ')}</span>
          </div>
        ))}
      </div>
    </ReportCard>
  );
}

function MyActivitiesReport({ days }: { days: number }) {
  const [loading, setLoading] = useState(false);
  const { data } = useQuery({
    queryKey: ['report-my-activities'],
    queryFn: () =>
      api.get('/api/v1/activities', { params: { limit: 10 } }).then(r => r.data.data ?? []),
    staleTime: 60_000,
  });
  const preview: any[] = Array.isArray(data) ? data : [];

  const handleDownload = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/v1/activities', { params: { limit: 500 } });
      const csvRows = (res.data.data ?? []).map((a: any) => ({
        'Date':         fmt(a.created_at),
        'Type':         a.type     ?? '',
        'Subject':      a.subject  ?? '',
        'Status':       a.status   ?? '',
        'Contact':      a.contact_name ?? '',
        'Due At':       fmt(a.due_at),
        'Completed At': fmt(a.completed_at),
        'Notes':        a.notes    ?? '',
      }));
      downloadCSV(`my-activities-${new Date().toISOString().slice(0,10)}.csv`, csvRows);
    } finally { setLoading(false); }
  };

  return (
    <ReportCard
      icon={Activity} iconColor={C.green}
      title="My Activity Log"
      description="All CRM activities you have logged — calls, emails, meetings, tasks, and notes."
      columns={['Date','Type','Subject','Status','Contact','Due At','Completed At','Notes']}
      badge="Agent"
      loading={loading}
      onDownload={handleDownload}
    >
      <div className="space-y-2">
        {preview.length === 0
          ? <p className="text-xs text-gray-400 text-center py-4">No activities logged yet</p>
          : preview.slice(0, 4).map((a: any) => (
              <div key={a.id} className="flex items-center gap-2">
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md uppercase capitalize"
                      style={{ background: `${C.green}15`, color: C.green }}>{a.type}</span>
                <span className="text-xs text-gray-700 truncate flex-1">{a.subject}</span>
                <span className="text-[10px] text-gray-400 capitalize">{a.status}</span>
              </div>
            ))
        }
      </div>
    </ReportCard>
  );
}

function MySlaReport({ days }: { days: number }) {
  const [loading, setLoading] = useState(false);
  const { data } = useQuery({
    queryKey: ['report-my-sla', days],
    queryFn: () =>
      api.get('/api/v1/tickets/analytics/resolution', { params: { days, period: 'week' } }).then(r => r.data.data ?? []),
    staleTime: 60_000,
  });
  const rows: any[] = Array.isArray(data) ? data : [];
  const validSla    = rows.filter(r => r.sla_compliance_pct != null);
  const avgSla      = validSla.length
    ? (validSla.reduce((s, r) => s + Number(r.sla_compliance_pct), 0) / validSla.length).toFixed(1)
    : null;
  const validRes    = rows.filter(r => r.avg_resolution_hrs != null);
  const avgRes      = validRes.length
    ? (validRes.reduce((s, r) => s + Number(r.avg_resolution_hrs), 0) / validRes.length).toFixed(1)
    : null;
  const validFR     = rows.filter(r => r.avg_first_response_hrs != null);
  const avgFR       = validFR.length
    ? (validFR.reduce((s, r) => s + Number(r.avg_first_response_hrs), 0) / validFR.length).toFixed(2)
    : null;

  const handleDownload = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/v1/tickets/analytics/resolution', { params: { days, period: 'week' } });
      const csvRows = (res.data.data ?? []).map((r: any) => ({
        'Period':                    fmt(r.period),
        'Total Tickets':             r.total    ?? 0,
        'Resolved':                  r.resolved ?? 0,
        'SLA Compliance %':          fmtNum(r.sla_compliance_pct),
        'Avg Resolution Time (hrs)': fmtNum(r.avg_resolution_hrs),
        'Avg First Response (hrs)':  fmtNum(r.avg_first_response_hrs),
        'Escalation Rate %':         fmtNum(r.escalation_rate_pct),
      }));
      downloadCSV(`my-sla-performance-${days}d-${new Date().toISOString().slice(0,10)}.csv`, csvRows);
    } finally { setLoading(false); }
  };

  return (
    <ReportCard
      icon={Clock} iconColor={C.purple}
      title="My SLA Performance"
      description="Your personal SLA compliance rate, average resolution time, and first response time over the selected period."
      columns={['Period','Total Tickets','Resolved','SLA Compliance %','Avg Resolution (hrs)','Avg First Response (hrs)','Escalation Rate %']}
      badge="Agent"
      loading={loading}
      onDownload={handleDownload}
    >
      <div className="grid grid-cols-3 gap-2">
        <Mini label="SLA Compliance" value={avgSla ? `${avgSla}%` : '—'} color={avgSla && parseFloat(avgSla) >= 80 ? C.green : C.orange} />
        <Mini label="Avg Resolution" value={avgRes ? `${avgRes}h` : '—'} color={C.cyan} />
        <Mini label="Avg 1st Reply"
          value={avgFR
            ? parseFloat(avgFR) < 1 ? `${Math.round(parseFloat(avgFR) * 60)}m` : `${avgFR}h`
            : '—'}
          color={C.purple} />
      </div>
    </ReportCard>
  );
}

function MyCallsReport({ days }: { days: number }) {
  const [loading, setLoading] = useState(false);
  const { data: dashData } = useQuery({
    queryKey: ['report-agent-dash'],
    queryFn: () => api.get('/api/v1/analytics/ops-dashboard').then(r => r.data.data),
    staleTime: 60_000,
  });
  const calls     = dashData?.callStats ?? {};
  const today     = Number(calls.calls_today     ?? 0);
  const completed = Number(calls.completed_today ?? 0);
  const dropped   = Number(calls.dropped_today   ?? 0);

  const handleDownload = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/v1/voice/calls', { params: { limit: 500 } }).catch(() => ({ data: { data: [] } }));
      const csvRows = (res.data.data ?? []).map((c: any) => ({
        'Date':           fmt(c.created_at),
        'Duration (s)':   c.duration   ?? 0,
        'Status':         c.status     ?? '',
        'Direction':      c.direction  ?? '',
        'From':           c.from_number ?? '',
        'To':             c.to_number   ?? '',
        'Sentiment':      c.sentiment   ?? '',
        'Bot Handled':    c.is_bot_call ? 'Yes' : 'No',
      }));
      downloadCSV(`my-calls-${new Date().toISOString().slice(0,10)}.csv`, csvRows);
    } finally { setLoading(false); }
  };

  return (
    <ReportCard
      icon={Phone} iconColor={C.cyan}
      title="My Call Log"
      description="All calls you have handled — inbound, outbound, duration, sentiment, and bot-assisted status."
      columns={['Date','Duration (s)','Status','Direction','From','To','Sentiment','Bot Handled']}
      badge="Agent"
      loading={loading}
      onDownload={handleDownload}
    >
      <div className="grid grid-cols-3 gap-2">
        <Mini label="Today's Calls" value={today}     color={C.cyan}  />
        <Mini label="Completed"     value={completed} color={C.green} />
        <Mini label="Missed"        value={dropped}   color={dropped > 0 ? C.red : C.green} />
      </div>
    </ReportCard>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ROOT — Reports Hub
// ══════════════════════════════════════════════════════════════════════════════
export function Reports() {
  const { user }       = useAuthStore();
  const isManager      = useHasRole('manager');
  const isSuperAdmin   = useIsSuperAdmin();
  const isTenantAdmin  = useIsTenantAdmin();

  const [days, setDays] = useState(30);

  const showManagerReports = isManager || isSuperAdmin;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-8 py-6">
        <div className="max-w-[1300px] mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5" style={{ color: C.cyan }} />
              Reports
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Download CSV reports for {showManagerReports ? 'team performance, SLA compliance, CSAT, and more' : 'your tickets, activities, calls, and SLA performance'}
            </p>
          </div>
          <PeriodSelect value={days} onChange={setDays} />
        </div>
      </div>

      <div className="px-8 py-6 max-w-[1300px] mx-auto space-y-8">

        {/* Manager reports */}
        {showManagerReports && (
          <section>
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="w-4 h-4" style={{ color: C.cyan }} />
              <h2 className="text-sm font-bold text-gray-700 uppercase tracking-widest">Team & Operations Reports</h2>
              <span className="text-[10px] bg-blue-50 text-blue-600 font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ml-1">Manager</span>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
              <TicketVolumeReport    days={days} />
              <SlaPerformanceReport  days={days} />
              <AgentPerformanceReport days={days} />
              <CsatReport            days={days} />
              <IssueCategoriesReport days={days} />
              <TicketBacklogReport   days={days} />
            </div>
          </section>
        )}

        {/* Agent reports */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <CheckCircle2 className="w-4 h-4" style={{ color: C.green }} />
            <h2 className="text-sm font-bold text-gray-700 uppercase tracking-widest">My Personal Reports</h2>
            <span className="text-[10px] bg-emerald-50 text-emerald-600 font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ml-1">Agent</span>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-2 gap-4">
            <MyTicketsReport    days={days} />
            <MyActivitiesReport days={days} />
            <MySlaReport        days={days} />
            <MyCallsReport      days={days} />
          </div>
        </section>

        <div className="h-4" />
      </div>
    </div>
  );
}
