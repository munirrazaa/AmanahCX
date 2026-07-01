/**
 * Call Recordings page — unified view of voice bot + human agent call recordings.
 *
 * Access:
 *   operations_admin — all recordings, read-only
 *   policy_admin     — all recordings + legal hold toggle
 *   manager          — own team's recordings
 *   agent            — own recordings only
 */

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api } from '../services/api';
import { useIsPolicyAdmin, useHasRole } from '../hooks/useRole';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Recording {
  id: string;
  call_type: 'bot' | 'human';
  agent_id: string | null;
  agent_name: string | null;
  recording_url: string | null;
  transcript: string | null;
  duration_s: number | null;
  direction: 'inbound' | 'outbound';
  tags: string[];
  legal_hold: boolean;
  legal_hold_at: string | null;
  ticket_id: string | null;
  contact_id: string | null;
  queue_id: string | null;
  started_at: string | null;
  created_at: string;
  caller_number: string | null;
  source: string | null;
}

interface Meta {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(s: number | null): string {
  if (!s) return '—';
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function AudioPlayer({ url }: { url: string }) {
  return (
    <audio controls className="w-full h-8 mt-1" preload="none">
      <source src={url} type="audio/mpeg" />
      <source src={url} type="audio/ogg" />
      Your browser does not support audio.
    </audio>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function CallRecordings() {
  const isPolicyAdmin = useIsPolicyAdmin();
  const isOpsAdmin    = useHasRole('operations_admin');
  const qc = useQueryClient();

  const [page, setPage]         = useState(1);
  const [typeFilter, setType]   = useState('');
  const [tagFilter, setTag]     = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo]     = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const params: Record<string, string> = { page: String(page), pageSize: '20' };
  if (typeFilter) params.type = typeFilter;
  if (tagFilter)  params.tag  = tagFilter;
  if (dateFrom)   params.dateFrom = dateFrom;
  if (dateTo)     params.dateTo   = dateTo;

  const { data, isLoading, error } = useQuery<{ data: Recording[]; meta: Meta }>({
    queryKey: ['recordings', params],
    queryFn: async () => {
      const res = await api.get('/api/v1/recordings', { params });
      return res.data;
    },
  });

  const legalHoldMutation = useMutation({
    mutationFn: async ({ id, hold }: { id: string; hold: boolean }) => {
      await api.post(`/api/v1/recordings/${id}/legal-hold`, { hold });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['recordings'] }),
  });

  const recordings: Recording[] = data?.data ?? [];
  const meta: Meta = data?.meta ?? { total: 0, page: 1, pageSize: 20, totalPages: 0 };

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Call Recordings</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {(isOpsAdmin || isPolicyAdmin)
              ? 'All tenant recordings — read-only observer view'
              : 'Recordings from your team'}
          </p>
        </div>
        <span className="text-sm text-gray-400">{meta.total} total</span>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select
          value={typeFilter}
          onChange={(e) => { setType(e.target.value); setPage(1); }}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All types</option>
          <option value="human">Human agent</option>
          <option value="bot">Voice bot</option>
        </select>

        <input
          type="text"
          placeholder="Filter by tag…"
          value={tagFilter}
          onChange={(e) => { setTag(e.target.value); setPage(1); }}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-40"
        />

        <input
          type="date"
          value={dateFrom}
          onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          title="From date"
        />
        <span className="self-center text-gray-400 text-sm">to</span>
        <input
          type="date"
          value={dateTo}
          onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          title="To date"
        />

        {(typeFilter || tagFilter || dateFrom || dateTo) && (
          <button
            onClick={() => { setType(''); setTag(''); setDateFrom(''); setDateTo(''); setPage(1); }}
            className="text-sm text-blue-600 hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center h-48 text-gray-400">Loading…</div>
      ) : error ? (
        <div className="flex items-center justify-center h-48 text-red-500">
          Failed to load recordings.
        </div>
      ) : recordings.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 text-gray-400 gap-2">
          <svg className="w-10 h-10 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-7V3" />
          </svg>
          <span>No recordings found</span>
        </div>
      ) : (
        <div className="space-y-2">
          {recordings.map((rec) => (
            <RecordingRow
              key={rec.id}
              rec={rec}
              expanded={expanded === rec.id}
              onToggle={() => setExpanded(expanded === rec.id ? null : rec.id)}
              isPolicyAdmin={isPolicyAdmin}
              onLegalHold={(hold) => legalHoldMutation.mutate({ id: rec.id, hold })}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {meta.totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="px-4 py-2 text-sm border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50"
          >
            Previous
          </button>
          <span className="text-sm text-gray-500">
            Page {meta.page} of {meta.totalPages}
          </span>
          <button
            disabled={page >= meta.totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="px-4 py-2 text-sm border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Row component ────────────────────────────────────────────────────────────

function RecordingRow({
  rec, expanded, onToggle, isPolicyAdmin, onLegalHold,
}: {
  rec: Recording;
  expanded: boolean;
  onToggle: () => void;
  isPolicyAdmin: boolean;
  onLegalHold: (hold: boolean) => void;
}) {
  const [showTranscript, setShowTranscript] = useState(false);

  return (
    <div className={`border rounded-xl overflow-hidden transition-all ${
      rec.legal_hold ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-white'
    }`}>
      {/* Summary row */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-4 px-4 py-3 text-left hover:bg-gray-50/60 transition-colors"
      >
        {/* Type badge */}
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium shrink-0 ${
          rec.call_type === 'bot'
            ? 'bg-purple-100 text-purple-700'
            : 'bg-blue-100 text-blue-700'
        }`}>
          {rec.call_type === 'bot' ? 'Bot' : 'Human'}
        </span>

        {/* Direction */}
        <span className="text-xs text-gray-400 shrink-0 w-14">
          {rec.direction}
        </span>

        {/* Agent / caller */}
        <span className="text-sm text-gray-700 flex-1 truncate">
          {rec.agent_name ?? rec.caller_number ?? '—'}
        </span>

        {/* Duration */}
        <span className="text-sm text-gray-500 shrink-0 w-14 text-right">
          {formatDuration(rec.duration_s)}
        </span>

        {/* Date */}
        <span className="text-xs text-gray-400 shrink-0 w-32 text-right">
          {rec.started_at
            ? format(new Date(rec.started_at), 'dd MMM yyyy HH:mm')
            : format(new Date(rec.created_at), 'dd MMM yyyy HH:mm')}
        </span>

        {/* Legal hold badge */}
        {rec.legal_hold && (
          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-200 text-amber-800 shrink-0">
            Legal hold
          </span>
        )}

        {/* Tags */}
        {rec.tags.length > 0 && (
          <div className="flex gap-1 shrink-0">
            {rec.tags.slice(0, 2).map((t) => (
              <span key={t} className="px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded text-xs">{t}</span>
            ))}
            {rec.tags.length > 2 && (
              <span className="text-xs text-gray-400">+{rec.tags.length - 2}</span>
            )}
          </div>
        )}

        <svg
          className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-gray-100 px-4 pb-4 pt-3 space-y-4">
          {/* Ticket / Queue links */}
          <div className="flex gap-6 text-sm text-gray-500">
            {rec.ticket_id && (
              <span>Ticket: <span className="font-mono text-xs text-gray-700">{rec.ticket_id.slice(0, 8)}…</span></span>
            )}
            {rec.source && (
              <span>Source: <span className="text-gray-700">{rec.source}</span></span>
            )}
            {rec.caller_number && (
              <span>Caller: <span className="text-gray-700">{rec.caller_number}</span></span>
            )}
          </div>

          {/* Audio player */}
          {rec.recording_url ? (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1">Recording</p>
              <AudioPlayer url={rec.recording_url} />
            </div>
          ) : (
            <p className="text-xs text-gray-400 italic">No audio file available</p>
          )}

          {/* Transcript toggle */}
          {rec.transcript && (
            <div>
              <button
                onClick={() => setShowTranscript((v) => !v)}
                className="text-xs text-blue-600 hover:underline"
              >
                {showTranscript ? 'Hide transcript' : 'Show transcript'}
              </button>
              {showTranscript && (
                <div className="mt-2 p-3 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-700 leading-relaxed max-h-60 overflow-y-auto whitespace-pre-wrap font-mono">
                  {rec.transcript}
                </div>
              )}
            </div>
          )}

          {/* Legal hold controls (policy_admin only) */}
          {isPolicyAdmin && (
            <div className="flex items-center gap-3 pt-1">
              {rec.legal_hold ? (
                <>
                  <span className="text-xs text-amber-700">
                    Legal hold placed {rec.legal_hold_at
                      ? format(new Date(rec.legal_hold_at), 'dd MMM yyyy HH:mm')
                      : ''}
                  </span>
                  <button
                    onClick={() => onLegalHold(false)}
                    className="px-3 py-1.5 text-xs bg-white border border-amber-300 text-amber-700 rounded-lg hover:bg-amber-50"
                  >
                    Lift legal hold
                  </button>
                </>
              ) : (
                <button
                  onClick={() => onLegalHold(true)}
                  className="px-3 py-1.5 text-xs bg-amber-500 text-white rounded-lg hover:bg-amber-600"
                >
                  Place legal hold
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
