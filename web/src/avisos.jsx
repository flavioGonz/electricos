// Avisos: canales (WhatsApp, Telegram, correo), qué se avisa por cada uno, quién recibe y la actividad reciente.
import React, { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { Modal, Field, PageHeader, Loading, Empty, Switch, Segmented } from './components/ui.jsx';
import { Icon } from './components/icons.jsx';
import { api, dt, ago } from './api.js';
import { useApi, act } from './hooks.js';

const CHANNELS = [
  { key: 'whatsapp', name: 'WhatsApp', icon: 'whatsapp', tone: 'wa', blurb: 'Por el gateway OpenWA de Infratec' },
  { key: 'telegram', name: 'Telegram', icon: 'telegram', tone: 'tg', blurb: 'Con un bot propio, gratis y al instante' },
  { key: 'email', name: 'Correo', icon: 'mail', tone: 'em', blurb: 'Servidor SMTP de Google Workspace' },
];
const EVENTS = [
  { key: 'fin_carga', icon: 'bolt', title: 'Fin de carga', desc: 'Energía, tiempo y costo apenas termina.', who: 'Usuarios' },
  { key: 'saldo_bajo', icon: 'battery', title: 'Saldo bajo', desc: 'Cuentas prepagas, como máximo una vez por día.', who: 'Usuarios', threshold: true },
  { key: 'alertas', icon: 'alert', title: 'Alertas de cargadores', desc: 'Sin conexión, fallas y sesiones colgadas.', who: 'Equipo' },
  { key: 'seguridad', icon: 'shield', title: 'Seguridad', desc: 'Usuarios bloqueados por intentos fallidos.', who: 'Equipo' },
  { key: 'respaldo', icon: 'database', title: 'Respaldo nocturno', desc: 'Si falla el respaldo de la base de las 3:15.', who: 'Equipo' },
];
const STATUS = { enviado: ['Enviado', 'ok'], error: ['Error', 'falla'], omitido: ['Omitido', 'gris'], pendiente: ['Pendiente', 'gris'] };
const KIND = { fin_carga: 'Fin de carga', saldo_bajo: 'Saldo bajo', alerta: 'Alerta', seguridad: 'Seguridad', respaldo: 'Respaldo', prueba: 'Prueba', codigo: 'Código de ingreso' };
const isLive = (s) => /connected|conectado|ready|working|open|authenticated/i.test(s || '');

export function Notifications({ me }) {
  const { data, reload } = useApi('/settings');
  const stats = useApi('/notifications/stats');
  const log = useApi('/notifications');
  const [cfg, setCfg] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState({});
  const [edit, setEdit] = useState(null);
  const [test, setTest] = useState(null);
  const [tg, setTg] = useState(false);
  const admin = me?.level === 'admin';
  useEffect(() => { if (data) { setCfg({ ...data.avisos, canales: data.avisos.canales || {} }); setDirty(false); } }, [data]);
  const loadStatus = () => {
    api('/settings/whatsapp/status').then((s) => setStatus((x) => ({ ...x, whatsapp: s }))).catch(() => {});
    api('/settings/telegram/status').then((s) => setStatus((x) => ({ ...x, telegram: s }))).catch(() => {});
  };
  useEffect(loadStatus, [data]);
  const counts = useMemo(() => {
    const c = {};
    for (const r of stats.data?.rows || []) { c[r.channel] = c[r.channel] || { enviado: 0, error: 0 }; c[r.channel][r.status] = (c[r.channel][r.status] || 0) + r.n; }
    return c;
  }, [stats.data]);
  if (!data || !cfg) return <div className="page"><PageHeader title="Avisos" /><Loading rows={5} /></div>;

  const channelState = (k) => {
    const c = data[k];
    if (!c?.enabled) return { label: 'Apagado', tone: 'off' };
    if (k === 'email') return c.pass ? { label: 'Activo', tone: 'on' } : { label: 'Falta la clave', tone: 'warn' };
    const s = status[k];
    if (!s) return { label: 'Verificando', tone: 'wait' };
    return isLive(s.status) ? { label: 'Conectado', tone: 'on' } : { label: s.status === 'sin configurar' ? 'Sin configurar' : 'Sin conexión', tone: 'warn', tip: s.error };
  };
  const set = (patch) => { setCfg({ ...cfg, ...patch }); setDirty(true); };
  const toggleCell = (ev, ch) => {
    const cur = cfg.canales?.[ev] || {};
    set({ canales: { ...cfg.canales, [ev]: { ...cur, [ch]: cur[ch] === false } } });
  };
  const saveCfg = () => act(() => api('/settings/avisos', { method: 'PUT', body: cfg }), 'Avisos guardados').then(reload).catch(() => {});
  const quickToggle = (k, v) => act(() => api(`/settings/${k}`, { method: 'PUT', body: { ...data[k], enabled: v } }), v ? 'Canal encendido' : 'Canal apagado').then(reload).catch(() => {});
  const b = data.backup_status;
  const totalSent = Object.values(counts).reduce((a, c) => a + (c.enviado || 0), 0);
  const totalErr = Object.values(counts).reduce((a, c) => a + (c.error || 0), 0);

  return (
    <div className="page av">
      <PageHeader title="Avisos" desc="Mensajes automáticos para usuarios y para el equipo técnico, por el canal que cada uno prefiera."
        actions={<>
          <button className="btn sec" onClick={() => setTg(true)}><Icon name="telegram" size={16} />{me?.telegram ? 'Mi Telegram' : 'Conectar mi Telegram'}</button>
          <button className="btn" onClick={() => setTest({ channel: 'whatsapp', to: '' })}><Icon name="send" size={15} />Enviar prueba</button>
        </>} />

      <div className="av-hero">
        <div><span className="av-big">{totalSent.toLocaleString('es-UY')}</span><span className="muted">avisos enviados en 30 días</span></div>
        <div><span className={'av-big' + (totalErr ? ' bad' : '')}>{totalErr}</span><span className="muted">con error</span></div>
        <div><span className="av-big">{CHANNELS.filter((c) => channelState(c.key).tone === 'on').length}<small>/3</small></span><span className="muted">canales funcionando</span></div>
        <div className="av-backup">
          <span className={'av-led ' + (!b?.at ? 'off' : b.ok ? 'on' : 'bad')} />
          <div><b>Respaldo nocturno</b><span className="muted">{b?.at ? `${b.ok ? 'Correcto' : 'Con error'} · ${ago(b.at)}` : 'Sin registros todavía'}</span></div>
        </div>
      </div>

      <div className="av-channels">
        {CHANNELS.map((c) => {
          const st = channelState(c.key);
          const n = counts[c.key] || {};
          return (
            <section key={c.key} className={`av-ch ${c.tone}${data[c.key]?.enabled ? ' is-on' : ''}`}>
              <div className="av-ch-top">
                <span className={`av-ch-ico ${c.tone}`}><Icon name={c.icon} size={22} /></span>
                {admin && <label className="av-switch" data-tip={data[c.key]?.enabled ? 'Apagar el canal' : 'Encender el canal'}>
                  <input type="checkbox" checked={!!data[c.key]?.enabled} onChange={(e) => quickToggle(c.key, e.target.checked)} /><span />
                </label>}
              </div>
              <h3>{c.name}</h3>
              <p className="muted">{c.key === 'telegram' && status.telegram?.username ? `@${status.telegram.username}` : c.blurb}</p>
              <div className="av-ch-meta">
                <span className={`av-pill ${st.tone}`} data-tip={st.tip || ''}><i />{st.label}</span>
                <span className="av-ch-n" data-tip="Enviados y con error en los últimos 30 días"><b>{n.enviado || 0}</b> enviados{n.error ? <em> · {n.error} con error</em> : null}</span>
              </div>
              <button className="av-ch-cfg" onClick={() => setEdit(c.key)}>Configurar<Icon name="chevronRight" size={15} /></button>
            </section>
          );
        })}
      </div>

      <section className="card av-matrix">
        <header>
          <div><h2>Qué se avisa y por dónde</h2><p className="muted">Tocá cada canal para prenderlo o apagarlo en ese aviso. Los usuarios además eligen sus canales desde la app.</p></div>
          {admin && <button className={'btn' + (dirty ? '' : ' sec')} disabled={!dirty} onClick={saveCfg}><Icon name="check" size={15} />{dirty ? 'Guardar cambios' : 'Guardado'}</button>}
        </header>
        <div className="av-rows">
          {EVENTS.map((ev) => {
            const on = cfg[ev.key] !== false;
            return (
              <div key={ev.key} className={'av-row' + (on ? '' : ' off')}>
                <span className="av-ev-ico"><Icon name={ev.icon} size={17} /></span>
                <div className="av-ev">
                  <b>{ev.title}<span className="av-who">{ev.who}</span></b>
                  <span className="muted">{ev.desc}</span>
                  {ev.threshold && on && (
                    <label className="av-thr">Avisar por debajo de <span>$</span><input type="number" min="0" value={cfg.saldo_bajo_umbral ?? 200} disabled={!admin} onChange={(e) => set({ saldo_bajo_umbral: Number(e.target.value) })} /></label>
                  )}
                </div>
                <div className="av-cells">
                  {CHANNELS.map((c) => {
                    const active = on && cfg.canales?.[ev.key]?.[c.key] !== false;
                    const chOff = !data[c.key]?.enabled;
                    return (
                      <button key={c.key} type="button" disabled={!admin || !on} className={`av-cell ${c.tone}${active ? ' on' : ''}${chOff ? ' ch-off' : ''}`} aria-pressed={active}
                        data-tip={`${c.name}: ${active ? 'se envía' : 'no se envía'}${chOff ? ' (el canal está apagado)' : ''}`} onClick={() => toggleCell(ev.key, c.key)}>
                        <Icon name={c.icon} size={15} />
                      </button>
                    );
                  })}
                </div>
                <label className="av-switch sm" data-tip={on ? 'Apagar este aviso' : 'Encender este aviso'}>
                  <input type="checkbox" checked={on} disabled={!admin} onChange={(e) => set({ [ev.key]: e.target.checked })} /><span />
                </label>
              </div>
            );
          })}
        </div>
      </section>

      <Recipients cfg={cfg} admin={admin} onChange={(patch) => set(patch)} dirty={dirty} onSave={saveCfg} />

      <Activity log={log} daily={stats.data?.daily || []} />

      {edit && <ChannelPanel channel={edit} value={data[edit]} status={status[edit]} admin={admin} onClose={() => setEdit(null)}
        onSaved={() => { setEdit(null); reload(); stats.reload(); }} onTest={() => { setEdit(null); setTest({ channel: edit, to: '' }); }} />}
      {test && <TestPanel test={test} setTest={setTest} onSent={() => { setTest(null); log.reload(); stats.reload(); }} onFail={() => { log.reload(); stats.reload(); }} />}
      {tg && <TelegramLink me={me} onClose={() => setTg(false)} />}
    </div>
  );
}

// ---------- Destinatarios del equipo técnico ----------
function Recipients({ cfg, admin, onChange, dirty, onSave }) {
  const linked = useApi('/telegram/admins');
  return (
    <section className="card av-rec">
      <header>
        <div><h2>Equipo técnico</h2><p className="muted">Quién recibe las alertas de los cargadores, de seguridad y del respaldo.</p></div>
        {admin && dirty && <button className="btn" onClick={onSave}><Icon name="check" size={15} />Guardar cambios</button>}
      </header>
      <div className="av-rec-grid">
        <div className="av-rec-col">
          <h4><span className="av-mini wa"><Icon name="whatsapp" size={13} /></span>WhatsApp</h4>
          <Tokens values={cfg.admin_whatsapp || []} disabled={!admin} placeholder="099 123 456" onChange={(v) => onChange({ admin_whatsapp: v })} />
        </div>
        <div className="av-rec-col">
          <h4><span className="av-mini tg"><Icon name="telegram" size={13} /></span>Telegram</h4>
          <ul className="av-people">
            {(linked.data || []).map((a) => (
              <li key={a.id} className={a.linked ? 'on' : ''}>
                <span className="av-avatar">{(a.name || a.email).slice(0, 1).toUpperCase()}</span>
                <span className="grow">{a.name || a.email}</span>
                {a.linked ? <span className="av-pill on"><i />Vinculado</span> : <span className="subtle" style={{ fontSize: 12.5 }}>Sin vincular</span>}
              </li>
            ))}
          </ul>
          <p className="subtle av-note">Cada persona lo vincula con «Conectar mi Telegram». También podés sumar un grupo por su número de chat:</p>
          <Tokens values={cfg.admin_telegram || []} disabled={!admin} placeholder="-1001234567890" onChange={(v) => onChange({ admin_telegram: v })} />
        </div>
        <div className="av-rec-col">
          <h4><span className="av-mini em"><Icon name="mail" size={13} /></span>Correo</h4>
          <Tokens values={cfg.admin_email || []} disabled={!admin} placeholder="soporte@infratec.com.uy" onChange={(v) => onChange({ admin_email: v })} />
        </div>
      </div>
    </section>
  );
}

/** Lista de valores como fichas: Enter o coma agrega, la x quita. */
function Tokens({ values, onChange, placeholder, disabled }) {
  const [t, setT] = useState('');
  const add = () => {
    const parts = t.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean).filter((x) => !values.includes(x));
    if (parts.length) onChange([...values, ...parts]);
    setT('');
  };
  return (
    <div className={'av-tokens' + (disabled ? ' ro' : '')}>
      {values.map((v) => (
        <span key={v} className="av-token">{v}{!disabled && <button type="button" aria-label={`Quitar ${v}`} onClick={() => onChange(values.filter((x) => x !== v))}><Icon name="x" size={12} /></button>}</span>
      ))}
      {!disabled && <input value={t} placeholder={values.length ? 'Agregar…' : placeholder} onChange={(e) => setT(e.target.value)} onBlur={add}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } else if (e.key === 'Backspace' && !t && values.length) onChange(values.slice(0, -1)); }} />}
      {disabled && !values.length && <span className="subtle">Nadie todavía</span>}
    </div>
  );
}

