import type { FastifyInstance } from 'fastify';
export interface CRMModule {
    name: string;
    version: string;
    description: string;
    requiredPlan: 'free' | 'starter' | 'professional' | 'enterprise';
    dependencies?: string[];
    onLoad(ctx: ModuleContext): Promise<void>;
    onUnload?(): Promise<void>;
    registerRoutes?(fastify: FastifyInstance, prefix: string): Promise<void>;
    graphqlSchema?: string;
    eventHandlers?: ModuleEventHandler[];
}
export interface ModuleContext {
    db: unknown;
    redis: unknown;
    queue: unknown;
    eventBus: unknown;
    config: Record<string, string>;
}
export interface ModuleEventHandler {
    event: string;
    handler: (payload: unknown, tenantId: string) => Promise<void>;
}
export interface ModuleManifest {
    name: string;
    version: string;
    description: string;
    author: string;
    requiredPlan: string;
    entryPoint: string;
    icon?: string;
    tags: string[];
}
export interface NavItem {
    /** URL path, e.g. "/contacts" */
    path: string;
    /** Display label */
    label: string;
    /** Lucide icon name, e.g. "Users" */
    icon: string;
    /** Optional badge (e.g. unread count) */
    badge?: number;
    /** Child items for nested menus */
    children?: NavItem[];
    /**
     * Permission key required to show this item in the sidebar.
     * If absent the item is always shown. E.g. "contacts:read".
     */
    permissionKey?: string;
}
export interface PlatformModule {
    /** Unique machine-readable id, e.g. "crm" | "voice" | "ticketing" */
    id: string;
    /** Human label shown in module switcher */
    label: string;
    /** Icon for the module switcher */
    icon: string;
    /** Minimum plan required */
    requiredPlan: 'free' | 'starter' | 'professional' | 'enterprise';
    /** Sidebar nav items exposed by this module */
    navItems: NavItem[];
    /** Called once when the module is activated for a server instance */
    onLoad(ctx: ModuleContext): Promise<void>;
    onUnload?(): Promise<void>;
    /** Register all HTTP routes under the given prefix */
    registerRoutes(fastify: FastifyInstance, prefix: string): Promise<void>;
}
/** Shape returned by GET /api/v1/modules */
export interface ActiveModuleInfo {
    id: string;
    label: string;
    icon: string;
    navItems: NavItem[];
}
//# sourceMappingURL=module.d.ts.map