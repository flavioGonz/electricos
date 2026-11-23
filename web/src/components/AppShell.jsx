import React, { useEffect, useState } from 'react';
import { Icon } from './icons.jsx';
import Drawer from './Drawer.jsx';

const KEY = 'electricos_sidebar';

/** Layout: barra lateral contraíble (escritorio) y barra de pestañas (teléfono). */
export default function AppShell({ nav = [], user, active, onNavigate, onLogout, title = 'Eléctricos', children, tabCount = 4 }) {
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } });
  const [more, setMore] = useState(false);
  useEffect(() => { try { localStorage.setItem(KEY, collapsed ? '1' : '0'); } catch {} }, [collapsed]);
  // ⌘\ / Ctrl+\ contrae o expande, como en las apps de macOS
  useEffect(() => {
    const onKey = (e) => { if ((e.metaKey || e.ctrlKey) && e.key === '\\') { e.preventDefault(); setCollapsed((c) => !c); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const go = (e, to) => { e.preventDefault(); onNavigate(to); };
  const sections = [];
  for (const it of nav) {
    let g = sections.find((s) => s.name === (it.section || ''));
    if (!g) sections.push((g = { name: it.section || '', items: [] }));
    g.items.push(it);
  }
  const item = (it, onClick) => (
    <a key={it.to} href={it.to} data-label={it.label} className={'nav-item' + (active === it.to ? ' active' : '')} onClick={onClick || ((e) => go(e, it.to))} aria-current={active === it.to ? 'page' : undefined}>
      <Icon name={it.icon} size={17} />
      <span className="nav-label">{it.label}</span>
      {it.badge ? <span className="nav-badge">{it.badge}</span> : null}
    </a>
  );
  const tabs = nav.slice(0, tabCount);
  const extra = nav.slice(tabCount);

  return (
    <div className={'shell' + (collapsed ? ' collapsed' : '')}>
      <aside className="side" aria-label="Navegación">
        <div className="side-brand">
          <span className="mark"><Icon name="bolt" size={17} /></span>
          <span className="names"><b>{title}</b><img src="/infratec-logo.svg" alt="INFRATEC." /></span>
        </div>
        <nav className="nav">
          {sections.map((s) => (
            <React.Fragment key={s.name}>
              {s.name && <div className="nav-sec">{s.name}</div>}
              {s.items.map((it) => item(it))}
            </React.Fragment>
          ))}
        </nav>
        <div className="side-foot">
          <a href="#" className="nav-item collapse-btn" data-label={collapsed ? 'Expandir' : 'Contraer'} onClick={(e) => { e.preventDefault(); setCollapsed((c) => !c); }}>
            <Icon name="chevronLeft" size={17} /><span className="nav-label">Contraer barra</span>
          </a>
          {user && (
            <div className="side-user">
              <span className="av">{(user.name || '?').slice(0, 1).toUpperCase()}</span>
              <span className="who grow"><b>{user.name}</b><span>{user.email}</span></span>
              {!collapsed && onLogout && <button className="btn ghost icon sm" aria-label="Cerrar sesión" data-tip="Cerrar sesión" onClick={onLogout}><Icon name="external" size={15} /></button>}
            </div>
          )}
        </div>
      </aside>

      <header className="topbar">
        <span className="row"><span className="side-brand" style={{ margin: 0, padding: 0, height: 'auto' }}><span className="mark" style={{ width: 26, height: 26, borderRadius: 7 }}><Icon name="bolt" size={15} /></span></span><b>{title}</b></span>
        {onLogout && <button className="btn ghost sm" onClick={onLogout}>Salir</button>}
      </header>

      <div className="main"><main className="content">{children}</main></div>

      <nav className="tabbar">
        {tabs.map((it) => (
          <a key={it.to} href={it.to} className={'tab' + (active === it.to ? ' active' : '')} onClick={(e) => go(e, it.to)}>
            <Icon name={it.icon} size={22} /><span>{it.label}</span>
          </a>
        ))}
        {extra.length > 0 && <button className={'tab' + (extra.some((x) => x.to === active) ? ' active' : '')} onClick={() => setMore(true)}><Icon name="more" size={22} /><span>Más</span></button>}
      </nav>
      <Drawer open={more} onClose={() => setMore(false)}>
        {extra.map((it) => item(it, (e) => { e.preventDefault(); setMore(false); onNavigate(it.to); }))}
      </Drawer>
    </div>
  );
}
