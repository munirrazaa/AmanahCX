import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../services/api';
import { formatCurrency, getStatusColor } from './types';
import { Plus, Search, Trash2, ArrowRight, CheckCircle2 } from 'lucide-react';

interface Quotation {
  id: string; number: string; status: string;
  contactName?: string; contactEmail?: string;
  issueDate: string; validUntil?: string;
  currency: string; total: number;
  convertedToInvoiceId?: string;
  createdAt: string;
}

const STATUS_COLORS: Record<string, string> = {
  draft:    'bg-gray-100 text-gray-700',
  sent:     'bg-blue-100 text-blue-700',
  accepted: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  expired:  'bg-amber-100 text-amber-700',
};

export function QuotationList() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const { data, isLoading } = useQuery<{ data: Quotation[]; total: number }>({
    queryKey: ['quotations', search, statusFilter],
    queryFn: () => api.get('/api/v1/sales/quotations', {
      params: { search: search || undefined, status: statusFilter || undefined, pageSize: 50 },
    }).then(r => r.data),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/sales/quotations/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['quotations'] }),
  });

  const convertMut = useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/sales/quotations/${id}/convert`),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['quotations'] });
      qc.invalidateQueries({ queryKey: ['sales-dashboard'] });
      navigate(`/sales/invoices/${res.data.data.invoiceId}`);
    },
  });

  const quotations = data?.data ?? [];

  return (
    <div className="p-6 space-y-5">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Quotations</h1>
          <p className="text-sm text-gray-500 mt-0.5">Pre-invoice estimates. Convert to invoice when accepted.</p>
        </div>
        <Link to="/sales/quotations/new"
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">
          <Plus size={14} /> New Quotation
        </Link>
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search quotations…"
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">All statuses</option>
          {['draft','sent','accepted','rejected','expired'].map(s => (
            <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                {['Quotation #','Client','Issue Date','Valid Until','Amount','Status',''].map(h => (
                  <th key={h} className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={7} className="px-5 py-10 text-center text-gray-400 text-sm">Loading…</td></tr>
              )}
              {!isLoading && quotations.map((qt) => (
                <tr key={qt.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-5 py-3">
                    <Link to={`/sales/quotations/${qt.id}`} className="font-medium text-blue-600 hover:underline">{qt.number}</Link>
                  </td>
                  <td className="px-5 py-3 text-gray-700">{qt.contactName ?? <span className="text-gray-400 italic">No contact</span>}</td>
                  <td className="px-5 py-3 text-gray-500">{new Date(qt.issueDate).toLocaleDateString()}</td>
                  <td className="px-5 py-3 text-gray-500">{qt.validUntil ? new Date(qt.validUntil).toLocaleDateString() : '—'}</td>
                  <td className="px-5 py-3 font-medium text-gray-900">{formatCurrency(qt.total, qt.currency)}</td>
                  <td className="px-5 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[qt.status] ?? 'bg-gray-100 text-gray-700'}`}>
                      {qt.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 justify-end">
                      {!qt.convertedToInvoiceId && qt.status !== 'rejected' && (
                        <button
                          onClick={() => convertMut.mutate(qt.id)}
                          disabled={convertMut.isPending}
                          title="Convert to Invoice"
                          className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-green-50 text-green-700 border border-green-200 rounded-lg hover:bg-green-100 transition-colors disabled:opacity-50">
                          <CheckCircle2 size={12} /> Convert to Invoice
                        </button>
                      )}
                      {qt.convertedToInvoiceId && (
                        <Link to={`/sales/invoices/${qt.convertedToInvoiceId}`}
                          className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100">
                          <ArrowRight size={12} /> View Invoice
                        </Link>
                      )}
                      {!qt.convertedToInvoiceId && (
                        <button onClick={() => deleteMut.mutate(qt.id)} title="Delete"
                          className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!isLoading && quotations.length === 0 && (
                <tr><td colSpan={7} className="px-5 py-10 text-center text-gray-400 text-sm">
                  No quotations yet. <Link to="/sales/quotations/new" className="text-blue-600">Create your first quotation</Link>
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
