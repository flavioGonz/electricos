// Selector estilizado con buscador: reemplaza a <select>. Se abre en una capa flotante, se usa con teclado y filtra sin tildes.
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons.jsx';

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const toOpt = (o) => (Array.isArray(o) ? { value: o[0], label: o[1], hint: o[2] } : o);

/**
 * options: [{ value, label, hint?, icon? }] o [[value, label, hint?]].
 * onChange recibe el valor como texto, igual que e.target.value de un <select>.
 * El buscador aparece solo con más de 6 opciones (o con search).
 */
export function Select({ value, onChange, options = [], placeholder = 'Elegir…', search, size, ariaLabel, disabled, className, icon }) {
  const opts = useMemo(() => options.map(toOpt), [options]);
  const current = opts.find((o) => String(o.value) === String(value ?? ''));
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState(null);
  const btn = useRef(null);
  const pop = useRef(null);
  const list = useRef(null);
  const searchable = search ?? opts.length > 6;
  const shown = useMemo(() => {
    if (!q) return opts;
    const n = norm(q);
    return opts.filter((o) => norm(`${o.label} ${o.hint || ''}`).includes(n));
  }, [opts, q]);

  const place = () => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const want = Math.min(340, (searchable ? 52 : 8) + Math.min(opts.length, 8) * 38 + 8);
    const below = window.innerHeight - r.bottom - 12;
    const up = below < want && r.top > below;
    const width = Math.max(r.width, 220);
    const left = Math.min(r.left, window.innerWidth - width - 8);
    setPos({ left: Math.max(8, left), width, top: up ? undefined : r.bottom + 6, bottom: up ? window.innerHeight - r.top + 6 : undefined, max: Math.max(160, (up ? r.top : below) - 12), up });
  };
  const openIt = () => {
    if (disabled) return;
    setQ('');
    setActive(Math.max(0, opts.findIndex((o) => String(o.value) === String(value ?? ''))));
    place();
    setOpen(true);
  };
  const close = (focus = true) => { setOpen(false); if (focus) btn.current?.focus(); };
  const pick = (o) => { onChange?.(String(o.value)); close(); };

  useLayoutEffect(() => { if (open) place(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    const away = (e) => { if (!pop.current?.contains(e.target) && !btn.current?.contains(e.target)) close(false); };
    const re = (e) => { if (!pop.current?.contains(e.target)) place(); };
    document.addEventListener('pointerdown', away, true);
    window.addEventListener('resize', re);
    window.addEventListener('scroll', re, true);
    return () => { document.removeEventListener('pointerdown', away, true); window.removeEventListener('resize', re); window.removeEventListener('scroll', re, true); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setActive(0); }, [q]);
  useEffect(() => {
    if (!open) return;
    list.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(shown.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(shown.length - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); if (shown[active]) pick(shown[active]); }
    else if (e.key === 'Tab') close(false);
  };
  const onBtnKey = (e) => {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); openIt(); }
  };

  return (
    <>
      <button ref={btn} type="button" className={'sel' + (size ? ' ' + size : '') + (open ? ' open' : '') + (className ? ' ' + className : '')} disabled={disabled}
        aria-haspopup="listbox" aria-expanded={open} aria-label={ariaLabel} onClick={() => (open ? close() : openIt())} onKeyDown={onBtnKey}>
        {(current?.icon || icon) && <Icon name={current?.icon || icon} size={15} />}
        <span className={'sel-v' + (current ? '' : ' ph')}>{current ? current.label : placeholder}</span>
        <svg className="sel-chev" width="10" height="14" viewBox="0 0 10 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 5l3-3 3 3M2 9l3 3 3-3" /></svg>
      </button>
      {open && pos && createPortal(
        <div ref={pop} className={'sel-pop' + (pos.up ? ' up' : '')} style={{ left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, maxHeight: pos.max }} onKeyDown={onKey}>
          {searchable && (
            <div className="sel-search">
              <Icon name="search" size={15} />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar…" aria-label="Buscar" />
              {q && <button type="button" className="sel-clear" aria-label="Borrar búsqueda" onClick={() => setQ('')}><Icon name="x" size={12} /></button>}
            </div>
          )}
          <ul ref={list} className="sel-list" role="listbox" tabIndex={searchable ? -1 : 0} autoFocus={!searchable} aria-activedescendant={`sel-o-${active}`}>
            {shown.length === 0 && <li className="sel-none">Nada coincide con «{q}»</li>}
            {shown.map((o, i) => {
              const sel = String(o.value) === String(value ?? '');
              return (
                <li key={String(o.value)} id={`sel-o-${i}`} data-i={i} role="option" aria-selected={sel} className={(i === active ? 'act' : '') + (sel ? ' on' : '')}
                  onPointerMove={() => setActive(i)} onClick={() => pick(o)}>
                  {o.icon && <Icon name={o.icon} size={15} />}
                  <span className="sel-l"><span>{o.label}</span>{o.hint && <small>{o.hint}</small>}</span>
                  {sel && <Icon name="check" size={15} />}
                </li>
              );
            })}
          </ul>
        </div>,
        document.body,
      )}
    </>
  );
}
