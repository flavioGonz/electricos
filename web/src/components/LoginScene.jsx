// Escena animada del login: un auto eléctrico cargando, con la energía corriendo por el cable.
import React, { useEffect, useState } from 'react';
import { Icon } from './icons.jsx';

const CABLE = 'M168 318 C 168 452, 236 456, 262 352';

/** Ciclo de carga: sube de 22 % a 100 %, se queda un momento lleno y vuelve a empezar. */
function useCharge() {
  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const [t, setT] = useState(reduce ? 0.78 : 0);
  useEffect(() => {
    if (reduce) return undefined;
    let raf;
    const t0 = performance.now();
    const loop = (now) => {
      setT(((now - t0) / 14000) % 1);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [reduce]);
  const p = Math.min(1, t / 0.86);
  const eased = 1 - Math.pow(1 - p, 1.6);
  const pct = Math.round(22 + 78 * eased);
  const full = pct >= 100;
  const kwhDone = (pct - 22) * 0.62;
  const kw = full ? 0 : 7.4 - Math.max(0, pct - 80) * 0.25;
  return { pct, full, kwhDone, kw };
}

export default function LoginScene() {
  const { pct, full, kwhDone, kw } = useCharge();
  const R = 54;
  const C = 2 * Math.PI * R;
  const fmt = (n, d = 1) => n.toLocaleString('es-UY', { minimumFractionDigits: d, maximumFractionDigits: d });
  return (
    <div className={'scene' + (full ? ' full' : '')} aria-hidden="true">
      <div className="scene-glow a" /><div className="scene-glow b" />
      <div className="scene-grid" />

      <div className="scene-ring">
        <svg viewBox="0 0 132 132" width="132" height="132">
          <defs>
            <linearGradient id="ringg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#34c759" /><stop offset="1" stopColor="#0a84ff" /></linearGradient>
          </defs>
          <circle cx="66" cy="66" r={R} fill="none" stroke="rgba(60,60,67,.08)" strokeWidth="9" />
          <circle cx="66" cy="66" r={R} fill="none" stroke="url(#ringg)" strokeWidth="9" strokeLinecap="round"
            strokeDasharray={C} strokeDashoffset={C * (1 - pct / 100)} transform="rotate(-90 66 66)" />
        </svg>
        <div className="scene-ring-txt"><b>{pct}<small>%</small></b><span>{full ? 'Completa' : 'Cargando'}</span></div>
      </div>

      <svg className="scene-svg" viewBox="0 0 800 520" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="body" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffffff" /><stop offset=".55" stopColor="#f3f4f7" /><stop offset="1" stopColor="#dfe2e8" />
          </linearGradient>
          <linearGradient id="glass" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#3a3f4b" /><stop offset=".6" stopColor="#1d2029" /><stop offset="1" stopColor="#2b303b" />
          </linearGradient>
          <linearGradient id="post" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#ffffff" /><stop offset="1" stopColor="#e6e8ee" />
          </linearGradient>
          <linearGradient id="energy" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#0a84ff" /><stop offset="1" stopColor="#30d158" />
          </linearGradient>
          <linearGradient id="strip" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#0a84ff" stopOpacity="0" /><stop offset=".5" stopColor="#5ac8fa" /><stop offset="1" stopColor="#0a84ff" stopOpacity="0" />
          </linearGradient>
          <radialGradient id="shadow" cx=".5" cy=".5" r=".5"><stop offset="0" stopColor="#000" stopOpacity=".22" /><stop offset="1" stopColor="#000" stopOpacity="0" /></radialGradient>
          <filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="6" /></filter>
          <clipPath id="bodyclip"><path d="M240 380 C240 352 256 338 292 330 L382 318 C424 284 472 262 532 258 L612 258 C664 260 702 290 732 320 C750 326 758 342 758 362 L758 382 C758 392 750 398 740 398 L240 398 Z" /></clipPath>
        </defs>

        {/* piso */}
        <ellipse cx="500" cy="444" rx="300" ry="18" fill="url(#shadow)" />
        <ellipse cx="140" cy="446" rx="70" ry="9" fill="url(#shadow)" />
        <line x1="40" y1="444" x2="780" y2="444" stroke="rgba(60,60,67,.10)" />

        {/* cargador de pared */}
        <g className="post">
          <rect x="108" y="190" width="64" height="254" rx="16" fill="url(#post)" stroke="rgba(60,60,67,.14)" />
          <rect x="120" y="208" width="40" height="54" rx="8" fill="#1d2029" />
          <path d="M142 220 l-9 14 h8 l-3 14 l11 -17 h-8 l3 -11 z" fill="#30d158" className="post-bolt" />
          <rect x="128" y="276" width="24" height="4" rx="2" fill={full ? '#30d158' : '#0a84ff'} className="post-led" />
          <circle cx="140" cy="306" r="11" fill="#eef0f4" stroke="rgba(60,60,67,.16)" />
          <circle cx="140" cy="306" r="5" fill="#d1d5de" />
        </g>

        {/* cable y energía */}
        <path d={CABLE} fill="none" stroke="#2b303b" strokeWidth="9" strokeLinecap="round" />
        <path d={CABLE} fill="none" stroke="#4a5060" strokeWidth="3" strokeLinecap="round" opacity=".6" />
        {!full && <path d={CABLE} fill="none" stroke="url(#energy)" strokeWidth="4" strokeLinecap="round" className="flow" />}
        {!full && [0, 0.5, 1, 1.5].map((d) => (
          <circle key={d} r="4.5" fill="#5ac8fa" className="spark">
            <animateMotion dur="2s" begin={`${d}s`} repeatCount="indefinite" path={CABLE} />
          </circle>
        ))}

        {/* auto */}
        <g className="car">
          <path d="M240 380 C240 352 256 338 292 330 L382 318 C424 284 472 262 532 258 L612 258 C664 260 702 290 732 320 C750 326 758 342 758 362 L758 382 C758 392 750 398 740 398 L702 398 A50 50 0 0 0 602 398 L394 398 A50 50 0 0 0 294 398 L258 398 C246 398 240 392 240 380 Z"
            fill="url(#body)" stroke="rgba(60,60,67,.18)" strokeWidth="1.2" />
          <path d="M402 320 C432 294 474 276 528 273 L604 273 C644 275 676 296 698 318 Z" fill="url(#glass)" />
          <path d="M562 273 L556 320" stroke="url(#body)" strokeWidth="7" />
          <path d="M412 314 C440 292 478 280 520 278" stroke="rgba(255,255,255,.35)" strokeWidth="3" fill="none" strokeLinecap="round" />
          <path d="M300 352 L738 352" stroke="rgba(60,60,67,.12)" />
          <path d="M470 330 L470 392 M600 330 L600 392" stroke="rgba(60,60,67,.10)" />
          <rect x="486" y="338" width="22" height="4" rx="2" fill="rgba(60,60,67,.25)" />
          <rect x="616" y="338" width="22" height="4" rx="2" fill="rgba(60,60,67,.25)" />
          {/* luces */}
          <path d="M736 334 C748 336 754 342 756 350 L728 348 Z" fill="#fff6d6" stroke="rgba(60,60,67,.2)" />
          <path d="M244 352 L262 350 L262 362 L242 364 Z" fill="#ff375f" opacity=".85" />
          {/* franja de luz que recorre el auto mientras carga */}
          <g clipPath="url(#bodyclip)">
            <rect x="240" y="361" width="140" height="3" fill="url(#strip)" className={full ? 'strip done' : 'strip'} />
          </g>
          {/* puerto de carga */}
          <circle cx="264" cy="350" r="9" fill="#1d2029" />
          <circle cx="264" cy="350" r="5" fill={full ? '#30d158' : '#0a84ff'} className="port" />
          <circle cx="264" cy="350" r="16" fill={full ? '#30d158' : '#0a84ff'} opacity=".25" filter="url(#soft)" className="port-glow" />
          {/* ruedas */}
          {[344, 652].map((x) => (
            <g key={x}>
              <circle cx={x} cy="398" r="42" fill="#1d2029" />
              <circle cx={x} cy="398" r="28" fill="#c9cdd6" />
              <circle cx={x} cy="398" r="26" fill="#eceef2" />
              <g className="rim" style={{ transformOrigin: `${x}px 398px` }}>
                {[0, 72, 144, 216, 288].map((a) => <rect key={a} x={x - 3} y="374" width="6" height="22" rx="3" fill="#b5bac5" transform={`rotate(${a} ${x} 398)`} />)}
              </g>
              <circle cx={x} cy="398" r="6" fill="#8e93a0" />
            </g>
          ))}
        </g>
      </svg>

      <div className="scene-card c1"><span className="sc-ico blue"><Icon name="bolt" size={15} /></span><div><b>{fmt(kw)} kW</b><span>Potencia</span></div></div>
      <div className="scene-card c2"><span className="sc-ico green"><Icon name="plug" size={15} /></span><div><b>{fmt(kwhDone, 2)} kWh</b><span>Entregados</span></div></div>
      <div className="scene-card c3"><span className="sc-ico rose"><Icon name="clock" size={15} /></span><div><b>Llano</b><span>Franja de UTE</span></div></div>

      <div className="scene-caption">
        <h2>Cada kilovatio, medido y cobrado a quien lo usa.</h2>
        <p>Cargadores OCPP de edificios y barrios, con tarjeta o con QR, liquidación mensual y alertas en tiempo real.</p>
      </div>
    </div>
  );
}
