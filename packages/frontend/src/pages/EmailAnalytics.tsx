import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts';
import { Mail, Send, CheckCircle, XCircle, Eye, TrendingUp, Calendar, ChevronDown } from 'lucide-react';
import { api } from '../services/api';

const PERIODS = [
  { value: '7d',  label: 'Last 7 days',   days: 7  },
  { value: '30d', label: 'Last 30 days',  days: 30 },
  { value: '90d', label: 'Last 90 days',  days: 90 },
];

const STATUS_COLORS: Record<string, string> = {
  delivered: '#22c55e',
  bounced:   '#ef4444',
  failed:    '#f97316',
  queued:    '#94a3b8',
  sending:   '#60a5fa',
};

function kpi(n: number | string | null | undefined, decimals = 0) {
  const v = Number(n ?? 0);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1000)      return `${(v / 1000).toFixed(1)}k`;
  return decimals > 0 ? v.toFixed(decimals) : String(v);
}

function KpiCard({
  icon: Icon, label, value, sub, color = '#29ABE2', border,
}: {
  icon: any; label: string; value: string; sub?: string; color?: string; border?: string;
}) {
  return (
    <div className={`bg-white rounded-2xl border ${border ?? 'border-gray-100'} p-5 flex items-start gap-4`}>
      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${color}18` }}>
        <Icon className="w-5 h-5" style={{ color }} />
      </div>
      <div>
        <p className="text-xs text-gray-400 font-medium">{label}</p>
        <p className="text-2xl font-bold text-gray-900 mt-0.5">{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

export function EmailAnalytics() {
  const [period, setPeriod] = useState('30d');
  const periodDef = PERIODS.find(p => p.value === period)!;

  const to   = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - periodDef.days * 86400_000).toISOString().slice(0, 10);

  const { data, isLoading } = useQuery<any>({
    queryKey: ['email-analytics', period],
    queryFn: () => api.get(`/api/v1/emails/analytics?from=${from}&to=${to}`).then((r: any) => r.data.data),
  });

  const s = data?.summary ?? {};
  const daily: any[] = (data?.daily ?? []).map((d: any) => ({
    date:      new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    Sent:      Number(d.sent),
    Delivered: Number(d.delivered),
    Opened:    Number(d.opened),
    Bounced:   Number(d.bounced),
  }));

  const pieData = (data?.byStatus ?? []).map((r: any) => ({
    name:  r.status,
    value: Number(r.count),
    color: STATUS_COLORS[r.status] ?? '#cbd5e1',
  }));

  const topRecipients: any[] = data?.topRecipients ?? [];

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 min-h-full">
      <div className="p-6 max-w-6xl space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Email Analytics</h1>
            <p className="text-sm text-gray-400 mt-0.5">Delivery, open rates and engagement for all outbound emails</p>
          </div>
          <div className="relative">
            <select
              value={period}
              onChange={e => setPeriod(e.target.value)}
              className="pl-3 pr-8 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-brand-400 bg-white appearance-none"
            >
              {PERIODS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
          </div>
        </div>

        {isLoading && <div className="flex items-center justify-center h-40 text-gray-400 text-sm">Loading…</div>}

        {!isLoading && (
          <>
            {/* KPI row */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
              <KpiCard icon={Send}        label="Total Sent"      value={kpi(s.total_sent)} />
              <KpiCard icon={CheckCircle} label="Delivered"       value={kpi(s.delivered)}  color="#22c55e" border="border-green-100"
                sub={`${kpi(s.delivery_rate, 1)}% rate`} />
              <KpiCard icon={Eye}         label="Opened"          value={kpi(s.opened)}     color="#3b82f6" border="border-blue-100"
                sub={`${kpi(s.open_rate, 1)}% open rate`} />
              <KpiCard icon={XCircle}     label="Bounced"         value={kpi(s.bounced)}    color="#ef4444" border="border-red-100"
                sub={`${kpi(s.bounce_rate, 1)}% bounce rate`} />
              <KpiCard icon={Mail}        label="In Queue / Sending" value={kpi(s.queued)}  color="#f59e0b" border="border-amber-100" />
            </div>

            {/* Trend chart */}
            {daily.length > 0 && (
              <div className="bg-white rounded-2xl border border-gray-100 p-5">
                <div className="flex items-center gap-2 mb-4">
                  <TrendingUp className="w-4 h-4 text-gray-400" />
                  <h2 className="text-sm font-semibold text-gray-700">Email Volume Trend</h2>
                </div>
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={daily} margin={{ top: 4, right: 8, bottom: 0, left: -10 }}>
                    <defs>
                      <linearGradient id="gSent" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#29ABE2" stopOpacity={0.15} />
                        <stop offset="95%" stopColor="#29ABE2" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gDel" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#22c55e" stopOpacity={0.15} />
                        <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                    <Area type="monotone" dataKey="Sent"      stroke="#29ABE2" fill="url(#gSent)" strokeWidth={2} dot={false} />
                    <Area type="monotone" dataKey="Delivered" stroke="#22c55e" fill="url(#gDel)"  strokeWidth={2} dot={false} />
                    <Area type="monotone" dataKey="Opened"    stroke="#3b82f6" fill="none"        strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                    <Area type="monotone" dataKey="Bounced"   stroke="#ef4444" fill="none"        strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Status breakdown + top recipients */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

              {/* Status pie */}
              <div className="bg-white rounded-2xl border border-gray-100 p-5">
                <h2 className="text-sm font-semibold text-gray-700 mb-4">Status Breakdown</h2>
                {pieData.length > 0 ? (
                  <div className="flex items-center gap-6">
                    <ResponsiveContainer width={160} height={160}>
                      <PieChart>
                        <Pie data={pieData} cx="50%" cy="50%" innerRadius={45} outerRadius={70}
                          dataKey="value" paddingAngle={2}>
                          {pieData.map((entry: any, i: number) => (
                            <Cell key={i} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(v: any, n: any) => [v, n]} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="space-y-2 flex-1">
                      {pieData.map((d: any) => (
                        <div key={d.name} className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-1.5">
                            <div className="w-2.5 h-2.5 rounded-full" style={{ background: d.color }} />
                            <span className="capitalize text-gray-600">{d.name}</span>
                          </div>
                          <span className="font-semibold text-gray-900">{d.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-gray-400 text-center py-8">No email data for this period</p>
                )}
              </div>

              {/* Top recipients */}
              <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-50">
                  <h2 className="text-sm font-semibold text-gray-700">Top Recipients</h2>
                </div>
                {topRecipients.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-50">
                          <th className="text-left px-5 py-3 text-xs font-medium text-gray-400">Contact</th>
                          <th className="text-right px-4 py-3 text-xs font-medium text-gray-400">Sent</th>
                          <th className="text-right px-5 py-3 text-xs font-medium text-gray-400">Opened</th>
                        </tr>
                      </thead>
                      <tbody>
                        {topRecipients.slice(0, 8).map((r: any, i: number) => (
                          <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50">
                            <td className="px-5 py-2.5">
                              <p className="text-xs font-medium text-gray-900 truncate max-w-[160px]">{r.name}</p>
                              <p className="text-[10px] text-gray-400 truncate max-w-[160px]">{r.email}</p>
                            </td>
                            <td className="px-4 py-2.5 text-right text-xs text-gray-700">{r.emails_received}</td>
                            <td className="px-5 py-2.5 text-right">
                              <span className={`text-xs font-semibold ${Number(r.opened) > 0 ? 'text-blue-600' : 'text-gray-300'}`}>
                                {r.opened}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-sm text-gray-400 text-center py-8">No recipient data yet</p>
                )}
              </div>
            </div>

            {/* Engagement bar chart */}
            {daily.length > 1 && (
              <div className="bg-white rounded-2xl border border-gray-100 p-5">
                <h2 className="text-sm font-semibold text-gray-700 mb-4">Daily Engagement (Opened vs Bounced)</h2>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={daily} margin={{ top: 4, right: 8, bottom: 0, left: -10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip />
                    <Legend iconType="square" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="Opened"  fill="#3b82f6" radius={[3,3,0,0]} />
                    <Bar dataKey="Bounced" fill="#ef4444" radius={[3,3,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Empty state */}
            {daily.length === 0 && !isLoading && (
              <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center">
                <Mail className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                <p className="text-sm font-medium text-gray-500">No emails sent in this period</p>
                <p className="text-xs text-gray-400 mt-1">Send your first email from a contact, deal or ticket to see analytics here.</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
