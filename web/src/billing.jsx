// Facturación electrónica: comprobantes mensuales por cuenta (e-Ticket / e-Factura) y configuración del emisor.
import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Field, PageHeader, Loading, Empty, Stat } from './components/ui.jsx';
import { Icon } from './components/icons.jsx';
import { api, money, dt } from './api.js';
import { useApi, act } from './hooks.js';

const thisMonth = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`; };
const prevMonth = () => { const n = new Date(); n.setDate(1); n.setMonth(n.getMonth() - 1); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`; };
const who = (unit, name) => (unit ? `${unit} · ${name}` : name);
const STATUS = { borrador: ['Borrador', 'gris'], emitida: ['Emitida', 'ok'], error: ['Con error', 'falla'], anulada: ['Anulada', 'gris'] };
const monthName = (p) => { const [y, m] = p.split('-'); return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('es-UY', { month: 'long', year: 'numeric' }); };
const num = (n, d = 3) => Number(n || 0).toLocaleString('es-UY', { maximumFractionDigits: d });

export function Invoices({ me }) {
  const [month, setMonth] = useState(prevMonth());
  const [siteId, setSiteId] = useState('');
  const [open, setOpen] = useState(null);
  const [cfgOpen, setCfgOpen] = useState(false);
  const sites = useApi('/sites').data || [];
  const qs = `month=${month}${siteId ? `&siteId=${siteId}` : ''}`;
  const { data, reload } = useApi(`/invoices?${qs}`);
  const settings = useApi('/settings');
  const cfg = settings.data?.facturacion;
  const canWrite = !['lectura', 'edificio'].includes(me?.level);
  const live = (data || []).filter((i) => i.status !== 'anulada');
  const t = useMemo(() => live.reduce((a, i) => ({ total: a.total + Number(i.total), iva: a.iva + Number(i.iva), pend: a.pend + (i.status === 'emitida' ? 0 : 1) }), { total: 0, iva: 0, pend: 0 }), [data]);
  const generate = () => act(() => api('/invoices/generate', { method: 'POST', body: { month, siteId: siteId || null } }), (r) => (r.created ? `${r.created} borradores creados` : 'No hay cuentas nuevas para facturar'))
    .then(reload).catch(() => {});
  const noProvider = cfg && (cfg.provider === 'ninguno' || !cfg.provider_url);
  return (
    <div className="page">
      <PageHeader title="Facturación" desc="Un comprobante por cuenta y por mes con la energía de cada franja. Se emite como e-Ticket a cédula o e-Factura a RUT."
        actions={<>
          {me?.level === 'admin' && <button className="btn sec" onClick={() => setCfgOpen(true)}><Icon name="settings" size={15} />Emisor y proveedor</button>}
          {canWrite && <button className="btn" onClick={generate}><Icon name="plus" size={15} />Generar borradores</button>}
        </>} />
      {noProvider && (
        <div className="note inv-note" style={{ marginBottom: 14 }}>
          <Icon name="alert" size={16} />
          <div><b>Todavía no hay proveedor de facturación electrónica.</b> Para emitir ante DGI hace falta un proveedor habilitado de CFE (por ejemplo el que ya usa Infratec). Mientras tanto podés preparar los borradores, imprimirlos y registrar a mano el número que te da el sistema de facturación.</div>
        </div>
      )}
      <div className="row wrap" style={{ gap: 12, marginBottom: 14, alignItems: 'end' }}>
        <Field label="Mes"><input type="month" value={month} max={thisMonth()} onChange={(e) => setMonth(e.target.value)} /></Field>
        <Field label="Sitio"><select value={siteId} onChange={(e) => setSiteId(e.target.value)}><option value="">Todos</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
      </div>
      {data && live.length > 0 && (
        <div className="stats" style={{ marginBottom: 16 }}>
          <Stat icon="ticket" label="Comprobantes" value={live.length} />
          <Stat icon="dollar" label="Total facturado" value={money(t.total)} />
          <Stat icon="file" label="IVA incluido" value={money(t.iva)} />
          <Stat icon="clock" label="Sin emitir" value={t.pend} tone={t.pend ? 'warn' : undefined} />
        </div>
      )}
      {!data ? <Loading rows={5} /> : data.length === 0 ? (
        <Empty icon="ticket" title={`Sin comprobantes de ${monthName(month)}`} action={canWrite && <button className="btn" onClick={generate}>Generar borradores</button>}>
          Se arma uno por cada cuenta que cargó en el mes. Revisá antes que las cuentas tengan cédula o RUT.
        </Empty>
      ) : (
        <div className="card flush"><div className="tablewrap"><table className="table">
          <thead><tr><th>Cuenta</th><th>Tipo</th><th>Documento</th><th>Estado</th><th className="right">Neto</th><th className="right">Total</th><th /></tr></thead>
          <tbody>{data.map((i) => {
            const [label, tone] = STATUS[i.status] || [i.status, 'gris'];
            return (
              <tr key={i.id} className={i.status === 'anulada' ? 'dim' : ''} style={{ cursor: 'pointer' }} onClick={() => setOpen(i.id)}>
                <td><b>{who(i.unit, i.account)}</b><div className="subtle" style={{ fontSize: 12 }}>{i.site || 'Sin sitio'}</div></td>
                <td>{i.cfe_type}{i.number && <div className="subtle mono" style={{ fontSize: 12 }}>{i.series ? `${i.series}-` : ''}{i.number}</div>}</td>
                <td>{i.receiver?.doc_number ? <span className="mono">{i.receiver.doc_type} {i.receiver.doc_number}</span> : <span className="badge mini warn" data-tip="Cargalo en la cuenta para emitir"><span className="dot" />Sin documento</span>}</td>
                <td><span className={`badge mini ${tone}`} data-tip={i.provider_msg || ''}><span className="dot" />{label}</span></td>
                <td className="right num">{money(i.net)}</td>
                <td className="right num" style={{ fontWeight: 600 }}>{money(i.total)}</td>
                <td className="actions"><button className="btn ghost icon sm" aria-label="Ver" data-tip="Ver comprobante"><Icon name="chevronRight" size={15} /></button></td>
              </tr>
            );
          })}</tbody>
        </table></div></div>
      )}
      {open && <InvoiceSheet id={open} canWrite={canWrite} onClose={() => setOpen(null)} onChange={reload} />}
      {cfgOpen && cfg && <BillingSettings cfg={cfg} onClose={() => setCfgOpen(false)} onSaved={() => { settings.reload(); setCfgOpen(false); }} />}
    </div>
  );
}

