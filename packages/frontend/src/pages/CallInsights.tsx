/**
 * CX Insights — Full Call Centre Analytics Dashboard
 * Modelled on Call Center Studio reporting.
 * Sections: KPI summary | Volume by day | Hourly distribution |
 *           Inbound/Outbound split | Duration buckets | Top agents |
 *           Topic heatmap | Topic frequency
 */

import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Cell, PieChart, Pie, Legend, LineChart, Line,
} from 'recharts';
import { api } from '../services/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface KPI {
  total_calls: number;
  inbound: number;
  outbound: number;
  bot_calls: number;
  human_calls: number;
  with_recording: number;
  avg_duration_s: number;
  max_duration_s: number;
  min_duration_s: number;
  avg_human_s: number;
  avg_bot_s: number;
  tagged_calls: number;
}

interface DayRow  { day: string; cnt: number; bot_cnt: number; human_cnt: number; avg_dur: number }
interface HourRow { hour: number; cnt: number }
interface DirRow  { direction: string; cnt: number }
interface DurRow  { bucket: string; cnt: number }
interface AgentRow { agent_name: string; cnt: number; avg_dur: number }
interface TopicRow { topic: string; cnt: number }
interface TopicDay { topic: string; day: string; cnt: number }

interface InsightsData {
  date_from: string; date_to: string; call_type: string;
  kpi: KPI;
  by_day:       DayRow[];
  by_hour:      HourRow[];
  by_direction: DirRow[];
  by_duration:  DurRow[];
  top_agents:   AgentRow[];
  topics:       TopicRow[];
  topic_by_day: TopicDay[];
}

interface Recording {
  id: string; call_type: 'bot'|'human'; agent_name: string|null;
  recording_url: string|null; transcript: string|null; duration_s: number|null;
  direction: string; tags: string[]; started_at: string|null; created_at: string;
  caller_number: string|null; source: string|null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const BRAND   = '#29ABE2';
const BOT_CLR = '#8b5cf6';
const HUM_CLR = '#10b981';
const WARN    = '#f59e0b';

const TOPIC_PALETTE = [
  '#3b82f6','#ef4444','#f97316','#8b5cf6','#10b981',
  '#06b6d4','#f59e0b','#ec4899','#84cc16','#6366f1',
  '#14b8a6','#a855f7','#22c55e','#64748b','#0ea5e9',
];

const DUR_ORDER = ['< 1 min','1–3 min','3–5 min','5–10 min','> 10 min'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtSec(s: number|null): string {
  if (!s || s === 0) return '—';
  const m = Math.floor(s / 60), sec = Math.round(s % 60);
  return `${m}:${sec.toString().padStart(2,'0')}`;
}

function fmtMins(s: number|null): string {
  if (!s || s === 0) return '0m';
  const m = Math.floor(s / 60), sec = Math.round(s % 60);
  return sec > 0 ? `${m}m ${sec}s` : `${m}m`;
}

function pct(a: number, b: number) {
  return b === 0 ? '0%' : `${Math.round((a / b) * 100)}%`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, color }: { label: string; value: string|number; sub?: string; color?: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-4 flex flex-col gap-1 shadow-sm">
      <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">{label}</p>
      <p className="text-2xl font-bold" style={{ color: color ?? '#111827' }}>{value}</p>
      {sub && <p className="text-xs text-gray-400">{sub}</p>}
    </div>
  );
}

function SectionTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-sm font-semibold text-gray-800 uppercase tracking-wide">{title}</h2>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-lg px-3 py-2 text-xs">
      {label && <p className="font-semibold text-gray-700 mb-1">{label}</p>}
      {payload.map((p: any) => (
        <p key={p.dataKey} style={{ color: p.color }}>
          {p.name}: <strong>{p.value}</strong>
        </p>
      ))}
    </div>
  );
};

// ─── Word Cloud ───────────────────────────────────────────────────────────────

