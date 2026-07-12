import { useState, useEffect } from 'react';
import {
  View, Text, TextInput, StyleSheet, ScrollView,
  TouchableOpacity, ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import NetInfo from '@react-native-community/netinfo';
import { Speech, useSpeechEvent, speechAvailable } from '@/lib/speech';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { recognizeCardOffline, parseDictation } from '@/lib/cardOcr';
import { enqueueLead } from '@/lib/offlineQueue';
import { VOICE_LANGS, getVoiceLang, setVoiceLang } from '@/lib/voiceLang';

interface Fields {
  firstName: string;
  lastName:  string;
  jobTitle:  string;
  company:   string;
  email:     string;
  phone:     string;
  mobile:    string;
  notes:     string;
}

const EMPTY: Fields = {
  firstName: '', lastName: '', jobTitle: '', company: '',
  email: '', phone: '', mobile: '', notes: '',
};

export default function NewContactScreen() {
  const router      = useRouter();
  const queryClient = useQueryClient();

  const [fields,       setFields]       = useState<Fields>(EMPTY);
  const [scanning,     setScanning]     = useState(false);
  const [saving,       setSaving]       = useState(false);
  const [scanned,      setScanned]      = useState(false);
  const [scannedOffline, setScannedOffline] = useState(false);
  const [listening,    setListening]    = useState(false);
  const [transcript,   setTranscript]   = useState('');
  const [voiceLang,    setVoiceLangState] = useState('en-US');

  useEffect(() => { getVoiceLang().then(setVoiceLangState); }, []);

  function pickVoiceLang(code: string) {
    setVoiceLangState(code);
    setVoiceLang(code);
  }

  function set(key: keyof Fields, value: string) {
    setFields((f) => ({ ...f, [key]: value }));
  }

  useSpeechEvent('result', (event) => {
    setTranscript(event.results[0]?.transcript ?? '');
  });
  useSpeechEvent('end', () => {
    setListening(false);
  });
  useSpeechEvent('error', (event) => {
    setListening(false);
    if (event.error !== 'no-speech' && event.error !== 'aborted') {
      Alert.alert('Voice input failed', 'Could not capture your voice. Please try again.');
    }
  });

  async function toggleVoice() {
    if (listening) {
      // Reset UI immediately — never leave the button stuck if the
      // recognizer already ended (or never started) and no event arrives.
      setListening(false);
      try { Speech.stop(); } catch { /* recognizer wasn't running */ }
      return;
    }
    const perm = await Speech.requestPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Microphone needed', 'Please allow microphone access to capture leads by voice.');
      return;
    }
    setTranscript('');
    setListening(true);
    try {
      Speech.start({
      lang: voiceLang,
      interimResults: true,
      continuous: false,
      // Falls back to online recognition automatically when unavailable on-device
      requiresOnDeviceRecognition: false,
      });
    } catch {
      setListening(false);
      Alert.alert('Voice input unavailable', 'This phone has no speech recognition service available. Please type the details instead.');
    }
  }

  async function useTranscript() {
    const text = transcript.trim();
    if (!text) return;

    setScanning(true);
    try {
      const net = await NetInfo.fetch();
      if (net.isConnected && net.isInternetReachable !== false) {
        try {
          const data = await api.post<Record<string, string | null>>('/api/v1/contacts/parse-lead-text', { text });
          setFields({
            firstName: data.firstName ?? '',
            lastName:  data.lastName  ?? '',
            jobTitle:  data.jobTitle  ?? '',
            company:   data.company   ?? '',
            email:     data.email     ?? '',
            phone:     data.phone     ?? '',
            mobile:    data.mobile    ?? '',
            notes:     data.notes     ?? '',
          });
          setScanned(true);
          setScannedOffline(false);
          setTranscript('');
          return;
        } catch {
          // fall through to the offline parser below
        }
      }
      const parsed = parseDictation(text);
      setFields({ ...parsed, notes: text });
      setScanned(true);
      setScannedOffline(true);
      setTranscript('');
    } finally {
      setScanning(false);
    }
  }

  async function scanCard(fromCamera: boolean) {
    if (fromCamera) {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Camera needed', 'Please allow camera access to scan visiting cards.');
        return;
      }
    }

    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.8, base64: true })
      : await ImagePicker.launchImageLibraryAsync({ quality: 0.8, base64: true, mediaTypes: ImagePicker.MediaTypeOptions.Images });

    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];

    setScanning(true);
    try {
      // On-device OCR always works offline — read the card locally first.
      const offlineFields = await recognizeCardOffline(asset.uri).catch(() => null);
      if (offlineFields) {
        setFields({ ...offlineFields, notes: '' });
        setScanned(true);
        setScannedOffline(true);
      }

      // If we have a connection, ask the server's AI scan for a cleaner read
      // and prefer it — it understands card layout far better than the regex parser.
      const net = await NetInfo.fetch();
      if (net.isConnected && net.isInternetReachable !== false && asset.base64) {
        try {
          const data = await api.post<Record<string, string | null>>('/api/v1/contacts/scan-card', {
            image: asset.base64,
            mediaType: 'image/jpeg',
          });
          setFields({
            firstName: data.firstName ?? '',
            lastName:  data.lastName  ?? '',
            jobTitle:  data.jobTitle  ?? '',
            company:   data.company   ?? '',
            email:     data.email     ?? '',
            phone:     data.phone     ?? '',
            mobile:    data.mobile    ?? '',
            notes:     '',
          });
          setScanned(true);
          setScannedOffline(false);
        } catch (err) {
          // AI scan failed — keep the offline OCR result (if any) rather than erroring out.
          if (!offlineFields) {
            const msg = err instanceof ApiError ? err.message : 'Could not read the card. Please try again.';
            Alert.alert('Scan failed', msg);
          }
        }
      } else if (!offlineFields) {
        Alert.alert('Scan failed', 'Could not read the card offline, and no connection is available to try online scanning.');
      }
    } finally {
      setScanning(false);
    }
  }

  function save() {
    if (!fields.firstName.trim()) {
      Alert.alert('Missing name', 'First name is required.');
      return;
    }
    // Always show what will be pushed to the CRM and get an explicit OK first.
    const summary = [
      `Name: ${[fields.firstName, fields.lastName].filter((s) => s.trim()).join(' ')}`,
      fields.jobTitle.trim() && `Title: ${fields.jobTitle.trim()}`,
      fields.company.trim()  && `Company: ${fields.company.trim()}`,
      fields.email.trim()    && `Email: ${fields.email.trim()}`,
      fields.phone.trim()    && `Phone: ${fields.phone.trim()}`,
      fields.mobile.trim()   && `Mobile: ${fields.mobile.trim()}`,
      fields.notes.trim()    && `Notes: ${fields.notes.trim()}`,
    ].filter(Boolean).join('\n');
    Alert.alert('Confirm lead details', `${summary}\n\nIs this correct?`, [
      { text: 'Edit', style: 'cancel' },
      { text: 'Confirm & save', onPress: doSave },
    ]);
  }

  async function doSave() {
    setSaving(true);
    const payload = {
      firstName: fields.firstName.trim(),
      lastName:  fields.lastName.trim()  || undefined,
      jobTitle:  fields.jobTitle.trim()  || undefined,
      email:     fields.email.trim()     || undefined,
      phone:     fields.phone.trim()     || undefined,
      mobile:    fields.mobile.trim()    || undefined,
      status: 'lead',
      source: scanned ? 'card_scan' : 'mobile',
      // Company captured as a tag until company matching lands; card scans
      // shouldn't fail because the company record doesn't exist yet.
      tags: fields.company.trim() ? [`company:${fields.company.trim()}`] : undefined,
      customFields: fields.notes.trim() ? { notes: fields.notes.trim() } : undefined,
    };

    const net = await NetInfo.fetch();
    if (!net.isConnected || net.isInternetReachable === false) {
      await enqueueLead(payload);
      setSaving(false);
      Alert.alert('Saved offline', `${fields.firstName} will be added as a lead automatically once you're back online.`, [
        { text: 'Scan another', onPress: () => { setFields(EMPTY); setScanned(false); setScannedOffline(false); } },
        { text: 'Done', onPress: () => router.back() },
      ]);
      return;
    }

    try {
      await api.post('/api/v1/contacts', payload);
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      Alert.alert('Lead saved', `${fields.firstName} was added as a lead.`, [
        { text: 'Scan another', onPress: () => { setFields(EMPTY); setScanned(false); setScannedOffline(false); } },
        { text: 'Done', onPress: () => router.back() },
      ]);
    } catch (err) {
      if (err instanceof ApiError) {
        Alert.alert('Save failed', err.message);
      } else {
        // Network dropped mid-request — queue it instead of losing the lead.
        await enqueueLead(payload);
        Alert.alert('Saved offline', `Connection was lost. ${fields.firstName} will sync automatically once you're back online.`, [
          { text: 'Scan another', onPress: () => { setFields(EMPTY); setScanned(false); setScannedOffline(false); } },
          { text: 'Done', onPress: () => router.back() },
        ]);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={26} color="#f1f5f9" />
        </TouchableOpacity>
        <Text style={styles.title}>New Lead</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.scanRow}>
          <TouchableOpacity style={styles.scanBtn} onPress={() => scanCard(true)} disabled={scanning}>
            <Ionicons name="camera" size={22} color="#fff" />
            <Text style={styles.scanBtnText}>Scan visiting card</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.scanBtnAlt} onPress={() => scanCard(false)} disabled={scanning}>
            <Ionicons name="image" size={22} color="#2BB8CC" />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.scanBtnAlt, listening && styles.micBtnActive]}
            onPress={toggleVoice}
            disabled={scanning}
          >
            <Ionicons name={listening ? 'stop' : 'mic'} size={22} color={listening ? '#fff' : '#2BB8CC'} />
          </TouchableOpacity>
        </View>

        <View style={styles.langRow}>
          <Text style={styles.langLabel}>Voice language:</Text>
          {VOICE_LANGS.map((l) => (
            <TouchableOpacity
              key={l.code}
              style={[styles.langChip, voiceLang === l.code && styles.langChipActive]}
              onPress={() => pickVoiceLang(l.code)}
            >
              <Text style={[styles.langChipText, voiceLang === l.code && styles.langChipTextActive]}>{l.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {(listening || transcript.length > 0) && (
          <View style={styles.transcriptBox}>
            <Text style={styles.transcriptLabel}>
              {listening ? 'Listening… speak the lead details, tap stop when done.' : 'Heard:'}
            </Text>
            <Text style={styles.transcriptText}>{transcript || '…'}</Text>
            {!listening && transcript.trim().length > 0 && (
              <TouchableOpacity style={styles.useTranscriptBtn} onPress={useTranscript} disabled={scanning}>
                <Text style={styles.useTranscriptText}>Fill form from this</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {scanning && (
          <View style={styles.scanningBox}>
            <ActivityIndicator color="#2BB8CC" />
            <Text style={styles.scanningText}>Reading card…</Text>
          </View>
        )}

        {scanned && !scanning && (
          <View style={[styles.verifyBanner, scannedOffline && styles.verifyBannerOffline]}>
            <Ionicons name={scannedOffline ? 'cloud-offline' : 'checkmark-circle'} size={18} color={scannedOffline ? '#fbbf24' : '#4C9A4C'} />
            <Text style={[styles.verifyText, scannedOffline && styles.verifyTextOffline]}>
              {scannedOffline
                ? 'Scanned offline — accuracy is rougher without a connection. Please check every field carefully.'
                : 'Card scanned — please check the details below before saving.'}
            </Text>
          </View>
        )}

        <Field label="First name *" value={fields.firstName} onChange={(v) => set('firstName', v)} />
        <Field label="Last name"    value={fields.lastName}  onChange={(v) => set('lastName', v)} />
        <Field label="Job title"    value={fields.jobTitle}  onChange={(v) => set('jobTitle', v)} />
        <Field label="Company"      value={fields.company}   onChange={(v) => set('company', v)} />
        <Field label="Email"        value={fields.email}     onChange={(v) => set('email', v)} keyboardType="email-address" />
        <Field label="Phone"        value={fields.phone}     onChange={(v) => set('phone', v)} keyboardType="phone-pad" />
        <Field label="Mobile"       value={fields.mobile}    onChange={(v) => set('mobile', v)} keyboardType="phone-pad" />
        <Field label="Notes"        value={fields.notes}     onChange={(v) => set('notes', v)} multiline />

        <TouchableOpacity style={styles.saveBtn} onPress={save} disabled={saving || scanning}>
          {saving
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.saveBtnText}>Save lead</Text>}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({ label, value, onChange, keyboardType, multiline }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  keyboardType?: 'email-address' | 'phone-pad';
  multiline?: boolean;
}) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && styles.inputMultiline]}
        value={value}
        onChangeText={onChange}
        keyboardType={keyboardType ?? 'default'}
        autoCapitalize={keyboardType === 'email-address' ? 'none' : 'words'}
        autoCorrect={false}
        multiline={multiline}
        placeholderTextColor="#64748b"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen:       { flex: 1, backgroundColor: '#0f172a' },
  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 60, paddingBottom: 12 },
  title:        { fontSize: 18, fontWeight: '700', color: '#f1f5f9' },
  body:         { paddingHorizontal: 20, paddingBottom: 40 },
  scanRow:      { flexDirection: 'row', gap: 10, marginBottom: 16 },
  scanBtn:      { flex: 1, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2BB8CC', borderRadius: 12, paddingVertical: 14 },
  scanBtnText:  { color: '#fff', fontWeight: '700', fontSize: 15 },
  scanBtnAlt:   { width: 52, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1e293b', borderRadius: 12 },
  micBtnActive: { backgroundColor: '#dc2626' },
  langRow:      { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  langLabel:    { color: '#64748b', fontSize: 12 },
  langChip:     { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: '#1e293b' },
  langChipActive: { backgroundColor: '#2BB8CC' },
  langChipText:   { color: '#94a3b8', fontSize: 13 },
  langChipTextActive: { color: '#fff', fontWeight: '700' },
  transcriptBox:     { backgroundColor: '#1e293b', borderRadius: 10, padding: 12, marginBottom: 16 },
  transcriptLabel:   { color: '#94a3b8', fontSize: 12, marginBottom: 6 },
  transcriptText:    { color: '#f1f5f9', fontSize: 14 },
  useTranscriptBtn:  { backgroundColor: '#2BB8CC', borderRadius: 8, paddingVertical: 10, alignItems: 'center', marginTop: 10 },
  useTranscriptText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  inputMultiline: { height: 88, paddingTop: 10, textAlignVertical: 'top' },
  scanningBox:  { flexDirection: 'row', gap: 10, alignItems: 'center', justifyContent: 'center', paddingVertical: 12 },
  scanningText: { color: '#94a3b8' },
  verifyBanner: { flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: '#14532d33', borderRadius: 10, padding: 10, marginBottom: 12 },
  verifyText:   { color: '#86efac', fontSize: 13, flex: 1 },
  verifyBannerOffline: { backgroundColor: '#78350f33' },
  verifyTextOffline:   { color: '#fcd34d' },
  fieldWrap:    { marginBottom: 12 },
  label:        { color: '#94a3b8', fontSize: 13, marginBottom: 6 },
  input:        { backgroundColor: '#1e293b', borderRadius: 10, paddingHorizontal: 12, height: 44, color: '#f1f5f9', fontSize: 15 },
  saveBtn:      { backgroundColor: '#4C9A4C', borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 8 },
  saveBtnText:  { color: '#fff', fontWeight: '800', fontSize: 16 },
});
