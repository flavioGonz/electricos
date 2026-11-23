import React, { useState } from 'react';
import { Modal, Field, PageHeader, Loading, Empty } from './components/ui.jsx';
import { Icon } from './components/icons.jsx';
import { api } from './api.js';
import { useApi, act } from './hooks.js';

/**
 * Página genérica de alta/edición/baja.
 * fields: [{ name, label, type: 'text'|'number'|'select'|'checkbox'|'datetime', options?: [{value,label}] | () => [...], required?, placeholder?, help?, createOnly? }]
 * columns: [{ label, render: (row) => node }]
 */
export default function CrudPage({ title, desc, icon, path, keyField = 'id', fields, columns, defaults = {}, emptyText, rowActions, extraActions }) {
  const { data, error, reload } = useApi(path);
  const [edit, setEdit] = useState(null); // {row?, values}
  const [del, setDel] = useState(null);

  const open = (row) => setEdit({ row, values: row ? { ...row } : { ...defaults } });
  const save = async () => {
    const body = {};
    for (const f of fields) {
      if (edit.row && f.createOnly) continue;
      if (f.type === 'heading') continue;
      let v = edit.values[f.name];
      if (f.type === 'number') v = v === '' || v == null ? null : Number(v);
      if (f.type === 'select' && f.numeric) v = v === '' || v == null ? null : Number(v);
      if (f.type === 'checkbox') v = !!v;
      if (f.type === 'datetime') v = v ? new Date(v).toISOString() : null;
      body[f.name] = v;
    }
    const missing = fields.find((f) => f.required && (!f.show || f.show(edit.values)) && (body[f.name] == null || body[f.name] === '') && !(edit.row && f.createOnly));
    if (missing) return act(async () => { throw new Error(`Falta: ${missing.label}`); });
    await act(
      () => (edit.row ? api(`${path}/${encodeURIComponent(edit.row[keyField])}`, { method: 'PATCH', body }) : api(path, { method: 'POST', body })),
      'Guardado',
    );
    setEdit(null);
    reload();
  };
  const remove = async () => {
    await act(() => api(`${path}/${encodeURIComponent(del[keyField])}`, { method: 'DELETE' }), 'Eliminado');
    setDel(null);
    reload();
  };
  const set = (name, v) => setEdit((e) => ({ ...e, values: { ...e.values, [name]: v } }));

  return (
    <div>
      <PageHeader
        title={title}
        desc={desc}
        icon={icon}
        actions={<>{extraActions}<button className="btn" onClick={() => open(null)}><Icon name="plus" size={17} />Nuevo</button></>}
      />
      {error && <div className="err-box">{error}</div>}
      {!data ? (
        <Loading rows={5} />
      ) : data.length === 0 ? (
        <Empty icon={icon} title="Todavía no hay nada" action={<button className="btn" onClick={() => open(null)}><Icon name="plus" size={17} />Crear el primero</button>}>
          {emptyText}
        </Empty>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div className="tablewrap">
            <table className="table">
              <thead>
                <tr>
                  {columns.map((c) => <th key={c.label}>{c.label}</th>)}
                  <th style={{ width: 1 }}></th>
                </tr>
              </thead>
              <tbody>
                {data.map((row) => (
                  <tr key={row[keyField]}>
                    {columns.map((c) => <td key={c.label}>{c.render(row)}</td>)}
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {rowActions?.(row, reload)}
                      <button className="btn ghost icon sm" aria-label="Editar" data-tip="Editar" onClick={() => open(row)}><Icon name="edit" size={15} /></button>
                      <button className="btn ghost icon sm" aria-label="Eliminar" data-tip="Eliminar" onClick={() => setDel(row)}><Icon name="trash" size={15} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {edit && (
        <Modal
          title={edit.row ? `Editar ${title.toLowerCase()}` : `Nuevo: ${title.toLowerCase()}`}
          onClose={() => setEdit(null)}
          footer={<><button className="btn sec" onClick={() => setEdit(null)}>Cancelar</button><button className="btn" onClick={save}><Icon name="save" size={16} />Guardar</button></>}
        >
          {fields.map((f) => {
            if (edit.row && f.createOnly) return null;
            if (f.show && !f.show(edit.values)) return null;
            if (f.type === 'heading') return <h4 key={f.name} style={{ margin: '18px 0 8px' }}>{f.label}</h4>;
            const v = edit.values[f.name] ?? '';
            const opts = typeof f.options === 'function' ? f.options() : f.options;
            return (
              <Field key={f.name} label={f.label + (f.required ? ' *' : '')}>
                {f.type === 'select' ? (
                  <select value={v ?? ''} onChange={(e) => set(f.name, e.target.value)}>
                    {!f.required && <option value="">—</option>}
                    {(opts || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                ) : f.type === 'checkbox' ? (
                  <label className="row" style={{ gap: 8 }}><input type="checkbox" style={{ width: 'auto' }} checked={!!v} onChange={(e) => set(f.name, e.target.checked)} />{f.help}</label>
                ) : (
                  <input
                    type={f.type === 'number' ? 'number' : f.type === 'datetime' ? 'datetime-local' : 'text'}
                    step={f.step || 'any'}
                    value={f.type === 'datetime' && v ? new Date(v).toISOString().slice(0, 16) : v}
                    placeholder={f.placeholder}
                    onChange={(e) => set(f.name, e.target.value)}
                  />
                )}
                {f.help && f.type !== 'checkbox' && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{f.help}</div>}
              </Field>
            );
          })}
        </Modal>
      )}

      {del && (
        <Modal
          title="¿Eliminar?"
          size="sm"
          onClose={() => setDel(null)}
          footer={<><button className="btn sec" onClick={() => setDel(null)}>Cancelar</button><button className="btn danger" onClick={remove}><Icon name="trash" size={15} />Eliminar</button></>}
        >
          <p className="muted">Esta acción no se puede deshacer.</p>
        </Modal>
      )}
    </div>
  );
}
