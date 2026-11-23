// Configuración: usuarios del panel, usuarios de la app, drivers de cargadores y auditoría.
import React, { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
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
  const [mfa, setMfa] = useState(false);
  const [sec, setSec] = useState(false);
  const unlock = (row, reload) => act(() => api(`/admins/${row.id}/unlock`, { method: 'POST' }), `${row.name} puede volver a entrar`).then(reload).catch(() => {});
  const reset2fa = (row, reload) => act(() => api(`/admins/${row.id}/reset-2fa`, { method: 'POST' }), 'Doble factor desactivado: lo tiene que volver a configurar').then(reload).catch(() => {});
  return (
    <>
      <CrudPage title="Usuarios del panel" singular="usuario" icon="users" path="/admins"
        desc="Quién entra a este panel y qué puede hacer. Cada acción queda registrada en la auditoría."
        defaults={{ role: 'operador', active: true }}
        extraActions={<>
          {me?.level === 'admin' && <button className="btn ghost icon" aria-label="Política de seguridad" data-tip="Intentos, bloqueo y doble factor obligatorio" onClick={() => setSec(true)}><Icon name="settings" size={16} /></button>}
          <button className="btn sec" onClick={() => setMfa(true)}><Icon name="checkCircle" size={16} />Doble factor</button>
          <button className="btn sec" onClick={() => setPass({ current: '', next: '' })}><Icon name="lock" size={16} />Mi contraseña</button>
        </>}
        canDelete={(r) => r.id !== me?.id}
        onSaved={(row) => row?.temp_password && setTemp({ who: row.name, password: row.temp_password })}
        rowActions={(row, reload) => <>
          {row.locked_until && <button className="btn ghost icon sm" aria-label="Desbloquear" data-tip="Quitar el bloqueo por intentos fallidos" onClick={() => unlock(row, reload)}><Icon name="lock" size={15} /></button>}
          {row.totp_enabled && row.id !== me?.id && me?.level === 'admin' && <button className="btn ghost icon sm" aria-label="Quitar doble factor" data-tip="Quitar el doble factor (perdió el teléfono)" onClick={() => reset2fa(row, reload)}><Icon name="x" size={15} /></button>}
          <button className="btn ghost icon sm" aria-label="Restablecer contraseña" data-tip="Generar una contraseña nueva" onClick={() => reset(row)}><Icon name="repeat" size={15} /></button>
        </>}
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
          { label: 'Doble factor', render: (r) => (r.totp_enabled ? <span className="badge mini ok"><span className="dot" />Activo</span> : <span className="subtle">No</span>) },
          { label: 'Estado', render: (r) => (r.locked_until ? <span className="badge mini falla" data-tip={`Bloqueado hasta ${dt(r.locked_until)}`}><span className="dot" />Bloqueado</span> : r.active ? <span className="badge mini ok"><span className="dot" />Activo</span> : <span className="badge mini gris"><span className="dot" />Deshabilitado</span>) },
        ]}
      />
      {mfa && <TwoFactor onClose={() => setMfa(false)} />}
      {sec && <SecurityPolicy onClose={() => setSec(false)} />}
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

