import { useQuery } from '@tanstack/react-query';
import { Loader2, Users, LifeBuoy, AlertTriangle, Clock, RefreshCw } from 'lucide-react';
import { api } from '../services/api';

// ── Types ─────────────────────────────────────────────────────────────────────

interface AgentRow {
  id: string;
  name: string;
  email: string;
  role: string;
  department: string;
  agent_status: 'online' | 'busy' | 'away' | 'offline';
  agent_status_updated_at: string;
  role_name: string | null;
  role_color: string | null;
  // ticket load — fetched separately and merged
  active_tickets?: number;
  breached_tickets?: number;
}

interface QueueStat {
  queue_name: string;
  department: string;
  open: number;
  assigned: number;
  pending: number;
  breached: number;
}

// ── Status config ──────────────────────────────────────────────────────────────

const STATUS_CFG = {
  online:  { dot: 'bg-emerald-400', badge: 'bg-emerald-50 text-emerald-700 border border-emerald-200',  label: 'Online'  },
  busy:    { dot: 'bg-red-400',     badge: 'bg-red-50 text-red-700 border border-red-200',              label: 'Busy'    },
  away:    { dot: 'bg-yellow-400',  badge: 'bg-yellow-50 text-yellow-700 border border-yellow-200',     label: 'Away'    },
  offline: { dot: 'bg-gray-300',    badge: 'bg-gray-50 text-gray-500 border border-gray-200',           label: 'Offline' },
};

function fmtRelative(iso: string) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

// ── Agent card ─────────────────────────────────────────────────────────────────

