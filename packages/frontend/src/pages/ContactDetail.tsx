import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, User, Building2, Mail, Phone, Tag,
  TrendingUp, CheckSquare, LifeBuoy,
  Edit2, Save, X, Loader2,
  Clock, Calendar, PhoneCall, CreditCard, ExternalLink, Plus, Star, Trash2, ShieldAlert,
} from 'lucide-react';
import { api } from '../services/api';
import { formatCurrency } from '../utils/format';
import { useIsAdmin } from '../hooks/useRole';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Contact {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  mobile: string;
  nic_number: string;
  job_title: string;
  status: string;
  source: string;
  tags: string[];
  company_id: string;
  company_name: string;
  owner_name: string;
  created_at: string;
  updated_at: string;
  custom_fields: Record<string, string>;
}

interface Deal {
  id: string;
  name: string;
  amount: number;
  currency: string;
  status: string;
  stage_name: string;
  close_date: string;
}

interface TimelineItem {
  id: string;
  type: string;
  subtype: string;
  subject: string;
  created_at: string;
  owner_id: string;
  metadata: any;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  lead:       'bg-blue-100 text-blue-700',
  prospect:   'bg-violet-100 text-violet-700',
  customer:   'bg-emerald-100 text-emerald-700',
  churned:    'bg-red-100 text-red-700',
  partner:    'bg-amber-100 text-amber-700',
};

const DEAL_STATUS_COLORS: Record<string, string> = {
  open: 'text-blue-600',
  won:  'text-emerald-600',
  lost: 'text-red-500',
};

function fmtDate(iso: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtRelative(iso: string) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)   return 'just now';
  if (mins < 60)  return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs  < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const TIMELINE_ICONS: Record<string, { icon: React.ElementType; bg: string; text: string }> = {
  activity:    { icon: CheckSquare, bg: 'bg-brand-100',   text: 'text-brand-600'   },
  voice_call:  { icon: PhoneCall,   bg: 'bg-emerald-100', text: 'text-emerald-600' },
  email:       { icon: Mail,        bg: 'bg-violet-100',  text: 'text-violet-600'  },
  ticket:      { icon: LifeBuoy,    bg: 'bg-orange-100',  text: 'text-orange-600'  },
  deal:        { icon: TrendingUp,  bg: 'bg-cyan-100',    text: 'text-cyan-600'    },
};

// ── Edit modal ────────────────────────────────────────────────────────────────

