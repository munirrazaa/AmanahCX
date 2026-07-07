"use strict";
/**
 * Voice Platform Module
 *
 * Adds AI-powered voice calling to the platform.
 * Requires the `voiceBot` feature flag and at least the `starter` plan.
 *
 * Bundles: Voice Calls list, Voice Analytics, Live Call Stream.
 * Requires a connected telephony provider (Twilio / Vonage / SIP).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.VoicePlatformModule = void 0;
const logger_1 = require("@crm/core/config/logger");
class VoicePlatformModule {
    id = 'voice';
    label = 'Voice';
    icon = 'Phone';
    requiredPlan = 'starter';
    navItems = [
        { path: '/voice', label: 'Voice Calls', icon: 'Phone', permissionKey: 'voice:read' },
        { path: '/voice/analytics', label: 'Call Analytics', icon: 'BarChart2', permissionKey: 'voice:read' },
        { path: '/voice-bot', label: 'Voice Bot', icon: 'Bot', permissionKey: 'voicebot:read' },
        { path: '/voice-bot/calls', label: 'Bot Calls', icon: 'List', permissionKey: 'voicebot:read' },
        { path: '/voice-bot/tickets', label: 'Bot Tickets', icon: 'LifeBuoy', permissionKey: 'voicebot:read' },
    ];
    async onLoad(_ctx) {
        logger_1.logger.info('Voice Platform Module loaded');
    }
    async onUnload() {
        logger_1.logger.info('Voice Platform Module unloaded');
    }
    async registerRoutes(fastify, prefix) {
        logger_1.logger.info(`Voice routes registered under ${prefix}`);
    }
}
exports.VoicePlatformModule = VoicePlatformModule;
//# sourceMappingURL=index.js.map