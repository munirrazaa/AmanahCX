import { View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuthStore } from '@/store/auth';

interface MenuItem {
  icon:  React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  danger?: boolean;
}

export default function ProfileScreen() {
  const router       = useRouter();
  const { user, tenant, clearSession } = useAuthStore();

  async function handleLogout() {
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: async () => {
        await clearSession();
        router.replace('/(auth)/login');
      }},
    ]);
  }

  const initials = user?.name
    ?.split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() ?? '??';

  const menuItems: MenuItem[] = [
    { icon: 'notifications-outline', label: 'Notifications',       onPress: () => {} },
    { icon: 'lock-closed-outline',   label: 'Change password',     onPress: () => {} },
    { icon: 'help-circle-outline',   label: 'Help & support',      onPress: () => {} },
    { icon: 'log-out-outline',       label: 'Sign out',            onPress: handleLogout, danger: true },
  ];

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {/* Avatar */}
      <View style={styles.avatarContainer}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>
        <Text style={styles.name}>{user?.name}</Text>
        <Text style={styles.role}>{user?.role?.replace('_', ' ')}</Text>
        <View style={styles.tenantBadge}>
          <Ionicons name="business-outline" size={12} color="#64748b" />
          <Text style={styles.tenantName}>{tenant?.name}</Text>
        </View>
      </View>

      {/* Info cards */}
      <View style={styles.infoCard}>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Email</Text>
          <Text style={styles.infoValue}>{user?.email}</Text>
        </View>
        {user?.department_type && (
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Department</Text>
            <Text style={styles.infoValue}>{user.department_type.replace('_', ' ')}</Text>
          </View>
        )}
        <View style={[styles.infoRow, { borderBottomWidth: 0 }]}>
          <Text style={styles.infoLabel}>Workspace</Text>
          <Text style={styles.infoValue}>{tenant?.slug}</Text>
        </View>
      </View>

      {/* Menu */}
      <View style={styles.menuCard}>
        {menuItems.map((item, i) => (
          <TouchableOpacity
            key={item.label}
            style={[styles.menuRow, i < menuItems.length - 1 && styles.menuRowBorder]}
            onPress={item.onPress}
          >
            <Ionicons name={item.icon} size={20} color={item.danger ? '#ef4444' : '#64748b'} style={styles.menuIcon} />
            <Text style={[styles.menuLabel, item.danger && { color: '#ef4444' }]}>{item.label}</Text>
            {!item.danger && <Ionicons name="chevron-forward" size={16} color="#475569" />}
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.version}>CRM Platform · v1.0.0</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen:           { flex: 1, backgroundColor: '#0f172a' },
  content:          { padding: 20, paddingTop: 60, paddingBottom: 40 },
  avatarContainer:  { alignItems: 'center', marginBottom: 28 },
  avatar:           { width: 80, height: 80, borderRadius: 40, backgroundColor: '#1d4ed8', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  avatarText:       { fontSize: 28, fontWeight: '800', color: '#fff' },
  name:             { fontSize: 22, fontWeight: '700', color: '#f1f5f9' },
  role:             { fontSize: 13, color: '#64748b', marginTop: 4, textTransform: 'capitalize' },
  tenantBadge:      { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8, backgroundColor: '#1e293b', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5 },
  tenantName:       { fontSize: 12, color: '#64748b' },
  infoCard:         { backgroundColor: '#1e293b', borderRadius: 12, marginBottom: 16, overflow: 'hidden' },
  infoRow:          { flexDirection: 'row', justifyContent: 'space-between', padding: 14, borderBottomWidth: 1, borderBottomColor: '#334155' },
  infoLabel:        { fontSize: 13, color: '#64748b', fontWeight: '600' },
  infoValue:        { fontSize: 13, color: '#f1f5f9', maxWidth: '60%', textAlign: 'right' },
  menuCard:         { backgroundColor: '#1e293b', borderRadius: 12, marginBottom: 28, overflow: 'hidden' },
  menuRow:          { flexDirection: 'row', alignItems: 'center', padding: 16 },
  menuRowBorder:    { borderBottomWidth: 1, borderBottomColor: '#334155' },
  menuIcon:         { marginRight: 12 },
  menuLabel:        { flex: 1, fontSize: 15, color: '#f1f5f9' },
  version:          { textAlign: 'center', fontSize: 12, color: '#334155' },
});
