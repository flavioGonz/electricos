import { useCallback, useEffect, useState } from 'react';
import { api, getToken } from './api.js';
import { toast } from './components/toast.jsx';

/** Carga datos de la API y los recarga con reload() o ante eventos en vivo si live=true. */
export function useApi(path, { live = false } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const reload = useCallback(() => {
    if (!path) return;
    api(path).then((d) => { setData(d); setError(null); }).catch((e) => setError(e.message));
  }, [path]);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    if (!live) return;
    let t;
    const off = onLive(() => { clearTimeout(t); t = setTimeout(reload, 400); });
    return () => { off(); clearTimeout(t); };
  }, [live, reload]);
  return { data, error, reload, setData };
}

// Un solo EventSource compartido por toda la app
let es = null;
const subs = new Set();
function onLive(fn) {
  subs.add(fn);
  if (!es && getToken()) {
    es = new EventSource('/api/events?token=' + encodeURIComponent(getToken()));
    es.onmessage = (m) => { const e = JSON.parse(m.data); subs.forEach((s) => s(e)); };
    es.onerror = () => { /* el navegador reintenta solo */ };
  }
  return () => {
    subs.delete(fn);
    if (!subs.size && es) { es.close(); es = null; }
  };
}

/** Ejecuta una acción con toast de éxito/error. */
export async function act(fn, okMsg) {
  try {
    const r = await fn();
    if (okMsg) toast.ok(typeof okMsg === 'function' ? okMsg(r) : okMsg);
    return r;
  } catch (e) {
    toast.err(e.message);
    throw e;
  }
}
