/**
 * API client for the CRM Platform mobile app.
 * Wraps fetch with auth headers, base URL, and structured error handling.
 * Uses the same REST contract as the web frontend.
 */

import * as SecureStore from 'expo-secure-store';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';
const TOKEN_KEY = 'crm_access_token';
const TENANT_KEY = 'crm_tenant_slug';

// ── Token management ────────────────────────────────────────────────────────

export async function saveCredentials(token: string, tenantSlug: string) {
  await Promise.all([
    SecureStore.setItemAsync(TOKEN_KEY, token),
    SecureStore.setItemAsync(TENANT_KEY, tenantSlug),
  ]);
}

export async function clearCredentials() {
  await Promise.all([
    SecureStore.deleteItemAsync(TOKEN_KEY),
    SecureStore.deleteItemAsync(TENANT_KEY),
  ]);
}

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

// ── Core fetch wrapper ───────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token      = await getToken();
  const tenantSlug = await SecureStore.getItemAsync(TENANT_KEY);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> ?? {}),
  };
  if (token)      headers['Authorization'] = `Bearer ${token}`;
  if (tenantSlug) headers['X-Tenant-Slug'] = tenantSlug;

  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    let code: string | undefined;
    try {
      const body = await res.json();
      message = body?.error?.message ?? body?.error ?? message;
      code    = body?.error?.code;
    } catch { /* ignore */ }
    throw new ApiError(message, res.status, code);
  }

  // 204 No Content
  if (res.status === 204) return undefined as T;

  const json = await res.json();
  return json.data !== undefined ? json.data : json;
}

// ── Typed helpers ───────────────────────────────────────────────────────────

export const api = {
  get:    <T>(path: string) => request<T>(path),
  post:   <T>(path: string, body: unknown) => request<T>(path, { method: 'POST',   body: JSON.stringify(body) }),
  patch:  <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH',  body: JSON.stringify(body) }),
  delete: <T>(path: string)               => request<T>(path, { method: 'DELETE' }),
};

// ── Auth ─────────────────────────────────────────────────────────────────────

export interface LoginResponse {
  token: string;
  user: {
    id: string;
    name: string;
    email: string;
    role: string;
    department_type: string | null;
  };
  tenant: {
    id: string;
    slug: string;
    name: string;
  };
}

export async function login(email: string, password: string, tenantSlug: string): Promise<LoginResponse> {
  // Set tenant slug header manually for the login request
  const res = await fetch(`${BASE_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant-Slug': tenantSlug,
    },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(
      body?.error?.message ?? 'Login failed',
      res.status,
      body?.error?.code,
    );
  }

  const json = await res.json();
  const data = json.data ?? json;
  await saveCredentials(data.token, tenantSlug);
  return data as LoginResponse;
}
