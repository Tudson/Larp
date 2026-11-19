import { clamp, TAU } from './math.js';

/**
 * Mediul: fizica și chimia lumii. Aici (și numai aici) obiectele au "tip".
 * Organismul primește doar ce ar primi un animal: nuanța și poziția a ce vede
 * (`sense`) și efectele fizico-chimice ale contactului (`resolveContacts`).
 */
export class World {
  constructor(params, rng) {
    this.params = params;
    this.kinds = params.kinds;
    this.cfg = params.world;
    this.rng = rng;
    this.bounds = { width: this.cfg.width, height: this.cfg.height };
    this.objects = [];
    this.nextId = 1;
    this.respawns = []; // { kind, time }
    this.time = 0;
    this.regime = {
      nutrients: this.cfg.nutrients,
      huskProbability: 0,
      substances: 0,
      thorns: this.cfg.thorns,
      stones: this.cfg.stones,
    };
    this.events = []; // evenimente fizice recente (pentru vizualizare)
  }

  populate(avoid) {
    for (let i = 0; i < this.regime.thorns; i++) this.spawn('thorn', avoid);
    for (let i = 0; i < this.regime.stones; i++) this.spawn('stone', avoid);
    for (let i = 0; i < this.regime.nutrients; i++) this.spawn('nutrient', avoid);
  }

  count(kinds) {
    let n = 0;
    for (const o of this.objects) if (kinds.includes(o.kind)) n++;
    for (const r of this.respawns) if (kinds.includes(r.kind)) n++;
    return n;
  }

  spawn(kind, avoid, at = null) {
    const k = this.kinds[kind];
    let x;
    let y;
    if (at) {
      x = at.x;
      y = at.y;
    } else {
      // Poziție aleatoare, departe de organism și de alte obiecte. Unele resurse cresc
      // printre spini (la fel pentru hrană și substanță): accesul la ele are un risc.
      const thorns = this.objects.filter((o) => o.kind === 'thorn');
      const nearThorn = k.consumable && thorns.length > 0 && this.rng.chance(this.cfg.riskySpawn);
      for (let attempt = 0; attempt < 40; attempt++) {
        if (nearThorn) {
          const t = thorns[Math.floor(this.rng.next() * thorns.length)];
          const a = this.rng.uniform(0, TAU);
          const r = t.radius + k.radius + this.rng.uniform(0.4, 2.2);
          x = clamp(t.x + Math.cos(a) * r, 4, this.bounds.width - 4);
          y = clamp(t.y + Math.sin(a) * r, 4, this.bounds.height - 4);
        } else {
          x = this.rng.uniform(4, this.bounds.width - 4);
          y = this.rng.uniform(4, this.bounds.height - 4);
        }
        const farFromAgent = !avoid || Math.hypot(x - avoid.x, y - avoid.y) > 8;
        const farFromOthers = this.objects.every(
          (o) => (nearThorn && o.kind === 'thorn') || Math.hypot(o.x - x, o.y - y) > o.radius + k.radius + 2.5,
        );
        if (farFromAgent && farFromOthers) break;
      }
    }
    const angle = this.rng.uniform(0, TAU);
    const obj = {
      id: this.nextId++,
      kind,
      hue: (k.hue + this.rng.normal() * k.hueJitter + 360) % 360,
      x,
      y,
      radius: k.radius,
      vx: Math.cos(angle),
      vy: Math.sin(angle),
      born: this.time,
      cooldown: 0,
    };
    this.objects.push(obj);
    return obj;
  }

  remove(obj) {
    const i = this.objects.indexOf(obj);
    if (i >= 0) this.objects.splice(i, 1);
  }

  // Ce vede organismul: nuanță și poziție, fără "tip".
  sense(x, y, range) {
    const out = [];
    for (const o of this.objects) {
      const d = Math.hypot(o.x - x, o.y - y) - o.radius;
      if (d <= range) out.push({ id: o.id, hue: o.hue, x: o.x, y: o.y, r: o.radius });
    }
    return out;
  }

  // Contact fizic: aplică efectele asupra corpului și întoarce ce a fost atins.
  resolveContacts(organism, dt) {
    const contacts = [];
    const body = organism.body;
    for (let i = this.objects.length - 1; i >= 0; i--) {
      const o = this.objects[i];
      if (Math.hypot(o.x - organism.x, o.y - organism.y) > o.radius + organism.radius) {
        o.touching = false;
        continue;
      }
      const k = this.kinds[o.kind];
      const firstTouch = !o.touching;
      o.touching = true;
      const contact = { id: o.id, hue: o.hue, x: o.x, y: o.y, ingested: false, painful: false };
      switch (o.kind) {
        case 'nutrient':
        case 'husk':
          body.absorb(k.energy);
          contact.ingested = true;
          this.consume(o);
          break;
        case 'substance':
          body.infuse(k);
          contact.ingested = true;
          this.consume(o);
          break;
        case 'thorn':
        case 'predator':
          // un impact la primul contact, apoi leziune continuă cât timp contactul durează
          body.wound(k.damagePerSecond * dt + (firstTouch ? k.impact : 0));
          contact.painful = true;
          if (o.kind === 'predator' && firstTouch) {
            o.cooldown = 2.5; // se retrage după atac
            o.hits = (o.hits ?? 0) + 1;
          }
          break;
        default:
          break; // piatra: nu se întâmplă nimic
      }
      contacts.push(contact);
    }
    return contacts;
  }

