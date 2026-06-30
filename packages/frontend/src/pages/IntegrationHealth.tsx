import { useQuery } from '@tanstack/react-query';
import {
  PieChart, Pie, Cell, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { CheckCircle, XCircle, AlertTriangle, Zap, Globe, RefreshCw } from 'lucide-react';
import { api } from '../services/api';

function StatusBadge({ status }: { status: 'configured' | 'not_configured' }) {
  return status === 'configured' ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-50 text-green-700 border border-green-100">
      <CheckCircle className="w-3 h-3" /> Connected
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-50 text-gray-400 border border-gray-200">
      <XCircle className="w-3 h-3" /> Not configured
    </span>
  );
}

const CAT_LABELS: Record<string, string> = {
  communication: 'Communication',
  crm:           'CRM',
  ecommerce:     'E-Commerce',
  payment:       'Payment',
  ticketing:     'Ticketing',
  marketing:     'Marketing',
  storage:       'Storage',
  telephony:     'Telephony',
};

export function IntegrationHealth() {
  const { data, isLoading, refetch } = useQuery<any>({
    queryKey: ['integration-health'],
    queryFn: () => api.get('/api/v1/connectors/health').then((r: any) => r.data.data),
    refetchInterval: 60_000,
  });

  const summary    = data?.summary      ?? { total: 0, connected: 0, disconnected: 0 };
  const byCategory = data?.byCategory   ?? {};
  const connectors: any[] = data?.connectors ?? [];
  const wh         = data?.webhookStats ?? { total: 0, delivered: 0, failed: 0, delivery_rate: 0 };

  const catData = Object.entries(byCategory).map(([cat, d]: any) => ({
    name:     CAT_LABELS[cat] ?? cat,
    Connected: d.connected,
    Total:     d.total,
  }));

  const piePct = summary.total ? Math.round((summary.connected / summary.total) * 100) : 0;
  const pieData = [
    { name: 'Connected',      value: summary.connected,    color: '#22c55e' },
    { name: 'Not configured', value: summary.disconnected, color: '#e5e7eb' },
  ].filter(d => d.value > 0);

  const grouped: Record<string, any[]> = {};
  for (const c of connectors) {
    const cat = c.category ?? 'other';
    (grouped[cat] = grouped[cat] ?? []).push(c);
  }

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 min-h-full">
      <div className="p-6 max-w-6xl space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Integration Health</h1>
            <p className="text-sm text-gray-400 mt-0.5">Live status of all connected services and webhook delivery</p>
          </div>
          <button
            onClick={() => refetch()}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-gray-500 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>

        {isLoading && <div className="flex items-center justify-center h-40 text-gray-400 text-sm">Loading…</div>}

        {!isLoading && (
          <>
            {/* Summary row */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white rounded-2xl border border-gray-100 p-5">
                <p className="text-xs text-gray-400 font-medium">Total Integrations</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">{summary.total}</p>
              </div>
              <div className="bg-white rounded-2xl border border-green-100 p-5">
                <p className="text-xs text-gray-400 font-medium">Connected</p>
                <p className="text-3xl font-bold text-green-600 mt-1">{summary.connected}</p>
                <p className="text-xs text-gray-400 mt-0.5">{piePct}% of all</p>
              </div>
              <div className="bg-white rounded-2xl border border-gray-100 p-5">
                <p className="text-xs text-gray-400 font-medium">Not Configured</p>
                <p className="text-3xl font-bold text-gray-400 mt-1">{summary.disconnected}</p>
              </div>
              <div className="bg-white rounded-2xl border border-blue-100 p-5">
                <div className="flex items-center gap-1.5 mb-1">
                  <Zap className="w-3.5 h-3.5 text-blue-500" />
                  <p className="text-xs text-gray-400 font-medium">Webhook Delivery</p>
                </div>
                <p className="text-3xl font-bold text-blue-600 mt-1">{Number(wh.delivery_rate ?? 0).toFixed(1)}%</p>
                <p className="text-xs text-gray-400 mt-0.5">{wh.delivered}/{wh.total} last 30 days</p>
              </div>
            </div>

            {/* Charts row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

              {/* Coverage donut */}
              <div className="bg-white rounded-2xl border border-gray-100 p-5">
                <h2 className="text-sm font-semibold text-gray-700 mb-4">Coverage Overview</h2>
                <div className="flex items-center gap-6">
                  <div className="relative flex-shrink-0">
                    <ResponsiveContainer width={140} height={140}>
                      <PieChart>
                        <Pie data={pieData} cx="50%" cy="50%" innerRadius={42} outerRadius={65}
                          dataKey="value" paddingAngle={3} startAngle={90} endAngle={-270}>
                          {pieData.map((e, i) => <Cell key={i} fill={e.color} />)}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                      <span className="text-2xl font-bold text-gray-900">{piePct}%</span>
                      <span className="text-[10px] text-gray-400">active</span>
                    </div>
                  </div>
                  <div className="space-y-2 flex-1">
                    {pieData.map(d => (
                      <div key={d.name} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1.5">
                          <div className="w-2.5 h-2.5 rounded-full" style={{ background: d.color }} />
                          <span className="text-gray-600">{d.name}</span>
                        </div>
                        <span className="font-semibold text-gray-900">{d.value}</span>
                      </div>
                    ))}
                    {wh.failed > 0 && (
                      <div className="mt-3 flex items-center gap-1.5 text-xs text-amber-600 bg-amber-50 rounded-lg px-2.5 py-1.5">
                        <AlertTriangle className="w-3 h-3 shrink-0" />
                        {wh.failed} webhook{wh.failed !== 1 ? 's' : ''} failed in last 30 days
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* By category bar */}
              {catData.length > 0 && (
                <div className="bg-white rounded-2xl border border-gray-100 p-5">
                  <h2 className="text-sm font-semibold text-gray-700 mb-4">Connected by Category</h2>
                  <ResponsiveContainer width="100%" height={160}>
                    <BarChart data={catData} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 40 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
                      <YAxis dataKey="name" type="category" tick={{ fontSize: 10 }} width={70} />
                      <Tooltip />
                      <Bar dataKey="Connected" fill="#22c55e" radius={[0,3,3,0]} />
                      <Bar dataKey="Total"     fill="#e5e7eb" radius={[0,3,3,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            {/* Connector list by category */}
            {Object.entries(grouped).map(([cat, items]) => (
              <div key={cat} className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-50 flex items-center gap-2">
                  <Globe className="w-3.5 h-3.5 text-gray-300" />
                  <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    {CAT_LABELS[cat] ?? cat}
                  </h2>
                  <span className="ml-auto text-xs text-gray-300">
                    {items.filter(i => i.status === 'configured').length}/{items.length} connected
                  </span>
                </div>
                <div className="divide-y divide-gray-50">
                  {items.map((c: any) => (
                    <div key={c.key} className="px-5 py-3 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{c.name}</p>
                        {c.missing_fields?.length > 0 && (
                          <p className="text-[10px] text-gray-400 mt-0.5">
                            Missing: {c.missing_fields.join(', ')}
                          </p>
                        )}
                      </div>
                      <StatusBadge status={c.status} />
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {connectors.length === 0 && (
              <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center">
                <Globe className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                <p className="text-sm font-medium text-gray-500">No integrations configured</p>
                <p className="text-xs text-gray-400 mt-1">Go to Settings → Integrations to connect your first service.</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
