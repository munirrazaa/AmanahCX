import { useState } from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';

interface MyTask {
  id: string;
  type: string;
  subject: string;
  status: string;
  priority: string;
  due_at: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_address: string | null;
}

interface MineResponse {
  tasks: MyTask[];
  pending: number;
  completed: number;
}

const TYPE_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  call: 'call', meeting: 'people', email: 'mail', task: 'checkbox',
  demo: 'easel', proposal: 'document-text', note: 'reader',
};

function dueLabel(iso: string | null): { text: string; overdue: boolean } {
  if (!iso) return { text: 'No due time', overdue: false };
  const d = new Date(iso);
  const overdue = d.getTime() < Date.now();
  const today = new Date().toDateString() === d.toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return { text: today ? `Today ${time}` : `${d.toLocaleDateString()} ${time}`, overdue };
}

export default function MyTasksScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const role = user?.role ?? '';

  const { data, isLoading, refetch, isRefetching } = useQuery<MineResponse>({
    queryKey: ['my-tasks'],
    queryFn:  () => api.get('/api/v1/activities/mine'),
    refetchInterval: 60_000,
  });

  const [filter, setFilter] = useState<'all' | 'pending' | 'completed'>('all');

  const pending   = data?.tasks.filter((t) => t.status === 'pending') ?? [];
  const completed = data?.tasks.filter((t) => t.status === 'completed') ?? [];
  const visible =
    filter === 'pending'   ? pending :
    filter === 'completed' ? completed :
    [...pending, ...completed];

  const isSales   = /sales|business/i.test(role);
  const isSupport = /support|agent|service/i.test(role);

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>My Tasks</Text>
          <Text style={styles.subtitle}>
            {data ? `${data.pending} open · ${data.completed} completed` : ' '}
          </Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.newLeadBtn} onPress={() => router.push('/contact/new')}>
            <Ionicons name="person-add" size={16} color="#fff" />
            <Text style={styles.newLeadBtnText}>New Lead</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.newLeadBtn, styles.newTaskBtn]} onPress={() => router.push('/task/new')}>
            <Ionicons name="mic" size={16} color="#fff" />
            <Text style={styles.newLeadBtnText}>Task</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.statRow}>
        <TouchableOpacity
          style={[styles.statCard, { borderColor: '#E8C025' }, filter === 'pending' && styles.statCardActive]}
          onPress={() => setFilter(filter === 'pending' ? 'all' : 'pending')}
        >
          <Text style={styles.statValue}>{data?.pending ?? '–'}</Text>
          <Text style={styles.statLabel}>To do</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.statCard, { borderColor: '#4C9A4C' }, filter === 'completed' && styles.statCardActive]}
          onPress={() => setFilter(filter === 'completed' ? 'all' : 'completed')}
        >
          <Text style={styles.statValue}>{data?.completed ?? '–'}</Text>
          <Text style={styles.statLabel}>Done</Text>
        </TouchableOpacity>
        {isSales && (
          <TouchableOpacity style={[styles.statCard, { borderColor: '#2BB8CC' }]} onPress={() => router.push('/(tabs)/contacts')}>
            <Ionicons name="person-add" size={20} color="#2BB8CC" />
            <Text style={styles.statLabel}>My leads</Text>
          </TouchableOpacity>
        )}
        {(isSupport || !isSales) && (
          <TouchableOpacity style={[styles.statCard, { borderColor: '#2BB8CC' }]} onPress={() => router.push('/(tabs)/tickets')}>
            <Ionicons name="help-buoy" size={20} color="#2BB8CC" />
            <Text style={styles.statLabel}>My tickets</Text>
          </TouchableOpacity>
        )}
      </View>

      {isLoading ? (
        <ActivityIndicator color="#2BB8CC" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(t) => t.id}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor="#2BB8CC" />}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 30 }}
          ListEmptyComponent={<Text style={styles.empty}>Nothing assigned to you yet.</Text>}
          renderItem={({ item }) => {
            const due = dueLabel(item.due_at);
            const done = item.status === 'completed';
            return (
              <TouchableOpacity style={[styles.card, done && styles.cardDone]} onPress={() => router.push(`/task/${item.id}`)}>
                <Ionicons
                  name={done ? 'checkmark-circle' : (TYPE_ICON[item.type] ?? 'checkbox')}
                  size={22}
                  color={done ? '#4C9A4C' : item.priority === 'urgent' ? '#dc2626' : '#2BB8CC'}
                />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.cardSubject, done && styles.cardSubjectDone]} numberOfLines={1}>{item.subject}</Text>
                  <Text style={styles.cardMeta} numberOfLines={1}>
                    {item.contact_name ? `${item.contact_name} · ` : ''}
                    <Text style={due.overdue && !done ? styles.overdue : undefined}>{done ? 'Completed' : due.text}</Text>
                  </Text>
                </View>
                {item.priority === 'urgent' && !done && <Text style={styles.urgentBadge}>URGENT</Text>}
                <Ionicons name="chevron-forward" size={18} color="#475569" />
              </TouchableOpacity>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen:    { flex: 1, backgroundColor: '#0f172a' },
  headerActions: { flexDirection: 'row', gap: 8 },
  newLeadBtn: { flexDirection: 'row', gap: 5, alignItems: 'center', backgroundColor: '#2BB8CC', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9 },
  newTaskBtn: { backgroundColor: '#4C9A4C' },
  newLeadBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  header: { paddingHorizontal: 20, paddingTop: 60, paddingBottom: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  title:     { fontSize: 24, fontWeight: '700', color: '#f1f5f9' },
  subtitle:  { fontSize: 13, color: '#64748b', marginTop: 4 },
  statRow:   { flexDirection: 'row', gap: 10, paddingHorizontal: 20, marginVertical: 14 },
  statCard:  { flex: 1, backgroundColor: '#1e293b', borderRadius: 12, borderLeftWidth: 3, padding: 12, alignItems: 'center', gap: 2 },
  statCardActive: { backgroundColor: '#2BB8CC33' },
  statValue: { fontSize: 22, fontWeight: '800', color: '#f1f5f9' },
  statLabel: { fontSize: 11, color: '#94a3b8' },
  card:      { flexDirection: 'row', gap: 12, alignItems: 'center', backgroundColor: '#1e293b', borderRadius: 12, padding: 14, marginBottom: 10 },
  cardDone:  { opacity: 0.55 },
  cardSubject:     { color: '#f1f5f9', fontSize: 15, fontWeight: '600' },
  cardSubjectDone: { textDecorationLine: 'line-through' },
  cardMeta:  { color: '#64748b', fontSize: 12, marginTop: 3 },
  overdue:   { color: '#f87171', fontWeight: '700' },
  urgentBadge: { color: '#dc2626', fontSize: 10, fontWeight: '800' },
  empty:     { color: '#64748b', textAlign: 'center', marginTop: 60 },
});
