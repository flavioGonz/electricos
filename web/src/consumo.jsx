// Consumo: energía por hora del día, por día del mes y por franja horaria (punta, llano, valle).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Field, PageHeader, Loading, Empty, Segmented, Stat } from './components/ui.jsx';
import { Select } from './components/select.jsx';
import { useApi } from './hooks.js';
import { kwh } from './api.js';

const thisMonth = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`; };
// Orden fijo de series (validado: CVD y contraste con etiquetas/tabla como alivio)
const SERIES = [
  { key: 'valle', label: 'Valle', color: '#2a78d6' },
  { key: 'llano', label: 'Llano', color: '#1baf7a' },
  { key: 'punta', label: 'Punta', color: '#eb6834' },
  { key: 'normal', label: 'Tarifa única', color: '#eda100' },
];
const k = (wh) => (Number(wh || 0) / 1000);
const fmtK = (wh, d = 1) => `${k(wh).toLocaleString('es-UY', { maximumFractionDigits: d })} kWh`;
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const niceMax = (v) => {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v);
};

export function Consumo({ me }) {
  const [month, setMonth] = useState(thisMonth());
  const [siteId, setSiteId] = useState('');
  const [view, setView] = useState('chart');
  const sites = useApi('/sites').data || [];
  const { data } = useApi(`/consumo?month=${month}${siteId ? `&siteId=${siteId}` : ''}`, { live: true });
  const used = useMemo(() => (data ? SERIES.filter((s) => data.bands[s.key] > 0) : []), [data]);
  const peak = useMemo(() => {
    if (!data) return null;
    const tot = data.byHour.map((h) => SERIES.reduce((a, s) => a + h[s.key], 0));
    const max = Math.max(...tot);
    return max > 0 ? tot.indexOf(max) : null;
  }, [data]);
  return (
    <div className="page">
      <PageHeader title="Consumo" desc="Cuánta energía se cargó, a qué hora y en qué franja de UTE. Sale de las lecturas de los cargadores, igual que la facturación." />
      <div className="row wrap" style={{ gap: 12, marginBottom: 16, alignItems: 'end' }}>
        <Field label="Mes"><input type="month" value={month} max={thisMonth()} onChange={(e) => setMonth(e.target.value)} /></Field>
        {(sites.length > 1 || me?.level !== 'edificio') && (
          <Field label="Sitio"><Select icon="pin" value={siteId} onChange={setSiteId} options={[['', 'Todos los sitios'], ...sites.map((s) => [s.id, s.name])]} /></Field>
        )}
        <span className="grow" />
        <Segmented value={view} onChange={setView} options={[['chart', 'Gráficas'], ['table', 'Tabla']]} />
      </div>
      {!data ? <Loading rows={5} /> : data.total_wh === 0 ? (
        <div className="card"><Empty icon="bolt" title="Sin consumo en este mes">Cuando alguien cargue, vas a ver acá a qué hora y en qué franja se usó la energía.</Empty></div>
      ) : (
        <>
          <div className="stats" style={{ marginBottom: 16 }}>
            <Stat icon="power" label="Energía del mes" value={fmtK(data.total_wh)} />
            <Stat icon="bolt" label="Cargas" value={data.sessions} />
            <Stat icon="moon" label="En valle" value={`${pct(data.bands.valle, data.total_wh)} %`} />
            <Stat icon="clock" label="Hora de más consumo" value={peak == null ? '—' : `${String(peak).padStart(2, '0')}:00`} />
          </div>
          <BandSplit data={data} used={used} />
          {view === 'table' ? <HourTable data={data} used={used} /> : (
            <div className="viz-grid">
              <section className="card viz-card">
                <header><h3>Energía por hora del día</h3><Legend used={used} /></header>
                <StackedBars rows={data.byHour} used={used} label={(r) => `${String(r.hour).padStart(2, '0')}:00`} tick={(r) => (r.hour % 3 === 0 ? String(r.hour).padStart(2, '0') : '')} height={220} />
              </section>
              <section className="card viz-card">
                <header><h3>Energía por día</h3><Legend used={used} /></header>
                <StackedBars rows={data.byDay} used={used} label={(r) => new Date(`${r.day}T12:00:00`).toLocaleDateString('es-UY', { weekday: 'short', day: 'numeric', month: 'short' })}
                  tick={(r) => { const d = Number(r.day.slice(8)); return d === 1 || d % 5 === 0 ? String(d) : ''; }} height={220} />
              </section>
              {data.top.length > 0 && (
                <section className="card viz-card">
                  <header><h3>Cuentas que más cargaron</h3></header>
                  <TopBars rows={data.top} total={data.total_wh} />
                </section>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Legend({ used }) {
  if (used.length < 2) return null;
  return <ul className="viz-legend">{used.map((s) => <li key={s.key}><i style={{ background: s.color }} />{s.label}</li>)}</ul>;
}

/** Barra 100 % con la proporción por franja, con etiquetas directas. */
function BandSplit({ data, used }) {
  return (
    <section className="card viz-card" style={{ marginBottom: 16 }}>
      <header><h3>Por franja horaria</h3></header>
      <div className="split-bar" role="img" aria-label={used.map((s) => `${s.label} ${pct(data.bands[s.key], data.total_wh)} %`).join(', ')}>
        {used.map((s) => <span key={s.key} style={{ flexGrow: data.bands[s.key], background: s.color }} />)}
      </div>
      <ul className="split-labels">
        {used.map((s) => (
          <li key={s.key}><i style={{ background: s.color }} /><span>{s.label}</span><b>{pct(data.bands[s.key], data.total_wh)} %</b><span className="muted">{fmtK(data.bands[s.key])}</span></li>
        ))}
      </ul>
    </section>
  );
}

/** Barras apiladas con tooltip por columna (la columna entera es el área de hover). */
function StackedBars({ rows, used, label, tick, height }) {
  const wrap = useRef(null);
  const [hover, setHover] = useState(null);
  const [W, setW] = useState(300);
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e.contentRect.width))));
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);
  const H = height; const padL = 34; const padB = 22; const padT = 22;
  const totals = rows.map((r) => used.reduce((a, s) => a + r[s.key], 0));
  const max = niceMax(k(Math.max(...totals)));
  const ticks = [0, 0.5, 1].map((f) => f * max);
  const cw = (W - padL) / rows.length;
  const bw = Math.max(3, Math.min(22, cw - 4));
  const y = (kw) => padT + (H - padT - padB) * (1 - kw / max);
  const move = (i) => (e) => {
    const box = wrap.current.getBoundingClientRect();
    setHover({ i, x: e.clientX - box.left, y: e.clientY - box.top, w: box.width });
  };
  return (
    <div className="viz" ref={wrap} onPointerLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="Gráfica de barras apiladas por franja">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W} y1={y(t)} y2={y(t)} className="viz-grid-line" />
            <text x={padL - 6} y={y(t) + 4} textAnchor="end" className="viz-axis">{t.toLocaleString('es-UY', { maximumFractionDigits: 1 })}</text>
          </g>
        ))}
        {rows.map((r, i) => {
          const x = padL + i * cw + (cw - bw) / 2;
          let acc = 0;
          const segs = used.filter((s) => r[s.key] > 0);
          return (
            <g key={i} className={'viz-col' + (hover?.i === i ? ' on' : '')} tabIndex={totals[i] ? 0 : -1}
              onPointerMove={move(i)} onFocus={(e) => { const b = e.currentTarget.getBoundingClientRect(); const box = wrap.current.getBoundingClientRect(); setHover({ i, x: b.left - box.left + b.width / 2, y: 40, w: box.width }); }} onBlur={() => setHover(null)}>
              <rect x={padL + i * cw} y={padT} width={cw} height={H - padT - padB} fill="transparent" />
              {segs.map((s, j) => {
                const v = k(r[s.key]);
                const y1 = y(acc + v); const y0 = y(acc);
                acc += v;
                const top = j === segs.length - 1;
                const hgt = Math.max(0, y0 - y1 - (j > 0 ? 2 : 0));
                const rad = top ? Math.min(4, bw / 2, hgt) : 0;
                return <path key={s.key} fill={s.color} d={barPath(x, y1, bw, hgt, rad)} />;
              })}
              <text x={padL + i * cw + cw / 2} y={H - 6} textAnchor="middle" className="viz-axis">{tick(r)}</text>
            </g>
          );
        })}
        <line x1={padL} x2={W} y1={y(0)} y2={y(0)} className="viz-base" />
      </svg>
      <div className="viz-unit">kWh</div>
      {hover && totals[hover.i] > 0 && (
        <div className="viz-tip" style={{ left: Math.min(Math.max(hover.x, 90), hover.w - 90), top: hover.y }}>
          <div className="t">{label(rows[hover.i])}</div>
          <div className="v">{fmtK(totals[hover.i], 2)}</div>
          {used.filter((s) => rows[hover.i][s.key] > 0).map((s) => (
            <div key={s.key} className="r"><i style={{ background: s.color }} /><b>{fmtK(rows[hover.i][s.key], 2)}</b><span>{s.label}</span></div>
          ))}
        </div>
      )}
    </div>
  );
}

// Rectángulo con las esquinas de arriba redondeadas (el extremo de datos); la base queda recta sobre el eje.
function barPath(x, y, w, h, r) {
  if (h <= 0) return '';
  if (!r) return `M${x},${y}h${w}v${h}h${-w}z`;
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}z`;
}

