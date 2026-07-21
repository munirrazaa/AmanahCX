/**
 * Sales Demo — typed conversation with Nadia for sales pitches.
 *
 * Standalone from the real Voice Bot test-call widget (VoiceBotConfig /
 * TestCallNadiaButton) — this talks to /api/v1/sales-demo/*, a separate
 * backend module that reuses Nadia's real intent-capture logic over text
 * instead of a live call. Nothing here touches the real call widget.
 *
 * Admin picks a scenario (or types freely), sees Nadia's replies spoken
 * aloud (browser TTS) and a live panel of what's being captured/routed,
 * then can reset the demo to wipe the tagged demo data it created.
 */

import { useEffect, useRef, useState } from 'react';
import { Bot, Send, RotateCcw, Volume2, Ticket, User, Tag, AlertTriangle } from 'lucide-react';
import { api } from '../services/api';
import { useIsAdmin } from '../hooks/useRole';

interface DemoScenario {
  id: string;
  sector: string;
  label: string;
  openingLine: string;
}

interface DemoEvent {
  type: 'intent' | 'category' | 'priority' | 'contact' | 'ticket' | 'kb_answer';
  label: string;
  value: string;
  at: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

function speak(text: string) {
  if (!text || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = 0.95;
  window.speechSynthesis.speak(utter);
}

function eventIcon(type: DemoEvent['type']) {
  switch (type) {
    case 'ticket': return <Ticket size={14} />;
    case 'contact': return <User size={14} />;
    case 'priority': return <AlertTriangle size={14} />;
    default: return <Tag size={14} />;
  }
}

export function SalesDemo() {
  const isAdmin = useIsAdmin();
  const [scenarios, setScenarios] = useState<DemoScenario[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [events, setEvents] = useState<DemoEvent[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.get('/api/v1/sales-demo/scenarios').then((res) => setScenarios(res.data.data ?? []));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function startSession(scenarioId?: string) {
    setStarting(true);
    try {
      const res = await api.post('/api/v1/sales-demo/start', { scenarioId });
      setSessionId(res.data.sessionId);
      setMessages([]);
      setEvents([]);
      if (res.data.openingLine) {
        setInput(res.data.openingLine);
      }
    } finally {
      setStarting(false);
    }
  }

  async function sendMessage(text: string) {
    if (!sessionId || !text.trim() || loading) return;
    setLoading(true);
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', text }]);
    try {
      const res = await api.post('/api/v1/sales-demo/message', { sessionId, text });
      setMessages((prev) => [...prev, { role: 'assistant', text: res.data.reply }]);
      setEvents(res.data.events ?? []);
      speak(res.data.reply);
    } finally {
      setLoading(false);
    }
  }

  async function resetDemo() {
    if (sessionId) {
      await api.post('/api/v1/sales-demo/reset', { sessionId });
    }
    window.speechSynthesis?.cancel();
    setSessionId(null);
    setMessages([]);
    setEvents([]);
    setInput('');
  }

  if (!isAdmin) {
    return <div className="p-6 text-gray-500">You don't have access to this page.</div>;
  }

  const sectors = Array.from(new Set(scenarios.map((s) => s.sector)));

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Bot className="text-indigo-600" size={26} />
          <div>
            <h1 className="text-xl font-semibold">Sales Demo — Talk to Nadia</h1>
            <p className="text-sm text-gray-500">
              Typed conversation demo — same intent-capture engine as the real voice bot, no phone line needed.
            </p>
          </div>
        </div>
        <button
          onClick={resetDemo}
          className="flex items-center gap-1.5 px-3 py-2 text-sm border rounded-lg hover:bg-gray-50"
        >
          <RotateCcw size={14} /> Reset Demo
        </button>
      </div>

      {!sessionId ? (
        <div className="border rounded-xl p-6 bg-white">
          <h2 className="font-medium mb-4">Pick a scenario to start</h2>
          {sectors.map((sector) => (
            <div key={sector} className="mb-4">
              <div className="text-xs uppercase tracking-wide text-gray-400 mb-2">{sector}</div>
              <div className="flex flex-wrap gap-2">
                {scenarios.filter((s) => s.sector === sector).map((s) => (
                  <button
                    key={s.id}
                    disabled={starting}
                    onClick={() => startSession(s.id)}
                    className="px-3 py-2 text-sm border rounded-lg hover:border-indigo-400 hover:bg-indigo-50 disabled:opacity-50"
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <button
            disabled={starting}
            onClick={() => startSession()}
            className="mt-2 text-sm text-indigo-600 hover:underline disabled:opacity-50"
          >
            Or start a free-form conversation →
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {/* Chat panel */}
          <div className="col-span-2 border rounded-xl bg-white flex flex-col h-[560px]">
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.length === 0 && (
                <div className="text-sm text-gray-400">Type a message below to start talking to Nadia.</div>
              )}
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[75%] px-3 py-2 rounded-lg text-sm ${
                      m.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-800'
                    }`}
                  >
                    {m.role === 'assistant' && (
                      <div className="flex items-center gap-1 text-xs text-gray-400 mb-1">
                        <Volume2 size={12} /> Nadia
                      </div>
                    )}
                    {m.text}
                  </div>
                </div>
              ))}
              {loading && <div className="text-xs text-gray-400">Nadia is typing…</div>}
              <div ref={bottomRef} />
            </div>
            <form
              onSubmit={(e) => { e.preventDefault(); sendMessage(input); }}
              className="border-t p-3 flex gap-2"
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Type as the customer…"
                className="flex-1 border rounded-lg px-3 py-2 text-sm"
              />
              <button
                type="submit"
                disabled={loading || !input.trim()}
                className="px-3 py-2 bg-indigo-600 text-white rounded-lg text-sm disabled:opacity-50 flex items-center gap-1"
              >
                <Send size={14} /> Send
              </button>
            </form>
          </div>

          {/* Live routing panel */}
          <div className="border rounded-xl bg-white p-4 h-[560px] overflow-y-auto">
            <h3 className="font-medium mb-3 text-sm">Live Intent & Routing</h3>
            {events.length === 0 ? (
              <div className="text-xs text-gray-400">Nothing captured yet — keep the conversation going.</div>
            ) : (
              <ul className="space-y-2">
                {events.map((ev, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm border rounded-lg p-2">
                    <span className="text-indigo-500 mt-0.5">{eventIcon(ev.type)}</span>
                    <div>
                      <div className="text-xs text-gray-400">{ev.label}</div>
                      <div className="font-medium">{ev.value}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
