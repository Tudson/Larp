import { clamp, relax } from './math.js';

/**
 * Sistemul endocrin: concentrații chimice, nu informații.
 *
 * Hormonii de aici nu sunt "citiți" de o regulă de decizie. Creierul are receptori
 * care își schimbă funcționarea în funcție de concentrații (vezi Brain.neuromodulate):
 * aceeași rețea, cu altă chimie, se comportă altfel.
 *
 *   grelină (G)        - foame: crește odată cu deficitul energetic, scade la absorbție
 *   noradrenalină (NA) - alertă: rapidă; durere, surpriză, amenințare prezisă
 *   cortizol (C)       - stres: lent (minute); acumulează durere, NA susținută,
 *                        deficit homeostatic, eșecuri; tamponat de îngrijitor
 *   dopamină (DA)      - fazică: eroarea de predicție a recompensei (Schultz et al., 1997)
 *                        tonică: "momentul" erorilor recente (Eldar et al., 2016); setează
 *                        vigoarea și explorarea (Niv et al., 2007)
 *
 * Adaptarea receptorilor dopaminergici este o regulă generală de plasticitate
 * homeostatică: sensibilitatea se ajustează lent astfel încât expunerea medie să
 * rămână normală. Din ea apar, fără cod separat, toleranța, anhedonia și sevrajul.
 */
export class Endocrine {
  constructor(params) {
    this.p = params;
    this.ghrelin = 0.25;
    this.noradrenaline = params.neBase;
    this.cortisol = params.cortBase;
    this.exogenous = 0; // dopamină tonică adăugată farmacologic (agonism x sânge)
    this.exposure = params.daBase;
    this.receptor = 1;
    this.stressSensitization = 0;
    this.incentiveSensitization = 0;
    this.lastPhasic = 0; // ultimul semnal fazic (pentru înregistrare)
    // "Momentul" erorilor de predicție recente (Eldar et al., 2016): o serie de surprize
    // pozitive ridică tonusul dopaminergic, o serie de eșecuri îl coboară.
    this.momentum = 0;
    this.lastSurge = 0; // ultimul vârf exogen efectiv
  }

  // Tonusul dopaminergic endogen: nivel de bază, "momentul" erorilor de predicție recente
  // (Eldar et al., 2016) și grelina, care activează direct neuronii dopaminergici din VTA
  // (Abizaid et al., 2006).
  get tonicFactor() {
    return clamp(1 + this.momentum + this.p.ghrelinDA * this.ghrelin, 0.15, 1.9);
  }

  get daRaw() {
    return this.p.daBase * this.tonicFactor + this.exogenous;
  }

  get daEffective() {
    return this.receptor * this.daRaw;
  }

  // Dopamina tonică efectivă raportată la nivelul normal (1 = normal).
  get daNorm() {
    return this.daEffective / this.p.daBase;
  }

  // Reactivitatea axei de stres (crește după traume, scade lent).
  get stressReactivity() {
    return 1 + this.stressSensitization;
  }

  // Factorul de "dorință" (incentive salience) aplicat valorilor învățate de obișnuință.
  get incentiveGain() {
    return 1 + this.incentiveSensitization;
  }

  // Un semnal dopaminergic fazic (eroare de predicție), raportat de creier.
  // `aversive` = semnalul vine dintr-o experiență dureroasă (contribuie puțin la moment).
  phasic(delta, aversive = false) {
    const p = this.p;
    this.lastPhasic = delta;
    // Dezamăgirile cântăresc mai mult decât surprizele plăcute; durerea așteptată, puțin.
    let gain = delta < 0 ? p.momentumLossGain : p.momentumGain;
    if (aversive) gain *= 0.25;
    this.momentum = clamp(this.momentum + gain * delta, -0.6, 0.8);
    this.noradrenaline += this.stressReactivity * p.neSurprise * Math.abs(delta);
    if (delta < 0) this.cortisol += p.cortFromNegativeRPE * -delta;
    if (delta > p.incentiveThreshold) {
      this.incentiveSensitization = Math.min(
        p.incentiveMax,
        this.incentiveSensitization + p.incentiveSensitization * (delta - p.incentiveThreshold),
      );
    }
  }

  // Un stimul care prezice brusc recompensă (cue) produce o descărcare anticipatorie.
  cue(burst) {
    this.noradrenaline += this.p.neCue * burst;
  }

  step(dt, { body, painRate, threat, drive, buffered }) {
    const p = this.p;
    const s = body.signals;

    // --- grelină
    const ghrelinTarget = clamp((p.ghrelinSetpoint - body.energy) / p.ghrelinSpan, 0, 1);
    this.ghrelin = relax(this.ghrelin, ghrelinTarget, p.ghrelinTau, dt);
    if (s.energyIn > 0) this.ghrelin *= Math.max(0, 1 - p.satiety * s.energyIn);

    // --- dopamină: rata de recompensă, componenta exogenă, receptori
    this.exogenous = body.bloodAgonism * body.blood;
    this.lastSurge = this.receptor * s.surgeRaw;
    this.exposure = relax(this.exposure, this.daRaw, p.exposureTau, dt);
    const receptorTarget = clamp(p.daBase / Math.max(this.exposure, 1e-3), p.receptorMin, p.receptorMax);
    const tau = receptorTarget < this.receptor ? p.receptorDownTau : p.receptorUpTau;
    this.receptor = relax(this.receptor, receptorTarget, tau, dt);
    this.incentiveSensitization = relax(this.incentiveSensitization, 0, p.incentiveTau, dt);
    this.momentum = relax(this.momentum, 0, p.momentumTau, dt);

    // --- noradrenalină: rapidă, amplificată de sensibilizarea la stres
    const reactivity = this.stressReactivity;
    this.noradrenaline = relax(this.noradrenaline, p.neBase, p.neTau, dt);
    this.noradrenaline += reactivity * (p.nePain * painRate + p.neThreat * threat) * dt;
    this.noradrenaline = clamp(this.noradrenaline, 0, 1.6);

    if (painRate > 0.05) this.stressSensitization += p.sensitizationGain * painRate * dt;
    this.stressSensitization = clamp(
      relax(this.stressSensitization, 0, p.sensitizationTau, dt),
      0,
      p.sensitizationMax,
    );

    // --- cortizol: lent; integrează tot ce dezechilibrează organismul
    const base = buffered ? p.cortBaseInfant : p.cortBase;
    this.cortisol = relax(this.cortisol, base, p.cortTau, dt);
    const load =
      p.cortFromNE * Math.max(0, this.noradrenaline - 0.35) +
      p.cortFromPain * painRate +
      p.cortFromDrive * Math.max(0, drive - 0.35) +
      p.cortFromLowDA * Math.max(0, 0.7 - this.daNorm);
    this.cortisol = clamp(this.cortisol + load * dt, 0, 1.3);
  }
}
