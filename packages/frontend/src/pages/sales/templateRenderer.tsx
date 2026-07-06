import { formatCurrency, type Invoice } from './types';

export type ElementType =
  | 'logo' | 'company_info' | 'client_info' | 'invoice_details'
  | 'line_items' | 'totals' | 'payment_info' | 'notes' | 'terms'
  | 'signature' | 'custom_text' | 'divider' | 'spacer';

export interface ElementProps {
  alignment: 'left' | 'center' | 'right';
  fontSize: number;
  color: string;
  customText?: string;
}

export interface BuilderEl {
  id: string;
  type: ElementType;
  label: string;
  props: ElementProps;
}

export const DEFAULT_PROPS: ElementProps = { alignment: 'left', fontSize: 14, color: '#111827' };

export const PALETTE: { type: ElementType; label: string; icon: string }[] = [
  { type: 'logo',            label: 'Company Logo',     icon: '🖼️' },
  { type: 'company_info',    label: 'Company Info',     icon: '🏢' },
  { type: 'client_info',     label: 'Client Info',      icon: '👤' },
  { type: 'invoice_details', label: 'Invoice Details',  icon: '📋' },
  { type: 'line_items',      label: 'Line Items Table',  icon: '📊' },
  { type: 'totals',          label: 'Totals',           icon: '💰' },
  { type: 'payment_info',    label: 'Payment Info',     icon: '🏦' },
  { type: 'notes',           label: 'Notes',            icon: '📝' },
  { type: 'terms',           label: 'Terms & Conditions', icon: '📄' },
  { type: 'signature',       label: 'Signature',        icon: '✍️' },
  { type: 'custom_text',     label: 'Custom Text',      icon: 'T'  },
  { type: 'divider',         label: 'Divider',          icon: '—'  },
  { type: 'spacer',          label: 'Spacer',           icon: '⬜' },
];

export const DEFAULT_CANVAS: BuilderEl[] = PALETTE
  .filter(p => !['signature', 'custom_text', 'divider', 'spacer'].includes(p.type))
  .map(p => ({ id: p.type, type: p.type, label: p.label, props: { ...DEFAULT_PROPS, ...(p.type === 'totals' ? { alignment: 'right' as const } : {}), ...(p.type === 'line_items' ? { fontSize: 12 } : {}) } }));

function getAlignClass(a: 'left' | 'center' | 'right') {
  return a === 'center' ? 'text-center' : a === 'right' ? 'text-right' : 'text-left';
}

// Real invoice data to substitute into a rendered element. When omitted,
// placeholder sample values are shown (used by the Builder's own canvas).
export interface RenderData {
  companyName?: string; companyAddress?: string; companyEmail?: string; logoUrl?: string;
  clientName?: string; clientEmail?: string; clientCompany?: string; clientAddress?: string;
  invoiceNumber?: string; dueDate?: string;
  lineItems?: { description: string; quantity: number; unitPrice: number; total: number }[];
  subtotal?: number; totalTax?: number; total?: number; currency?: string;
  bankDetails?: string;
  notes?: string; terms?: string;
  accentColor?: string;
}

