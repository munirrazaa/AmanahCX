import { useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/lib/api';

interface Ticket {
  id:             string;
  ticket_number:  string;
  subject:        string;
  status:         string;
  priority:       string;
  reporter_name?: string;
  created_at:     string;
  sla_due_at?:    string;
}

const STATUS_COLOR: Record<string, string> = {
  open:        '#f59e0b',
  accepted:    '#3b82f6',
  in_progress: '#8b5cf6',
  resolved:    '#4C9A4C',
  closed:      '#64748b',
};
const PRIORITY_COLOR: Record<string, string> = {
  urgent: '#ef4444',
  high:   '#f97316',
  medium: '#f59e0b',
  low:    '#64748b',
};

const FILTER_TABS = ['All', 'Open', 'In Progress', 'Resolved'] as const;
type FilterTab = typeof FILTER_TABS[number];

const FILTER_MAP: Record<FilterTab, string> = {
  'All': '',
  'Open': 'open',
  'In Progress': 'in_progress',
  'Resolved': 'resolved',
};

export default function TicketsScreen() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<FilterTab>('All');

  const status = FILTER_MAP[activeTab];

  const { data, isLoading, refetch, isRefetching } = useQuery<any>({
    queryKey: ['tickets', status],
    queryFn:  () => api.get(`/api/v1/tickets?${status ? `status=${status}&` : ''}pageSize=50`),
    refetchInterval: 30_000,
    placeholderData: (prev) => prev,
  });

  const tickets: Ticket[] = (data as any)?.data ?? (Array.isArray(data) ? data : []);

  function isBreached(t: Ticket) {
    return t.sla_due_at && new Date(t.sla_due_at) < new Date() && !['resolved', 'closed'].includes(t.status);
  }

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>Tickets</Text>
        <TouchableOpacity onPress={() => router.push('/ticket/new')}>
          <Ionicons name="add-circle" size={28} color="#2BB8CC" />
        </TouchableOpacity>
      </View>

      <View style={styles.tabs}>
        {FILTER_TABS.map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, activeTab === tab && styles.tabActive]}
            onPress={() => setActiveTab(tab)}
          >
            <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>{tab}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {isLoading ? (
        <ActivityIndicator color="#2BB8CC" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={tickets}
          keyExtractor={(t) => t.id}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor="#2BB8CC" />}
          contentContainerStyle={styles.list}
          renderItem={({ item: t }) => (
            <TouchableOpacity style={styles.card} onPress={() => router.push(`/ticket/${t.id}`)}>
              <View style={styles.cardTop}>
                <Text style={styles.ticketNum}>{t.ticket_number}</Text>
                {isBreached(t) && (
                  <View style={styles.breachBadge}>
                    <Ionicons name="warning" size={11} color="#ef4444" />
                    <Text style={styles.breachText}>SLA</Text>
                  </View>
                )}
                <View style={[styles.priorityDot, { backgroundColor: PRIORITY_COLOR[t.priority] ?? '#64748b' }]} />
              </View>
              <Text style={styles.subject} numberOfLines={2}>{t.subject}</Text>
              {t.reporter_name ? <Text style={styles.reporter}>{t.reporter_name}</Text> : null}
              <View style={styles.cardBottom}>
                <View style={[styles.statusBadge, { backgroundColor: (STATUS_COLOR[t.status] ?? '#64748b') + '22' }]}>
                  <Text style={[styles.statusText, { color: STATUS_COLOR[t.status] ?? '#64748b' }]}>{t.status.replace('_', ' ')}</Text>
                </View>
                <Text style={styles.date}>{new Date(t.created_at).toLocaleDateString()}</Text>
              </View>
            </TouchableOpacity>
          )}
          ListEmptyComponent={<Text style={styles.empty}>No tickets found</Text>}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen:       { flex: 1, backgroundColor: '#0f172a' },
  header:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 60, paddingBottom: 12 },
  title:        { fontSize: 26, fontWeight: '800', color: '#f1f5f9' },
  tabs:         { flexDirection: 'row', paddingHorizontal: 20, gap: 8, marginBottom: 14 },
  tab:          { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: '#1e293b' },
  tabActive:    { backgroundColor: '#2BB8CC' },
  tabText:      { fontSize: 12, fontWeight: '600', color: '#64748b' },
  tabTextActive:{ color: '#fff' },
  list:         { paddingHorizontal: 20, paddingBottom: 20 },
  card:         { backgroundColor: '#1e293b', borderRadius: 12, padding: 14, marginBottom: 10 },
  cardTop:      { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  ticketNum:    { fontSize: 12, fontWeight: '700', color: '#2BB8CC', flex: 1 },
  breachBadge:  { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fee2e2', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, marginRight: 8, gap: 3 },
  breachText:   { fontSize: 10, fontWeight: '700', color: '#ef4444' },
  priorityDot:  { width: 8, height: 8, borderRadius: 4 },
  subject:      { fontSize: 15, fontWeight: '600', color: '#f1f5f9', lineHeight: 20, marginBottom: 4 },
  reporter:     { fontSize: 12, color: '#64748b', marginBottom: 8 },
  cardBottom:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statusBadge:  { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  statusText:   { fontSize: 11, fontWeight: '700', textTransform: 'capitalize' },
  date:         { fontSize: 11, color: '#475569' },
  empty:        { textAlign: 'center', color: '#475569', marginTop: 40 },
});
