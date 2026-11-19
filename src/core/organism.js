import { Body } from './body.js';
import { Endocrine } from './endocrine.js';
import { Brain } from './brain.js';
import { clamp } from './math.js';

/**
 * Organismul = corp + sistem endocrin + creier, legate într-o singură buclă:
 * percepție -> decizie -> mișcare -> contact -> fiziologie -> chimie -> (alt creier).
 */
export class Organism {
  constructor(params, rng, x, y) {
    this.params = params;
    this.body = new Body(params.body);
    this.endocrine = new Endocrine(params.endocrine);
    this.brain = new Brain(params.brain, rng);
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.radius = 1.2;
    this.maturation = params.maturation.start;
    this.lastPainSource = null;
  }

  get alive() {
    return this.body.alive;
  }

  // Maturizarea motorie și senzorială: foarte lentă la început (nou-născutul abia se
  // târăște și vede doar în imediata apropiere), apoi accelerată, apoi completă.
  updateMaturation(time, infancyEnd) {
    const x = clamp(time / infancyEnd, 0, 1);
    const start = this.params.maturation.start;
    this.maturation = start + (1 - start) * x * x * (3 - 2 * x);
  }

  /**
   * Un pas de timp. `world` furnizează doar: ce se vede (sense), contactele fizice
   * (resolveContacts) și limitele arenei. `context.buffered` = prezența îngrijitorului.
   */
  step(dt, time, world, context) {
    if (!this.alive) return;
    const { body, endocrine, brain } = this;

    const mod = brain.neuromodulate(endocrine, this.maturation);

    // percepție
    brain.sense(world.sense(this.x, this.y, mod.range));

    // decizie (frecvența ei e setată de chimie)
    brain.decisionTimer -= dt;
    if (!brain.reflex && (brain.decisionTimer <= 0 || brain.forceDecision)) {
      brain.decide(this, body, endocrine);
    }

    // mișcare
    const motion = brain.motor(dt, this, body, world.bounds);
    this.vx = motion.vx;
    this.vy = motion.vy;
    this.x = clamp(this.x + motion.vx * dt, this.radius, world.bounds.width - this.radius);
    this.y = clamp(this.y + motion.vy * dt, this.radius, world.bounds.height - this.radius);

    // contact fizic: mediul aplică efectele asupra corpului
    const contacts = world.resolveContacts(this, dt);
    const rush = endocrine.receptor * body.signals.surgeRaw;
    brain.registerContacts(contacts, body.signals, rush, time);

    // reflexul de retragere după durere (înnăscut; nu știe ce a provocat durerea)
    if (body.signals.nociception > 0) {
      const src = contacts.find((c) => c.painful) ?? contacts[0];
      if (src) {
        this.lastPainSource = src;
        brain.triggerReflex(this.x - src.x, this.y - src.y);
      }
    }

    // fiziologie
    body.step(dt, {
      speedFraction: motion.speedFraction,
      cortisol: endocrine.cortisol,
      metabolicScale: 1 + this.params.body.infantBurnBonus * (1 - this.maturation),
    });

    // învățare
    brain.settleContacts(body, endocrine, time);
    brain.learnVisceral(body.signals.malaise, time, dt);

    // chimie
    const threat = brain.updateThreat(this);
    endocrine.step(dt, {
      body,
      painRate: body.signals.nociception / dt,
      threat,
      drive: brain.drive(body.energy, body.integrity, mod.energyWeight),
      buffered: context.buffered,
    });

    if (!body.alive) body.deathTime = time;
    body.resetSignals();
  }
}
