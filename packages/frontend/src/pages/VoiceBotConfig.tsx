/**
 * Voice Bot Configuration page
 *
 * Phase 1 — Connect a third-party AI voice provider (Vapi, Retell, Bland.ai)
 * that handles SIP connectivity and customer calls.
 *
 * Layout:
 *  • Provider selector cards (Vapi / Retell AI / Bland.ai)
 *  • Step-by-step setup guide per provider
 *  • Webhook URL (copy-to-clipboard) to paste into provider dashboard
 *  • Bot behaviour settings (greeting, system prompt, language, voice ID)
 *  • Ticket creation rules (auto-create, default queue, priority, urgency keywords)
 *  • Test call button — dials a number to verify the integration
 *  • Live stats strip (total calls, tickets auto-created, avg duration)
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Bot, Phone, Copy, CheckCircle2, ChevronRight, ExternalLink,
  Settings2, Ticket, Zap, AlertCircle, Loader2, PhoneCall,
  Info, ToggleLeft, ToggleRight, ChevronDown, List,
  BookOpen, Trash2, FileText, Link2, Type, Plus,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../store/auth.store';
import { api } from '../services/api';
import { useIsSuperAdmin } from '../hooks/useRole';
import { TestCallNadiaButton } from '../components/TestCallNadiaButton';

// ── Types ─────────────────────────────────────────────────────────────────

interface IvrOption {
  option:      number;
  intent:      'complaint' | 'inquiry' | 'sales' | 'agent';
  label:       string;
  ticketType?: 'complaint' | 'inquiry' | 'sales';
  queueId?:    string | null;
  description?: string;
}

interface BotConfig {
  id?: string;
  provider: string;
  is_active: boolean;
  assistant_id?: string;
  phone_number?: string;
  greeting_message?: string;
  system_prompt?: string;
  guardrails?: string;
  language: string;
  voice_id?: string;
  auto_create_ticket: boolean;
  recording_enabled?: boolean;
  default_queue_id?: string;
  default_priority: string;
  keyword_urgency: string[];
  self_service_intents: string[];
  queue_name?: string;
  ivr_menu?: { option: number; label: string; intent?: string; ticketType?: string; queueId?: string | null; action?: string }[];
  sip_uri?: string;
  // Self-hosted (livekit) provider only
  bot_name?: string;
  tone?: string;
  speaking_rate?: number;
  sip_trunk_provider?: string;
  sip_trunk_number?: string;
  sip_trunk_username?: string;
  sip_trunk_password?: string;
  sip_trunk_nickname?: string;
  outbound_transport?: string;
}

interface TicketQueue { id: string; name: string; }

interface Voice { id: string; provider: string; voice_id: string; label: string; description?: string; }

interface CustomIntent { id: string; intent_key: string; label: string; keywords: string[]; }

interface WebhookUrls { vapi: string; retell: string; bland: string; }

interface Stats {
  summary: {
    total_calls: string;
    calls_with_tickets: string;
    avg_duration: string;
    unique_callers: string;
    urgent_calls: string;
  };
}

interface Usage {
  allocatedMinutes: number;
  consumedMinutesAllTime: number;
  remainingMinutes: number;
  period: { label: string; consumedMinutes: number; callCount: number };
}

// ── Provider definitions ──────────────────────────────────────────────────

const PROVIDERS = [
  {
    id: 'vapi',
    name: 'Vapi',
    tagline: 'The developer platform for voice AI',
    description: 'Build, test and deploy AI voice agents. Best-in-class LLM routing and real-time transcription.',
    logo: '🤖',
    color: '#7c3aed',
    docsUrl: 'https://docs.vapi.ai',
    dashboardUrl: 'https://dashboard.vapi.ai',
    setupSteps: [
      'Create an account at dashboard.vapi.ai',
      'Build an assistant — set system prompt, voice model and language',
      'Under "Phone Numbers" → add a number and link it to your assistant',
      'Copy your API Key and Assistant ID from the dashboard',
      'Paste them in the Connectors page (Integrations → Vapi)',
      'Copy the Webhook URL below and paste it in Vapi → Assistant → Server URL',
    ],
  },
  {
    id: 'retell',
    name: 'Retell AI',
    tagline: 'Human-like AI phone agents',
    description: 'Production-ready voice agents with ultra-low latency. Built-in sentiment analysis and call summaries.',
    logo: '📲',
    color: '#0891b2',
    docsUrl: 'https://docs.retellai.com',
    dashboardUrl: 'https://app.retellai.com',
    setupSteps: [
      'Sign up at app.retellai.com',
      'Create an Agent — configure LLM, voice and response rules',
      'Under "Phone Numbers" → purchase/import a number and link to the agent',
      'Copy your API Key and Agent ID',
      'Paste them in the Connectors page (Integrations → Retell AI)',
      'Copy the Webhook URL below and set it in Retell → Agent → Webhook',
    ],
  },
  {
    id: 'bland',
    name: 'Bland.ai',
    tagline: 'AI phone calls at scale',
    description: 'High-volume inbound & outbound AI calls. Supports complex call flows and custom voices.',
    logo: '📣',
    color: '#059669',
    docsUrl: 'https://docs.bland.ai',
    dashboardUrl: 'https://app.bland.ai',
    setupSteps: [
      'Create an account at app.bland.ai',
      'Navigate to "Inbound" → create a new pathway for customer support',
      'Purchase or port your helpline number and attach it to the pathway',
      'Copy your API Key from the dashboard',
      'Paste it in the Connectors page (Integrations → Bland.ai)',
      'Copy the Webhook URL below and set it in Bland → Settings → Webhooks',
    ],
  },
  {
    id: 'livekit',
    name: 'Self-Hosted Voice Bot',
    tagline: 'Your own AI agent — no per-minute vendor fees',
    description: 'Runs on your own infrastructure with Urdu-first speech (Uplift AI voices). Ideal for Pakistani-market call volumes. Configure name, voice, tone and speed below.',
    logo: '🎙️',
    color: '#2BB8CC',
    docsUrl: 'https://docs.upliftai.org/orator_voices',
    dashboardUrl: 'https://platform.upliftai.org/studio/home',
    setupSteps: [
      'The voice agent service runs on your own server (services/nadia-voice-agent) — no third-party dashboard needed',
      'Configure the bot below: name, voice, tone, speaking speed, greeting and behaviour instructions',
      'The agent reads this configuration at the start of every call',
      'Tickets are created directly in this CRM when a call concludes — no webhook setup required',
      'Once your SIP trunk (e.g. Telecard) is connected, point your helpline number at the agent',
    ],
  },
];

// ── Reusable input style ──────────────────────────────────────────────────

const inputCls = "w-full bg-white border border-gray-200 text-gray-800 placeholder-gray-400 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-brand-500/60 transition-colors";

// ── Copy button ───────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border border-gray-100 hover:border-brand-500/50 text-gray-400 hover:text-brand-600"
    >
      {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

// ── Stats strip ───────────────────────────────────────────────────────────

function StatsStrip({ stats }: { stats?: Stats }) {
  const s = stats?.summary;
  const items = [
    { label: 'Total calls', value: s?.total_calls ?? '—', color: 'text-gray-900' },
    { label: 'Tickets auto-created', value: s?.calls_with_tickets ?? '—', color: 'text-brand-400' },
    { label: 'Avg duration', value: s?.avg_duration ? `${Math.round(parseFloat(s.avg_duration))}s` : '—', color: 'text-gray-900' },
    { label: 'Unique callers', value: s?.unique_callers ?? '—', color: 'text-gray-900' },
    { label: 'Urgent calls', value: s?.urgent_calls ?? '—', color: 'text-orange-400' },
  ];
  return (
    <div className="grid grid-cols-5 gap-3 mb-6">
      {items.map(({ label, value, color }) => (
        <div key={label} className="rounded-xl px-4 py-3 border border-gray-100"
             style={{ background: '#ffffff' }}>
          <p className={`text-xl font-bold ${color}`}>{value}</p>
          <p className="text-xs text-gray-500 mt-0.5">{label}</p>
        </div>
      ))}
    </div>
  );
}

// ── Minutes usage card ───────────────────────────────────────────────────

function MinutesUsageCard({ usage, period, onPeriodChange }: { usage?: Usage; period: string; onPeriodChange: (p: string) => void }) {
  const allocated = usage?.allocatedMinutes ?? 0;
  const remaining = usage?.remainingMinutes ?? 0;
  const pctUsed = allocated > 0 ? Math.min(100, Math.round(((allocated - remaining) / allocated) * 100)) : 0;
  const lowBalance = allocated > 0 && remaining <= allocated * 0.1;

  return (
    <div className="mb-6 rounded-2xl border border-gray-100 p-5" style={{ background: '#ffffff' }}>
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm text-gray-900 font-semibold">Voice Bot Minutes</span>
        <select value={period} onChange={e => onPeriodChange(e.target.value)}
          className="bg-white border border-gray-200 text-gray-500 rounded-lg px-2 py-1 text-xs outline-none">
          <option value="today">Today</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="month">This month</option>
          <option value="all">All time</option>
        </select>
      </div>
      {allocated === 0 ? (
        <p className="text-xs text-gray-500">No minutes have been allocated to this workspace yet — contact your platform provider.</p>
      ) : (
        <>
          <div className="w-full h-2 rounded-full bg-gray-200 overflow-hidden mb-3">
            <div className={`h-full rounded-full ${lowBalance ? 'bg-red-500' : 'bg-brand-400'}`} style={{ width: `${pctUsed}%` }} />
          </div>
          {lowBalance && <p className="text-xs text-red-400 mb-3">Running low — {remaining.toFixed(0)} minute(s) remaining. Calls will stop routing to the bot once minutes run out.</p>}
          <div className="grid grid-cols-4 gap-3 text-center">
            <div><p className="text-lg font-bold text-gray-900">{allocated.toFixed(0)}</p><p className="text-[10px] text-gray-500">Allocated</p></div>
            <div><p className="text-lg font-bold text-gray-900">{usage?.consumedMinutesAllTime.toFixed(0)}</p><p className="text-[10px] text-gray-500">Used (all time)</p></div>
            <div><p className={`text-lg font-bold ${lowBalance ? 'text-red-400' : 'text-brand-400'}`}>{remaining.toFixed(0)}</p><p className="text-[10px] text-gray-500">Remaining</p></div>
            <div><p className="text-lg font-bold text-gray-900">{usage?.period.consumedMinutes.toFixed(0)}</p><p className="text-[10px] text-gray-500">Used ({usage?.period.label})</p></div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Knowledge Base panel ────────────────────────────────────────────────
// Lets a tenant admin add reference material Nadia can answer from directly
// (branch hours, standard policies, published timelines) instead of always
// raising a ticket. Three ways in: typed text, a PDF/DOCX upload, or a URL.

interface KbEntry {
  id: string;
  title: string;
  content: string;
  keywords: string[];
  source_type: 'text' | 'file' | 'url';
  source_url: string | null;
  source_filename: string | null;
  is_active: boolean;
  created_at: string;
}

function KnowledgeBasePanel() {
  const qc = useQueryClient();
  const [mode, setMode] = useState<'text' | 'file' | 'url'>('text');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [url, setUrl] = useState('');
  const [keywords, setKeywords] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: entries, isLoading } = useQuery<KbEntry[]>({
    queryKey: ['voice-bot-kb'],
    queryFn: async () => { const r = await api.get('/api/v1/voice-bot/knowledge-base'); return r.data.data; },
  });

  const resetForm = () => { setTitle(''); setContent(''); setUrl(''); setKeywords(''); setFile(null); setError(null); };

  const addTextMut = useMutation({
    mutationFn: async () => {
      await api.post('/api/v1/voice-bot/knowledge-base', {
        title, content, keywords: keywords.split(',').map(k => k.trim()).filter(Boolean),
      });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['voice-bot-kb'] }); resetForm(); },
    onError: (e: any) => setError(e.response?.data?.error ?? 'Could not save that entry'),
  });

  const importUrlMut = useMutation({
    mutationFn: async () => {
      await api.post('/api/v1/voice-bot/knowledge-base/import-url', {
        title, url, keywords: keywords.split(',').map(k => k.trim()).filter(Boolean),
      });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['voice-bot-kb'] }); resetForm(); },
    onError: (e: any) => setError(e.response?.data?.error ?? 'Could not import that URL'),
  });

  const uploadMut = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('Choose a file first');
      const fd = new FormData();
      fd.append('file', file);
      fd.append('title', title);
      fd.append('keywords', keywords);
      await api.post('/api/v1/voice-bot/knowledge-base/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['voice-bot-kb'] }); resetForm(); },
    onError: (e: any) => setError(e.response?.data?.error ?? 'Could not read that file'),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => { await api.delete(`/api/v1/voice-bot/knowledge-base/${id}`); },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['voice-bot-kb'] }),
  });

  const toggleActiveMut = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      await api.put(`/api/v1/voice-bot/knowledge-base/${id}`, { isActive });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['voice-bot-kb'] }),
  });

  const submitting = addTextMut.isPending || importUrlMut.isPending || uploadMut.isPending;
  const submit = () => {
    setError(null);
    if (!title.trim()) return setError('Title is required');
    if (keywords.trim().split(',').filter(Boolean).length === 0) return setError('At least one keyword is required');
    if (mode === 'text') addTextMut.mutate();
    else if (mode === 'url') importUrlMut.mutate();
    else uploadMut.mutate();
  };

  return (
    <div className="border-t border-gray-100 pt-4">
      <div className="flex items-center gap-2 mb-1">
        <BookOpen className="w-4 h-4 text-brand-400" />
        <span className="text-sm text-gray-900 font-semibold">Knowledge Base</span>
      </div>
      <p className="text-xs text-gray-500 mb-4">
        Give Nadia reference material for general questions (branch hours, standard policies,
        published timelines) so she can answer directly instead of raising a ticket.
      </p>

      {entries && entries.length > 0 && (
        <div className="mb-4 divide-y divide-gray-100 border border-gray-200 rounded-lg overflow-hidden">
          {entries.map(e => (
            <div key={e.id} className="flex items-start justify-between gap-3 p-3 bg-white">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  {e.source_type === 'file' && <FileText className="w-3.5 h-3.5 text-gray-500 shrink-0" />}
                  {e.source_type === 'url' && <Link2 className="w-3.5 h-3.5 text-gray-500 shrink-0" />}
                  {e.source_type === 'text' && <Type className="w-3.5 h-3.5 text-gray-500 shrink-0" />}
                  <p className="text-sm text-gray-900 font-medium truncate">{e.title}</p>
                </div>
                <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{e.content}</p>
                <div className="flex flex-wrap gap-1 mt-1">
                  {e.keywords.map(k => (
                    <span key={k} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{k}</span>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button type="button" onClick={() => toggleActiveMut.mutate({ id: e.id, isActive: !e.is_active })}
                  title={e.is_active ? 'Active — click to disable' : 'Disabled — click to enable'}>
                  {e.is_active
                    ? <ToggleRight className="w-6 h-6 text-brand-400" />
                    : <ToggleLeft  className="w-6 h-6 text-gray-300"  />}
                </button>
                <button type="button" onClick={() => deleteMut.mutate(e.id)} title="Delete">
                  <Trash2 className="w-4 h-4 text-gray-400 hover:text-red-500" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {isLoading && <p className="text-xs text-gray-500 mb-4">Loading…</p>}
      {!isLoading && (!entries || entries.length === 0) && (
        <p className="text-xs text-gray-500 mb-4">No entries yet — add one below.</p>
      )}

      <div className="p-3 rounded-lg bg-gray-50 border border-gray-200">
        <div className="flex gap-1 mb-3">
          {(['text', 'file', 'url'] as const).map(m => (
            <button key={m} type="button" onClick={() => { setMode(m); setError(null); }}
              className={`text-xs px-3 py-1.5 rounded-lg font-medium ${mode === m ? 'bg-brand-400 text-white' : 'bg-white text-gray-500 border border-gray-200'}`}>
              {m === 'text' ? 'Type text' : m === 'file' ? 'Upload file' : 'Import URL'}
            </button>
          ))}
        </div>

        <input placeholder="Title (e.g. Branch Hours)" value={title} onChange={e => setTitle(e.target.value)}
          className="w-full mb-2 bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 outline-none" />

        {mode === 'text' && (
          <textarea rows={3} placeholder="The answer Nadia should give, in plain language"
            value={content} onChange={e => setContent(e.target.value)}
            className="w-full mb-2 bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 outline-none resize-none" />
        )}
        {mode === 'url' && (
          <input placeholder="https://your-site.com/faq" value={url} onChange={e => setUrl(e.target.value)}
            className="w-full mb-2 bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 outline-none" />
        )}
        {mode === 'file' && (
          <input type="file" accept=".pdf,.docx"
            onChange={e => setFile(e.target.files?.[0] ?? null)}
            className="w-full mb-2 text-sm text-gray-500" />
        )}

        <input placeholder="Keywords, comma separated (e.g. branch, hours, timing, open)"
          value={keywords} onChange={e => setKeywords(e.target.value)}
          className="w-full mb-2 bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 outline-none" />

        {error && <p className="text-xs text-red-500 mb-2">{error}</p>}

        <button type="button" onClick={submit} disabled={submitting}
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg bg-brand-400 text-white disabled:opacity-50">
          {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
          Add entry
        </button>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────

export function VoiceBotConfig() {
  const qc = useQueryClient();
  const { tenant } = useAuthStore();
  // Licensing the Voice Bot module doesn't automatically grant every provider —
  // each one must be individually allocated (voice_bot.provider.<id> feature key),
  // so a tenant only ever sees the provider(s) they were actually given.
  const entitledFeatures: string[] = (tenant as any)?.entitled_features ?? [];
  const allowedProviders = PROVIDERS.filter((p) => entitledFeatures.includes(`voice_bot.provider.${p.id}`));
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState<string | null>(null);
  const [testNumber, setTestNumber] = useState('');
  const [testResult, setTestResult] = useState<string | null>(null);
  const [formState, setFormState] = useState<Partial<BotConfig>>({});
  const [editMode, setEditMode] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  const { data: configResponse } = useQuery<{ data: BotConfig[]; ownership: 'super_admin' | 'tenant_admin' }>({
    queryKey: ['voice-bot-configs'],
    queryFn: async () => { const r = await api.get('/api/v1/voice-bot/config'); return r.data; },
  });
  const configs = configResponse?.data;
  const isCentrallyManaged = configResponse?.ownership === 'super_admin';

  const { data: webhookUrls } = useQuery<WebhookUrls>({
    queryKey: ['voice-bot-webhook-urls'],
    queryFn: async () => { const r = await api.get('/api/v1/voice-bot/webhook-url'); return r.data.data; },
  });

  const { data: stats } = useQuery<Stats>({
    queryKey: ['voice-bot-stats'],
    queryFn: async () => { const r = await api.get('/api/v1/voice-bot/stats'); return r.data.data; },
    staleTime: 60_000,
  });

  const [usagePeriod, setUsagePeriod] = useState('30d');
  const { data: usage } = useQuery<Usage>({
    queryKey: ['voice-bot-usage', usagePeriod],
    queryFn: async () => { const r = await api.get(`/api/v1/voice-bot/usage?period=${usagePeriod}`); return r.data.data; },
    staleTime: 30_000,
  });

  const { data: queues } = useQuery<TicketQueue[]>({
    queryKey: ['ticket-queues-mini'],
    queryFn: async () => { const r = await api.get('/api/v1/tickets/queues'); return r.data.data; },
  });

  const { data: voices } = useQuery<Voice[]>({
    queryKey: ['voice-bot-voices'],
    queryFn: async () => { const r = await api.get('/api/v1/voice-bot/voices'); return r.data.data; },
  });

  const { data: customIntents } = useQuery<CustomIntent[]>({
    queryKey: ['voice-bot-custom-intents'],
    queryFn: async () => { const r = await api.get('/api/v1/voice-bot/custom-intents'); return r.data.data; },
  });

  const isSuperAdmin = useIsSuperAdmin();
  const [newVoice, setNewVoice] = useState({ voiceId: '', label: '' });
  const [newIntent, setNewIntent] = useState({ label: '', keywords: '' });

  const addVoiceMut = useMutation({
    mutationFn: async () => api.post('/api/v1/voice-bot/voices', { voiceId: newVoice.voiceId, label: newVoice.label }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['voice-bot-voices'] }); setNewVoice({ voiceId: '', label: '' }); },
  });
  const removeVoiceMut = useMutation({
    mutationFn: async (id: string) => api.delete(`/api/v1/voice-bot/voices/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['voice-bot-voices'] }),
  });

  const addIntentMut = useMutation({
    mutationFn: async () => api.post('/api/v1/voice-bot/custom-intents', {
      label: newIntent.label,
      keywords: newIntent.keywords.split(',').map(k => k.trim()).filter(Boolean),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['voice-bot-custom-intents'] }); setNewIntent({ label: '', keywords: '' }); },
  });
  const removeIntentMut = useMutation({
    mutationFn: async (id: string) => api.delete(`/api/v1/voice-bot/custom-intents/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['voice-bot-custom-intents'] }),
  });

  const saveMut = useMutation({
    mutationFn: async (body: Partial<BotConfig>) => {
      const r = await api.put('/api/v1/voice-bot/config', {
        provider:         body.provider,
        isActive:         body.is_active,
        assistantId:      body.assistant_id,
        phoneNumber:      body.phone_number,
        greetingMessage:  body.greeting_message,
        systemPrompt:     body.system_prompt,
        language:         body.language,
        voiceId:          body.voice_id,
        autoCreateTicket:    body.auto_create_ticket,
        recordingEnabled:    body.recording_enabled,
        defaultQueueId:      body.default_queue_id || null,
        defaultPriority:     body.default_priority,
        keywordUrgency:      body.keyword_urgency,
        ivrMenu:             body.ivr_menu,
        sipUri:              body.sip_uri,
        selfServiceIntents:  body.self_service_intents ?? [],
        // Self-hosted (livekit) knobs — ignored by hosted providers
        botName:             body.bot_name,
        tone:                body.tone,
        speakingRate:        body.speaking_rate != null ? Number(body.speaking_rate) : undefined,
        sipTrunkProvider:    body.sip_trunk_provider,
        sipTrunkNumber:      body.sip_trunk_number,
        sipTrunkUsername:    body.sip_trunk_username,
        sipTrunkPassword:    body.sip_trunk_password,
        sipTrunkNickname:    body.sip_trunk_nickname,
        outboundTransport:   body.outbound_transport,
        guardrails:          body.guardrails,
      });
      return r.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['voice-bot-configs'] });
      setSaveMsg('Configuration saved!');
      setEditMode(false);
      setTimeout(() => setSaveMsg(''), 3000);
    },
  });

  const testMut = useMutation({
    mutationFn: async () => {
      const r = await api.post('/api/v1/voice-bot/test-call', {
        provider: selectedProvider,
        toNumber: testNumber,
      });
      return r.data;
    },
    onSuccess: (data) => {
      setTestResult(data.success ? '✅ Test call initiated successfully!' : `❌ ${data.error?.message ?? 'Failed'}`);
    },
    onError: (err: any) => {
      setTestResult(`❌ ${err.response?.data?.error?.message ?? 'Failed to initiate call'}`);
    },
  });

  const activeConfig = configs?.find(c => c.provider === selectedProvider);

  const startEdit = (cfg?: BotConfig) => {
    const isSelfHosted = selectedProvider === 'livekit';
    setFormState(cfg ?? {
      provider: selectedProvider ?? 'vapi',
      is_active: true,
      language: isSelfHosted ? 'ur-PK' : 'en-US',
      auto_create_ticket: true,
      default_priority: 'medium',
      keyword_urgency: ['urgent','emergency','critical','asap','immediately'],
      self_service_intents: [],
      ...(isSelfHosted ? {
        bot_name: 'Nadia',
        voice_id: 'helpdesk-agent',
        tone: 'empathetic',
        speaking_rate: 0.9,
      } : {}),
    });
    setEditMode(true);
  };

  return (
    <div className="min-h-screen p-6 bg-gray-50">
      <div className="max-w-5xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                 style={{ background: 'linear-gradient(135deg, #29ABE2 0%, #4D8B3C 100%)' }}>
              <Bot className="w-5 h-5 text-gray-900" />
            </div>
            <div>
              <h1 className="text-gray-900 font-bold text-xl">Voice Bot</h1>
              <p className="text-gray-500 text-xs">Phase 1 — Third-party AI provider integration via SIP</p>
            </div>
          </div>
          <Link to="/voice-bot/calls"
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm text-brand-600 border border-brand-200 hover:bg-brand-50 transition-colors">
            <List className="w-4 h-4" />View Bot Calls
          </Link>
        </div>

        {/* Stats strip */}
        <StatsStrip stats={stats} />

        {/* Minutes usage */}
        <MinutesUsageCard usage={usage} period={usagePeriod} onPeriodChange={setUsagePeriod} />

        {/* How it works banner */}
        <div className="mb-6 px-5 py-4 rounded-2xl border border-brand-700/30"
             style={{ background: 'rgba(41,171,226,0.06)' }}>
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-brand-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-gray-900 font-semibold text-sm mb-1">How Phase 1 works</p>
              <div className="flex items-center gap-2 flex-wrap text-xs text-gray-400">
                {[
                  'Customer calls your helpline',
                  'AI voice bot answers via SIP',
                  'Bot collects complaint details',
                  'Call ends → provider sends webhook',
                  'Ticket auto-created in CRM',
                  'Agent receives notification',
                ].map((step, i, arr) => (
                  <span key={step} className="flex items-center gap-2">
                    <span className="text-gray-900/70">{step}</span>
                    {i < arr.length - 1 && <ChevronRight className="w-3 h-3 text-brand-600" />}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Provider selector */}
        <p className="text-xs text-gray-500 font-semibold uppercase tracking-widest mb-3">
          Select your AI voice provider
        </p>
        {allowedProviders.length === 0 && (
          <div className="mb-6 p-4 rounded-2xl border border-amber-200 bg-amber-50 text-sm text-amber-800">
            No voice provider has been allocated to your workspace yet. Contact your account manager to enable one (Build-Your-Own, Vapi, Retell AI, or Bland.ai).
          </div>
        )}
        <div className="grid grid-cols-4 gap-4 mb-6">
          {allowedProviders.map(p => {
            const hasConfig = configs?.some(c => c.provider === p.id && c.is_active);
            const isSelected = selectedProvider === p.id;
            return (
              <button key={p.id}
                onClick={() => { setSelectedProvider(p.id); setEditMode(false); setTestResult(null); }}
                className={`text-left p-4 rounded-2xl border transition-all ${
                  isSelected
                    ? 'border-brand-500 ring-1 ring-brand-500/30'
                    : 'border-gray-100 hover:border-gray-300'
                }`}
                style={{ background: isSelected ? 'rgba(41,171,226,0.08)' : '#ffffff' }}
              >
                <div className="flex items-start justify-between mb-3">
                  <span className="text-3xl">{p.logo}</span>
                  <div className="flex items-center gap-2">
                    {hasConfig && (
                      <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                        <CheckCircle2 className="w-3 h-3" /> Active
                      </span>
                    )}
                  </div>
                </div>
                <p className="text-gray-900 font-bold text-sm">{p.name}</p>
                <p className="text-[11px] text-gray-500 mt-0.5">{p.tagline}</p>
                <p className="text-[11px] text-gray-500 mt-2 line-clamp-2">{p.description}</p>
                <a href={p.docsUrl} target="_blank" rel="noreferrer"
                   onClick={e => e.stopPropagation()}
                   className="inline-flex items-center gap-1 text-[10px] text-brand-400 hover:text-brand-600 mt-2">
                  Docs <ExternalLink className="w-2.5 h-2.5" />
                </a>
              </button>
            );
          })}
        </div>

        {selectedProvider && (() => {
          const pDef = allowedProviders.find(p => p.id === selectedProvider)!;
          return (
            <div className="space-y-5">

              {/* Webhook URL — not applicable to the self-hosted bot (it talks to the CRM directly) */}
              {selectedProvider !== 'livekit' && (
              <div className="rounded-2xl border border-gray-100 p-5"
                   style={{ background: '#ffffff' }}>
                <div className="flex items-center gap-2 mb-4">
                  <Zap className="w-4 h-4 text-brand-400" />
                  <h3 className="text-gray-900 font-semibold text-sm">Webhook URL</h3>
                  <span className="text-xs text-gray-500">— paste this into {pDef.name}'s dashboard</span>
                </div>
                <div className="flex items-center gap-2 p-3 rounded-xl border border-dashed border-brand-600/40"
                     style={{ background: 'rgba(41,171,226,0.05)' }}>
                  <code className="flex-1 text-xs text-brand-700 break-all font-mono">
                    {(webhookUrls as any)?.[selectedProvider] ?? 'Loading…'}
                  </code>
                  {(webhookUrls as any)?.[selectedProvider] && (
                    <CopyButton text={(webhookUrls as any)[selectedProvider]} />
                  )}
                </div>
              </div>
              )}

              {/* Setup guide */}
              <div className="rounded-2xl border border-gray-100 overflow-hidden"
                   style={{ background: '#ffffff' }}>
                <button
                  onClick={() => setShowGuide(showGuide === selectedProvider ? null : selectedProvider)}
                  className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-100 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Info className="w-4 h-4 text-brand-400" />
                    <span className="text-gray-900 font-semibold text-sm">Step-by-step setup for {pDef.name}</span>
                  </div>
                  <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${showGuide === selectedProvider ? 'rotate-180' : ''}`} />
                </button>
                {showGuide === selectedProvider && (
                  <div className="px-5 pb-5 border-t border-gray-100">
                    <ol className="mt-4 space-y-3">
                      {pDef.setupSteps.map((step, i) => (
                        <li key={i} className="flex items-start gap-3">
                          <span className="w-6 h-6 rounded-full shrink-0 flex items-center justify-center text-xs font-bold text-gray-900"
                                style={{ background: 'linear-gradient(135deg, #29ABE2 0%, #4D8B3C 100%)' }}>
                            {i + 1}
                          </span>
                          <p className="text-sm text-gray-500 pt-0.5">{step}</p>
                        </li>
                      ))}
                    </ol>
                    <a href={pDef.dashboardUrl} target="_blank" rel="noreferrer"
                       className="inline-flex items-center gap-2 mt-4 px-4 py-2 rounded-xl text-sm font-semibold text-gray-900 border border-gray-100 hover:bg-gray-100 transition-colors">
                      Open {pDef.name} Dashboard <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                )}
              </div>

              {/* Bot configuration */}
              <div className="rounded-2xl border border-gray-100 p-5"
                   style={{ background: '#ffffff' }}>
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-2">
                    <Settings2 className="w-4 h-4 text-brand-400" />
                    <h3 className="text-gray-900 font-semibold text-sm">Bot Configuration</h3>
                  </div>
                  {!editMode && !isCentrallyManaged && (
                    <button onClick={() => startEdit(activeConfig)}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold text-brand-600 border border-brand-200 hover:bg-brand-50 transition-colors">
                      {activeConfig ? 'Edit' : 'Configure'}
                    </button>
                  )}
                </div>

                {isCentrallyManaged && (
                  <div className="mb-4 p-3 rounded-lg bg-gray-50 border border-gray-200 flex items-start gap-2.5">
                    <Info className="w-4 h-4 text-gray-500 mt-0.5 shrink-0" />
                    <p className="text-xs text-gray-600">
                      This bot is centrally managed by your platform provider. You can see its current settings below, but changes must be requested from them.
                    </p>
                  </div>
                )}

                {editMode ? (
                  <div className="space-y-4">
                    {/* Active toggle */}
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-500">Active</span>
                      <button onClick={() => setFormState(f => ({ ...f, is_active: !f.is_active }))}>
                        {formState.is_active
                          ? <ToggleRight className="w-8 h-8 text-brand-400" />
                          : <ToggleLeft  className="w-8 h-8 text-gray-500"  />}
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      {selectedProvider === 'livekit' ? (
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">Bot Name *</label>
                          <input type="text" placeholder="Nadia"
                            value={formState.bot_name ?? ''}
                            onChange={e => setFormState(f => ({ ...f, bot_name: e.target.value }))}
                            className={inputCls} />
                          <p className="text-xs text-gray-500 mt-1">Spoken in the greeting — "I am [name] speaking…"</p>
                        </div>
                      ) : (
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">
                            {selectedProvider === 'vapi' ? 'Assistant ID' : selectedProvider === 'retell' ? 'Agent ID' : 'Pathway ID'} *
                          </label>
                          <input type="text" placeholder="From provider dashboard"
                            value={formState.assistant_id ?? ''}
                            onChange={e => setFormState(f => ({ ...f, assistant_id: e.target.value }))}
                            className={inputCls} />
                        </div>
                      )}
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Helpline Phone Number</label>
                        <input type="text" placeholder="+923001234567"
                          value={formState.phone_number ?? ''}
                          onChange={e => setFormState(f => ({ ...f, phone_number: e.target.value }))}
                          className={inputCls} />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Language</label>
                        <select value={formState.language ?? 'en-US'}
                          onChange={e => setFormState(f => ({ ...f, language: e.target.value }))}
                          className={`${inputCls} appearance-none`}>
                          {[
                            ['en-US', 'English (US)'], ['en-GB', 'English (UK)'],
                            ['ur-PK', 'Urdu (Pakistan)'], ['ar-SA', 'Arabic'],
                            ['fr-FR', 'French'], ['es-ES', 'Spanish'],
                            ['hi-IN', 'Hindi'],
                          ].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                      </div>
                      {selectedProvider === 'livekit' ? (
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">Voice</label>
                          <select value={formState.voice_id ?? 'helpdesk-agent'}
                            onChange={e => setFormState(f => ({ ...f, voice_id: e.target.value }))}
                            className={`${inputCls} appearance-none`}>
                            {(voices ?? []).map(v => <option key={v.id} value={v.voice_id}>{v.label}</option>)}
                          </select>
                        </div>
                      ) : (
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">Voice ID (optional)</label>
                          <input type="text" placeholder="Provider-specific voice ID"
                            value={formState.voice_id ?? ''}
                            onChange={e => setFormState(f => ({ ...f, voice_id: e.target.value }))}
                            className={inputCls} />
                        </div>
                      )}
                    </div>

                    {selectedProvider === 'livekit' && (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">Tone / Personality</label>
                          <select value={formState.tone ?? 'empathetic'}
                            onChange={e => setFormState(f => ({ ...f, tone: e.target.value }))}
                            className={`${inputCls} appearance-none`}>
                            <option value="empathetic">Empathetic — gentle, patient (recommended for complaints)</option>
                            <option value="professional">Professional — polished, efficient</option>
                            <option value="friendly">Friendly — warm, casual</option>
                            <option value="formal">Formal — respectful, no slang</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">
                            Speaking Speed — {Number(formState.speaking_rate ?? 0.9).toFixed(2)}×
                          </label>
                          <input type="range" min={0.5} max={1.5} step={0.05}
                            value={formState.speaking_rate ?? 0.9}
                            onChange={e => setFormState(f => ({ ...f, speaking_rate: Number(e.target.value) }))}
                            className="w-full mt-2.5 accent-brand-400" />
                          <div className="flex justify-between text-[10px] text-gray-500">
                            <span>Slower (0.5×)</span><span>Normal (1×)</span><span>Faster (1.5×)</span>
                          </div>
                        </div>
                      </div>
                    )}

                    {selectedProvider === 'livekit' && (
                      <div className="border-t border-gray-100 pt-4">
                        <div className="flex items-center gap-2 mb-3">
                          <PhoneCall className="w-4 h-4 text-brand-400" />
                          <span className="text-sm text-gray-900 font-semibold">Connect to your number via SIP trunking</span>
                        </div>
                        <p className="text-xs text-gray-500 mb-3">
                          Details for the telecom provider (e.g. Telecard) that routes real phone calls to this bot. Leave blank until your SIP trunk is ready.
                        </p>
                        <div className="grid grid-cols-2 gap-3 mb-3">
                          <div>
                            <label className="block text-xs text-gray-500 mb-1">SIP Trunk Provider</label>
                            <input type="text" placeholder="e.g. Telecard"
                              value={formState.sip_trunk_provider ?? ''}
                              onChange={e => setFormState(f => ({ ...f, sip_trunk_provider: e.target.value }))}
                              className={inputCls} />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-500 mb-1">Phone Number</label>
                            <input type="text" placeholder="Enter phone number"
                              value={formState.sip_trunk_number ?? ''}
                              onChange={e => setFormState(f => ({ ...f, sip_trunk_number: e.target.value }))}
                              className={inputCls} />
                          </div>
                        </div>
                        <div className="mb-3">
                          <label className="block text-xs text-gray-500 mb-1">Termination URI</label>
                          <input type="text" placeholder="Enter termination URI (not this platform's own SIP server URI)"
                            value={formState.sip_uri ?? ''}
                            onChange={e => setFormState(f => ({ ...f, sip_uri: e.target.value }))}
                            className={inputCls} />
                        </div>
                        <div className="grid grid-cols-2 gap-3 mb-3">
                          <div>
                            <label className="block text-xs text-gray-500 mb-1">SIP Trunk User Name (Optional)</label>
                            <input type="text" placeholder="Enter SIP Trunk User Name"
                              value={formState.sip_trunk_username ?? ''}
                              onChange={e => setFormState(f => ({ ...f, sip_trunk_username: e.target.value }))}
                              className={inputCls} />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-500 mb-1">SIP Trunk Password (Optional)</label>
                            <input type="password" placeholder="Enter SIP Trunk Password"
                              value={formState.sip_trunk_password ?? ''}
                              onChange={e => setFormState(f => ({ ...f, sip_trunk_password: e.target.value }))}
                              className={inputCls} />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs text-gray-500 mb-1">Nickname (Optional)</label>
                            <input type="text" placeholder="Enter Nickname"
                              value={formState.sip_trunk_nickname ?? ''}
                              onChange={e => setFormState(f => ({ ...f, sip_trunk_nickname: e.target.value }))}
                              className={inputCls} />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-500 mb-1">Outbound Transport</label>
                            <select value={formState.outbound_transport ?? 'TCP'}
                              onChange={e => setFormState(f => ({ ...f, outbound_transport: e.target.value }))}
                              className={`${inputCls} appearance-none`}>
                              <option value="TCP">TCP</option>
                              <option value="UDP">UDP</option>
                            </select>
                          </div>
                        </div>
                      </div>
                    )}

                    {selectedProvider === 'livekit' && <TestCallNadiaButton />}

                    {selectedProvider === 'livekit' && isSuperAdmin && (
                      <div className="border-t border-gray-100 pt-4">
                        <div className="flex items-center gap-2 mb-3">
                          <Bot className="w-4 h-4 text-brand-400" />
                          <span className="text-sm text-gray-900 font-semibold">Manage Voices (platform-wide)</span>
                        </div>
                        <div className="space-y-2 mb-3">
                          {(voices ?? []).map(v => (
                            <div key={v.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 text-xs">
                              <div>
                                <span className="text-gray-800 font-medium">{v.label}</span>
                                <span className="text-gray-500 ml-2">({v.voice_id})</span>
                              </div>
                              <button onClick={() => removeVoiceMut.mutate(v.id)} className="text-gray-500 hover:text-red-400">Remove</button>
                            </div>
                          ))}
                        </div>
                        <div className="flex gap-2">
                          <input type="text" placeholder="Uplift voice ID" value={newVoice.voiceId}
                            onChange={e => setNewVoice(s => ({ ...s, voiceId: e.target.value }))}
                            className={`${inputCls} flex-1`} />
                          <input type="text" placeholder="Display label" value={newVoice.label}
                            onChange={e => setNewVoice(s => ({ ...s, label: e.target.value }))}
                            className={`${inputCls} flex-1`} />
                          <button onClick={() => addVoiceMut.mutate()} disabled={!newVoice.voiceId || !newVoice.label}
                            className="px-4 py-2 rounded-xl bg-brand-50 text-brand-700 text-xs font-medium border border-brand-200 disabled:opacity-40 whitespace-nowrap">
                            Add Voice
                          </button>
                        </div>
                        <p className="text-xs text-gray-500 mt-2">Browse available voice IDs at docs.upliftai.org/orator_voices.</p>
                      </div>
                    )}

                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Greeting Message</label>
                      <input type="text"
                        placeholder="Hello! You've reached our support line. How can I help you today?"
                        value={formState.greeting_message ?? ''}
                        onChange={e => setFormState(f => ({ ...f, greeting_message: e.target.value }))}
                        className={inputCls} />
                    </div>

                    <div>
                      <label className="block text-xs text-gray-500 mb-1">
                        System Prompt
                        <span className="ml-1 text-gray-500">(additional instructions for the AI)</span>
                      </label>
                      <textarea rows={5}
                        placeholder={`You are a professional customer support agent for our company.\n\nYour goal is to:\n1. Greet the caller warmly\n2. Collect their name, contact number, and nature of the complaint\n3. Understand the urgency of the issue\n4. Summarise the issue clearly at the end\n\nAlways be polite and empathetic.`}
                        value={formState.system_prompt ?? ''}
                        onChange={e => setFormState(f => ({ ...f, system_prompt: e.target.value }))}
                        className={`${inputCls} resize-none text-xs font-mono`} />
                    </div>

                    {selectedProvider === 'livekit' && (
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">
                          Guardrails
                          <span className="ml-1 text-gray-500">(hard limits — what the bot must NEVER do or say)</span>
                        </label>
                        <textarea rows={4}
                          placeholder={`e.g.\n- Never quote a specific refund amount — always say "a manager will confirm the exact amount"\n- Never discuss competitor products or pricing\n- Never make promises about delivery dates`}
                          value={formState.guardrails ?? ''}
                          onChange={e => setFormState(f => ({ ...f, guardrails: e.target.value }))}
                          className={`${inputCls} resize-none text-xs font-mono`} />
                        <p className="text-xs text-gray-500 mt-1">Kept separate from the System Prompt so the bot treats these as strict boundaries, not general guidance.</p>
                      </div>
                    )}

                    {selectedProvider === 'livekit' && (
                      <div className="border-t border-gray-100 pt-4">
                        <div className="flex items-center justify-between">
                          <div className="pr-4">
                            <p className="text-sm text-gray-900 font-medium">Record calls (audio)</p>
                            <p className="text-xs text-gray-500 mt-0.5">
                              Saves each call's audio to storage, searchable on the Bot Calls page next to the transcript.
                            </p>
                          </div>
                          <button type="button" onClick={() => setFormState(f => ({ ...f, recording_enabled: !f.recording_enabled }))}>
                            {formState.recording_enabled
                              ? <ToggleRight className="w-8 h-8 text-brand-500" />
                              : <ToggleLeft  className="w-8 h-8 text-gray-300"  />}
                          </button>
                        </div>
                        {formState.recording_enabled && (
                          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mt-2">
                            When on, the bot automatically plays an audible consent notice at the start of every call
                            ("this call is being recorded…") before greeting — required for recorded calls in Pakistan.
                          </p>
                        )}
                      </div>
                    )}

                    {selectedProvider === 'livekit' && <KnowledgeBasePanel />}

                    {/* Ticket creation rules */}
                    <div className="border-t border-gray-100 pt-4">
                      <div className="flex items-center gap-2 mb-4">
                        <Ticket className="w-4 h-4 text-brand-400" />
                        <span className="text-sm text-gray-900 font-semibold">Ticket Creation Rules</span>
                      </div>

                      <div className="flex items-center justify-between mb-4">
                        <div>
                          <p className="text-sm text-gray-500">Auto-create ticket after every call</p>
                          <p className="text-xs text-gray-500 mt-0.5">A ticket is created in CRM as soon as the call ends</p>
                        </div>
                        <button onClick={() => setFormState(f => ({ ...f, auto_create_ticket: !f.auto_create_ticket }))}>
                          {formState.auto_create_ticket
                            ? <ToggleRight className="w-8 h-8 text-brand-400" />
                            : <ToggleLeft  className="w-8 h-8 text-gray-500"  />}
                        </button>
                      </div>

                      {/* Self-service intents — calls matching these are resolved by the bot with no ticket */}
                      <div className="mb-4 p-3 rounded-lg bg-gray-50 border border-gray-200">
                        <p className="text-sm text-gray-500 font-medium mb-1">Self-Service Intents (No Ticket)</p>
                        <p className="text-xs text-gray-500 mb-3">When the bot detects one of these query types, it resolves the call directly — no ticket is created. Everything else still creates a ticket.</p>
                        <div className="grid grid-cols-2 gap-2">
                          {[
                            { value: 'balance_inquiry',  label: 'Balance / Account Inquiry' },
                            { value: 'order_status',     label: 'Order Status / Tracking' },
                            { value: 'branch_hours',     label: 'Branch / Opening Hours' },
                            { value: 'installment_info', label: 'Installment / EMI Info' },
                            { value: 'faq',              label: 'General FAQ' },
                            ...(customIntents ?? []).map(ci => ({ value: ci.intent_key, label: ci.label })),
                          ].map(({ value, label }) => {
                            const selected = (formState.self_service_intents ?? []).includes(value);
                            return (
                              <label key={value} className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer text-xs transition-colors ${selected ? 'border-brand-500 bg-brand-500/10 text-brand-600' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                                <input type="checkbox" className="hidden" checked={selected}
                                  onChange={() => setFormState(f => {
                                    const cur = f.self_service_intents ?? [];
                                    return { ...f, self_service_intents: selected ? cur.filter(i => i !== value) : [...cur, value] };
                                  })} />
                                <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${selected ? 'bg-brand-500 border-brand-500' : 'border-gray-300'}`}>
                                  {selected && <span className="text-gray-900 text-[9px] font-bold">✓</span>}
                                </span>
                                {label}
                              </label>
                            );
                          })}
                        </div>
                        {(formState.self_service_intents ?? []).length > 0 && (
                          <p className="text-xs text-brand-400 mt-2">
                            {(formState.self_service_intents ?? []).length} intent(s) will be handled by bot without a ticket
                          </p>
                        )}

                        <div className="border-t border-gray-200 mt-3 pt-3">
                          <p className="text-xs text-gray-400 mb-2">Add your own reason — the bot checks the call for these keywords and, if matched, answers directly instead of raising a ticket. Tick it above (once saved) to activate.</p>
                          <div className="space-y-2 mb-2">
                            {(customIntents ?? []).map(ci => (
                              <div key={ci.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 text-xs">
                                <div>
                                  <span className="text-gray-800 font-medium">{ci.label}</span>
                                  <span className="text-gray-500 ml-2">({ci.keywords.join(', ')})</span>
                                </div>
                                <button onClick={() => removeIntentMut.mutate(ci.id)} className="text-gray-500 hover:text-red-400">Remove</button>
                              </div>
                            ))}
                          </div>
                          <div className="flex gap-2">
                            <input type="text" placeholder="Reason label, e.g. Card Activation Status" value={newIntent.label}
                              onChange={e => setNewIntent(s => ({ ...s, label: e.target.value }))}
                              className={`${inputCls} flex-1`} />
                            <input type="text" placeholder="Keywords, comma-separated" value={newIntent.keywords}
                              onChange={e => setNewIntent(s => ({ ...s, keywords: e.target.value }))}
                              className={`${inputCls} flex-1`} />
                            <button onClick={() => addIntentMut.mutate()} disabled={!newIntent.label || !newIntent.keywords}
                              className="px-4 py-2 rounded-xl bg-brand-50 text-brand-700 text-xs font-medium border border-brand-200 disabled:opacity-40 whitespace-nowrap">
                              Add Reason
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">Default Queue</label>
                          <select value={formState.default_queue_id ?? ''}
                            onChange={e => setFormState(f => ({ ...f, default_queue_id: e.target.value || undefined }))}
                            className={`${inputCls} appearance-none`}>
                            <option value="">Auto (default queue)</option>
                            {queues?.map(q => <option key={q.id} value={q.id}>{q.name}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">Default Priority</label>
                          <select value={formState.default_priority ?? 'medium'}
                            onChange={e => setFormState(f => ({ ...f, default_priority: e.target.value }))}
                            className={`${inputCls} appearance-none`}>
                            <option value="urgent">Urgent</option>
                            <option value="high">High</option>
                            <option value="medium">Medium</option>
                            <option value="low">Low</option>
                          </select>
                        </div>
                      </div>

                      <div className="mt-3">
                        <label className="block text-xs text-gray-500 mb-1">
                          Urgency keywords
                          <span className="ml-1 text-gray-500">(comma-separated — escalate to Urgent priority)</span>
                        </label>
                        <input type="text"
                          value={(formState.keyword_urgency ?? []).join(', ')}
                          onChange={e => setFormState(f => ({
                            ...f,
                            keyword_urgency: e.target.value.split(',').map(s => s.trim()).filter(Boolean),
                          }))}
                          placeholder="urgent, emergency, critical, asap"
                          className={inputCls} />
                      </div>
                    </div>


                      {/* IVR Menu Builder */}
                      <div className="mt-4 border-t border-gray-100 pt-4">
                        <div className="flex items-center justify-between mb-2">
                          <div>
                            <p className="text-xs font-semibold text-gray-900">IVR Menu Options</p>
                            <p className="text-xs text-gray-500 mt-0.5">Define what options are presented to the caller</p>
                          </div>
                          <button type="button"
                            onClick={() => setFormState(f => ({
                              ...f,
                              ivr_menu: [...(f.ivr_menu ?? []), {
                                option: (f.ivr_menu?.length ?? 0) + 1,
                                intent: 'complaint' as const,
                                label: 'New option',
                                ticketType: 'complaint' as const,
                                queueId: null,
                              }],
                            }))}
                            className="text-xs px-2.5 py-1 rounded-lg border border-brand-400/40 text-brand-400 hover:bg-brand-400/10">
                            + Add Option
                          </button>
                        </div>
                        <div className="space-y-2">
                          {(formState.ivr_menu ?? [
                            { option: 1, intent: 'complaint', label: 'Register a complaint',         ticketType: 'complaint', queueId: null },
                            { option: 2, intent: 'inquiry',   label: 'Product & service enquiries',  ticketType: 'inquiry',   queueId: null },
                            { option: 3, intent: 'sales',     label: 'Speak to a sales agent',       ticketType: 'sales',     queueId: null },
                          ]).map((opt: any, idx: number) => (
                            <div key={idx} className="flex items-center gap-2 bg-white/5 rounded-xl p-2.5">
                              <div className="w-7 h-7 rounded-full bg-brand-600/30 flex items-center justify-center text-brand-400 text-xs font-bold shrink-0">
                                {opt.option}
                              </div>
                              <input
                                value={opt.label}
                                onChange={e => {
                                  const menu = [...(formState.ivr_menu ?? [])];
                                  menu[idx] = { ...menu[idx], label: e.target.value };
                                  setFormState(f => ({ ...f, ivr_menu: menu }));
                                }}
                                className="flex-1 bg-transparent border border-gray-100 rounded-lg px-2 py-1 text-xs text-gray-900 outline-none focus:border-brand-400/60"
                                placeholder="Option label..."
                              />
                              <select
                                value={opt.ticketType ?? opt.intent}
                                onChange={e => {
                                  const menu = [...(formState.ivr_menu ?? [])];
                                  menu[idx] = { ...menu[idx], ticketType: e.target.value as any, intent: e.target.value as any };
                                  setFormState(f => ({ ...f, ivr_menu: menu }));
                                }}
                                className="text-xs bg-white/5 border border-gray-100 rounded-lg px-2 py-1 text-gray-900 outline-none">
                                <option value="complaint">🎫 Complaint</option>
                                <option value="inquiry">💬 Inquiry</option>
                                <option value="sales">💼 Sales</option>
                                <option value="agent">👤 Live Agent</option>
                              </select>
                              <select
                                value={opt.queueId ?? ''}
                                onChange={e => {
                                  const menu = [...(formState.ivr_menu ?? [])];
                                  menu[idx] = { ...menu[idx], queueId: e.target.value || null };
                                  setFormState(f => ({ ...f, ivr_menu: menu }));
                                }}
                                className="text-xs bg-white/5 border border-gray-100 rounded-lg px-2 py-1 text-gray-900 outline-none">
                                <option value="">Default queue</option>
                                {(queues ?? []).map((q: any) => (
                                  <option key={q.id} value={q.id}>{q.name}</option>
                                ))}
                              </select>
                              <button type="button"
                                onClick={() => {
                                  const menu = (formState.ivr_menu ?? []).filter((_: any, i: number) => i !== idx);
                                  setFormState(f => ({ ...f, ivr_menu: menu }));
                                }}
                                className="text-gray-500 hover:text-red-400 p-0.5 shrink-0">
                                ✕
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* SIP URI */}
                      <div className="mt-3">
                        <label className="block text-xs text-gray-500 mb-1">SIP URI (optional)</label>
                        <input type="text"
                          value={formState.sip_uri ?? ''}
                          onChange={e => setFormState(f => ({ ...f, sip_uri: e.target.value }))}
                          placeholder="sip:helpline@yourprovider.com"
                          className={inputCls} />
                        <p className="text-xs text-gray-500 mt-1">SIP endpoint for direct PSTN/VoIP integration</p>
                      </div>

                    {/* Save / Cancel */}
                    <div className="flex items-center justify-between pt-2">
                      <button onClick={() => setEditMode(false)}
                        className="px-4 py-2 rounded-xl text-sm text-gray-400 hover:bg-gray-100 transition-colors">
                        Cancel
                      </button>
                      <button
                        onClick={() => saveMut.mutate({ ...formState, provider: selectedProvider })}
                        disabled={saveMut.isPending}
                        className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold text-gray-900 disabled:opacity-40"
                        style={{ background: 'linear-gradient(135deg, #29ABE2 0%, #1a8cbf 100%)' }}
                      >
                        {saveMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                        {saveMut.isPending ? 'Saving…' : 'Save Configuration'}
                      </button>
                    </div>
                  </div>
                ) : activeConfig ? (
                  /* Read-only summary */
                  <div className="space-y-3">
                    {[
                      ...(selectedProvider === 'livekit' ? [
                        { label: 'Bot Name',       value: activeConfig.bot_name ?? 'Nadia' },
                        { label: 'Voice',          value: (voices ?? []).find(v => v.voice_id === activeConfig.voice_id)?.label ?? activeConfig.voice_id ?? '—' },
                        { label: 'Tone',           value: activeConfig.tone ?? 'empathetic' },
                        { label: 'Speaking speed', value: `${Number(activeConfig.speaking_rate ?? 0.9).toFixed(2)}×` },
                      ] : [
                        { label: 'Assistant / Agent ID', value: activeConfig.assistant_id ?? '—' },
                      ]),
                      { label: 'Helpline Number',      value: activeConfig.phone_number  ?? '—' },
                      { label: 'Language',             value: activeConfig.language },
                      { label: 'Auto-create ticket',   value: activeConfig.auto_create_ticket ? 'Yes' : 'No' },
                      { label: 'Default priority',     value: activeConfig.default_priority },
                      { label: 'Default queue',        value: activeConfig.queue_name ?? 'Default queue' },
                      { label: 'Self-service intents', value: (activeConfig.self_service_intents ?? []).length > 0 ? `${(activeConfig.self_service_intents ?? []).length} configured` : 'None (all calls → ticket)' },
                    ].map(({ label, value }) => (
                      <div key={label} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                        <span className="text-xs text-gray-500">{label}</span>
                        <span className="text-xs text-gray-900 font-medium">{value}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center py-8 gap-3">
                    <AlertCircle className="w-8 h-8 text-gray-500" />
                    <p className="text-gray-500 text-sm">Not configured yet</p>
                    {selectedProvider !== 'livekit' && (
                      <p className="text-gray-500 text-xs text-center max-w-xs">
                        Also make sure to add your {allowedProviders.find(p => p.id === selectedProvider)?.name} API key in
                        the <Link to="/integrations" className="text-brand-400 hover:underline">Integrations page</Link>
                      </p>
                    )}
                    <button onClick={() => startEdit()}
                      className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-gray-900"
                      style={{ background: 'linear-gradient(135deg, #29ABE2 0%, #1a8cbf 100%)' }}>
                      Configure {allowedProviders.find(p => p.id === selectedProvider)?.name}
                    </button>
                  </div>
                )}

                {saveMsg && (
                  <div className="mt-3 flex items-center gap-2 text-emerald-400 text-sm">
                    <CheckCircle2 className="w-4 h-4" /> {saveMsg}
                  </div>
                )}
              </div>

              {/* Test call — outbound test API only supports hosted providers */}
              {activeConfig && selectedProvider !== 'livekit' && (
                <div className="rounded-2xl border border-gray-100 p-5"
                     style={{ background: '#ffffff' }}>
                  <div className="flex items-center gap-2 mb-4">
                    <PhoneCall className="w-4 h-4 text-emerald-400" />
                    <h3 className="text-gray-900 font-semibold text-sm">Test Call</h3>
                    <span className="text-xs text-gray-500">— verify the integration end-to-end</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <input type="tel" placeholder="+923001234567 (your test number)"
                      value={testNumber}
                      onChange={e => setTestNumber(e.target.value)}
                      className={`${inputCls} flex-1`} />
                    <button
                      onClick={() => testMut.mutate()}
                      disabled={testMut.isPending || !testNumber}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-gray-900 disabled:opacity-40 shrink-0"
                      style={{ background: 'linear-gradient(135deg, #4D8B3C 0%, #3a6b2e 100%)' }}
                    >
                      {testMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Phone className="w-4 h-4" />}
                      {testMut.isPending ? 'Calling…' : 'Initiate Test'}
                    </button>
                  </div>
                  {testResult && (
                    <p className={`mt-3 text-sm ${testResult.startsWith('✅') ? 'text-emerald-400' : 'text-red-400'}`}>
                      {testResult}
                    </p>
                  )}
                  <p className="text-xs text-gray-500 mt-2">
                    The AI bot will call the number above. When the call ends, a test ticket will be created automatically.
                  </p>
                </div>
              )}

            </div>
          );
        })()}

      </div>
    </div>
  );
}

