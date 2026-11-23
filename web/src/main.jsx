import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import AppShell from './components/AppShell.jsx';
import { ToastHost } from './components/toast.jsx';
import { Icon } from './components/icons.jsx';
import { Field } from './components/ui.jsx';
import { api, getToken, setToken } from './api.js';
import { useApi } from './hooks.js';
import UserApp from './UserApp.jsx';
import LoginScene from './components/LoginScene.jsx';
import { AdminUsers, AppUsers, ChargerModels, Audit, Notifications, TwoFactor } from './settings.jsx';
import { Tooltip } from 'react-tooltip';
import { Invoices } from './billing.jsx';
import { Dashboard, Chargers, Tariffs, Sites, Accounts, Cards, Sessions, Report, OwnersReport, Alerts, Reservations, Payments } from './pages.jsx';

const NAV = [
  { to: '/', label: 'Panel', icon: 'home', section: 'Operación', page: Dashboard, edificio: true },
  { to: '/cargadores', label: 'Cargadores', icon: 'plug', section: 'Operación', page: Chargers },
  { to: '/sesiones', label: 'Sesiones', icon: 'bolt', section: 'Operación', page: Sessions, edificio: true },
  { to: '/alertas', label: 'Alertas', icon: 'bell', section: 'Operación', page: Alerts },
  { to: '/reservas', label: 'Reservas', icon: 'calendar', section: 'Operación', page: Reservations },
  { to: '/cuentas', label: 'Cuentas', icon: 'users', section: 'Usuarios', page: Accounts, edificio: true },
  { to: '/tarjetas', label: 'Tarjetas', icon: 'card', section: 'Usuarios', page: Cards },
  { to: '/liquidacion', label: 'Liquidación por cuenta', icon: 'file', section: 'Cobro', page: Report, edificio: true },
  { to: '/propietarios', label: 'Liquidación a propietarios', icon: 'building', section: 'Cobro', page: OwnersReport, edificio: true },
  { to: '/facturacion', label: 'Facturación', icon: 'ticket', section: 'Cobro', page: Invoices, edificio: true },
  { to: '/pagos', label: 'Pagos online', icon: 'dollar', section: 'Cobro', page: Payments },
  { to: '/tarifas', label: 'Tarifas', icon: 'clock', section: 'Cobro', page: Tariffs },
  { to: '/sitios', label: 'Sitios', icon: 'pin', section: 'Configuración', page: Sites },
  { to: '/drivers', label: 'Cargadores compatibles', icon: 'wrench', section: 'Configuración', page: ChargerModels },
  { to: '/usuarios-app', label: 'Usuarios de la app', icon: 'phone', section: 'Configuración', page: AppUsers },
  { to: '/avisos', label: 'Avisos', icon: 'bell', section: 'Configuración', page: Notifications, roles: ['admin', 'operador'] },
  { to: '/usuarios', label: 'Usuarios del panel', icon: 'lock', section: 'Configuración', page: AdminUsers, roles: ['admin'] },
  { to: '/auditoria', label: 'Auditoría', icon: 'eye', section: 'Configuración', page: Audit, roles: ['admin', 'operador'] },
];

