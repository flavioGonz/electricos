import React, { useState } from 'react';
import { Icon } from './icons.jsx';
import Drawer from './Drawer.jsx';

/*
  AppShell — layout base de gui-infratec: sidebar (desktop) + topbar y bottom-nav (móvil) + switch de tema.
  Independiente de router/backend: le pasás los items de navegación y el contenido por children.

  Props:
    brand:  { name, sub?, logo? }
    nav:    [{ to, label, icon, section?, badge? }]   (usá `section` para agrupar)
    user:   { nombre, rol, avatar? }
    active: string  (ruta activa; default window.location.pathname)
    onNavigate: (to) => void   (integralo con tu router; si no lo pasás usa <a href>)
    onLogout:   () => void
    bottomCount: number  (items en la barra inferior móvil; default 4)
*/

export function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.getAttribute('data-theme') === 'dark');
  const toggle = () => {
    const d = !dark; setDark(d);
    document.documentElement.setAttribute('data-theme', d ? 'dark' : 'light');
    try { localStorage.setItem('app_theme', d ? 'dark' : 'light'); } catch {}
  };
  return (
    <button className={'theme-tog' + (dark ? ' on' : '')} onClick={toggle} aria-label="Cambiar tema" data-tip="Cambiar tema">
      <span className="tt-knob"><Icon name={dark ? 'moon' : 'sun'} size={13} /></span>
    </button>
  );
}

// Llamá esto al arrancar para evitar el "flash" de tema (idealmente inline en el <head>).
export function initTheme() {
  try {
    const t = localStorage.getItem('app_theme')
      || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', t);
  } catch { document.documentElement.setAttribute('data-theme', 'light'); }
}

function NavItem({ item, active, onNavigate }) {
  const on = active === item.to;
  return (
    <a href={item.to} className={'nav-item' + (on ? ' active' : '')}
      onClick={(e) => { if (onNavigate) { e.preventDefault(); onNavigate(item.to); } }}>
      <Icon name={item.icon} size={18} />
      <span>{item.label}</span>
      {item.badge ? <span className="nav-badge">{item.badge}</span> : null}
    </a>
  );
}

export default function AppShell({ brand = { name: 'App' }, nav = [], user, active, onNavigate, onLogout, bottomCount = 4, children }) {
  const path = active ?? (typeof window !== 'undefined' ? window.location.pathname : '/');
  const [mas, setMas] = useState(false);

  const sections = [];
  for (const it of nav) {
    const sec = it.section || '';
    let g = sections.find(s => s.name === sec);
    if (!g) { g = { name: sec, items: [] }; sections.push(g); }
    g.items.push(it);
  }
  const bottom = nav.slice(0, bottomCount);
  const extra = nav.slice(bottomCount);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          {brand.logo ? <img src={brand.logo} alt={brand.name} style={{ height: 30 }} />
            : <span className="logo"><Icon name="bolt" size={20} /></span>}
          <div className="brand-txt">
            <span className="brand-name">{brand.name}</span>
            {brand.sub && <span className="brand-ver">{brand.sub}</span>}
          </div>
        </div>
        <nav className="nav">
          {sections.map((s, i) => (
            <React.Fragment key={i}>
              {s.name && <div className="nav-section">{s.name}</div>}
              {s.items.map(it => <NavItem key={it.to} item={it} active={path} onNavigate={onNavigate} />)}
            </React.Fragment>
          ))}
        </nav>
        <div className="sidebar-foot">
          <ThemeToggle />
          {user && (
            <div className="userchip">
              <div className="avatar">{user.avatar ? <img src={user.avatar} alt="" /> : (user.nombre || '?').slice(0, 1).toUpperCase()}</div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="un">{user.nombre}</div>
                <div className="ur">{user.rol}</div>
              </div>
              {onLogout && <button className="btn ghost icon" aria-label="Salir" onClick={onLogout}><Icon name="arrowRight" size={16} /></button>}
            </div>
          )}
        </div>
      </aside>

      <header className="topbar-m">
        <div className="row" style={{ gap: 8 }}>
          {brand.logo ? <img src={brand.logo} alt="" style={{ height: 24 }} /> : <span className="logo sm"><Icon name="bolt" size={16} /></span>}
          <b>{brand.name}</b>
        </div>
        <ThemeToggle />
      </header>

      <div className="main"><main className="content">{children}</main></div>

      <nav className="bottomnav">
        {bottom.map(it => {
          const on = path === it.to;
          return (
            <a key={it.to} href={it.to} className={'bn-item' + (on ? ' active' : '')}
              onClick={(e) => { if (onNavigate) { e.preventDefault(); onNavigate(it.to); } }}>
              <Icon name={it.icon} size={20} /><span>{it.label}</span>
            </a>
          );
        })}
        {extra.length > 0 && (
          <button className="bn-item" onClick={() => setMas(true)}><Icon name="more" size={20} /><span>Más</span></button>
        )}
      </nav>

      <Drawer open={mas} onClose={() => setMas(false)} title="Menú" side="bottom">
        <div className="nav">
          {extra.map(it => <NavItem key={it.to} item={it} active={path}
            onNavigate={(to) => { setMas(false); onNavigate && onNavigate(to); }} />)}
        </div>
      </Drawer>
    </div>
  );
}
