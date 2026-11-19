// Utilitare numerice și codul populațional pentru nuanță (hue).

export const TAU = Math.PI * 2;

export const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const toRad = (deg) => (deg * Math.PI) / 180;

// Relaxare exponențială exactă spre o țintă, cu constanta de timp tau (secunde).
export function relax(value, target, tau, dt) {
  return target + (value - target) * Math.exp(-dt / tau);
}

/**
 * Cod populațional circular: N neuroni senzoriali acordați pe nuanțe diferite
 * (curbe de acord von Mises), ca neuronii selectivi la culoare din cortexul vizual.
 * Organismul nu primește "tipul" unui obiect, ci doar activarea acestor neuroni.
 * Generalizarea apare de la sine: nuanțele apropiate activează neuroni comuni.
 */
export class HueCode {
  constructor(size, kappa) {
    this.size = size;
    this.kappa = kappa;
    this.centers = Array.from({ length: size }, (_, j) => (TAU * j) / size);
  }

  // Returnează activarea normalizată (sumă = 1) pentru o nuanță în grade.
  encode(hueDeg) {
    const theta = toRad(hueDeg);
    const out = new Float64Array(this.size);
    let sum = 0;
    for (let j = 0; j < this.size; j++) {
      const a = Math.exp(this.kappa * (Math.cos(theta - this.centers[j]) - 1));
      out[j] = a;
      sum += a;
    }
    for (let j = 0; j < this.size; j++) out[j] /= sum;
    return out;
  }
}

/**
 * O asociere învățată peste codul de nuanță: o funcție hue -> valoare, stocată ca
 * ponderi sinaptice. Învățarea este regula delta (Rescorla & Wagner, 1972) normalizată,
 * astfel încât rata de învățare are aceeași semnificație indiferent de lățimea acordului.
 */
export class HueMap {
  constructor(code, initial = 0) {
    this.code = code;
    this.w = new Float64Array(code.size).fill(initial);
  }

  predict(phi) {
    let v = 0;
    for (let j = 0; j < phi.length; j++) v += this.w[j] * phi[j];
    return v;
  }

  // Mută predicția din punctul phi cu `rate * error` (și vecinii proporțional).
  update(phi, error, rate) {
    let norm = 0;
    for (let j = 0; j < phi.length; j++) norm += phi[j] * phi[j];
    const k = (rate * error) / norm;
    for (let j = 0; j < phi.length; j++) this.w[j] += k * phi[j];
  }

  clampWeights(lo, hi) {
    for (let j = 0; j < this.w.length; j++) this.w[j] = clamp(this.w[j], lo, hi);
  }

  // Eșantionare pe tot cercul de nuanțe (pentru vizualizare).
  profile(points = 72) {
    const out = new Array(points);
    for (let i = 0; i < points; i++) {
      out[i] = this.predict(this.code.encode((360 * i) / points));
    }
    return out;
  }
}

/**
 * O asociere care se poate stinge fără să fie ștearsă (Bouton, 2004). Când o așteptare
 * pozitivă nu se confirmă, se învață o inhibiție separată, care se estompează în timp:
 * de aici "recuperarea spontană" (Pavlov, 1927) și reînvățarea rapidă după o pauză.
 */
export class ExtinguishableMap extends HueMap {
  constructor(code, tau) {
    super(code);
    this.inhibition = new Float64Array(code.size);
    this.tau = tau;
  }

  predict(phi) {
    let v = 0;
    for (let j = 0; j < phi.length; j++) v += (this.w[j] - this.inhibition[j]) * phi[j];
    return v;
  }

  update(phi, error, rate) {
    let norm = 0;
    for (let j = 0; j < phi.length; j++) norm += phi[j] * phi[j];
    const k = (rate * error) / norm;
    if (error < 0 && this.predict(phi) > 0) {
      // stingere: inhibiție nouă, asocierea veche rămâne
      for (let j = 0; j < phi.length; j++) this.inhibition[j] -= k * phi[j];
      return;
    }
    // confirmare: întâi dispare inhibiția, restul întărește asocierea
    for (let j = 0; j < phi.length; j++) {
      let delta = k * phi[j];
      if (delta > 0 && this.inhibition[j] > 0) {
        const used = Math.min(this.inhibition[j], delta);
        this.inhibition[j] -= used;
        delta -= used;
      }
      this.w[j] += delta;
    }
  }

  relax(dt) {
    const f = Math.exp(-dt / this.tau);
    for (let j = 0; j < this.inhibition.length; j++) this.inhibition[j] *= f;
  }
}
