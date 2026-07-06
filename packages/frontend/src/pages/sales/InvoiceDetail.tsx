import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../services/api';
import { formatCurrency, getStatusColor, DEFAULT_SETTINGS, INVOICE_TEMPLATES, type Invoice, type SalesSettings } from './types';
import { renderElement, invoiceToRenderData, type BuilderEl } from './templateRenderer';
import { Mail, Download, Plus, CheckCircle2, ChevronLeft, Loader2 } from 'lucide-react';

interface SavedTemplate { id: string; name: string; type: 'builder' | 'docx'; layout?: BuilderEl[]; }

export function InvoiceDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<Invoice>({
    queryKey: ['sales-invoice', id],
    queryFn: () => api.get(`/api/v1/sales/invoices/${id}`).then(r => r.data.data),
    enabled: !!id,
  });
  const { data: settings } = useQuery<SalesSettings>({
    queryKey: ['sales-settings'],
    queryFn: () => api.get('/api/v1/sales/settings').then(r => r.data.data ?? DEFAULT_SETTINGS),
  });
  const { data: savedTemplates } = useQuery<SavedTemplate[]>({
    queryKey: ['invoice-templates'],
    queryFn: () => api.get('/api/v1/sales/templates').then(r => r.data.data ?? []),
  });

  const [downloadingDocx, setDownloadingDocx] = useState(false);
  const [showPayForm, setShowPayForm] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [payDate, setPayDate] = useState(new Date().toISOString().split('T')[0]);
  const [payModeId, setPayModeId] = useState('');
  const [payBankId, setPayBankId] = useState('');
  const [payRef, setPayRef] = useState('');
  const [emailSent, setEmailSent] = useState(false);

  const s = settings ?? DEFAULT_SETTINGS;

  const patchMut = useMutation({
    mutationFn: (body: any) => api.patch(`/api/v1/sales/invoices/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sales-invoice', id] }),
  });

  const paymentMut = useMutation({
    mutationFn: (body: any) => api.post(`/api/v1/sales/invoices/${id}/payments`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sales-invoice', id] }); setShowPayForm(false); setPayAmount(''); setPayRef(''); },
  });

  const sendEmail = () => {
    setEmailSent(true);
    if (inv?.status === 'draft') patchMut.mutate({ status: 'sent' });
    setTimeout(() => setEmailSent(false), 3000);
  };

  const recordPayment = () => {
    const amount = Number(payAmount);
    if (!amount || amount <= 0) return;
    const mode = s.paymentModes.find(m => m.id === payModeId) ?? s.paymentModes[0];
    const bank = s.bankAccounts.find(b => b.id === payBankId);
    paymentMut.mutate({
      amount, paymentDate: payDate,
      modeName: mode?.name ?? 'Other',
      bankAccountName: bank ? `${bank.bankName} — ${bank.accountName}` : undefined,
      reference: payRef || undefined,
    });
  };

  if (isLoading) return <div className="flex items-center justify-center h-64 text-gray-400">Loading…</div>;
  const inv = data;
  if (!inv) return <div className="flex items-center justify-center h-64 text-gray-400">Invoice not found.</div>;

  const modeOpts = s.paymentModes.map(m => ({ value: m.id, label: m.name }));
  const bankOpts = s.bankAccounts.map(b => ({ value: b.id, label: `${b.bankName} — ${b.accountName}` }));

  // Resolve the template actually selected on this invoice: a preset theme
  // (accent color only), a saved Builder layout, or an uploaded DOCX file.
  const preset = INVOICE_TEMPLATES.find(t => t.id === inv.templateId);
  const savedTpl = savedTemplates?.find(t => t.id === inv.templateId);
  const accentColor = preset?.accentColor ?? '#2563eb';
  const renderData = invoiceToRenderData(inv, accentColor);

  const downloadDocx = async () => {
    if (!savedTpl) return;
    setDownloadingDocx(true);
    try {
      const bank = s.bankAccounts.find(b => b.isDefault);
      const res = await fetch(`/api/v1/sales/templates/${savedTpl.id}/render`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoice_number: inv.number,
          issue_date: new Date(inv.issueDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
          due_date: new Date(inv.dueDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
          currency: inv.currency,
          subtotal: formatCurrency(inv.subtotal, inv.currency),
          tax: formatCurrency(inv.totalTax, inv.currency),
          total: formatCurrency(inv.total, inv.currency),
          notes: inv.notes ?? '',
          terms: inv.terms ?? '',
          client_name: inv.contactName ?? '',
          client_email: inv.contactEmail ?? '',
          client_company: inv.contactCompany ?? '',
          client_address: inv.contactBillingAddress
            ? `${inv.contactBillingAddress.line1}, ${inv.contactBillingAddress.city}, ${inv.contactBillingAddress.country}` : '',
          company_name: s.companyName ?? '',
          company_email: s.companyEmail ?? '',
          company_address: s.companyAddress
            ? `${s.companyAddress.line1}, ${s.companyAddress.city}, ${s.companyAddress.country}` : '',
          po_reference: inv.poReference ?? '',
          line_items_table: (inv.lineItems ?? [])
            .map((li: any) => `${li.description}  x${li.quantity}  ${formatCurrency(li.total, inv.currency)}`)
            .join('\n'),
        }),
      });
      if (!res.ok) throw new Error('Render failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `invoice-${inv.number}.docx`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloadingDocx(false);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800">
          <ChevronLeft size={16} /> Back
        </button>
        <div className="flex gap-2">
          {inv.status === 'draft' && (
            <button onClick={() => patchMut.mutate({ status: 'sent' })}
              className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700">Mark Sent</button>
          )}
          <button onClick={sendEmail}
            className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700">
            <Mail size={14} /> {emailSent ? 'Sent!' : 'Email Invoice'}
          </button>
          {savedTpl?.type === 'docx' ? (
            <button onClick={downloadDocx} disabled={downloadingDocx}
              className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700 disabled:opacity-50">
              {downloadingDocx ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              {downloadingDocx ? 'Generating…' : `Download ${savedTpl.name} (.docx)`}
            </button>
          ) : (
            <button onClick={() => window.print()} className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700">
              <Download size={14} /> PDF
            </button>
          )}
          {inv.amountDue > 0 && (
            <button onClick={() => setShowPayForm(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">
              <Plus size={14} /> Record Payment
            </button>
          )}
        </div>
      </div>

      {/* Invoice Card — rendered per the template selected when this invoice was created */}
      {savedTpl?.type === 'docx' ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <div className="text-sm font-semibold text-gray-900 mb-1">This invoice uses the "{savedTpl.name}" Word template</div>
          <p className="text-sm text-gray-500 mb-4">Download the filled-in document to view or print it.</p>
          <button onClick={downloadDocx} disabled={downloadingDocx}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {downloadingDocx ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            {downloadingDocx ? 'Generating…' : 'Download .docx'}
          </button>
        </div>
      ) : savedTpl?.type === 'builder' && savedTpl.layout?.length ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 space-y-5">
          {savedTpl.layout.map(el => <div key={el.id}>{renderElement(el, renderData)}</div>)}
        </div>
      ) : (
        /* ── Preset template layouts ─────────────────────────────────── */
        inv.templateId === 'tpl-minimal' ? (
          /* MINIMAL — clean no-box, typographic layout */
          <div className="bg-white rounded-xl border border-gray-200 p-8 font-sans">
            <div className="border-b-2 pb-6 mb-6" style={{ borderColor: accentColor }}>
              <div className="flex justify-between items-end">
                <div>
                  <div className="text-3xl font-black tracking-tight text-gray-900">INVOICE</div>
                  <div className="text-lg font-light text-gray-400 mt-1">{inv.number}</div>
                </div>
                <div className="text-right text-sm space-y-0.5 text-gray-500">
                  <div>Issued: <span className="text-gray-900">{new Date(inv.issueDate).toLocaleDateString()}</span></div>
                  <div>Due: <span className="text-gray-900">{new Date(inv.dueDate).toLocaleDateString()}</span></div>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getStatusColor(inv.status)}`}>{inv.status}</span>
                </div>
              </div>
            </div>
            <div className="mb-8 text-sm">
              <div className="text-xs text-gray-400 uppercase tracking-widest mb-2">Bill To</div>
              <div className="font-semibold text-gray-900">{inv.contactName}</div>
              <div className="text-gray-500">{inv.contactCompany}</div>
              <div className="text-gray-500">{inv.contactEmail}</div>
            </div>
            <table className="w-full text-sm mb-8">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 text-xs text-gray-400 uppercase tracking-widest font-medium">Description</th>
                  <th className="text-center py-2 text-xs text-gray-400 uppercase tracking-widest font-medium">Qty</th>
                  <th className="text-right py-2 text-xs text-gray-400 uppercase tracking-widest font-medium">Price</th>
                  <th className="text-right py-2 text-xs text-gray-400 uppercase tracking-widest font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {(inv.lineItems ?? []).map((li: any) => (
                  <tr key={li.id} className="border-b border-gray-50">
                    <td className="py-3 text-gray-800">{li.description}</td>
                    <td className="py-3 text-center text-gray-500">{li.quantity}</td>
                    <td className="py-3 text-right text-gray-500">{formatCurrency(li.unit_price ?? li.unitPrice, inv.currency)}</td>
                    <td className="py-3 text-right font-medium text-gray-900">{formatCurrency(li.total, inv.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex justify-end">
              <div className="w-56 space-y-1 text-sm">
                <div className="flex justify-between text-gray-500"><span>Subtotal</span><span>{formatCurrency(inv.subtotal, inv.currency)}</span></div>
                <div className="flex justify-between text-gray-500"><span>Tax</span><span>{formatCurrency(inv.totalTax, inv.currency)}</span></div>
                <div className="flex justify-between font-bold text-gray-900 text-base pt-2" style={{ borderTop: `2px solid ${accentColor}` }}>
                  <span>Total</span><span>{formatCurrency(inv.total, inv.currency)}</span>
                </div>
                {inv.amountDue > 0 && <div className="flex justify-between text-red-600 font-semibold pt-1"><span>Balance Due</span><span>{formatCurrency(inv.amountDue, inv.currency)}</span></div>}
              </div>
            </div>
            {inv.notes && <div className="mt-6 pt-6 border-t border-gray-100 text-sm text-gray-500"><p>{inv.notes}</p></div>}
          </div>
        ) : inv.templateId === 'tpl-consulting' ? (
          /* CONSULTING — dark header band, formal two-column details */
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-8 py-6 text-white" style={{ background: accentColor }}>
              <div className="flex justify-between items-start">
                <div>
                  <div className="text-2xl font-bold tracking-wide">INVOICE</div>
                  <div className="text-white/70 text-sm mt-1">{inv.number}</div>
                </div>
                <div className="text-right text-sm text-white/80 space-y-0.5">
                  <div>Issue Date: <span className="text-white">{new Date(inv.issueDate).toLocaleDateString()}</span></div>
                  <div>Due Date: <span className="text-white">{new Date(inv.dueDate).toLocaleDateString()}</span></div>
                  {inv.poReference && <div>PO Ref: <span className="text-white">{inv.poReference}</span></div>}
                </div>
              </div>
            </div>
            <div className="p-8">
              <div className="flex gap-12 mb-8">
                <div>
                  <div className="text-xs text-gray-400 uppercase tracking-widest mb-2">Billed To</div>
                  <div className="font-semibold text-gray-900">{inv.contactName}</div>
                  <div className="text-sm text-gray-500">{inv.contactCompany}</div>
                  <div className="text-sm text-gray-500">{inv.contactEmail}</div>
                </div>
                <div className="ml-auto text-right">
                  <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(inv.status)}`}>{inv.status}</span>
                </div>
              </div>
              <table className="w-full text-sm mb-6 border border-gray-200 rounded-lg overflow-hidden">
                <thead>
                  <tr style={{ background: `${accentColor}15` }}>
                    <th className="text-left px-4 py-3 text-xs font-semibold" style={{ color: accentColor }}>Description</th>
                    <th className="text-center px-4 py-3 text-xs font-semibold" style={{ color: accentColor }}>Qty</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold" style={{ color: accentColor }}>Rate</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold" style={{ color: accentColor }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {(inv.lineItems ?? []).map((li: any, i: number) => (
                    <tr key={li.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="px-4 py-3 text-gray-800">{li.description}</td>
                      <td className="px-4 py-3 text-center text-gray-600">{li.quantity}</td>
                      <td className="px-4 py-3 text-right text-gray-600">{formatCurrency(li.unit_price ?? li.unitPrice, inv.currency)}</td>
                      <td className="px-4 py-3 text-right font-medium text-gray-900">{formatCurrency(li.total, inv.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex justify-end">
                <div className="w-64 space-y-2 text-sm border border-gray-200 rounded-lg p-4">
                  <div className="flex justify-between text-gray-600"><span>Subtotal</span><span>{formatCurrency(inv.subtotal, inv.currency)}</span></div>
                  <div className="flex justify-between text-gray-600"><span>Tax</span><span>{formatCurrency(inv.totalTax, inv.currency)}</span></div>
                  <div className="flex justify-between font-bold text-white text-sm rounded p-2" style={{ background: accentColor }}>
                    <span>Total</span><span>{formatCurrency(inv.total, inv.currency)}</span>
                  </div>
                  {inv.amountDue > 0 && <div className="flex justify-between text-red-600 font-semibold pt-1"><span>Balance Due</span><span>{formatCurrency(inv.amountDue, inv.currency)}</span></div>}
                </div>
              </div>
              {inv.notes && <div className="mt-6 text-sm text-gray-500 border-t border-gray-100 pt-4"><div className="font-semibold text-gray-700 mb-1">Notes</div><p>{inv.notes}</p></div>}
            </div>
          </div>
        ) : (
          /* DEFAULT (classic / retail / construction / medical / agency / logistics) — accent color logo box */
          <div className="bg-white rounded-xl border border-gray-200 p-8">
            {preset && (
              <div className="text-xs font-semibold uppercase tracking-wide mb-4" style={{ color: accentColor }}>{preset.sector}</div>
            )}
            <div className="flex justify-between items-start mb-8">
              <div>
                <div className="w-14 h-14 rounded-xl flex items-center justify-center text-white font-bold text-xl mb-3" style={{ background: accentColor }}>
                  {inv.contactName?.[0] ?? '?'}
                </div>
                <div className="text-xl font-bold text-gray-900">INVOICE</div>
                <div className="text-3xl font-black mt-1" style={{ color: accentColor }}>{inv.number}</div>
              </div>
              <div className="text-right space-y-1">
                <div className="text-sm text-gray-500">Issue: <span className="text-gray-900 font-medium">{new Date(inv.issueDate).toLocaleDateString()}</span></div>
                <div className="text-sm text-gray-500">Due: <span className="text-gray-900 font-medium">{new Date(inv.dueDate).toLocaleDateString()}</span></div>
                {inv.poReference && <div className="text-sm text-gray-500">PO: <span className="text-gray-900 font-medium">{inv.poReference}</span></div>}
                <div className="mt-2">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getStatusColor(inv.status)}`}>{inv.status}</span>
                </div>
              </div>
            </div>
            <div className="mb-8">
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Billed To</div>
              <div className="font-semibold text-gray-900">{inv.contactName}</div>
              <div className="text-sm text-gray-500">{inv.contactCompany}</div>
              <div className="text-sm text-gray-500">{inv.contactEmail}</div>
              {inv.contactBillingAddress && (
                <div className="text-sm text-gray-500">{inv.contactBillingAddress.line1}, {inv.contactBillingAddress.city}, {inv.contactBillingAddress.country}</div>
              )}
            </div>
            <table className="w-full text-sm mb-6">
              <thead>
                <tr className="text-white" style={{ background: accentColor }}>
                  <th className="text-left px-4 py-2.5 rounded-l-lg text-xs">Description</th>
                  <th className="text-center px-4 py-2.5 text-xs">Qty</th>
                  <th className="text-right px-4 py-2.5 text-xs">Unit Price</th>
                  <th className="text-right px-4 py-2.5 text-xs">Tax</th>
                  <th className="text-right px-4 py-2.5 rounded-r-lg text-xs">Total</th>
                </tr>
              </thead>
              <tbody>
                {(inv.lineItems ?? []).map((li: any) => (
                  <tr key={li.id} className="border-b border-gray-100">
                    <td className="px-4 py-3 text-gray-800">{li.description}</td>
                    <td className="px-4 py-3 text-center text-gray-600">{li.quantity}</td>
                    <td className="px-4 py-3 text-right text-gray-600">{formatCurrency(li.unit_price ?? li.unitPrice, inv.currency)}</td>
                    <td className="px-4 py-3 text-right text-gray-600">{formatCurrency(li.tax_amount ?? li.taxAmount, inv.currency)}</td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900">{formatCurrency(li.total, inv.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex justify-end">
              <div className="w-64 space-y-2 text-sm">
                <div className="flex justify-between text-gray-600"><span>Subtotal</span><span>{formatCurrency(inv.subtotal, inv.currency)}</span></div>
                <div className="flex justify-between text-gray-600"><span>Tax</span><span>{formatCurrency(inv.totalTax, inv.currency)}</span></div>
                <div className="flex justify-between font-bold text-gray-900 text-base border-t border-gray-200 pt-2">
                  <span>Total</span><span>{formatCurrency(inv.total, inv.currency)}</span>
                </div>
                {inv.amountPaid > 0 && <div className="flex justify-between text-green-600"><span>Paid</span><span>-{formatCurrency(inv.amountPaid, inv.currency)}</span></div>}
                {inv.amountDue > 0 && (
                  <div className="flex justify-between font-bold text-red-600 text-base border-t border-gray-200 pt-2">
                    <span>Balance Due</span><span>{formatCurrency(inv.amountDue, inv.currency)}</span>
                  </div>
                )}
              </div>
            </div>
            {inv.notes && <div className="mt-6 text-sm text-gray-500"><div className="font-semibold text-gray-700 mb-1">Notes</div><p>{inv.notes}</p></div>}
          </div>
        )
      )}

      {/* Payment History */}
      {(inv.payments ?? []).length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-5 py-4 border-b border-gray-100 text-sm font-semibold text-gray-900">Payment History</div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                {['Date','Mode','Reference','Amount'].map(h => (
                  <th key={h} className="text-left px-5 py-3 text-xs font-semibold text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(inv.payments ?? []).map((p: any) => (
                <tr key={p.id} className="border-b border-gray-50">
                  <td className="px-5 py-3 text-gray-700">{new Date(p.payment_date ?? p.paymentDate).toLocaleDateString()}</td>
                  <td className="px-5 py-3 text-gray-700">{p.mode_name ?? p.modeName}</td>
                  <td className="px-5 py-3 text-gray-400">{p.reference ?? '—'}</td>
                  <td className="px-5 py-3">
                    <span className="flex items-center gap-1 text-green-600 font-medium">
                      <CheckCircle2 size={13} /> {formatCurrency(p.amount, inv.currency)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Record Payment Form */}
      {showPayForm && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="text-sm font-semibold text-gray-900 mb-4">Record Payment</div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {[
              { label: `Amount (max ${formatCurrency(inv.amountDue, inv.currency)})`, el: <input type="number" max={inv.amountDue} value={payAmount} onChange={e => setPayAmount(e.target.value)} placeholder="0.00" className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" /> },
              { label: 'Payment Date', el: <input type="date" value={payDate} onChange={e => setPayDate(e.target.value)} className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" /> },
              { label: 'Payment Mode', el: <select value={payModeId} onChange={e => setPayModeId(e.target.value)} className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">{modeOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select> },
              ...(bankOpts.length > 0 ? [{ label: 'Bank Account', el: <select value={payBankId} onChange={e => setPayBankId(e.target.value)} className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">{bankOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select> }] : []),
              { label: 'Reference / TXN ID', el: <input value={payRef} onChange={e => setPayRef(e.target.value)} placeholder="Optional" className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" /> },
            ].map(({ label, el }) => (
              <div key={label} className="flex flex-col gap-1"><label className="text-xs font-medium text-gray-700">{label}</label>{el}</div>
            ))}
          </div>
          <div className="flex gap-3 mt-4 justify-end">
            <button onClick={() => setShowPayForm(false)} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700">Cancel</button>
            <button onClick={recordPayment} disabled={paymentMut.isPending}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50">
              Record Payment
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