function TopBars({ rows, total }) {
  const max = Math.max(...rows.map((r) => r.wh));
  return (
    <ul className="top-bars">
      {rows.map((r) => (
        <li key={r.account}>
          <span className="name">{r.account}</span>
          <span className="track"><span style={{ width: `${(r.wh / max) * 100}%` }} /></span>
          <b className="kwh">{fmtK(r.wh)}</b>
          <span className="muted pct">{pct(r.wh, total)} %</span>
        </li>
      ))}
    </ul>
  );
}

function HourTable({ data, used }) {
  return (
    <div className="card flush"><div className="tablewrap"><table className="table">
      <thead><tr><th>Hora</th>{used.map((s) => <th key={s.key} className="right">{s.label}</th>)}<th className="right">Total</th></tr></thead>
      <tbody>{data.byHour.map((h) => {
        const t = used.reduce((a, s) => a + h[s.key], 0);
        return (
          <tr key={h.hour}><td>{String(h.hour).padStart(2, '0')}:00 a {String((h.hour + 1) % 24).padStart(2, '0')}:00</td>
            {used.map((s) => <td key={s.key} className="right kwh">{h[s.key] ? fmtK(h[s.key], 2) : '—'}</td>)}
            <td className="right kwh" style={{ fontWeight: 600 }}>{t ? fmtK(t, 2) : '—'}</td></tr>
        );
      })}
        <tr className="total"><td>Total</td>{used.map((s) => <td key={s.key} className="right kwh">{fmtK(data.bands[s.key], 2)}</td>)}<td className="right kwh">{kwh(data.total_wh)}</td></tr>
      </tbody>
    </table></div></div>
  );
}