export function renderElement(el: BuilderEl, data?: RenderData): React.ReactNode {
  const align = getAlignClass(el.props.alignment);
  const style = { fontSize: el.props.fontSize, color: el.props.color };
  const currency = data?.currency ?? 'USD';
  const accent = data?.accentColor;

  switch (el.type) {
    case 'logo':
      return (
        <div className={align}>
          {data?.logoUrl ? (
            <img src={data.logoUrl} alt="Company logo" className="h-14 inline-block" />
          ) : (
            <div className="w-14 h-14 rounded flex items-center justify-center font-bold text-lg inline-flex"
              style={{ background: accent ? `${accent}22` : '#dbeafe', color: accent ?? '#2563eb' }}>LOGO</div>
          )}
        </div>
      );
    case 'company_info':
      return (
        <div className={align} style={style}>
          <div className="font-bold">{data?.companyName ?? 'My Company Inc'}</div>
          <div className="text-gray-500" style={{ fontSize: el.props.fontSize - 2 }}>
            {[data?.companyAddress, data?.companyEmail].filter(Boolean).join(' · ') || '123 Business Ave · billing@company.com'}
          </div>
        </div>
      );
    case 'client_info':
      return (
        <div className={align} style={style}>
          <div className="text-xs text-gray-400 uppercase font-semibold mb-1">Billed To</div>
          <div className="font-bold">{data?.clientName ?? 'Client Name'}</div>
          {data?.clientCompany && <div className="text-gray-500" style={{ fontSize: el.props.fontSize - 2 }}>{data.clientCompany}</div>}
          <div className="text-gray-500" style={{ fontSize: el.props.fontSize - 2 }}>{data?.clientEmail ?? 'client@example.com'}</div>
          {data?.clientAddress && <div className="text-gray-500" style={{ fontSize: el.props.fontSize - 2 }}>{data.clientAddress}</div>}
        </div>
      );
    case 'invoice_details':
      return (
        <div className={`flex gap-6 ${el.props.alignment === 'right' ? 'justify-end' : el.props.alignment === 'center' ? 'justify-center' : ''}`} style={style}>
          <div><div className="text-xs text-gray-400">Invoice #</div><div className="font-bold">{data?.invoiceNumber ?? 'INV-0001'}</div></div>
          <div><div className="text-xs text-gray-400">Due Date</div><div className="font-bold">{data?.dueDate ?? '30 Jun 2026'}</div></div>
        </div>
      );
    case 'line_items': {
      const items = data?.lineItems?.length ? data.lineItems : [{ description: 'Service item', quantity: 1, unitPrice: 500, total: 500 }];
      return (
        <div className="text-xs w-full" style={{ fontSize: el.props.fontSize - 2 }}>
          <div className="grid grid-cols-4 gap-2 rounded px-2 py-1 mb-1 text-white" style={{ background: accent ?? '#111827' }}>
            <span>Description</span><span className="text-center">Qty</span><span className="text-right">Price</span><span className="text-right">Total</span>
          </div>
          {items.map((li, i) => (
            <div key={i} className="grid grid-cols-4 gap-2 px-2 py-0.5 text-gray-700">
              <span>{li.description}</span><span className="text-center">{li.quantity}</span>
              <span className="text-right">{formatCurrency(li.unitPrice, currency)}</span>
              <span className="text-right">{formatCurrency(li.total, currency)}</span>
            </div>
          ))}
        </div>
      );
    }
    case 'totals':
      return (
        <div className={`${el.props.alignment === 'right' ? 'ml-auto' : el.props.alignment === 'center' ? 'mx-auto' : ''} w-48`} style={style}>
          <div className="flex justify-between text-gray-600"><span>Subtotal</span><span>{formatCurrency(data?.subtotal ?? 1000, currency)}</span></div>
          <div className="flex justify-between text-gray-600"><span>Tax</span><span>{formatCurrency(data?.totalTax ?? 80, currency)}</span></div>
          <div className="flex justify-between font-bold border-t pt-1 mt-1"><span>Total</span><span>{formatCurrency(data?.total ?? 1080, currency)}</span></div>
        </div>
      );
    case 'payment_info':
      return (
        <div className={align} style={style}>
          <div className="font-semibold mb-1">Bank Details</div>
          <div className="text-gray-700">{data?.bankDetails ?? 'Chase Bank — ACC ****4321'}</div>
        </div>
      );
    case 'notes':
      return <div className={`${align} italic text-gray-500`} style={style}>{data?.notes ?? 'Thank you for your business!'}</div>;
    case 'terms':
      return <div className={`${align} text-gray-400`} style={style}>{data?.terms ?? 'Payment due within 30 days.'}</div>;
    case 'signature':
      return (
        <div className={align}>
          <div className="inline-flex flex-col items-start gap-1">
            <div className="w-24 border-b-2 border-gray-400" />
            <div className="text-xs text-gray-400">Authorised Signature</div>
          </div>
        </div>
      );
    case 'custom_text':
      return <div className={align} style={style}>{el.props.customText || 'Your custom text here…'}</div>;
    case 'divider':
      return <div className="w-full border-t border-gray-300" style={{ borderColor: el.props.color }} />;
    case 'spacer':
      return <div className="w-full h-6 bg-gray-50 border border-dashed border-gray-200 rounded" />;
    default:
      return null;
  }
}

export function invoiceToRenderData(inv: Invoice, accentColor?: string): RenderData {
  return {
    clientName: inv.contactName,
    clientEmail: inv.contactEmail,
    clientCompany: inv.contactCompany,
    clientAddress: inv.contactBillingAddress
      ? `${inv.contactBillingAddress.line1}, ${inv.contactBillingAddress.city}, ${inv.contactBillingAddress.country}`
      : undefined,
    invoiceNumber: inv.number,
    dueDate: new Date(inv.dueDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
    lineItems: (inv.lineItems ?? []).map((li: any) => ({
      description: li.description, quantity: li.quantity,
      unitPrice: li.unit_price ?? li.unitPrice, total: li.total,
    })),
    subtotal: inv.subtotal, totalTax: inv.totalTax, total: inv.total,
    currency: inv.currency,
    notes: inv.notes, terms: inv.terms,
    accentColor,
  };
}
