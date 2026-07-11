import { useState, useEffect } from 'react';
import { ScrollView, View, Text, StyleSheet, RefreshControl, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { subscribePendingCount } from '@/lib/offlineQueue';

interface DashboardData {
  total_contacts:  number;
  new_contacts_30d: number;
  open_deals:       number;
  pipeline_value:   number;
  deals_won_30d:    number;
  revenue_30d:      number;
  overdue_tasks:    number;
  due_today:        number;
  open_tickets:     number;
  tickets_resolved_30d: number;
}

function StatCard({ label, value, sub, onPress }: { label: string; value: string | number; sub?: string; onPress?: () => void }) {
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} disabled={!onPress} activeOpacity={0.7}>
      <View style={styles.cardTop}>
        <Text style={styles.cardLabel}>{label}</Text>
        {onPress && <Ionicons name="chevron-forward" size={14} color="#475569" />}
      </View>
      <Text style={styles.cardValue}>{value}</Text>
      {sub ? <Text style={styles.cardSub}>{sub}</Text> : null}
    </TouchableOpacity>
  );
}

function fmt(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

export default function DashboardScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const [pendingLeads, setPendingLeads] = useState(0);

  useEffect(() => subscribePendingCount(setPendingLeads), []);

  const { data, isLoading, refetch, isRefetching } = useQuery<DashboardData>({
    queryKey: ['dashboard'],
    queryFn:  () => api.get('/api/v1/analytics/dashboard'),
    refetchInterval: 60_000,
  });

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor="#2BB8CC" />}
    >
      <View style={styles.header}>
        <Text style={styles.greeting}>{greeting()}, {user?.name?.split(' ')[0] ?? 'there'}</Text>
        <Text style={styles.subGreeting}>Here's your CRM snapshot</Text>
      </View>

      <View style={styles.quickRow}>
        <TouchableOpacity style={styles.quickBtn} onPress={() => router.push('/contact/new')}>
          <Ionicons name="person-add" size={20} color="#fff" />
          <Text style={styles.quickBtnText}>New Lead</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.quickBtn, styles.quickBtnTask]} onPress={() => router.push('/task/new')}>
          <Ionicons name="mic" size={20} color="#fff" />
          <Text style={styles.quickBtnText}>New Task</Text>
        </TouchableOpacity>
      </View>

      {pendingLeads > 0 && (
        <View style={styles.pendingBanner}>
          <Ionicons name="cloud-upload-outline" size={18} color="#fbbf24" />
          <Text style={styles.pendingText}>
            {pendingLeads} lead{pendingLeads === 1 ? '' : 's'} saved offline — will sync automatically once you're back online.
          </Text>
        </View>
      )}

      {isLoading ? (
        <ActivityIndicator color="#2BB8CC" style={{ marginTop: 40 }} />
      ) : (
        <>
          <Text style={styles.sectionTitle}>CRM Overview</Text>
          <View style={styles.grid}>
            <StatCard label="Contacts"    value={data?.total_contacts ?? 0}  sub={`+${data?.new_contacts_30d ?? 0} this month`} onPress={() => router.push('/(tabs)/contacts')} />
            <StatCard label="Open Deals"  value={data?.open_deals ?? 0}      sub={fmt(data?.pipeline_value ?? 0) + ' pipeline'} onPress={() => router.push('/(tabs)/deals')} />
            <StatCard label="Won (30d)"   value={data?.deals_won_30d ?? 0}   sub={fmt(data?.revenue_30d ?? 0) + ' revenue'} onPress={() => router.push('/(tabs)/deals')} />
            <StatCard label="Overdue Tasks" value={data?.overdue_tasks ?? 0} sub={`${data?.due_today ?? 0} due today`} onPress={() => router.push('/(tabs)/tasks')} />
          </View>

          <Text style={styles.sectionTitle}>Tickets</Text>
          <View style={styles.grid}>
            <StatCard label="Open Tickets"     value={data?.open_tickets ?? 0} onPress={() => router.push('/(tabs)/tickets')} />
            <StatCard label="Resolved (30d)"   value={data?.tickets_resolved_30d ?? 0} onPress={() => router.push('/(tabs)/tickets')} />
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen:        { flex: 1, backgroundColor: '#0f172a' },
  content:       { padding: 20, paddingTop: 60 },
  header:        { marginBottom: 28 },
  greeting:      { fontSize: 24, fontWeight: '700', color: '#f1f5f9' },
  subGreeting:   { fontSize: 14, color: '#64748b', marginTop: 4 },
  quickRow:      { flexDirection: 'row', gap: 12, marginBottom: 20 },
  quickBtn:      { flex: 1, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2BB8CC', borderRadius: 12, paddingVertical: 13 },
  quickBtnTask:  { backgroundColor: '#4C9A4C' },
  quickBtnText:  { color: '#fff', fontWeight: '700', fontSize: 14 },
  pendingBanner: { flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: '#78350f33', borderRadius: 10, padding: 12, marginBottom: 20 },
  pendingText:   { color: '#fcd34d', fontSize: 13, flex: 1 },
  sectionTitle:  { fontSize: 13, fontWeight: '700', color: '#64748b', letterSpacing: 0.8, marginBottom: 12, textTransform: 'uppercase' },
  grid:          { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 28 },
  card:          { backgroundColor: '#1e293b', borderRadius: 12, padding: 16, flex: 1, minWidth: '44%' },
  cardTop:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardLabel:     { fontSize: 12, color: '#64748b', fontWeight: '600', marginBottom: 6 },
  cardValue:     { fontSize: 26, fontWeight: '800', color: '#f1f5f9' },
  cardSub:       { fontSize: 11, color: '#475569', marginTop: 4 },
});