function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [mfa, setMfa] = useState(null);
  const [code, setCode] = useState('');
  const [waSent, setWaSent] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const r = mfa
        ? await api('/auth/2fa', { method: 'POST', body: { ticket: mfa.ticket, code } })
        : await api('/auth/login', { method: 'POST', body: { email, password } });
      if (r.need_2fa) { setMfa(r); setCode(''); return; }
      setToken(r.token);
      onLogin(r);
    } catch (e2) {
      setErr(e2.message);
      if (/venció|bloqueada/.test(e2.message)) { setMfa(null); setPassword(''); }
      if (mfa) setCode('');
    } finally {
      setBusy(false);
    }
  };
  const sendWa = async () => {
    setErr('');
    try { const r = await api('/auth/2fa/whatsapp', { method: 'POST', body: { ticket: mfa.ticket } }); setWaSent(r.to); } catch (e2) { setErr(e2.message); }
  };
  return (
    <div className="auth">
      <section className="auth-form">
        <div className="auth-brand"><span className="mark"><Icon name="bolt" size={18} /></span><b>Eléctricos</b><img src="/infratec-logo.svg" alt="Infratec" /></div>
        <form className="auth-box" onSubmit={submit}>
          {mfa ? (<>
          <span className="auth-lock"><Icon name="lock" size={22} /></span>
          <h1>Verificá que sos vos</h1>
          <p className="muted">{waSent ? `Te mandamos un código por WhatsApp al ${waSent}.` : 'Escribí el código de 6 dígitos de tu app de autenticación.'}</p>
          {err && <div className="err-box" role="alert"><Icon name="alert" size={15} />{err}</div>}
          <label className="in">
            <span>Código</span>
            <span className="in-box"><Icon name="lock" size={17} /><input className="otp" inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={(e) => setCode(e.target.value.replace(/[^0-9 ]/g, ''))} placeholder="000 000" autoFocus required /></span>
          </label>
          <button className={'btn lg block auth-go' + (busy ? ' busy' : '')} type="submit" disabled={busy || code.replace(/\D/g, '').length < 6}>
            {busy ? <span className="spin" /> : null}{busy ? 'Verificando' : 'Verificar'}{!busy && <Icon name="arrowRight" size={18} />}
          </button>
          <div className="auth-links">
            {mfa.can_whatsapp && <button type="button" className="auth-alt" onClick={sendWa}><Icon name="whatsapp" size={15} />{waSent ? 'Mandar otro código' : 'Mandarme un código por WhatsApp'}</button>}
            <button type="button" className="auth-alt" onClick={() => { setMfa(null); setErr(''); setWaSent(''); }}><Icon name="chevronLeft" size={15} />Volver</button>
          </div>
          </>) : (<>
          <h1>Bienvenido</h1>
          <p className="muted">Entrá para administrar los cargadores, las cuentas y la facturación de la energía.</p>
          {err && <div className="err-box" role="alert"><Icon name="alert" size={15} />{err}</div>}
          <label className="in">
            <span>Email</span>
            <span className="in-box"><Icon name="mail" size={17} /><input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nombre@empresa.com" autoFocus required /></span>
          </label>
          <label className="in">
            <span>Contraseña</span>
            <span className="in-box">
              <Icon name="lock" size={17} />
              <input type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required />
              <button type="button" className="in-eye" onClick={() => setShow((v) => !v)} aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'} data-tip={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}><Icon name={show ? 'eyeOff' : 'eye'} size={17} /></button>
            </span>
          </label>
          <button className={'btn lg block auth-go' + (busy ? ' busy' : '')} type="submit" disabled={busy}>
            {busy ? <span className="spin" /> : null}{busy ? 'Entrando' : 'Entrar'}{!busy && <Icon name="arrowRight" size={18} />}
          </button>
          <a className="auth-alt" href="/app"><Icon name="users" size={15} />¿Sos usuario? Entrá a la app de carga</a>
          </>)}
        </form>
        <footer className="auth-foot">Infratec · Montevideo</footer>
      </section>
      <section className="auth-art"><LoginScene /></section>
    </div>
  );
}

function Admin({ me, onLogout }) {
  const [path, setPath] = useState(window.location.pathname);
  const [mfaOpen, setMfaOpen] = useState(false);
  const [mfaDone, setMfaDone] = useState(false);
  const { data: dash } = useApi('/dashboard', { live: true });
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const go = (to) => { window.history.pushState({}, '', to); setPath(to); window.scrollTo(0, 0); };
  const allowed = me.level === 'edificio' ? NAV.filter((n) => n.edificio) : NAV.filter((n) => !n.roles || n.roles.includes(me.level || 'admin'));
  const nav = allowed.map((n) => (n.to === '/alertas' && dash?.alerts_open ? { ...n, badge: dash.alerts_open } : n));
  const item = allowed.find((n) => n.to === path) || allowed[0];
  const Page = item.page;
  return (
    <AppShell nav={nav} active={item.to} onNavigate={go} user={{ name: me.name || 'Administrador', email: me.email }} onLogout={onLogout}>
      {me.must_2fa && !mfaDone && (
        <div className="note mfa-banner"><Icon name="lock" size={16} /><span className="grow">Por política de seguridad, tenés que activar el doble factor en tu usuario.</span><button className="btn sm" onClick={() => setMfaOpen(true)}>Activar ahora</button></div>
      )}
      {mfaOpen && <TwoFactor onClose={() => { setMfaOpen(false); api('/me').then((m) => setMfaDone(!m.must_2fa)).catch(() => {}); }} />}
      <Page key={item.to} go={go} me={me} />
    </AppShell>
  );
}

function App() {
  const [me, setMe] = useState(null);
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    if (!getToken()) return setChecked(true);
    api('/me').then(setMe).catch(() => {}).finally(() => setChecked(true));
    const onOut = () => setMe(null);
    window.addEventListener('logout', onOut);
    return () => window.removeEventListener('logout', onOut);
  }, []);
  if (!checked) return null;
  if (!me) return <Login onLogin={() => api('/me').then(setMe)} />;
  return <Admin me={me} onLogout={() => { setToken(null); setMe(null); }} />;
}

const p = window.location.pathname;
const isUserApp = p === '/app' || p.startsWith('/app/') || p.startsWith('/c/');
createRoot(document.getElementById('root')).render(<>{isUserApp ? <UserApp /> : <App />}<ToastHost /><Tooltip className="tip" anchorSelect="[data-tip]:not(.side [data-tip])" delayShow={350} offset={8} render={({ activeAnchor }) => activeAnchor?.getAttribute('data-tip')} /></>);
