/**
 * GET /api/v1/recordings/insights
 *
 * Full call-centre analytics + CX Insights dashboard data.
 * Covers: KPI summary, call volume by day, hourly distribution,
 * duration buckets, inbound/outbound split, top agents, topic heatmap.
 *
 * Access: operations_admin, policy_admin, manager (team-scoped), agent (own)
 */

import type { FastifyInstance } from 'fastify';
import type { DatabaseClient } from '@crm/core';
import { requireRole } from '../middlewares/auth.middleware';
import { getVisibleUserIds } from '../lib/visibility';

const ALLOWED = ['operations_admin', 'policy_admin', 'manager', 'agent'] as const;

export function recordingInsightsRoutes(db: DatabaseClient) {
  return async function (fastify: FastifyInstance) {

    fastify.get('/insights', {
      preHandler: requireRole(...ALLOWED),
    }, async (req, reply) => {
      const role     = req.user.role;
      const userId   = req.user.sub;
      const tenantId = req.tenant.id;

      const q = req.query as {
        dateFrom?: string; dateTo?: string;
        callType?: string; // 'all' | 'bot' | 'human'
      };

      const dateTo   = q.dateTo   ? new Date(q.dateTo)   : new Date();
      const dateFrom = q.dateFrom ? new Date(q.dateFrom) : new Date(Date.now() - 14 * 86400_000);
      const callType = q.callType === 'bot' ? 'bot' : q.callType === 'human' ? 'human' : 'all';

      // Scope
      let scopeIds: string[] | null = null;
      if (role === 'agent') scopeIds = [userId];
      else if (role === 'manager') {
        scopeIds = await db.withTenant(tenantId, (c) => getVisibleUserIds(c, userId, role));
      }

      const humanAgentFilter = scopeIds !== null
        ? `AND h.agent_id = ANY(ARRAY['${scopeIds.join("','")}']::uuid[])` : '';

      const p: unknown[] = [tenantId, dateFrom.toISOString(), dateTo.toISOString()];

      /* ── Unified CTE for both tables ──────────────────────────────────── */
      const botCte = callType !== 'human' ? `
        SELECT
          id, 'bot'::text AS call_type,
          duration_seconds AS duration_s,
          direction, tags,
          EXTRACT(HOUR FROM created_at AT TIME ZONE 'UTC') AS hour_of_day,
          to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
          NULL::uuid AS agent_id, NULL::text AS agent_name,
          recording_url IS NOT NULL AS has_recording
        FROM voice_bot_calls
        WHERE tenant_id = $1
          AND created_at >= $2
          AND created_at <= $3
      ` : null;

      const humanCte = callType !== 'bot' ? `
        SELECT
          h.id, 'human'::text AS call_type,
          h.duration_s,
          h.direction, h.tags,
          EXTRACT(HOUR FROM h.created_at AT TIME ZONE 'UTC') AS hour_of_day,
          to_char(h.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
          h.agent_id, u.name AS agent_name,
          h.recording_url IS NOT NULL AS has_recording
        FROM human_agent_calls h
        LEFT JOIN users u ON h.agent_id = u.id
        WHERE h.tenant_id = $1
          AND h.created_at >= $2
          AND h.created_at <= $3
          ${humanAgentFilter}
      ` : null;

      const parts = [botCte, humanCte].filter(Boolean);
      if (parts.length === 0) {
        return reply.send({ success: true, data: emptyResponse(dateFrom, dateTo) });
      }
      const unionCte = parts.join(' UNION ALL ');

      /* ── Run all aggregations in one query ────────────────────────────── */
      const sql = `
        WITH calls AS (${unionCte}),
        kpi AS (
          SELECT
            COUNT(*) AS total_calls,
            COUNT(*) FILTER (WHERE direction = 'inbound')  AS inbound,
            COUNT(*) FILTER (WHERE direction = 'outbound') AS outbound,
            COUNT(*) FILTER (WHERE call_type = 'bot')      AS bot_calls,
            COUNT(*) FILTER (WHERE call_type = 'human')    AS human_calls,
            COUNT(*) FILTER (WHERE has_recording)           AS with_recording,
            ROUND(AVG(duration_s))                         AS avg_duration_s,
            MAX(duration_s)                                AS max_duration_s,
            MIN(duration_s) FILTER (WHERE duration_s > 0)  AS min_duration_s,
            ROUND(AVG(duration_s) FILTER (WHERE call_type='human')) AS avg_human_s,
            ROUND(AVG(duration_s) FILTER (WHERE call_type='bot'))   AS avg_bot_s,
            COUNT(*) FILTER (WHERE array_length(tags,1) > 0) AS tagged_calls
          FROM calls
        ),
        by_day AS (
          SELECT day, COUNT(*) AS cnt,
                 COUNT(*) FILTER (WHERE call_type='bot')   AS bot_cnt,
                 COUNT(*) FILTER (WHERE call_type='human') AS human_cnt,
                 ROUND(AVG(duration_s)) AS avg_dur
          FROM calls GROUP BY day ORDER BY day
        ),
        by_hour AS (
          SELECT hour_of_day::int AS hour, COUNT(*) AS cnt
          FROM calls GROUP BY hour ORDER BY hour
        ),
        by_direction AS (
          SELECT direction, COUNT(*) AS cnt FROM calls GROUP BY direction
        ),
        by_duration AS (
          SELECT
            CASE
              WHEN duration_s < 60   THEN '< 1 min'
              WHEN duration_s < 180  THEN '1–3 min'
              WHEN duration_s < 300  THEN '3–5 min'
              WHEN duration_s < 600  THEN '5–10 min'
              ELSE '> 10 min'
            END AS bucket,
            COUNT(*) AS cnt
          FROM calls WHERE duration_s IS NOT NULL
          GROUP BY bucket
        ),
        top_agents AS (
          SELECT agent_name, COUNT(*) AS cnt,
                 ROUND(AVG(duration_s)) AS avg_dur
          FROM calls WHERE agent_name IS NOT NULL
          GROUP BY agent_name ORDER BY cnt DESC LIMIT 10
        ),
        topics AS (
          SELECT
            unnest(tags) AS topic,
            to_char(date_trunc('day', NOW() AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS _unused,
            COUNT(*) AS cnt
          FROM calls WHERE array_length(tags,1) > 0
          GROUP BY topic ORDER BY cnt DESC LIMIT 20
        ),
        topic_by_day AS (
          SELECT
            unnest(tags) AS topic,
            day,
            COUNT(*) AS cnt
          FROM calls WHERE array_length(tags,1) > 0
          GROUP BY unnest(tags), day
        )
        SELECT
          row_to_json(k) AS kpi,
          (SELECT json_agg(row_to_json(d)) FROM by_day d)       AS by_day,
          (SELECT json_agg(row_to_json(h)) FROM by_hour h)      AS by_hour,
          (SELECT json_agg(row_to_json(x)) FROM by_direction x) AS by_direction,
          (SELECT json_agg(row_to_json(b)) FROM by_duration b)  AS by_duration,
          (SELECT json_agg(row_to_json(a)) FROM top_agents a)   AS top_agents,
          (SELECT json_agg(row_to_json(t)) FROM topics t)       AS topics,
          (SELECT json_agg(row_to_json(td)) FROM topic_by_day td) AS topic_by_day
        FROM kpi k
      `;

      const [row] = await db.withTenant(tenantId, async (client) => {
        const r = await client.query(sql, p);
        return r.rows;
      });

      return reply.send({
        success: true,
        data: {
          date_from:    dateFrom.toISOString(),
          date_to:      dateTo.toISOString(),
          call_type:    callType,
          kpi:          row.kpi,
          by_day:       row.by_day       ?? [],
          by_hour:      row.by_hour      ?? [],
          by_direction: row.by_direction ?? [],
          by_duration:  row.by_duration  ?? [],
          top_agents:   row.top_agents   ?? [],
          topics:       row.topics       ?? [],
          topic_by_day: row.topic_by_day ?? [],
        },
      });
    });
  };
}

function emptyResponse(dateFrom: Date, dateTo: Date) {
  return {
    date_from: dateFrom.toISOString(), date_to: dateTo.toISOString(), call_type: 'all',
    kpi: { total_calls: 0, inbound: 0, outbound: 0, bot_calls: 0, human_calls: 0,
           with_recording: 0, avg_duration_s: 0, max_duration_s: 0, min_duration_s: 0,
           avg_human_s: 0, avg_bot_s: 0, tagged_calls: 0 },
    by_day: [], by_hour: [], by_direction: [], by_duration: [],
    top_agents: [], topics: [], topic_by_day: [],
  };
}
