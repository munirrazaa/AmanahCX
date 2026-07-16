import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DatabaseClient } from '@crm/core';
import { requireScope, requireEntitlement, requirePermission } from '../../middlewares/auth.middleware';

const LineItemSchema = z.object({
  description: z.string(),
  quantity: z.number().positive(),
  unitPrice: z.number().min(0),
  taxRate: z.number().min(0).max(100).default(0),
  taxAmount: z.number().min(0).default(0),
  total: z.number().min(0),
  sortOrder: z.number().int().default(0),
});

const CreateQuotationSchema = z.object({
  billingContactId: z.string().uuid().optional(),
  issueDate: z.string(),
  validUntil: z.string().optional(),
  currency: z.string().default('USD'),
  poReference: z.string().optional(),
  templateId: z.string().default('tpl-classic'),
  lineItems: z.array(LineItemSchema).min(1),
  subtotal: z.number().min(0),
  totalTax: z.number().min(0),
  total: z.number().min(0),
  notes: z.string().optional(),
  terms: z.string().optional(),
  status: z.enum(['draft', 'sent']).default('draft'),
});

const UpdateQuotationSchema = z.object({
  status: z.enum(['draft','sent','accepted','rejected','expired']).optional(),
  validUntil: z.string().optional(),
  notes: z.string().optional(),
  terms: z.string().optional(),
});

const ListQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(25),
  status: z.string().optional(),
  contactId: z.string().optional(),
  search: z.string().optional(),
});

function rowToQuotation(row: Record<string, any>) {
  return {
    id: row.id,
    number: row.quotation_number,
    status: row.status,
    billingContactId: row.billing_contact_id,
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    contactCompany: row.contact_company,
    issueDate: row.issue_date,
    validUntil: row.valid_until,
    poReference: row.po_reference,
    currency: row.currency,
    templateId: row.template_id,
    subtotal: Number(row.subtotal),
    totalTax: Number(row.tax),
    total: Number(row.total),
    notes: row.notes,
    terms: row.terms,
    convertedToInvoiceId: row.converted_to_invoice_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lineItems: Array.isArray(row.lineItems) ? row.lineItems : [],
  };
}