function InvoiceSheet({ id, canWrite, onClose, onChange }) {
  const { data, reload } = useApi(`/invoices/${id}`);
  const [manual, setManual] = useState(null);
  const done = () => { reload(); onChange(); };
  const emit = () => act(() => api(`/invoices/${id}/issue`, { method: 'POST', body: {} }), 'Comprobante emitido').then(done).catch(done);
  const saveManual = () => act(() => api(`/invoices/${id}/issue`, { method: 'POST', body: { manual: true, ...manual } }), 'Número registrado').then(() => { setManual(null); done(); }).catch(() => {});
  const cancel = () => act(() => api(`/invoices/${id}/cancel`, { method: 'POST' }), 'Comprobante anulado').then(done).catch(() => {});
  const print = () => { document.body.classList.add('printing-inv'); window.print(); setTimeout(() => document.body.classList.remove('printing-inv'), 500); };
  if (!data) return <Modal icon="ticket" tone="blue" title="Comprobante" size="lg" onClose={onClose}><Loading rows={4} /></Modal>;
  const [label, tone] = STATUS[data.status] || [data.status, 'gris'];
  const open = data.status === 'borrador' || data.status === 'error';
  const e = data.emisor || {};
  return (
    <Modal icon="ticket" tone={data.status === 'emitida' ? 'green' : data.status === 'error' ? 'red' : 'blue'} size="lg" onClose={onClose}
      title={`${data.cfe_type} · ${who(data.unit, data.account)}`} subtitle={`${monthName(data.period)} · ${label}`}
      footer={<>
        <button className="btn sec" onClick={print}><Icon name="printer" size={15} />Imprimir</button>
        {data.pdf_url && <a className="btn sec" href={data.pdf_url} target="_blank" rel="noreferrer"><Icon name="external" size={15} />PDF del proveedor</a>}
        <span className="grow" />
        {canWrite && open && <button className="btn ghost danger-text" onClick={cancel} data-tip="Lo descarta; al regenerar se arma de nuevo">Anular</button>}
        {canWrite && open && <button className="btn sec" onClick={() => setManual({ series: '', number: '' })}>Registrar número</button>}
        {canWrite && open && <button className="btn" onClick={emit}><Icon name="check" size={15} />Emitir</button>}
      </>}>
      {data.status === 'error' && <div className="note inv-note" style={{ marginBottom: 14 }}><Icon name="alert" size={16} /><div>{data.provider_msg}</div></div>}
      {manual && (
        <div className="card" style={{ marginBottom: 16, boxShadow: 'none', border: '0.5px solid var(--sep)' }}>
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>Si lo emitiste en otro sistema, anotá la serie y el número para dejarlo como emitido.</p>
          <div className="form-grid" style={{ gridTemplateColumns: '90px 1fr auto auto', alignItems: 'end' }}>
            <Field label="Serie"><input value={manual.series} onChange={(ev) => setManual({ ...manual, series: ev.target.value.toUpperCase() })} placeholder="A" /></Field>
            <Field label="Número"><input value={manual.number} onChange={(ev) => setManual({ ...manual, number: ev.target.value })} placeholder="1234" autoFocus /></Field>
            <div className="field"><button className="btn ghost" onClick={() => setManual(null)}>Cancelar</button></div>
            <div className="field"><button className="btn" disabled={!manual.number} onClick={saveManual}>Guardar</button></div>
          </div>
        </div>
      )}
      <article className="inv-doc inv-print">
        <header className="inv-head">
          <div>
            <b className="inv-em">{e.emisor_nombre || 'Emisor sin configurar'}</b>
            <div className="subtle">{e.emisor_rut ? `RUT ${e.emisor_rut}` : 'RUT —'}</div>
            <div className="subtle">{e.emisor_domicilio}</div>
          </div>
          <div className="inv-type">
            <div className="inv-kind">{data.cfe_type}</div>
            <div className="mono">{data.number ? `${data.series ? `${data.series}-` : ''}${data.number}` : 'Sin número'}</div>
            <div className="subtle">{data.issued_at ? dt(data.issued_at) : 'Borrador'}</div>
          </div>
        </header>
        <dl className="kv inv-kv">
          <dt>Receptor</dt><dd>{data.receiver?.name}{data.receiver?.unit ? ` · ${data.receiver.unit}` : ''}</dd>
          <dt>Documento</dt><dd>{data.receiver?.doc_number ? `${data.receiver.doc_type} ${data.receiver.doc_number}` : <span className="danger-text">Sin documento cargado</span>}</dd>
          {data.receiver?.address && <><dt>Domicilio</dt><dd>{data.receiver.address}</dd></>}
          <dt>Período</dt><dd>{(() => { const s = monthName(data.period); return s[0].toUpperCase() + s.slice(1); })()}</dd>
        </dl>
        <table className="table inv-lines">
          <thead><tr><th>Detalle</th><th className="right">Cantidad</th><th className="right">Precio unit.</th><th className="right">Neto</th></tr></thead>
          <tbody>{(data.lines || []).map((l, k) => (
            <tr key={k}><td>{l.description}</td><td className="right num">{num(l.quantity)} {l.unit}</td><td className="right num">{money(l.unit_price)}</td><td className="right num">{money(l.net)}</td></tr>
          ))}</tbody>
        </table>
        <div className="inv-tot">
          <div><span>Subtotal neto</span><b className="num">{money(data.net)}</b></div>
          <div><span>IVA {num(data.iva_rate, 2)}%</span><b className="num">{money(data.iva)}</b></div>
          <div className="big"><span>Total {data.currency}</span><b className="num">{money(data.total, data.currency)}</b></div>
        </div>
      </article>
    </Modal>
  );
}

