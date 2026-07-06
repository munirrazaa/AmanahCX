import { useState, useCallback, useEffect } from 'react';
import {
  DndContext, DragEndEvent, DragStartEvent, DragOverlay,
  PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy,
  useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useDraggable, useDroppable } from '@dnd-kit/core'; // useDraggable for palette, useDroppable for canvas zone
import { Save, Trash2, Eye, X, AlignLeft, AlignCenter, AlignRight, Loader2, GripVertical } from 'lucide-react';
import { v4 as uuid } from 'uuid';
import { api } from '../../services/api';
import {
  type ElementType, type ElementProps, type BuilderEl,
  DEFAULT_PROPS, PALETTE, renderElement,
} from './templateRenderer';

const renderPreview = renderElement;

function PaletteItem({ type, label, icon }: { type: ElementType; label: string; icon: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `palette-${type}`, data: { type, source: 'palette' } });
  return (
    <div ref={setNodeRef} {...listeners} {...attributes}
      className={`flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg cursor-grab text-sm hover:border-blue-400 select-none transition-all ${isDragging ? 'opacity-40' : ''}`}>
      <span className="text-base leading-none">{icon}</span>
      <span className="text-gray-700">{label}</span>
    </div>
  );
}

function CanvasElement({ el, selected, onSelect, onRemove }: {
  el: BuilderEl; selected: boolean; onSelect: () => void; onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: el.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div ref={setNodeRef} style={style}
      onClick={e => { e.stopPropagation(); onSelect(); }}
      className={`relative group border rounded-lg p-3 transition-all ${selected ? 'border-blue-500 shadow-md bg-blue-50/30' : 'border-gray-200 hover:border-gray-400 bg-white'} ${isDragging ? 'opacity-40 shadow-xl' : ''}`}>
      {/* Drag handle */}
      <div {...attributes} {...listeners}
        className="absolute left-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-40 hover:!opacity-80 cursor-grab text-gray-400 touch-none">
        <GripVertical size={14} />
      </div>
      <div className="text-xs text-gray-400 mb-2 font-medium uppercase tracking-wide pl-4">{el.label}</div>
      {renderPreview(el)}
      <button onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); onRemove(); }}
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 transition-opacity">
        <Trash2 size={13} />
      </button>
    </div>
  );
}

