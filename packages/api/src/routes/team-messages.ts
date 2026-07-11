/**
 * Team Messaging routes — internal tenant chat (channels + DMs)
 * GET  /api/v1/messages/channels          — list available channels
 * GET  /api/v1/messages/channel/:name     — get messages in a channel
 * POST /api/v1/messages/channel/:name     — post to a channel
 * GET  /api/v1/messages/dm/:userId        — get DM thread + request/block status with a user
 * POST /api/v1/messages/dm/:userId        — send a DM (creates a pending request on first contact)
 * POST /api/v1/messages/dm/:userId/respond — accept | delete | block an incoming request
 * POST /api/v1/messages/dm/:userId/unblock — remove a block I placed on this user
 * GET  /api/v1/messages/blocked           — list of users I've blocked
 * GET  /api/v1/messages/team-members      — list users in this tenant (grouped by department/designation)
 */

import type { FastifyInstance } from 'fastify';
import type { DatabaseClient } from '@crm/core';

const DEFAULT_CHANNELS = ['general', 'announcements', 'support', 'sales'];

// dm_requests rows are keyed by the pair sorted low/high so (A,B) and (B,A)
// always resolve to the same row regardless of who's asking.
function sortPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export function teamMessageRoutes(db: DatabaseClient) {
  return async function (fastify: FastifyInstance) {

    // Ensure tables exist (idempotent bootstrap)
    fastify.addHook('onReady', async () => {
      await db.withSuperAdmin(async (client) => {
        await client.query(`
          CREATE TABLE IF NOT EXISTS team_messages (
            id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id    UUID        NOT NULL,
            sender_id    UUID        NOT NULL,
            sender_name  TEXT        NOT NULL,
            channel      TEXT,
            recipient_id UUID,
            content      TEXT        NOT NULL,
            message_type TEXT        NOT NULL DEFAULT 'channel'
              CHECK (message_type IN ('channel', 'dm')),
            created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_team_msgs_tenant  ON team_messages(tenant_id, created_at DESC)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_team_msgs_channel ON team_messages(tenant_id, channel, created_at DESC) WHERE channel IS NOT NULL`);
        await client.query(`
          CREATE TABLE IF NOT EXISTS dm_requests (
            id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id    UUID        NOT NULL,
            user_low     UUID        NOT NULL,
            user_high    UUID        NOT NULL,
            requested_by UUID        NOT NULL,
            status       TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
            created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (tenant_id, user_low, user_high)
          )
        `);
        await client.query(`
          CREATE TABLE IF NOT EXISTS dm_blocks (
            id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id  UUID        NOT NULL,
            blocker_id UUID        NOT NULL,
            blocked_id UUID        NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (tenant_id, blocker_id, blocked_id)
          )
        `);
      });
    });

    // List channels (distinct channels that have messages + defaults)
    fastify.get('/channels', async (req, reply) => {
      const rows = await db.withSuperAdmin(async (client) => {
        const res = await client.query(
          `SELECT DISTINCT channel, COUNT(*) as message_count,
                  MAX(created_at) as last_message_at
           FROM team_messages
           WHERE tenant_id = $1 AND message_type = 'channel' AND channel IS NOT NULL
           GROUP BY channel
           ORDER BY MAX(created_at) DESC`,
          [req.tenant.id],
        );
        return res.rows;
      });

      const activeChannels = rows.map((r: any) => r.channel);
      const allChannels = [...new Set([...DEFAULT_CHANNELS, ...activeChannels])];

      const channelData = allChannels.map((name) => {
        const row = rows.find((r: any) => r.channel === name);
        return { name, message_count: row ? parseInt(row.message_count) : 0, last_message_at: row?.last_message_at ?? null };
      });

      return reply.send({ success: true, data: channelData });
    });

    // Get messages in a channel (last 100, newest last)
    fastify.get('/channel/:name', async (req, reply) => {
      const { name } = req.params as { name: string };
      const rows = await db.withSuperAdmin(async (client) => {
        const res = await client.query(
          `SELECT id, sender_id, sender_name, content, created_at
           FROM team_messages
           WHERE tenant_id = $1 AND channel = $2 AND message_type = 'channel'
           ORDER BY created_at ASC
           LIMIT 100`,
          [req.tenant.id, name],
        );
        return res.rows;
      });
      return reply.send({ success: true, data: rows });
    });

    // Post to a channel
    fastify.post('/channel/:name', async (req, reply) => {
      const { name } = req.params as { name: string };
      const { content } = req.body as { content: string };
      if (!content?.trim()) return reply.code(400).send({ success: false, error: { code: 'EMPTY', message: 'Message cannot be empty' } });

      const myId = req.user.sub;

      const [row] = await db.withSuperAdmin(async (client) => {
        const me = await client.query(`SELECT name, email FROM users WHERE id = $1`, [myId]);
        const senderName = me.rows[0]?.name || me.rows[0]?.email || 'Unknown';
        const res = await client.query(
          `INSERT INTO team_messages (tenant_id, sender_id, sender_name, channel, content, message_type)
           VALUES ($1, $2, $3, $4, $5, 'channel') RETURNING *`,
          [req.tenant.id, myId, senderName, name, content.trim()],
        );
        return res.rows;
      });
      return reply.code(201).send({ success: true, data: row });
    });

    // List team members — grouped-ready: includes department + designation
    // (their custom role title, falling back to their base role) so the
    // frontend can group the directory by department then designation.
    fastify.get('/team-members', async (req, reply) => {
      const rows = await db.withSuperAdmin(async (client) => {
        const res = await client.query(
          `SELECT u.id, u.name, u.email, u.role,
                  u.department,
                  COALESCE(r.name, INITCAP(u.role)) AS designation
           FROM users u
           LEFT JOIN roles r ON r.id = u.custom_role_id
           WHERE u.tenant_id = $1 AND u.is_active = true
           ORDER BY u.department NULLS LAST, designation, u.name`,
          [req.tenant.id],
        );
        return res.rows;
      });
      return reply.send({ success: true, data: rows });
    });

    // List users I've blocked, so the UI can offer to unblock them
    fastify.get('/blocked', async (req, reply) => {
      const myId = req.user.sub;
      const rows = await db.withSuperAdmin(async (client) => {
        const res = await client.query(
          `SELECT b.blocked_id AS id, u.name, u.email
           FROM dm_blocks b
           JOIN users u ON u.id = b.blocked_id
           WHERE b.tenant_id = $1 AND b.blocker_id = $2
           ORDER BY u.name`,
          [req.tenant.id, myId],
        );
        return res.rows;
      });
      return reply.send({ success: true, data: rows });
    });

    // Get DM thread with a user, plus the request/block status governing it
    fastify.get('/dm/:userId', async (req, reply) => {
      const { userId } = req.params as { userId: string };
      const myId = req.user.sub;
      const [userLow, userHigh] = sortPair(myId, userId);

      const result = await db.withSuperAdmin(async (client) => {
        const msgs = await client.query(
          `SELECT id, sender_id, sender_name, recipient_id, content, created_at
           FROM team_messages
           WHERE tenant_id = $1 AND message_type = 'dm'
             AND (
               (sender_id = $2 AND recipient_id = $3) OR
               (sender_id = $3 AND recipient_id = $2)
             )
           ORDER BY created_at ASC LIMIT 100`,
          [req.tenant.id, myId, userId],
        );

        const reqRow = await client.query(
          `SELECT requested_by, status FROM dm_requests
           WHERE tenant_id = $1 AND user_low = $2 AND user_high = $3`,
          [req.tenant.id, userLow, userHigh],
        );

        const blockedByMe = await client.query(
          `SELECT 1 FROM dm_blocks WHERE tenant_id = $1 AND blocker_id = $2 AND blocked_id = $3`,
          [req.tenant.id, myId, userId],
        );
        const blockedThem = await client.query(
          `SELECT 1 FROM dm_blocks WHERE tenant_id = $1 AND blocker_id = $2 AND blocked_id = $3`,
          [req.tenant.id, userId, myId],
        );

        return {
          messages: msgs.rows,
          request: reqRow.rows[0] ?? null,
          iBlockedThem: blockedByMe.rows.length > 0,
          theyBlockedMe: blockedThem.rows.length > 0,
        };
      });

      return reply.send({ success: true, data: result });
    });

    // Send a DM. First message between two users creates a pending request;
    // the recipient must accept before the requester's later messages will
    // be delivered. The recipient's own reply is not treated as an implicit
    // accept — they must explicitly Accept/Delete/Block the request first.
    fastify.post('/dm/:userId', async (req, reply) => {
      const { userId } = req.params as { userId: string };
      const { content } = req.body as { content: string };
      if (!content?.trim()) return reply.code(400).send({ success: false, error: { code: 'EMPTY', message: 'Message cannot be empty' } });

      const myId = req.user.sub;
      const tenantId = req.tenant.id;
      const [userLow, userHigh] = sortPair(myId, userId);

      const blocked = await db.withSuperAdmin(async (client) => {
        const r = await client.query(
          `SELECT blocker_id FROM dm_blocks
           WHERE tenant_id = $1 AND ((blocker_id = $2 AND blocked_id = $3) OR (blocker_id = $3 AND blocked_id = $2))`,
          [tenantId, myId, userId],
        );
        return r.rows[0]?.blocker_id as string | undefined;
      });
      if (blocked === userId) {
        return reply.code(403).send({ success: false, error: { code: 'BLOCKED', message: 'You have been blocked by this user' } });
      }
      if (blocked === myId) {
        return reply.code(403).send({ success: false, error: { code: 'YOU_BLOCKED', message: 'Unblock this user before sending a message' } });
      }

      const reqRow = await db.withSuperAdmin(async (client) => {
        const existing = await client.query(
          `SELECT requested_by, status FROM dm_requests WHERE tenant_id = $1 AND user_low = $2 AND user_high = $3`,
          [tenantId, userLow, userHigh],
        );
        if (existing.rows.length > 0) return existing.rows[0];
        const created = await client.query(
          `INSERT INTO dm_requests (tenant_id, user_low, user_high, requested_by, status)
           VALUES ($1, $2, $3, $4, 'pending') RETURNING requested_by, status`,
          [tenantId, userLow, userHigh, myId],
        );
        return created.rows[0];
      });

      // If the request is still pending and I'm not the original requester,
      // I can't send anything until I explicitly accept/decline it.
      if (reqRow.status === 'pending' && reqRow.requested_by !== myId) {
        return reply.code(403).send({
          success: false,
          error: { code: 'REQUEST_PENDING', message: 'Accept, delete, or block this message request before replying' },
        });
      }

      const [row] = await db.withSuperAdmin(async (client) => {
        const me = await client.query(`SELECT name, email FROM users WHERE id = $1`, [myId]);
        const senderName = me.rows[0]?.name || me.rows[0]?.email || 'Unknown';
        const res = await client.query(
          `INSERT INTO team_messages (tenant_id, sender_id, sender_name, recipient_id, content, message_type)
           VALUES ($1, $2, $3, $4, $5, 'dm') RETURNING *`,
          [tenantId, myId, senderName, userId, content.trim()],
        );
        return res.rows;
      });
      return reply.code(201).send({ success: true, data: row });
    });

    // Respond to an incoming message request: accept it, delete it (and the
    // messages sent so far), or block the sender (and delete the thread).
    fastify.post('/dm/:userId/respond', async (req, reply) => {
      const { userId } = req.params as { userId: string };
      const { action } = req.body as { action: 'accept' | 'delete' | 'block' };
      if (!['accept', 'delete', 'block'].includes(action)) {
        return reply.code(400).send({ success: false, error: { code: 'INVALID_ACTION', message: 'action must be accept, delete, or block' } });
      }

      const myId = req.user.sub;
      const tenantId = req.tenant.id;
      const [userLow, userHigh] = sortPair(myId, userId);

      await db.withSuperAdmin(async (client) => {
        const existing = await client.query(
          `SELECT requested_by, status FROM dm_requests WHERE tenant_id = $1 AND user_low = $2 AND user_high = $3`,
          [tenantId, userLow, userHigh],
        );
        const row = existing.rows[0];
        // Only the recipient of a pending request can act on it.
        if (!row || row.status !== 'pending' || row.requested_by === myId) {
          if (action !== 'block') return; // nothing pending to accept/delete
        }

        if (action === 'accept') {
          await client.query(
            `UPDATE dm_requests SET status = 'accepted', updated_at = NOW()
             WHERE tenant_id = $1 AND user_low = $2 AND user_high = $3`,
            [tenantId, userLow, userHigh],
          );
        } else if (action === 'delete') {
          await client.query(`DELETE FROM dm_requests WHERE tenant_id = $1 AND user_low = $2 AND user_high = $3`, [tenantId, userLow, userHigh]);
          await client.query(
            `DELETE FROM team_messages
             WHERE tenant_id = $1 AND message_type = 'dm'
               AND ((sender_id = $2 AND recipient_id = $3) OR (sender_id = $3 AND recipient_id = $2))`,
            [tenantId, myId, userId],
          );
        } else if (action === 'block') {
          await client.query(
            `INSERT INTO dm_blocks (tenant_id, blocker_id, blocked_id) VALUES ($1, $2, $3)
             ON CONFLICT (tenant_id, blocker_id, blocked_id) DO NOTHING`,
            [tenantId, myId, userId],
          );
          await client.query(`DELETE FROM dm_requests WHERE tenant_id = $1 AND user_low = $2 AND user_high = $3`, [tenantId, userLow, userHigh]);
          await client.query(
            `DELETE FROM team_messages
             WHERE tenant_id = $1 AND message_type = 'dm'
               AND ((sender_id = $2 AND recipient_id = $3) OR (sender_id = $3 AND recipient_id = $2))`,
            [tenantId, myId, userId],
          );
        }
      });

      return reply.send({ success: true });
    });

    // Unblock a user I previously blocked
    fastify.post('/dm/:userId/unblock', async (req, reply) => {
      const { userId } = req.params as { userId: string };
      const myId = req.user.sub;

      await db.withSuperAdmin(async (client) => {
        await client.query(
          `DELETE FROM dm_blocks WHERE tenant_id = $1 AND blocker_id = $2 AND blocked_id = $3`,
          [req.tenant.id, myId, userId],
        );
      });

      return reply.send({ success: true });
    });
  };
}
