import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore } from '@/store/auth';
import { login, ApiError } from '@/lib/api';
import { registerForPushNotifications } from '@/lib/notifications';

export default function LoginScreen() {
  const router    = useRouter();
  const setSession = useAuthStore((s) => s.setSession);

  const [tenantSlug, setTenantSlug] = useState('');
  const [email,      setEmail]      = useState('');
  const [password,   setPassword]   = useState('');
  const [loading,    setLoading]    = useState(false);

  async function handleLogin() {
    if (!tenantSlug.trim() || !email.trim() || !password) {
      Alert.alert('Missing fields', 'Please fill in all fields.');
      return;
    }
    setLoading(true);
    try {
      const data = await login(email.trim(), password, tenantSlug.trim().toLowerCase());
      setSession(data);
      // Register push token in background — non-blocking
      registerForPushNotifications().catch(() => {});
      router.replace('/(tabs)/dashboard');
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Login failed. Please try again.';
      Alert.alert('Login failed', msg);
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
        <Text style={styles.logo}>CRM</Text>
        <Text style={styles.title}>Sign in to your workspace</Text>

        <Text style={styles.label}>Workspace</Text>
        <TextInput
          style={styles.input}
          placeholder="your-company"
          placeholderTextColor="#94a3b8"
          autoCapitalize="none"
          autoCorrect={false}
          value={tenantSlug}
          onChangeText={setTenantSlug}
        />

        <Text style={styles.label}>Email</Text>
        <TextInput
          style={styles.input}
          placeholder="you@company.com"
          placeholderTextColor="#94a3b8"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          value={email}
          onChangeText={setEmail}
        />

        <Text style={styles.label}>Password</Text>
        <TextInput
          style={styles.input}
          placeholder="••••••••"
          placeholderTextColor="#94a3b8"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          onSubmitEditing={handleLogin}
          returnKeyType="go"
        />

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleLogin}
          disabled={loading}
        >
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.buttonText}>Sign in</Text>}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.forgotLink}
          onPress={() => router.push('/(auth)/forgot-password')}
        >
          <Text style={styles.forgotText}>Forgot password?</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container:      { flex: 1, backgroundColor: '#0f172a', justifyContent: 'center', padding: 24 },
  card:           { backgroundColor: '#1e293b', borderRadius: 16, padding: 28 },
  logo:           { fontSize: 28, fontWeight: '800', color: '#29ABE2', textAlign: 'center', marginBottom: 4 },
  title:          { fontSize: 15, color: '#94a3b8', textAlign: 'center', marginBottom: 28 },
  label:          { fontSize: 13, fontWeight: '600', color: '#cbd5e1', marginBottom: 6 },
  input:          {
    backgroundColor: '#0f172a', borderWidth: 1, borderColor: '#334155',
    borderRadius: 10, padding: 14, fontSize: 15, color: '#f1f5f9', marginBottom: 16,
  },
  button:         { backgroundColor: '#29ABE2', borderRadius: 10, padding: 15, alignItems: 'center', marginTop: 4 },
  buttonDisabled: { opacity: 0.6 },
  buttonText:     { color: '#fff', fontWeight: '700', fontSize: 16 },
  forgotLink:     { marginTop: 16, alignItems: 'center' },
  forgotText:     { color: '#29ABE2', fontSize: 14 },
});
