import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { api } from '@/lib/api';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [email,   setEmail]   = useState('');
  const [loading, setLoading] = useState(false);
  const [sent,    setSent]    = useState(false);

  async function handleSubmit() {
    if (!email.trim()) { Alert.alert('Enter your email address'); return; }
    setLoading(true);
    try {
      await api.post('/auth/forgot-password', { email: email.trim() });
      setSent(true);
    } catch {
      // Always show success to avoid email enumeration
      setSent(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.card}>
        <Text style={styles.title}>Reset password</Text>

        {sent ? (
          <>
            <Text style={styles.successText}>
              If that email is registered, you'll receive a password reset link shortly.
            </Text>
            <TouchableOpacity style={styles.button} onPress={() => router.back()}>
              <Text style={styles.buttonText}>Back to login</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={styles.label}>Email address</Text>
            <TextInput
              style={styles.input}
              placeholder="you@company.com"
              placeholderTextColor="#94a3b8"
              keyboardType="email-address"
              autoCapitalize="none"
              value={email}
              onChangeText={setEmail}
            />
            <TouchableOpacity
              style={[styles.button, loading && { opacity: 0.6 }]}
              onPress={handleSubmit}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.buttonText}>Send reset link</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={styles.backLink} onPress={() => router.back()}>
              <Text style={styles.backText}>Back</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: '#0f172a', justifyContent: 'center', padding: 24 },
  card:        { backgroundColor: '#1e293b', borderRadius: 16, padding: 28 },
  title:       { fontSize: 22, fontWeight: '700', color: '#f1f5f9', marginBottom: 20 },
  label:       { fontSize: 13, fontWeight: '600', color: '#cbd5e1', marginBottom: 6 },
  input:       {
    backgroundColor: '#0f172a', borderWidth: 1, borderColor: '#334155',
    borderRadius: 10, padding: 14, fontSize: 15, color: '#f1f5f9', marginBottom: 16,
  },
  button:      { backgroundColor: '#2BB8CC', borderRadius: 10, padding: 15, alignItems: 'center' },
  buttonText:  { color: '#fff', fontWeight: '700', fontSize: 16 },
  backLink:    { marginTop: 16, alignItems: 'center' },
  backText:    { color: '#64748b', fontSize: 14 },
  successText: { color: '#94a3b8', fontSize: 15, lineHeight: 22, marginBottom: 24 },
});
