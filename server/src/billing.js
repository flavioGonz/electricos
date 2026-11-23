// Valorización de sesiones de carga según tarifa, partiendo la energía por franja horaria.

const TZ = process.env.TZ_LOCAL || 'America/Montevideo';
const hourFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' });

export function localHour(date) {
  return Number(hourFmt.format(date));
}

/** ¿La hora local cae en la franja valle? Soporta franjas que cruzan medianoche (ej. 0 a 7, o 22 a 6). */
export function isOffpeak(tariff, date) {
  if (tariff.offpeak_price_kwh == null || tariff.offpeak_start_hour == null || tariff.offpeak_end_hour == null) return false;
  const h = localHour(date);
  const s = tariff.offpeak_start_hour;
  const e = tariff.offpeak_end_hour;
  return s <= e ? h >= s && h < e : h >= s || h < e;
}

export function priceAt(tariff, date) {
  return isOffpeak(tariff, date) ? tariff.offpeak_price_kwh : tariff.price_kwh;
}

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Calcula energía e importe de una sesión.
 * @param {object} tariff fila de tariffs
 * @param {{ts: Date, energy_wh: number}[]} readings lecturas acumuladas ordenadas, incluyendo inicio y fin
 * Cada incremento de energía entre dos lecturas se cobra al precio vigente en la lectura final del tramo.
 */
export function priceSession(tariff, readings) {
  const pts = readings
    .filter((r) => r.energy_wh != null)
    .map((r) => ({ ts: new Date(r.ts), wh: Number(r.energy_wh) }))
    .sort((a, b) => a.ts - b.ts);
  if (pts.length < 2) return { energy_wh: 0, amount: round2(tariff ? Number(tariff.session_fee || 0) : 0), breakdown: [] };

  let energy = 0;
  let amount = 0;
  const buckets = new Map();
  for (let i = 1; i < pts.length; i++) {
    const delta = pts[i].wh - pts[i - 1].wh;
    if (delta <= 0) continue; // lecturas fuera de orden o reinicio del medidor
    energy += delta;
    if (!tariff) continue;
    const price = Number(priceAt(tariff, pts[i].ts));
    amount += (delta / 1000) * price;
    buckets.set(price, (buckets.get(price) || 0) + delta);
  }
  if (tariff) amount += Number(tariff.session_fee || 0);
  const breakdown = [...buckets].map(([price, wh]) => ({ price_kwh: price, energy_wh: wh, amount: round2((wh / 1000) * price) }));
  return { energy_wh: energy, amount: round2(amount), breakdown };
}
