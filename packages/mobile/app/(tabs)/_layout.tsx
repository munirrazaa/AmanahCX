import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

type IoniconsName = React.ComponentProps<typeof Ionicons>['name'];

function icon(focused: boolean, name: IoniconsName, outlineName: IoniconsName) {
  return <Ionicons name={focused ? name : outlineName} size={22} color={focused ? '#2BB8CC' : '#64748b'} />;
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown:       false,
        tabBarStyle:       { backgroundColor: '#1e293b', borderTopColor: '#334155' },
        tabBarActiveTintColor:   '#2BB8CC',
        tabBarInactiveTintColor: '#64748b',
        tabBarLabelStyle:  { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="tasks"
        options={{
          title: 'My Tasks',
          tabBarIcon: ({ focused }) => icon(focused, 'checkbox', 'checkbox-outline'),
        }}
      />
      <Tabs.Screen
        name="dashboard"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ focused }) => icon(focused, 'grid', 'grid-outline'),
        }}
      />
      <Tabs.Screen
        name="contacts"
        options={{
          title: 'Contacts',
          tabBarIcon: ({ focused }) => icon(focused, 'people', 'people-outline'),
        }}
      />
      <Tabs.Screen
        name="tickets"
        options={{
          title: 'Tickets',
          tabBarIcon: ({ focused }) => icon(focused, 'ticket', 'ticket-outline' as any),
        }}
      />
      <Tabs.Screen
        name="deals"
        options={{
          title: 'Deals',
          tabBarIcon: ({ focused }) => icon(focused, 'trending-up', 'trending-up-outline'),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ focused }) => icon(focused, 'person-circle', 'person-circle-outline'),
        }}
      />
    </Tabs>
  );
}