export function quotationRoutes(db: DatabaseClient) {
  return async function (fastify: FastifyInstance) {
    fastify.addHook('preHandler', requireEntitlement('sales.invoices'));

    // LIST
    fastify.get('/', { preHandler: [requireScope('contacts:read'), requirePermission('invoices:read')] }, async (req, reply) => {
      const q = ListQuerySchema.parse(req.query);
      const tenantId = req.tenant.id;
      const offset = (q.page - 1) * q.pageSize;
      const conditions: string[] = ['qt.tenant_id = $1'];
      const vals: unknown[] = [tenantId];

      if (q.status)    { conditions.push(`qt.status = $${vals.length + 1}`); vals.push(q.status); }
      if (q.contactId) { conditions.push(`qt.billing_contact_id = $${vals.length + 1}`); vals.push(q.contactId); }
      if (q.search)    { conditions.push(`(qt.quotation_number ILIKE $${vals.length + 1} OR bc.name ILIKE $${vals.length + 1})`); vals.push(`%${q.search}%`); }

      const where = conditions.join(' AND ');
      const { rows } = await db.withTenant(tenantId, (client) =>
        client.query(
          `SELECT qt.*, bc.name as contact_name, bc.email as contact_email, bc.company as contact_company
           FROM quotations qt
           LEFT JOIN billing_contacts bc ON bc.id = qt.billing_contact_id
           WHERE ${where} ORDER BY qt.created_at DESC
           LIMIT $${vals.length + 1} OFFSET $${vals.length + 2}`,
          [...vals, q.pageSize, offset]
        )
      );
      const { rows: [{ count }] } = await db.withTenant(tenantId, (client) =>
        client.query(`SELECT COUNT(*) FROM quotations qt LEFT JOIN billing_contacts bc ON bc.id = qt.billing_contact_id WHERE ${where}`, vals)
      );
      return reply.send({ success: true, data: rows.map(rowToQuotation), total: Number(count), page: q.page, pageSize: q.pageSize });
    });

    // GET single
    fastify.get('/:id', { preHandler: [requireScope('contacts:read'), requirePermission('invoices:read')] }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const tenantId = req.tenant.id;
      const [qt] = await db.withTenant(tenantId, (client) =>
        client.query(
          `SELECT qt.*, bc.name as contact_name, bc.email as contact_email, bc.company as contact_company
           FROM quotations qt LEFT JOIN billing_contacts bc ON bc.id = qt.billing_contact_id
           WHERE qt.tenant_id=$1 AND qt.id=$2`,
          [tenantId, id]
        ).then(r => r.rows)
      );
      if (!qt) return reply.status(404).send({ success: false, error: 'Not found' });
      const lineItems = await db.withTenant(tenantId, (client) =>
        client.query(`SELECT * FROM quotation_line_items WHERE quotation_id=$1 ORDER BY sort_order`, [id]).then(r => r.rows)
      );
      return reply.send({ success: true, data: rowToQuotation({ ...qt, lineItems }) });
    });

    // CREATE
    fastify.post('/', { preHandler: [requireScope('contacts:write'), requirePermission('invoices:create')] }, async (req, reply) => {
      const body = CreateQuotationSchema.parse(req.body);
      const tenantId = req.tenant.id;

      const [settings] = await db.withTenant(tenantId, async (client) => {
        const result = await client.query(`SELECT * FROM sales_settings WHERE tenant_id=$1`, [tenantId]);
        return result.rows;
      });
      const prefix = (settings?.invoice_prefix ?? 'INV-').replace('INV-', 'QT-');
      const nextNum = settings?.next_invoice_number ?? 1;
      const quotationNumber = `${prefix}${String(nextNum).padStart(4, '0')}`;

      const [qt] = await db.withTenant(tenantId, async (client) => {
        const insertResult = await client.query(
          `INSERT INTO quotations (tenant_id, quotation_number, status, billing_contact_id, issue_date,
            valid_until, currency, po_reference, template_id, subtotal, tax, total, notes, terms)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
          [tenantId, quotationNumber, body.status,
           body.billingContactId ?? null,
           body.issueDate,
           body.validUntil ?? null,
           body.currency, body.poReference ?? null, body.templateId,
           body.subtotal, body.totalTax, body.total,
           body.notes ?? null, body.terms ?? null]
        );
        const row = insertResult.rows[0];
        for (let i = 0; i < body.lineItems.length; i++) {
          const li = body.lineItems[i];
          await client.query(
            `INSERT INTO quotation_line_items (quotation_id, description, quantity, unit_price, tax_rate, tax_amount, total, sort_order)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [row.id, li.description, li.quantity, li.unitPrice, li.taxRate, li.taxAmount, li.total, i]
          );
        }
        return [row];
      });

      return reply.status(201).send({ success: true, data: rowToQuotation({ ...qt, lineItems: [] }) });
    });

    // UPDATE
    fastify.patch('/:id', { preHandler: [requireScope('contacts:write'), requirePermission('invoices:edit')] }, async (req, reply) => {
      const body = UpdateQuotationSchema.parse(req.body);
      const { id } = req.params as { id: string };
      const tenantId = req.tenant.id;
      const sets: string[] = ['updated_at = NOW()'];
      const vals: unknown[] = [tenantId, id];
      if (body.status !== undefined)     { sets.push(`status = $${vals.length + 1}`);      vals.push(body.status); }
      if (body.validUntil !== undefined) { sets.push(`valid_until = $${vals.length + 1}`); vals.push(body.validUntil); }
      if (body.notes !== undefined)      { sets.push(`notes = $${vals.length + 1}`);        vals.push(body.notes); }
      if (body.terms !== undefined)      { sets.push(`terms = $${vals.length + 1}`);        vals.push(body.terms); }
      const [row] = await db.withTenant(tenantId, async (client) => {
        const result = await client.query(`UPDATE quotations SET ${sets.join(',')} WHERE tenant_id=$1 AND id=$2 RETURNING *`, vals);
        return result.rows;
      });
      return reply.send({ success: true, data: row });
    });

    // DELETE
    fastify.delete('/:id', { preHandler: [requireScope('contacts:write'), requirePermission('invoices:delete')] }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const tenantId = req.tenant.id;
      await db.withTenant(tenantId, (client) =>
        client.query(`DELETE FROM quotations WHERE tenant_id=$1 AND id=$2 AND converted_to_invoice_id IS NULL`, [tenantId, id])
      );
      return reply.send({ success: true });
    });

    // CONVERT TO INVOICE
    fastify.post('/:id/convert', { preHandler: [requireScope('contacts:write'), requirePermission('invoices:create')] }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const tenantId = req.tenant.id;

      const [qt] = await db.withTenant(tenantId, (client) =>
        client.query(`SELECT * FROM quotations WHERE tenant_id=$1 AND id=$2`, [tenantId, id]).then(r => r.rows)
      );
      if (!qt) return reply.status(404).send({ success: false, error: 'Quotation not found' });
      if (qt.converted_to_invoice_id) return reply.status(400).send({ success: false, error: 'Already converted to invoice' });

      const lineItems = await db.withTenant(tenantId, (client) =>
        client.query(`SELECT * FROM quotation_line_items WHERE quotation_id=$1 ORDER BY sort_order`, [id]).then(r => r.rows)
      );

      const [settings] = await db.withTenant(tenantId, async (client) => {
        const result = await client.query(`SELECT * FROM sales_settings WHERE tenant_id=$1`, [tenantId]);
        return result.rows;
      });
      const prefix = settings?.invoice_prefix ?? 'INV-';
      const nextNum = settings?.next_invoice_number ?? 1;
      const invoiceNumber = `${prefix}${String(nextNum).padStart(4, '0')}`;

      const dueDate = new Date(qt.issue_date);
      dueDate.setDate(dueDate.getDate() + (settings?.default_payment_terms ?? 30));
      const dueDateStr = dueDate.toISOString().split('T')[0];

      const [inv] = await db.withTenant(tenantId, async (client) => {
        const insertResult = await client.query(
          `INSERT INTO sales_invoices (tenant_id, number, status, billing_contact_id, issue_date, due_date,
            currency, po_reference, template_id, subtotal, total_tax, total, notes, terms)
           VALUES ($1,$2,'draft',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
          [tenantId, invoiceNumber, qt.billing_contact_id, qt.issue_date,
           dueDateStr, qt.currency, qt.po_reference, qt.template_id,
           qt.subtotal, qt.tax, qt.total, qt.notes, qt.terms]
        );
        const inv = insertResult.rows[0];
        for (let i = 0; i < lineItems.length; i++) {
          const li = lineItems[i];
          await client.query(
            `INSERT INTO invoice_line_items (invoice_id, description, quantity, unit_price, tax_rate, tax_amount, total, sort_order)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [inv.id, li.description, li.quantity, li.unit_price, li.tax_rate, li.tax_amount, li.total, i]
          );
        }
        // Mark quotation as accepted + link invoice
        await client.query(
          `UPDATE quotations SET status='accepted', converted_to_invoice_id=$1, updated_at=NOW() WHERE id=$2`,
          [inv.id, id]
        );
        return [inv];
      });

      // Increment invoice counter
      await db.withTenant(tenantId, (client) =>
        client.query(
          `INSERT INTO sales_settings (tenant_id, next_invoice_number) VALUES ($1, 2)
           ON CONFLICT (tenant_id) DO UPDATE SET next_invoice_number = sales_settings.next_invoice_number + 1`,
          [tenantId]
        )
      );

      return reply.status(201).send({ success: true, data: { invoiceId: inv.id, invoiceNumber: inv.invoice_number } });
    });
  };
}
