import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './theme.css';
import './brand.css';
import AppShell from './components/AppShell.jsx';
import { ToastHost } from './components/toast.jsx';
import { Icon } from './components/icons.jsx';
import { Field } from './components/ui.jsx';
import { api, getToken, setToken } from './api.js';
import { Dashboard, Chargers, Tariffs, Sites, Accounts, Cards, Sessions, Report } from './pages.jsx';

const NAV = [
  { to: '/', label: 'Panel', icon: 'home', section: 'Operación', page: Dashboard },
  { to: '/cargadores', label: 'Cargadores', icon: 'plug', section: 'Operación', page: Chargers },
  { to: '/sesiones', label: 'Sesiones', icon: 'history', section: 'Operación', page: Sessions },
  { to: '/cuentas', label: 'Cuentas', icon: 'users', section: 'Usuarios', page: Accounts },
  { to: '/tarjetas', label: 'Tarjetas', icon: 'card', section: 'Usuarios', page: Cards },
  { to: '/liquidacion', label: 'Liquidación', icon: 'file', section: 'Cobro', page: Report },
  { to: '/tarifas', label: 'Tarifas', icon: 'dollar', section: 'Cobro', page: Tariffs },
  { to: '/sitios', label: 'Sitios', icon: 'building', section: 'Configuración', page: Sites },
];

function Logo({ h = 22 }) {
  return (
    <>
      <img className="logo-l" src="/infratec-logo.svg" alt="INFRATEC." style={{ height: h }} />
      <img className="logo-d" src="/infratec-logo-dark.svg" alt="INFRATEC." style={{ height: h }} />
    </>
  );
}

function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    try {
      const r = await api('/auth/login', { method: 'POST', body: { email, password } });
      setToken(r.token);
      onLogin(r);
    } catch (e2) {
      setErr(e2.message);
    }
  };
  return (
    <div className="login-wrap">
      <form className="card login-card" onSubmit={submit}>
        <div style={{ marginBottom: 6 }}><Logo h={24} /></div>
        <h2 style={{ margin: '10px 0 2px' }}>Eléctricos</h2>
        <p className="muted" style={{ marginTop: 0 }}>Gestión de carga de vehículos eléctricos</p>
        {err && <div className="err-box">{err}</div>}
        <Field label="Email"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus /></Field>
        <Field label="Contraseña"><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <button className="btn block" type="submit"><Icon name="arrowRight" size={16} />Entrar</button>
      </form>
    </div>
  );
}

function App() {
  const [me, setMe] = useState(null);
  const [checked, setChecked] = useState(false);
  const [path, setPath] = useState(window.location.pathname);

  useEffect(() => {
    if (!getToken()) return setChecked(true);
    api('/me').then(setMe).catch(() => {}).finally(() => setChecked(true));
  }, []);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    const onOut = () => setMe(null);
    window.addEventListener('popstate', onPop);
    window.addEventListener('logout', onOut);
    return () => { window.removeEventListener('popstate', onPop); window.removeEventListener('logout', onOut); };
  }, []);

  const go = (to) => { window.history.pushState({}, '', to); setPath(to); window.scrollTo(0, 0); };
  if (!checked) return null;
  if (!me) return <><Login onLogin={(r) => setMe({ email: r.email, name: r.name })} /><ToastHost /></>;
  const item = NAV.find((n) => n.to === path) || NAV[0];
  const Page = item.page;
  return (
    <>
      <AppShell
        brand={{ name: 'Eléctricos', sub: 'Infratec · carga EV' }}
        nav={NAV}
        active={item.to}
        onNavigate={go}
        user={{ nombre: me.name || me.email, rol: me.email }}
        onLogout={() => { setToken(null); setMe(null); }}
      >
        <Page go={go} />
      </AppShell>
      <ToastHost />
    </>
  );
}

createRoot(document.getElementById('root')).render(<App />);
