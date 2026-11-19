// Formatare în stil românesc (virgulă zecimală).

export function fmt(value, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toFixed(digits).replace('-', '−').replace('.', ',');
}

export function fmtTime(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')} min`;
}

export function fmtPercent(share, digits = 0) {
  if (share === null || share === undefined || !Number.isFinite(share)) return '—';
  return `${(share * 100).toFixed(digits).replace('.', ',')}%`;
}

export const CAUSE = { starvation: 'inaniție', toxicity: 'intoxicație', trauma: 'leziuni' };
export const PHASE = { infancy: 'copilărie', autonomy: 'autonomie', trials: 'încercări', substance: 'faza 4' };
