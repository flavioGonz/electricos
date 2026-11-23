// Usuarios de la app: lista con números de uso y una ficha por persona (perfil, cargas, seguridad y actividad).
import React, { useMemo, useState } from 'react';
import { Modal, Field, PageHeader, Loading, Empty, Segmented, Stat, Switch } from './components/ui.jsx';
import { Select } from './components/select.jsx';
import { Icon } from './components/icons.jsx';
import { TempPassword } from './settings.jsx';
import { api, kwh, money, dt, ago } from './api.js';
import { useApi, act } from './hooks.js';

const thisMonth = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`; };
const initials = (n = '') => n.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?';
const HUES = [212, 152, 24, 268, 340, 190, 40];
const hue = (id) => HUES[Number(id) % HUES.length];
const monthLabel = (m) => new Date(`${m}-15T12:00:00`).toLocaleDateString('es-UY', { month: 'short' }).replace('.', '');
const dur = (a, b) => {
  const m = Math.max(0, Math.round(((b ? new Date(b) : new Date()) - new Date(a)) / 60000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
};

function Avatar({ u, size = 36 }) {
  return (
    <span className={'au-av' + (u.active ? '' : ' off')} style={{ width: size, height: size, fontSize: size * 0.38, '--h': hue(u.id) }}>
      {initials(u.name)}
      {u.active_now && <i className="au-live" aria-label="Cargando ahora" />}
    </span>
  );
}

function StatusBadges({ u }) {
  return (
    <span className="au-badges">
      {!u.active ? <span className="badge mini gris"><span className="dot" />Deshabilitado</span>
        : u.locked_until ? <span className="badge mini falla" data-tip={`Bloqueado por intentos fallidos hasta ${dt(u.locked_until)}`}><Icon name="lock" size={11} />Bloqueado</span>
          : u.active_now ? <span className="badge mini ok live"><span className="dot" />Cargando</span>
            : <span className="badge mini ok"><span className="dot" />Activo</span>}
      {u.telegram && <span className="badge mini info" data-tip="Tiene Telegram vinculado"><Icon name="telegram" size={11} /></span>}
    </span>
  );
}

export function AppUsers() {
  const { data, reload } = useApi('/app-users', { live: true });
  const accounts = useApi('/accounts').data || [];
  const [filter, setFilter] = useState('');
  const [state, setState] = useState('todos');
  const [sort, setSort] = useState('name');
  const [create, setCreate] = useState(null);
  const [temp, setTemp] = useState(null);
  const [open, setOpen] = useState(null);
  const all = data || [];
  const rows = useMemo(() => {
    const f = filter.toLowerCase();
    const r = all.filter((u) =>
      (state === 'todos' || (state === 'activos' ? u.active : state === 'bloqueados' ? !!u.locked_until : state === 'cargando' ? u.active_now : !u.active)) &&
      (!f || `${u.name} ${u.email} ${u.phone || ''} ${u.account_name} ${u.account_unit || ''} ${u.site_name || ''}`.toLowerCase().includes(f)));
    const by = {
      name: (a, b) => a.name.localeCompare(b.name),
      energy: (a, b) => Number(b.energy_wh) - Number(a.energy_wh),
      recent: (a, b) => new Date(b.last_charge || 0) - new Date(a.last_charge || 0),
      login: (a, b) => new Date(b.last_login_at || 0) - new Date(a.last_login_at || 0),
    }[sort];
    return [...r].sort(by);
  }, [all, filter, state, sort]);
  const tot = useMemo(() => {
    const month30 = Date.now() - 30 * 864e5;
    return {
      active: all.filter((u) => u.active).length,
      recent: all.filter((u) => u.last_charge && new Date(u.last_charge) > month30).length,
      now: all.filter((u) => u.active_now).length,
      locked: all.filter((u) => u.locked_until).length,
      energy: all.reduce((a, u) => a + Number(u.energy_wh || 0), 0),
    };
  }, [all]);
  const save = () => act(() => api('/app-users', { method: 'POST', body: { ...create, account_id: Number(create.account_id) } }), 'Usuario creado')
    .then((r) => { setCreate(null); reload(); if (r.temp_password) setTemp({ who: r.name, password: r.temp_password }); }).catch(() => {});
  return (
    <div className="page">
      <PageHeader title="Usuarios de la app" desc="Las personas que cargan con el celular. Abrí una para ver sus cargas, cambiarle la contraseña o revisar qué hizo."
        actions={<button className="btn" onClick={() => setCreate({ account_id: accounts[0]?.id || '', name: '', email: '', phone: '', password: '' })}><Icon name="plus" size={16} />Nuevo</button>} />
      {data && all.length > 0 && (
        <div className="stats" style={{ marginBottom: 16 }}>
          <Stat icon="users" label="Usuarios activos" value={`${tot.active} de ${all.length}`} />
          <Stat icon="bolt" label="Cargaron en 30 días" value={tot.recent} />
          <Stat icon="plug" label="Cargando ahora" value={tot.now} tone={tot.now ? 'ok' : undefined} />
          <Stat icon="power" label="Energía total" value={kwh(tot.energy)} />
          {tot.locked > 0 && <Stat icon="lock" label="Bloqueados" value={tot.locked} tone="warn" />}
        </div>
      )}
      <div className="toolbar">
        <span className="search"><Icon name="search" size={16} /><input placeholder="Buscar por nombre, email, celular, cuenta o sitio" value={filter} onChange={(e) => setFilter(e.target.value)} /></span>
        <Segmented value={state} onChange={setState} options={[['todos', 'Todos'], ['activos', 'Activos'], ['cargando', 'Cargando'], ['bloqueados', 'Bloqueados'], ['inactivos', 'Deshabilitados']]} />
        <Select size="sm" icon="filter" ariaLabel="Ordenar" value={sort} onChange={setSort} options={[['name', 'Por nombre'], ['energy', 'Más energía'], ['recent', 'Carga más reciente'], ['login', 'Último ingreso']]} />
      </div>
      {!data ? <Loading rows={5} /> : rows.length === 0 ? (
        <div className="card"><Empty icon="users" title={all.length ? 'Nadie coincide con la búsqueda' : 'Todavía nadie se registró'}>Los residentes se registran desde la app con el código de invitación de su cuenta, o los podés crear acá.</Empty></div>
      ) : (
        <div className="card flush"><div className="tablewrap"><table className="table au-table">
          <thead><tr><th>Usuario</th><th>Cuenta</th><th className="right">Cargas</th><th className="right">Energía</th><th className="right">Gasto</th><th>Última carga</th><th>Estado</th><th /></tr></thead>
          <tbody>{rows.map((u) => (
            <tr key={u.id} className="clickable" tabIndex={0} onClick={() => setOpen(u.id)} onKeyDown={(e) => e.key === 'Enter' && setOpen(u.id)}>
              <td><div className="au-who"><Avatar u={u} /><div><b>{u.name}</b><div className="subtle">{u.email}{u.phone ? ` · ${u.phone}` : ''}</div></div></div></td>
              <td>{u.account_unit ? `${u.account_unit} · ` : ''}{u.account_name}<div className="subtle">{u.site_name ? `${u.site_name} · ` : ''}{u.billing_mode === 'prepaid' ? 'Prepago' : 'Pospago'}</div></td>
              <td className="right">{u.sessions || 0}</td>
              <td className="right kwh">{kwh(u.energy_wh)}</td>
              <td className="right kwh">{money(u.amount)}</td>
              <td>{u.last_charge ? <span data-tip={dt(u.last_charge)}>{ago(u.last_charge)}</span> : <span className="subtle">Nunca</span>}</td>
              <td><StatusBadges u={u} /></td>
              <td className="actions"><Icon name="more" size={16} /></td>
            </tr>
          ))}</tbody>
        </table></div></div>
      )}
      {open && <UserPanel id={open} accounts={accounts} onClose={() => setOpen(null)} onChange={reload} onTemp={setTemp} />}
      {create && (
        <Modal icon="users" title="Nuevo usuario de la app" subtitle="Va a poder cargar con el celular a cuenta de la unidad elegida." onClose={() => setCreate(null)}
          footer={<><button className="btn sec" data-close onClick={() => setCreate(null)}>Cancelar</button><button className="btn" onClick={save}><Icon name="plus" size={16} />Crear</button></>}>
          <div className="form-grid">
            <Field className="full" label="Cuenta"><Select value={create.account_id} onChange={(x) => setCreate({ ...create, account_id: x })} placeholder="Elegí la cuenta" options={accounts.map((a) => ({ value: a.id, label: `${a.unit ? `${a.unit} · ` : ''}${a.name}` }))} /></Field>
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

// ---------- Ficha de un usuario ----------
function UserPanel({ id, accounts, onClose, onChange, onTemp }) {
  const { data: u, reload } = useApi(`/app-users/${id}`, { live: true });
  const [tab, setTab] = useState('resumen');
  const refresh = () => { reload(); onChange(); };
  return (
    <Modal size="wide" icon="users" tone="accent" title={u?.name || 'Usuario'} subtitle={u ? `${u.email}${u.account_name ? ` · ${u.account_unit ? `${u.account_unit} · ` : ''}${u.account_name}` : ''}` : 'Cargando…'} onClose={onClose}>
      {!u ? <Loading rows={4} /> : (
        <div className="au-panel">
          <div className="au-hero">
            <Avatar u={u} size={56} />
            <div className="au-hero-t">
              <div className="au-hero-n">{u.name}</div>
              <StatusBadges u={u} />
              <div className="subtle">Alta {dt(u.created_at)} · Último ingreso {u.last_login_at ? ago(u.last_login_at) : 'nunca'}</div>
            </div>
            <dl className="au-nums">
              <div><dt>Cargas</dt><dd>{u.sessions || 0}</dd></div>
              <div><dt>Energía</dt><dd>{kwh(u.energy_wh)}</dd></div>
              <div><dt>Gasto</dt><dd>{money(u.amount)}</dd></div>
            </dl>
          </div>
          <Segmented value={tab} onChange={setTab} options={[['resumen', 'Resumen'], ['cargas', 'Cargas'], ['seguridad', 'Seguridad'], ['actividad', 'Actividad']]} />
          <div className="au-tab">
            {tab === 'resumen' && <Resumen u={u} accounts={accounts} onSaved={refresh} />}
            {tab === 'cargas' && <Cargas u={u} />}
            {tab === 'seguridad' && <Seguridad u={u} onDone={refresh} onTemp={onTemp} />}
            {tab === 'actividad' && <Actividad u={u} />}
          </div>
        </div>
      )}
    </Modal>
  );
}

function Resumen({ u, accounts, onSaved }) {
  const [f, setF] = useState({ name: u.name, email: u.email, phone: u.phone || '', account_id: u.account_id });
  const dirty = f.name !== u.name || f.email !== u.email || (f.phone || '') !== (u.phone || '') || Number(f.account_id) !== u.account_id;
  const patch = (body, msg) => act(() => api(`/app-users/${u.id}`, { method: 'PATCH', body }), msg).then(onSaved).catch(() => {});
  const save = () => patch({ ...f, phone: f.phone || null, account_id: Number(f.account_id) }, 'Datos guardados');
  return (
    <div className="au-grid">
      <section className="au-sec">
        <h4>Datos</h4>
        <div className="form-grid">
          <Field className="full" label="Nombre"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Email" hint="Es con lo que entra a la app."><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Celular"><input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="09x xxx xxx" /></Field>
          <Field className="full" label="Cuenta a la que carga" hint="Si la cambiás, sus cargas nuevas van a la cuenta nueva.">
            <Select value={f.account_id} onChange={(x) => setF({ ...f, account_id: x })} search options={accounts.map((a) => ({ value: a.id, label: `${a.unit ? `${a.unit} · ` : ''}${a.name}` }))} />
          </Field>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
          <button className="btn sec" disabled={!dirty} onClick={() => setF({ name: u.name, email: u.email, phone: u.phone || '', account_id: u.account_id })}>Descartar</button>
          <button className="btn" disabled={!dirty} onClick={save}><Icon name="save" size={16} />Guardar</button>
        </div>
      </section>
      <section className="au-sec">
        <h4>Avisos que recibe</h4>
        <div className="au-switches">
          <Switch label="WhatsApp al terminar una carga" checked={u.notify_whatsapp} onChange={(v) => patch({ notify_whatsapp: v }, 'Preferencia guardada')} />
          <Switch label="Correo al terminar una carga" checked={u.notify_email} onChange={(v) => patch({ notify_email: v }, 'Preferencia guardada')} />
          <Switch label={u.telegram ? 'Telegram al terminar una carga' : 'Telegram (no vinculado todavía)'} checked={u.notify_telegram && u.telegram} onChange={(v) => u.telegram && patch({ notify_telegram: v }, 'Preferencia guardada')} />
        </div>
        <h4 style={{ marginTop: 20 }}>Últimos 12 meses</h4>
        <MonthBars months={u.months || []} />
      </section>
    </div>
  );
}

function MonthBars({ months }) {
  const list = useMemo(() => {
    const out = [];
    const d = new Date(); d.setDate(15);
    for (let i = 11; i >= 0; i--) {
      const x = new Date(d.getFullYear(), d.getMonth() - i, 15);
      const key = `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`;
      out.push(months.find((m) => m.month === key) || { month: key, sessions: 0, energy_wh: 0, amount: 0 });
    }
    return out;
  }, [months]);
  const max = Math.max(1, ...list.map((m) => Number(m.energy_wh)));
  if (!months.length) return <div className="subtle" style={{ fontSize: 13.5 }}>Todavía no cargó en el último año.</div>;
  return (
    <div className="au-months" role="img" aria-label="Energía por mes">
      {list.map((m) => (
        <div key={m.month} className="au-m" data-tip={`${monthLabel(m.month)}: ${kwh(m.energy_wh)} · ${m.sessions} cargas · ${money(m.amount)}`}>
          <span className="au-mb">{Number(m.energy_wh) > 0 && <i style={{ height: `${Math.max(4, (Number(m.energy_wh) / max) * 100)}%` }} />}</span>
          <span className="au-ml">{monthLabel(m.month)[0].toUpperCase()}</span>
        </div>
      ))}
    </div>
  );
}

function Cargas({ u }) {
  const [month, setMonth] = useState('');
  const { data } = useApi(`/app-users/${u.id}/sessions${month ? `?month=${month}` : ''}`, { live: true });
  const done = (data || []).filter((s) => s.status === 'completed');
  const sum = done.reduce((a, s) => ({ wh: a.wh + Number(s.energy_wh || 0), amt: a.amt + Number(s.amount || 0) }), { wh: 0, amt: 0 });
  const csv = () => {
    const head = ['Inicio', 'Fin', 'Cargador', 'Sitio', 'Estado', 'kWh', 'Importe', 'Motivo'];
    const lines = (data || []).map((s) => [dt(s.started_at), dt(s.stopped_at), s.charger_name, s.site_name || '', s.status, (Number(s.energy_wh ?? s.live_wh ?? 0) / 1000).toFixed(3).replace('.', ','), String(s.amount ?? '').replace('.', ','), s.stop_reason || '']);
    const body = [head, ...lines].map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8' }));
    a.download = `cargas-${u.name.replace(/\s+/g, '-').toLowerCase()}${month ? `-${month}` : ''}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <div>
      <div className="row wrap" style={{ gap: 10, alignItems: 'end', marginBottom: 12 }}>
        <Field label="Mes"><input type="month" value={month} max={thisMonth()} onChange={(e) => setMonth(e.target.value)} /></Field>
        {month && <button className="btn ghost sm" onClick={() => setMonth('')}>Ver todas</button>}
        <span className="grow" />
        <button className="btn sec sm" disabled={!data?.length} onClick={csv}><Icon name="download" size={15} />Exportar CSV</button>
      </div>
      {!data ? <Loading rows={3} /> : data.length === 0 ? (
        <Empty icon="bolt" title={month ? 'Sin cargas en ese mes' : 'Todavía no cargó'}>Cuando cargue con la app vas a ver acá cada carga con su energía e importe.</Empty>
      ) : (
        <>
          <div className="au-sum"><span><b>{done.length}</b> cargas</span><span><b>{kwh(sum.wh)}</b></span><span><b>{money(sum.amt)}</b></span>{data.length >= 500 && <span className="subtle">Se muestran las últimas 500</span>}</div>
          <div className="card flush"><div className="tablewrap"><table className="table">
            <thead><tr><th>Inicio</th><th>Cargador</th><th>Duración</th><th className="right">Energía</th><th className="right">Importe</th><th>Estado</th></tr></thead>
            <tbody>{data.map((s) => (
              <tr key={s.id}>
                <td>{dt(s.started_at)}</td>
                <td>{s.charger_name}<div className="subtle">{s.site_name || ''}</div></td>
                <td>{dur(s.started_at, s.stopped_at)}</td>
                <td className="right kwh">{kwh(s.status === 'active' ? s.live_wh : s.energy_wh)}</td>
                <td className="right kwh">{s.status === 'active' ? '—' : money(s.amount)}</td>
                <td>{s.status === 'active' ? <span className="badge mini ok live"><span className="dot" />En curso</span>
                  : s.status === 'completed' ? <span className="badge mini gris" data-tip={s.stop_reason || ''}>Terminada</span>
                    : <span className="badge mini warn">{s.status}</span>}</td>
              </tr>
            ))}</tbody>
          </table></div></div>
        </>
      )}
    </div>
  );
}

