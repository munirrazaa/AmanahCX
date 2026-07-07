import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Linking,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/lib/api';

interface Contact {
  id: string;
  first_name: string;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  job_title: string | null;
  status: string;
  source: string;
  company_name?: string | null;
  owner_name?: string | null;
  tags?: string[];
}

export default function ContactDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const { data: contact, isLoading } = useQuery<Contact>({
    queryKey: ['contact', id],
    queryFn: () => api.get(`/api/v1/contacts/${id}`),
    enabled: !!id,
  });

  const companyTag = contact?.tags?.find((t) => t.startsWith('company:'))?.slice(8);

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={26} color="#f1f5f9" />
        </TouchableOpacity>
        <Text style={styles.title}>Contact</Text>
        <View style={{ width: 26 }} />
      </View>

      {isLoading || !contact ? (
        <ActivityIndicator color="#2BB8CC" style={{ marginTop: 40 }} />
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          <Text style={styles.name}>{contact.first_name} {contact.last_name ?? ''}</Text>
          {contact.job_title ? <Text style={styles.sub}>{contact.job_title}</Text> : null}
          {(contact.company_name || companyTag) ? <Text style={styles.sub}>{contact.company_name ?? companyTag}</Text> : null}
          <View style={styles.badge}><Text style={styles.badgeText}>{contact.status}</Text></View>

          {contact.mobile ? <Row icon="call" label={contact.mobile} onPress={() => Linking.openURL(`tel:${contact.mobile}`)} /> : null}
          {contact.phone ? <Row icon="call-outline" label={contact.phone} onPress={() => Linking.openURL(`tel:${contact.phone}`)} /> : null}
          {contact.email ? <Row icon="mail" label={contact.email} onPress={() => Linking.openURL(`mailto:${contact.email}`)} /> : null}
          <Row icon="pricetag" label={`Source: ${contact.source}`} />
          {contact.owner_name ? <Row icon="person" label={`Owner: ${contact.owner_name}`} /> : null}
        </ScrollView>
      )}
    </View>
  );
}

function Row({ icon, label, onPress }: { icon: any; label: string; onPress?: () => void }) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} disabled={!onPress}>
      <Ionicons name={icon} size={18} color="#2BB8CC" />
      <Text style={styles.rowText}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  screen:    { flex: 1, backgroundColor: '#0f172a' },
  header:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 60, paddingBottom: 12 },
  title:     { fontSize: 18, fontWeight: '700', color: '#f1f5f9' },
  body:      { paddingHorizontal: 20, paddingBottom: 40 },
  name:      { fontSize: 24, fontWeight: '800', color: '#f1f5f9' },
  sub:       { fontSize: 15, color: '#94a3b8', marginTop: 2 },
  badge:     { alignSelf: 'flex-start', backgroundColor: '#f59e0b22', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, marginTop: 10, marginBottom: 16 },
  badgeText: { color: '#f59e0b', fontWeight: '700', fontSize: 12 },
  row:       { flexDirection: 'row', gap: 12, alignItems: 'center', backgroundColor: '#1e293b', borderRadius: 12, padding: 14, marginBottom: 10 },
  rowText:   { color: '#f1f5f9', fontSize: 15, flex: 1 },
});
