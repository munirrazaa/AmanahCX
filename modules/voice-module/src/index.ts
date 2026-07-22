/**
 * Voice Platform Module
 *
 * Adds AI-powered voice calling to the platform.
 * Requires the `voiceBot` feature flag and at least the `starter` plan.
 *
 * Bundles: Voice Calls list, Voice Analytics, Live Call Stream.
 * Requires a connected telephony provider (Twilio / Vonage / SIP).
 */

import type { FastifyInstance } from 'fastify';
import type { PlatformModule, ModuleContext } from '@crm/shared';
import { logger } from '@crm/core/config/logger';

export class VoicePlatformModule implements PlatformModule {
  // Must match the licensing/entitlement key used everywhere else in the
  // system (super-admin licensing, MODULE_CATALOG, ticket channel values,
  // frontend feature flags) — was 'voice', which never matched any tenant's
  // active_modules value ('voice_bot'), so this module could never actually
  // be found once looked up by its licensed key. Confirmed 2026-07-22: this
  // is why re-enabling the module after disabling it never restored access.
  readonly id = 'voice_bot';
  readonly label = 'Voice';
  readonly icon = 'Phone';
  readonly requiredPlan = 'starter' as const;

  readonly navItems = [
    { path: '/voice',             label: 'Voice Calls',    icon: 'Phone',    permissionKey: 'voice:read'    },
    { path: '/voice/analytics',   label: 'Call Analytics', icon: 'BarChart2',permissionKey: 'voice:read'    },
    { path: '/voice-bot',         label: 'Voice Bot',      icon: 'Bot',      permissionKey: 'voicebot:read' },
    { path: '/voice-bot/calls',   label: 'Bot Calls',      icon: 'List',     permissionKey: 'voicebot:read' },
    { path: '/voice-bot/tickets', label: 'Bot Tickets',    icon: 'LifeBuoy', permissionKey: 'voicebot:read' },
  ];

  async onLoad(_ctx: ModuleContext): Promise<void> {
    logger.info('Voice Platform Module loaded');
  }

  async onUnload(): Promise<void> {
    logger.info('Voice Platform Module unloaded');
  }

  async registerRoutes(fastify: FastifyInstance, prefix: string): Promise<void> {
    logger.info(`Voice routes registered under ${prefix}`);
  }
}
