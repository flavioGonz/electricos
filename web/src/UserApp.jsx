// App del usuario final (PWA, estilo iOS): se abre desde el QR del cargador (/c/:id) o desde /app.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from './components/icons.jsx';
import { Modal, Field, Segmented } from './components/ui.jsx';
import { toast } from './components/toast.jsx';
import { money, kwh } from './api.js';

const KEY = 'electricos_app_token';
const getTok = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const setTok = (t) => { try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY); } catch {} };

async function uapi(path, { method = 'GET', body } = {}) {
  const t = getTok();
  const res = await fetch('/api/app' + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(t ? { Authorization: 'Bearer ' + t } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && t) { setTok(null); window.dispatchEvent(new Event('app-logout')); }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

const BAND = { punta: 'Punta', llano: 'Llano', valle: 'Valle', unica: 'Tarifa única' };
const STATUS = {
  Available: ['Libre', 'green'], Preparing: ['Enchufado', 'blue'], Charging: ['Cargando', 'blue'], SuspendedEV: ['En pausa', 'orange'],
  SuspendedEVSE: ['En pausa', 'orange'], Finishing: ['Terminando', 'blue'], Reserved: ['Reservado', 'orange'], Unavailable: ['No disponible', 'gray'], Faulted: ['Con falla', 'red'],
};
const hhmm = (d) => new Date(d).toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const day = (d) => new Date(d).toLocaleDateString('es-UY', { weekday: 'short', day: 'numeric', month: 'short' });
const elapsed = (from) => {
  const m = Math.max(0, Math.floor((Date.now() - new Date(from)) / 60e3));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
};

function chargerState(c) {
  if (!c.online) return ['Sin conexión', 'gray'];
  const k = (c.connectors || [])[0];
  return STATUS[k?.status] || ['Disponible', 'green'];
}

/* ───────── Acceso ───────── */

function Auth({ onDone, chargerId }) {
  const [mode, setMode] = useState('login');
  const [v, setV] = useState({ name: '', email: '', phone: '', password: '', inviteCode: new URLSearchParams(location.search).get('invitacion') || '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const r = await uapi(mode === 'login' ? '/login' : '/register', { method: 'POST', body: mode === 'login' ? { email: v.email, password: v.password } : v });
      setTok(r.token);
      onDone();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="u-auth">
      <div className="u-auth-card">
        <span className="u-mark"><Icon name="bolt" size={28} /></span>
        <h1>{mode === 'login' ? 'Cargá tu auto' : 'Creá tu cuenta'}</h1>
        <p className="muted">{chargerId ? 'Iniciá sesión para usar este cargador.' : 'La energía que usás se suma a tu cuenta.'}</p>
        <Segmented value={mode} onChange={(m) => { setMode(m); setErr(''); }} options={[['login', 'Entrar'], ['register', 'Crear cuenta']]} />
        <form onSubmit={submit} className="u-form">
          {err && <div className="err-box">{err}</div>}
          <div className="u-group">
            {mode === 'register' && <label className="u-row"><span>Nombre</span><input value={v.name} onChange={set('name')} autoComplete="name" placeholder="Nombre y apellido" /></label>}
            <label className="u-row"><span>Email</span><input type="email" value={v.email} onChange={set('email')} autoComplete="email" placeholder="tu@email.com" /></label>
            {mode === 'register' && <label className="u-row"><span>Celular</span><input type="tel" value={v.phone} onChange={set('phone')} autoComplete="tel" placeholder="Opcional" /></label>}
            <label className="u-row"><span>Contraseña</span><input type="password" value={v.password} onChange={set('password')} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder={mode === 'login' ? '' : 'Mínimo 6 caracteres'} /></label>
          </div>
          {mode === 'register' && (
            <>
              <div className="u-group">
                <label className="u-row"><span>Código</span><input value={v.inviteCode} onChange={set('inviteCode')} placeholder="De tu edificio, opcional" style={{ textTransform: 'uppercase' }} /></label>
              </div>
              <p className="u-foot">Si vivís en un edificio o barrio con cargadores, la administración te da un código para que el consumo se sume a tu unidad. Sin código, cargás con saldo prepago.</p>
            </>
          )}
          <button className="btn lg block" disabled={busy}>{busy ? 'Un momento…' : mode === 'login' ? 'Entrar' : 'Crear cuenta'}</button>
        </form>
      </div>
    </div>
  );
}

/* ───────── Piezas ───────── */

function Group({ title, children, foot }) {
  return (
    <section className="u-sec">
      {title && <h3 className="u-sec-title">{title}</h3>}
      <div className="u-group">{children}</div>
      {foot && <p className="u-foot">{foot}</p>}
    </section>
  );
}
function Row({ icon, tone, label, sub, value, onClick, chevron }) {
  const C = onClick ? 'button' : 'div';
  return (
    <C className={'u-row' + (onClick ? ' tap' : '')} onClick={onClick} type={onClick ? 'button' : undefined}>
      {icon && <span className={`u-ico ${tone || ''}`}><Icon name={icon} size={16} /></span>}
      <span className="u-row-main"><span className="u-row-label">{label}</span>{sub && <span className="u-row-sub">{sub}</span>}</span>
      {value != null && <span className="u-row-value">{value}</span>}
      {chevron && <Icon name="chevronRight" size={16} className="u-chev" />}
    </C>
  );
}

function LiveSession({ s, onStop }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 30e3); return () => clearInterval(t); }, []);
  const kw = Number(s.power_w || 0) / 1000;
  return (
    <div className="u-live">
      <div className="u-live-top">
        <span className="u-pulse" />
        <span>Cargando en {s.charger_name || s.charger_id}</span>
      </div>
      <div className="u-live-kwh">{(Number(s.energy_wh || 0) / 1000).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}<small>kWh</small></div>
      <div className="u-live-meta">
        <span><b>{kw.toLocaleString('es-UY', { maximumFractionDigits: 1 })} kW</b> de potencia</span>
        <span><b>{elapsed(s.started_at)}</b> desde las {hhmm(s.started_at)}</span>
      </div>
      <button className="btn lg block u-stop" onClick={() => onStop(s)}><Icon name="power" size={18} />Terminar carga</button>
    </div>
  );
}

