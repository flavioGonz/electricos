import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons.jsx';

/**
 * Panel lateral (reemplaza a las ventanas modales). Entra desde la derecha en escritorio y desde abajo en el teléfono.
 * Se cierra con la X, Cancelar o Escape. Un clic afuera no lo cierra, para no perder lo escrito.
 */
export function Modal({ title, subtitle, icon = 'edit', tone = 'accent', children, onClose, footer, size }) {
  const [closing, setClosing] = useState(false);
  const close = useCallback(() => {
    if (closing) return;
    setClosing(true);
    setTimeout(() => onClose?.(), 260);
  }, [closing, onClose]);
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    document.body.classList.add('panel-open');
    return () => { window.removeEventListener('keydown', onKey); document.body.classList.remove('panel-open'); };
  }, [close]);
  // Los botones del pie que cierran (Cancelar) también animan la salida
  const foot = footer && React.Children.map(footer.props?.children ?? footer, (el) =>
    React.isValidElement(el) && (el.props['data-close'] || el.props.onClick === onClose) ? React.cloneElement(el, { onClick: close }) : el);
  return createPortal(
    <div className={'panel-bg' + (closing ? ' out' : '')}>
      <aside className={'panel' + (size ? ' ' + size : '') + (closing ? ' out' : '')} role="dialog" aria-modal="true" aria-label={title}>
        <header className="panel-head">
          <span className={'panel-ico ' + tone}><Icon name={icon} size={18} /></span>
          <div className="panel-ttl"><h3>{title}</h3>{subtitle && <div className="sub">{subtitle}</div>}</div>
          <button className="panel-close" onClick={close} aria-label="Cerrar" data-tip="Cerrar (Esc)"><Icon name="x" size={16} /></button>
        </header>
        <div className="panel-body">{children}</div>
        {foot && <footer className="panel-foot">{foot}</footer>}
      </aside>
    </div>,
    document.body,
  );
}

export function Field({ label, hint, children, className }) {
  return (
    <div className={'field' + (className ? ' ' + className : '')}>
      {label && <label>{label}</label>}
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function Switch({ label, checked, onChange }) {
  return (
    <label className="switch-row">
      <span>{label}</span>
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export function Segmented({ value, onChange, options }) {
  return (
    <div className="seg" role="tablist">
      {options.map(([v, l]) => (
        <button key={v} type="button" role="tab" aria-selected={value === v} className={value === v ? 'active' : ''} onClick={() => onChange(v)}>{l}</button>
      ))}
    </div>
  );
}

export function PageHeader({ title, desc, actions }) {
  return (
    <div className="page-head">
      <div><h1 className="ttl">{title}</h1>{desc && <div className="desc">{desc}</div>}</div>
      {actions && <div className="row wrap">{actions}</div>}
    </div>
  );
}

export function Stat({ icon, label, value, tone }) {
  return (
    <div className={'stat' + (tone ? ' ' + tone : '')}>
      <div className="k">{icon && <Icon name={icon} size={14} />}{label}</div>
      <div className="v">{value}</div>
    </div>
  );
}

export function Loading({ rows = 4 }) {
  return (
    <div className="card flush" aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', borderBottom: i < rows - 1 ? '0.5px solid var(--sep)' : 0 }}>
          <div style={{ flex: 1 }}>
            <div className="skel" style={{ height: 12, width: `${56 - i * 7}%`, marginBottom: 8 }} />
            <div className="skel" style={{ height: 10, width: `${34 + i * 6}%` }} />
          </div>
          <div className="skel" style={{ width: 64, height: 20, borderRadius: 10 }} />
        </div>
      ))}
    </div>
  );
}

export function Empty({ icon = 'box', title, children, action }) {
  return (
    <div className="empty">
      <div className="eico"><Icon name={icon} size={24} /></div>
      {title && <div className="et">{title}</div>}
      <div>{children}</div>
      {action && <div style={{ marginTop: 18 }}>{action}</div>}
    </div>
  );
}