  consume(o) {
    this.remove(o);
    this.events.push({ type: 'consume', kind: o.kind, x: o.x, y: o.y, time: this.time });
    const range = o.kind === 'substance' ? this.cfg.substanceRespawn : this.cfg.nutrientRespawn;
    const kind = o.kind === 'substance' ? 'substance' : 'nutrient';
    this.respawns.push({ kind, time: this.time + this.rng.uniform(range[0], range[1]) });
  }

  setRegime(changes) {
    Object.assign(this.regime, changes);
  }

  // Foamete: hrana își păstrează aspectul, dar devine goală (și invers la final).
  convertNutrients(fromKind, toKind, probability) {
    for (const o of this.objects) {
      if (o.kind === fromKind && this.rng.chance(probability)) o.kind = toKind;
    }
  }

  spawnPredator(avoid) {
    // Intră de la marginea cea mai îndepărtată de organism.
    const corners = [
      { x: 3, y: 3 },
      { x: this.bounds.width - 3, y: 3 },
      { x: 3, y: this.bounds.height - 3 },
      { x: this.bounds.width - 3, y: this.bounds.height - 3 },
    ];
    corners.sort((a, b) => Math.hypot(b.x - avoid.x, b.y - avoid.y) - Math.hypot(a.x - avoid.x, a.y - avoid.y));
    return this.spawn('predator', null, corners[0]);
  }

  removeKind(kind) {
    this.objects = this.objects.filter((o) => o.kind !== kind);
    this.respawns = this.respawns.filter((r) => r.kind !== kind);
  }

  step(dt, organism) {
    this.time += dt;
    this.events = this.events.filter((e) => this.time - e.time < 1.5);

    // reapariții programate
    for (let i = this.respawns.length - 1; i >= 0; i--) {
      const r = this.respawns[i];
      if (r.time > this.time) continue;
      this.respawns.splice(i, 1);
      const wanted = r.kind === 'substance' ? this.regime.substances : this.regime.nutrients;
      const present = this.objects.filter((o) =>
        r.kind === 'substance' ? o.kind === 'substance' : o.kind === 'nutrient' || o.kind === 'husk',
      ).length;
      if (present >= wanted) continue;
      let kind = r.kind;
      if (kind === 'nutrient' && this.rng.chance(this.regime.huskProbability)) kind = 'husk';
      this.spawn(kind, organism);
    }
    // completează până la numărul cerut de regim (ex.: abundență, apariția substanței)
    const fill = (kinds, wanted, make) => {
      let have = this.count(kinds);
      while (have < wanted) {
        this.spawn(make(), organism);
        have++;
      }
    };
    fill(['nutrient', 'husk'], this.regime.nutrients, () =>
      this.rng.chance(this.regime.huskProbability) ? 'husk' : 'nutrient',
    );
    fill(['substance'], this.regime.substances, () => 'substance');

    // mișcarea obiectelor
    for (const o of this.objects) {
      if (o.kind === 'thorn') {
        const turn = this.rng.normal() * 0.6 * Math.sqrt(dt);
        const a = Math.atan2(o.vy, o.vx) + turn;
        o.vx = Math.cos(a);
        o.vy = Math.sin(a);
        o.x += o.vx * this.cfg.thornDrift * dt;
        o.y += o.vy * this.cfg.thornDrift * dt;
      } else if (o.kind === 'predator') {
        // După numărul maxim de atacuri, prădătorul pleacă (se îndepărtează).
        if ((o.hits ?? 0) >= this.cfg.predatorHits) o.cooldown = Math.max(o.cooldown, 1);
        o.cooldown = Math.max(0, o.cooldown - dt);
        const dx = organism.x - o.x;
        const dy = organism.y - o.y;
        const d = Math.hypot(dx, dy) || 1;
        const dir = o.cooldown > 0 ? -1 : 1;
        const jitter = this.rng.normal() * 0.25;
        const a = Math.atan2(dy, dx) + jitter;
        const speed = this.cfg.predatorSpeed * (o.cooldown > 0 ? 0.7 : 1);
        o.vx = Math.cos(a) * dir;
        o.vy = Math.sin(a) * dir;
        o.x += o.vx * speed * dt;
        o.y += o.vy * speed * dt;
        if (d < 0.1) continue;
      }
      // ricoșeu din pereți
      if (o.x < o.radius + 1 || o.x > this.bounds.width - o.radius - 1) o.vx = -o.vx;
      if (o.y < o.radius + 1 || o.y > this.bounds.height - o.radius - 1) o.vy = -o.vy;
      o.x = clamp(o.x, o.radius + 1, this.bounds.width - o.radius - 1);
      o.y = clamp(o.y, o.radius + 1, this.bounds.height - o.radius - 1);
    }
  }
}
