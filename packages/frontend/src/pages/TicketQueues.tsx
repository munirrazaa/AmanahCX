/**
 * TicketQueues — manage ticket queues
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { List, Plus, Pencil, Trash2, Loader2, X, CheckCircle } from 'lucide-react';
import { api } from '../services/api';
import { useCan } from '../hooks/useRole';

interface Queue {
  id: string; name: string; description?: string;
  color: string; is_default: boolean; ticket_count: string;
}

const COLORS = ['#6366f1','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#ec4899','#84cc16','#f97316','#64748b'];

function QueueModal({
  queue, onClose,
}: { queue?: Queue; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name:        queue?.name        ?? '',
    description: queue?.description ?? '',
    color:       queue?.color       ?? '#6366f1',
    isDefault:   queue?.is_default  ?? false,
  });

  const mutation = useMutation({
    mutationFn: () => queue
      ? api.patch(`/api/v1/tickets/queues/${queue.id}`, form)
      : api.post('/api/v1/tickets/queues', form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ticket-queues'] }); onClose(); },
  });

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">{queue ? 'Edit Queue' : 'New Queue'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Queue Name *</label>
            <input
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-400"
              placeholder="e.g. Technical Support"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
            <input
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-400"
              placeholder="Optional description"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-2">Color</label>
            <div className="flex gap-2 flex-wrap">
              {COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => setForm(f => ({ ...f, color: c }))}
                  className={`w-7 h-7 rounded-full border-2 transition-all ${form.color === c ? 'border-gray-800 scale-110' : 'border-transparent'}`}
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input
              type="checkbox"
              checked={form.isDefault}
              onChange={e => setForm(f => ({ ...f, isDefault: e.target.checked }))}
              className="rounded"
            />
            Set as default queue for new tickets
          </label>
        </div>
        <div className="px-6 pb-5 flex gap-2">
          <button onClick={onClose} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
          <button
            onClick={() => mutation.mutate()}
            disabled={!form.name || mutation.isPending}
            className="flex-1 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {mutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            {queue ? 'Save Changes' : 'Create Queue'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function TicketQueues() {
  const can = useCan();
  const qc  = useQueryClient();
  const [editing, setEditing] = useState<Queue | undefined>(undefined);
  const [showCreate, setShowCreate] = useState(false);

  const { data = [], isLoading } = useQuery<Queue[]>({
    queryKey: ['ticket-queues'],
    queryFn: async () => (await api.get('/api/v1/tickets/queues')).data.data,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/tickets/queues/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ticket-queues'] }),
  });

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <List className="w-5 h-5 text-brand-600" />
          <h1 className="text-xl font-semibold text-gray-900">Ticket Queues</h1>
        </div>
        {can.manageWorkspace && (
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-brand-600 text-white rounded-xl text-sm font-medium hover:bg-brand-700"
          >
            <Plus className="w-4 h-4" /> New Queue
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-300" /></div>
      ) : (
        <div className="space-y-3">
          {data.map(q => (
            <div key={q.id} className="bg-white rounded-2xl border border-gray-100 p-4 flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: q.color + '22' }}>
                <List className="w-5 h-5" style={{ color: q.color }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-gray-900">{q.name}</p>
                  {q.is_default && (
                    <span className="flex items-center gap-1 text-xs text-green-700 bg-green-100 px-2 py-0.5 rounded-full">
                      <CheckCircle className="w-3 h-3" /> Default
                    </span>
                  )}
                </div>
                {q.description && <p className="text-sm text-gray-500 truncate">{q.description}</p>}
              </div>
              <div className="text-center shrink-0">
                <p className="text-lg font-bold text-gray-800">{q.ticket_count}</p>
                <p className="text-xs text-gray-400">open tickets</p>
              </div>
              {can.manageWorkspace && (
                <div className="flex gap-1 shrink-0">
                  <button
                    onClick={() => setEditing(q)}
                    className="p-1.5 text-gray-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg"
                  ><Pencil className="w-4 h-4" /></button>
                  <button
                    onClick={() => { if (confirm(`Delete queue "${q.name}"?`)) deleteMutation.mutate(q.id); }}
                    disabled={q.is_default}
                    className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-30"
                  ><Trash2 className="w-4 h-4" /></button>
                </div>
              )}
            </div>
          ))}
          {data.length === 0 && (
            <div className="text-center py-12 text-gray-400">
              <List className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No queues yet</p>
            </div>
          )}
        </div>
      )}

      {(showCreate || editing) && (
        <QueueModal
          queue={editing}
          onClose={() => { setShowCreate(false); setEditing(undefined); }}
        />
      )}
    </div>
  );
}
