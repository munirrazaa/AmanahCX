"use strict";
/**
 * CRM Platform Module
 *
 * The core CRM "Hub" — equivalent to HubSpot's CRM Hub.
 * Bundles: Contacts, Companies, Deals, Activities, and the CRM Dashboard.
 *
 * This module is always active (included in every tenant's activeModules by default).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CRMPlatformModule = void 0;
const logger_1 = require("@crm/core/config/logger");
class CRMPlatformModule {
    id = 'crm';
    label = 'CRM';
    icon = 'LayoutDashboard';
    requiredPlan = 'free';
    navItems = [
        { path: '/contacts', label: 'Contacts', icon: 'Users', permissionKey: 'contacts:read' },
        { path: '/companies', label: 'Companies', icon: 'Building2', permissionKey: 'companies:read' },
        { path: '/deals', label: 'Deals', icon: 'TrendingUp', permissionKey: 'deals:read' },
        { path: '/activities', label: 'Activities', icon: 'CheckSquare', permissionKey: 'activities:read' },
        { path: '/emails', label: 'Emails', icon: 'Mail', permissionKey: 'emails:read' },
        { path: '/emails/analytics', label: 'Email Analytics', icon: 'BarChart2', permissionKey: 'emails:read' },
        { path: '/analytics', label: 'Analytics', icon: 'BarChart3', permissionKey: 'analytics:read' },
    ];
    async onLoad(_ctx) {
        logger_1.logger.info('CRM Platform Module loaded');
    }
    async onUnload() {
        logger_1.logger.info('CRM Platform Module unloaded');
    }
    async registerRoutes(fastify, prefix) {
        // Routes are registered individually in server.ts under /api/v1/*.
        // This hook is available for module-owned route registration if needed.
        logger_1.logger.info(`CRM routes registered under ${prefix}`);
    }
}
exports.CRMPlatformModule = CRMPlatformModule;
//# sourceMappingURL=index.js.map