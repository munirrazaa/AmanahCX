import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from 'recharts';
import {
  TicketCheck, Clock, TrendingUp, TrendingDown,
  AlertTriangle, CheckCircle2, BarChart3, Download,
} from 'lucide-react';
import { api } from '../services/api';

// ── Helpers ───────────────────────────────────────────────────────────────────

const PERIODS = [
  { value: '7',  label: 'Last 7 days',  grain: 'day' as const },
  { value: '30', label: 'Last 30 days', grain: 'day' as const },
  { value: '90', label: 'Last 90 days', grain: 'week' as const },
  { value: '180',label: 'Last 6 months',grain: 'month' as const },
];

const PRIORITY_COLORS: Record<string, string> = {
  urgent: '#EF4444',
  high:   '#F97316',
  medium: '#EAB308',
  low:    '#22C55E',
};

const CHANNEL_COLORS = ['#6366F1', '#22C55E', '#F97316', '#EC4899', '#14B8A6'];

function fmtHrs(hrs: number | null | undefined): string {
  if (hrs == null || isNaN(hrs)) return '—';
  if (hrs < 1) return `${Math.round(hrs * 60)}m`;
  return `${hrs.toFixed(1)}h`;
}

function fmtPct(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return '—';
  return `${v.toFixed(1)}%`;
}