function TopicWordCloud({ topics, selectedTopic, onSelect }: {
  topics: TopicRow[]; selectedTopic: string|null; onSelect: (t: string|null) => void;
}) {
  if (topics.length === 0) return null;
  const max = Math.max(1, ...topics.map(t => t.cnt));

  return (
    <div className="flex flex-wrap gap-2 items-end justify-center px-4 py-6 bg-gray-50 rounded-2xl min-h-[120px]">
      {topics.map((t, i) => {
        const ratio = t.cnt / max;
        const fontSize = Math.round(12 + ratio * 26); // 12px–38px
        const weight   = ratio > 0.6 ? 800 : ratio > 0.3 ? 700 : 500;
        const color    = TOPIC_PALETTE[i % TOPIC_PALETTE.length];
        const active   = selectedTopic === t.topic;
        return (
          <button key={t.topic} onClick={() => onSelect(active ? null : t.topic)}
            title={`${t.topic}: ${t.cnt} call${t.cnt !== 1 ? 's' : ''}`}
            className={`leading-none transition-all rounded-lg px-2 py-1 ${
              active
                ? 'ring-2 ring-offset-1 ring-blue-500 scale-110'
                : 'hover:opacity-80 hover:scale-105'}`}
            style={{
              fontSize,
              fontWeight: weight,
              color: active ? '#1d4ed8' : color,
              background: active ? '#eff6ff' : 'transparent',
            }}>
            {t.topic}
            <sup className="ml-0.5 text-gray-400" style={{ fontSize: 9 }}>{t.cnt}</sup>
          </button>
        );
      })}
    </div>
  );
}

// ─── Heatmap ─────────────────────────────────────────────────────────────────

