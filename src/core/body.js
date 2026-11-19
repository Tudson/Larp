import { clamp } from './math.js';

/**
 * Corpul: variabilele vitale și fiziologia lor.
 *
 * Corpul nu știe ce obiecte există în lume. Primește doar efecte fizico-chimice
 * (energie absorbită, leziuni mecanice, un compus exogen în sânge) și produce
 * semnale interoceptive pe care creierul le poate simți:
 *   - energyIn:    energie absorbită (gust/sațietate)
 *   - nociception: leziune mecanică (durere)
 *   - malaise:     leziune internă tăcută (rău visceral, fără durere acută)
 *   - surgeRaw:    eliberare fazică de dopamină declanșată de un compus exogen
 */
export class Body {
  constructor(params) {
    this.p = params;
    this.energy = params.initialEnergy;
    this.integrity = 1;
    this.alive = true;
    this.deathTime = null;

    // Compartimentul sanguin al unui compus exogen (farmacocinetică cu un compartiment).
    this.blood = 0;
    this.bloodAgonism = 0;
    this.bloodToxicity = 0;
    this.bloodOrganLoad = 0;
    this.bloodClearance = 30;
    this.organLoad = 0; // leziune cumulativă de organ (0..1): reduce capacitatea de reparare

    // Contabilitatea leziunilor (pentru autopsie; nu e folosită de creier).
    this.recentTrauma = 0;
    this.recentToxic = 0;

    this.speedFraction = 0;
    this.resetSignals();
  }

  resetSignals() {
    this.signals = { energyIn: 0, nociception: 0, malaise: 0, surgeRaw: 0, doseIn: 0, tended: 0 };
  }

  // --- efecte venite din mediu -------------------------------------------------

  // Absorbția depinde de starea organelor: un organ lezat extrage mai puțină energie.
  absorb(energy) {
    const before = this.energy;
    const efficiency = 1 - this.p.malabsorption * this.organLoad;
    this.energy = clamp(this.energy + energy * efficiency, 0, 1);
    this.signals.energyIn += this.energy - before;
  }

  wound(amount) {
    this.integrity -= amount;
    this.signals.nociception += amount;
    this.recentTrauma += amount;
  }

  // Intrarea unui compus exogen în sânge. Proprietățile lui vin din chimia mediului.
  infuse({ dose, potency, agonism, toxicity, organLoad, clearance }) {
    this.blood += dose;
    this.bloodAgonism = agonism;
    this.bloodToxicity = toxicity;
    this.bloodOrganLoad = organLoad;
    this.bloodClearance = clearance;
    this.signals.surgeRaw += potency * dose;
    this.signals.doseIn += dose;
  }

  // Îngrijire externă (pansarea rănilor de către îngrijitor).
  tend(amount) {
    const before = this.integrity;
    this.integrity = Math.min(1, this.integrity + amount);
    this.signals.tended += this.integrity - before;
  }

  // --- fiziologie internă -----------------------------------------------------

  step(dt, { speedFraction, cortisol, metabolicScale }) {
    if (!this.alive) return;
    const p = this.p;
    this.speedFraction = speedFraction;

    const burn =
      (p.basalBurn * metabolicScale * (1 + p.cortisolBurn * cortisol) +
        p.moveBurn * speedFraction * speedFraction) *
      dt;

    // Repararea țesuturilor cere energie și e inhibată de cortizol și de leziunea de organ.
    const capacity =
      clamp(1 - this.organLoad, 0, 1) *
      clamp(1 - p.cortisolHealSuppression * cortisol, 0.2, 1) *
      clamp(this.energy / 0.25, 0, 1);
    const heal = p.healRate * Math.max(0, 1 - this.integrity) * capacity * dt;

    // Toxicitatea compusului din sânge: leziune internă, fără durere.
    const toxic = this.bloodToxicity * this.blood * dt;

    this.energy -= burn + heal * p.healCost;
    this.integrity += heal - toxic;
    this.signals.malaise += toxic;
    this.recentToxic += toxic;

    this.organLoad = clamp(
      this.organLoad + this.bloodOrganLoad * this.blood * dt - (this.organLoad / p.organClearance) * dt,
      0,
      1,
    );
    this.blood *= Math.exp(-dt / this.bloodClearance);
    if (this.blood < 1e-4) this.blood = 0;

    // Memoria leziunilor recente se estompează (fereastră ~60 s), doar pentru autopsie.
    const fade = Math.exp(-dt / 60);
    this.recentTrauma *= fade;
    this.recentToxic *= fade;

    this.energy = clamp(this.energy, 0, 1);
    this.integrity = Math.min(this.integrity, 1);
    if (this.energy <= 0 || this.integrity <= 0) this.alive = false;
  }
}
