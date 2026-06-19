import { useState } from 'react';
import {
  View, Text, FlatList, TextInput, StyleSheet,
  TouchableOpacity, ActivityIndicator, RefreshControl,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/lib/api';

interface Contact {
  id:         string;
  first_name: string;
  last_name:  string;
  email:      string;
  company?:   string;
  status:     string;
}

function initials(c: Contact) {
  return `${c.first_name[0] ?? ''}${c.last_name[0] ?? ''}`.toUpperCase();
}

function statusColor(s: string) {
  return s === 'customer' ? '#22c55e' : s === 'lead' ? '#f59e0b' : '#64748b';
}

export default function ContactsScreen() {
  const router  = useRouter();
  const [search, setSearch] = useState('');

  const { data, isLoading, refetch, isRefetching } = useQuery<{ data: Contact[]; meta: any }>({
    queryKey: ['contacts', search],
    queryFn:  () => api.get(`/api/v1/contacts?search=${encodeURIComponent(search)}&pageSize=50`),
    placeholderData: (prev) => prev,
  });

  const contacts = (data as any)?.data ?? (Array.isArray(data) ? data : []);

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>Contacts</Text>
        <TouchableOpacity onPress={() => router.push('/contact/new')}>
          <Ionicons name="add-circle" size={28} color="#29ABE2" />
        </TouchableOpacity>
      </View>

      <View style={styles.searchRow}>
        <Ionicons name="search" size={18} color="#64748b" style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search contacts…"
          placeholderTextColor="#64748b"
          value={search}
          onChangeText={setSearch}
          clearButtonMode="while-editing"
        />
      </View>

      {isLoading ? (
        <ActivityIndicator color="#29ABE2" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={contacts}
          keyExtractor={(c) => c.id}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor="#29ABE2" />}
          contentContainerStyle={styles.list}
          renderItem={({ item: c }) => (
            <TouchableOpacity style={styles.row} onPress={() => router.push(`/contact/${c.id}`)}>
              <View style={[styles.avatar, { backgroundColor: '#1d4ed8' }]}>
                <Text style={styles.avatarText}>{initials(c)}</Text>
              </View>
              <View style={styles.rowInfo}>
                <Text style={styles.name}>{c.first_name} {c.last_name}</Text>
                <Text style={styles.meta}>{c.email}</Text>
                {c.company ? <Text style={styles.company}>{c.company}</Text> : null}
              </View>
              <View style={[styles.badge, { backgroundColor: statusColor(c.status) + '22' }]}>
                <Text style={[styles.badgeText, { color: statusColor(c.status) }]}>{c.status}</Text>
              </View>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <Text style={styles.empty}>No contacts found</Text>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen:      { flex: 1, backgroundColor: '#0f172a' },
  header:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 60, paddingBottom: 12 },
  title:       { fontSize: 26, fontWeight: '800', color: '#f1f5f9' },
  searchRow:   { flexDirection: 'row', alignItems: 'center', marginHorizontal: 20, marginBottom: 12, backgroundColor: '#1e293b', borderRadius: 10, paddingHorizontal: 12 },
  searchIcon:  { marginRight: 8 },
  searchInput: { flex: 1, height: 42, color: '#f1f5f9', fontSize: 15 },
  list:        { paddingHorizontal: 20, paddingBottom: 20 },
  row:         { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1e293b', borderRadius: 12, padding: 14, marginBottom: 10 },
  avatar:      { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  avatarText:  { color: '#fff', fontWeight: '700', fontSize: 15 },
  rowInfo:     { flex: 1 },
  name:        { fontSize: 15, fontWeight: '600', color: '#f1f5f9' },
  meta:        { fontSize: 12, color: '#64748b', marginTop: 2 },
  company:     { fontSize: 12, color: '#475569', marginTop: 1 },
  badge:       { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText:   { fontSize: 11, fontWeight: '700' },
  empty:       { textAlign: 'center', color: '#475569', marginTop: 40 },
});