/* ───────── Cargador (destino del QR) ───────── */

function ChargerView({ id, me, onAuth, reload, back }) {
  const [c, setC] = useState(null);
  const [err, setErr] = useState('');
  const [conn, setConn] = useState(1);
  const [busy, setBusy] = useState(false);
  const [reserve, setReserve] = useState(false);
  const load = useCallback(() => uapi(`/chargers/${encodeURIComponent(id)}`).then(setC).catch((e) => setErr(e.message)), [id]);
  useEffect(() => { load(); const t = setInterval(load, 10e3); return () => clearInterval(t); }, [load]);

  if (err) return <div className="u-page"><Header title="Cargador" back={back} /><div className="u-empty"><Icon name="alert" size={30} /><p>{err}</p></div></div>;
  if (!c) return <div className="u-page"><Header title="Cargador" back={back} /><div className="u-skel" /></div>;

  const [label, tone] = chargerState(c);
  const active = me?.active?.find((s) => s.charger_id === c.id);
  const blocked = c.reserved && !c.reserved.mine;
  const start = async () => {
    setBusy(true);
    try {
      const r = await uapi(`/chargers/${encodeURIComponent(c.id)}/start`, { method: 'POST', body: { connectorId: conn } });
      toast.ok(r.message);
      setTimeout(reload, 2500);
    } catch (e) {
      toast.err(e.message);
    } finally {
      setBusy(false);
    }
  };
  const stop = async (s) => {
    try { await uapi(`/sessions/${s.id}/stop`, { method: 'POST' }); toast.ok('Carga terminada. Ya podés desenchufar.'); setTimeout(reload, 2000); } catch (e) { toast.err(e.message); }
  };

  return (
    <div className="u-page">
      <Header title={c.name} sub={c.site} back={back} />
      <div className="u-hero">
        <span className={`u-state ${tone}`}><span className="dot" />{label}</span>
        {c.price ? (
          <>
            <div className="u-price">{money(c.price.price_kwh, c.price.currency)}<small>/ kWh</small></div>
            <p className="muted">Precio de ahora · {BAND[c.price.band] || c.price.band}{c.price.session_fee ? ` · ${money(c.price.session_fee, c.price.currency)} por carga` : ''}</p>
          </>
        ) : <p className="muted">Este cargador todavía no tiene tarifa asignada.</p>}
        {c.reserved && <p className={'u-chip ' + (c.reserved.mine ? 'blue' : 'orange')}><Icon name="calendar" size={14} />{c.reserved.mine ? 'Tu reserva' : 'Reservado'} hasta las {hhmm(c.reserved.until)}</p>}
      </div>

      {active ? <LiveSession s={active} onStop={stop} /> : !me ? (
        <div className="u-cta">
          <button className="btn lg block" onClick={onAuth}>Iniciar sesión para cargar</button>
          <p className="u-foot center">También podés usar tu tarjeta: acercala al lector del cargador.</p>
        </div>
      ) : (
        <div className="u-cta">
          {c.connectors.length > 1 && (
            <Segmented value={conn} onChange={setConn} options={c.connectors.map((k) => [k.id, `Conector ${k.id}`])} />
          )}
          <button className="btn lg block" disabled={busy || !c.online || blocked} onClick={start}>
            <Icon name="bolt" size={18} />{busy ? 'Enviando…' : 'Empezar a cargar'}
          </button>
          <p className="u-foot center">{!c.online ? 'El cargador no está conectado ahora mismo.' : blocked ? 'Otra persona tiene este horario reservado.' : 'Enchufá el auto antes o después de tocar el botón.'}</p>
          <button className="btn sec block" onClick={() => setReserve(true)}><Icon name="calendar" size={16} />Reservar un horario</button>
        </div>
      )}
      {reserve && <ReserveSheet chargers={[c]} onClose={() => setReserve(false)} onDone={() => { setReserve(false); reload(); load(); }} />}
    </div>
  );
}

