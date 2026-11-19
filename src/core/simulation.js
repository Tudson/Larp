import { createRng, deriveSeed } from './rng.js';
import { clamp, lerp } from './math.js';
import { World } from './world.js';
import { Organism } from './organism.js';

export const PHASES = [
  { id: 'infancy', index: 0, label: 'Dependență' },
  { id: 'autonomy', index: 1, label: 'Autonomie' },
  { id: 'trials', index: 2, label: 'Încercări' },
  { id: 'substance', index: 3, label: 'Substanța' },
];

/**
 * Îngrijitorul: o parte a MEDIULUI, nu a organismului. Observă corpul puiului și
 * intervine fizic doar în prag critic: pune hrană la gura lui sau îl scoate de lângă
 * ce îl rănește și îl liniștește (tamponare socială a axei de stres).
 * Pragurile scad treptat (înțărcare), apoi îngrijitorul pleacă.
 */
export class Caregiver {
  constructor(params, protocol) {
    this.p = params;
    this.present = protocol.caregiver;
    this.leaveTime = protocol.infancyEnd;
    this.cooldown = 0;
    this.interventions = [];
  }

  thresholds(time) {
    const x = clamp(time / this.leaveTime, 0, 1);
    return {
      energy: lerp(this.p.energyThresholdStart, this.p.energyThresholdEnd, x),
      integrity: lerp(this.p.integrityThresholdStart, this.p.integrityThresholdEnd, x),
    };
  }

  step(dt, sim) {
    if (!this.present) return;
    if (sim.time >= this.leaveTime) {
      this.present = false;
      sim.emit({ type: 'caregiver-leaves' });
      return;
    }
    this.cooldown -= dt;
    if (this.cooldown > 0) return;
    const org = sim.organism;
    const { energy, integrity } = this.thresholds(sim.time);
    if (org.body.energy < energy) {
      const angle = Math.atan2(org.vy, org.vx) || 0;
      sim.world.spawn('nutrient', null, {
        x: org.x + Math.cos(angle) * 0.5,
        y: org.y + Math.sin(angle) * 0.5,
      });
      this.soothe(org);
      this.record(sim, 'feed');
    } else if (org.body.integrity < integrity) {
      const spot = this.safeSpot(sim);
      org.x = spot.x;
      org.y = spot.y;
      org.body.tend(this.p.tend);
      this.soothe(org);
      this.record(sim, 'rescue');
    }
  }

  soothe(org) {
    org.endocrine.cortisol *= 1 - this.p.soothe;
    org.endocrine.noradrenaline *= 1 - this.p.soothe;
  }

