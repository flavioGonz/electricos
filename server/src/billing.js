// Valorización de sesiones según tarifa: simple (con valle opcional) o por franjas UTE (punta/llano/valle) = costo + margen.

const TZ = process.env.TZ_LOCAL || 'America/Montevideo';
const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23', weekday: 'short' });

export function localParts(date) {
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  return { hour: Number(p.hour), weekend: p.weekday === 'Sat' || p.weekday === 'Sun' };
}
export const localHour = (date) => localParts(date).hour;

/** ¿La hora h cae en [start, end)? Soporta franjas que cruzan medianoche. */
export function inRange(h, start, end) {
  if (start == null || end == null) return false;
  return start <= end ? h >= start && h < end : h >= start || h < end;
}

export function isOffpeak(tariff, date) {
  if (tariff.offpeak_price_kwh == null) return false;
  return inRange(localHour(date), tariff.offpeak_start_hour, tariff.offpeak_end_hour);
}

/** Franja UTE de un instante: 'punta' | 'llano' | 'valle'. */
export function bandAt(tariff, date) {
  const { hour, weekend } = localParts(date);
  if (inRange(hour, tariff.valle_start_hour, tariff.valle_end_hour)) return 'valle';
  if (inRange(hour, tariff.punta_start_hour, tariff.punta_end_hour) && !(tariff.punta_weekdays_only && weekend)) return 'punta';
  return 'llano';
}

const num = (v) => (v == null ? 0 : Number(v));

/** Precio por kWh y costo de energía por kWh vigentes en un instante, con la etiqueta de la franja. */
export function rateAt(tariff, date) {
  if (tariff.mode === 'franjas') {
    const b = bandAt(tariff, date);
    const cost = num(tariff[`cost_${b}`]);
    return { band: b, price: cost + num(tariff[`margin_${b}`]), cost };
  }
  const off = isOffpeak(tariff, date);
  return { band: off ? 'valle' : 'normal', price: num(off ? tariff.offpeak_price_kwh : tariff.price_kwh), cost: num(tariff.energy_cost_kwh) };
}
export const priceAt = (tariff, date) => rateAt(tariff, date).price;

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Calcula energía, importe, costo de energía y margen de una sesión.
 * readings: lecturas acumuladas {ts, energy_wh} (inicio y fin incluidos). Cada incremento se cobra
 * al precio de la franja vigente en la lectura que lo cierra.
 */
export function priceSession(tariff, readings) {
  const pts = readings
    .filter((r) => r.energy_wh != null)
    .map((r) => ({ ts: new Date(r.ts), wh: Number(r.energy_wh) }))
    .sort((a, b) => a.ts - b.ts);
  const fee = tariff ? num(tariff.session_fee) : 0;
  const bands = new Map();
  let energy = 0;
  for (let i = 1; i < pts.length; i++) {
    const delta = pts[i].wh - pts[i - 1].wh;
    if (delta <= 0) continue; // lecturas fuera de orden o reinicio del medidor
    energy += delta;
    if (!tariff) continue;
    const r = rateAt(tariff, pts[i].ts);
    const key = `${r.band}|${r.price}|${r.cost}`;
    const b = bands.get(key) || { band: r.band, price_kwh: r.price, cost_kwh: r.cost, energy_wh: 0 };
    b.energy_wh += delta;
    bands.set(key, b);
  }
  const breakdown = [...bands.values()].map((b) => ({ ...b, amount: round2((b.energy_wh / 1000) * b.price_kwh) }));
  const energyAmount = breakdown.reduce((s, b) => s + (b.energy_wh / 1000) * b.price_kwh, 0);
  const cost = breakdown.reduce((s, b) => s + (b.energy_wh / 1000) * b.cost_kwh, 0);
  const amount = round2(energyAmount + fee);
  const energy_cost = round2(cost);
  return { energy_wh: energy, amount, energy_cost, margin: round2(amount - energy_cost), breakdown };
}