function Seguridad({ u, onDone, onTemp }) {
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [show, setShow] = useState(false);
  const [logout, setLogout] = useState(true);
  const ok = pass.length >= 6 && pass === pass2;
  const setPassword = () => act(() => api(`/app-users/${u.id}/password`, { method: 'POST', body: { password: pass, logout } }), 'Contraseña cambiada')
    .then(() => { setPass(''); setPass2(''); onDone(); }).catch(() => {});
  const temp = () => act(() => api(`/app-users/${u.id}/reset-password`, { method: 'POST' })).then((r) => { onTemp({ who: u.name, password: r.temp_password }); onDone(); }).catch(() => {});
  const unlock = () => act(() => api(`/app-users/${u.id}/unlock`, { method: 'POST' }), 'Usuario desbloqueado').then(onDone).catch(() => {});
  const kick = () => act(() => api(`/app-users/${u.id}/logout`, { method: 'POST' }), 'Sesiones cerradas en todos sus dispositivos').then(onDone).catch(() => {});
  const toggle = () => act(() => api(`/app-users/${u.id}`, { method: 'PATCH', body: { active: !u.active } }), u.active ? 'Usuario deshabilitado' : 'Usuario habilitado').then(onDone).catch(() => {});
  return (
    <div className="au-grid">
      <section className="au-sec">
        <h4>Cambiar contraseña</h4>
        <p className="subtle au-p">Ponele una contraseña que vos elijas, por ejemplo si te la pide por teléfono.</p>
        <div className="form-grid">
          <Field label="Nueva contraseña" hint="Al menos 6 caracteres.">
            <span className="au-pw"><input type={show ? 'text' : 'password'} value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" />
              <button type="button" className="btn ghost icon sm" aria-label={show ? 'Ocultar' : 'Mostrar'} onClick={() => setShow(!show)}><Icon name="eye" size={15} /></button></span>
          </Field>
          <Field label="Repetila" hint={pass2 && pass !== pass2 ? 'No coinciden.' : undefined}><input type={show ? 'text' : 'password'} value={pass2} onChange={(e) => setPass2(e.target.value)} autoComplete="new-password" /></Field>
        </div>
        <Switch label="Cerrar la sesión en sus dispositivos" checked={logout} onChange={setLogout} />
        <div className="row wrap" style={{ gap: 8, marginTop: 12 }}>
          <button className="btn" disabled={!ok} onClick={setPassword}><Icon name="lock" size={16} />Guardar contraseña</button>
          <button className="btn sec" onClick={temp} data-tip="Genera una al azar y te la muestra una vez"><Icon name="repeat" size={16} />Generar temporal</button>
        </div>
      </section>
      <section className="au-sec">
        <h4>Acceso</h4>
        <ul className="au-acts">
          <li>
            <span className={'au-ai ' + (u.locked_until ? 'red' : 'green')}><Icon name="lock" size={16} /></span>
            <div><b>{u.locked_until ? 'Bloqueado por intentos fallidos' : 'Sin bloqueos'}</b><div className="subtle">{u.locked_until ? `Hasta ${dt(u.locked_until)}` : 'Se bloquea solo tras varios intentos con la contraseña equivocada.'}</div></div>
            {u.locked_until && <button className="btn sec sm" onClick={unlock}>Desbloquear</button>}
          </li>
          <li>
            <span className="au-ai blue"><Icon name="phone" size={16} /></span>
            <div><b>Sesiones abiertas</b><div className="subtle">Último ingreso {u.last_login_at ? ago(u.last_login_at) : 'nunca'}. Útil si perdió el celular.</div></div>
            <button className="btn sec sm" onClick={kick}>Cerrar todas</button>
          </li>
          <li>
            <span className={'au-ai ' + (u.active ? 'green' : 'gray')}><Icon name="power" size={16} /></span>
            <div><b>{u.active ? 'Habilitado' : 'Deshabilitado'}</b><div className="subtle">{u.active ? 'Puede entrar y cargar.' : 'No puede entrar ni cargar con la app.'}</div></div>
            <button className={'btn sm ' + (u.active ? 'danger' : '')} onClick={toggle}>{u.active ? 'Deshabilitar' : 'Habilitar'}</button>
          </li>
        </ul>
      </section>
    </div>
  );
}

const ACT_ICON = { login: 'eye', crear: 'plus', editar: 'edit', eliminar: 'trash', comando: 'bolt' };
function Actividad({ u }) {
  const { data } = useApi(`/app-users/${u.id}/activity`);
  if (!data) return <Loading rows={3} />;
  if (!data.length) return <Empty icon="history" title="Sin actividad registrada">Acá aparecen sus ingresos, cambios de datos y lo que hagan los administradores con su usuario.</Empty>;
  return (
    <ul className="au-feed">
      {data.map((a) => (
        <li key={a.id}>
          <span className={'au-ai ' + (a.actor_type === 'admin' ? 'blue' : 'green')}><Icon name={ACT_ICON[a.action] || 'history'} size={14} /></span>
          <div><b>{a.summary || a.action}</b><div className="subtle">{a.actor_type === 'admin' ? `Panel · ${a.actor_name || 'administrador'}` : a.actor_type === 'app' ? 'Desde la app' : 'Sistema'}{a.ip ? ` · ${a.ip}` : ''}</div></div>
          <time data-tip={dt(a.at)}>{ago(a.at)}</time>
        </li>
      ))}
    </ul>
  );
}