function TopicHeatmap({ topics, topicDays, selectedTopic, onSelect }: {
  topics: TopicRow[]; topicDays: TopicDay[];
  selectedTopic: string|null; onSelect: (t: string|null) => void;
}) {
  const byTopicDay = useMemo(() => {
    const map: Record<string, Record<string, number>> = {};
    topicDays.forEach(({ topic, day, cnt }) => {
      if (!map[topic]) map[topic] = {};
      map[topic][day] = cnt;
    });
    return map;
  }, [topicDays]);

  const allDays = useMemo(() =>
    Array.from(new Set(topicDays.map(r => r.day))).sort().slice(-14),
  [topicDays]);

  const maxCnt = useMemo(() =>
    Math.max(1, ...topicDays.map(r => r.cnt)),
  [topicDays]);

  if (topics.length === 0) return <p className="text-sm text-gray-400">No topic data.</p>;

  const intensity = (c: number) => {
    const r = c / maxCnt;
    if (r === 0)   return { bg: '#f1f5f9', text: '#94a3b8' };
    if (r < 0.25)  return { bg: '#bfdbfe', text: '#1e40af' };
    if (r < 0.5)   return { bg: '#60a5fa', text: '#fff' };
    if (r < 0.75)  return { bg: '#2563eb', text: '#fff' };
    return { bg: '#1d4ed8', text: '#fff' };
  };

  return (
    <div className="space-y-5">
      {/* Word cloud */}
      <TopicWordCloud topics={topics} selectedTopic={selectedTopic} onSelect={onSelect} />
      {/* Date grid heatmap */}
      <div className="overflow-x-auto">
      <table className="border-collapse w-full" style={{ minWidth: 540 }}>
        <thead>
          <tr>
            <th className="text-left text-xs text-gray-400 pb-2 pr-3 w-32">Topic</th>
            {allDays.map(d => (
              <th key={d} className="text-center text-xs text-gray-400 pb-2 px-0.5 min-w-[34px]">
                {format(parseISO(d), 'dd/MM')}
              </th>
            ))}
            <th className="text-center text-xs text-gray-400 pb-2 pl-2 w-12">Total</th>
          </tr>
        </thead>
        <tbody>
          {topics.map((t, i) => {
            const active = selectedTopic === t.topic;
            const color  = TOPIC_PALETTE[i % TOPIC_PALETTE.length];
            return (
              <tr key={t.topic}
                onClick={() => onSelect(active ? null : t.topic)}
                className={`cursor-pointer transition-all ${active ? 'outline outline-2 outline-blue-500 rounded' : 'hover:bg-gray-50'}`}
              >
                <td className="py-1 pr-3">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
                    <span className={`text-xs font-medium truncate max-w-[90px] ${active ? 'text-blue-700' : 'text-gray-700'}`}>{t.topic}</span>
                  </div>
                </td>
                {allDays.map(d => {
                  const c = byTopicDay[t.topic]?.[d] ?? 0;
                  const { bg, text } = intensity(c);
                  return (
                    <td key={d} className="px-0.5 py-1">
                      <div className="h-7 rounded text-xs flex items-center justify-center font-medium leading-none"
                        style={{ background: bg, color: text, minWidth: 28 }}
                        title={c > 0 ? `${c} call${c > 1?'s':''} on ${format(parseISO(d), 'dd MMM')}` : ''}>
                        {c > 0 ? c : ''}
                      </div>
                    </td>
                  );
                })}
                <td className="pl-2 py-1 text-center">
                  <span className="inline-block px-1.5 py-0.5 rounded-full text-xs font-bold text-white"
                    style={{ background: color }}>{t.cnt}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {/* Legend */}
      <div className="flex items-center gap-3 mt-3 pt-2 border-t border-gray-100">
        <span className="text-xs text-gray-400">Volume:</span>
        {[['Low','#bfdbfe','#1e40af'],['Mid','#60a5fa','#fff'],['High','#2563eb','#fff'],['Peak','#1d4ed8','#fff']].map(([l,bg,t]) => (
          <div key={l} className="flex items-center gap-1">
            <div className="w-6 h-5 rounded text-[10px] flex items-center justify-center font-medium"
              style={{ background: bg, color: t }}>{l[0]}</div>
            <span className="text-xs text-gray-400">{l}</span>
          </div>
        ))}
      </div>
      </div>
    </div>
  );
}

// ─── Recording row ────────────────────────────────────────────────────────────

function RecRow({ rec }: { rec: Recording }) {
  const [open, setOpen] = useState(false);
  const [full, setFull]   = useState(false);
  return (
    <div className={`border rounded-xl overflow-hidden transition-all ${open ? 'border-blue-200 bg-blue-50/20' : 'border-gray-200 bg-white'}`}>
      <button onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50/60">
        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold shrink-0 ${
          rec.call_type === 'bot' ? 'bg-purple-100 text-purple-700' : 'bg-emerald-100 text-emerald-700'}`}>
          {rec.call_type === 'bot' ? 'Bot' : 'Human'}
        </span>
        <span className="text-xs text-gray-400 w-16 shrink-0 capitalize">{rec.direction}</span>
        <span className="text-sm text-gray-700 flex-1 truncate">{rec.agent_name ?? rec.caller_number ?? '—'}</span>
        <div className="flex gap-1 shrink-0">
          {rec.tags.slice(0,3).map(t => (
            <span key={t} className="px-1.5 py-0.5 rounded text-xs font-medium text-white"
              style={{ background: TOPIC_PALETTE[Math.abs(t.charCodeAt(0) * 7) % TOPIC_PALETTE.length] }}>{t}</span>
          ))}
        </div>
        <span className="text-xs text-gray-400 shrink-0 w-28 text-right">
          {format(parseISO(rec.started_at ?? rec.created_at), 'dd MMM yyyy HH:mm')}
        </span>
        <svg className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${open?'rotate-180':''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="border-t border-gray-100 px-4 pb-4 pt-3 space-y-3">
          <div className="flex gap-5 text-xs text-gray-500">
            <span>Duration: <strong>{fmtMins(rec.duration_s)}</strong></span>
            {rec.caller_number && <span>Caller: <strong>{rec.caller_number}</strong></span>}
            {rec.source && <span>Source: <strong>{rec.source}</strong></span>}
          </div>
          {rec.recording_url ? (
            <audio controls className="w-full h-9" preload="none">
              <source src={rec.recording_url} type="audio/mpeg" />
            </audio>
          ) : <p className="text-xs text-gray-400 italic">No audio file available</p>}
          {rec.transcript && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1">Transcript</p>
              <div className="p-3 bg-white border border-gray-200 rounded-lg text-xs font-mono text-gray-700 leading-relaxed max-h-40 overflow-y-auto whitespace-pre-wrap">
                {full ? rec.transcript : rec.transcript.slice(0,300) + (rec.transcript.length > 300 ? '…' : '')}
              </div>
              {rec.transcript.length > 300 && (
                <button onClick={() => setFull(v=>!v)} className="mt-1 text-xs text-blue-600 hover:underline">
                  {full ? 'Show less' : 'Show full transcript'}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function CallInsights() {
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 14);
    return d.toISOString().split('T')[0];
  });
  const [dateTo, setDateTo]     = useState(() => new Date().toISOString().split('T')[0]);
  const [callType, setCallType] = useState<'all'|'bot'|'human'>('all');
  const [selTopic, setSelTopic] = useState<string|null>(null);
  const [recPage, setRecPage]   = useState(1);

  // ── Insights data ──────────────────────────────────────────────────────────
  const { data: raw, isLoading } = useQuery<{ data: InsightsData }>({
    queryKey: ['cx-insights', dateFrom, dateTo, callType],
    queryFn: () => api.get('/api/v1/recordings/insights', {
      params: { dateFrom, dateTo, callType },
    }).then(r => r.data),
  });
  const d = raw?.data;

  // ── Recordings list ────────────────────────────────────────────────────────
  const recParams: Record<string,string> = {
    page: String(recPage), pageSize: '10',
    ...(callType !== 'all' ? { type: callType } : {}),
    ...(selTopic ? { tag: selTopic } : {}),
  };
  const { data: recRaw, isLoading: recLoad } = useQuery<{ data: Recording[]; meta: any }>({
    queryKey: ['cx-recordings', callType, selTopic, recPage],
    queryFn: () => api.get('/api/v1/recordings', { params: recParams }).then(r => r.data),
  });
  const recordings = recRaw?.data ?? [];
  const recMeta    = recRaw?.meta;

  // ── Chart prep ─────────────────────────────────────────────────────────────
  const byDayChart = useMemo(() => (d?.by_day ?? []).map(r => ({
    day: format(parseISO(r.day), 'dd/MM'),
    'Bot':   r.bot_cnt,
    'Human': r.human_cnt,
    'Avg (s)': r.avg_dur,
  })), [d]);

  const byHourChart = useMemo(() => {
    const filled = Array.from({ length: 24 }, (_, i) => ({ hour: i, cnt: 0 }));
    (d?.by_hour ?? []).forEach(r => { filled[r.hour].cnt = r.cnt; });
    return filled.map(r => ({ hour: `${r.hour}:00`, Calls: r.cnt }));
  }, [d]);

  const durChart = useMemo(() =>
    DUR_ORDER.map(b => ({
      bucket: b,
      Calls: (d?.by_duration ?? []).find(r => r.bucket === b)?.cnt ?? 0,
    })),
  [d]);

  const dirChart = useMemo(() => (d?.by_direction ?? []).map(r => ({
    name: r.direction === 'inbound' ? 'Inbound' : 'Outbound',
    value: r.cnt,
  })), [d]);

  const topicChart = useMemo(() =>
    (d?.topics ?? []).slice(0, 10).map((t, i) => ({
      topic: t.topic,
      Calls: t.cnt,
      fill:  TOPIC_PALETTE[i % TOPIC_PALETTE.length],
    })),
  [d]);

  const kpi = d?.kpi;

  return (
    <div className="p-6 space-y-8">

      {/* ── Header + filters ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">CX Insights</h1>
          <p className="text-sm text-gray-400 mt-0.5">Call centre analytics — voice bot & human agent calls</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {/* Type filter */}
          <div className="flex rounded-xl border border-gray-200 overflow-hidden bg-white shadow-sm">
            {(['all','bot','human'] as const).map(t => (
              <button key={t} onClick={() => { setCallType(t); setSelTopic(null); setRecPage(1); }}
                className={`px-4 py-2 text-sm font-medium capitalize transition-all ${
                  callType === t ? 'bg-[#29ABE2] text-white' : 'text-gray-500 hover:bg-gray-50'}`}>
                {t === 'all' ? 'All Calls' : t === 'bot' ? '🤖 Voice Bot' : '👤 Human'}
              </button>
            ))}
          </div>
          {/* Date range */}
          <input type="date" value={dateFrom}
            onChange={e => { setDateFrom(e.target.value); setSelTopic(null); setRecPage(1); }}
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-[#29ABE2]" />
          <span className="text-gray-400 text-sm">—</span>
          <input type="date" value={dateTo}
            onChange={e => { setDateTo(e.target.value); setSelTopic(null); setRecPage(1); }}
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-[#29ABE2]" />
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-48 text-gray-400">Loading analytics…</div>
      ) : (
        <>
          {/* ── KPI Row ──────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
            <KpiCard label="Total Calls"      value={kpi?.total_calls ?? 0} />
            <KpiCard label="Inbound"          value={kpi?.inbound ?? 0}      sub={pct(kpi?.inbound ?? 0, kpi?.total_calls ?? 0)} color="#10b981" />
            <KpiCard label="Outbound"         value={kpi?.outbound ?? 0}     sub={pct(kpi?.outbound ?? 0, kpi?.total_calls ?? 0)} color="#f59e0b" />
            <KpiCard label="Voice Bot"        value={kpi?.bot_calls ?? 0}    sub={pct(kpi?.bot_calls ?? 0, kpi?.total_calls ?? 0)} color={BOT_CLR} />
            <KpiCard label="Human Agent"      value={kpi?.human_calls ?? 0}  sub={pct(kpi?.human_calls ?? 0, kpi?.total_calls ?? 0)} color={HUM_CLR} />
            <KpiCard label="Avg Handle Time"  value={fmtMins(kpi?.avg_duration_s ?? null)} sub={`Bot: ${fmtSec(kpi?.avg_bot_s??null)} · Human: ${fmtSec(kpi?.avg_human_s??null)}`} color={BRAND} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard label="With Recording"   value={kpi?.with_recording ?? 0} sub={pct(kpi?.with_recording??0, kpi?.total_calls??0)} />
            <KpiCard label="Tagged Calls"     value={kpi?.tagged_calls ?? 0}   sub={pct(kpi?.tagged_calls??0, kpi?.total_calls??0)} />
            <KpiCard label="Longest Call"     value={fmtMins(kpi?.max_duration_s??null)} />
            <KpiCard label="Shortest Call"    value={fmtMins(kpi?.min_duration_s??null)} />
          </div>

          {/* ── Call Volume by Day ───────────────────────────────────────── */}
          <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
            <SectionTitle title="Call Volume" sub="Daily call volume — voice bot vs human agent" />
            {byDayChart.length === 0 ? <p className="text-sm text-gray-400">No data for this period.</p> : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={byDayChart} barGap={2} barCategoryGap="30%">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} width={24} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="Bot"   fill={BOT_CLR} radius={[4,4,0,0]} />
                  <Bar dataKey="Human" fill={HUM_CLR} radius={[4,4,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* ── Hourly distribution + Direction split ────────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Hourly */}
            <div className="md:col-span-2 bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
              <SectionTitle title="Calls by Hour of Day" sub="When customers call — peak hours" />
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={byHourChart} barCategoryGap="20%">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="hour" tick={{ fontSize: 10, fill: '#94a3b8' }} interval={2} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#94a3b8' }} width={20} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="Calls" radius={[3,3,0,0]}>
                    {byHourChart.map((_, i) => (
                      <Cell key={i} fill={i >= 9 && i <= 17 ? BRAND : '#cbd5e1'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <p className="text-xs text-gray-400 mt-1">Blue = business hours (09:00–17:00)</p>
            </div>

            {/* Direction donut */}
            <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
              <SectionTitle title="Inbound vs Outbound" />
              {dirChart.length === 0 ? <p className="text-sm text-gray-400">No data.</p> : (
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie data={dirChart} dataKey="value" nameKey="name"
                      cx="50%" cy="50%" innerRadius={48} outerRadius={72}
                      paddingAngle={3} label={({ name, percent }) => `${name} ${Math.round(percent*100)}%`}
                      labelLine={false} fontSize={11}>
                      {dirChart.map((_, i) => (
                        <Cell key={i} fill={i === 0 ? HUM_CLR : WARN} />
                      ))}
                    </Pie>
                    <Tooltip content={<CustomTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              )}
              <div className="flex justify-center gap-4 mt-1">
                <div className="flex items-center gap-1.5 text-xs text-gray-500">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: HUM_CLR }} />Inbound
                </div>
                <div className="flex items-center gap-1.5 text-xs text-gray-500">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: WARN }} />Outbound
                </div>
              </div>
            </div>
          </div>

          {/* ── Duration buckets + Top agents ───────────────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Duration */}
            <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
              <SectionTitle title="Call Duration Buckets" sub="Distribution of call lengths" />
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={durChart} layout="vertical" barCategoryGap="25%">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} />
                  <YAxis type="category" dataKey="bucket" width={70} tick={{ fontSize: 11, fill: '#64748b' }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="Calls" radius={[0,4,4,0]} fill={BRAND} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Top agents */}
            <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
              <SectionTitle title="Top Agents by Call Volume" sub="Human agent calls only" />
              {(d?.top_agents ?? []).length === 0 ? (
                <p className="text-sm text-gray-400">No human agent calls in this period.</p>
              ) : (
                <div className="space-y-2 mt-1">
                  {(d?.top_agents ?? []).map((a, i) => (
                    <div key={a.agent_name} className="flex items-center gap-3">
                      <span className="text-xs text-gray-400 w-5 text-right">{i + 1}</span>
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-xs font-medium text-gray-700 truncate">{a.agent_name}</span>
                          <span className="text-xs text-gray-400 ml-2 shrink-0">{a.cnt} calls · avg {fmtSec(a.avg_dur)}</span>
                        </div>
                        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{
                            background: TOPIC_PALETTE[i % TOPIC_PALETTE.length],
                            width: `${Math.round((a.cnt / (d?.top_agents?.[0]?.cnt ?? 1)) * 100)}%`,
                          }} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── Topic frequency bar ──────────────────────────────────────── */}
          {topicChart.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
              <SectionTitle title="Top Discussion Topics" sub="Most common call topics across all recordings — click to filter" />
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={topicChart} barCategoryGap="30%">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="topic" tick={{ fontSize: 11, fill: '#64748b' }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} width={24} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="Calls" radius={[5,5,0,0]} onClick={(e: any) => {
                    setSelTopic(selTopic === e.topic ? null : e.topic);
                    setRecPage(1);
                  }}>
                    {topicChart.map((t, i) => (
                      <Cell key={t.topic}
                        fill={selTopic === t.topic ? '#1d4ed8' : t.fill}
                        opacity={selTopic && selTopic !== t.topic ? 0.35 : 1}
                        cursor="pointer" />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* ── Topic Heatmap ─────────────────────────────────────────────── */}
          <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <div>
                <SectionTitle title="Topic Heatmap" sub="Click any row to filter recordings below" />
              </div>
              {selTopic && (
                <button onClick={() => { setSelTopic(null); setRecPage(1); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 border border-blue-200 text-blue-700 rounded-lg text-xs font-medium hover:bg-blue-100">
                  ✕ Clear: {selTopic}
                </button>
              )}
            </div>
            <TopicHeatmap
              topics={d?.topics ?? []}
              topicDays={d?.topic_by_day ?? []}
              selectedTopic={selTopic}
              onSelect={t => { setSelTopic(t); setRecPage(1); }}
            />
          </div>

          {/* ── Filter chips ─────────────────────────────────────────────── */}
          {(d?.topics ?? []).length > 0 && (
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-xs text-gray-400 font-medium">Filter by topic:</span>
              {(d?.topics ?? []).map((t, i) => {
                const active = selTopic === t.topic;
                const color  = TOPIC_PALETTE[i % TOPIC_PALETTE.length];
                return (
                  <button key={t.topic}
                    onClick={() => { setSelTopic(active ? null : t.topic); setRecPage(1); }}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                      active ? 'text-white border-transparent' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}
                    style={active ? { background: color, borderColor: color } : {}}>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: active ? 'rgba(255,255,255,0.8)' : color }} />
                    {t.topic}
                    <span className={active ? 'text-white/70' : 'text-gray-400'}>{t.cnt}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* ── Recordings list ──────────────────────────────────────────── */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-800 uppercase tracking-wide">
                {selTopic ? (
                  <span className="flex items-center gap-2">
                    Calls tagged
                    <span className="px-2 py-0.5 rounded-full text-sm text-white normal-case"
                      style={{ background: TOPIC_PALETTE[(d?.topics?.findIndex(t => t.topic === selTopic) ?? 0) % TOPIC_PALETTE.length] }}>
                      {selTopic}
                    </span>
                  </span>
                ) : callType === 'all' ? 'All Recordings' : callType === 'bot' ? '🤖 Voice Bot Recordings' : '👤 Human Agent Recordings'}
              </h2>
              {recMeta && <span className="text-sm text-gray-400">{recMeta.total} call{recMeta.total !== 1 ? 's' : ''}</span>}
            </div>

            {recLoad ? (
              <div className="h-20 flex items-center justify-center text-gray-400 text-sm">Loading…</div>
            ) : recordings.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-24 text-gray-400 gap-2">
                <span className="text-sm">No recordings for this filter</span>
              </div>
            ) : (
              <div className="space-y-2">
                {recordings.map(rec => <RecRow key={`${rec.call_type}-${rec.id}`} rec={rec} />)}
              </div>
            )}

            {recMeta && recMeta.totalPages > 1 && (
              <div className="flex items-center justify-between pt-4">
                <button disabled={recPage <= 1} onClick={() => setRecPage(p => p - 1)}
                  className="px-4 py-2 text-sm border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50">Previous</button>
                <span className="text-sm text-gray-400">Page {recMeta.page} of {recMeta.totalPages}</span>
                <button disabled={recPage >= recMeta.totalPages} onClick={() => setRecPage(p => p + 1)}
                  className="px-4 py-2 text-sm border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50">Next</button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
