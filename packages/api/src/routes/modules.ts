/**
 * GET /api/v1/modules
 *
 * Returns the active platform modules for the authenticated tenant with nav items
 * filtered to only those the calling user's role has permission to access.
 */

import type { FastifyInstance } from 'fastify';
import type { ModuleRegistry } from '@crm/core';

export function modulesRoute(moduleRegistry: ModuleRegistry) {
  return async function (fastify: FastifyInstance) {
    fastify.get('/', async (req, reply) => {
      const tenant = req.tenant;
      const user   = req.user as any;

      const activeModuleIds: string[] =
        (tenant as any).active_modules ?? tenant.activeModules ?? ['crm'];

      const allModules = moduleRegistry.getActiveModulesForTenant(activeModuleIds);

      // Super admin and tenant admin always see every nav item.
      const role = user?.role ?? 'agent';
      if (role === 'super_admin' || role === 'tenant_admin') {
        return reply.send({ success: true, data: allModules });
      }

      // For all other roles filter nav items by the permissions embedded in the JWT.
      // Two formats exist:
      //   New: { 'contacts:read': true }   — from defaultPermissions()
      //   Old: { contacts: 'full'|'view'|'none' } — from legacy custom roles
      const perms: Record<string, unknown> = user?.permissions ?? {};

      function hasPermission(permKey: string): boolean {
        // New format check
        if (perms[permKey] === true) return true;
        // Old format: strip the action suffix, check module-level value
        const module = permKey.split(':')[0];
        const val = perms[module];
        return val === 'full' || val === 'view';
      }

      const filtered = allModules
        .map((mod) => ({
          ...mod,
          navItems: mod.navItems.filter((item: any) =>
            !item.permissionKey || hasPermission(item.permissionKey),
          ),
        }))
        .filter((mod) => mod.navItems.length > 0);

      return reply.send({ success: true, data: filtered });
    });
  };
}
