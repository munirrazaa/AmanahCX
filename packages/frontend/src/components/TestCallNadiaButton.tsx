import { useState, useRef, useEffect } from 'react';
import { Phone, PhoneOff, Loader2 } from 'lucide-react';
import { Room, RoomEvent, Track } from 'livekit-client';
import { api } from '../services/api';

type Status = 'idle' | 'connecting' | 'live' | 'error';

// Only ONE test call may be live at a time, app-wide. The button is rendered
// in two places (Admin Dashboard header + Voice Bot settings page), and a call
// survives the component unmounting only long enough for us to kill it here —
// without this, starting a second call while the first was still connected
// produced two Nadias talking over each other.
let activeCall: { room: Room; els: HTMLMediaElement[] } | null = null;

function killActiveCall() {
  if (!activeCall) return;
  try { activeCall.room.disconnect(); } catch { /* noop */ }
  activeCall.els.forEach(el => { try { el.remove(); } catch { /* noop */ } });
  activeCall = null;
}

/**
 * Talks to the tenant's configured Nadia voice bot straight from the browser —
 * no phone number or SIP trunk needed. Dispatches the same agent a real phone
 * call would reach (POST /api/v1/voice-bot/test-call-browser), so a
 * conversation here creates a real ticket exactly like a live call would.
 *
 * `compact` renders just the button (for embedding in a page header);
 * the full variant (default) includes the heading/description, used on the
 * Voice Bot settings page.
 */
export function TestCallNadiaButton({ compact = false }: { compact?: boolean }) {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');
  const roomRef = useRef<Room | null>(null);
  const elsRef = useRef<HTMLMediaElement[]>([]);

  function cleanup() {
    if (activeCall?.room === roomRef.current) activeCall = null;
    try { roomRef.current?.disconnect(); } catch { /* noop */ }
    roomRef.current = null;
    elsRef.current.forEach(el => { try { el.remove(); } catch { /* noop */ } });
    elsRef.current = [];
  }

  // End the call when the user navigates away and this button unmounts —
  // otherwise the session keeps running invisibly in the background.
  useEffect(() => cleanup, []);

  async function start() {
    killActiveCall(); // never allow two simultaneous sessions
    setStatus('connecting');
    setError('');
    try {
      const res = await api.post('/api/v1/voice-bot/test-call-browser', {});
      const { url, token } = res.data.data;

      const room = new Room({ adaptiveStream: true });
      roomRef.current = room;
      activeCall = { room, els: elsRef.current };

      room.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === Track.Kind.Audio) {
          const el = track.attach();
          el.autoplay = true;
          (el as HTMLMediaElement).style.display = 'none';
          document.body.appendChild(el);
          elsRef.current.push(el as HTMLMediaElement);
          (el as HTMLAudioElement).play?.().catch(() => { /* will play on gesture */ });
        }
      });
      room.on(RoomEvent.Disconnected, () => { cleanup(); setStatus('idle'); });

      await room.connect(url, token);
      await room.localParticipant.setMicrophoneEnabled(true);
      setStatus('live');
    } catch (e: any) {
      setError(e?.response?.data?.error?.message || e?.message || 'Could not start the call.');
      setStatus('error');
      cleanup();
    }
  }

  function end() {
    cleanup();
    setStatus('idle');
  }

  const button = (() => {
    if (status === 'connecting') {
      return (
        <button disabled className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-white bg-gray-400">
          <Loader2 className="w-4 h-4 animate-spin" /> Connecting…
        </button>
      );
    }
    if (status === 'live') {
      return (
        <button onClick={end}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-white bg-red-600 hover:bg-red-700 transition-colors">
          <PhoneOff className="w-4 h-4" /> End Call — Nadia is live
        </button>
      );
    }
    return (
      <button onClick={start}
        className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 transition-colors">
        <Phone className="w-4 h-4" /> Call Nadia
      </button>
    );
  })();

  if (compact) {
    return (
      <div className="flex flex-col items-end gap-1">
        {button}
        {status === 'error' && <p className="text-xs text-red-600 max-w-xs text-right">{error}</p>}
      </div>
    );
  }

  return (
    <div className="border-t border-gray-100 pt-4">
      <div className="flex items-center gap-2 mb-2">
        <Phone className="w-4 h-4 text-brand-400" />
        <span className="text-sm text-gray-900 font-semibold">Test Call Nadia (Browser)</span>
      </div>
      <p className="text-xs text-gray-500 mb-3">
        Talk to your configured bot right now, from this browser tab — no phone or SIP trunk needed. Uses your microphone.
      </p>
      {status === 'error' && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-3">{error}</p>
      )}
      {button}
    </div>
  );
}
