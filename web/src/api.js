// Cliente de la API con el token guardado en localStorage
const KEY = 'electricos_token';
export const getToken = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
export const setToken = (t) => { try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY); } catch {} };

export async function api(path, { method = 'GET', body, raw } = {}) {
  const res = await fetch('/api' + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(getToken() ? { Authorization: 'Bearer ' + getToken() } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && path !== '/auth/login') {
    setToken(null);
    window.dispatchEvent(new Event('logout'));
  }
  if (raw) return res;
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

export const money = (n, cur = 'UYU') => new Intl.NumberFormat('es-UY', { style: 'currency', currency: cur }).format(Number(n || 0));
export const kwh = (wh) => `${(Number(wh || 0) / 1000).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kWh`;
export const dt = (d) => (d ? new Date(d).toLocaleString('es-UY', { dateStyle: 'short', timeStyle: 'short' }) : '—');
export const ago = (d) => {
  if (!d) return 'nunca';
  const s = Math.round((Date.now() - new Date(d)) / 1000);
  if (s < 60) return `hace ${s} s`;
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return dt(d);
};
