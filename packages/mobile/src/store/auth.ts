import { create } from 'zustand';
import { clearCredentials, type LoginResponse } from '@/lib/api';

interface AuthState {
  user: LoginResponse['user'] | null;
  tenant: LoginResponse['tenant'] | null;
  isAuthenticated: boolean;
  setSession: (data: LoginResponse) => void;
  clearSession: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  tenant: null,
  isAuthenticated: false,

  setSession: (data) =>
    set({ user: data.user, tenant: data.tenant, isAuthenticated: true }),

  clearSession: async () => {
    await clearCredentials();
    set({ user: null, tenant: null, isAuthenticated: false });
  },
}));
