import { ScrollView, View, Text, StyleSheet, RefreshControl, ActivityIndicator } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';

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

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardLabel}>{label}</Text>
      <Text style={styles.cardValue}>{value}</Text>
      {sub ? <Text style={styles.cardSub}>{sub}</Text> : null}
    </View>
  );
}

function fmt(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

export default function DashboardScreen() {
  const user = useAuthStore((s) => s.user);

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
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor="#29ABE2" />}
    >
      <View style={styles.header}>
        <Text style={styles.greeting}>{greeting()}, {user?.name?.split(' ')[0] ?? 'there'}</Text>
        <Text style={styles.subGreeting}>Here's your CRM snapshot</Text>
      </View>

      {isLoading ? (
        <ActivityIndicator color="#29ABE2" style={{ marginTop: 40 }} />
      ) : (
        <>
          <Text style={styles.sectionTitle}>CRM Overview</Text>
          <View style={styles.grid}>
            <StatCard label="Contacts"    value={data?.total_contacts ?? 0}  sub={`+${data?.new_contacts_30d ?? 0} this month`} />
            <StatCard label="Open Deals"  value={data?.open_deals ?? 0}      sub={fmt(data?.pipeline_value ?? 0) + ' pipeline'} />
            <StatCard label="Won (30d)"   value={data?.deals_won_30d ?? 0}   sub={fmt(data?.revenue_30d ?? 0) + ' revenue'} />
            <StatCard label="Overdue Tasks" value={data?.overdue_tasks ?? 0} sub={`${data?.due_today ?? 0} due today`} />
          </View>

          <Text style={styles.sectionTitle}>Tickets</Text>
          <View style={styles.grid}>
            <StatCard label="Open Tickets"     value={data?.open_tickets ?? 0} />
            <StatCard label="Resolved (30d)"   value={data?.tickets_resolved_30d ?? 0} />
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
  sectionTitle:  { fontSize: 13, fontWeight: '700', color: '#64748b', letterSpacing: 0.8, marginBottom: 12, textTransform: 'uppercase' },
  grid:          { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 28 },
  card:          { backgroundColor: '#1e293b', borderRadius: 12, padding: 16, flex: 1, minWidth: '44%' },
  cardLabel:     { fontSize: 12, color: '#64748b', fontWeight: '600', marginBottom: 6 },
  cardValue:     { fontSize: 26, fontWeight: '800', color: '#f1f5f9' },
  cardSub:       { fontSize: 11, color: '#475569', marginTop: 4 },
});
