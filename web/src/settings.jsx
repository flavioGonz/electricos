// Configuración: usuarios del panel, usuarios de la app, drivers de cargadores y auditoría.
import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Field, PageHeader, Loading, Empty, Switch, Segmented } from './components/ui.jsx';
import { Icon } from './components/icons.jsx';
import CrudPage from './Crud.jsx';
import { api, kwh, dt, ago } from './api.js';
import { useApi, act } from './hooks.js';

const ROLES = [
  { value: 'admin', label: 'Administrador', hint: 'Todo, incluidos usuarios, tarifas y auditoría' },
  { value: 'operador', label: 'Operador', hint: 'Opera cargadores, cuentas y tarjetas; no borra ni toca tarifas' },
  { value: 'lectura', label: 'Solo lectura', hint: 'Ve todo, no cambia nada' },
];
const roleLabel = (r) => ROLES.find((x) => x.value === r)?.label || r;
const ROLE_TONE = { admin: 'info', operador: 'ok', lectura: 'gris' };

/** Muestra una contraseña temporal una sola vez, con botón para copiarla. */
function TempPassword({ who, password, onClose }) {
  const copy = () => navigator.clipboard?.writeText(password).then(() => act(async () => {}, 'Contraseña copiada'));
  return (
    <Modal icon="lock" tone="green" size="sm" title="Contraseña temporal" subtitle={`Para ${who}. Se muestra una sola vez.`} onClose={onClose}
      footer={<><button className="btn sec" data-close onClick={onClose}>Listo</button><button className="btn" onClick={copy}><Icon name="clipboard" size={16} />Copiar</button></>}>
      <div className="temp-pass mono">{password}</div>
      <p className="muted" style={{ margin: '12px 0 0', fontSize: 13.5 }}>Pasásela por un canal seguro. Puede cambiarla después de entrar.</p>
    </Modal>
  );
}

