/**
 * Custom Fields Builder
 * Tenant admin can add / edit / delete custom fields for contacts, tickets, and deals.
 * Fields are stored in custom_field_definitions and rendered on contact + ticket forms.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Trash2, Edit2, Check, X, GripVertical,
  AlertCircle, Loader2, Tag, ToggleLeft, ToggleRight, RotateCcw,
} from 'lucide-react';
import { api } from '../services/api';
import { useAuthStore } from '../store/auth.store';
import { SECTORS } from '@crm/shared';

type FieldType = 'text' | 'email' | 'phone' | 'number' | 'date' | 'select' | 'textarea' | 'boolean';
type Entity    = 'contact' | 'company' | 'ticket' | 'deal';

interface FieldDef {
  id:          string;
  name:        string;
  label:       string;
  field_type:  FieldType;
  options:     string[] | null;
  is_required: boolean;
  sort_order:  number;
  entity:      Entity;
}

const FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: 'text',     label: 'Text'        },
  { value: 'textarea', label: 'Long text'   },
  { value: 'number',   label: 'Number'      },
  { value: 'email',    label: 'Email'       },
  { value: 'phone',    label: 'Phone'       },
  { value: 'date',     label: 'Date'        },
  { value: 'select',   label: 'Dropdown'    },
  { value: 'boolean',  label: 'Yes / No'    },
];

const ENTITIES: { value: Entity; label: string; color: string }[] = [
  { value: 'contact', label: 'Contacts',  color: '#29ABE2' },
  { value: 'company', label: 'Companies', color: '#8b5cf6' },
  { value: 'ticket',  label: 'Tickets',   color: '#f59e0b' },
  { value: 'deal',    label: 'Deals',     color: '#10b981' },
];

const blank = (): Omit<FieldDef, 'id' | 'sort_order'> => ({
  name:        '',
  label:       '',
  field_type:  'text',
  options:     null,
  is_required: false,
  entity:      'contact',
});

function nameFromLabel(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
}

export function CustomFieldsPage() {
  const qc = useQueryClient();
  const { tenant } = useAuthStore();
  const sectorCfg = SECTORS.find(s => s.id === (tenant as any)?.sector);
  const [activeEntity, setActiveEntity] = useState<Entity>('contact');
  const [editId,   setEditId]   = useState<string | null>(null);
  const [showNew,  setShowNew]  = useState(false);
  const [form,     setForm]     = useState(blank());
  const [optInput, setOptInput] = useState('');
  const [confirmRestore, setConfirmRestore] = useState(false);

  const { data: allFields = [], isLoading } = useQuery<FieldDef[]>({
    queryKey: ['custom-field-defs'],
    queryFn: async () => {
      const entities: Entity[] = ['contact', 'company', 'ticket', 'deal'];
      const results = await Promise.all(
        entities.map(e =>
          api.get(`/api/v1/sector/fields?entity=${e}`)
            .then((r: any) => (r.data.data ?? []).map((f: any) => ({ ...f, entity: e })))
            .catch(() => [] as FieldDef[])
        )
      );
      return results.flat();
    },
  });

  const fields = allFields.filter(f => f.entity === activeEntity);

  const createMut = useMutation({
    mutationFn: (body: any) => api.post(`/api/v1/sector/fields`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['custom-field-defs'] }); qc.invalidateQueries({ queryKey: ['sector-fields'] }); setShowNew(false); setForm(blank()); setOptInput(''); },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: any }) => api.patch(`/api/v1/sector/fields/${id}`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['custom-field-defs'] }); qc.invalidateQueries({ queryKey: ['sector-fields'] }); setEditId(null); },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/sector/fields/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['custom-field-defs'] }); qc.invalidateQueries({ queryKey: ['sector-fields'] }); },
  });

  const restoreDefaultsMut = useMutation({
    mutationFn: () => api.post('/api/v1/sector/fields/restore-defaults'),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['custom-field-defs'] }); qc.invalidateQueries({ queryKey: ['sector-fields'] }); setConfirmRestore(false); },
  });

  function startEdit(f: FieldDef) {
    setEditId(f.id);
    setForm({ name: f.name, label: f.label, field_type: f.field_type, options: f.options, is_required: f.is_required, entity: f.entity as Entity });
    setOptInput('');
    setShowNew(false);
  }

  function cancelEdit() { setEditId(null); setForm(blank()); setOptInput(''); }

  function addOption() {
    const v = optInput.trim();
    if (!v) return;
    setForm(f => ({ ...f, options: [...(f.options ?? []), v] }));
    setOptInput('');
  }

  function removeOption(i: number) {
    setForm(f => ({ ...f, options: (f.options ?? []).filter((_, idx) => idx !== i) }));
  }

  function handleLabelChange(label: string) {
    setForm(f => ({ ...f, label, name: f.name || nameFromLabel(label) }));
  }

  function submitNew() {
    const body = {
      name:        form.name,
      label:       form.label,
      field_type:  form.field_type,
      is_required: form.is_required,
      sort_order:  fields.length * 10 + 10,
      ...(form.field_type === 'select' ? { options: form.options ?? [] } : {}),
      entity:      form.entity,
    };
    createMut.mutate(body);
  }

  function submitEdit(id: string) {
    const body: any = {
      label:       form.label,
      is_required: form.is_required,
      ...(form.field_type === 'select' ? { options: form.options ?? [] } : {}),
    };
    updateMut.mutate({ id, body });
  }

  const navCls = (e: Entity) =>
    `px-4 py-2 text-sm font-medium rounded-lg transition-all ${activeEntity === e ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`;

  const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400/40 focus:border-brand-400';

  return (
    <div className="max-w-3xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Custom Fields</h1>
          <p className="text-sm text-gray-500 mt-0.5">Add sector-specific fields to contacts, tickets, and deals. These appear in forms and are stored per record.</p>
        </div>
        <div className="flex gap-2">
          {sectorCfg && (
            confirmRestore ? (
              <div className="flex items-center gap-2">
                <button onClick={() => setConfirmRestore(false)} className="px-3 py-2 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-500">Cancel</button>
                <button onClick={() => restoreDefaultsMut.mutate()} disabled={restoreDefaultsMut.isPending}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-white rounded-lg bg-amber-500 hover:bg-amber-600 disabled:opacity-50">
                  {restoreDefaultsMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                  Confirm restore
                </button>
              </div>
            ) : (
              <button onClick={() => setConfirmRestore(true)}
                title={`Reset field titles/options back to the ${sectorCfg.label} defaults. Fields you added yourself are untouched.`}
                className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600">
                <RotateCcw className="w-4 h-4" /> Restore {sectorCfg.label} Defaults
              </button>
            )
          )}
          <button onClick={() => { setShowNew(true); setEditId(null); setForm({ ...blank(), entity: activeEntity }); }}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white rounded-lg"
            style={{ background: 'linear-gradient(135deg,#29ABE2,#4D8B3C)' }}>
            <Plus className="w-4 h-4" /> Add Field
          </button>
        </div>
      </div>

      {/* Entity tabs */}
      <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-xl w-fit">
        {ENTITIES.map(e => (
          <button key={e.value} onClick={() => setActiveEntity(e.value)} className={navCls(e.value)}>
            <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: e.color }} />
            {e.label}
            <span className="ml-1.5 text-xs text-gray-400">({allFields.filter(f => f.entity === e.value).length})</span>
          </button>
        ))}
      </div>

      {/* New field form */}
      {showNew && (
        <FieldForm
          form={form} setForm={setForm} optInput={optInput} setOptInput={setOptInput}
          onLabelChange={handleLabelChange} addOption={addOption} removeOption={removeOption}
          onSave={submitNew} onCancel={() => { setShowNew(false); setForm(blank()); }}
          saving={createMut.isPending} error={(createMut.error as any)?.message}
          isNew showEntity
        />
      )}

      {/* Fields list */}
      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-gray-400 py-8 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading fields…
        </div>
      ) : fields.length === 0 && !showNew ? (
        <div className="text-center py-12 border-2 border-dashed border-gray-200 rounded-2xl">
          <Tag className="w-8 h-8 text-gray-300 mx-auto mb-3" />
          <p className="text-sm font-medium text-gray-500">No custom fields yet</p>
          <p className="text-xs text-gray-400 mt-1">Add fields to capture sector-specific data on {activeEntity} records.</p>
          {sectorCfg && (
            <button onClick={() => setConfirmRestore(true)}
              className="mt-4 text-xs text-brand-500 hover:underline font-medium">
              Load {sectorCfg.label} defaults →
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {fields.map(f => (
            <div key={f.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              {editId === f.id ? (
                <div className="p-4">
                  <FieldForm
                    form={form} setForm={setForm} optInput={optInput} setOptInput={setOptInput}
                    onLabelChange={handleLabelChange} addOption={addOption} removeOption={removeOption}
                    onSave={() => submitEdit(f.id)} onCancel={cancelEdit}
                    saving={updateMut.isPending} error={(updateMut.error as any)?.message}
                    lockName lockType
                  />
                </div>
              ) : (
                <div className="flex items-center gap-3 px-4 py-3">
                  <GripVertical className="w-4 h-4 text-gray-300 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-gray-900">{f.label}</span>
                      {f.field_type === 'select' && <span className="text-[10px] font-bold text-brand-600 border border-brand-200 bg-brand-50 px-1.5 py-0.5 rounded">Dropdown</span>}
                      {f.is_required && <span className="text-[10px] font-bold text-red-500 border border-red-200 bg-red-50 px-1.5 py-0.5 rounded">Required</span>}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-gray-400 font-mono">{f.name}</span>
                      <span className="text-gray-300">·</span>
                      <span className="text-xs text-gray-400">{FIELD_TYPES.find(t => t.value === f.field_type)?.label}</span>
                    </div>
                    {f.field_type === 'select' && !!f.options?.length && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {f.options.map((o, i) => (
                          <span key={i} className="text-[11px] text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded">{o}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => startEdit(f)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600">
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => { if (confirm(`Delete field "${f.label}"? This removes the field definition — existing data is unaffected.`)) deleteMut.mutate(f.id); }}
                      className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

    </div>
  );
}

// ── Shared form component ─────────────────────────────────────────────────────
interface FormProps {
  form: ReturnType<typeof blank>;
  setForm: React.Dispatch<React.SetStateAction<ReturnType<typeof blank>>>;
  optInput: string;
  setOptInput: (v: string) => void;
  onLabelChange: (v: string) => void;
  addOption: () => void;
  removeOption: (i: number) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  error?: string;
  isNew?: boolean;
  lockName?: boolean;
  lockType?: boolean;
  showEntity?: boolean;
}

function FieldForm({ form, setForm, optInput, setOptInput, onLabelChange, addOption, removeOption, onSave, onCancel, saving, error, isNew, lockName, lockType, showEntity }: FormProps) {
  const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400/40 focus:border-brand-400';

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-4">
      {isNew && <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">New field</p>}

      {showEntity && (
        <div>
          <label className="text-xs font-medium text-gray-600 mb-1 block">Attach to</label>
          <select value={form.entity} onChange={e => setForm(f => ({ ...f, entity: e.target.value as Entity }))} className={inputCls}>
            {ENTITIES.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
          </select>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-gray-600 mb-1 block">Label <span className="text-red-500">*</span></label>
          <input value={form.label} onChange={e => onLabelChange(e.target.value)} placeholder="e.g. SBP Complaint Reference" className={inputCls} />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600 mb-1 block">Field name (snake_case)</label>
          <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="auto-generated" className={`${inputCls} ${lockName ? 'bg-gray-100 text-gray-400' : ''}`} readOnly={lockName} />
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-gray-600 mb-1 block">Field type</label>
        <select value={form.field_type} onChange={e => setForm(f => ({ ...f, field_type: e.target.value as FieldType, options: null }))}
          className={`${inputCls} ${lockType ? 'bg-gray-100 text-gray-400' : ''}`} disabled={lockType}>
          {FIELD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </div>

      {form.field_type === 'select' && (
        <div>
          <label className="text-xs font-medium text-gray-600 mb-1 block">Dropdown options</label>
          <div className="flex gap-2 mb-2">
            <input value={optInput} onChange={e => setOptInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addOption(); } }}
              placeholder="Type an option and press Enter" className={inputCls} />
            <button type="button" onClick={addOption} className="px-3 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-100 shrink-0">Add</button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(form.options ?? []).map((o, i) => (
              <span key={i} className="flex items-center gap-1 text-xs bg-brand-50 text-brand-700 border border-brand-200 px-2 py-1 rounded-full">
                {o}
                <button type="button" onClick={() => removeOption(i)} className="text-brand-400 hover:text-red-500"><X className="w-3 h-3" /></button>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <button type="button" onClick={() => setForm(f => ({ ...f, is_required: !f.is_required }))}
          className="flex items-center gap-2 text-sm text-gray-600">
          {form.is_required
            ? <ToggleRight className="w-5 h-5 text-brand-500" />
            : <ToggleLeft  className="w-5 h-5 text-gray-400"  />}
          Required field
        </button>
        <div className="flex items-center gap-2">
          <button onClick={onCancel} className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg">Cancel</button>
          <button onClick={onSave} disabled={!form.label.trim() || !form.name.trim() || saving}
            className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium text-white rounded-lg disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg,#29ABE2,#4D8B3C)' }}>
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            {isNew ? 'Create field' : 'Save changes'}
          </button>
        </div>
      </div>
      {error && <p className="text-xs text-red-500 flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5" />{error}</p>}
    </div>
  );
}
