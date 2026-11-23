import React, { useState } from 'react';
import { Modal, Field, PageHeader, Loading, Empty, Switch } from './components/ui.jsx';
import { Icon } from './components/icons.jsx';
import { Select } from './components/select.jsx';
import { api } from './api.js';
import { useApi, act } from './hooks.js';

const toLocalInput = (v) => {
  if (!v) return '';
  const d = new Date(v);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60e3).toISOString().slice(0, 16);
};

/**
 * Página de alta, edición y baja.
 * fields: [{ name, label, type: 'text'|'number'|'select'|'checkbox'|'datetime'|'heading', options, required, placeholder, help, createOnly, half, show(values) }]
 * columns: [{ label, render(row), right? }]
 */
export default function CrudPage({ title, singular, desc, icon, path, keyField = 'id', fields, columns, defaults = {}, emptyTitle, emptyText, rowActions, extraActions, onSaved, canDelete = () => true, readOnly = false }) {
  const { data, error, reload } = useApi(path);
  const [edit, setEdit] = useState(null);
  const [del, setDel] = useState(null);
  const [busy, setBusy] = useState(false);
  const name = singular || title.toLowerCase();
  const fem = /a$/.test(name);

  const visible = (f, values) => !(edit?.row && f.createOnly) && (!f.show || f.show(values));
  const open = (row) => setEdit({ row, values: row ? { ...row } : { ...defaults } });
  const set = (k, v) => setEdit((e) => ({ ...e, values: { ...e.values, [k]: v } }));

  const save = async () => {
    const body = {};
    for (const f of fields) {
      if (f.type === 'heading' || (edit.row && f.createOnly)) continue;
      let v = edit.values[f.name];
      if (f.type === 'number' || (f.type === 'select' && f.numeric)) v = v === '' || v == null ? null : Number(v);
      if (f.type === 'checkbox') v = !!v;
      if (f.type === 'datetime') v = v ? new Date(v).toISOString() : null;
      if (typeof v === 'string') v = v.trim();
      body[f.name] = v;
    }
    const missing = fields.find((f) => f.required && f.type !== 'heading' && visible(f, edit.values) && (body[f.name] == null || body[f.name] === ''));
    if (missing) return act(async () => { throw new Error(`Falta completar: ${missing.label}`); }).catch(() => {});
    setBusy(true);
    try {
      const row = await act(() => (edit.row ? api(`${path}/${encodeURIComponent(edit.row[keyField])}`, { method: 'PATCH', body }) : api(path, { method: 'POST', body })), edit.row ? 'Cambios guardados' : `${name[0].toUpperCase()}${name.slice(1)} ${fem ? 'creada' : 'creado'}`);
      setEdit(null);
      reload();
      onSaved?.(row);
    } catch {
      /* el aviso ya se mostró */
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    await act(() => api(`${path}/${encodeURIComponent(del[keyField])}`, { method: 'DELETE' }), 'Eliminado').catch(() => {});
    setDel(null);
    reload();
  };

  return (
    <div className="page">
      <PageHeader title={title} desc={desc} actions={<>{extraActions}{!readOnly && <button className="btn" onClick={() => open(null)}><Icon name="plus" size={16} />Nuevo</button>}</>} />
      {error && <div className="err-box">{error}</div>}
      {!data ? <Loading rows={5} /> : data.length === 0 ? (
        <div className="card"><Empty icon={icon} title={emptyTitle || `Todavía no hay ${title.toLowerCase()}`} action={!readOnly && <button className="btn" onClick={() => open(null)}><Icon name="plus" size={16} />Crear {name}</button>}>{emptyText}</Empty></div>
      ) : (
        <div className="card flush"><div className="tablewrap"><table className="table">
          <thead><tr>{columns.map((c) => <th key={c.label} className={c.right ? 'right' : ''}>{c.label}</th>)}<th /></tr></thead>
          <tbody>
            {data.map((row) => (
              <tr key={row[keyField]}>
                {columns.map((c) => <td key={c.label} className={c.right ? 'right' : ''}>{c.render(row)}</td>)}
                <td className="actions">
                  {rowActions?.(row, reload)}
                  {!readOnly && <button className="btn ghost icon sm" aria-label="Editar" data-tip="Editar" onClick={() => open(row)}><Icon name="edit" size={15} /></button>}
                  {!readOnly && canDelete(row) && <button className="btn ghost icon sm" aria-label="Eliminar" data-tip="Eliminar" onClick={() => setDel(row)}><Icon name="trash" size={15} /></button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div></div>
      )}

      {edit && (
        <Modal icon={edit.row ? 'edit' : (icon || 'plus')} subtitle={edit.row ? 'Los cambios se aplican al guardar.' : desc} title={edit.row ? `Editar ${name}` : `${fem ? 'Nueva' : 'Nuevo'} ${name}`} onClose={() => setEdit(null)}
          footer={<><button className="btn sec" data-close onClick={() => setEdit(null)}>Cancelar</button><button className="btn" disabled={busy} onClick={save}><Icon name={edit.row ? 'check' : 'plus'} size={16} />{edit.row ? 'Guardar' : 'Crear'}</button></>}>
          <div className="form-grid">
            {fields.map((f) => {
              if (!visible(f, edit.values)) return null;
              if (f.type === 'heading') return <div key={f.name} className="form-sec">{f.label}</div>;
              const v = edit.values[f.name] ?? '';
              const opts = typeof f.options === 'function' ? f.options() : f.options;
              if (f.type === 'checkbox') return <div key={f.name} className="field full"><Switch label={f.help || f.label} checked={!!v} onChange={(c) => set(f.name, c)} /></div>;
              return (
                <Field key={f.name} className={f.half ? '' : 'full'} label={f.label + (f.required ? '' : ' (opcional)')} hint={f.help}>
                  {f.type === 'textarea' ? (
                    <textarea rows={f.rows || 6} className={f.mono ? 'mono' : ''} value={typeof v === 'object' && v !== null ? JSON.stringify(v, null, 2) : v} placeholder={f.placeholder} onChange={(e) => set(f.name, e.target.value)} />
                  ) : f.type === 'chips' ? (
                    <div className="chips">
                      {(opts || []).map((o) => {
                        const on = (v || []).map(Number).includes(Number(o.value));
                        return <button type="button" key={o.value} className={'chip' + (on ? ' on' : '')} aria-pressed={on}
                          onClick={() => set(f.name, on ? (v || []).filter((x) => Number(x) !== Number(o.value)) : [...(v || []), Number(o.value)])}>{on && <Icon name="check" size={13} />}{o.label}</button>;
                      })}
                      {!(opts || []).length && <span className="subtle">No hay opciones todavía.</span>}
                    </div>
                  ) : f.type === 'select' ? (
                    <Select value={v ?? ''} onChange={(x) => set(f.name, x)} placeholder="Elegir…"
                      options={[...(f.required ? [] : [{ value: '', label: 'Ninguno' }]), ...(opts || [])]} />
                  ) : (
                    <input
                      type={f.type === 'number' ? 'number' : f.type === 'datetime' ? 'datetime-local' : f.type === 'email' ? 'email' : f.type === 'password' ? 'password' : 'text'}
                      inputMode={f.type === 'number' ? 'decimal' : undefined}
                      step={f.step || 'any'}
                      value={f.type === 'datetime' ? toLocalInput(v) : v}
                      placeholder={f.placeholder}
                      onChange={(e) => set(f.name, e.target.value)}
                    />
                  )}
                </Field>
              );
            })}
          </div>
        </Modal>
      )}

      {del && (
        <Modal icon="trash" tone="red" subtitle="Esta acción no se puede deshacer." title={`¿Eliminar ${name}?`} size="sm" onClose={() => setDel(null)}
          footer={<><button className="btn sec" data-close onClick={() => setDel(null)}>Cancelar</button><button className="btn danger" onClick={remove}><Icon name="trash" size={16} />Eliminar</button></>}>
          <p className="muted" style={{ margin: '0 0 6px' }}>No se puede deshacer.</p>
        </Modal>
      )}
    </div>
  );
}
