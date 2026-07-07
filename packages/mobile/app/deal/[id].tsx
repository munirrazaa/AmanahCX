import { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert, Image, Linking,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, getToken } from '@/lib/api';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

interface Deal {
  id: string;
  name: string;
  amount: number | null;
  currency: string | null;
  status: string;
  priority: string | null;
  close_date: string | null;
  stage_name?: string;
  stage_id: string;
  contact_name?: string | null;
  company_name?: string | null;
  created_at: string;
}

interface Attachment {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
}

function fmtMoney(amount: number | string | null, currency: string | null) {
  if (amount == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0 }).format(Number(amount) || 0);
}

const STATUS_COLOR: Record<string, string> = { open: '#2BB8CC', won: '#4C9A4C', lost: '#ef4444' };

export default function DealDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => { getToken().then(setToken); }, []);

  const { data: deal, isLoading } = useQuery<Deal>({
    queryKey: ['deals', id],
    queryFn: async () => {
      const res = await api.get<any>(`/api/v1/deals/${id}`);
      return res.deal ?? res;
    },
  });

  const { data: attachments, refetch: refetchAttachments } = useQuery<Attachment[]>({
    queryKey: ['attachments', 'deal', id],
    queryFn: () => api.get(`/api/v1/attachments?entityType=deal&entityId=${id}`),
  });

  async function addPhoto(fromCamera: boolean) {
    if (fromCamera) {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Camera needed', 'Please allow camera access to attach photos.');
        return;
      }
    }
    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.7, base64: true })
      : await ImagePicker.launchImageLibraryAsync({ quality: 0.7, base64: true, mediaTypes: ImagePicker.MediaTypeOptions.Images });
    if (result.canceled || !result.assets?.[0]?.base64) return;

    setUploading(true);
    try {
      await api.post('/api/v1/attachments', {
        entityType: 'deal',
        entityId: id,
        filename: `deal-photo-${Date.now()}.jpg`,
        mimeType: 'image/jpeg',
        data: result.assets[0].base64,
      });
      refetchAttachments();
    } catch (err) {
      Alert.alert('Upload failed', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setUploading(false);
    }
  }

  function removeAttachment(att: Attachment) {
    Alert.alert('Delete photo?', `"${att.filename}" will be removed from this deal.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          await api.delete(`/api/v1/attachments/${att.id}`).catch(() => {});
          refetchAttachments();
        },
      },
    ]);
  }

  if (isLoading || !deal) {
    return <View style={[styles.screen, { justifyContent: 'center' }]}><ActivityIndicator color="#2BB8CC" /></View>;
  }

  const statusColor = STATUS_COLOR[deal.status] ?? '#64748b';
  const images = (attachments ?? []).filter((a) => a.mime_type.startsWith('image/'));

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={26} color="#f1f5f9" />
        </TouchableOpacity>
        <Text style={styles.title}>Deal</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.dealName}>{deal.name}</Text>
        <Text style={styles.amount}>{fmtMoney(deal.amount, deal.currency)}</Text>

        <View style={styles.badgeRow}>
          <Text style={[styles.badge, { color: statusColor, backgroundColor: statusColor + '22' }]}>{deal.status}</Text>
          {deal.stage_name || deal.stage_id ? <Text style={styles.badge}>{deal.stage_name ?? deal.stage_id}</Text> : null}
          {deal.priority ? <Text style={styles.badge}>{deal.priority}</Text> : null}
        </View>

        {deal.contact_name ? <Row icon="person" label="Contact" value={deal.contact_name} /> : null}
        {deal.company_name ? <Row icon="business" label="Company" value={deal.company_name} /> : null}
        {deal.close_date ? <Row icon="calendar" label="Expected close" value={new Date(deal.close_date).toLocaleDateString()} /> : null}
        <Row icon="time" label="Created" value={new Date(deal.created_at).toLocaleDateString()} />

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Photos & files</Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <TouchableOpacity style={styles.attachBtn} onPress={() => addPhoto(true)} disabled={uploading}>
              <Ionicons name="camera" size={18} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.attachBtn} onPress={() => addPhoto(false)} disabled={uploading}>
              <Ionicons name="image" size={18} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>

        {uploading && (
          <View style={styles.uploadingRow}>
            <ActivityIndicator color="#2BB8CC" size="small" />
            <Text style={styles.uploadingText}>Uploading…</Text>
          </View>
        )}

        {images.length === 0 && !uploading ? (
          <Text style={styles.emptyAttach}>No photos yet — use the camera or gallery button to attach one.</Text>
        ) : (
          <View style={styles.grid}>
            {images.map((att) => (
              <TouchableOpacity
                key={att.id}
                onPress={() => Linking.openURL(`${BASE_URL}/api/v1/attachments/${att.id}/download`)}
                onLongPress={() => removeAttachment(att)}
              >
                <Image
                  source={{
                    uri: `${BASE_URL}/api/v1/attachments/${att.id}/download`,
                    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
                  }}
                  style={styles.thumb}
                />
              </TouchableOpacity>
            ))}
          </View>
        )}
        {images.length > 0 && <Text style={styles.hint}>Tap a photo to view full size · long-press to delete</Text>}
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
  screen:    { flex: 1, backgroundColor: '#0f172a' },
  header:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 60, paddingBottom: 12 },
  title:     { fontSize: 18, fontWeight: '700', color: '#f1f5f9' },
  body:      { paddingHorizontal: 20, paddingBottom: 40 },
  dealName:  { fontSize: 20, fontWeight: '700', color: '#f1f5f9' },
  amount:    { fontSize: 26, fontWeight: '800', color: '#2BB8CC', marginVertical: 6 },
  badgeRow:  { flexDirection: 'row', gap: 8, marginBottom: 18, flexWrap: 'wrap' },
  badge:     { color: '#94a3b8', fontSize: 12, backgroundColor: '#1e293b', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, textTransform: 'capitalize', overflow: 'hidden' },
  row:       { flexDirection: 'row', gap: 10, marginBottom: 14 },
  rowLabel:  { color: '#64748b', fontSize: 12 },
  rowValue:  { color: '#e2e8f0', fontSize: 15, marginTop: 2 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 20, marginBottom: 12 },
  sectionTitle:  { fontSize: 15, fontWeight: '700', color: '#f1f5f9' },
  attachBtn:  { backgroundColor: '#2BB8CC', borderRadius: 10, padding: 9 },
  uploadingRow:  { flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 12 },
  uploadingText: { color: '#94a3b8', fontSize: 13 },
  emptyAttach: { color: '#475569', fontSize: 13 },
  grid:      { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  thumb:     { width: 100, height: 100, borderRadius: 10, backgroundColor: '#1e293b' },
  hint:      { color: '#475569', fontSize: 11, marginTop: 10 },
});
