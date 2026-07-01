/**
 * Role-based access control hooks for the frontend.
 *
 * Usage:
 *   const canWrite = useCanWrite();            // contacts/deals write operations
 *   const isAdmin  = useIsAdmin();             // tenant_admin or super_admin
 *   const isSuperAdmin = useIsSuperAdmin();    // super_admin only
 *   const can = useCan();                      // flexible: can('manage_team')
 */

import { useAuthStore } from '../store/auth.store';

type Role = 'super_admin' | 'tenant_admin' | 'operations_admin' | 'manager' | 'agent' | 'viewer' | 'policy_admin';

const ROLE_RANK: Record<Role, number> = {
  super_admin:       50,
  tenant_admin:      40,
  operations_admin:  35, // COO / Head of CC — cross-tenant read-only observer, no system config access
  policy_admin:      32, // governance role — outranks manager so no operational role can manage a compliance officer
  manager:           30,
  agent:             20,
  viewer:            10,
};

function getRank(role: string | undefined): number {
  return ROLE_RANK[(role as Role) ?? 'viewer'] ?? 0;
}

/** Returns true if the current user has at least the given role. */
export function useHasRole(...roles: Role[]): boolean {
  const { user } = useAuthStore();
  return roles.some((r) => user?.role === r);
}

/** tenant_admin or super_admin */
export function useIsAdmin(): boolean {
  const { user } = useAuthStore();
  return getRank(user?.role) >= ROLE_RANK.tenant_admin;
}

/** super_admin only */
export function useIsSuperAdmin(): boolean {
  const { user } = useAuthStore();
  return user?.role === 'super_admin';
}

/**
 * tenant_admin only (NOT super_admin). Administrative-only role: manages users,
 * roles, settings and integrations but has NO visibility of operational data
 * (CRM, sales, tickets, analytics, billing).
 */
export function useIsTenantAdmin(): boolean {
  const { user } = useAuthStore();
  return user?.role === 'tenant_admin';
}

/** manager, tenant_admin, or super_admin */
export function useIsManager(): boolean {
  const { user } = useAuthStore();
  return getRank(user?.role) >= ROLE_RANK.manager;
}

/** Policy Governance Admin — independent role, governs SLA policies by department */
export function useIsPolicyAdmin(): boolean {
  const { user } = useAuthStore();
  return user?.role === 'policy_admin';
}

/**
 * Operations Admin (rank 35) — COO / Head of Contact Centre.
 * Read-only visibility across all tickets, recordings, sales, contacts, and reports.
 * No system config access (users, integrations, SLA, routing).
 */
export function useIsOperationsAdmin(): boolean {
  const { user } = useAuthStore();
  return user?.role === 'operations_admin';
}

/**
 * Granular permission check.
 * add_more_permissions here as the product grows.
 */
export function useCan() {
  const { user } = useAuthStore();
  const rank = getRank(user?.role);

  const isOpsAdmin = user?.role === 'operations_admin';

  return {
    /** Create / edit / delete contacts, deals, companies, activities */
    writeRecords: rank >= ROLE_RANK.agent && !isOpsAdmin,
    /** Delete contacts / deals */
    deleteRecords: rank >= ROLE_RANK.manager && !isOpsAdmin,
    /** Invite / remove team members */
    manageTeam: rank >= ROLE_RANK.tenant_admin && !isOpsAdmin,
    /** Change workspace settings, connectors, billing */
    manageWorkspace: rank >= ROLE_RANK.tenant_admin && !isOpsAdmin,
    /** Create / revoke API keys and webhooks */
    manageIntegrations: rank >= ROLE_RANK.manager && !isOpsAdmin,
    manageSla: user?.role === 'policy_admin',
    /** View analytics and reports — operations_admin gets full cross-tenant view */
    viewAnalytics: rank >= ROLE_RANK.agent,
    /** Cross-tenant read-only visibility (operations_admin + tenant_admin + super_admin) */
    viewAllTenantData: rank >= ROLE_RANK.operations_admin,
    /** Manage all workspaces on the platform */
    superAdminAccess: user?.role === 'super_admin',
    /** Raw role for conditional rendering */
    role: user?.role as Role | undefined,
  };
}