// ---------- Actividad ----------
function Activity({ log, daily }) {
  const [ch, setCh] = useState('');
  const rows = (log.data || []).filter((n) => !ch || n.channel === ch);
  const max = Math.max(1, ...daily.map((d) => d.sent + d.failed));
  const days = useMemo(() => {
    const out = [];
    const map = new Map(daily.map((d) => [d.day, d]));
    for (let i = 13; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      out.push({ day: k, label: d.toLocaleDateString('es-UY', { weekday: 'short', day: 'numeric' }), ...(map.get(k) || { sent: 0, failed: 0 }) });
    }
    return out;
  }, [daily]);
  return (
    <section className="card av-act">
      <header>
        <div><h2>Actividad</h2><p className="muted">Los últimos 14 días y cada aviso que salió.</p></div>
        <Segmented value={ch} onChange={setCh} options={[['', 'Todos'], ['whatsapp', 'WhatsApp'], ['telegram', 'Telegram'], ['email', 'Correo']]} />
      </header>
      <div className="av-spark" role="img" aria-label="Avisos enviados por día en los últimos 14 días">
        {days.map((d) => (
          <div key={d.day} className="av-sbar" data-tip={`${d.label}: ${d.sent} enviados${d.failed ? `, ${d.failed} con error` : ''}`}>
            <span className="f" style={{ height: `${(d.failed / max) * 100}%` }} />
            <span className="s" style={{ height: `${(d.sent / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="av-spark-legend"><span><i className="s" />Enviados</span><span><i className="f" />Con error</span></div>
      {!log.data ? <Loading rows={3} /> : rows.length === 0 ? <Empty icon="bell" title="Todavía no hay avisos">Cuando se envíe el primero, aparece acá.</Empty> : (
        <ol className="av-feed">
          {rows.slice(0, 60).map((n) => {
            const [label, tone] = STATUS[n.status] || [n.status, 'gris'];
            const c = CHANNELS.find((x) => x.key === n.channel) || CHANNELS[0];
            return (
              <li key={n.id}>
                <span className={`av-mini ${c.tone}`}><Icon name={c.icon} size={13} /></span>
                <div className="av-feed-main">
                  <div><b>{KIND[n.kind] || n.kind}</b><span className="subtle"> · {n.channel === 'telegram' ? 'chat ' : ''}{n.to_addr}</span></div>
                  <div className="muted av-feed-body" data-tip={n.body}>{(n.subject ? `${n.subject.replace(/^\W+\s*/, '')}: ` : '') + n.body.split('\n')[0]}</div>
                </div>
                <span className={`badge mini ${tone}`} data-tip={n.error || ''}><span className="dot" />{label}</span>
                <time className="subtle" data-tip={dt(n.at)}>{ago(n.at)}</time>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

// ---------- Paneles ----------
function ChannelPanel({ channel, value, status, admin, onClose, onSaved, onTest }) {
  const [v, setV] = useState(value || {});
  const c = CHANNELS.find((x) => x.key === channel);
  const set = (k) => (e) => setV({ ...v, [k]: e.target.type === 'number' ? Number(e.target.value) : e.target.value });
  const save = () => act(() => api(`/settings/${channel}`, { method: 'PUT', body: v }), `${c.name} guardado`).then(onSaved).catch(() => {});
  return (
    <Modal icon={c.icon} tone={channel === 'whatsapp' ? 'green' : 'blue'} title={c.name} subtitle={c.blurb} onClose={onClose}
      footer={<><button className="btn sec" onClick={onTest}><Icon name="send" size={15} />Probar</button><span className="grow" /><button className="btn ghost" data-close onClick={onClose}>Cancelar</button>{admin && <button className="btn" onClick={save}><Icon name="check" size={16} />Guardar</button>}</>}>
      <div className="form-grid">
        <div className="field full"><Switch label={`Enviar avisos por ${c.name}`} checked={!!v.enabled} onChange={(x) => setV({ ...v, enabled: x })} /></div>
        {channel === 'whatsapp' && <>
          <Field className="full" label="Dirección de OpenWA"><input value={v.url || ''} onChange={set('url')} placeholder="http://192.168.99.22:2785" /></Field>
          <Field className="full" label="Sesión"><input className="mono" value={v.session || ''} onChange={set('session')} /></Field>
          <Field className="full" label="Clave de API"><input type="password" value={v.api_key || ''} onChange={set('api_key')} autoComplete="off" /></Field>
          {status && <p className="muted full av-status-line">Estado de la sesión: <b>{status.status}</b>{status.phone ? ` · ${status.phone}` : ''}</p>}
        </>}
        {channel === 'telegram' && <>
          <ol className="av-steps full">
            <li>En Telegram, abrí <b>@BotFather</b> y mandale <code>/newbot</code>.</li>
            <li>Elegí un nombre (por ejemplo «Eléctricos Infratec») y un usuario que termine en <code>bot</code>.</li>
            <li>Copiá el token que te da y pegalo acá abajo.</li>
          </ol>
          <Field className="full" label="Token del bot" hint="Se guarda cifrado."><input type="password" value={v.bot_token || ''} onChange={set('bot_token')} placeholder="123456789:AA…" autoComplete="off" /></Field>
          {status?.username && <p className="muted full av-status-line">Bot conectado: <b>@{status.username}</b>{status.name ? ` · ${status.name}` : ''}</p>}
          {status?.error && <p className="full av-status-line danger-text">{status.error}</p>}
        </>}
        {channel === 'email' && <>
          <Field label="Servidor"><input value={v.host || ''} onChange={set('host')} /></Field>
          <Field label="Puerto"><input type="number" value={v.port || 587} onChange={set('port')} /></Field>
          <Field className="full" label="Usuario"><input value={v.user || ''} onChange={set('user')} placeholder="no-replay@infratec.com.uy" /></Field>
          <Field className="full" label="Contraseña" hint="En Google Workspace, una contraseña de aplicación."><input type="password" value={v.pass || ''} onChange={set('pass')} autoComplete="off" /></Field>
          <Field className="full" label="Remitente"><input value={v.from || ''} onChange={set('from')} /></Field>
        </>}
      </div>
    </Modal>
  );
}

function TestPanel({ test, setTest, onSent, onFail }) {
  const send = () => act(() => api('/settings/test', { method: 'POST', body: test }), 'Mensaje de prueba enviado').then(onSent).catch(onFail);
  const ph = { whatsapp: ['Celular', '099 123 456'], telegram: ['Número de chat', '123456789'], email: ['Email', 'nombre@empresa.com'] }[test.channel];
  return (
    <Modal icon="send" tone="green" size="sm" title="Mensaje de prueba" subtitle="Para confirmar que el canal funciona" onClose={() => setTest(null)}
      footer={<><button className="btn sec" data-close onClick={() => setTest(null)}>Cancelar</button><button className="btn" disabled={!test.to} onClick={send}><Icon name="send" size={15} />Enviar</button></>}>
      <div className="form-grid">
        <div className="field full"><Segmented value={test.channel} onChange={(v) => setTest({ ...test, channel: v, to: '' })} options={CHANNELS.map((c) => [c.key, c.name])} /></div>
        <Field className="full" label={ph[0]} hint={test.channel === 'telegram' ? 'Mandale /start al bot y te responde con tu número de chat.' : undefined}>
          <input value={test.to} onChange={(e) => setTest({ ...test, to: e.target.value })} placeholder={ph[1]} autoFocus />
        </Field>
      </div>
    </Modal>
  );
}

function TelegramLink({ me, onClose }) {
  const [link, setLink] = useState(null);
  const [svg, setSvg] = useState('');
  const [linked, setLinked] = useState(!!me?.telegram);
  const gen = () => act(() => api('/me/telegram', { method: 'POST' })).then(async (r) => {
    setLink(r);
    setSvg(await QRCode.toString(r.url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#1d1d1f', light: '#ffffff' } }));
  }).catch(() => {});
  useEffect(() => { if (!linked) gen(); }, []);
  // Mientras el panel está abierto, revisa cada 3 s si ya se vinculó
  useEffect(() => {
    if (!link || linked) return;
    const t = setInterval(() => api('/me').then((m) => { if (m.telegram) { setLinked(true); clearInterval(t); } }).catch(() => {}), 3000);
    return () => clearInterval(t);
  }, [link, linked]);
  const unlink = () => act(() => api('/me/telegram', { method: 'DELETE' }), 'Telegram desvinculado').then(() => { setLinked(false); gen(); }).catch(() => {});
  return (
    <Modal icon="telegram" tone="blue" title="Mi Telegram" subtitle="Recibí las alertas en tu celular" size="sm" onClose={onClose}
      footer={<><button className="btn sec" data-close onClick={onClose}>Cerrar</button>{linked && <button className="btn danger" onClick={unlink}>Desvincular</button>}</>}>
      {linked ? (
        <div className="av-linked"><span className="av-ch-ico tg big"><Icon name="check" size={28} /></span><h3>Telegram vinculado</h3><p className="muted">Las alertas del sistema te llegan por Telegram. Podés desvincularlo cuando quieras.</p></div>
      ) : !link ? <Loading rows={3} /> : (
        <div className="av-link">
          <div className="mfa-qr" dangerouslySetInnerHTML={{ __html: svg }} />
          <p className="muted">Escaneá el código con el celular o abrí el enlace y tocá <b>Iniciar</b>. El enlace vence en 30 minutos.</p>
          <a className="btn block" href={link.url} target="_blank" rel="noreferrer"><Icon name="telegram" size={16} />Abrir @{link.username}</a>
          <p className="subtle av-wait"><span className="spin dark" />Esperando que toques Iniciar…</p>
        </div>
      )}
    </Modal>
  );
}
