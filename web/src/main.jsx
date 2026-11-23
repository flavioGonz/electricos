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
import { Dashboard, Chargers, Tariffs, Sites, Accounts, Cards, Sessions, Report, OwnersReport, Alerts, Reservations, Payments } from './pages.jsx';

const NAV = [
  { to: '/', label: 'Panel', icon: 'home', section: 'Operación', page: Dashboard },
  { to: '/cargadores', label: 'Cargadores', icon: 'plug', section: 'Operación', page: Chargers },
  { to: '/sesiones', label: 'Sesiones', icon: 'bolt', section: 'Operación', page: Sessions },
  { to: '/alertas', label: 'Alertas', icon: 'bell', section: 'Operación', page: Alerts },
  { to: '/reservas', label: 'Reservas', icon: 'calendar', section: 'Operación', page: Reservations },
  { to: '/cuentas', label: 'Cuentas', icon: 'users', section: 'Usuarios', page: Accounts },
  { to: '/tarjetas', label: 'Tarjetas', icon: 'card', section: 'Usuarios', page: Cards },
  { to: '/liquidacion', label: 'Liquidación por cuenta', icon: 'file', section: 'Cobro', page: Report },
  { to: '/propietarios', label: 'Liquidación a propietarios', icon: 'building', section: 'Cobro', page: OwnersReport },
  { to: '/pagos', label: 'Pagos online', icon: 'dollar', section: 'Cobro', page: Payments },
  { to: '/tarifas', label: 'Tarifas', icon: 'clock', section: 'Cobro', page: Tariffs },
  { to: '/sitios', label: 'Sitios', icon: 'pin', section: 'Configuración', page: Sites },
];

function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const r = await api('/auth/login', { method: 'POST', body: { email, password } });
      setToken(r.token);
      onLogin(r);
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <span className="mark"><Icon name="bolt" size={26} /></span>
        <h2>Eléctricos</h2>
        <p className="muted" style={{ margin: '4px 0 22px' }}>Administración de la carga de vehículos eléctricos</p>
        {err && <div className="err-box">{err}</div>}
        <Field label="Email"><input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus /></Field>
        <Field label="Contraseña"><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <button className="btn lg block" type="submit" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
        <img className="login-logo" src="/infratec-logo.svg" alt="Infratec" />
      </form>
    </div>
  );
}

function Admin({ me, onLogout }) {
  const [path, setPath] = useState(window.location.pathname);
  const { data: dash } = useApi('/dashboard', { live: true });
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const go = (to) => { window.history.pushState({}, '', to); setPath(to); window.scrollTo(0, 0); };
  const nav = NAV.map((n) => (n.to === '/alertas' && dash?.alerts_open ? { ...n, badge: dash.alerts_open } : n));
  const item = NAV.find((n) => n.to === path) || NAV[0];
  const Page = item.page;
  return (
    <AppShell nav={nav} active={item.to} onNavigate={go} user={{ name: me.name || 'Administrador', email: me.email }} onLogout={onLogout}>
      <Page key={item.to} go={go} />
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
  if (!me) return <Login onLogin={(r) => setMe({ email: r.email, name: r.name })} />;
  return <Admin me={me} onLogout={() => { setToken(null); setMe(null); }} />;
}

const p = window.location.pathname;
const isUserApp = p === '/app' || p.startsWith('/app/') || p.startsWith('/c/');
createRoot(document.getElementById('root')).render(<>{isUserApp ? <UserApp /> : <App />}<ToastHost /></>);
