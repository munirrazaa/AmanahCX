import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/lib/api';

interface Deal {
  id:         string;
  name:       string;
  stage_id:   string;
  amount:     number;
  currency:   string;
  status:     string;
  created_at: string;
  contact_name?: string;
  company_name?: string;
}

const STATUS_COLOR: Record<string, string> = {
  open: '#3b82f6',
  won:  '#4C9A4C',
  lost: '#ef4444',
};

function fmtMoney(amount: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
}

export default function DealsScreen() {
  const router = useRouter();

  const { data, isLoading, refetch, isRefetching } = useQuery<any>({
    queryKey: ['deals'],
    queryFn:  () => api.get('/api/v1/deals?pageSize=50&sortBy=created_at&sortOrder=desc'),
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
  });

  const deals: Deal[] = (data as any)?.data ?? (Array.isArray(data) ? data : []);

  // Summary stats
  const openDeals = deals.filter((d) => d.status === 'open');
  // amount arrives as a string from the API (Postgres numeric) — force numeric math
  const pipelineValue = openDeals.reduce((s, d) => s + (Number(d.amount) || 0), 0);

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>Deals</Text>
        <TouchableOpacity onPress={() => router.push('/deal/new')}>
          <Ionicons name="add-circle" size={28} color="#2BB8CC" />
        </TouchableOpacity>
      </View>

      <View style={styles.summaryRow}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Open</Text>
          <Text style={styles.summaryValue}>{openDeals.length}</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Pipeline</Text>
          <Text style={styles.summaryValue}>{fmtMoney(pipelineValue)}</Text>
        </View>
      </View>

      {isLoading ? (
        <ActivityIndicator color="#2BB8CC" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={deals}
          keyExtractor={(d) => d.id}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor="#2BB8CC" />}
          contentContainerStyle={styles.list}
          renderItem={({ item: d }) => (
            <TouchableOpacity style={styles.card} onPress={() => router.push(`/deal/${d.id}`)}>
              <View style={styles.cardTop}>
                <Text style={styles.dealTitle} numberOfLines={1}>{d.name}</Text>
                <Text style={styles.amount}>{fmtMoney(Number(d.amount) || 0, d.currency)}</Text>
              </View>
              {(d.contact_name || d.company_name) && (
                <Text style={styles.meta}>{[d.contact_name, d.company_name].filter(Boolean).join(' · ')}</Text>
              )}
              <View style={styles.cardBottom}>
                <View style={[styles.badge, { backgroundColor: (STATUS_COLOR[d.status] ?? '#64748b') + '22' }]}>
                  <Text style={[styles.badgeText, { color: STATUS_COLOR[d.status] ?? '#64748b' }]}>{d.status}</Text>
                </View>
                <Text style={styles.stage}>{d.stage_id}</Text>
              </View>
            </TouchableOpacity>
          )}
          ListEmptyComponent={<Text style={styles.empty}>No deals found</Text>}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen:       { flex: 1, backgroundColor: '#0f172a' },
  header:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 60, paddingBottom: 12 },
  title:        { fontSize: 26, fontWeight: '800', color: '#f1f5f9' },
  summaryRow:   { flexDirection: 'row', gap: 12, paddingHorizontal: 20, marginBottom: 16 },
  summaryCard:  { flex: 1, backgroundColor: '#1e293b', borderRadius: 12, padding: 14 },
  summaryLabel: { fontSize: 12, color: '#64748b', fontWeight: '600' },
  summaryValue: { fontSize: 22, fontWeight: '800', color: '#f1f5f9', marginTop: 4 },
  list:         { paddingHorizontal: 20, paddingBottom: 20 },
  card:         { backgroundColor: '#1e293b', borderRadius: 12, padding: 14, marginBottom: 10 },
  cardTop:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 },
  dealTitle:    { fontSize: 15, fontWeight: '600', color: '#f1f5f9', flex: 1, marginRight: 8 },
  amount:       { fontSize: 15, fontWeight: '700', color: '#2BB8CC' },
  meta:         { fontSize: 12, color: '#64748b', marginBottom: 8 },
  cardBottom:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  badge:        { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText:    { fontSize: 11, fontWeight: '700' },
  stage:        { fontSize: 11, color: '#475569' },
  empty:        { textAlign: 'center', color: '#475569', marginTop: 40 },
});
