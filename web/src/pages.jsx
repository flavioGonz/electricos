import React, { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { Modal, Field, PageHeader, Stat, Loading, Empty, Switch, Segmented } from './components/ui.jsx';
import { Icon } from './components/icons.jsx';
import CrudPage from './Crud.jsx';
import { api, money, kwh, dt, ago } from './api.js';
import { useApi, act } from './hooks.js';

const STATUS = {
  Available: ['ok', 'Disponible'],
  Preparing: ['info', 'Preparando'],
  Charging: ['info', 'Cargando'],
  SuspendedEV: ['warn', 'Pausado por el auto'],
  SuspendedEVSE: ['warn', 'Pausado por el cargador'],
  Finishing: ['info', 'Terminando'],
  Reserved: ['warn', 'Reservado'],
  Unavailable: ['gris', 'No disponible'],
  Faulted: ['falla', 'En falla'],
  Unknown: ['gris', 'Sin datos'],
};
export const StatusBadge = ({ s }) => {
  const [tone, label] = STATUS[s] || ['gris', s];
  return <span className={'badge mini ' + tone + (s === 'Charging' ? ' live' : '')}><span className="dot" />{label}</span>;
};
const Conn = ({ on }) => <span className={'badge mini ' + (on ? 'ok' : 'gris')}><span className="dot" />{on ? 'En línea' : 'Sin conexión'}</span>;
const thisMonth = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`; };
const who = (unit, name) => (unit ? `${unit} · ${name}` : name);
async function downloadCsv(path, filename) {
  const res = await api(path, { raw: true });
  if (!res.ok) throw new Error('No se pudo descargar');
  const url = URL.createObjectURL(await res.blob());
  Object.assign(document.createElement('a'), { href: url, download: filename }).click();
  URL.revokeObjectURL(url);
}

// ---------- Panel ----------
export function Dashboard({ go }) {
  const { data } = useApi('/dashboard', { live: true });
  const chargers = useApi('/chargers', { live: true });
  const active = (chargers.data || []).flatMap((c) => c.active_sessions.map((s) => ({ ...s, charger: c.name || c.id })));
  return (
    <div className="page">
      <PageHeader title="Panel" desc="La red de carga en este momento." />
      {!data ? <Loading rows={2} /> : (
        <>
          <div className="stats">
            <Stat icon="bolt" label="Cargando ahora" value={data.sessions_active} />
            <Stat icon="plug" label="Cargadores en línea" value={`${data.chargers_online} de ${data.chargers}`} tone={data.chargers_online < data.chargers ? 'warn' : ''} />
            <Stat icon="power" label="Energía del mes" value={kwh(data.month_energy_wh)} />
            <Stat icon="dollar" label="Cobrado del mes" value={money(data.month_amount)} />
            <Stat icon="star" label="Margen del mes" value={money(data.month_margin)} />
          </div>
          <div className="list" style={{ marginTop: 14 }}>
            {data.alerts_open > 0 && <div className="note click" onClick={() => go('/alertas')}><Icon name="alert" size={17} />{data.alerts_open === 1 ? 'Hay una alerta abierta' : `Hay ${data.alerts_open} alertas abiertas`}<span className="grow" /><Icon name="chevronRight" size={16} /></div>}
            {data.chargers_pending > 0 && <div className="note click" onClick={() => go('/cargadores')}><Icon name="plug" size={17} />{data.chargers_pending === 1 ? 'Un cargador nuevo espera aprobación' : `${data.chargers_pending} cargadores nuevos esperan aprobación`}<span className="grow" /><Icon name="chevronRight" size={16} /></div>}
          </div>
        </>
      )}
      <h3 style={{ margin: '30px 0 12px' }}>Cargas en curso</h3>
      {active.length === 0 ? <div className="card muted">Nadie está cargando en este momento.</div> : (
        <div className="card flush"><div className="tablewrap"><table className="table">
          <thead><tr><th>Cargador</th><th>Cuenta</th><th>Desde</th><th className="right">Energía</th><th className="right">Potencia</th></tr></thead>
          <tbody>{active.map((s) => (
            <tr key={s.id}><td><b>{s.charger}</b></td><td>{s.account || <span className="mono">{s.id_tag}</span>}</td><td>{ago(s.started_at)}</td>
              <td className="right kwh">{kwh(s.energy_wh)}</td><td className="right kwh">{s.power_w ? `${(s.power_w / 1000).toFixed(1)} kW` : '—'}</td></tr>
          ))}</tbody>
        </table></div></div>
      )}
    </div>
  );
}

// ---------- QR del cargador ----------
function QrSheet({ charger, onClose }) {
  const url = `${window.location.origin}/c/${encodeURIComponent(charger.id)}`;
  const [svg, setSvg] = useState('');
  useEffect(() => { QRCode.toString(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#1d1d1f', light: '#ffffff' } }).then(setSvg); }, [url]);
  return (
    <Modal icon="qr" title="Cartel con QR" subtitle="Imprimilo y pegalo junto al cargador." size="sm" onClose={onClose}
      footer={<><a className="btn sec" href={url} target="_blank" rel="noreferrer">Abrir enlace</a><button className="btn" onClick={() => window.print()}><Icon name="printer" size={16} />Imprimir</button></>}>
      <div className="qr-print">
        <div className="qr-sign">
          <img src="/infratec-logo.svg" alt="INFRATEC." style={{ height: 14 }} />
          <h2 style={{ marginTop: 16 }}>{charger.name || charger.id}</h2>
          <div className="muted">{charger.site_name || ''}</div>
          <div className="qr" dangerouslySetInnerHTML={{ __html: svg }} />
          <div style={{ fontWeight: 600 }}>Escaneá para cargar y pagar</div>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>{url.replace(/^https?:\/\//, '')}</div>
        </div>
      </div>
    </Modal>
  );
}

// ---------- Cargadores ----------
export function Chargers() {
  const { data, reload } = useApi('/chargers', { live: true });
  const sites = useApi('/sites').data || [];
  const accounts = useApi('/accounts').data || [];
  const [edit, setEdit] = useState(null);
  const [remote, setRemote] = useState(null);
  const [log, setLog] = useState(null);
  const [qr, setQr] = useState(null);
  const wsUrl = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ocpp/`;

  const save = async () => {
    const v = edit;
    await act(() => api(`/chargers/${encodeURIComponent(v.id)}`, { method: 'PATCH', body: {
      name: v.name || '', site_id: v.site_id ? Number(v.site_id) : null, approved: !!v.approved, max_amps: Number(v.max_amps) || 32,
      owner_account_id: v.owner_account_id ? Number(v.owner_account_id) : null,
    } }), 'Cargador actualizado').then(() => { setEdit(null); reload(); }).catch(() => {});
  };
  const cmd = (c, action, body, msg) => act(() => api(`/chargers/${encodeURIComponent(c.id)}/${action}`, { method: 'POST', body: body || {} }), msg).then(reload).catch(() => {});

  return (
    <div className="page">
      <PageHeader title="Cargadores" desc={<>Configurá cada equipo con OCPP 1.6J y el servidor <span className="mono">{wsUrl}</span>. Al conectarse aparece acá para aprobarlo.</>} />
      {!data ? <Loading rows={3} /> : data.length === 0 ? (
        <div className="card"><Empty icon="plug" title="Ningún cargador se conectó todavía">Cargá la dirección de arriba en la configuración OCPP del equipo, con un identificador único como su número de serie.</Empty></div>
      ) : (
        <div className="grid-chargers">
          {data.map((c) => (
            <div key={c.id} className="card charger-card">
              <div className="row between" style={{ alignItems: 'flex-start' }}>
                <div className="grow"><div className="title">{c.name || c.id}</div><div className="meta mono">{c.id}</div></div>
                {c.approved ? <Conn on={c.connected} /> : <span className="badge mini warn"><span className="dot" />Por aprobar</span>}
              </div>
              <div className="meta">
                {c.site_name || 'Sin sitio asignado'} · {c.vendor ? `${c.vendor} ${c.model || ''}` : 'Modelo desconocido'} · {c.max_amps} A<br />
                {c.owner_name ? `Exclusivo de ${c.owner_name}` : 'Compartido'} · señal {ago(c.last_seen)}
              </div>
              <div className="row wrap">{c.connectors.filter((k) => k.connector_id > 0).map((k) => <StatusBadge key={k.connector_id} s={k.status} />)}</div>
              {c.active_sessions.map((s) => (
                <div key={s.id} className="live"><b>{kwh(s.energy_wh)}</b><span>{s.power_w ? `${(s.power_w / 1000).toFixed(1)} kW · ` : ''}{s.account || s.id_tag}</span></div>
              ))}
              <div className="acts">
                {!c.approved ? <button className="btn sm" onClick={() => setEdit({ ...c, approved: true })}>Aprobar</button> : <button className="btn sec sm" onClick={() => setEdit({ ...c })}>Configurar</button>}
                {c.connected && c.approved && c.active_sessions.length === 0 && <button className="btn sec sm" onClick={() => setRemote({ c, idTag: '', connectorId: 1 })}>Iniciar carga</button>}
                {c.connected && c.active_sessions.length > 0 && <button className="btn danger sm" onClick={() => cmd(c, 'remote-stop', {}, 'Se pidió detener la carga')}>Detener</button>}
                {c.approved && <button className="btn ghost icon sm" aria-label="QR" data-tip="Cartel con QR" onClick={() => setQr(c)}><Icon name="qr" size={15} /></button>}
                {c.connected && <button className="btn ghost icon sm" aria-label="Sincronizar tarjetas" data-tip="Enviar tarjetas para cargar sin internet" onClick={() => cmd(c, 'local-list', {}, 'Tarjetas enviadas al cargador')}><Icon name="card" size={15} /></button>}
                {c.connected && <button className="btn ghost icon sm" aria-label="Reiniciar" data-tip="Reiniciar" onClick={() => cmd(c, 'reset', { type: 'Soft' }, 'Reinicio enviado')}><Icon name="repeat" size={15} /></button>}
                <button className="btn ghost icon sm" aria-label="Mensajes" data-tip="Mensajes OCPP" onClick={() => api(`/chargers/${encodeURIComponent(c.id)}/log`).then(setLog)}><Icon name="list" size={15} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {edit && (
        <Modal icon="settings" title={edit.name || edit.id} subtitle={edit.approved && !data.find((c) => c.id === edit.id)?.approved ? 'Completá los datos para aprobarlo.' : `Identificador ${edit.id}`} onClose={() => setEdit(null)}
          footer={<><button className="btn sec" data-close onClick={() => setEdit(null)}>Cancelar</button><button className="btn" onClick={save}>Guardar</button></>}>
          <div className="form-grid">
            <Field className="full" label="Nombre"><input value={edit.name || ''} placeholder="Cochera 12" onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Sitio"><select value={edit.site_id || ''} onChange={(e) => setEdit({ ...edit, site_id: e.target.value })}><option value="">—</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
            <Field label="Corriente máxima (A)"><input type="number" value={edit.max_amps} onChange={(e) => setEdit({ ...edit, max_amps: e.target.value })} /></Field>
            <Field className="full" label="Uso" hint="Exclusivo: solo las tarjetas de esa cuenta pueden cargar."><select value={edit.owner_account_id || ''} onChange={(e) => setEdit({ ...edit, owner_account_id: e.target.value })}><option value="">Compartido entre las cuentas del sitio</option>{accounts.map((a) => <option key={a.id} value={a.id}>Exclusivo de {who(a.unit, a.name)}</option>)}</select></Field>
            <div className="field full"><Switch label="Aprobado para autorizar cargas" checked={edit.approved} onChange={(v) => setEdit({ ...edit, approved: v })} /></div>
          </div>
        </Modal>
      )}
      {remote && (
        <Modal icon="bolt" tone="green" title={`Iniciar carga en ${remote.c.name || remote.c.id}`} size="sm" onClose={() => setRemote(null)}
          footer={<><button className="btn sec" data-close onClick={() => setRemote(null)}>Cancelar</button><button className="btn" onClick={() => cmd(remote.c, 'remote-start', { idTag: remote.idTag, connectorId: remote.connectorId }, 'Se pidió iniciar la carga').then(() => setRemote(null))}>Iniciar</button></>}>
          <Field label="Tarjeta (UID)" hint="La carga se cobra a la cuenta de esta tarjeta."><input value={remote.idTag} placeholder="04A1B2C3" onChange={(e) => setRemote({ ...remote, idTag: e.target.value })} /></Field>
          <Field label="Conector"><input type="number" value={remote.connectorId} onChange={(e) => setRemote({ ...remote, connectorId: e.target.value })} /></Field>
        </Modal>
      )}
      {qr && <QrSheet charger={qr} onClose={() => setQr(null)} />}
      {log && (
        <Modal icon="list" tone="blue" title="Mensajes OCPP" subtitle="Los últimos 200, del más nuevo al más viejo." size="wide" onClose={() => setLog(null)}>
          <div className="tablewrap" style={{ maxHeight: '62vh' }}><table className="table">
            <thead><tr><th>Hora</th><th /><th>Mensaje</th><th>Datos</th></tr></thead>
            <tbody>{log.map((m) => <tr key={m.id}><td style={{ whiteSpace: 'nowrap' }}>{dt(m.ts)}</td><td className="subtle">{m.direction === 'in' ? 'Recibido' : 'Enviado'}</td><td><b>{m.action}</b></td><td className="mono" style={{ maxWidth: 460, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{JSON.stringify(m.payload)}</td></tr>)}</tbody>
          </table></div>
        </Modal>
      )}
    </div>
  );
}

// ---------- Tarifas ----------
const fr = (v) => (v.mode || 'franjas') === 'franjas';
const sp = (v) => !fr(v);
const bandCell = (r, b) => (
  <><b>{money(Number(r['cost_' + b] || 0) + Number(r['margin_' + b] || 0), r.currency)}</b><div className="subtle" style={{ fontSize: 12 }}>{money(r['cost_' + b], r.currency)} + {money(r['margin_' + b], r.currency)}</div></>
);
export function Tariffs() {
  return (
    <CrudPage title="Tarifas" singular="tarifa" icon="dollar" path="/tariffs" desc="El usuario paga el costo de la energía de UTE más el margen de cada franja horaria."
      defaults={{ currency: 'UYU', session_fee: 0, mode: 'franjas', punta_start_hour: 17, punta_end_hour: 23, valle_start_hour: 0, valle_end_hour: 7, punta_weekdays_only: true, margin_punta: 1, margin_llano: 1, margin_valle: 1.5 }}
      emptyText="Creá una tarifa y asignala a un sitio o a una cuenta."
      fields={[
        { name: 'name', label: 'Nombre', required: true, placeholder: 'Triple horario edificio' },
        { name: 'mode', label: 'Cómo se calcula', type: 'select', required: true, half: true, options: [{ value: 'franjas', label: 'Costo UTE + margen por franja' }, { value: 'simple', label: 'Precio fijo por kWh' }] },
        { name: 'currency', label: 'Moneda', type: 'select', required: true, half: true, options: [{ value: 'UYU', label: 'Pesos' }, { value: 'USD', label: 'Dólares' }] },
        { name: 'h1', type: 'heading', label: 'Horarios de UTE', show: fr },
        { name: 'punta_start_hour', label: 'Punta desde', type: 'number', step: 1, half: true, show: fr, required: true },
        { name: 'punta_end_hour', label: 'Punta hasta', type: 'number', step: 1, half: true, show: fr, required: true },
        { name: 'valle_start_hour', label: 'Valle desde', type: 'number', step: 1, half: true, show: fr, required: true },
        { name: 'valle_end_hour', label: 'Valle hasta', type: 'number', step: 1, half: true, show: fr, required: true },
        { name: 'punta_weekdays_only', type: 'checkbox', help: 'Punta solo de lunes a viernes', show: fr },
        { name: 'h2', type: 'heading', label: 'Costo de la energía por kWh', show: fr },
        { name: 'cost_punta', label: 'Punta', type: 'number', half: true, show: fr, required: true },
        { name: 'cost_llano', label: 'Llano', type: 'number', half: true, show: fr, required: true },
        { name: 'cost_valle', label: 'Valle', type: 'number', half: true, show: fr, required: true },
        { name: 'h3', type: 'heading', label: 'Margen por kWh', show: fr },
        { name: 'margin_punta', label: 'Punta', type: 'number', half: true, show: fr, required: true },
        { name: 'margin_llano', label: 'Llano', type: 'number', half: true, show: fr, required: true },
        { name: 'margin_valle', label: 'Valle', type: 'number', half: true, show: fr, required: true, help: 'Más margen en valle sigue siendo más barato que cargar en punta.' },
        { name: 'price_kwh', label: 'Precio por kWh', type: 'number', half: true, show: sp, required: true },
        { name: 'energy_cost_kwh', label: 'Costo de energía por kWh', type: 'number', half: true, show: sp, help: 'Separa costo y margen en la liquidación.' },
        { name: 'offpeak_price_kwh', label: 'Precio nocturno por kWh', type: 'number', show: sp },
        { name: 'offpeak_start_hour', label: 'Nocturno desde', type: 'number', step: 1, half: true, show: sp },
        { name: 'offpeak_end_hour', label: 'Nocturno hasta', type: 'number', step: 1, half: true, show: sp },
        { name: 'h4', type: 'heading', label: 'Otros cargos' },
        { name: 'session_fee', label: 'Cargo fijo por carga', type: 'number' },
      ]}
      columns={[
        { label: 'Tarifa', render: (r) => <><b>{r.name}</b><div className="subtle" style={{ fontSize: 12 }}>{r.mode === 'franjas' ? `Punta ${r.punta_start_hour} a ${r.punta_end_hour} h${r.punta_weekdays_only ? ' (lun a vie)' : ''} · valle ${r.valle_start_hour} a ${r.valle_end_hour} h` : 'Precio fijo'}</div></> },
        { label: 'Punta', render: (r) => (r.mode === 'franjas' ? bandCell(r, 'punta') : '—') },
        { label: 'Llano', render: (r) => (r.mode === 'franjas' ? bandCell(r, 'llano') : <b>{money(r.price_kwh, r.currency)}</b>) },
        { label: 'Valle', render: (r) => (r.mode === 'franjas' ? bandCell(r, 'valle') : r.offpeak_price_kwh != null ? <b>{money(r.offpeak_price_kwh, r.currency)}</b> : '—') },
      ]}
    />
  );
}

// ---------- Sitios ----------
export function Sites() {
  const tariffs = useApi('/tariffs').data || [];
  const client = (v) => (v.line_owner || 'cliente') === 'cliente';
  return (
    <CrudPage title="Sitios" singular="sitio" icon="building" path="/sites" desc="Cada edificio o barrio define su tarifa, el límite de potencia y a quién se le liquida la energía."
      defaults={{ kind: 'edificio', line_owner: 'cliente' }}
      emptyText="Un sitio agrupa cargadores y cuentas."
      fields={[
        { name: 'name', label: 'Nombre', required: true, placeholder: 'Edificio Rambla' },
        { name: 'kind', label: 'Tipo', type: 'select', required: true, half: true, options: [{ value: 'edificio', label: 'Edificio' }, { value: 'barrio', label: 'Barrio' }, { value: 'otro', label: 'Otro' }] },
        { name: 'tariff_id', label: 'Tarifa', type: 'select', numeric: true, half: true, options: () => tariffs.map((t) => ({ value: t.id, label: t.name })) },
        { name: 'address', label: 'Dirección' },
        { name: 'max_amps', label: 'Límite de corriente total (A)', type: 'number', step: 1, help: 'Se reparte entre las cargas activas para no superar la potencia contratada.' },
        { name: 'hs', type: 'heading', label: 'Suministro de UTE' },
        { name: 'line_owner', label: 'Titular', type: 'select', required: true, options: [{ value: 'cliente', label: 'El cliente: se le liquida el costo de la energía' }, { value: 'operador', label: 'Infratec: paga la factura de UTE' }] },
        { name: 'owner_name', label: 'Propietario de la línea', placeholder: 'Consorcio Edificio Rambla', half: true, show: client },
        { name: 'owner_contact', label: 'Contacto', placeholder: 'administracion@…', half: true, show: client },
      ]}
      columns={[
        { label: 'Sitio', render: (r) => <><b>{r.name}</b><div className="subtle" style={{ fontSize: 12 }}>{r.address || r.kind}</div></> },
        { label: 'Tarifa', render: (r) => r.tariff_name || <span className="subtle">Sin tarifa</span> },
        { label: 'Límite', render: (r) => (r.max_amps ? `${r.max_amps} A` : '—') },
        { label: 'Suministro', render: (r) => (r.line_owner === 'cliente' ? r.owner_name || 'Cliente' : 'Infratec') },
        { label: 'Cargadores', right: true, render: (r) => r.chargers },
        { label: 'Cuentas', right: true, render: (r) => r.accounts },
      ]}
    />
  );
}

// ---------- Cuentas ----------
export function Accounts() {
  const sites = useApi('/sites').data || [];
  const tariffs = useApi('/tariffs').data || [];
  const [mov, setMov] = useState(null);
  return (
    <>
      <CrudPage title="Cuentas" singular="cuenta" icon="users" path="/accounts" desc="Unidades, familias o empresas. Todo lo que cargan sus tarjetas y usuarios de la app se suma acá."
        defaults={{ billing_mode: 'postpaid', credit_limit: 0, active: true }}
        emptyText="Creá una cuenta por unidad y asignale tarjetas."
        fields={[
          { name: 'name', label: 'Nombre', required: true, placeholder: 'Familia Pérez' },
          { name: 'unit', label: 'Unidad', placeholder: 'Apto 302', half: true },
          { name: 'site_id', label: 'Sitio', type: 'select', numeric: true, half: true, options: () => sites.map((s) => ({ value: s.id, label: s.name })) },
          { name: 'email', label: 'Email', type: 'email', half: true },
          { name: 'phone', label: 'Teléfono', half: true },
          { name: 'hb', type: 'heading', label: 'Cobro' },
          { name: 'billing_mode', label: 'Modalidad', type: 'select', required: true, options: [{ value: 'postpaid', label: 'Pospago: se suma a las expensas o se factura a fin de mes' }, { value: 'prepaid', label: 'Prepago: carga saldo antes de usar' }] },
          { name: 'credit_limit', label: 'Saldo negativo permitido', type: 'number', half: true, show: (v) => v.billing_mode === 'prepaid' },
          { name: 'tariff_id', label: 'Tarifa especial', type: 'select', numeric: true, half: true, options: () => tariffs.map((t) => ({ value: t.id, label: t.name })), help: 'Si no elegís, usa la del sitio.' },
          { name: 'active', type: 'checkbox', help: 'Cuenta habilitada para cargar' },
        ]}
        columns={[
          { label: 'Cuenta', render: (r) => <><b>{who(r.unit, r.name)}</b><div className="subtle" style={{ fontSize: 12 }}>{r.site_name || 'Sin sitio'}</div></> },
          { label: 'Modalidad', render: (r) => (r.billing_mode === 'prepaid' ? 'Prepago' : 'Pospago') },
          { label: 'Tarjetas', right: true, render: (r) => r.cards },
          { label: 'Saldo', right: true, render: (r) => <span className="num" style={{ color: r.balance < 0 ? 'var(--red)' : undefined, fontWeight: 500 }}>{money(r.balance)}</span> },
          { label: 'Estado', render: (r) => <span className={'badge mini ' + (r.active ? 'ok' : 'gris')}><span className="dot" />{r.active ? 'Activa' : 'Pausada'}</span> },
        ]}
        rowActions={(r) => <button className="btn ghost icon sm" aria-label="Detalle" data-tip="Movimientos, pagos y app" onClick={() => setMov(r)}><Icon name="history" size={15} /></button>}
      />
      {mov && <AccountSheet account={mov} onClose={() => setMov(null)} />}
    </>
  );
}

function AccountSheet({ account, onClose }) {
  const [tab, setTab] = useState('mov');
  const { data, reload } = useApi(`/accounts/${account.id}/movements`);
  const users = useApi(`/accounts/${account.id}/app-users`);
  const [code, setCode] = useState(account.invite_code);
  const [pay, setPay] = useState({ kind: 'payment', amount: '', description: '' });
  const add = () => act(() => api(`/accounts/${account.id}/movements`, { method: 'POST', body: { ...pay, amount: Number(pay.amount) } }), 'Movimiento registrado')
    .then(() => { setPay({ kind: 'payment', amount: '', description: '' }); reload(); }).catch(() => {});
  const invite = () => act(() => api(`/accounts/${account.id}/invite`, { method: 'POST' }), 'Código nuevo generado').then((r) => setCode(r.invite_code)).catch(() => {});
  return (
    <Modal icon="users" tone="blue" title={who(account.unit, account.name)} subtitle={data ? `Saldo ${money(data.balance)}` : ' '} size="lg" onClose={onClose}>
      <div style={{ marginBottom: 16 }}><Segmented value={tab} onChange={setTab} options={[['mov', 'Movimientos'], ['app', 'App']]} /></div>
      {tab === 'mov' ? (
        <>
          <div className="form-grid" style={{ gridTemplateColumns: '130px 130px 1fr auto', alignItems: 'end' }}>
            <Field label="Tipo"><select value={pay.kind} onChange={(e) => setPay({ ...pay, kind: e.target.value })}><option value="payment">Pago</option><option value="adjustment">Ajuste</option></select></Field>
            <Field label="Monto"><input type="number" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} placeholder="500" /></Field>
            <Field label="Detalle"><input value={pay.description} onChange={(e) => setPay({ ...pay, description: e.target.value })} placeholder="Expensas de noviembre" /></Field>
            <div className="field"><button className="btn" disabled={!pay.amount} onClick={add}>Registrar</button></div>
          </div>
          {!data ? <Loading rows={3} /> : data.movements.length === 0 ? <p className="muted">Sin movimientos todavía.</p> : (
            <div className="card flush" style={{ boxShadow: 'none', border: '0.5px solid var(--sep)' }}><div className="tablewrap" style={{ maxHeight: '46vh' }}><table className="table">
              <thead><tr><th>Fecha</th><th>Detalle</th><th className="right">Monto</th></tr></thead>
              <tbody>{data.movements.map((m) => <tr key={m.id}><td style={{ whiteSpace: 'nowrap' }}>{dt(m.created_at)}</td><td>{m.description || m.kind}</td><td className="right num" style={{ color: m.amount < 0 ? 'var(--text)' : 'var(--green)', fontWeight: 500 }}>{money(m.amount)}</td></tr>)}</tbody>
            </table></div></div>
          )}
        </>
      ) : (
        <>
          <div className="switch-row" style={{ marginBottom: 14 }}>
            <span>Código para unirse desde la app: {code ? <b className="mono" style={{ fontSize: 15 }}>{code}</b> : <span className="muted">sin generar</span>}</span>
            <button className="btn tint sm" onClick={invite}>{code ? 'Cambiar código' : 'Generar código'}</button>
          </div>
          <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>Los residentes se registran en {window.location.host}/app con este código y sus cargas se cobran a esta cuenta.</p>
          {!users.data ? <Loading rows={2} /> : users.data.length === 0 ? <p className="muted">Nadie se unió todavía.</p> : (
            <div className="card flush" style={{ boxShadow: 'none', border: '0.5px solid var(--sep)' }}><table className="table">
              <tbody>{users.data.map((u) => (
                <tr key={u.id}><td><b>{u.name}</b><div className="subtle" style={{ fontSize: 12 }}>{u.email}</div></td>
                  <td className="actions"><input type="checkbox" checked={u.active} aria-label="Habilitado" onChange={(e) => act(() => api(`/app-users/${u.id}`, { method: 'PATCH', body: { active: e.target.checked } }), e.target.checked ? 'Usuario habilitado' : 'Usuario pausado').then(users.reload).catch(() => {})} /></td></tr>
              ))}</tbody>
            </table></div>
          )}
        </>
      )}
    </Modal>
  );
}

// ---------- Tarjetas ----------
export function Cards() {
  const accounts = useApi('/accounts').data || [];
  return (
    <CrudPage title="Tarjetas" singular="tarjeta" icon="card" path="/cards" keyField="id_tag" desc="Las tarjetas RFID identifican a quién se le cobra cada carga."
      defaults={{ status: 'active' }}
      emptyText="Registrá el UID que lee el cargador y asignalo a una cuenta."
      fields={[
        { name: 'id_tag', label: 'UID de la tarjeta', required: true, createOnly: true, placeholder: '04A1B2C3', help: 'Tal como lo informa el cargador, hasta 20 caracteres.' },
        { name: 'account_id', label: 'Cuenta', type: 'select', numeric: true, required: true, options: () => accounts.map((a) => ({ value: a.id, label: who(a.unit, a.name) })) },
        { name: 'label', label: 'Descripción', placeholder: 'Auto de Ana' },
        { name: 'status', label: 'Estado', type: 'select', required: true, half: true, options: [{ value: 'active', label: 'Activa' }, { value: 'blocked', label: 'Bloqueada' }] },
        { name: 'expires_at', label: 'Vence', type: 'datetime', half: true, help: 'Para tarjetas de visita.' },
      ]}
      columns={[
        { label: 'UID', render: (r) => <span className="mono">{r.id_tag}</span> },
        { label: 'Cuenta', render: (r) => who(r.account_unit, r.account_name) },
        { label: 'Descripción', render: (r) => r.label || <span className="subtle">—</span> },
        { label: 'Vence', render: (r) => (r.expires_at ? dt(r.expires_at) : <span className="subtle">No vence</span>) },
        { label: 'Estado', render: (r) => <span className={'badge mini ' + (r.status === 'active' ? 'ok' : 'falla')}><span className="dot" />{r.status === 'active' ? 'Activa' : 'Bloqueada'}</span> },
      ]}
    />
  );
}

// ---------- Sesiones ----------
export function Sessions() {
  const [status, setStatus] = useState('');
  const { data, reload } = useApi(`/sessions${status ? `?status=${status}` : ''}`, { live: true });
  const close = (s) => act(() => api(`/sessions/${s.id}/close`, { method: 'POST' }), 'Sesión cerrada').then(reload).catch(() => {});
  return (
    <div className="page">
      <PageHeader title="Sesiones" desc="Cada carga con la energía que midió el cargador y lo que se cobró." actions={<Segmented value={status} onChange={setStatus} options={[['', 'Todas'], ['active', 'En curso'], ['completed', 'Terminadas']]} />} />
      {!data ? <Loading rows={6} /> : data.length === 0 ? <div className="card"><Empty icon="history" title="Sin sesiones">Cuando alguien cargue, aparece acá.</Empty></div> : (
        <div className="card flush"><div className="tablewrap"><table className="table">
          <thead><tr><th>Inicio</th><th>Cargador</th><th>Cuenta</th><th className="right">Energía</th><th className="right">Importe</th><th className="right">Margen</th><th>Estado</th><th /></tr></thead>
          <tbody>{data.map((s) => (
            <tr key={s.id}>
              <td style={{ whiteSpace: 'nowrap' }}>{dt(s.started_at)}<div className="subtle" style={{ fontSize: 12 }}>#{s.id}</div></td>
              <td>{s.charger_name || s.charger_id}</td>
              <td>{s.account_name ? who(s.account_unit, s.account_name) : <span className="mono">{s.id_tag}</span>}</td>
              <td className="right kwh">{kwh(s.status === 'active' ? s.last_meter_wh - s.meter_start_wh : s.energy_wh)}</td>
              <td className="right num">{s.amount != null ? money(s.amount) : '—'}</td>
              <td className="right num subtle">{s.margin != null ? money(s.margin) : '—'}</td>
              <td>{s.status === 'active' ? <span className="badge mini info live"><span className="dot" />En curso</span> : s.stop_reason?.startsWith('Rechazada') ? <span className="badge mini falla"><span className="dot" />{s.stop_reason.replace('Rechazada: ', 'Rechazada · ')}</span> : <span className="badge mini gris">Terminada</span>}</td>
              <td className="actions">{s.status === 'active' && <button className="btn ghost sm" onClick={() => close(s)} data-tip="Si el cargador no informó el final">Cerrar</button>}</td>
            </tr>
          ))}</tbody>
        </table></div></div>
      )}
    </div>
  );
}

// ---------- Liquidaciones ----------
export function Report() {
  const [month, setMonth] = useState(thisMonth());
  const [siteId, setSiteId] = useState('');
  const sites = useApi('/sites').data || [];
  const qs = `month=${month}${siteId ? `&siteId=${siteId}` : ''}`;
  const { data } = useApi(`/reports/monthly?${qs}`);
  const t = useMemo(() => (data || []).reduce((a, r) => ({ wh: a.wh + r.energy_wh, amount: a.amount + r.amount }), { wh: 0, amount: 0 }), [data]);
  return (
    <div className="page">
      <PageHeader title="Liquidación por cuenta" desc="Lo que consumió cada cuenta en el mes, listo para sumar a las expensas."
        actions={<button className="btn sec" onClick={() => downloadCsv(`/reports/monthly?${qs}&format=csv`, `liquidacion-${month}.csv`).catch(() => {})}><Icon name="download" size={15} />CSV</button>} />
      <div className="row wrap" style={{ gap: 12, marginBottom: 14 }}>
        <Field label="Mes"><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></Field>
        <Field label="Sitio"><select value={siteId} onChange={(e) => setSiteId(e.target.value)}><option value="">Todos</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
      </div>
      {!data ? <Loading rows={5} /> : (
        <div className="card flush"><div className="tablewrap"><table className="table">
          <thead><tr><th>Cuenta</th><th>Sitio</th><th>Modalidad</th><th className="right">Cargas</th><th className="right">Energía</th><th className="right">Importe</th></tr></thead>
          <tbody>
            {data.map((r) => <tr key={r.account_id}><td><b>{who(r.unit, r.account)}</b></td><td>{r.site || '—'}</td><td>{r.billing_mode === 'prepaid' ? 'Prepago' : 'Pospago'}</td><td className="right">{r.sessions}</td><td className="right kwh">{kwh(r.energy_wh)}</td><td className="right num">{money(r.amount)}</td></tr>)}
            <tr className="total"><td colSpan={4}>Total</td><td className="right kwh">{kwh(t.wh)}</td><td className="right num">{money(t.amount)}</td></tr>
          </tbody>
        </table></div></div>
      )}
    </div>
  );
}

export function OwnersReport() {
  const [month, setMonth] = useState(thisMonth());
  const { data } = useApi(`/reports/owners?month=${month}`);
  const t = (data || []).reduce((a, r) => ({ amount: a.amount + r.amount, owner: a.owner + r.to_owner, margin: a.margin + r.margin }), { amount: 0, owner: 0, margin: 0 });
  return (
    <div className="page">
      <PageHeader title="Liquidación a propietarios" desc="En cada sitio: lo cobrado, el costo de energía que se devuelve al titular de la línea y el margen de Infratec."
        actions={<button className="btn sec" onClick={() => downloadCsv(`/reports/owners?month=${month}&format=csv`, `propietarios-${month}.csv`).catch(() => {})}><Icon name="download" size={15} />CSV</button>} />
      <div className="row" style={{ marginBottom: 14 }}><Field label="Mes"><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></Field></div>
      {!data ? <Loading rows={4} /> : (
        <div className="card flush"><div className="tablewrap"><table className="table">
          <thead><tr><th>Sitio</th><th>Titular de la línea</th><th className="right">Energía</th><th className="right">Cobrado</th><th className="right">A liquidar</th><th className="right">Margen</th></tr></thead>
          <tbody>
            {data.map((r) => (
              <tr key={r.site_id}><td><b>{r.site}</b></td><td>{r.line_owner === 'cliente' ? r.owner_name || 'Cliente' : <span className="subtle">Infratec</span>}</td>
                <td className="right kwh">{kwh(r.energy_wh)}</td><td className="right num">{money(r.amount)}</td><td className="right num">{money(r.to_owner)}</td><td className="right num">{money(r.margin)}</td></tr>
            ))}
            <tr className="total"><td colSpan={3}>Total</td><td className="right num">{money(t.amount)}</td><td className="right num">{money(t.owner)}</td><td className="right num">{money(t.margin)}</td></tr>
          </tbody>
        </table></div></div>
      )}
    </div>
  );
}

// ---------- Alertas ----------
const ALERT = { offline: ['Sin conexión', 'gris'], faulted: ['Falla', 'falla'], stuck_session: ['Sesión colgada', 'warn'] };
export function Alerts() {
  const [all, setAll] = useState('open');
  const { data, reload } = useApi(`/alerts${all === 'all' ? '?all=1' : ''}`, { live: true });
  const resolve = (a) => act(() => api(`/alerts/${a.id}/resolve`, { method: 'POST' }), 'Alerta cerrada').then(reload).catch(() => {});
  return (
    <div className="page">
      <PageHeader title="Alertas" desc="Cargadores desconectados, en falla o con sesiones que no terminan. Se cierran solas cuando se normaliza." actions={<Segmented value={all} onChange={setAll} options={[['open', 'Abiertas'], ['all', 'Historial']]} />} />
      {!data ? <Loading rows={3} /> : data.length === 0 ? <div className="card"><Empty icon="checkCircle" title="Todo funciona">No hay alertas abiertas.</Empty></div> : (
        <div className="card flush"><table className="table">
          <thead><tr><th>Tipo</th><th>Detalle</th><th>Desde</th><th /></tr></thead>
          <tbody>{data.map((a) => (
            <tr key={a.id}>
              <td><span className={'badge mini ' + (a.resolved_at ? 'gris' : ALERT[a.kind]?.[1] || 'warn')}><span className="dot" />{ALERT[a.kind]?.[0] || a.kind}</span></td>
              <td>{a.message}<div className="subtle" style={{ fontSize: 12 }}>{a.site_name || ''}{a.notified ? ' · avisada' : ''}</div></td>
              <td style={{ whiteSpace: 'nowrap' }}>{ago(a.opened_at)}{a.resolved_at && <div className="subtle" style={{ fontSize: 12 }}>resuelta {ago(a.resolved_at)}</div>}</td>
              <td className="actions">{!a.resolved_at && <button className="btn ghost sm" onClick={() => resolve(a)}>Cerrar</button>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}

// ---------- Reservas y pagos ----------
export function Reservations() {
  const { data, reload } = useApi('/reservations', { live: true });
  const cancel = (r) => act(() => api(`/reservations/${r.id}`, { method: 'DELETE' }), 'Reserva cancelada').then(reload).catch(() => {});
  return (
    <div className="page">
      <PageHeader title="Reservas" desc="Lo que reservaron los usuarios desde la app. Durante la reserva, el cargador solo acepta a quien reservó." />
      {!data ? <Loading rows={3} /> : data.length === 0 ? <div className="card"><Empty icon="calendar" title="Sin reservas próximas" /></div> : (
        <div className="card flush"><table className="table">
          <thead><tr><th>Cargador</th><th>Cuenta</th><th>Desde</th><th>Hasta</th><th /></tr></thead>
          <tbody>{data.map((r) => <tr key={r.id}><td><b>{r.charger_name || r.charger_id}</b></td><td>{who(r.account_unit, r.account_name)}</td><td>{dt(r.starts_at)}</td><td>{dt(r.ends_at)}</td><td className="actions"><button className="btn ghost sm" onClick={() => cancel(r)}>Cancelar</button></td></tr>)}</tbody>
        </table></div>
      )}
    </div>
  );
}

const PAY = { approved: ['Acreditado', 'ok'], pending: ['Pendiente', 'warn'], rejected: ['Rechazado', 'falla'], cancelled: ['Cancelado', 'gris'] };
export function Payments() {
  const { data } = useApi('/payments', { live: true });
  return (
    <div className="page">
      <PageHeader title="Pagos online" desc="Recargas de saldo hechas con Mercado Pago desde la app." />
      {!data ? <Loading rows={3} /> : data.length === 0 ? <div className="card"><Empty icon="dollar" title="Sin pagos todavía">Se habilitan al cargar el Access Token de Mercado Pago en el servidor.</Empty></div> : (
        <div className="card flush"><table className="table">
          <thead><tr><th>Fecha</th><th>Cuenta</th><th>Referencia</th><th className="right">Monto</th><th>Estado</th></tr></thead>
          <tbody>{data.map((p) => <tr key={p.id}><td>{dt(p.created_at)}</td><td>{p.account_name}</td><td className="mono">{p.external_id || '—'}</td><td className="right num">{money(p.amount, p.currency)}</td><td><span className={'badge mini ' + (PAY[p.status]?.[1] || 'gris')}><span className="dot" />{PAY[p.status]?.[0] || p.status}</span></td></tr>)}</tbody>
        </table></div>
      )}
    </div>
  );
}