function fmtDate(iso: string, grain: string): string {
  const d = new Date(iso);
  if (grain === 'month') return d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
  if (grain === 'week')  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// ── KPI card ─────────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, icon: Icon, color = 'text-gray-900', bg = 'bg-white' }: {
  label: string; value: string; sub?: string;
  icon: React.ElementType; color?: string; bg?: string;
}) {
  return (
    <div className={`${bg} border border-gray-100 rounded-xl p-5 flex items-start gap-4`}>
      <div className="rounded-lg bg-indigo-50 p-2.5 shrink-0">
        <Icon className="w-5 h-5 text-indigo-500" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-gray-400 font-medium">{label}</p>
        <p className={`text-2xl font-bold mt-0.5 ${color}`}>{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({ title, children, action }: {
  title: string; children: React.ReactNode; action?: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
        {action}
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function TicketReports() {
  const [periodIdx, setPeriodIdx] = useState(1); // default: last 30 days
  const period = PERIODS[periodIdx];

  // ── Data fetches ───────────────────────────────────────────────────────────

  const trendsQ = useQuery({
    queryKey: ['ticket-trends', period.value, period.grain],
    queryFn: () =>
      api.get('/api/v1/tickets/analytics/trends', {
        params: { days: period.value, period: period.grain },
      }).then(r => r.data.data ?? []),
  });

  const resolutionQ = useQuery({
    queryKey: ['ticket-resolution', period.value, period.grain],
    queryFn: () =>
      api.get('/api/v1/tickets/analytics/resolution', {
        params: { days: period.value, period: period.grain },
      }).then(r => r.data.data ?? []),
  });

  const heatmapQ = useQuery({
    queryKey: ['ticket-heatmap', period.value],
    queryFn: () =>
      api.get('/api/v1/tickets/analytics/heatmap', {
        params: { days: period.value },
      }).then(r => r.data.data ?? {}),
  });

  // ── Derived KPIs ───────────────────────────────────────────────────────────

  const kpis = useMemo(() => {
    const trends: any[]     = trendsQ.data ?? [];
    const resolution: any[] = resolutionQ.data ?? [];

    const totalTickets  = trends.reduce((s, r) => s + (r.total || 0), 0);
    const totalResolved = trends.reduce((s, r) => s + (r.resolved || 0), 0);
    const totalBreached = trends.reduce((s, r) => s + (r.sla_breached || 0), 0);

    const latestResolved = resolution.filter(r => r.sla_compliance_pct != null);
    const avgSla = latestResolved.length
      ? latestResolved.reduce((s, r) => s + r.sla_compliance_pct, 0) / latestResolved.length
      : null;

    const latestResTime = resolution.filter(r => r.avg_resolution_hrs != null);
    const avgResTime = latestResTime.length
      ? latestResTime.reduce((s, r) => s + r.avg_resolution_hrs, 0) / latestResTime.length
      : null;

    const latestFrt = resolution.filter(r => r.avg_first_response_hrs != null);
    const avgFrt = latestFrt.length
      ? latestFrt.reduce((s, r) => s + r.avg_first_response_hrs, 0) / latestFrt.length
      : null;

    const latestEsc = resolution.filter(r => r.escalation_rate_pct != null);
    const avgEsc = latestEsc.length
      ? latestEsc.reduce((s, r) => s + r.escalation_rate_pct, 0) / latestEsc.length
      : null;

    return { totalTickets, totalResolved, totalBreached, avgSla, avgResTime, avgFrt, avgEsc };
  }, [trendsQ.data, resolutionQ.data]);

  // ── Priority aggregate from trends ─────────────────────────────────────────

  const priorityData = useMemo(() => {
    const trends: any[] = trendsQ.data ?? [];
    return [
      { name: 'Urgent', value: trends.reduce((s, r) => s + (r.urgent || 0), 0), color: PRIORITY_COLORS.urgent },
      { name: 'High',   value: trends.reduce((s, r) => s + (r.high   || 0), 0), color: PRIORITY_COLORS.high   },
      { name: 'Medium', value: trends.reduce((s, r) => s + (r.medium || 0), 0), color: PRIORITY_COLORS.medium },
      { name: 'Low',    value: trends.reduce((s, r) => s + (r.low    || 0), 0), color: PRIORITY_COLORS.low    },
    ].filter(d => d.value > 0);
  }, [trendsQ.data]);

  // ── Channel data from heatmap ──────────────────────────────────────────────

  const channelData = useMemo(() => {
    const ch: any[] = heatmapQ.data?.byChannel ?? [];
    return ch.map((c, i) => ({
      name: c.channel === 'voice_bot' ? 'Voice Bot'
          : c.channel === 'manual'   ? 'Manual'
          : c.channel === 'email'    ? 'Email'
          : c.channel,
      value: Number(c.total),
      color: CHANNEL_COLORS[i % CHANNEL_COLORS.length],
    }));
  }, [heatmapQ.data]);

  // ── Volume chart data ──────────────────────────────────────────────────────

  const volumeData = useMemo(() =>
    (trendsQ.data ?? []).map((r: any) => ({
      period: fmtDate(r.period, period.grain),
      'Total':         r.total        || 0,
      'Resolved':      r.resolved     || 0,
      'SLA Breached':  r.sla_breached || 0,
    })),
  [trendsQ.data, period.grain]);

  // ── Resolution chart data ──────────────────────────────────────────────────

  const resolutionData = useMemo(() =>
    (resolutionQ.data ?? []).map((r: any) => ({
      period:         fmtDate(r.period, period.grain),
      'SLA Compliance %': r.sla_compliance_pct ?? null,
      'Avg Resolution (h)': r.avg_resolution_hrs ?? null,
      'First Response (h)': r.avg_first_response_hrs ?? null,
    })),
  [resolutionQ.data, period.grain]);

  // ── Top tags ───────────────────────────────────────────────────────────────

  const topTags: any[] = heatmapQ.data?.topTags ?? [];

  // ── Type breakdown ─────────────────────────────────────────────────────────

  const typeData: any[] = (heatmapQ.data?.byType ?? []).map((t: any, i: number) => ({
    name: t.ticket_type,
    value: Number(t.total),
    color: CHANNEL_COLORS[(i + 2) % CHANNEL_COLORS.length],
  }));

  // ── CSV export ─────────────────────────────────────────────────────────────

  function exportCSV() {
    const rows = (trendsQ.data ?? []).map((r: any) => ({
      Period:       fmtDate(r.period, period.grain),
      Total:        r.total,
      Resolved:     r.resolved,
      SLA_Breached: r.sla_breached,
      Urgent:       r.urgent,
      High:         r.high,
      Medium:       r.medium,
      Low:          r.low,
    }));
    if (!rows.length) return;
    const hdrs = Object.keys(rows[0]);
    const csv  = [hdrs.join(','), ...rows.map(r => hdrs.map(h => (r as any)[h] ?? '').join(','))].join('\n');
    const url  = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    Object.assign(document.createElement('a'), { href: url, download: 'ticket-report.csv' }).click();
    URL.revokeObjectURL(url);
  }

  const isLoading = trendsQ.isLoading || resolutionQ.isLoading || heatmapQ.isLoading;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">

      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Ticket Reports</h1>
          <p className="text-sm text-gray-400 mt-0.5">Volume, SLA performance, and agent analytics</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-gray-100 rounded-lg p-1 gap-0.5">
            {PERIODS.map((p, i) => (
              <button
                key={p.value}
                onClick={() => setPeriodIdx(i)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  i === periodIdx ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <button
            onClick={exportCSV}
            className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600"
          >
            <Download size={14} /> Export CSV
          </button>
        </div>
      </div>

      {isLoading && (
        <div className="text-center py-12 text-gray-400 text-sm">Loading report data…</div>
      )}

      {!isLoading && (
        <>
          {/* ── KPI Row ── */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <KpiCard
              label="Total Tickets"
              value={kpis.totalTickets.toLocaleString()}
              icon={TicketCheck}
            />
            <KpiCard
              label="Resolved"
              value={kpis.totalResolved.toLocaleString()}
              sub={kpis.totalTickets > 0 ? `${Math.round(kpis.totalResolved / kpis.totalTickets * 100)}% resolution rate` : undefined}
              icon={CheckCircle2}
              color="text-emerald-600"
            />
            <KpiCard
              label="SLA Compliance"
              value={fmtPct(kpis.avgSla)}
              sub={kpis.avgSla != null && kpis.avgSla < 80 ? 'Below target' : undefined}
              icon={TrendingUp}
              color={kpis.avgSla != null ? (kpis.avgSla >= 90 ? 'text-emerald-600' : kpis.avgSla >= 75 ? 'text-amber-500' : 'text-red-500') : 'text-gray-900'}
            />
            <KpiCard
              label="Avg Resolution Time"
              value={fmtHrs(kpis.avgResTime)}
              icon={Clock}
            />
            <KpiCard
              label="Avg First Response"
              value={fmtHrs(kpis.avgFrt)}
              icon={TrendingDown}
            />
            <KpiCard
              label="Escalation Rate"
              value={fmtPct(kpis.avgEsc)}
              icon={AlertTriangle}
              color={kpis.avgEsc != null && kpis.avgEsc > 10 ? 'text-red-500' : 'text-gray-900'}
            />
          </div>

          {/* ── Ticket Volume Over Time ── */}
          <Section
            title={`Ticket Volume — ${period.label}`}
            action={
              <span className="text-xs text-gray-400">
                {period.grain === 'day' ? 'Daily' : period.grain === 'week' ? 'Weekly' : 'Monthly'} breakdown
              </span>
            }
          >
            {volumeData.length === 0 ? (
              <div className="text-center py-10 text-gray-400 text-sm">No ticket data for this period.</div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={volumeData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                  <XAxis dataKey="period" tick={{ fontSize: 11, fill: '#9CA3AF' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#9CA3AF' }} allowDecimals={false} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="Total"        fill="#6366F1" radius={[3,3,0,0]} />
                  <Bar dataKey="Resolved"     fill="#22C55E" radius={[3,3,0,0]} />
                  <Bar dataKey="SLA Breached" fill="#EF4444" radius={[3,3,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Section>

          {/* ── SLA Performance Over Time ── */}
          <Section title="SLA Performance Trend">
            {resolutionData.length === 0 ? (
              <div className="text-center py-10 text-gray-400 text-sm">No performance data for this period.</div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={resolutionData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                  <XAxis dataKey="period" tick={{ fontSize: 11, fill: '#9CA3AF' }} />
                  <YAxis yAxisId="pct"  tick={{ fontSize: 11, fill: '#9CA3AF' }} unit="%" domain={[0, 100]} />
                  <YAxis yAxisId="hrs"  tick={{ fontSize: 11, fill: '#9CA3AF' }} orientation="right" unit="h" />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line yAxisId="pct" type="monotone" dataKey="SLA Compliance %" stroke="#6366F1" strokeWidth={2} dot={false} connectNulls />
                  <Line yAxisId="hrs" type="monotone" dataKey="Avg Resolution (h)" stroke="#F97316" strokeWidth={2} dot={false} connectNulls />
                  <Line yAxisId="hrs" type="monotone" dataKey="First Response (h)" stroke="#22C55E" strokeWidth={2} dot={false} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            )}
          </Section>

          {/* ── Priority & Channel split ── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            {/* Priority breakdown */}
            <Section title="Tickets by Priority">
              {priorityData.length === 0 ? (
                <div className="text-center py-10 text-gray-400 text-sm">No data.</div>
              ) : (
                <div className="flex items-center gap-6">
                  <ResponsiveContainer width="50%" height={200}>
                    <PieChart>
                      <Pie data={priorityData} dataKey="value" cx="50%" cy="50%" outerRadius={75} innerRadius={45}>
                        {priorityData.map((d, i) => (
                          <Cell key={i} fill={d.color} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex flex-col gap-2">
                    {priorityData.map(d => {
                      const total = priorityData.reduce((s, p) => s + p.value, 0);
                      const pct   = total > 0 ? Math.round(d.value / total * 100) : 0;
                      return (
                        <div key={d.name} className="flex items-center gap-2 text-sm">
                          <div className="w-3 h-3 rounded-sm shrink-0" style={{ background: d.color }} />
                          <span className="text-gray-600 min-w-[55px]">{d.name}</span>
                          <span className="font-semibold text-gray-900">{d.value}</span>
                          <span className="text-gray-400 text-xs">({pct}%)</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </Section>

            {/* Channel breakdown */}
            <Section title="Tickets by Channel">
              {channelData.length === 0 ? (
                <div className="text-center py-10 text-gray-400 text-sm">No data.</div>
              ) : (
                <div className="flex items-center gap-6">
                  <ResponsiveContainer width="50%" height={200}>
                    <PieChart>
                      <Pie data={channelData} dataKey="value" cx="50%" cy="50%" outerRadius={75} innerRadius={45}>
                        {channelData.map((d, i) => (
                          <Cell key={i} fill={d.color} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex flex-col gap-2">
                    {channelData.map(d => {
                      const total = channelData.reduce((s, c) => s + c.value, 0);
                      const pct   = total > 0 ? Math.round(d.value / total * 100) : 0;
                      return (
                        <div key={d.name} className="flex items-center gap-2 text-sm">
                          <div className="w-3 h-3 rounded-sm shrink-0" style={{ background: d.color }} />
                          <span className="text-gray-600 min-w-[75px]">{d.name}</span>
                          <span className="font-semibold text-gray-900">{d.value}</span>
                          <span className="text-gray-400 text-xs">({pct}%)</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </Section>
          </div>

          {/* ── Top Issue Categories ── */}
          {topTags.length > 0 && (
            <Section title="Top Issue Categories">
              <div className="space-y-3">
                {topTags.slice(0, 10).map((t: any) => {
                  const max      = topTags[0]?.total ?? 1;
                  const barPct   = Math.round((t.total / max) * 100);
                  const breachPct = t.total > 0 ? Math.round((t.sla_breached / t.total) * 100) : 0;
                  return (
                    <div key={t.tag} className="flex items-center gap-3">
                      <div className="w-28 shrink-0 text-xs text-gray-600 truncate" title={t.tag}>{t.tag}</div>
                      <div className="flex-1 bg-gray-100 rounded-full h-5 relative overflow-hidden">
                        <div
                          className="h-full rounded-full bg-indigo-400"
                          style={{ width: `${barPct}%` }}
                        />
                      </div>
                      <div className="w-8 text-xs font-semibold text-gray-800 text-right shrink-0">{t.total}</div>
                      <div className="w-24 text-xs text-right shrink-0">
                        <span className="text-gray-400">Avg: </span>
                        <span className="font-medium text-gray-700">{fmtHrs(t.avg_resolution_hrs)}</span>
                      </div>
                      <div className="w-20 text-xs text-right shrink-0">
                        <span className={breachPct > 20 ? 'text-red-500 font-medium' : 'text-gray-400'}>
                          {breachPct}% breached
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Section>
          )}

          {/* ── Ticket Type + Repeat Reporters row ── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            {/* Type breakdown */}
            {typeData.length > 0 && (
              <Section title="Tickets by Type">
                <div className="space-y-2">
                  {typeData.map((t: any) => {
                    const total  = typeData.reduce((s: number, x: any) => s + x.value, 0);
                    const barPct = total > 0 ? Math.round((t.value / total) * 100) : 0;
                    return (
                      <div key={t.name} className="flex items-center gap-3">
                        <div className="w-24 text-xs text-gray-600 capitalize shrink-0">{t.name}</div>
                        <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${barPct}%`, background: t.color }} />
                        </div>
                        <div className="text-xs font-semibold text-gray-800 w-8 text-right shrink-0">{t.value}</div>
                        <div className="text-xs text-gray-400 w-10 text-right shrink-0">{barPct}%</div>
                      </div>
                    );
                  })}
                </div>
              </Section>
            )}

            {/* Repeat reporters */}
            {(heatmapQ.data?.repeatReporters ?? []).length > 0 && (
              <Section title="Repeat Reporters">
                <div className="space-y-2">
                  {(heatmapQ.data.repeatReporters as any[]).slice(0, 8).map((r: any, i: number) => (
                    <div key={i} className="flex items-center justify-between text-sm py-1 border-b border-gray-50 last:border-0">
                      <span className="text-gray-700 truncate max-w-[200px]" title={r.reporter_email}>
                        {r.reporter_email}
                      </span>
                      <span className="ml-2 shrink-0 text-xs font-semibold text-indigo-600 bg-indigo-50 rounded-full px-2 py-0.5">
                        {r.ticket_count} tickets
                      </span>
                    </div>
                  ))}
                </div>
              </Section>
            )}
          </div>

          {/* ── Empty state ── */}
          {kpis.totalTickets === 0 && channelData.length === 0 && typeData.length === 0 && (
            <div className="bg-white border border-gray-100 rounded-xl p-16 text-center">
              <BarChart3 className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500 font-medium">No ticket data for the selected period</p>
              <p className="text-gray-400 text-sm mt-1">Try a longer date range or check that tickets have been created in this workspace.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
