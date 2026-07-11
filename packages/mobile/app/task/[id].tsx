import { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert, Linking, TextInput,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { confirmDialog, notify } from '@/lib/dialog';
import { api, ApiError } from '@/lib/api';

interface TaskDetail {
  id: string;
  type: string;
  subject: string;
  body: string | null;
  status: string;
  priority: string;
  due_at: string | null;
  outcome: string | null;
  contact_id: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_mobile: string | null;
  contact_address: string | null;
  metadata: { checkins?: Array<{ lat: number; lng: number; at: string }> } | null;
}

async function getPosition(): Promise<{ lat: number; lng: number } | null> {
  const perm = await Location.requestForegroundPermissionsAsync();
  if (!perm.granted) return null;
  try {
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return { lat: pos.coords.latitude, lng: pos.coords.longitude };
  } catch {
    return null;
  }
}

export default function TaskDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [working, setWorking] = useState(false);
  const [outcome, setOutcome] = useState('');

  const { data: task, isLoading, refetch } = useQuery<TaskDetail>({
    queryKey: ['my-tasks', id],
    queryFn: async () => {
      const mine = await api.get<{ tasks: TaskDetail[] }>('/api/v1/activities/mine');
      const found = mine.tasks.find((t) => t.id === id);
      if (!found) throw new Error('Task not found');
      return found;
    },
  });

  const phone = task?.contact_mobile || task?.contact_phone;
  const checkedIn = (task?.metadata?.checkins?.length ?? 0) > 0;
  const done = task?.status === 'completed';

  function navigate() {
    // Prefer the customer's address; otherwise just open the map.
    const q = task?.contact_address
      ? encodeURIComponent(task.contact_address)
      : '';
    Linking.openURL(q
      ? `https://www.google.com/maps/dir/?api=1&destination=${q}`
      : 'https://www.google.com/maps');
  }

  async function checkIn() {
    setWorking(true);
    try {
      const pos = await getPosition();
      if (!pos) {
        Alert.alert('Location needed', 'Please allow location access so your arrival can be recorded.');
        return;
      }
      await api.post(`/api/v1/activities/${id}/checkin`, pos);
      refetch();
      Alert.alert('Checked in', 'Your arrival at the job has been recorded in the CRM.');
    } catch (err) {
      Alert.alert('Check-in failed', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setWorking(false);
    }
  }

  function confirmComplete() {
    confirmDialog(
      'Complete this job?',
      `"${task?.subject}" will be marked complete in the CRM${task?.contact_name ? ` and ${task.contact_name} will be informed by email` : ''}.\n\nIs this correct?`,
      'Confirm & complete',
      markComplete,
      'Not yet',
    );
  }

  async function markComplete() {
    setWorking(true);
    try {
      const pos = await getPosition();
      const result = await api.post<{ customerNotified?: boolean }>(`/api/v1/activities/${id}/complete`, {
        outcome: outcome.trim() || undefined,
        ...(pos ?? {}),
      });
      queryClient.invalidateQueries({ queryKey: ['my-tasks'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      notify(
        'Job completed',
        result.customerNotified
          ? 'The CRM is updated and the customer has been informed by email.'
          : 'The CRM is updated.',
        () => router.back(),
      );
    } catch (err) {
      Alert.alert('Could not complete', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setWorking(false);
    }
  }

  if (isLoading || !task) {
    return (
      <View style={[styles.screen, { justifyContent: 'center' }]}>
        <ActivityIndicator color="#2BB8CC" />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={26} color="#f1f5f9" />
        </TouchableOpacity>
        <Text style={styles.title}>Job Details</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.subject}>{task.subject}</Text>
        <View style={styles.badgeRow}>
          <Text style={styles.badge}>{task.type}</Text>
          <Text style={[styles.badge, task.priority === 'urgent' && styles.badgeUrgent]}>{task.priority}</Text>
          <Text style={[styles.badge, done && styles.badgeDone]}>{done ? 'completed' : 'pending'}</Text>
        </View>

        {task.due_at && (
          <Row icon="time" label="Due" value={new Date(task.due_at).toLocaleString()} />
        )}
        {task.contact_name && <Row icon="person" label="Customer" value={task.contact_name} />}
        {task.contact_address && <Row icon="location" label="Address" value={task.contact_address} />}
        {task.body ? <Row icon="reader" label="Notes" value={task.body} /> : null}
        {checkedIn && (
          <Row icon="checkmark-circle" label="Checked in"
            value={new Date(task.metadata!.checkins![task.metadata!.checkins!.length - 1].at).toLocaleString()} />
        )}

        {!done && (
          <>
            <View style={styles.actionRow}>
              {phone && (
                <TouchableOpacity style={styles.actionBtn} onPress={() => Linking.openURL(`tel:${phone}`)}>
                  <Ionicons name="call" size={20} color="#fff" />
                  <Text style={styles.actionText}>Call</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.actionBtn} onPress={navigate}>
                <Ionicons name="navigate" size={20} color="#fff" />
                <Text style={styles.actionText}>Navigate</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtn, checkedIn && styles.actionBtnDoneState]}
                onPress={checkIn}
                disabled={working}
              >
                <Ionicons name="pin" size={20} color="#fff" />
                <Text style={styles.actionText}>{checkedIn ? 'Re-check in' : 'Check in'}</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.label}>Outcome / what was done</Text>
            <TextInput
              style={styles.outcomeInput}
              value={outcome}
              onChangeText={setOutcome}
              multiline
              placeholder="e.g. Replaced faulty unit, customer satisfied"
              placeholderTextColor="#64748b"
            />

            <TouchableOpacity style={styles.completeBtn} onPress={confirmComplete} disabled={working}>
              {working
                ? <ActivityIndicator color="#fff" />
                : (
                  <>
                    <Ionicons name="checkmark-done" size={20} color="#fff" />
                    <Text style={styles.completeText}>Mark job complete</Text>
                  </>
                )}
            </TouchableOpacity>
          </>
        )}

        {done && task.outcome ? <Row icon="flag" label="Outcome" value={task.outcome} /> : null}
      </ScrollView>
    </View>
  );
}

function Row({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Ionicons name={icon} size={18} color="#2BB8CC" style={{ marginTop: 2 }} />
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowValue}>{value}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen:   { flex: 1, backgroundColor: '#0f172a' },
  header:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 60, paddingBottom: 12 },
  title:    { fontSize: 18, fontWeight: '700', color: '#f1f5f9' },
  body:     { paddingHorizontal: 20, paddingBottom: 40 },
  subject:  { fontSize: 20, fontWeight: '700', color: '#f1f5f9', marginBottom: 10 },
  badgeRow: { flexDirection: 'row', gap: 8, marginBottom: 18 },
  badge:    { color: '#94a3b8', fontSize: 12, backgroundColor: '#1e293b', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, textTransform: 'capitalize' },
  badgeUrgent: { color: '#fca5a5', backgroundColor: '#7f1d1d55' },
  badgeDone:   { color: '#86efac', backgroundColor: '#14532d55' },
  row:      { flexDirection: 'row', gap: 10, marginBottom: 14 },
  rowLabel: { color: '#64748b', fontSize: 12 },
  rowValue: { color: '#e2e8f0', fontSize: 15, marginTop: 2 },
  actionRow:  { flexDirection: 'row', gap: 10, marginVertical: 16 },
  actionBtn:  { flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2BB8CC', borderRadius: 12, paddingVertical: 12 },
  actionBtnDoneState: { backgroundColor: '#475569' },
  actionText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  label:      { color: '#94a3b8', fontSize: 13, marginBottom: 6 },
  outcomeInput: { backgroundColor: '#1e293b', borderRadius: 10, padding: 12, minHeight: 80, color: '#f1f5f9', fontSize: 15, textAlignVertical: 'top' },
  completeBtn:  { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#4C9A4C', borderRadius: 12, paddingVertical: 15, marginTop: 16 },
  completeText: { color: '#fff', fontWeight: '800', fontSize: 16 },
});