function AgentCard({ agent }: { agent: AgentRow }) {
  const cfg = STATUS_CFG[agent.agent_status] ?? STATUS_CFG.offline;
  const initials = agent.name?.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) ?? '?';

  return (
    <div className={`bg-white rounded-xl border p-4 flex flex-col gap-3 transition-all ${
      agent.agent_status === 'offline' ? 'opacity-60 border-gray-100' : 'border-gray-200 shadow-sm'
    }`}>
      {/* Avatar + name */}
      <div className="flex items-center gap-3">
        <div className="relative shrink-0">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-brand-400 to-purple-500 flex items-center justify-center text-white text-sm font-bold">
            {initials}
          </div>
          <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${cfg.dot}`} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">{agent.name}</p>
          <p className="text-xs text-gray-400 truncate">{agent.role_name ?? agent.role} · {agent.department ?? '—'}</p>
        </div>
        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 ${cfg.badge}`}>
          {cfg.label}
        </span>
      </div>

      {/* Ticket load */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-gray-50 rounded-lg px-3 py-2 text-center">
          <p className="text-lg font-bold text-gray-900">{agent.active_tickets ?? 0}</p>
          <p className="text-[10px] text-gray-400">Active tickets</p>
        </div>
        <div className={`rounded-lg px-3 py-2 text-center ${(agent.breached_tickets ?? 0) > 0 ? 'bg-red-50' : 'bg-gray-50'}`}>
          <p className={`text-lg font-bold ${(agent.breached_tickets ?? 0) > 0 ? 'text-red-600' : 'text-gray-900'}`}>
            {agent.breached_tickets ?? 0}
          </p>
          <p className="text-[10px] text-gray-400">SLA breached</p>
        </div>
      </div>

      {/* Status since */}
      <p className="text-[10px] text-gray-400 text-right -mt-1">
        Status since {fmtRelative(agent.agent_status_updated_at)}
      </p>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export function Wallboard() {
  const { data: agentsData, isLoading: loadingAgents, dataUpdatedAt, refetch } = useQuery({
    queryKey: ['wallboard-agents'],
    queryFn: () => api.get('/api/v1/settings/team/online').then(r => r.data.data ?? []),
    refetchInterval: 30_000,
  });

  const { data: ticketLoad } = useQuery({
    queryKey: ['wallboard-ticket-load'],
    queryFn: () => api.get('/api/v1/analytics/agent-load').then(r => r.data.data ?? []),
    refetchInterval: 30_000,
  });

  const { data: queueStats } = useQuery({
    queryKey: ['wallboard-queues'],
    queryFn: () => api.get('/api/v1/analytics/queue-stats').then(r => r.data.data ?? []),
    refetchInterval: 30_000,
  });

  const agents: AgentRow[] = (agentsData ?? []).map((a: AgentRow) => {
    const load = (ticketLoad ?? []).find((l: any) => l.agent_id === a.id);
    return { ...a, active_tickets: load?.active_tickets ?? 0, breached_tickets: load?.breached_tickets ?? 0 };
  });

  const online  = agents.filter(a => a.agent_status === 'online').length;
  const busy    = agents.filter(a => a.agent_status === 'busy').length;
  const away    = agents.filter(a => a.agent_status === 'away').length;
  const offline = agents.filter(a => a.agent_status === 'offline').length;
  const available = online + busy; // agents who can handle work

  const totalBreached = agents.reduce((s, a) => s + (a.breached_tickets ?? 0), 0);

  const updatedAt = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';

  if (loadingAgents) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 text-brand-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-gray-50 p-6">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Live Wallboard</h1>
          <p className="text-sm text-gray-400 mt-0.5">Auto-refreshes every 30 seconds</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400 flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" /> Last updated {updatedAt}
          </span>
          <button onClick={() => refetch()}
            className="flex items-center gap-1.5 text-xs text-brand-600 hover:text-brand-700 border border-brand-200 hover:border-brand-400 px-3 py-1.5 rounded-lg transition-colors">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Online',    value: online,    color: 'text-emerald-600', bg: 'bg-emerald-50',  border: 'border-emerald-200' },
          { label: 'Busy',      value: busy,      color: 'text-red-600',     bg: 'bg-red-50',      border: 'border-red-200'     },
          { label: 'Away',      value: away,      color: 'text-yellow-600',  bg: 'bg-yellow-50',   border: 'border-yellow-200'  },
          { label: 'Offline',   value: offline,   color: 'text-gray-500',    bg: 'bg-gray-50',     border: 'border-gray-200'    },
        ].map(s => (
          <div key={s.label} className={`${s.bg} border ${s.border} rounded-xl p-4 text-center`}>
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* SLA alert bar */}
      {totalBreached > 0 && (
        <div className="mb-5 flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
          <p className="text-sm text-red-700 font-medium">
            {totalBreached} SLA {totalBreached === 1 ? 'breach' : 'breaches'} across {agents.filter(a => (a.breached_tickets ?? 0) > 0).length} agent{agents.filter(a => (a.breached_tickets ?? 0) > 0).length !== 1 ? 's' : ''} — immediate action required
          </p>
        </div>
      )}

      {/* Queue stats */}
      {(queueStats ?? []).length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
            <LifeBuoy className="w-4 h-4 text-brand-500" /> Queue Depth
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {(queueStats ?? []).map((q: QueueStat) => (
              <div key={q.queue_name} className="bg-white border border-gray-200 rounded-xl p-4">
                <p className="text-sm font-semibold text-gray-800 truncate mb-2">{q.queue_name}</p>
                <div className="grid grid-cols-4 gap-1 text-center">
                  {[
                    { label: 'Open',     value: q.open,     cls: 'text-blue-600' },
                    { label: 'Assigned', value: q.assigned, cls: 'text-brand-600' },
                    { label: 'Pending',  value: q.pending,  cls: 'text-yellow-600' },
                    { label: 'Breached', value: q.breached, cls: q.breached > 0 ? 'text-red-600 font-bold' : 'text-gray-500' },
                  ].map(col => (
                    <div key={col.label}>
                      <p className={`text-base font-bold ${col.cls}`}>{col.value}</p>
                      <p className="text-[10px] text-gray-400">{col.label}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Agent grid */}
      <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
        <Users className="w-4 h-4 text-brand-500" /> Agents ({available} available of {agents.length})
      </h2>

      {agents.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <Users className="w-8 h-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No agents found</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {agents.map(a => <AgentCard key={a.id} agent={a} />)}
        </div>
      )}
    </div>
  );
}
