"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ModuleRegistry = void 0;
const logger_1 = require("../config/logger");
class ModuleRegistry {
    modules = new Map();
    loadOrder = [];
    // ── Platform module registry (HubSpot-style product "Hubs") ────────────
    platformModules = new Map();
    platformLoadOrder = [];
    register(mod) {
        if (this.modules.has(mod.name)) {
            throw new Error(`Module '${mod.name}' is already registered`);
        }
        this.modules.set(mod.name, mod);
        logger_1.logger.info('Module registered', { module: mod.name, version: mod.version });
    }
    get(name) {
        return this.modules.get(name);
    }
    list() {
        return this.loadOrder.map((n) => this.modules.get(n));
    }
    async loadAll(ctx) {
        const sorted = this.topologicalSort();
        for (const name of sorted) {
            const mod = this.modules.get(name);
            logger_1.logger.info('Loading module', { module: name });
            await mod.onLoad(ctx);
            this.loadOrder.push(name);
            logger_1.logger.info('Module loaded', { module: name });
        }
    }
    async unloadAll() {
        // Unload feature modules in reverse order
        for (const name of [...this.loadOrder].reverse()) {
            const mod = this.modules.get(name);
            if (mod?.onUnload) {
                await mod.onUnload();
                logger_1.logger.info('Module unloaded', { module: name });
            }
        }
        // Unload platform modules
        await this.unloadAllPlatform();
    }
    // ── Platform module methods ─────────────────────────────────────────────
    registerPlatform(mod) {
        if (this.platformModules.has(mod.id)) {
            throw new Error(`Platform module '${mod.id}' is already registered`);
        }
        this.platformModules.set(mod.id, mod);
        logger_1.logger.info('Platform module registered', { module: mod.id });
    }
    getPlatform(id) {
        return this.platformModules.get(id);
    }
    listPlatformModules() {
        return this.platformLoadOrder.map((id) => this.platformModules.get(id));
    }
    /**
     * Returns the ActiveModuleInfo list for a specific tenant.
     * Filters by tenant's activeModules setting; defaults to ['crm'] if not set.
     */
    getActiveModulesForTenant(activeModuleIds) {
        return activeModuleIds
            .map((id) => this.platformModules.get(id))
            .filter((mod) => mod !== undefined)
            .map(({ id, label, icon, navItems }) => ({ id, label, icon, navItems }));
    }
    async loadAllPlatform(ctx) {
        for (const [id, mod] of this.platformModules) {
            logger_1.logger.info('Loading platform module', { module: id });
            await mod.onLoad(ctx);
            this.platformLoadOrder.push(id);
            logger_1.logger.info('Platform module loaded', { module: id });
        }
    }
    async unloadAllPlatform() {
        for (const id of [...this.platformLoadOrder].reverse()) {
            const mod = this.platformModules.get(id);
            if (mod?.onUnload) {
                await mod.onUnload();
                logger_1.logger.info('Platform module unloaded', { module: id });
            }
        }
    }
    // ── Kahn's algorithm to respect module dependency order ─────────────────
    topologicalSort() {
        const inDegree = new Map();
        const adjList = new Map();
        for (const [name, mod] of this.modules) {
            inDegree.set(name, 0);
            adjList.set(name, []);
            for (const dep of mod.dependencies ?? []) {
                if (!this.modules.has(dep)) {
                    throw new Error(`Module '${name}' requires '${dep}' which is not registered`);
                }
                adjList.get(dep).push(name);
                inDegree.set(name, (inDegree.get(name) ?? 0) + 1);
            }
        }
        const queue = [...inDegree.entries()]
            .filter(([, deg]) => deg === 0)
            .map(([name]) => name);
        const result = [];
        while (queue.length > 0) {
            const node = queue.shift();
            result.push(node);
            for (const neighbor of adjList.get(node) ?? []) {
                const deg = (inDegree.get(neighbor) ?? 0) - 1;
                inDegree.set(neighbor, deg);
                if (deg === 0)
                    queue.push(neighbor);
            }
        }
        if (result.length !== this.modules.size) {
            throw new Error('Circular dependency detected in modules');
        }
        return result;
    }
}
exports.ModuleRegistry = ModuleRegistry;
//# sourceMappingURL=module-registry.js.map