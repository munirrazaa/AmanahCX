import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Users, CheckCircle2, Circle, MapPin, Ticket, Plus, X, Loader2 } from 'lucide-react';
import { api } from '../services/api';

// ── Types ─────────────────────────────────────────────────────────────────────

interface FieldTeamMember {
  id: string;
  name: string;
  email: string;
  agent_status: 'online' | 'busy' | 'away' | 'offline';
  today_total: string;
  today_pending: string;
  today_completed: string;
  open_tickets: string;
  last_activity_at: string | null;
  last_checkin_at: string | null;
}

interface TeamTask {
  id: string;
  subject: string;
  status: string;
  due_at: string | null;
  first_name: string | null;
  last_name: string | null;
  metadata: { checkins?: { lat: number; lng: number; at: string }[]; completedLocation?: { lat: number; lng: number; at: string } };
}

interface TeamTicket {
  id: string;
  ticket_number: string;
  subject: string;
  status: string;
  priority: string;
  sla_due_at: string | null;
}

const STATUS_DOT = {
  online: 'bg-emerald-400', busy: 'bg-red-400', away: 'bg-yellow-400', offline: 'bg-gray-300',
};

function fmtRelative(iso: string | null) {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
}

// ── Assign Task modal ──────────────────────────────────────────────────────────

function AssignTaskModal({ memberId, memberName, onClose }: { memberId: string; memberName: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [subject, setSubject] = useState('');
  const [dueAt, setDueAt] = useState('');

  const mutation = useMutation({
    mutationFn: () => api.post('/api/v1/activities', {
      type: 'task', subject, ownerId: memberId,
      dueAt: dueAt ? new Date(dueAt).toISOString() : undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['field-team'] });
      qc.invalidateQueries({ queryKey: ['field-team-detail', memberId] });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-800">Assign Task to {memberName}</h3>
          <button onClick={onClose}><X className="w-4 h-4 text-gray-400" /></button>
        </div>
        <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">What needs to be done</label>
        <input
          className="w-full border border-gray-200 rounded-lg px-3 py-2 mt-1 mb-3 text-sm"
          placeholder="e.g. Visit customer to reinstall unit"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
        />
        <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Due (optional)</label>
        <input
          type="datetime-local"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 mt-1 mb-4 text-sm"
          value={dueAt}
          onChange={(e) => setDueAt(e.target.value)}
        />
        <button
          disabled={!subject.trim() || mutation.isPending}
          onClick={() => mutation.mutate()}
          className="w-full bg-brand-500 text-white rounded-lg py-2 text-sm font-semibold disabled:opacity-40 flex items-center justify-center gap-2"
        >
          {mutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
          Assign Task
        </button>
        {mutation.isError && <p className="text-xs text-red-500 mt-2">Could not assign — please try again.</p>}
      </div>
    </div>
  );
}

// ── Member detail (tasks + tickets) ───────────────────────────────────────────

function MemberDetail({ memberId }: { memberId: string }) {
  const { data, isLoading } = useQuery<{ tasks: TeamTask[]; tickets: TeamTicket[] }>({
    queryKey: ['field-team-detail', memberId],
    queryFn: async () => (await api.get(`/api/v1/analytics/field-team/${memberId}`)).data.data,
  });

  if (isLoading) return <div className="p-4 text-sm text-gray-400">Loading…</div>;
  if (!data) return null;

  return (
    <div className="border-t border-gray-100 bg-gray-50/60 p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Tasks</p>
        {data.tasks.length === 0 && <p className="text-xs text-gray-400">No tasks assigned.</p>}
        <div className="space-y-1.5">
          {data.tasks.map((t) => {
            const checkins = t.metadata?.checkins ?? [];
            const hasGps = checkins.length > 0 || t.metadata?.completedLocation;
            return (
              <div key={t.id} className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm">
                {t.status === 'completed'
                  ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                  : <Circle className="w-4 h-4 text-gray-300 shrink-0" />}
                <span className="flex-1 truncate">{t.subject}</span>
                {hasGps && (
                  <span title="GPS check-in recorded">
                    <MapPin className="w-3.5 h-3.5 text-brand-500 shrink-0" />
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Open Tickets</p>
        {data.tickets.length === 0 && <p className="text-xs text-gray-400">No open tickets.</p>}
        <div className="space-y-1.5">
          {data.tickets.map((t) => (
            <div key={t.id} className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm">
              <Ticket className="w-4 h-4 text-gray-400 shrink-0" />
              <span className="font-mono text-xs text-gray-400">{t.ticket_number}</span>
              <span className="flex-1 truncate">{t.subject}</span>
              <span className="text-xs text-gray-400 capitalize">{t.priority}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export function FieldTeamView() {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [assignTarget, setAssignTarget] = useState<{ id: string; name: string } | null>(null);

  const { data, isLoading } = useQuery<FieldTeamMember[]>({
    queryKey: ['field-team'],
    queryFn: async () => (await api.get('/api/v1/analytics/field-team')).data.data,
    refetchInterval: 60_000,
  });

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-2 mb-1">
        <Users className="w-5 h-5 text-brand-500" />
        <h1 className="text-lg font-semibold text-gray-800">Field Team</h1>
      </div>
      <p className="text-sm text-gray-500 mb-6">Today's agenda for your team — assign new tasks or tickets to anyone below.</p>

      {isLoading && <div className="text-sm text-gray-400">Loading your team…</div>}
      {!isLoading && (data ?? []).length === 0 && (
        <div className="text-sm text-gray-400 border border-dashed border-gray-200 rounded-xl p-8 text-center">
          No one currently reports to you.
        </div>
      )}

      <div className="space-y-3">
        {(data ?? []).map((m) => (
          <div key={m.id} className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
            <div
              className="flex items-center gap-4 p-4 cursor-pointer hover:bg-gray-50"
              onClick={() => setExpanded(expanded === m.id ? null : m.id)}
            >
              <div className="relative">
                <div className="w-9 h-9 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center font-semibold text-sm">
                  {m.name.charAt(0)}
                </div>
                <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${STATUS_DOT[m.agent_status]}`} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-800 text-sm">{m.name}</p>
                <p className="text-xs text-gray-400 flex items-center gap-1">
                  <MapPin className="w-3 h-3" /> Last GPS check-in: {fmtRelative(m.last_checkin_at)}
                </p>
              </div>
              <div className="text-center px-3">
                <p className="text-sm font-semibold text-gray-700">{m.today_pending}/{m.today_total}</p>
                <p className="text-[10px] text-gray-400 uppercase tracking-wide">To do / Today</p>
              </div>
              <div className="text-center px-3">
                <p className="text-sm font-semibold text-gray-700">{m.open_tickets}</p>
                <p className="text-[10px] text-gray-400 uppercase tracking-wide">Open Tickets</p>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); setAssignTarget({ id: m.id, name: m.name }); }}
                className="flex items-center gap-1 text-xs font-semibold text-brand-600 border border-brand-200 rounded-lg px-3 py-1.5 hover:bg-brand-50"
              >
                <Plus className="w-3.5 h-3.5" /> Assign Task
              </button>
            </div>
            {expanded === m.id && <MemberDetail memberId={m.id} />}
          </div>
        ))}
      </div>

      {assignTarget && (
        <AssignTaskModal
          memberId={assignTarget.id}
          memberName={assignTarget.name}
          onClose={() => setAssignTarget(null)}
        />
      )}
    </div>
  );
}
