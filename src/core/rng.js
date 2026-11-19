// Generator pseudo-aleator determinist (mulberry32).
// Aceeași sămânță => aceeași istorie de viață, deci orice rezultat poate fi reprodus exact.

export function createRng(seed) {
  let state = seed >>> 0;
  let spareNormal = null;

  function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function normal() {
    if (spareNormal !== null) {
      const v = spareNormal;
      spareNormal = null;
      return v;
    }
    let u = 0;
    while (u === 0) u = next();
    const v = next();
    const mag = Math.sqrt(-2 * Math.log(u));
    spareNormal = mag * Math.sin(2 * Math.PI * v);
    return mag * Math.cos(2 * Math.PI * v);
  }

  return {
    next,
    normal,
    uniform: (lo, hi) => lo + (hi - lo) * next(),
    chance: (p) => next() < p,
  };
}

// Sămânță derivată, pentru fluxuri independente (mediu vs. organism).
export function deriveSeed(seed, salt) {
  let h = (seed ^ Math.imul(salt, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}
