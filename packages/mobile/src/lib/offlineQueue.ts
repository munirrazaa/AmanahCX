/**
 * Offline lead queue: contact-creation requests made while offline are
 * stashed in AsyncStorage and flushed automatically once connectivity
 * returns (see startAutoSync, wired up from app/_layout.tsx).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { api, ApiError } from './api';

const QUEUE_KEY = 'crm_offline_lead_queue';

export interface QueuedLead {
  id: string;
  payload: Record<string, unknown>;
  createdAt: string;
  /** API path to POST to on sync; older queued items without one are contacts. */
  endpoint?: string;
}

async function readQueue(): Promise<QueuedLead[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  return raw ? JSON.parse(raw) : [];
}

async function writeQueue(queue: QueuedLead[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export async function enqueueLead(payload: Record<string, unknown>, endpoint = '/api/v1/contacts'): Promise<void> {
  const queue = await readQueue();
  queue.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    payload,
    createdAt: new Date().toISOString(),
    endpoint,
  });
  await writeQueue(queue);
}

export async function pendingCount(): Promise<number> {
  return (await readQueue()).length;
}

type Listener = (count: number) => void;
const listeners = new Set<Listener>();

export function subscribePendingCount(listener: Listener): () => void {
  listeners.add(listener);
  pendingCount().then(listener);
  return () => listeners.delete(listener);
}

async function notifyListeners(): Promise<void> {
  const count = await pendingCount();
  listeners.forEach((l) => l(count));
}

let syncing = false;

/** Attempts to flush the queue. Network failures keep an item queued for the next attempt;
 *  a rejection from the server (validation, auth, etc.) drops the item — it can't self-heal. */
export async function syncQueue(): Promise<{ synced: number; dropped: number }> {
  if (syncing) return { synced: 0, dropped: 0 };
  syncing = true;
  let synced = 0;
  let dropped = 0;
  try {
    const queue = await readQueue();
    const stillPending: QueuedLead[] = [];
    for (const item of queue) {
      try {
        await api.post(item.endpoint ?? '/api/v1/contacts', item.payload);
        synced++;
      } catch (err) {
        if (err instanceof ApiError) dropped++;
        else stillPending.push(item);
      }
    }
    await writeQueue(stillPending);
  } finally {
    syncing = false;
    await notifyListeners();
  }
  return { synced, dropped };
}

let unsubscribeNetInfo: (() => void) | null = null;

export function startAutoSync(): void {
  if (unsubscribeNetInfo) return;
  unsubscribeNetInfo = NetInfo.addEventListener((state) => {
    if (state.isConnected && state.isInternetReachable !== false) {
      syncQueue();
    }
  });
}