function BillingSettings({ cfg, onClose, onSaved }) {
  const [v, setV] = useState(cfg);
  useEffect(() => setV(cfg), [cfg]);
  const set = (k) => (ev) => setV({ ...v, [k]: ev.target.type === 'checkbox' ? ev.target.checked : ev.target.value });
  const save = () => act(() => api('/settings/facturacion', { method: 'PUT', body: { ...v, iva_rate: Number(v.iva_rate) } }), 'Configuración guardada').then(onSaved).catch(() => {});
  return (
    <Modal icon="settings" title="Emisor y proveedor" subtitle="Datos que salen en cada comprobante" onClose={onClose}
      footer={<><button className="btn ghost" data-close onClick={onClose}>Cancelar</button><button className="btn" onClick={save}>Guardar</button></>}>
      <div className="form-grid">
        <div className="form-sec">Emisor</div>
        <Field className="full" label="Razón social"><input value={v.emisor_nombre || ''} onChange={set('emisor_nombre')} placeholder="Infratec S.A.S." /></Field>
        <Field label="RUT"><input value={v.emisor_rut || ''} onChange={set('emisor_rut')} placeholder="21 123456 0012" /></Field>
        <Field label="Domicilio fiscal"><input value={v.emisor_domicilio || ''} onChange={set('emisor_domicilio')} /></Field>
        <div className="form-sec">Impuestos</div>
        <Field label="Tasa de IVA (%)"><input type="number" step="0.01" value={v.iva_rate ?? 22} onChange={set('iva_rate')} /></Field>
        <div className="field"><label className="switch-row"><span>Las tarifas ya incluyen IVA</span><input type="checkbox" checked={v.prices_include_iva !== false} onChange={set('prices_include_iva')} /></label></div>
        <div className="form-sec">Proveedor de CFE</div>
        <Field className="full" label="Proveedor" hint="El proveedor habilitado por DGI firma y envía el comprobante.">
          <select value={v.provider || 'ninguno'} onChange={set('provider')}><option value="ninguno">Ninguno: registro el número a mano</option><option value="api">Conectado por API</option></select>
        </Field>
        {v.provider === 'api' && <>
          <Field className="full" label="Dirección de la API" hint="Recibe el comprobante en JSON con un POST y devuelve serie, número y PDF."><input value={v.provider_url || ''} onChange={set('provider_url')} placeholder="https://…/api/cfe" /></Field>
          <Field className="full" label="Token"><input type="password" value={v.provider_token || ''} onChange={set('provider_token')} autoComplete="off" /></Field>
        </>}
      </div>
    </Modal>
  );
}