// Full-page preview modal
function PreviewModal({ elements, onClose }: { elements: BuilderEl[]; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center overflow-y-auto py-8">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <span className="font-semibold text-gray-900">Invoice Preview</span>
          <div className="flex gap-2">
            <button onClick={() => window.print()} className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50">Print / Save PDF</button>
            <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-700"><X size={18} /></button>
          </div>
        </div>
        <div id="invoice-preview-print" className="p-10 space-y-5">
          {elements.map(el => (
            <div key={el.id}>{renderPreview(el)}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Template name dialog
function SaveDialog({ onSave, onClose, loading }: {
  onSave: (name: string, isDefault: boolean) => void;
  onClose: () => void;
  loading: boolean;
}) {
  const [name, setName] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center">
      <div className="bg-white rounded-xl shadow-2xl w-96 p-6">
        <div className="text-base font-semibold mb-4">Save Template</div>
        <label className="block text-sm text-gray-600 mb-1">Template name</label>
        <input autoFocus value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && name.trim() && onSave(name.trim(), isDefault)}
          className="w-full border rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="e.g. Standard Invoice" />
        <label className="flex items-center gap-2 text-sm text-gray-600 mb-5 cursor-pointer">
          <input type="checkbox" checked={isDefault} onChange={e => setIsDefault(e.target.checked)} />
          Set as default template
        </label>
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">Cancel</button>
          <button disabled={!name.trim() || loading} onClick={() => onSave(name.trim(), isDefault)}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
            {loading && <Loader2 size={14} className="animate-spin" />} Save
          </button>
        </div>
      </div>
    </div>
  );
}

const DEFAULT_CANVAS: BuilderEl[] = [
  { id: uuid(), type: 'logo',            label: 'Company Logo',     props: { ...DEFAULT_PROPS } },
  { id: uuid(), type: 'invoice_details', label: 'Invoice Details',  props: { ...DEFAULT_PROPS } },
  { id: uuid(), type: 'client_info',     label: 'Client Info',      props: { ...DEFAULT_PROPS } },
  { id: uuid(), type: 'line_items',      label: 'Line Items Table', props: { ...DEFAULT_PROPS, fontSize: 12 } },
  { id: uuid(), type: 'totals',          label: 'Totals',           props: { ...DEFAULT_PROPS, alignment: 'right' } },
  { id: uuid(), type: 'payment_info',    label: 'Payment Info',     props: { ...DEFAULT_PROPS } },
  { id: uuid(), type: 'notes',           label: 'Notes',            props: { ...DEFAULT_PROPS, fontSize: 12 } },
  { id: uuid(), type: 'terms',           label: 'Terms & Conditions', props: { ...DEFAULT_PROPS, fontSize: 11 } },
];

export function SalesBuilder() {
  const [elements, setElements] = useState<BuilderEl[]>(DEFAULT_CANVAS);
  const [selected, setSelected] = useState<string | null>(null);
  const [activeDragType, setActiveDragType] = useState<ElementType | null>(null);
  const [isOver, setIsOver] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const [savedTemplates, setSavedTemplates] = useState<{ id: string; name: string }[]>([]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const { setNodeRef: setCanvasRef } = useDroppable({ id: 'canvas' });

  useEffect(() => {
    api.get('/api/v1/sales/templates')
      .then(r => r.data?.data && setSavedTemplates(r.data.data.filter((t: any) => t.type === 'builder')))
      .catch(() => {});
  }, []);

  const updateSelected = useCallback((patch: Partial<ElementProps>) => {
    setElements(prev => prev.map(el =>
      el.id === selected ? { ...el, props: { ...el.props, ...patch } } : el
    ));
  }, [selected]);

  const onDragStart = useCallback((e: DragStartEvent) => {
    const d = e.active.data.current as any;
    if (d.source === 'palette') setActiveDragType(d.type);
    setIsOver(false);
  }, []);

  const onDragOver = useCallback(() => setIsOver(true), []);

  const onDragEnd = useCallback((e: DragEndEvent) => {
    setIsOver(false); setActiveDragType(null);
    const d = e.active.data.current as any;
    // Accept palette drops onto the canvas zone OR any existing canvas element
    const overCanvas = e.over?.id === 'canvas' ||
      (e.over && elements.some(el => el.id === e.over!.id));
    if (d?.source === 'palette' && d.type && overCanvas) {
      // Drop from palette onto canvas
      const def = PALETTE.find(p => p.type === d.type);
      if (def) setElements(prev => [...prev, { id: uuid(), type: d.type, label: def.label, props: { ...DEFAULT_PROPS } }]);
    } else if (e.active.id !== e.over?.id && e.over) {
      // Reorder within canvas
      setElements(prev => {
        const oldIdx = prev.findIndex(el => el.id === e.active.id);
        const newIdx = prev.findIndex(el => el.id === e.over!.id);
        if (oldIdx !== -1 && newIdx !== -1) return arrayMove(prev, oldIdx, newIdx);
        return prev;
      });
    }
  }, []);

  const loadTemplate = (id: string) => {
    api.get('/api/v1/sales/templates')
      .then(r => {
        const tpl = r.data?.data?.find((t: any) => t.id === id);
        if (tpl?.layout) { setElements(tpl.layout); setSelected(null); }
      })
      .catch(() => {});
  };

  const handleSave = async (name: string, isDefault: boolean) => {
    setSaving(true);
    try {
      const res = await api.post('/api/v1/sales/templates', { name, layout: elements, isDefault });
      setSavedTemplates(prev => [{ id: res.data.data.id, name }, ...prev]);
      setShowSaveDialog(false);
      setSavedMsg('Saved!');
      setTimeout(() => setSavedMsg(''), 2500);
    } catch {
      // leave the dialog open so the user can retry
    } finally {
      setSaving(false);
    }
  };

  const selectedEl = elements.find(e => e.id === selected);

  return (
    <>
      <DndContext sensors={sensors} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd}>
        <div className="flex h-full overflow-hidden" style={{ height: 'calc(100vh - 0px)' }}>
          {/* Palette */}
          <aside className="w-52 shrink-0 border-r border-gray-200 bg-gray-50 flex flex-col">
            <div className="px-4 py-3 border-b border-gray-200">
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Elements</div>
              <div className="text-xs text-gray-400 mt-0.5">Drag onto canvas</div>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {PALETTE.map(item => <PaletteItem key={item.type} {...item} />)}
            </div>
            {savedTemplates.length > 0 && (
              <div className="border-t border-gray-200 p-3">
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Load Saved</div>
                <div className="space-y-1">
                  {savedTemplates.slice(0, 5).map(t => (
                    <button key={t.id} onClick={() => loadTemplate(t.id)}
                      className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-blue-50 hover:text-blue-700 text-gray-700 truncate">
                      {t.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </aside>

          {/* Canvas */}
          <div className="flex-1 overflow-y-auto p-6 bg-gray-100" onClick={() => setSelected(null)}>
            <div className="max-w-2xl mx-auto">
              <div className="flex justify-between items-center mb-4">
                <div className="text-sm text-gray-500">{elements.length} element{elements.length !== 1 ? 's' : ''}</div>
                <div className="flex gap-2">
                  <button onClick={() => setShowPreview(true)}
                    className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700 bg-white">
                    <Eye size={14} /> Preview
                  </button>
                  <button onClick={() => setShowSaveDialog(true)}
                    className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">
                    <Save size={14} /> {savedMsg || 'Save Template'}
                  </button>
                </div>
              </div>
              <div ref={setCanvasRef}
                className={`min-h-96 rounded-xl border-2 border-dashed p-6 space-y-3 transition-colors ${isOver ? 'border-blue-400 bg-blue-50' : 'border-gray-300 bg-white'}`}>
                {elements.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-64 text-gray-400 text-sm gap-2">
                    <span className="text-3xl">📋</span>
                    <span>Drag elements here to build your invoice layout</span>
                  </div>
                )}
                <SortableContext items={elements.map(e => e.id)} strategy={verticalListSortingStrategy}>
                  {elements.map(el => (
                    <CanvasElement key={el.id} el={el} selected={selected === el.id}
                      onSelect={() => setSelected(el.id)}
                      onRemove={() => { setElements(prev => prev.filter(e => e.id !== el.id)); setSelected(null); }} />
                  ))}
                </SortableContext>
              </div>
            </div>
          </div>

          {/* Properties panel */}
          <aside className="w-56 shrink-0 border-l border-gray-200 bg-white flex flex-col">
            <div className="px-4 py-3 border-b border-gray-200">
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Properties</div>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {selectedEl ? (
                <div className="space-y-5">
                  <div>
                    <div className="text-xs font-medium text-gray-500 mb-1">Element</div>
                    <div className="text-sm font-semibold text-gray-900">{selectedEl.label}</div>
                  </div>

                  <div>
                    <div className="text-xs font-medium text-gray-500 mb-2">Alignment</div>
                    <div className="flex gap-1">
                      {(['left','center','right'] as const).map(a => (
                        <button key={a} onClick={() => updateSelected({ alignment: a })}
                          className={`flex-1 flex items-center justify-center py-1.5 border rounded transition-colors ${selectedEl.props.alignment === a ? 'border-blue-500 bg-blue-50 text-blue-600' : 'border-gray-200 hover:border-gray-400 text-gray-500'}`}>
                          {a === 'left' ? <AlignLeft size={14} /> : a === 'center' ? <AlignCenter size={14} /> : <AlignRight size={14} />}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="text-xs font-medium text-gray-500 mb-1 flex justify-between">
                      <span>Font Size</span><span className="text-gray-700">{selectedEl.props.fontSize}px</span>
                    </div>
                    <input type="range" min={9} max={24} value={selectedEl.props.fontSize}
                      onChange={e => updateSelected({ fontSize: Number(e.target.value) })}
                      className="w-full accent-blue-600" />
                  </div>

                  <div>
                    <div className="text-xs font-medium text-gray-500 mb-2">Color</div>
                    <div className="flex items-center gap-2">
                      <input type="color" value={selectedEl.props.color}
                        onChange={e => updateSelected({ color: e.target.value })}
                        className="w-8 h-8 rounded border border-gray-200 cursor-pointer p-0.5" />
                      <span className="text-xs text-gray-500 font-mono">{selectedEl.props.color}</span>
                    </div>
                  </div>

                  {selectedEl.type === 'custom_text' && (
                    <div>
                      <div className="text-xs font-medium text-gray-500 mb-1">Content</div>
                      <textarea rows={4} value={selectedEl.props.customText ?? ''}
                        onChange={e => updateSelected({ customText: e.target.value })}
                        className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                  )}

                  <button onClick={() => { setElements(prev => prev.filter(e => e.id !== selectedEl.id)); setSelected(null); }}
                    className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700">
                    <Trash2 size={13} /> Remove Element
                  </button>
                </div>
              ) : (
                <div className="text-xs text-gray-400 text-center mt-8">Select an element to edit its properties</div>
              )}
            </div>
          </aside>
        </div>

        <DragOverlay>
          {activeDragType && (
            <div className="bg-white border-2 border-blue-400 rounded-lg px-4 py-2 shadow-lg text-sm font-medium text-blue-700">
              {PALETTE.find(p => p.type === activeDragType)?.label}
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {showPreview && <PreviewModal elements={elements} onClose={() => setShowPreview(false)} />}
      {showSaveDialog && <SaveDialog onSave={handleSave} onClose={() => setShowSaveDialog(false)} loading={saving} />}
    </>
  );
}