// ---------- Usuarios del panel ----------
export function AdminUsers({ me }) {
  const [temp, setTemp] = useState(null);
  const [pass, setPass] = useState(null);
  const reset = (row) => act(() => api(`/admins/${row.id}/reset-password`, { method: 'POST' })).then((r) => setTemp({ who: row.name, password: r.temp_password })).catch(() => {});
  const changeOwn = () => act(() => api('/me/password', { method: 'POST', body: pass }), 'Contraseña cambiada').then(() => setPass(null)).catch(() => {});
  return (
    <>
      <CrudPage title="Usuarios del panel" singular="usuario" icon="users" path="/admins"
        desc="Quién entra a este panel y qué puede hacer. Cada acción queda registrada en la auditoría."
        defaults={{ role: 'operador', active: true }}
        extraActions={<button className="btn sec" onClick={() => setPass({ current: '', next: '' })}><Icon name="lock" size={16} />Mi contraseña</button>}
        canDelete={(r) => r.id !== me?.id}
        onSaved={(row) => row?.temp_password && setTemp({ who: row.name, password: row.temp_password })}
        rowActions={(row) => <button className="btn ghost icon sm" aria-label="Restablecer contraseña" data-tip="Generar una contraseña nueva" onClick={() => reset(row)}><Icon name="repeat" size={15} /></button>}
        fields={[
          { name: 'name', label: 'Nombre', required: true, placeholder: 'Nombre y apellido' },
          { name: 'email', label: 'Email', type: 'email', required: true, createOnly: true, placeholder: 'nombre@empresa.com' },
          { name: 'phone', label: 'Teléfono', placeholder: '099 123 456', half: true },
          { name: 'role', label: 'Rol', type: 'select', required: true, half: true, options: ROLES.map(({ value, label }) => ({ value, label })), help: 'Administrador: todo. Operador: opera, no borra ni cambia tarifas. Solo lectura: ve todo.' },
          { name: 'password', label: 'Contraseña', type: 'password', createOnly: true, placeholder: 'Vacío para generar una temporal', help: 'Mínimo 8 caracteres. Si la dejás vacía se genera una y te la mostramos.' },
          { name: 'active', label: 'Activo', type: 'checkbox', help: 'Puede entrar al panel' },
        ]}
        columns={[
          { label: 'Usuario', render: (r) => <><b>{r.name}</b>{r.id === me?.id && <span className="subtle"> · vos</span>}<div className="subtle">{r.email}</div></> },
          { label: 'Rol', render: (r) => <span className={`badge mini ${ROLE_TONE[r.role]}`}><span className="dot" />{roleLabel(r.role)}</span> },
          { label: 'Último ingreso', render: (r) => (r.last_login_at ? <span data-tip={dt(r.last_login_at)}>{ago(r.last_login_at)}</span> : <span className="subtle">Nunca</span>) },
          { label: 'Estado', render: (r) => (r.active ? <span className="badge mini ok"><span className="dot" />Activo</span> : <span className="badge mini gris"><span className="dot" />Deshabilitado</span>) },
        ]}
      />
      {temp && <TempPassword {...temp} onClose={() => setTemp(null)} />}
      {pass && (
        <Modal icon="lock" title="Cambiar mi contraseña" size="sm" onClose={() => setPass(null)}
          footer={<><button className="btn sec" data-close onClick={() => setPass(null)}>Cancelar</button><button className="btn" onClick={changeOwn}><Icon name="check" size={16} />Cambiar</button></>}>
          <div className="form-grid">
            <Field className="full" label="Contraseña actual"><input type="password" autoComplete="current-password" value={pass.current} onChange={(e) => setPass({ ...pass, current: e.target.value })} /></Field>
            <Field className="full" label="Contraseña nueva" hint="Mínimo 8 caracteres."><input type="password" autoComplete="new-password" value={pass.next} onChange={(e) => setPass({ ...pass, next: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </>
  );
}

// ---------- Usuarios de la app ----------
export function AppUsers() {
  const { data, reload } = useApi('/app-users');
  const accounts = useApi('/accounts').data || [];
  const [filter, setFilter] = useState('');
  const [state, setState] = useState('todos');
  const [create, setCreate] = useState(null);
  const [temp, setTemp] = useState(null);
  const rows = useMemo(() => (data || []).filter((u) =>
    (state === 'todos' || (state === 'activos' ? u.active : !u.active)) &&
    (!filter || `${u.name} ${u.email} ${u.account_name} ${u.account_unit || ''}`.toLowerCase().includes(filter.toLowerCase()))), [data, filter, state]);
  const toggle = (u) => act(() => api(`/app-users/${u.id}`, { method: 'PATCH', body: { active: !u.active } }), u.active ? 'Usuario deshabilitado' : 'Usuario habilitado').then(reload).catch(() => {});
  const reset = (u) => act(() => api(`/app-users/${u.id}/reset-password`, { method: 'POST' })).then((r) => setTemp({ who: u.name, password: r.temp_password })).catch(() => {});
  const save = () => act(() => api('/app-users', { method: 'POST', body: { ...create, account_id: Number(create.account_id) } }), 'Usuario creado')
    .then((r) => { setCreate(null); reload(); if (r.temp_password) setTemp({ who: r.name, password: r.temp_password }); }).catch(() => {});
  return (
    <div className="page">
      <PageHeader title="Usuarios de la app" desc="Las personas que entran a la app para cargar con el celular. Cada una carga a la cuenta de su unidad o a su saldo prepago."
        actions={<button className="btn" onClick={() => setCreate({ account_id: accounts[0]?.id || '', name: '', email: '', phone: '', password: '' })}><Icon name="plus" size={16} />Nuevo</button>} />
      <div className="toolbar">
        <span className="search"><Icon name="search" size={16} /><input placeholder="Buscar por nombre, email o cuenta" value={filter} onChange={(e) => setFilter(e.target.value)} /></span>
        <Segmented value={state} onChange={setState} options={[['todos', 'Todos'], ['activos', 'Activos'], ['inactivos', 'Deshabilitados']]} />
      </div>
      {!data ? <Loading rows={4} /> : rows.length === 0 ? (
        <div className="card"><Empty icon="users" title={data.length ? 'Nadie coincide con la búsqueda' : 'Todavía nadie se registró'}>Los residentes se registran desde la app con el código de invitación de su cuenta, o los podés crear acá.</Empty></div>
      ) : (
        <div className="card flush"><div className="tablewrap"><table className="table">
          <thead><tr><th>Usuario</th><th>Cuenta</th><th className="right">Energía total</th><th>Última carga</th><th>Estado</th><th /></tr></thead>
          <tbody>{rows.map((u) => (
            <tr key={u.id}>
              <td><b>{u.name}</b><div className="subtle">{u.email}{u.phone ? ` · ${u.phone}` : ''}</div></td>
              <td>{u.account_unit ? `${u.account_unit} · ` : ''}{u.account_name}<div className="subtle">{u.billing_mode === 'prepaid' ? 'Prepago' : 'Pospago'}</div></td>
              <td className="right kwh">{kwh(u.energy_wh)}</td>
              <td>{u.last_charge ? <span data-tip={dt(u.last_charge)}>{ago(u.last_charge)}</span> : <span className="subtle">Nunca</span>}</td>
              <td>{u.active ? <span className="badge mini ok"><span className="dot" />Activo</span> : <span className="badge mini gris"><span className="dot" />Deshabilitado</span>}</td>
              <td className="actions">
                <button className="btn ghost icon sm" aria-label="Restablecer contraseña" data-tip="Generar una contraseña nueva" onClick={() => reset(u)}><Icon name="repeat" size={15} /></button>
                <button className="btn ghost icon sm" aria-label={u.active ? 'Deshabilitar' : 'Habilitar'} data-tip={u.active ? 'Deshabilitar: no podrá cargar' : 'Habilitar'} onClick={() => toggle(u)}><Icon name={u.active ? 'power' : 'check'} size={15} /></button>
              </td>
            </tr>
          ))}</tbody>
        </table></div></div>
      )}
      {create && (
        <Modal icon="users" title="Nuevo usuario de la app" subtitle="Va a poder cargar con el celular a cuenta de la unidad elegida." onClose={() => setCreate(null)}
          footer={<><button className="btn sec" data-close onClick={() => setCreate(null)}>Cancelar</button><button className="btn" onClick={save}><Icon name="plus" size={16} />Crear</button></>}>
          <div className="form-grid">
            <Field className="full" label="Cuenta"><select value={create.account_id} onChange={(e) => setCreate({ ...create, account_id: e.target.value })}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.unit ? `${a.unit} · ` : ''}{a.name}</option>)}</select></Field>
            <Field className="full" label="Nombre"><input value={create.name} onChange={(e) => setCreate({ ...create, name: e.target.value })} placeholder="Nombre y apellido" /></Field>
            <Field label="Email"><input type="email" value={create.email} onChange={(e) => setCreate({ ...create, email: e.target.value })} /></Field>
            <Field label="Celular (opcional)"><input value={create.phone} onChange={(e) => setCreate({ ...create, phone: e.target.value })} /></Field>
            <Field className="full" label="Contraseña (opcional)" hint="Vacía para generar una temporal."><input type="password" value={create.password} onChange={(e) => setCreate({ ...create, password: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
      {temp && <TempPassword {...temp} onClose={() => setTemp(null)} />}
    </div>
  );
}

// ---------- Cargadores compatibles (drivers) ----------
const yes = (v, label) => <span className={'feat' + (v ? ' on' : '')} data-tip={`${label}: ${v ? 'sí' : 'no'}`}>{label}</span>;
export function ChargerModels() {
  return (
    <CrudPage title="Cargadores compatibles" singular="driver" icon="plug" path="/charger-models"
      desc="Cada driver describe un modelo de cargador: cómo se reconoce cuando se conecta y qué configuración OCPP se le aplica al aprobarlo."
      defaults={{ vendor: '', model_pattern: '*', ocpp_version: '1.6J', connectors: 1, connector_type: 'Tipo 2', rfid: true, smart_charging: true, local_list: true, remote_start: true, active: true,
        config: '{\n  "MeterValueSampleInterval": "30",\n  "MeterValuesSampledData": "Energy.Active.Import.Register,Power.Active.Import"\n}' }}
      fields={[
        { name: 'h1', type: 'heading', label: 'Identificación' },
        { name: 'name', label: 'Nombre', required: true, placeholder: 'Marca Modelo 7,4 kW' },
        { name: 'vendor', label: 'Marca (chargePointVendor)', required: true, half: true, placeholder: 'Tal como la informa el equipo', help: 'Usá * para cualquier marca.' },
        { name: 'model_pattern', label: 'Modelo (chargePointModel)', required: true, half: true, placeholder: 'AC22*', help: 'Admite * como comodín.' },
        { name: 'h2', type: 'heading', label: 'Características' },
        { name: 'ocpp_version', label: 'Versión OCPP', type: 'select', required: true, half: true, options: [{ value: '1.6J', label: 'OCPP 1.6J' }, { value: '2.0.1', label: 'OCPP 2.0.1' }] },
        { name: 'connector_type', label: 'Conector', type: 'select', required: true, half: true, options: ['Tipo 2', 'Tipo 1', 'CCS2', 'CCS1', 'CHAdeMO', 'Schuko'].map((v) => ({ value: v, label: v })) },
        { name: 'max_kw', label: 'Potencia máxima (kW)', type: 'number', half: true },
        { name: 'phases', label: 'Fases', type: 'select', numeric: true, half: true, options: [{ value: 1, label: 'Monofásico' }, { value: 3, label: 'Trifásico' }] },
        { name: 'connectors', label: 'Cantidad de conectores', type: 'number', half: true },
        { name: 'rfid', label: 'Lector RFID', type: 'checkbox', help: 'Tiene lector de tarjetas RFID' },
        { name: 'smart_charging', label: 'Smart charging', type: 'checkbox', help: 'Acepta límites de potencia (SetChargingProfile)' },
        { name: 'local_list', label: 'Lista local', type: 'checkbox', help: 'Guarda las tarjetas para autorizar sin internet' },
        { name: 'remote_start', label: 'Inicio remoto', type: 'checkbox', help: 'Se puede iniciar desde la app o el QR' },
        { name: 'ute_approved', label: 'Homologado UTE', type: 'checkbox', help: 'Modelo homologado por UTE' },
        { name: 'h3', type: 'heading', label: 'Configuración OCPP' },
        { name: 'config', label: 'Claves a aplicar (JSON)', type: 'textarea', mono: true, rows: 8, help: 'Se envían con ChangeConfiguration cuando el equipo se aprueba y cada vez que se reconecta.' },
        { name: 'notes', label: 'Notas', type: 'textarea', rows: 3, placeholder: 'Particularidades del firmware, ajustes de fábrica, etc.' },
        { name: 'active', label: 'Activo', type: 'checkbox', help: 'Se usa para detectar equipos nuevos' },
      ]}
      columns={[
        { label: 'Driver', render: (r) => <><b>{r.name}</b>{r.ute_approved && <span className="badge mini ok" style={{ marginLeft: 8 }}><span className="dot" />UTE</span>}<div className="subtle mono">{r.vendor === '*' ? 'Cualquier marca' : r.vendor} · {r.model_pattern === '*' ? 'cualquier modelo' : r.model_pattern}</div></> },
        { label: 'Equipo', render: (r) => <>{r.connector_type}{r.max_kw ? ` · ${String(r.max_kw).replace('.', ',')} kW` : ''}<div className="subtle">OCPP {r.ocpp_version}{r.phases ? ` · ${r.phases === 3 ? 'trifásico' : 'monofásico'}` : ''}</div></> },
        { label: 'Funciones', render: (r) => <span className="feats">{yes(r.rfid, 'RFID')}{yes(r.smart_charging, 'Potencia')}{yes(r.local_list, 'Sin internet')}{yes(r.remote_start, 'Remoto')}</span> },
        { label: 'Claves', right: true, render: (r) => <span data-tip={Object.entries(r.config || {}).map(([k, v]) => `${k}=${v}`).join('\n') || 'Sin claves'}>{Object.keys(r.config || {}).length}</span> },
        { label: 'En uso', right: true, render: (r) => r.chargers },
      ]}
    />
  );
}

// ---------- Auditoría ----------
const ACTIONS = { crear: ['plus', 'green', 'Creó'], editar: ['edit', 'blue', 'Editó'], eliminar: ['trash', 'red', 'Eliminó'], comando: ['bolt', 'orange', 'Comando'],
  ingreso: ['users', 'gray', 'Ingreso'], ingreso_fallido: ['alert', 'red', 'Ingreso fallido'] };
const ACTOR = { admin: 'Panel', app: 'App', sistema: 'Sistema' };
export function Audit() {
  const [f, setF] = useState({ q: '', actor: '', action: '', from: '', to: '' });
  const [rows, setRows] = useState(null);
  const [more, setMore] = useState(false);
  const [open, setOpen] = useState(null);
  const qs = (offset = 0) => new URLSearchParams(Object.fromEntries(Object.entries({ ...f, offset, limit: 100 }).filter(([, v]) => v !== ''))).toString();
  const load = (append = false) => api(`/audit?${qs(append ? rows.length : 0)}`).then((r) => { setRows(append ? [...rows, ...r] : r); setMore(r.length === 100); }).catch(() => setRows([]));
  useEffect(() => { const t = setTimeout(() => load(), 250); return () => clearTimeout(t); }, [f.q, f.actor, f.action, f.from, f.to]); // eslint-disable-line react-hooks/exhaustive-deps
  const csv = async () => {
    const res = await api(`/audit?${qs()}&format=csv`, { raw: true });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(await res.blob()), download: 'auditoria.csv' });
    a.click();
  };
  return (
    <div className="page">
      <PageHeader title="Auditoría" desc="Todo lo que se hizo en el panel, en la app y lo que hizo el sistema por su cuenta. No se puede editar ni borrar."
        actions={<button className="btn sec" onClick={csv}><Icon name="download" size={16} />Exportar CSV</button>} />
      <div className="toolbar">
        <span className="search"><Icon name="search" size={16} /><input placeholder="Buscar por persona, detalle o identificador" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} /></span>
        <Segmented value={f.actor} onChange={(v) => setF({ ...f, actor: v })} options={[['', 'Todo'], ['admin', 'Panel'], ['app', 'App'], ['sistema', 'Sistema']]} />
        <select className="sm" value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })} aria-label="Acción">
          <option value="">Todas las acciones</option>{Object.entries(ACTIONS).map(([k, v]) => <option key={k} value={k}>{v[2]}</option>)}
        </select>
        <input className="sm" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} aria-label="Desde" data-tip="Desde" />
        <input className="sm" type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} aria-label="Hasta" data-tip="Hasta" />
      </div>
      {!rows ? <Loading rows={6} /> : rows.length === 0 ? (
        <div className="card"><Empty icon="list" title="Sin registros">No hay acciones que coincidan con los filtros.</Empty></div>
      ) : (
        <div className="card flush">
          <ul className="audit">
            {rows.map((r) => {
              const [icon, tone, label] = ACTIONS[r.action] || ['list', 'gray', r.action];
              return (
                <li key={r.id} onClick={() => setOpen(r)}>
                  <span className={`a-ico ${tone}`} data-tip={label}><Icon name={icon} size={14} /></span>
                  <div className="a-main"><b>{r.actor_name || ACTOR[r.actor_type]}</b> {r.summary}<div className="subtle">{ACTOR[r.actor_type]}{r.ip ? ` · ${r.ip}` : ''}</div></div>
                  <time data-tip={dt(r.at)}>{ago(r.at)}</time>
                  <Icon name="chevronRight" size={15} className="subtle" />
                </li>
              );
            })}
          </ul>
          {more && <div style={{ padding: 12, textAlign: 'center' }}><button className="btn sec sm" onClick={() => load(true)}>Ver más</button></div>}
        </div>
      )}
      {open && (
        <Modal icon={(ACTIONS[open.action] || ['list'])[0]} tone={(ACTIONS[open.action] || [0, 'blue'])[1] === 'gray' ? 'blue' : (ACTIONS[open.action] || [0, 'blue'])[1]} size="lg"
          title={`${open.actor_name || ACTOR[open.actor_type]} ${open.summary}`} subtitle={dt(open.at)} onClose={() => setOpen(null)}>
          <dl className="kv">
            <dt>Quién</dt><dd>{open.actor_name || '—'} <span className="subtle">({ACTOR[open.actor_type]})</span></dd>
            <dt>Acción</dt><dd>{(ACTIONS[open.action] || [0, 0, open.action])[2]}</dd>
            <dt>Recurso</dt><dd className="mono">{open.entity || '—'}{open.entity_id ? ` #${open.entity_id}` : ''}</dd>
            <dt>Dirección IP</dt><dd className="mono">{open.ip || '—'}</dd>
          </dl>
          {open.data && <><div className="form-sec" style={{ marginTop: 18 }}>Datos enviados</div><pre className="json">{JSON.stringify(open.data, null, 2)}</pre></>}
        </Modal>
      )}
    </div>
  );
}
