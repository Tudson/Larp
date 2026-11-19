// Culorile vin din tokenii CSS, ca desenul pe canvas să urmeze tema (luminoasă/întunecată).

const TOKENS = [
  'bg', 'surface', 'surface-2', 'ink', 'ink-2', 'muted', 'line', 'grid', 'accent', 'arena-bg', 'arena-grid',
  'organism', 'good', 'warn', 'serious', 'critical', 'h-ghrelin', 'h-ne', 'h-cortisol', 'h-dopamine',
  's-calm', 's-alert', 's-fear', 's-frustration', 's-apathy', 's-euphoria', 's-discomfort', 'a-food', 'a-search', 'a-avoid',
  'a-substance', 'a-rest', 'a-other', 'm-want', 'm-like', 'm-goal',
];

let cache = null;
const listeners = new Set();

export function colors() {
  if (!cache) {
    const style = getComputedStyle(document.documentElement);
    cache = {};
    for (const t of TOKENS) cache[t] = style.getPropertyValue(`--${t}`).trim();
    cache.dark = style.getPropertyValue('color-scheme').includes('dark');
  }
  return cache;
}

export function onThemeChange(fn) {
  listeners.add(fn);
}

function invalidate() {
  cache = null;
  for (const fn of listeners) fn();
}

if (typeof window !== 'undefined') {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', invalidate);
  new MutationObserver(invalidate).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme', 'class', 'style'],
  });
}

// Culoarea unei nuanțe din arenă (aceeași nuanță pe care o "vede" organismul).
export function hueColor(hue, { sat = 62, light = 50, alpha = 1 } = {}) {
  const dark = colors().dark;
  const l = dark ? Math.min(72, light + 10) : light;
  return `hsla(${hue}, ${sat}%, ${l}%, ${alpha})`;
}

// Un token hex (#rrggbb) cu transparență.
export function rgba(hex, alpha) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