  safeSpot(sim) {
    const { world, organism } = sim;
    const rng = world.rng;
    let best = { x: organism.x, y: organism.y };
    let bestScore = -Infinity;
    for (let i = 0; i < 30; i++) {
      const x = rng.uniform(6, world.bounds.width - 6);
      const y = rng.uniform(6, world.bounds.height - 6);
      let nearest = Infinity;
      for (const o of world.objects) {
        if (o.kind === 'thorn' || o.kind === 'predator') nearest = Math.min(nearest, Math.hypot(o.x - x, o.y - y));
      }
      const score = Math.min(nearest, 25) - 0.05 * Math.hypot(x - organism.x, y - organism.y);
      if (score > bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
    return best;
  }

  record(sim, type) {
    this.cooldown = this.p.cooldown;
    const entry = { time: sim.time, type, x: sim.organism.x, y: sim.organism.y };
    this.interventions.push(entry);
    sim.emit({ type: `caregiver-${type}` });
  }
}

/**
 * Simularea: mediu + organism + îngrijitor + protocolul experimental (fazele).
 * Nu conține observatorul; acesta se atașează din exterior și doar citește.
 */
export class Simulation {
  constructor({ seed = 1, params }) {
    this.seed = seed;
    this.params = params;
    this.protocol = params.protocol;
    this.dt = params.dt;
    this.time = 0;
    this.steps = 0;
    this.world = new World(params, createRng(deriveSeed(seed, 1)));
    this.organism = new Organism(
      params,
      createRng(deriveSeed(seed, 2)),
      params.world.width / 2,
      params.world.height / 2,
    );
    this.world.populate(this.organism);
    this.caregiver = new Caregiver(params.caregiver, this.protocol);
    this.phase = PHASES[0];
    this.episode = null;
    this.flags = {};
    this.listeners = [];
    this.events = [];
    this.death = null;
  }

  on(listener) {
    this.listeners.push(listener);
  }

  emit(event) {
    const e = { time: this.time, ...event };
    this.events.push(e);
    for (const l of this.listeners) l(e, this);
  }

  get alive() {
    return this.organism.alive;
  }

  get finished() {
    return !this.alive || this.time >= this.protocol.maxTime;
  }

  // Programul experimentului: schimbă mediul, nu organismul.
  runProtocol() {
    const pr = this.protocol;
    const t = this.time;
    const once = (key, fn) => {
      if (!this.flags[key]) {
        this.flags[key] = true;
        fn();
      }
    };
    const setPhase = (id) => {
      const phase = PHASES.find((p) => p.id === id);
      if (this.phase.id !== id) {
        this.phase = phase;
        this.emit({ type: 'phase', phase: id });
      }
    };

    if (t >= pr.autonomyEnd) setPhase(t >= pr.substanceStart ? 'substance' : 'trials');
    else if (t >= pr.infancyEnd) setPhase('autonomy');

    if (pr.shock && t >= pr.shockStart && t < pr.shockEnd) {
      once('shock-start', () => {
        this.world.spawnPredator(this.organism);
        this.episode = 'shock';
        this.emit({ type: 'shock-start' });
      });
    }
    if (pr.shock && t >= pr.shockEnd) {
      once('shock-end', () => {
        this.world.removeKind('predator');
        this.episode = 'aftermath';
        this.emit({ type: 'shock-end' });
      });
    }
    if (pr.famine && t >= pr.famineStart && t < pr.famineEnd) {
      // Lipsă: hrana dispare și organismul flămânzește.
      once('famine-start', () => {
        this.world.setRegime({ nutrients: 0 });
        this.world.removeKind('nutrient');
        this.episode = 'famine';
        this.emit({ type: 'famine-start' });
      });
    }
    if (pr.famine && t >= pr.famineDecoys && t < pr.famineEnd) {
      // Apoi reapar obiecte care arată exact ca hrana, dar sunt goale (eșec repetat).
      once('famine-decoys', () => {
        const q = this.params.world.famineHuskProbability;
        this.world.setRegime({ nutrients: this.params.world.nutrients, huskProbability: q });
        this.emit({ type: 'famine-decoys' });
      });
    }
    if (pr.famine && t >= pr.famineEnd) {
      once('famine-end', () => {
        this.world.setRegime({ huskProbability: 0, nutrients: this.params.world.nutrientsRecovery });
        this.world.convertNutrients('husk', 'nutrient', 1);
        this.episode = 'recovery';
        this.emit({ type: 'famine-end' });
      });
    }
    if (t >= pr.substanceStart) {
      once('substance-start', () => {
        setPhase('substance');
        this.episode = null;
        this.world.setRegime({ nutrients: this.params.world.nutrients });
        if (pr.substance) {
          this.world.setRegime({ substances: this.params.world.substances });
          this.emit({ type: 'substance-start' });
        }
      });
    }
  }

  step() {
    if (this.finished) return false;
    this.runProtocol();
    const org = this.organism;
    org.updateMaturation(this.time, this.protocol.infancyEnd);
    this.world.step(this.dt, org);
    this.caregiver.step(this.dt, this);
    org.step(this.dt, this.time, this.world, { buffered: this.caregiver.present });
    this.time += this.dt;
    this.steps++;
    if (!org.alive && !this.death) {
      this.death = this.autopsy();
      this.emit({ type: 'death', cause: this.death.cause });
    }
    return true;
  }

  runUntil(time, onStep) {
    while (!this.finished && this.time < time) {
      this.step();
      if (onStep) onStep(this);
    }
  }

  // Cauza morții, stabilită din fiziologie (de "medicul legist", nu de organism).
  autopsy() {
    const b = this.organism.body;
    let cause;
    if (b.energy <= 0) cause = 'starvation';
    else if (b.recentToxic > b.recentTrauma) cause = 'toxicity';
    else cause = 'trauma';
    return { time: this.time, cause, organLoad: b.organLoad, phase: this.phase.id };
  }
}