// ---------- Doble factor del propio usuario ----------
export function TwoFactor({ onClose }) {
  const { data: me, reload } = useApi('/me');
  const [setup, setSetup] = useState(null);
  const [svg, setSvg] = useState('');
  const [code, setCode] = useState('');
  const [pwd, setPwd] = useState('');
  const start = () => act(() => api('/me/2fa/setup', { method: 'POST' })).then(async (r) => { setSetup(r); setSvg(await QRCode.toString(r.uri, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#1d1d1f', light: '#ffffff' } })); }).catch(() => {});
  const enable = () => act(() => api('/me/2fa/enable', { method: 'POST', body: { code } }), 'Doble factor activado').then(() => { setSetup(null); setCode(''); reload(); }).catch(() => setCode(''));
  const disable = () => act(() => api('/me/2fa/disable', { method: 'POST', body: { password: pwd } }), 'Doble factor desactivado').then(() => { setPwd(''); reload(); }).catch(() => {});
  return (
    <Modal icon="checkCircle" tone="green" title="Doble factor" subtitle="Un código del teléfono además de la contraseña" onClose={onClose}
      footer={<><button className="btn sec" data-close onClick={onClose}>Cerrar</button>
        {me && !me.totp && setup && <button className="btn" disabled={code.replace(/\D/g, '').length < 6} onClick={enable}><Icon name="check" size={16} />Activar</button>}
        {me && !me.totp && !setup && <button className="btn" onClick={start}>Empezar</button>}
        {me?.totp && <button className="btn danger" disabled={!pwd} onClick={disable}>Desactivar</button>}</>}>
      {!me ? <Loading rows={3} /> : me.totp ? (
        <>
          <div className="mfa-state ok"><Icon name="checkCircle" size={22} /><div><b>Está activo</b><p className="muted">Cada vez que entres te vamos a pedir el código de tu app de autenticación{me.phone ? ', o te lo mandamos por WhatsApp' : ''}.</p></div></div>
          <div className="form-grid" style={{ marginTop: 18 }}>
            <Field className="full" label="Para desactivarlo, poné tu contraseña"><input type="password" autoComplete="current-password" value={pwd} onChange={(e) => setPwd(e.target.value)} /></Field>
          </div>
        </>
      ) : !setup ? (
        <>
          <div className="mfa-state"><Icon name="lock" size={22} /><div><b>Todavía no está activo</b><p className="muted">Si alguien consigue tu contraseña, igual no puede entrar sin tu teléfono.</p></div></div>
          <ol className="mfa-steps">
            <li>Instalá una app de autenticación: Google Authenticator, Microsoft Authenticator, Authy o la de tu gestor de contraseñas.</li>
            <li>Escaneá el código QR que te mostramos.</li>
            <li>Escribí el código de 6 dígitos para confirmar.</li>
          </ol>
          {!me.phone && <p className="muted" style={{ fontSize: 13 }}>Si además cargás tu celular en tu usuario, podés pedir el código por WhatsApp cuando no tengas la app a mano.</p>}
        </>
      ) : (
        <div className="mfa-setup">
          <div className="qr mfa-qr" dangerouslySetInnerHTML={{ __html: svg }} />
          <p className="muted" style={{ fontSize: 13, textAlign: 'center' }}>¿No podés escanear? Cargá esta clave a mano:<br /><b className="mono" style={{ fontSize: 14, color: 'var(--text)' }}>{setup.secret}</b></p>
          <Field className="full" label="Código de 6 dígitos"><input className="otp" inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={(e) => setCode(e.target.value.replace(/[^0-9 ]/g, ''))} placeholder="000 000" autoFocus /></Field>
        </div>
      )}
    </Modal>
  );
}

function SecurityPolicy({ onClose }) {
  const { data } = useApi('/settings');
  const [v, setV] = useState(null);
  useEffect(() => { if (data) setV(data.seguridad || {}); }, [data]);
  const save = () => act(() => api('/settings/seguridad', { method: 'PUT', body: { ...v, max_attempts: Number(v.max_attempts), lock_minutes: Number(v.lock_minutes) } }), 'Política guardada').then(onClose).catch(() => {});
  return (
    <Modal icon="lock" title="Política de seguridad" subtitle="Para el panel y la app" size="sm" onClose={onClose}
      footer={<><button className="btn sec" data-close onClick={onClose}>Cancelar</button><button className="btn" disabled={!v} onClick={save}>Guardar</button></>}>
      {!v ? <Loading rows={3} /> : (
        <div className="form-grid">
          <Field label="Intentos fallidos" hint="Antes de bloquear"><input type="number" min="3" max="20" value={v.max_attempts ?? 5} onChange={(e) => setV({ ...v, max_attempts: e.target.value })} /></Field>
          <Field label="Minutos de bloqueo"><input type="number" min="1" max="1440" value={v.lock_minutes ?? 15} onChange={(e) => setV({ ...v, lock_minutes: e.target.value })} /></Field>
          <div className="field full"><Switch label="Doble factor obligatorio en el panel" checked={!!v.require_2fa_admins} onChange={(x) => setV({ ...v, require_2fa_admins: x })} /></div>
          <p className="muted full" style={{ fontSize: 13, margin: 0 }}>Con el doble factor obligatorio, quien no lo tenga activo ve un aviso para configurarlo cada vez que entra. Cuando un usuario queda bloqueado, avisamos a los administradores.</p>
        </div>
      )}
    </Modal>
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

// ---------- Avisos (WhatsApp y correo) ----------
const listToText = (a) => (a || []).join(', ');
const textToList = (t) => String(t || '').split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
export function Notifications({ me }) {
  const { data, reload } = useApi('/settings');
  const log = useApi('/notifications');
  const [wa, setWa] = useState(null);
  const [em, setEm] = useState(null);
  const [av, setAv] = useState(null);
  const [status, setStatus] = useState(null);
  const [test, setTest] = useState(null);
  const admin = me?.level === 'admin';
  useEffect(() => {
    if (!data) return;
    setWa(data.whatsapp); setEm(data.email);
    setAv({ ...data.avisos, admin_whatsapp: listToText(data.avisos.admin_whatsapp), admin_email: listToText(data.avisos.admin_email) });
  }, [data]);
  useEffect(() => { api('/settings/whatsapp/status').then(setStatus).catch(() => {}); }, [data]);
  const save = (name, body) => act(() => api(`/settings/${name}`, { method: 'PUT', body }), 'Configuración guardada').then(reload).catch(() => {});
  const sendTest = () => act(() => api('/settings/test', { method: 'POST', body: test }), 'Mensaje de prueba enviado').then(() => { setTest(null); log.reload(); }).catch(() => log.reload());
  if (!wa || !em || !av) return <div className="page"><PageHeader title="Avisos" /><Loading rows={4} /></div>;
  const b = data.backup_status;
  const waOk = /connected|ready|working|open|authenticated/i.test(status?.status || '');
  return (
    <div className="page">
      <PageHeader title="Avisos" desc="Mensajes automáticos por WhatsApp y correo: fin de carga, saldo bajo, alertas de los cargadores y el resultado del respaldo nocturno."
        actions={<button className="btn sec" onClick={() => setTest({ channel: 'whatsapp', to: '' })}><Icon name="mail" size={16} />Enviar prueba</button>} />
      <div className="set-grid">
        <section className="card set-card">
          <header><span className="sc-ico green"><Icon name="whatsapp" size={16} /></span><div><h3>WhatsApp</h3><p className="muted">Por el gateway OpenWA de Infratec.</p></div>
            <span className={`badge mini ${!wa.enabled ? 'gris' : waOk ? 'ok' : 'warn'}`} data-tip={status?.error || status?.phone || ''}><span className="dot" />{!wa.enabled ? 'Apagado' : status?.status || '…'}</span></header>
          <div className="form-grid">
            <div className="field full"><Switch label="Enviar avisos por WhatsApp" checked={wa.enabled} onChange={(v) => setWa({ ...wa, enabled: v })} /></div>
            <Field className="full" label="Dirección de OpenWA"><input value={wa.url} onChange={(e) => setWa({ ...wa, url: e.target.value })} placeholder="http://192.168.99.22:2785" /></Field>
            <Field label="Sesión"><input className="mono" value={wa.session} onChange={(e) => setWa({ ...wa, session: e.target.value })} /></Field>
            <Field label="Clave de API"><input type="password" value={wa.api_key} onChange={(e) => setWa({ ...wa, api_key: e.target.value })} /></Field>
          </div>
          {admin && <footer><button className="btn" onClick={() => save('whatsapp', wa)}><Icon name="check" size={16} />Guardar</button></footer>}
        </section>

        <section className="card set-card">
          <header><span className="sc-ico blue"><Icon name="mail" size={16} /></span><div><h3>Correo</h3><p className="muted">Servidor SMTP para enviar los emails.</p></div>
            <span className={`badge mini ${em.enabled && em.pass ? 'ok' : 'gris'}`}><span className="dot" />{em.enabled ? (em.pass ? 'Activo' : 'Falta la clave') : 'Apagado'}</span></header>
          <div className="form-grid">
            <div className="field full"><Switch label="Enviar avisos por correo" checked={em.enabled} onChange={(v) => setEm({ ...em, enabled: v })} /></div>
            <Field label="Servidor"><input value={em.host} onChange={(e) => setEm({ ...em, host: e.target.value })} /></Field>
            <Field label="Puerto"><input type="number" value={em.port} onChange={(e) => setEm({ ...em, port: Number(e.target.value) })} /></Field>
            <Field label="Usuario"><input value={em.user} onChange={(e) => setEm({ ...em, user: e.target.value })} placeholder="no-replay@infratec.com.uy" /></Field>
            <Field label="Contraseña" hint="En Google Workspace, una contraseña de aplicación."><input type="password" value={em.pass} onChange={(e) => setEm({ ...em, pass: e.target.value })} /></Field>
            <Field className="full" label="Remitente"><input value={em.from} onChange={(e) => setEm({ ...em, from: e.target.value })} /></Field>
          </div>
          {admin && <footer><button className="btn" onClick={() => save('email', em)}><Icon name="check" size={16} />Guardar</button></footer>}
        </section>

        <section className="card set-card wide">
          <header><span className="sc-ico rose"><Icon name="bell" size={16} /></span><div><h3>Qué se avisa y a quién</h3><p className="muted">Los usuarios reciben sus avisos en el celular y el email que cargaron; pueden apagarlos desde la app.</p></div></header>
          <div className="form-grid">
            <div className="field"><Switch label="Fin de carga, con kWh y costo" checked={av.fin_carga} onChange={(v) => setAv({ ...av, fin_carga: v })} /></div>
            <div className="field"><Switch label="Saldo bajo (cuentas prepagas)" checked={av.saldo_bajo} onChange={(v) => setAv({ ...av, saldo_bajo: v })} /></div>
            <div className="field"><Switch label="Alertas de cargadores al equipo técnico" checked={av.alertas} onChange={(v) => setAv({ ...av, alertas: v })} /></div>
            <div className="field"><Switch label="Respaldo nocturno fallido" checked={av.respaldo} onChange={(v) => setAv({ ...av, respaldo: v })} /></div>
            <Field label="Avisar saldo bajo por debajo de ($)"><input type="number" value={av.saldo_bajo_umbral} onChange={(e) => setAv({ ...av, saldo_bajo_umbral: Number(e.target.value) })} /></Field>
            <div />
            <Field className="full" label="Equipo técnico: WhatsApp" hint="Celulares separados por coma. Ejemplo: 099 123 456, 098 765 432"><input value={av.admin_whatsapp} onChange={(e) => setAv({ ...av, admin_whatsapp: e.target.value })} /></Field>
            <Field className="full" label="Equipo técnico: correo"><input value={av.admin_email} onChange={(e) => setAv({ ...av, admin_email: e.target.value })} placeholder="soporte@infratec.com.uy" /></Field>
          </div>
          {admin && <footer><button className="btn" onClick={() => save('avisos', { ...av, admin_whatsapp: textToList(av.admin_whatsapp), admin_email: textToList(av.admin_email) })}><Icon name="check" size={16} />Guardar</button></footer>}
        </section>
      </div>

      <div className="row between" style={{ margin: '26px 0 10px' }}>
        <h2 className="sec-title">Últimos avisos</h2>
        <span className="muted" style={{ fontSize: 13 }}>{b?.at ? <>Último respaldo {ago(b.at)} · {b.ok ? 'correcto' : 'con error'}</> : 'Sin respaldos registrados todavía'}</span>
      </div>
      {!log.data ? <Loading rows={3} /> : log.data.length === 0 ? <div className="card"><Empty icon="bell" title="Todavía no se envió ningún aviso" /></div> : (
        <div className="card flush"><div className="tablewrap"><table className="table">
          <thead><tr><th>Cuándo</th><th>Canal</th><th>Para</th><th>Aviso</th><th>Estado</th></tr></thead>
          <tbody>{log.data.map((n) => (
            <tr key={n.id}>
              <td style={{ whiteSpace: 'nowrap' }}><span data-tip={dt(n.at)}>{ago(n.at)}</span></td>
              <td><Icon name={n.channel === 'email' ? 'mail' : 'whatsapp'} size={15} /></td>
              <td className="mono">{n.to_addr}</td>
              <td><span data-tip={n.body}>{n.subject || n.body.split('\n')[0].slice(0, 70)}</span></td>
              <td><span className={`badge mini ${n.status === 'enviado' ? 'ok' : n.status === 'error' ? 'falla' : 'gris'}`} data-tip={n.error || ''}><span className="dot" />{n.status}</span></td>
            </tr>
          ))}</tbody>
        </table></div></div>
      )}

      {test && (
        <Modal icon="mail" tone="green" size="sm" title="Enviar un mensaje de prueba" onClose={() => setTest(null)}
          footer={<><button className="btn sec" data-close onClick={() => setTest(null)}>Cancelar</button><button className="btn" onClick={sendTest}><Icon name="arrowRight" size={16} />Enviar</button></>}>
          <div className="form-grid">
            <div className="field full"><Segmented value={test.channel} onChange={(v) => setTest({ ...test, channel: v })} options={[['whatsapp', 'WhatsApp'], ['email', 'Correo']]} /></div>
            <Field className="full" label={test.channel === 'email' ? 'Email' : 'Celular'}><input value={test.to} onChange={(e) => setTest({ ...test, to: e.target.value })} placeholder={test.channel === 'email' ? 'nombre@empresa.com' : '099 123 456'} /></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}
