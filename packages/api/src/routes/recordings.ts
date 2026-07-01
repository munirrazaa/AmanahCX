/**
 * GET /api/v1/recordings       — unified list of voice_bot + human agent recordings
 * GET /api/v1/recordings/:id   — single recording detail
 * POST /api/v1/recordings/:id/legal-hold — policy_admin: place / lift legal hold
 *
 * Access:
 *   operations_admin (35) — all recordings, read-only
 *   policy_admin (32)     — all recordings, read-only + legal hold
 *   manager (30)          — own team's recordings only
 *   agent (20)            — own recordings only
 *   tenant_admin / viewer — no access
 */

import type { FastifyInstance } from 'fastify';
import type { DatabaseClient } from '@crm/core';
import { requireRole } from '../middlewares/auth.middleware';
import { getVisibleUserIds } from '../lib/visibility';

const ALLOWED_ROLES = ['operations_admin', 'policy_admin', 'manager', 'agent'] as const;

export function recordingsRoutes(db: DatabaseClient) {
  return async function (fastify: FastifyInstance) {

    // ── GET /recordings — unified list ───────────────────────────────────────
    fastify.get('/', {
      preHandler: requireRole(...ALLOWED_ROLES),
    }, async (req, reply) => {
      const role     = req.user.role;
      const userId   = req.user.sub;
      const tenantId = req.tenant.id;

      const query = req.query as {
        page?: string; pageSize?: string;
        type?: string; agentId?: string; queueId?: string;
        tag?: string; dateFrom?: string; dateTo?: string;
        ticketId?: string;
      };

      const page     = Math.max(1, parseInt(query.page ?? '1'));
      const pageSize = Math.min(100, Math.max(1, parseInt(query.pageSize ?? '25')));
      const offset   = (page - 1) * pageSize;

      // Determine which agent IDs this user may see
      // null = no filter (see all)
      let scopeIds: string[] | null = null;
      if (role === 'agent') {
        scopeIds = [userId];
      } else if (role === 'manager') {
        scopeIds = await db.withTenant(tenantId, (c) =>
          getVisibleUserIds(c, userId, role),
        );
      }
      // operations_admin, policy_admin → scopeIds stays null (see all)

      // Build parameterised filter fragments.
      // Bot calls have no agent_id column, so scope / agentId filters only apply to human side.
      const baseParams: unknown[] = scopeIds !== null ? [...scopeIds] : [];
      let p = baseParams.length;

      const humanAgentFilter = scopeIds !== null
        ? `AND h.agent_id = ANY(ARRAY[${scopeIds.map((_, i) => `$${i + 1}`).join(',')}]::uuid[])`
        : '';

      const addFilter = (col: string, val: string | undefined) => {
        if (!val) return '';
        baseParams.push(val);
        return `AND ${col} = $${++p}`;
      };
      const addDateFilter = (col: string, val: string | undefined, op: '>='|'<=') => {
        if (!val) return '';
        baseParams.push(val);
        return `AND ${col} ${op} $${++p}`;
      };
      const addTagFilter = (val: string | undefined, alias = '') => {
        if (!val) return '';
        baseParams.push(val);
        return `AND ${alias}tags @> ARRAY[$${++p}]`;
      };

      // Shared filters (columns that exist on both tables)
      const ticketF   = addFilter('ticket_id', query.ticketId);
      const tagBotF   = addTagFilter(query.tag);
      const dateFromF = addDateFilter('created_at', query.dateFrom, '>=');
      const dateToF   = addDateFilter('created_at', query.dateTo, '<=');

      // Human-only additional filters (agent_id, queue_id, tag re-evaluated from same params)
      const agentIdF  = addFilter('h.agent_id', query.agentId);
      const queueF    = addFilter('h.queue_id', query.queueId);

      // Shared filters for bot side (no h. prefix)
      const botCommon = `${ticketF} ${tagBotF} ${dateFromF} ${dateToF}`;
      const humanCommon = `${humanAgentFilter} ${agentIdF} ${queueF} ${ticketF} ${tagBotF} ${dateFromF} ${dateToF}`;

      // Build UNION of voice_bot_calls and human_agent_calls
      // type filter: 'bot' | 'human' | undefined (both)
      const includeBot   = !query.type || query.type === 'bot';
      const includeHuman = !query.type || query.type === 'human';

      // If agent or agentId filter active — bot calls have no agent, exclude them
      const botExcluded = includeBot && (scopeIds !== null || query.agentId);
      const effectiveBot = includeBot && !botExcluded;

      const botSelect = effectiveBot ? `
        SELECT
          id, 'bot' AS call_type,
          NULL::uuid AS agent_id, NULL AS agent_name,
          recording_url, transcript, duration_seconds AS duration_s,
          direction, tags, legal_hold, legal_hold_at,
          ticket_id, contact_id, NULL::uuid AS queue_id,
          started_at, created_at,
          from_number AS caller_number, provider AS source
        FROM voice_bot_calls
        WHERE tenant_id = '${tenantId}' ${botCommon}
      ` : null;

      const humanSelect = includeHuman ? `
        SELECT
          h.id, 'human' AS call_type,
          h.agent_id, u.name AS agent_name,
          h.recording_url, h.transcript, h.duration_s,
          h.direction, h.tags, h.legal_hold, h.legal_hold_at,
          h.ticket_id, NULL::uuid AS contact_id, h.queue_id,
          h.started_at, h.created_at,
          NULL AS caller_number, h.channel AS source
        FROM human_agent_calls h
        LEFT JOIN users u ON h.agent_id = u.id
        WHERE h.tenant_id = '${tenantId}' ${humanCommon}
      ` : null;

      const parts = [botSelect, humanSelect].filter(Boolean);
      if (parts.length === 0) {
        return reply.send({ success: true, data: [], meta: { total: 0, page, pageSize, totalPages: 0 } });
      }

      baseParams.push(pageSize, offset);
      const limitOffset = `LIMIT $${++p} OFFSET $${++p}`;

      const unionQuery = `
        SELECT * FROM (${parts.join(' UNION ALL ')}) combined
        ORDER BY created_at DESC
        ${limitOffset}
      `;

      const countQuery = `
        SELECT COUNT(*) FROM (${parts.join(' UNION ALL ')}) combined
      `;

      const [rows, countRows] = await db.withTenant(tenantId, async (client) => {
        const [r, c] = await Promise.all([
          client.query(unionQuery, baseParams),
          client.query(countQuery, baseParams.slice(0, baseParams.length - 2)),
        ]);
        return [r.rows, c.rows];
      });

      const total = parseInt(countRows[0]?.count ?? '0');

      return reply.send({
        success: true,
        data: rows,
        meta: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
      });
    });

    // ── GET /recordings/:id ────────────────────────────────────────────────
    fastify.get('/:id', {
      preHandler: requireRole(...ALLOWED_ROLES),
    }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const role     = req.user.role;
      const userId   = req.user.sub;
      const tenantId = req.tenant.id;

      const [recording] = await db.withTenant(tenantId, async (client) => {
        const r = await client.query(`
          SELECT h.*, u.name AS agent_name, 'human' AS call_type
          FROM human_agent_calls h
          LEFT JOIN users u ON h.agent_id = u.id
          WHERE h.id = $1
          UNION ALL
          SELECT
            id, tenant_id, ticket_id, NULL::uuid, NULL::uuid,
            recording_url, transcript, duration_seconds,
            direction, 'phone', tags, legal_hold, legal_hold_by, legal_hold_at,
            started_at, ended_at, created_at,
            NULL, NULL, NULL, 'bot'
          FROM voice_bot_calls
          WHERE id = $1
          LIMIT 1
        `, [id]);
        return r.rows;
      });

      if (!recording) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Recording not found' } });

      // Access check: agent can only see own recordings
      if (role === 'agent' && recording.agent_id !== userId) {
        return reply.code(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'You can only access your own recordings' } });
      }

      // Manager: check agent is in visible hierarchy
      if (role === 'manager' && recording.agent_id) {
        const scopeIds = await db.withTenant(tenantId, (c) =>
          getVisibleUserIds(c, userId, role),
        );
        if (scopeIds && !scopeIds.includes(recording.agent_id)) {
          return reply.code(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'This recording is outside your team scope' } });
        }
      }

      return reply.send({ success: true, data: recording });
    });

    // ── POST /recordings/:id/legal-hold — policy_admin only ───────────────
    fastify.post('/:id/legal-hold', {
      preHandler: requireRole('policy_admin'),
    }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const { hold } = req.body as { hold: boolean };
      const tenantId = req.tenant.id;
      const userId   = req.user.sub;

      // Try human_agent_calls first, then voice_bot_calls
      const updated = await db.withTenant(tenantId, async (client) => {
        const h = await client.query(
          `UPDATE human_agent_calls
           SET legal_hold = $1, legal_hold_by = $2, legal_hold_at = $3
           WHERE id = $4 RETURNING id`,
          [hold, hold ? userId : null, hold ? new Date() : null, id],
        );
        if (h.rows.length > 0) return h.rows[0];

        const v = await client.query(
          `UPDATE voice_bot_calls
           SET legal_hold = $1, legal_hold_by = $2, legal_hold_at = $3
           WHERE id = $4 RETURNING id`,
          [hold, hold ? userId : null, hold ? new Date() : null, id],
        );
        return v.rows[0] ?? null;
      });

      if (!updated) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Recording not found' } });

      return reply.send({ success: true, data: { id, legal_hold: hold } });
    });
  };
}