/* ───────── Reservas ───────── */

const localInput = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60e3).toISOString().slice(0, 16);

function ReserveSheet({ chargers, onClose, onDone }) {
  const next = new Date(Math.ceil(Date.now() / (15 * 60e3)) * 15 * 60e3);
  const [chargerId, setChargerId] = useState(chargers[0]?.id || '');
  const [at, setAt] = useState(localInput(next));
  const [minutes, setMinutes] = useState(60);
  const [taken, setTaken] = useState([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (chargerId) uapi(`/chargers/${encodeURIComponent(chargerId)}/reservations`).then(setTaken).catch(() => setTaken([])); }, [chargerId]);
  const save = async () => {
    setBusy(true);
    try {
      await uapi('/reservations', { method: 'POST', body: { chargerId, startsAt: new Date(at).toISOString(), minutes } });
      toast.ok('Reserva confirmada');
      onDone();
    } catch (e) { toast.err(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal icon="calendar" tone="orange" title="Reservar" onClose={onClose} footer={<><button className="btn sec" onClick={onClose}>Cancelar</button><button className="btn" disabled={busy || !chargerId} onClick={save}>Reservar</button></>}>
      <div className="form-grid">
        {chargers.length > 1 && (
          <Field className="full" label="Cargador">
            <select value={chargerId} onChange={(e) => setChargerId(e.target.value)}>{chargers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.site ? ` · ${c.site}` : ''}</option>)}</select>
          </Field>
        )}
        <Field className="full" label="Desde"><input type="datetime-local" step={900} value={at} onChange={(e) => setAt(e.target.value)} /></Field>
        <div className="field full">
          <label>Duración</label>
          <Segmented value={minutes} onChange={setMinutes} options={[[30, '30 min'], [60, '1 h'], [120, '2 h'], [240, '4 h']]} />
        </div>
        {taken.length > 0 && (
          <div className="field full">
            <label>Ya reservado</label>
            <div className="u-taken">{taken.map((r) => <span key={r.id} className={r.mine ? 'mine' : ''}>{day(r.starts_at)} {hhmm(r.starts_at)}–{hhmm(r.ends_at)}</span>)}</div>
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ───────── Pantallas con sesión ───────── */

function Header({ title, sub, back, action }) {
  return (
    <header className="u-head">
      {back && <button className="u-back" onClick={back}><Icon name="chevronLeft" size={20} />Volver</button>}
      <div className="u-head-row"><h1>{title}</h1>{action}</div>
      {sub && <p className="muted">{sub}</p>}
    </header>
  );
}

function Home({ me, reload, open }) {
  const stop = async (s) => {
    try { await uapi(`/sessions/${s.id}/stop`, { method: 'POST' }); toast.ok('Carga terminada. Ya podés desenchufar.'); setTimeout(reload, 2000); } catch (e) { toast.err(e.message); }
  };
  const prepaid = me.account.billing_mode === 'prepaid';
  const first = (me.user.name || '').split(' ')[0];
  return (
    <div className="u-page">
      <Header title={`Hola, ${first}`} sub={me.account.unit ? `${me.account.name} · ${me.account.unit}` : me.account.name} />
      {me.active.map((s) => <LiveSession key={s.id} s={s} onStop={stop} />)}
      <div className="u-tiles">
        <div className="u-tile">
          <span className="u-tile-label">{prepaid ? 'Saldo' : 'A pagar'}</span>
          <span className={'u-tile-value' + (prepaid && me.balance <= 0 ? ' neg' : '')}>{money(prepaid ? me.balance : Math.max(0, -me.balance))}</span>
        </div>
        <div className="u-tile">
          <span className="u-tile-label">Este mes</span>
          <span className="u-tile-value">{kwh(me.month.energy_wh)}</span>
          <span className="u-tile-sub">{money(me.month.amount)}</span>
        </div>
      </div>
      {!me.active.length && (
        <Group foot="Escaneá el QR del cargador o elegilo de la lista.">
          <Row icon="plug" tone="accent" label="Empezar una carga" chevron onClick={() => open('chargers')} />
        </Group>
      )}
      {me.reservations.length > 0 && (
        <Group title="Próximas reservas">
          {me.reservations.map((r) => <Row key={r.id} icon="calendar" tone="orange" label={r.charger_name || r.charger_id} sub={`${day(r.starts_at)} · ${hhmm(r.starts_at)} a ${hhmm(r.ends_at)}`} chevron onClick={() => open('reservas')} />)}
        </Group>
      )}
      <Group title="Últimas cargas">
        {me.recent.length === 0 ? <div className="u-row"><span className="muted">Todavía no cargaste.</span></div> :
          me.recent.slice(0, 8).map((s) => (
            <Row key={s.id} icon="bolt" tone="green" label={kwh(s.energy_wh)} sub={`${s.charger_name || s.charger_id} · ${day(s.started_at)} ${hhmm(s.started_at)}`} value={money(s.amount)} />
          ))}
      </Group>
    </div>
  );
}

function ChargerList({ openCharger }) {
  const [list, setList] = useState(null);
  useEffect(() => { uapi('/chargers').then(setList).catch((e) => toast.err(e.message)); }, []);
  return (
    <div className="u-page">
      <Header title="Cargadores" />
      {!list ? <div className="u-skel" /> : list.length === 0 ? <div className="u-empty"><Icon name="plug" size={30} /><p>No hay cargadores habilitados para tu cuenta.</p></div> : (
        <Group>
          {list.map((c) => {
            const [label, tone] = chargerState(c);
            return <Row key={c.id} icon="plug" tone={tone} label={c.name} sub={c.site} value={<span className={`u-state sm ${tone}`}><span className="dot" />{label}</span>} chevron onClick={() => openCharger(c.id)} />;
          })}
        </Group>
      )}
    </div>
  );
}

function ReservationsTab({ me, reload }) {
  const [chargers, setChargers] = useState(null);
  const [sheet, setSheet] = useState(false);
  useEffect(() => { uapi('/chargers').then(setChargers).catch(() => setChargers([])); }, []);
  const cancel = async (r) => { try { await uapi(`/reservations/${r.id}`, { method: 'DELETE' }); toast.ok('Reserva cancelada'); reload(); } catch (e) { toast.err(e.message); } };
  return (
    <div className="u-page">
      <Header title="Reservas" action={<button className="btn tint sm" disabled={!chargers?.length} onClick={() => setSheet(true)}><Icon name="plus" size={15} />Nueva</button>} />
      {me.reservations.length === 0 ? (
        <div className="u-empty"><Icon name="calendar" size={30} /><p>Reservá un cargador para tener el lugar asegurado. Durante tu reserva nadie más puede usarlo.</p></div>
      ) : (
        <Group foot="Podés tener hasta 2 reservas activas.">
          {me.reservations.map((r) => (
            <div key={r.id} className="u-row">
              <span className="u-ico orange"><Icon name="calendar" size={16} /></span>
              <span className="u-row-main"><span className="u-row-label">{day(r.starts_at)} · {hhmm(r.starts_at)} a {hhmm(r.ends_at)}</span><span className="u-row-sub">{r.charger_name || r.charger_id}</span></span>
              <button className="btn ghost sm danger-text" onClick={() => cancel(r)}>Cancelar</button>
            </div>
          ))}
        </Group>
      )}
      {sheet && chargers && <ReserveSheet chargers={chargers.filter((c) => true)} onClose={() => setSheet(false)} onDone={() => { setSheet(false); reload(); }} />}
    </div>
  );
}

function AccountTab({ me, config, logout }) {
  const [amount, setAmount] = useState(500);
  const [busy, setBusy] = useState(false);
  const pay = async () => {
    setBusy(true);
    try { const r = await uapi('/payments', { method: 'POST', body: { amount } }); window.location.href = r.url; } catch (e) { toast.err(e.message); setBusy(false); }
  };
  const prepaid = me.account.billing_mode === 'prepaid';
  return (
    <div className="u-page">
      <Header title="Cuenta" />
      <Group>
        <Row icon="users" tone="blue" label={me.user.name} sub={me.user.email} />
        <Row icon="building" tone="gray" label={me.account.name} sub={me.account.unit || (prepaid ? 'Cuenta prepaga' : 'Cuenta con liquidación mensual')} />
      </Group>
      <Group title={prepaid ? 'Saldo' : 'Consumo pendiente'} foot={prepaid ? null : 'Tu consumo se suma a la liquidación mensual de tu unidad.'}>
        <Row icon="dollar" tone={me.balance > 0 ? 'green' : 'orange'} label={prepaid ? 'Saldo disponible' : 'A pagar'} value={money(prepaid ? me.balance : Math.max(0, -me.balance))} />
      </Group>
      {config?.payments && (
        <Group title="Cargar saldo" foot="Pagás con Mercado Pago: tarjeta, débito o efectivo en redes de cobranza.">
          <div className="u-row col">
            <Segmented value={amount} onChange={setAmount} options={[[300, '$300'], [500, '$500'], [1000, '$1.000'], [2000, '$2.000']]} />
            <button className="btn block" disabled={busy} onClick={pay}>{busy ? 'Abriendo Mercado Pago…' : `Pagar ${money(amount)}`}</button>
          </div>
        </Group>
      )}
      <Group>
        <button className="u-row tap center danger-text" onClick={logout}>Cerrar sesión</button>
      </Group>
    </div>
  );
}

/* ───────── Raíz ───────── */

const TABS = [['home', 'Inicio', 'home'], ['chargers', 'Cargadores', 'plug'], ['reservas', 'Reservas', 'calendar'], ['cuenta', 'Cuenta', 'users']];

export default function UserApp() {
  const parse = () => {
    const p = location.pathname;
    if (p.startsWith('/c/')) return { tab: 'charger', id: decodeURIComponent(p.slice(3)) };
    const t = p.split('/')[2];
    return { tab: TABS.some((x) => x[0] === t) ? t : 'home' };
  };
  const [route, setRoute] = useState(parse);
  const [me, setMe] = useState(null);
  const [checked, setChecked] = useState(!getTok());
  const [auth, setAuth] = useState(false);
  const [config, setConfig] = useState(null);

  const load = useCallback(() => {
    if (!getTok()) { setMe(null); setChecked(true); return; }
    uapi('/me').then(setMe).catch(() => setMe(null)).finally(() => setChecked(true));
  }, []);
  useEffect(() => {
    load();
    uapi('/config').then(setConfig).catch(() => {});
    const out = () => setMe(null);
    const pop = () => setRoute(parse());
    window.addEventListener('app-logout', out);
    window.addEventListener('popstate', pop);
    const q = new URLSearchParams(location.search).get('pago');
    if (q === 'ok') toast.ok('Pago recibido. El saldo se acredita en unos segundos.');
    if (q === 'error') toast.err('El pago no se completó.');
    return () => { window.removeEventListener('app-logout', out); window.removeEventListener('popstate', pop); };
  }, [load]);
  // Con una carga en curso se refresca seguido para ver los kWh subir
  const charging = !!me?.active?.length;
  useEffect(() => { const t = setInterval(load, charging ? 5e3 : 30e3); return () => clearInterval(t); }, [load, charging]);

  const nav = (r) => {
    const url = r.tab === 'charger' ? `/c/${encodeURIComponent(r.id)}` : r.tab === 'home' ? '/app' : `/app/${r.tab}`;
    history.pushState({}, '', url);
    setRoute(r);
    window.scrollTo(0, 0);
  };
  const logout = () => { setTok(null); setMe(null); nav({ tab: 'home' }); };
  const doneAuth = () => { setAuth(false); load(); };

  if (!checked) return null;
  const showAuth = auth || (!me && route.tab !== 'charger');
  if (showAuth) return <Auth chargerId={route.tab === 'charger' ? route.id : null} onDone={doneAuth} />;

  let page;
  if (route.tab === 'charger') page = <ChargerView id={route.id} me={me} onAuth={() => setAuth(true)} reload={load} back={me ? () => nav({ tab: 'chargers' }) : null} />;
  else if (route.tab === 'chargers') page = <ChargerList openCharger={(id) => nav({ tab: 'charger', id })} />;
  else if (route.tab === 'reservas') page = <ReservationsTab me={me} reload={load} />;
  else if (route.tab === 'cuenta') page = <AccountTab me={me} config={config} logout={logout} />;
  else page = <Home me={me} reload={load} open={(tab) => nav({ tab })} />;

  const current = route.tab === 'charger' ? 'chargers' : route.tab;
  return (
    <div className="uapp">
      <main key={route.tab + (route.id || '')} className="u-main">{page}</main>
      {me && (
        <nav className="u-tabbar" aria-label="Secciones">
          {TABS.map(([t, label, icon]) => (
            <button key={t} className={current === t ? 'on' : ''} onClick={() => nav({ tab: t })} aria-current={current === t ? 'page' : undefined}>
              <Icon name={icon} size={22} /><span>{label}</span>
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