function EditModal({ contact, onClose }: { contact: Contact; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    firstName: contact.first_name,
    lastName:  contact.last_name  ?? '',
    email:     contact.email      ?? '',
    phone:     contact.phone      ?? '',
    mobile:    contact.mobile     ?? '',
    jobTitle:  contact.job_title  ?? '',
    status:    contact.status,
    source:    contact.source     ?? '',
  });

  const mutation = useMutation({
    mutationFn: () => api.patch(`/api/v1/contacts/${contact.id}`, form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['contact', contact.id] }); onClose(); },
  });

  const f = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [k]: e.target.value });

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-gray-900">Edit Contact</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="grid grid-cols-2 gap-4">
          {([
            ['First Name', 'firstName', 'text'],
            ['Last Name',  'lastName',  'text'],
            ['Email',      'email',     'email'],
            ['Phone',      'phone',     'tel'],
            ['Mobile',     'mobile',    'tel'],
            ['Job Title',  'jobTitle',  'text'],
          ] as const).map(([label, key, type]) => (
            <div key={key}>
              <label className="text-xs font-medium text-gray-600 mb-1 block">{label}</label>
              <input type={type} value={form[key as keyof typeof form] as string} onChange={f(key as keyof typeof form)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400" />
            </div>
          ))}
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Status</label>
            <select value={form.status} onChange={f('status')}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400">
              {['lead','prospect','customer','churned','partner'].map((s) => (
                <option key={s} value={s} className="capitalize">{s}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex gap-2 mt-6">
          <button onClick={onClose} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="flex-1 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {mutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            <Save className="w-3.5 h-3.5" />
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Deals tab ─────────────────────────────────────────────────────────────────

function DealsTab({ contactId }: { contactId: string }) {
  const navigate = useNavigate();
  const { data } = useQuery({
    queryKey: ['contact-deals', contactId],
    queryFn: () => api.get(`/api/v1/deals?contactId=${contactId}`).then((r) => r.data.data ?? []),
  });
  const deals: Deal[] = data ?? [];

  if (deals.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400">
        <TrendingUp className="w-8 h-8 mx-auto mb-2 opacity-40" />
        <p className="text-sm">No deals linked to this contact</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {deals.map((deal) => (
        <button
          key={deal.id}
          onClick={() => navigate(`/deals?open=${deal.id}`)}
          className="w-full bg-white border border-gray-100 rounded-xl p-4 flex items-center justify-between hover:border-brand-200 hover:shadow-sm transition-all text-left"
        >
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">{deal.name}</p>
            <p className="text-xs text-gray-400 mt-0.5">{deal.stage_name ?? '—'} · Close: {fmtDate(deal.close_date)}</p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className={`text-xs font-medium capitalize ${DEAL_STATUS_COLORS[deal.status] ?? 'text-gray-600'}`}>
              {deal.status}
            </span>
            <span className="text-sm font-semibold text-brand-600">
              {deal.amount ? formatCurrency(deal.amount, deal.currency) : '—'}
            </span>
            <ExternalLink className="w-3 h-3 text-gray-300" />
          </div>
        </button>
      ))}
    </div>
  );
}

// ── Timeline tab ──────────────────────────────────────────────────────────────

function TimelineTab({ contactId }: { contactId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['contact-timeline', contactId],
    queryFn: () => api.get(`/api/v1/contacts/${contactId}/timeline`).then((r) => r.data.data ?? []),
  });
  const items: TimelineItem[] = data ?? [];

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 text-brand-400 animate-spin" /></div>;
  if (items.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400">
        <Clock className="w-8 h-8 mx-auto mb-2 opacity-40" />
        <p className="text-sm">No activity recorded yet</p>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Vertical line */}
      <div className="absolute left-5 top-0 bottom-0 w-px bg-gray-100" />
      <div className="space-y-1">
        {items.map((item) => {
          const iconInfo = TIMELINE_ICONS[item.type] ?? TIMELINE_ICONS.activity;
          const Icon = iconInfo.icon;
          return (
            <div key={`${item.type}-${item.id}`} className="flex gap-4 relative pl-2">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-1 z-10 ${iconInfo.bg}`}>
                <Icon className={`w-3 h-3 ${iconInfo.text}`} />
              </div>
              <div className="flex-1 bg-white border border-gray-100 rounded-xl p-3 mb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-400 capitalize mb-0.5">{item.type.replace('_', ' ')} · {item.subtype?.replace('_',' ')}</p>
                    <p className="text-sm font-medium text-gray-800 leading-snug">{item.subject || '—'}</p>
                  </div>
                  <span className="text-xs text-gray-400 shrink-0">{fmtRelative(item.created_at)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Emails tab ────────────────────────────────────────────────────────────────

function EmailsTab({ contactId }: { contactId: string }) {
  const { data } = useQuery({
    queryKey: ['contact-emails', contactId],
    queryFn: () => api.get(`/api/v1/emails?contactId=${contactId}&pageSize=20`).then((r) => r.data.data ?? []),
  });
  const emails: any[] = data ?? [];

  const STATUS_COLORS: Record<string, string> = {
    delivered: 'bg-emerald-100 text-emerald-700',
    queued:    'bg-gray-100 text-gray-600',
    sending:   'bg-blue-100 text-blue-700',
    failed:    'bg-red-100 text-red-700',
    bounced:   'bg-orange-100 text-orange-700',
    archived:  'bg-gray-100 text-gray-400',
  };

  if (emails.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400">
        <Mail className="w-8 h-8 mx-auto mb-2 opacity-40" />
        <p className="text-sm">No emails sent to this contact</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {emails.map((email) => (
        <div key={email.id} className="bg-white border border-gray-100 rounded-xl p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">{email.subject}</p>
              <p className="text-xs text-gray-400 mt-0.5">To: {email.to_email} · {fmtRelative(email.created_at)}</p>
            </div>
            <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium shrink-0 ${STATUS_COLORS[email.status] ?? ''}`}>
              {email.status}
            </span>
          </div>
          {(email.opened_at || email.clicked_at) && (
            <div className="flex gap-3 mt-2">
              {email.opened_at  && <span className="text-xs text-brand-600">✓ Opened  {fmtRelative(email.opened_at)}</span>}
              {email.clicked_at && <span className="text-xs text-emerald-600">✓ Clicked {fmtRelative(email.clicked_at)}</span>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Tickets tab ───────────────────────────────────────────────────────────────

function NewTicketModal({ contactId, onClose }: { contactId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [subject, setSubject]   = useState('');
  const [priority, setPriority] = useState('medium');
  const [dept, setDept]         = useState('');

  const mut = useMutation({
    mutationFn: () => api.post('/api/v1/tickets', { subject, priority, department: dept || undefined, contactId }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contact-tickets', contactId] });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">New Ticket</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Subject <span className="text-red-500">*</span></label>
            <input value={subject} onChange={e => setSubject(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
              placeholder="Describe the issue…" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Priority</label>
              <select value={priority} onChange={e => setPriority(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300">
                {['low','medium','high','urgent'].map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase()+p.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Department</label>
              <input value={dept} onChange={e => setDept(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
                placeholder="Optional" />
            </div>
          </div>
          {mut.isError && <p className="text-xs text-red-600">Failed to create ticket. Try again.</p>}
        </div>
        <div className="px-6 pb-5 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 border border-gray-200 rounded-xl">Cancel</button>
          <button onClick={() => mut.mutate()} disabled={!subject.trim() || mut.isPending}
            className="px-4 py-2 text-sm font-medium text-white bg-brand-500 hover:bg-brand-600 rounded-xl disabled:opacity-50 flex items-center gap-1.5">
            {mut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Create Ticket
          </button>
        </div>
      </div>
    </div>
  );
}

function TicketsTab({ contactId }: { contactId: string }) {
  const navigate = useNavigate();
  const [showNew, setShowNew] = useState(false);
  const { data } = useQuery({
    queryKey: ['contact-tickets', contactId],
    queryFn: () => api.get(`/api/v1/contacts/${contactId}/tickets`).then((r) => r.data.data ?? []),
  });
  const tickets: any[] = data ?? [];

  const PRIORITY_COLORS: Record<string, string> = {
    low:    'bg-gray-100 text-gray-600',
    medium: 'bg-blue-100 text-blue-700',
    high:   'bg-orange-100 text-orange-700',
    urgent: 'bg-red-100 text-red-700',
  };

  // Live TAT (turnaround/SLA) indicator for an open ticket. Returns null for
  // resolved/closed tickets (the clock no longer applies) or when no TAT is set.
  const tatLabel = (t: any): { text: string; cls: string } | null => {
    if (['resolved', 'closed'].includes(t.status)) return null;
    const secs = t.sla_seconds_remaining;
    if (secs === undefined || secs === null) return null;
    if (t.is_overdue || secs < 0) {
      const m = Math.abs(Math.floor(secs / 60));
      const h = Math.floor(m / 60);
      return { text: h > 0 ? `TAT breached ${h}h ${m % 60}m` : `TAT breached ${m}m`, cls: 'text-red-600' };
    }
    const hrs = Math.floor(secs / 3600);
    const mins = Math.floor((secs % 3600) / 60);
    const text = hrs > 0 ? `${hrs}h ${mins}m to TAT` : `${mins}m to TAT`;
    const cls = secs < 3600 ? 'text-orange-600' : secs < 7200 ? 'text-yellow-600' : 'text-emerald-600';
    return { text, cls };
  };

  return (
    <>
    {showNew && <NewTicketModal contactId={contactId} onClose={() => setShowNew(false)} />}
    <div className="space-y-2">
      <div className="flex justify-end mb-3">
        <button onClick={() => setShowNew(true)}
          className="flex items-center gap-1.5 text-xs font-medium text-white bg-brand-500 hover:bg-brand-600 px-3 py-1.5 rounded-lg transition-colors">
          <Plus className="w-3.5 h-3.5" /> New Ticket
        </button>
      </div>
      {tickets.length === 0 && (
      <div className="text-center py-12 text-gray-400">
        <LifeBuoy className="w-8 h-8 mx-auto mb-2 opacity-40" />
        <p className="text-sm">No support tickets from this contact</p>
      </div>
    )}
    {tickets.length > 0 && tickets.map((t) => (
        <button
          key={t.id}
          onClick={() => navigate(`/tickets?open=${t.id}`)}
          className="w-full bg-white border border-gray-100 rounded-xl p-4 flex items-center justify-between hover:border-brand-200 hover:shadow-sm transition-all text-left"
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-xs font-mono text-gray-400">#{t.ticket_number}</span>
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${PRIORITY_COLORS[t.priority]}`}>{t.priority}</span>
              {t.department && (
                <span className="text-xs px-1.5 py-0.5 rounded-full bg-purple-50 text-purple-700 font-medium capitalize">{t.department}</span>
              )}
            </div>
            <p className="text-sm font-medium text-gray-900 truncate">{t.subject}</p>
            <p className="text-xs text-gray-400 mt-0.5">{fmtRelative(t.created_at)}</p>
          </div>
          <div className="flex flex-col items-end shrink-0 ml-3 gap-0.5">
            <span className={`text-xs font-medium capitalize ${t.status === 'resolved' || t.status === 'closed' ? 'text-emerald-600' : 'text-blue-600'}`}>
              {t.status?.replace('_', ' ')}
            </span>
            {(() => {
              const tat = tatLabel(t);
              return tat ? <span className={`text-[11px] font-medium ${tat.cls}`}>{tat.text}</span> : null;
            })()}
            <ExternalLink className="w-3 h-3 text-gray-300 mt-0.5" />
          </div>
        </button>
      ))}
    </div>
    </>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const TABS = [
  { key: 'timeline', label: 'Timeline',   icon: Clock        },
  { key: 'deals',    label: 'Deals',      icon: TrendingUp   },
  { key: 'emails',   label: 'Emails',     icon: Mail         },
  { key: 'tickets',  label: 'Tickets',    icon: LifeBuoy     },
] as const;

export function ContactDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isAdmin = useIsAdmin();
  const qc = useQueryClient();
  const [tab, setTab]           = useState<typeof TABS[number]['key']>('timeline');
  const [editing, setEditing]   = useState(false);
  const [eraseStep, setEraseStep] = useState<0|1|2>(0); // 0=hidden 1=confirm 2=done

  const eraseMutation = useMutation({
    mutationFn: () => api.post(`/api/v1/contacts/${id}/erase`, {}),
    onSuccess: () => {
      setEraseStep(2);
      qc.invalidateQueries({ queryKey: ['contact', id] });
    },
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ['contact', id],
    queryFn: () => api.get(`/api/v1/contacts/${id}`).then((r) => r.data.data),
    enabled: !!id,
  });
  const contact: Contact | undefined = data;

  const { data: csatData } = useQuery({
    queryKey: ['contact-csat', id],
    queryFn: () => api.get(`/api/v1/contacts/${id}/csat`).then(r => r.data.data),
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 text-brand-400 animate-spin" />
      </div>
    );
  }

  if (error || !contact) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <User className="w-10 h-10 text-gray-300 mb-3" />
        <p className="text-gray-500 font-medium">Contact not found</p>
        <button onClick={() => navigate('/contacts')} className="mt-3 text-sm text-brand-600 hover:underline">← Back to Contacts</button>
      </div>
    );
  }

  const initials = [contact.first_name?.[0], contact.last_name?.[0]].filter(Boolean).join('').toUpperCase() || '?';
  const fullName = [contact.first_name, contact.last_name].filter(Boolean).join(' ');

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left profile sidebar */}
      <div className="w-72 border-r border-gray-100 flex flex-col overflow-y-auto shrink-0">
        {/* Back button */}
        <div className="px-4 py-3 border-b border-gray-100">
          <button onClick={() => navigate('/contacts')} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800">
            <ArrowLeft className="w-4 h-4" />
            All Contacts
          </button>
        </div>

        {/* Avatar + name */}
        <div className="px-5 py-6 text-center border-b border-gray-100">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-brand-400 to-purple-500 flex items-center justify-center text-white text-xl font-bold mx-auto mb-3">
            {initials}
          </div>
          <h2 className="text-base font-semibold text-gray-900">{fullName}</h2>
          {contact.job_title && <p className="text-sm text-gray-500 mt-0.5">{contact.job_title}</p>}
          {contact.company_name && (
            <p className="text-xs text-brand-600 mt-1 flex items-center justify-center gap-1">
              <Building2 className="w-3 h-3" />{contact.company_name}
            </p>
          )}
          <span className={`inline-block mt-2 text-xs px-2 py-0.5 rounded-full font-medium capitalize ${STATUS_COLORS[contact.status] ?? 'bg-gray-100 text-gray-600'}`}>
            {contact.status}
          </span>
        </div>

        {/* Contact info */}
        <div className="px-5 py-4 space-y-3 border-b border-gray-100">
          {contact.email && (
            <a href={`mailto:${contact.email}`} className="flex items-center gap-2.5 text-sm text-gray-700 hover:text-brand-600 group">
              <Mail className="w-4 h-4 text-gray-400 group-hover:text-brand-500" />
              <span className="truncate">{contact.email}</span>
            </a>
          )}
          {contact.phone && (
            <a href={`tel:${contact.phone}`} className="flex items-center gap-2.5 text-sm text-gray-700 hover:text-brand-600 group">
              <Phone className="w-4 h-4 text-gray-400 group-hover:text-brand-500" />
              <span>{contact.phone}</span>
            </a>
          )}
          {contact.mobile && (
            <a href={`tel:${contact.mobile}`} className="flex items-center gap-2.5 text-sm text-gray-700 hover:text-brand-600 group">
              <Phone className="w-4 h-4 text-gray-400 group-hover:text-brand-500" />
              <span>{contact.mobile} (mobile)</span>
            </a>
          )}
          {contact.nic_number && (
            <div className="flex items-center gap-2.5 text-sm text-gray-700">
              <CreditCard className="w-4 h-4 text-gray-400 shrink-0" />
              <span className="font-mono text-xs tracking-wide">{contact.nic_number}</span>
            </div>
          )}
        </div>

        {/* Meta */}
        <div className="px-5 py-4 space-y-2 border-b border-gray-100">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-400">Owner</span>
            <span className="text-gray-700 font-medium">{contact.owner_name || '—'}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-400">Source</span>
            <span className="text-gray-700 font-medium capitalize">{contact.source?.replace(/_/g,' ') || '—'}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-400">Created</span>
            <span className="text-gray-700">{fmtDate(contact.created_at)}</span>
          </div>
        </div>

        {/* Tags */}
        {contact.tags?.length > 0 && (
          <div className="px-5 py-4 border-b border-gray-100">
            <p className="text-xs font-medium text-gray-500 mb-2 flex items-center gap-1"><Tag className="w-3 h-3" /> Tags</p>
            <div className="flex flex-wrap gap-1.5">
              {contact.tags.map((tag) => (
                <span key={tag} className="text-xs px-2 py-0.5 bg-brand-50 text-brand-700 rounded-full">{tag}</span>
              ))}
            </div>
          </div>
        )}

        {/* CSAT summary */}
        {csatData && csatData.count > 0 && (
          <div className="px-5 py-4 border-b border-gray-100">
            <p className="text-xs font-medium text-gray-500 mb-2 flex items-center gap-1">
              <Star className="w-3 h-3" /> Customer Satisfaction
            </p>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1">
                {[1,2,3,4,5].map(n => (
                  <Star key={n} className={`w-4 h-4 ${n <= Math.round(csatData.avg) ? 'text-amber-400 fill-amber-400' : 'text-gray-200 fill-gray-200'}`} />
                ))}
              </div>
              <span className="text-sm font-bold text-gray-800">{csatData.avg}</span>
              <span className="text-xs text-gray-400">({csatData.count} {csatData.count === 1 ? 'rating' : 'ratings'})</span>
            </div>
          </div>
        )}

        {/* Custom fields */}
        {Object.keys(contact.custom_fields ?? {}).length > 0 && (
          <div className="px-5 py-4 border-b border-gray-100">
            <p className="text-xs font-medium text-gray-500 mb-2">Custom Fields</p>
            <div className="space-y-2">
              {Object.entries(contact.custom_fields).map(([k, v]) => (
                <div key={k} className="flex justify-between text-sm">
                  <span className="text-gray-400 capitalize">{k.replace(/_/g,' ')}</span>
                  <span className="text-gray-700 font-medium">{v as string}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Edit + GDPR erase buttons */}
        <div className="px-5 py-4 mt-auto space-y-2">
          <button
            onClick={() => setEditing(true)}
            className="w-full flex items-center justify-center gap-2 py-2 border border-gray-200 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
          >
            <Edit2 className="w-3.5 h-3.5" />
            Edit Contact
          </button>
          {/* G-P4: GDPR right-to-erasure — tenant_admin only */}
          {isAdmin && eraseStep === 0 && (
            <button onClick={() => setEraseStep(1)}
              className="w-full flex items-center justify-center gap-2 py-2 border border-red-200 rounded-lg text-sm text-red-600 hover:bg-red-50">
              <Trash2 className="w-3.5 h-3.5" /> Erase Personal Data (GDPR)
            </button>
          )}
          {isAdmin && eraseStep === 1 && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 space-y-2">
              <p className="text-xs font-semibold text-red-700 flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5" /> Irreversible — erase PII?
              </p>
              <p className="text-[11px] text-red-600">Name, email, phone, and NIC will be anonymised. Linked ticket data also cleared. An audit certificate will be saved.</p>
              <div className="flex gap-2">
                <button onClick={() => eraseMutation.mutate()} disabled={eraseMutation.isPending}
                  className="flex-1 py-1.5 rounded-md text-xs font-semibold bg-red-600 text-white hover:bg-red-700 disabled:opacity-40">
                  {eraseMutation.isPending ? 'Erasing…' : 'Yes, Erase'}
                </button>
                <button onClick={() => setEraseStep(0)}
                  className="flex-1 py-1.5 rounded-md text-xs font-semibold bg-gray-200 text-gray-700 hover:bg-gray-300">
                  Cancel
                </button>
              </div>
            </div>
          )}
          {eraseStep === 2 && (
            <p className="text-xs text-center text-emerald-600 font-medium py-1">Personal data erased. Audit log saved.</p>
          )}
        </div>
      </div>

      {/* Right content area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Tab bar */}
        <div className="px-5 border-b border-gray-100 flex items-center gap-1 shrink-0">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-1.5 px-3 py-3.5 text-sm font-medium border-b-2 transition-colors ${
                tab === key
                  ? 'border-brand-500 text-brand-600'
                  : 'border-transparent text-gray-500 hover:text-gray-800'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto p-5">
          {tab === 'timeline' && <TimelineTab contactId={id!} />}
          {tab === 'deals'    && <DealsTab    contactId={id!} />}
          {tab === 'emails'   && <EmailsTab   contactId={id!} />}
          {tab === 'tickets'  && <TicketsTab  contactId={id!} />}
        </div>
      </div>

      {editing && contact && <EditModal contact={contact} onClose={() => setEditing(false)} />}
    </div>
  );
}
