import { useState, useEffect } from 'react';
import {
  View, Text, TextInput, StyleSheet, ScrollView,
  TouchableOpacity, ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import NetInfo from '@react-native-community/netinfo';
import { Speech, useSpeechEvent, speechAvailable } from '@/lib/speech';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { enqueueLead } from '@/lib/offlineQueue';
import { VOICE_LANGS, getVoiceLang, setVoiceLang } from '@/lib/voiceLang';

const TYPES = ['task', 'call', 'meeting', 'email', 'demo', 'proposal'] as const;
const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;

interface TaskFields {
  type:      string;
  subject:   string;
  body:      string;
  dueAtText: string;      // "YYYY-MM-DD HH:mm" for easy editing
  priority:  string;
  contactId:    string | null;
  contactMatch: string | null;
}

const EMPTY: TaskFields = {
  type: 'task', subject: '', body: '', dueAtText: '',
  priority: 'normal', contactId: null, contactMatch: null,
};

function isoToLocalText(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localTextToIso(text: string): string | undefined {
  const t = text.trim();
  if (!t) return undefined;
  const d = new Date(t.replace(' ', 'T'));
  return isNaN(d.getTime()) ? undefined : d.toISOString();
}

export default function NewTaskScreen() {
  const router      = useRouter();
  const queryClient = useQueryClient();

  const [fields,     setFields]     = useState<TaskFields>(EMPTY);
  const [parsing,    setParsing]    = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [listening,  setListening]  = useState(false);
  const [transcript, setTranscript] = useState('');
  const [voiceLang,  setVoiceLangState] = useState('en-US');

  useEffect(() => { getVoiceLang().then(setVoiceLangState); }, []);

  function pickVoiceLang(code: string) {
    setVoiceLangState(code);
    setVoiceLang(code);
  }

  function set<K extends keyof TaskFields>(key: K, value: TaskFields[K]) {
    setFields((f) => ({ ...f, [key]: value }));
  }

  useSpeechEvent('result', (event) => {
    setTranscript(event.results[0]?.transcript ?? '');
  });
  useSpeechEvent('end', () => setListening(false));
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
      Alert.alert('Microphone needed', 'Please allow microphone access to create tasks by voice.');
      return;
    }
    setTranscript('');
    setListening(true);
    try {
      Speech.start({
      lang: voiceLang,
      interimResults: true,
      continuous: false,
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

    setParsing(true);
    try {
      const net = await NetInfo.fetch();
      if (net.isConnected && net.isInternetReachable !== false) {
        try {
          const data = await api.post<Record<string, string | null>>('/api/v1/activities/parse-task-text', {
            text,
            localTime: new Date().toString(),
          });
          setFields({
            type:      data.type && (TYPES as readonly string[]).includes(data.type) ? data.type : 'task',
            subject:   data.subject ?? text,
            body:      data.body ?? '',
            dueAtText: isoToLocalText(data.dueAt),
            priority:  data.priority && (PRIORITIES as readonly string[]).includes(data.priority) ? data.priority : 'normal',
            contactId:    data.contactId ?? null,
            contactMatch: data.contactMatch ?? null,
          });
          setTranscript('');
          return;
        } catch {
          // fall through to the offline fallback below
        }
      }
      // Offline fallback: the spoken text becomes the subject, everything else manual.
      setFields({ ...EMPTY, subject: text });
      setTranscript('');
    } finally {
      setParsing(false);
    }
  }

  function save() {
    if (!fields.subject.trim()) {
      Alert.alert('Missing subject', 'Please describe the task.');
      return;
    }
    const summary = [
      `Type: ${fields.type}`,
      `Task: ${fields.subject.trim()}`,
      fields.dueAtText.trim()  && `Due: ${fields.dueAtText.trim()}`,
      `Priority: ${fields.priority}`,
      fields.contactMatch      && `Contact: ${fields.contactMatch}`,
      fields.body.trim()       && `Notes: ${fields.body.trim()}`,
    ].filter(Boolean).join('\n');
    Alert.alert('Confirm task details', `${summary}\n\nIs this correct?`, [
      { text: 'Edit', style: 'cancel' },
      { text: 'Confirm & save', onPress: doSave },
    ]);
  }

  async function doSave() {
    setSaving(true);
    const payload = {
      type:      fields.type,
      subject:   fields.subject.trim(),
      body:      fields.body.trim() || undefined,
      priority:  fields.priority,
      dueAt:     localTextToIso(fields.dueAtText),
      contactId: fields.contactId ?? undefined,
    };

    const net = await NetInfo.fetch();
    if (!net.isConnected || net.isInternetReachable === false) {
      await enqueueLead(payload, '/api/v1/activities');
      setSaving(false);
      Alert.alert('Saved offline', 'The task will be added automatically once you\'re back online.', [
        { text: 'Add another', onPress: () => setFields(EMPTY) },
        { text: 'Done', onPress: () => router.back() },
      ]);
      return;
    }

    try {
      await api.post('/api/v1/activities', payload);
      queryClient.invalidateQueries({ queryKey: ['activities'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      Alert.alert('Task saved', `"${fields.subject.trim()}" was added.`, [
        { text: 'Add another', onPress: () => setFields(EMPTY) },
        { text: 'Done', onPress: () => router.back() },
      ]);
    } catch (err) {
      if (err instanceof ApiError) {
        Alert.alert('Save failed', err.message);
      } else {
        await enqueueLead(payload, '/api/v1/activities');
        Alert.alert('Saved offline', 'Connection was lost. The task will sync automatically once you\'re back online.', [
          { text: 'Add another', onPress: () => setFields(EMPTY) },
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
        <Text style={styles.title}>New Task</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <TouchableOpacity
          style={[styles.micBtn, listening && styles.micBtnActive]}
          onPress={toggleVoice}
          disabled={parsing}
        >
          <Ionicons name={listening ? 'stop' : 'mic'} size={22} color="#fff" />
          <Text style={styles.micBtnText}>
            {listening ? 'Stop listening' : 'Speak the task'}
          </Text>
        </TouchableOpacity>

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
              {listening ? 'Listening… e.g. "Call Ahmed tomorrow at 3pm about the bulk order"' : 'Heard:'}
            </Text>
            <Text style={styles.transcriptText}>{transcript || '…'}</Text>
            {!listening && transcript.trim().length > 0 && (
              <TouchableOpacity style={styles.useTranscriptBtn} onPress={useTranscript} disabled={parsing}>
                {parsing
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={styles.useTranscriptText}>Fill form from this</Text>}
              </TouchableOpacity>
            )}
          </View>
        )}

        <Text style={styles.label}>Type</Text>
        <View style={styles.chipRow}>
          {TYPES.map((t) => (
            <TouchableOpacity key={t} style={[styles.chip, fields.type === t && styles.chipActive]} onPress={() => set('type', t)}>
              <Text style={[styles.chipText, fields.type === t && styles.chipTextActive]}>{t}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>Task *</Text>
        <TextInput style={styles.input} value={fields.subject} onChangeText={(v) => set('subject', v)} placeholderTextColor="#64748b" placeholder="e.g. Call Ahmed about bulk order" />

        <Text style={styles.label}>Due (YYYY-MM-DD HH:mm)</Text>
        <TextInput style={styles.input} value={fields.dueAtText} onChangeText={(v) => set('dueAtText', v)} placeholderTextColor="#64748b" placeholder="e.g. 2026-07-07 15:00" autoCapitalize="none" />

        <Text style={styles.label}>Priority</Text>
        <View style={styles.chipRow}>
          {PRIORITIES.map((p) => (
            <TouchableOpacity key={p} style={[styles.chip, fields.priority === p && styles.chipActive]} onPress={() => set('priority', p)}>
              <Text style={[styles.chipText, fields.priority === p && styles.chipTextActive]}>{p}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {fields.contactMatch && (
          <View style={styles.contactBanner}>
            <Ionicons name="person-circle" size={18} color="#2BB8CC" />
            <Text style={styles.contactBannerText}>Linked to contact: {fields.contactMatch}</Text>
            <TouchableOpacity onPress={() => { set('contactId', null); set('contactMatch', null); }}>
              <Ionicons name="close-circle" size={18} color="#64748b" />
            </TouchableOpacity>
          </View>
        )}

        <Text style={styles.label}>Notes</Text>
        <TextInput style={[styles.input, styles.inputMultiline]} value={fields.body} onChangeText={(v) => set('body', v)} multiline placeholderTextColor="#64748b" />

        <TouchableOpacity style={styles.saveBtn} onPress={save} disabled={saving || parsing}>
          {saving
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.saveBtnText}>Save task</Text>}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen:       { flex: 1, backgroundColor: '#0f172a' },
  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 60, paddingBottom: 12 },
  title:        { fontSize: 18, fontWeight: '700', color: '#f1f5f9' },
  body:         { paddingHorizontal: 20, paddingBottom: 40 },
  micBtn:       { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2BB8CC', borderRadius: 12, paddingVertical: 14, marginBottom: 16 },
  micBtnActive: { backgroundColor: '#dc2626' },
  micBtnText:   { color: '#fff', fontWeight: '700', fontSize: 15 },
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
  label:        { color: '#94a3b8', fontSize: 13, marginBottom: 6, marginTop: 10 },
  input:        { backgroundColor: '#1e293b', borderRadius: 10, paddingHorizontal: 12, height: 44, color: '#f1f5f9', fontSize: 15 },
  inputMultiline: { height: 88, paddingTop: 10, textAlignVertical: 'top' },
  chipRow:      { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip:         { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#1e293b' },
  chipActive:   { backgroundColor: '#2BB8CC' },
  chipText:     { color: '#94a3b8', fontSize: 13, textTransform: 'capitalize' },
  chipTextActive: { color: '#fff', fontWeight: '700' },
  contactBanner:     { flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: '#164e6333', borderRadius: 10, padding: 10, marginTop: 12 },
  contactBannerText: { color: '#7dd3fc', fontSize: 13, flex: 1 },
  saveBtn:      { backgroundColor: '#4C9A4C', borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 20 },
  saveBtnText:  { color: '#fff', fontWeight: '800', fontSize: 16 },
});
