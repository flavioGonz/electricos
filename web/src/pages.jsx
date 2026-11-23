import React, { useMemo, useState } from 'react';
import { Modal, Field, PageHeader, Stat, Loading, Empty } from './components/ui.jsx';
import { Icon } from './components/icons.jsx';
import CrudPage from './Crud.jsx';
import { api, money, kwh, dt, ago, getToken } from './api.js';
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
const StatusBadge = ({ s }) => {
  const [tone, label] = STATUS[s] || ['gris', s];
  return <span className={'badge mini ' + tone}><span className="dot" />{label}</span>;
};
const Conn = ({ on }) => <span className={'badge mini ' + (on ? 'ok' : 'gris')}><span className="dot" />{on ? 'En línea' : 'Desconectado'}</span>;

// ---------- Panel ----------
export function Dashboard({ go }) {
  const { data } = useApi('/dashboard', { live: true });
  const chargers = useApi('/chargers', { live: true });
  const active = (chargers.data || []).flatMap((c) => c.active_sessions.map((s) => ({ ...s, charger: c.name || c.id })));
  return (
    <div>
      <PageHeader title="Panel" desc="Estado de la red de carga en tiempo real" icon="home" />
      {!data ? <Loading rows={2} /> : (
        <div className="stats">
          <Stat icon="bolt" label="Cargando ahora" value={data.sessions_active} />
          <Stat icon="plug" label="Cargadores en línea" value={`${data.chargers_online} / ${data.chargers}`} tone={data.chargers_online < data.chargers ? 'danger' : 'ok'} />
          <Stat icon="power" label="Energía del mes" value={kwh(data.month_energy_wh)} />
          <Stat icon="dollar" label="Facturado del mes" value={money(data.month_amount)} />
        </div>
      )}
      {data?.chargers_pending > 0 && (
        <div className="card" style={{ marginTop: 14, cursor: 'pointer' }} onClick={() => go('/cargadores')}>
          <div className="row" style={{ gap: 10 }}><Icon name="alert" size={18} /><b>{data.chargers_pending} cargador(es) esperando aprobación</b><span className="muted">Revisalos en Cargadores</span></div>
        </div>
      )}
      <h3 style={{ margin: '22px 0 10px' }}>Cargas en curso</h3>
      {active.length === 0 ? <div className="card muted">No hay cargas en curso.</div> : (
        <div className="card" style={{ padding: 0 }}>
          <div className="tablewrap"><table className="table">
            <thead><tr><th>Cargador</th><th>Cuenta</th><th>Tarjeta</th><th>Inicio</th><th>Energía</th><th>Potencia</th></tr></thead>
            <tbody>{active.map((s) => (
              <tr key={s.id}><td>{s.charger}</td><td>{s.account || '—'}</td><td className="mono">{s.id_tag}</td><td>{dt(s.started_at)}</td>
                <td className="kwh">{kwh(s.energy_wh)}</td><td className="kwh">{s.power_w ? `${(s.power_w / 1000).toFixed(1)} kW` : '—'}</td></tr>
            ))}</tbody>
          </table></div>
        </div>
      )}
    </div>
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
  const host = typeof window !== 'undefined' ? window.location.host : 'electricos.infratec.com.uy';
  const wsUrl = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${host}/ocpp/`;

  const save = async () => {
    const v = edit;
    await act(() => api(`/chargers/${encodeURIComponent(v.id)}`, { method: 'PATCH', body: {
      name: v.name || '', site_id: v.site_id ? Number(v.site_id) : null, approved: !!v.approved, max_amps: Number(v.max_amps) || 32,
      owner_account_id: v.owner_account_id ? Number(v.owner_account_id) : null,
    } }), 'Cargador actualizado');
    setEdit(null);
    reload();
  };
  const cmd = (c, action, body, msg) => act(() => api(`/chargers/${encodeURIComponent(c.id)}/${action}`, { method: 'POST', body: body || {} }), msg).then(reload).catch(() => {});

  return (
    <div>
      <PageHeader title="Cargadores" icon="plug" desc={<>Configurá cada cargador con la URL <span className="mono">{wsUrl}&lt;id&gt;</span> (OCPP 1.6J). Aparecen acá solos al conectarse.</>} />
      {!data ? <Loading rows={4} /> : data.length === 0 ? (
        <Empty icon="plug" title="Ningún cargador se conectó todavía">Configurá el servidor central del cargador con la URL de arriba y un identificador único (por ejemplo, su número de serie).</Empty>
      ) : (
        <div className="grid-chargers">
          {data.map((c) => (
            <div key={c.id} className="card">
              <div className="row between" style={{ alignItems: 'flex-start' }}>
                <div>
                  <b>{c.name || c.id}</b>
                  <div className="muted mono">{c.id}</div>
                </div>
                <Conn on={c.connected} />
              </div>
              <div className="muted" style={{ fontSize: 12.5, margin: '8px 0' }}>
                {c.site_name || 'Sin sitio'} · {c.vendor ? `${c.vendor} ${c.model || ''}` : 'modelo desconocido'} · {c.max_amps} A · visto {ago(c.last_seen)}
                {c.owner_name && <> · solo {c.owner_name}</>}
              </div>
              {!c.approved && <div className="badge warn" style={{ marginBottom: 8 }}><span className="dot" />Pendiente de aprobación</div>}
              <div className="row wrap" style={{ gap: 6, marginBottom: 8 }}>
                {c.connectors.filter((k) => k.connector_id > 0).map((k) => <span key={k.connector_id} className="row" style={{ gap: 4 }}><span className="muted">#{k.connector_id}</span><StatusBadge s={k.status} /></span>)}
              </div>
              {c.active_sessions.map((s) => (
                <div key={s.id} className="muted" style={{ fontSize: 12.5 }}>
                  <Icon name="bolt" size={13} /> {s.account || s.id_tag}: <b className="kwh">{kwh(s.energy_wh)}</b>{s.power_w ? ` a ${(s.power_w / 1000).toFixed(1)} kW` : ''}
                </div>
              ))}
              <div className="row wrap" style={{ gap: 6, marginTop: 10 }}>
                <button className="btn sec sm" onClick={() => setEdit({ ...c })}><Icon name="settings" size={14} />Configurar</button>
                {c.connected && c.active_sessions.length === 0 && <button className="btn sec sm" onClick={() => setRemote({ c, idTag: '', connectorId: 1 })}><Icon name="bolt" size={14} />Iniciar</button>}
                {c.connected && c.active_sessions.length > 0 && <button className="btn sec sm" onClick={() => cmd(c, 'remote-stop', {}, 'Orden de detener enviada')}><Icon name="power" size={14} />Detener</button>}
                {c.connected && <button className="btn ghost sm" onClick={() => cmd(c, 'local-list', {}, 'Lista de tarjetas enviada')} data-tip="Envía las tarjetas habilitadas para cargar sin internet"><Icon name="card" size={14} />Sincronizar tarjetas</button>}
                {c.connected && <button className="btn ghost sm" onClick={() => cmd(c, 'reset', { type: 'Soft' }, 'Reinicio enviado')}><Icon name="repeat" size={14} />Reiniciar</button>}
                <button className="btn ghost sm" onClick={() => api(`/chargers/${encodeURIComponent(c.id)}/log`).then(setLog)}><Icon name="list" size={14} />Mensajes</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {edit && (
        <Modal title={`Cargador ${edit.id}`} onClose={() => setEdit(null)}
          footer={<><button className="btn sec" onClick={() => setEdit(null)}>Cancelar</button><button className="btn" onClick={save}><Icon name="save" size={16} />Guardar</button></>}>
          <Field label="Nombre"><input value={edit.name || ''} placeholder="Cochera 12" onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
          <Field label="Sitio"><select value={edit.site_id || ''} onChange={(e) => setEdit({ ...edit, site_id: e.target.value })}><option value="">—</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          <Field label="Corriente máxima (A)"><input type="number" value={edit.max_amps} onChange={(e) => setEdit({ ...edit, max_amps: e.target.value })} /></Field>
          <Field label="Cochera asignada a"><select value={edit.owner_account_id || ''} onChange={(e) => setEdit({ ...edit, owner_account_id: e.target.value })}><option value="">Compartido (cualquier cuenta del sitio)</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.unit ? `${a.unit} · ` : ''}{a.name}</option>)}</select></Field>
          <Field><label className="row" style={{ gap: 8 }}><input type="checkbox" style={{ width: 'auto' }} checked={!!edit.approved} onChange={(e) => setEdit({ ...edit, approved: e.target.checked })} />Aprobado: puede autorizar cargas</label></Field>
        </Modal>
      )}

      {remote && (
        <Modal title={`Iniciar carga en ${remote.c.name || remote.c.id}`} size="sm" onClose={() => setRemote(null)}
          footer={<><button className="btn sec" onClick={() => setRemote(null)}>Cancelar</button><button className="btn" onClick={() => cmd(remote.c, 'remote-start', { idTag: remote.idTag, connectorId: remote.connectorId }, 'Orden de inicio enviada').then(() => setRemote(null))}><Icon name="bolt" size={16} />Iniciar</button></>}>
          <Field label="Tarjeta (UID)"><input value={remote.idTag} placeholder="04A1B2C3" onChange={(e) => setRemote({ ...remote, idTag: e.target.value })} /></Field>
          <Field label="Conector"><input type="number" value={remote.connectorId} onChange={(e) => setRemote({ ...remote, connectorId: e.target.value })} /></Field>
          <p className="muted" style={{ fontSize: 12.5 }}>La carga se cobra a la cuenta de esa tarjeta.</p>
        </Modal>
      )}

      {log && (
        <Modal title="Últimos mensajes OCPP" size="wide" onClose={() => setLog(null)}>
          <div className="tablewrap" style={{ maxHeight: '60vh', overflow: 'auto' }}><table className="table">
            <thead><tr><th>Hora</th><th></th><th>Acción</th><th>Datos</th></tr></thead>
            <tbody>{log.map((m) => <tr key={m.id}><td style={{ whiteSpace: 'nowrap' }}>{dt(m.ts)}</td><td>{m.direction === 'in' ? '←' : '→'}</td><td>{m.action}</td><td className="mono" style={{ maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis' }}>{JSON.stringify(m.payload)}</td></tr>)}</tbody>
          </table></div>
        </Modal>
      )}
    </div>
  );
}

// ---------- Tarifas ----------
export function Tariffs() {
  return (
    <CrudPage title="Tarifas" icon="dollar" path="/tariffs" desc="Precio por kWh, con franja valle opcional (hora de Montevideo)"
      defaults={{ currency: 'UYU', session_fee: 0 }}
      emptyText="Creá una tarifa y asignala a un sitio o a una cuenta."
      fields={[
        { name: 'name', label: 'Nombre', required: true, placeholder: 'Residencial' },
        { name: 'price_kwh', label: 'Precio por kWh', type: 'number', required: true },
        { name: 'offpeak_price_kwh', label: 'Precio valle por kWh', type: 'number', help: 'Vacío si no hay franja valle' },
        { name: 'offpeak_start_hour', label: 'Valle desde (hora 0-23)', type: 'number', step: 1 },
        { name: 'offpeak_end_hour', label: 'Valle hasta (hora 0-23)', type: 'number', step: 1 },
        { name: 'session_fee', label: 'Cargo fijo por sesión', type: 'number' },
        { name: 'currency', label: 'Moneda', type: 'select', required: true, options: [{ value: 'UYU', label: 'Pesos (UYU)' }, { value: 'USD', label: 'Dólares (USD)' }] },
      ]}
      columns={[
        { label: 'Nombre', render: (r) => <b>{r.name}</b> },
        { label: 'kWh', render: (r) => money(r.price_kwh, r.currency) },
        { label: 'Valle', render: (r) => (r.offpeak_price_kwh != null ? `${money(r.offpeak_price_kwh, r.currency)} de ${r.offpeak_start_hour} a ${r.offpeak_end_hour} h` : '—') },
        { label: 'Por sesión', render: (r) => money(r.session_fee, r.currency) },
      ]}
    />
  );
}

// ---------- Sitios ----------
export function Sites() {
  const tariffs = useApi('/tariffs').data || [];
  return (
    <CrudPage title="Sitios" icon="building" path="/sites" desc="Edificios y barrios" defaults={{ kind: 'edificio' }}
      emptyText="Un sitio agrupa cargadores y cuentas, y define la tarifa y el límite de potencia."
      fields={[
        { name: 'name', label: 'Nombre', required: true, placeholder: 'Edificio Rambla' },
        { name: 'kind', label: 'Tipo', type: 'select', required: true, options: [{ value: 'edificio', label: 'Edificio' }, { value: 'barrio', label: 'Barrio' }, { value: 'otro', label: 'Otro' }] },
        { name: 'address', label: 'Dirección' },
        { name: 'tariff_id', label: 'Tarifa', type: 'select', numeric: true, options: () => tariffs.map((t) => ({ value: t.id, label: t.name })) },
        { name: 'max_amps', label: 'Límite total de corriente (A)', type: 'number', step: 1, help: 'Se reparte entre las cargas activas. Vacío = sin límite.' },
      ]}
      columns={[
        { label: 'Sitio', render: (r) => <><b>{r.name}</b><div className="muted" style={{ fontSize: 12 }}>{r.address}</div></> },
        { label: 'Tipo', render: (r) => r.kind },
        { label: 'Tarifa', render: (r) => r.tariff_name || '—' },
        { label: 'Límite', render: (r) => (r.max_amps ? `${r.max_amps} A` : '—') },
        { label: 'Cargadores', render: (r) => r.chargers },
        { label: 'Cuentas', render: (r) => r.accounts },
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
      <CrudPage title="Cuentas" icon="users" path="/accounts" desc="Unidades, familias o empresas a las que se cobra la energía" defaults={{ billing_mode: 'postpaid', credit_limit: 0, active: true }}
        emptyText="Cada cuenta tiene una o más tarjetas. El consumo de sus tarjetas se suma a la cuenta."
        fields={[
          { name: 'name', label: 'Nombre', required: true, placeholder: 'Familia Pérez' },
          { name: 'unit', label: 'Unidad', placeholder: 'Apto 302' },
          { name: 'site_id', label: 'Sitio', type: 'select', numeric: true, options: () => sites.map((s) => ({ value: s.id, label: s.name })) },
          { name: 'email', label: 'Email' },
          { name: 'phone', label: 'Teléfono' },
          { name: 'billing_mode', label: 'Modalidad', type: 'select', required: true, options: [{ value: 'postpaid', label: 'Pospago (a fin de mes / expensas)' }, { value: 'prepaid', label: 'Prepago (saldo)' }] },
          { name: 'credit_limit', label: 'Crédito permitido en prepago', type: 'number' },
          { name: 'tariff_id', label: 'Tarifa especial', type: 'select', numeric: true, options: () => tariffs.map((t) => ({ value: t.id, label: t.name })), help: 'Vacío = la del sitio' },
          { name: 'active', label: 'Activa', type: 'checkbox', help: 'Puede cargar' },
        ]}
        columns={[
          { label: 'Cuenta', render: (r) => <><b>{r.unit ? `${r.unit} · ` : ''}{r.name}</b><div className="muted" style={{ fontSize: 12 }}>{r.site_name || 'Sin sitio'}</div></> },
          { label: 'Modalidad', render: (r) => (r.billing_mode === 'prepaid' ? 'Prepago' : 'Pospago') },
          { label: 'Tarjetas', render: (r) => r.cards },
          { label: 'Saldo', render: (r) => <span style={{ color: r.balance < 0 ? 'var(--falla)' : undefined }}>{money(r.balance)}</span> },
          { label: 'Estado', render: (r) => <span className={'badge mini ' + (r.active ? 'ok' : 'gris')}><span className="dot" />{r.active ? 'Activa' : 'Inactiva'}</span> },
        ]}
        rowActions={(r) => <button className="btn ghost icon sm" aria-label="Movimientos" data-tip="Movimientos y pagos" onClick={() => setMov(r)}><Icon name="history" size={15} /></button>}
      />
      {mov && <Movements account={mov} onClose={() => setMov(null)} />}
    </>
  );
}

function Movements({ account, onClose }) {
  const { data, reload } = useApi(`/accounts/${account.id}/movements`);
  const [pay, setPay] = useState({ kind: 'payment', amount: '', description: '' });
  const add = async () => {
    await act(() => api(`/accounts/${account.id}/movements`, { method: 'POST', body: { ...pay, amount: Number(pay.amount) } }), 'Movimiento registrado');
    setPay({ kind: 'payment', amount: '', description: '' });
    reload();
  };
  return (
    <Modal title={`${account.unit ? account.unit + ' · ' : ''}${account.name}`} subtitle={data ? `Saldo: ${money(data.balance)}` : ''} size="lg" onClose={onClose}>
      <div className="row wrap" style={{ gap: 8, alignItems: 'flex-end', marginBottom: 14 }}>
        <Field label="Tipo"><select value={pay.kind} onChange={(e) => setPay({ ...pay, kind: e.target.value })}><option value="payment">Pago</option><option value="adjustment">Ajuste</option></select></Field>
        <Field label="Monto"><input type="number" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} placeholder="500 o -50" /></Field>
        <Field label="Detalle"><input value={pay.description} onChange={(e) => setPay({ ...pay, description: e.target.value })} placeholder="Pago en expensas de noviembre" /></Field>
        <div className="field"><button className="btn" onClick={add}><Icon name="plus" size={16} />Registrar</button></div>
      </div>
      {!data ? <Loading rows={3} /> : (
        <div className="tablewrap" style={{ maxHeight: '50vh', overflow: 'auto' }}><table className="table">
          <thead><tr><th>Fecha</th><th>Detalle</th><th style={{ textAlign: 'right' }}>Monto</th></tr></thead>
          <tbody>{data.movements.map((m) => <tr key={m.id}><td>{dt(m.created_at)}</td><td>{m.description || m.kind}</td><td style={{ textAlign: 'right', color: m.amount < 0 ? 'var(--falla)' : 'var(--ok)' }}>{money(m.amount)}</td></tr>)}</tbody>
        </table></div>
      )}
    </Modal>
  );
}

// ---------- Tarjetas ----------
export function Cards() {
  const accounts = useApi('/accounts').data || [];
  return (
    <CrudPage title="Tarjetas" icon="card" path="/cards" keyField="id_tag" desc="Tarjetas RFID que identifican y habilitan la carga" defaults={{ status: 'active' }}
      emptyText="Registrá el UID de cada tarjeta (lo muestra el cargador o un lector USB) y asignala a una cuenta."
      fields={[
        { name: 'id_tag', label: 'UID de la tarjeta', required: true, createOnly: true, placeholder: '04A1B2C3', help: 'Hasta 20 caracteres, tal como lo envía el cargador' },
        { name: 'account_id', label: 'Cuenta', type: 'select', numeric: true, required: true, options: () => accounts.map((a) => ({ value: a.id, label: `${a.unit ? a.unit + ' · ' : ''}${a.name}` })) },
        { name: 'label', label: 'Descripción', placeholder: 'Auto de Ana' },
        { name: 'status', label: 'Estado', type: 'select', required: true, options: [{ value: 'active', label: 'Activa' }, { value: 'blocked', label: 'Bloqueada' }] },
        { name: 'expires_at', label: 'Vence', type: 'datetime', help: 'Para tarjetas de visita. Vacío = no vence' },
      ]}
      columns={[
        { label: 'UID', render: (r) => <span className="mono">{r.id_tag}</span> },
        { label: 'Cuenta', render: (r) => `${r.account_unit ? r.account_unit + ' · ' : ''}${r.account_name}` },
        { label: 'Descripción', render: (r) => r.label || '—' },
        { label: 'Vence', render: (r) => (r.expires_at ? dt(r.expires_at) : '—') },
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
    <div>
      <PageHeader title="Sesiones" icon="history" desc="Cada carga registrada, con la energía medida por el cargador" />
      <div className="chips" style={{ marginBottom: 12 }}>
        {[['', 'Todas'], ['active', 'En curso'], ['completed', 'Terminadas']].map(([v, l]) => <span key={v} className={'chip' + (status === v ? ' active' : '')} onClick={() => setStatus(v)}>{l}</span>)}
      </div>
      {!data ? <Loading rows={6} /> : data.length === 0 ? <div className="card muted">Sin sesiones.</div> : (
        <div className="card" style={{ padding: 0 }}><div className="tablewrap"><table className="table">
          <thead><tr><th>#</th><th>Inicio</th><th>Cargador</th><th>Cuenta</th><th>Tarjeta</th><th>Energía</th><th>Importe</th><th>Estado</th><th></th></tr></thead>
          <tbody>{data.map((s) => (
            <tr key={s.id}>
              <td>{s.id}</td><td>{dt(s.started_at)}</td><td>{s.charger_name || s.charger_id}</td>
              <td>{s.account_name ? `${s.account_unit ? s.account_unit + ' · ' : ''}${s.account_name}` : '—'}</td>
              <td className="mono">{s.id_tag}</td>
              <td className="kwh">{kwh(s.status === 'active' ? s.last_meter_wh - s.meter_start_wh : s.energy_wh)}</td>
              <td>{s.amount != null ? money(s.amount) : '—'}</td>
              <td>{s.status === 'active' ? <span className="badge mini info"><span className="dot" />En curso</span> : s.stop_reason?.startsWith('Rechazada') ? <span className="badge mini falla"><span className="dot" />{s.stop_reason}</span> : <span className="badge mini ok"><span className="dot" />Terminada</span>}</td>
              <td>{s.status === 'active' && <button className="btn ghost sm" onClick={() => close(s)} data-tip="Cerrar a mano si el cargador no informó el fin">Cerrar</button>}</td>
            </tr>
          ))}</tbody>
        </table></div></div>
      )}
    </div>
  );
}

// ---------- Liquidación ----------
export function Report() {
  const now = new Date();
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const [siteId, setSiteId] = useState('');
  const sites = useApi('/sites').data || [];
  const qs = `month=${month}${siteId ? `&siteId=${siteId}` : ''}`;
  const { data } = useApi(`/reports/monthly?${qs}`);
  const totals = useMemo(() => (data || []).reduce((t, r) => ({ wh: t.wh + r.energy_wh, amount: t.amount + r.amount }), { wh: 0, amount: 0 }), [data]);
  const download = async () => {
    const res = await api(`/reports/monthly?${qs}&format=csv`, { raw: true });
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement('a'), { href: url, download: `liquidacion-${month}.csv` });
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div>
      <PageHeader title="Liquidación mensual" icon="file" desc="Consumo por cuenta para sumar a las expensas o facturar"
        actions={<button className="btn sec" onClick={download}><Icon name="download" size={16} />Descargar CSV</button>} />
      <div className="row wrap" style={{ gap: 10, marginBottom: 12 }}>
        <Field label="Mes"><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></Field>
        <Field label="Sitio"><select value={siteId} onChange={(e) => setSiteId(e.target.value)}><option value="">Todos</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
      </div>
      {!data ? <Loading rows={5} /> : (
        <div className="card" style={{ padding: 0 }}><div className="tablewrap"><table className="table">
          <thead><tr><th>Sitio</th><th>Cuenta</th><th>Modalidad</th><th>Sesiones</th><th>Energía</th><th style={{ textAlign: 'right' }}>Importe</th></tr></thead>
          <tbody>
            {data.map((r) => <tr key={r.account_id}><td>{r.site || '—'}</td><td>{r.unit ? `${r.unit} · ` : ''}{r.account}</td><td>{r.billing_mode === 'prepaid' ? 'Prepago' : 'Pospago'}</td><td>{r.sessions}</td><td className="kwh">{kwh(r.energy_wh)}</td><td style={{ textAlign: 'right' }}>{money(r.amount)}</td></tr>)}
            <tr><td colSpan={4}><b>Total</b></td><td className="kwh"><b>{kwh(totals.wh)}</b></td><td style={{ textAlign: 'right' }}><b>{money(totals.amount)}</b></td></tr>
          </tbody>
        </table></div></div>
      )}
    </div>
  );
}
