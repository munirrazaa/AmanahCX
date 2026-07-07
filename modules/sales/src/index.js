"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SalesPlatformModule = void 0;
const logger_1 = require("@crm/core/config/logger");
class SalesPlatformModule {
    id = 'sales';
    label = 'Sales';
    icon = 'FileText';
    requiredPlan = 'starter';
    navItems = [
        { path: '/sales/dashboard', label: 'Sales Dashboard', icon: 'LayoutDashboard', permissionKey: 'billing:read' },
        { path: '/sales/invoices', label: 'Invoices', icon: 'FileText', permissionKey: 'billing:read' },
        { path: '/sales/contacts', label: 'Bill Contacts', icon: 'Users', permissionKey: 'billing:read' },
        { path: '/sales/payments', label: 'Payments', icon: 'CreditCard', permissionKey: 'billing:read' },
        { path: '/sales/reports', label: 'Reports', icon: 'BarChart2', permissionKey: 'billing:read' },
        { path: '/sales/templates', label: 'Templates', icon: 'List', permissionKey: 'billing:read' },
        { path: '/sales/builder', label: 'Builder', icon: 'Layers', permissionKey: 'billing:read' },
        { path: '/sales/settings', label: 'Sales Settings', icon: 'Settings', permissionKey: 'billing:manage' },
    ];
    async onLoad(_ctx) {
        logger_1.logger.info('Sales Platform Module loaded');
    }
    async onUnload() {
        logger_1.logger.info('Sales Platform Module unloaded');
    }
    async registerRoutes(_fastify, prefix) {
        logger_1.logger.info(`Sales routes registered under ${prefix}`);
    }
}
exports.SalesPlatformModule = SalesPlatformModule;
//# sourceMappingURL=index.js.map