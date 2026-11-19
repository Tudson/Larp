import { ExtinguishableMap, HueCode, HueMap, TAU, clamp, lerp } from './math.js';

/**
 * Creierul: percepție, atenție, învățare și alegerea acțiunii.
 *
 * Ce NU există aici: nicio listă de obiecte, nicio regulă "dacă vezi X fă Y",
 * nicio etichetă emoțională. La naștere toate asocierile sunt zero.
 *
 * Ce există:
 *  - un cod populațional pentru nuanța stimulilor (singura informație senzorială);
 *  - două sisteme de evaluare care învață din experiență:
 *      a) orientat spre scop (model-based): învață CE SE ÎNTÂMPLĂ cu corpul după
 *         contactul cu un stimul și evaluează asta față de starea internă curentă
 *         (învățare prin întărire homeostatică, Keramati & Gutkin, 2014);
 *      b) de obișnuință (model-free): păstrează o valoare în cache, actualizată de
 *         eroarea de predicție dopaminergică (Schultz et al., 1997);
 *  - receptori pentru hormoni, care schimbă parametrii de funcționare
 *    (Doya, 2002: neuromodulatorii ca meta-parametri ai învățării);
 *  - două reflexe înnăscute care nu conțin cunoaștere despre lume:
 *    ingestia a ce ajunge la gură și retragerea după durere.
 */
export class Brain {
  constructor(params, rng) {
    this.p = params;
    this.rng = rng;
    this.code = new HueCode(params.basisCount, params.basisKappa);

    // (a) model intern al consecințelor
    this.expectEnergy = new ExtinguishableMap(this.code, params.extinctionRecovery);
    this.expectPain = new HueMap(this.code);
    this.expectMalaise = new HueMap(this.code);
    this.expectHedonic = new HueMap(this.code);
    // (b) valori de obișnuință
    this.habit = new ExtinguishableMap(this.code, params.extinctionRecovery);
    // familiaritate (pentru noutate)
    this.familiarity = new HueMap(this.code);

    this.percepts = new Map(); // id -> percept (tot ce e în raza percepției)
    this.attended = []; // percepte aflate în atenție
    this.action = { type: 'rest', targetId: null };
    this.heading = rng.uniform(0, TAU);
    this.decisionTimer = 0;
    this.forceDecision = true;
    this.reflex = null;
    this.touches = new Map(); // id -> episod de atingere deschis
    this.traces = []; // urme lungi după ingestie (atribuirea efectelor viscerale)
    this.mod = null;
    this.threat = 0;
    this.lastBestWant = 0;
    this.lastOptions = [];
    this.sought = { value: 0, hue: null };
    this.lastOutcome = null;
    this.decisions = 0;
  }

  // ------------------------------------------------------------------------
  // Neuromodulare: concentrațiile hormonale -> parametrii de funcționare.
  // ------------------------------------------------------------------------
  neuromodulate(endo, maturation) {
    const p = this.p;
    const ne = Math.min(endo.noradrenaline, 1.2);
    const cort = Math.min(endo.cortisol, 1);
    const da = endo.daNorm;

    const omega = p.stressHabitShift ? p.omegaMax * (1 - p.omegaCort * cort) : p.omegaMax;
    const slots =
      p.attentionSlots * (0.6 + 0.4 * maturation) * (1 - (p.slotsNE * ne) / 1.2 - p.slotsCort * cort);

    this.mod = {
      maturation,
      // câștigul selecției: NA și cortizolul fac alegerile mai rigide (mai puțină explorare)
      beta: p.beta0 * (0.45 + 0.55 * maturation) * (1 + p.betaNE * ne) * (1 + p.betaCort * cort),
      // îngustarea atenției sub activare (Easterbrook, 1959)
      attentionSlots: Math.max(1, Math.round(slots)),
      range: lerp(p.rangeInfant, p.rangeAdult, maturation) * (1 - p.rangeCort * cort),
      // timpul de reacție: NA îl scurtează, dopamina tonică scăzută îl lungește
      decisionInterval:
        p.decision0 *
        (1.6 - 0.6 * maturation) *
        (1 - p.decisionNE * Math.min(ne, 1)) *
        (1 + p.decisionDA * Math.max(0, 1 - da)),
      // ponderea sistemului orientat spre scop; stresul o mută spre obișnuință
      // (Schwabe & Wolf, 2009)
      omega,
      curiosity: clamp(da, 0, 1.3) * (1 - p.curiosityCort * cort),
      // vigoarea răspunsului depinde de dopamina tonică (Niv et al., 2007)
      vigor: clamp(p.vigor0 + p.vigorDA * Math.min(da, 1.6) + p.vigorNE * ne, 0.15, 1.2),
      flightVigor: clamp(0.6 + 0.7 * ne, 0.6, 1.4),
      // grelina amplifică importanța deficitului energetic
      energyWeight: p.energyWeightBase + p.energyWeightGhrelin * endo.ghrelin,
      ghrelin: endo.ghrelin,
      negativityBias: 1 + p.negBiasCort * cort,
      aversiveLearning: 1 + p.aversiveCort * cort,
      // receptorii dopaminergici scad => recompensele naturale cântăresc mai puțin
      hedonicGain: 0.5 + 0.5 * Math.min(endo.receptor, 1),
      incentive: endo.incentiveGain,
      dopamineDeficit: Math.max(0, 1 - da),
      daNorm: da,
    };
    return this.mod;
  }

  // Pulsiunea homeostatică: distanța stării interne față de punctele de echilibru.
  drive(energy, integrity, energyWeight) {
    const de = Math.max(0, 1 - energy);
    const di = Math.max(0, 1 - integrity);
    return energyWeight * de * de + this.p.integrityWeight * di * di;
  }

  // ------------------------------------------------------------------------
  // Percepție
  // ------------------------------------------------------------------------
  sense(visible) {
    const seen = new Set();
    for (const v of visible) {
      seen.add(v.id);
      let pc = this.percepts.get(v.id);
      if (!pc) {
        // Nuanța e percepută cu zgomot senzorial la prima fixare.
        const hue = v.hue + this.rng.normal() * this.p.sensoryNoise;
        pc = { id: v.id, hue, phi: this.code.encode(hue), x: v.x, y: v.y, r: v.r, eval: null };
        this.percepts.set(v.id, pc);
      }
      pc.x = v.x;
      pc.y = v.y;
      pc.r = v.r;
    }
    for (const id of this.percepts.keys()) {
      if (!seen.has(id)) this.percepts.delete(id);
    }
    // Ținta curentă a dispărut: e nevoie de o nouă decizie.
    if (this.action.targetId !== null && !this.percepts.has(this.action.targetId)) {
      this.forceDecision = true;
    }
  }

  evaluate(pc, body) {
    pc.eval = this.appraise(pc.phi, body);
    return pc.eval;
  }

  // Evaluarea unui model senzorial (phi): ce prezice fiecare sistem pentru starea internă curentă.
  appraise(phi, body) {
    const p = this.p;
    const m = this.mod;
    const kE = this.expectEnergy.predict(phi);
    const kP = Math.max(0, this.expectPain.predict(phi));
    const kM = Math.max(0, this.expectMalaise.predict(phi));
    const kH = this.expectHedonic.predict(phi);
    const habit = this.habit.predict(phi);
    const novelty = Math.exp(-Math.max(0, this.familiarity.predict(phi)) / p.familiarityScale);

    // (a) simularea consecinței asupra mediului intern
    const d0 = this.drive(body.energy, body.integrity, m.energyWeight);
    const d1 = this.drive(
      clamp(body.energy + kE, 0, 1),
      clamp(body.integrity - kP - kM, 0, 1),
      m.energyWeight,
    );
    const goal =
      m.hedonicGain * p.homeostaticGain * (d0 - d1) -
      m.negativityBias * (p.painAversion * kP + p.malaiseAversion * kM) +
      p.hedonicWeight * kH;
    // (b) valoarea de obișnuință ca "dorință" (incentive salience): amplificată de
    // sensibilizare și, pentru stimulii care prezic energie, de starea de foame
    // (Robinson & Berridge, 1993; Zhang et al., 2009).
    const nourishing = clamp(kE / 0.1, 0, 1);
    const appetite = 1 - nourishing + nourishing * clamp(0.25 + 1.2 * m.ghrelin, 0.25, 1.4);
    const want = habit > 0 ? habit * m.incentive * appetite : habit;
    const value = m.omega * goal + (1 - m.omega) * want;
    return { kE, kP, kM, kH, habit, want, goal, value, novelty };
  }

  // Cel mai bun lucru pe care organismul știe că l-ar putea găsi (dacă l-ar căuta),
  // evaluat pentru starea internă de acum. Valoarea căutării pornește de aici.
  bestKnown(body) {
    if (!this.centerCodes) this.centerCodes = this.code.centers.map((c) => this.code.encode((c * 180) / Math.PI));
    let best = { value: 0, hue: null };
    for (let j = 0; j < this.centerCodes.length; j++) {
      const e = this.appraise(this.centerCodes[j], body);
      if (e.value > best.value) best = { value: e.value, hue: (this.code.centers[j] * 180) / Math.PI };
    }
    return best;
  }

  // ------------------------------------------------------------------------
  // Atenție și decizie
  // ------------------------------------------------------------------------
  decide(self, body, endo) {
    const p = this.p;
    const m = this.mod;
    this.decisions++;
    const speed = Math.max(0.5, p.maxSpeed * m.maturation * m.vigor);

    const scored = [];
    for (const pc of this.percepts.values()) {
      const e = this.evaluate(pc, body);
      const d = Math.max(0, Math.hypot(pc.x - self.x, pc.y - self.y) - pc.r - self.radius);
      const proximity = clamp(1 - d / p.threatRange, 0, 1) ** 2;
      // Curiozitatea pentru un stimul e inhibată de răul pe care îl prezice (conflict apropiere-evitare).
      const harmInhibition = Math.exp(-Math.max(0, -e.value) / 0.05);
      const curiosityBonus = p.noveltyBonus * e.novelty * m.curiosity * harmInhibition;
      const pull = p.attentionCapture ? Math.abs(e.value) : Math.abs(m.omega * e.goal + (1 - m.omega) * e.habit);
      const salience = pull + curiosityBonus + 0.15 * proximity;
      scored.push({ pc, e, d, proximity, curiosityBonus, salience });
    }
    // Capacitate limitată: doar cei mai salienți stimuli intră în atenție.
    scored.sort((a, b) => b.salience - a.salience);
    const focus = scored.slice(0, m.attentionSlots);
    this.attended = focus.map((s) => s.pc);

    const options = [];
    let bestWant = 0;
    for (const s of focus) {
      const travel = s.d / speed;
      const discount = Math.exp(-travel / p.distanceTau);
      const commit = this.action.type === 'approach' && this.action.targetId === s.pc.id ? p.commitBonus : 0;
      const approach = discount * (s.e.value + s.curiosityBonus);
      // Doar ce promite ceva (valoare sau noutate) devine o opțiune de apropiere.
      if (approach > 0.005) {
        options.push({ type: 'approach', targetId: s.pc.id, value: approach + commit });
      }
      const threat = Math.max(0, -s.e.value) * s.proximity;
      if (threat > 0.01) options.push({ type: 'avoid', targetId: s.pc.id, value: p.avoidGain * threat });
      bestWant = Math.max(bestWant, s.e.want * discount);
    }
    const keep = (type) => (this.action.type === type ? p.commitBonus : 0);
    // Valoarea căutării: curiozitate + valoarea (redusă de timpul de căutare) a celui mai bun
    // lucru cunoscut, pentru starea de acum. Foamea o crește prin evaluarea homeostatică,
    // "dorința" o crește prin sistemul de obișnuință; dopamina tonică scăzută o diminuează.
    this.sought = this.bestKnown(body);
    options.push({
      type: 'explore',
      targetId: null,
      value:
        p.exploreBase * m.curiosity +
        p.searchDiscount * this.sought.value * clamp(0.35 + 0.65 * m.daNorm, 0.2, 1) +
        keep('explore'),
    });
    options.push({
      type: 'rest',
      targetId: null,
      // sațietatea invită la repaus; foamea îl suprimă, dar dopamina tonică scăzută îl favorizează
      value:
        p.restBase * (1 - m.ghrelin) ** 2 + p.restLowDopamine * m.dopamineDeficit * (1 - 0.8 * m.ghrelin) + keep('rest'),
    });

    // Selecție softmax: beta (setat de hormoni) controlează explorarea.
    let maxV = -Infinity;
    for (const o of options) maxV = Math.max(maxV, o.value);
    let z = 0;
    for (const o of options) {
      o.weight = Math.exp(m.beta * (o.value - maxV));
      z += o.weight;
    }
    let u = this.rng.next() * z;
    let chosen = options[options.length - 1];
    for (const o of options) {
      u -= o.weight;
      if (u <= 0) {
        chosen = o;
        break;
      }
    }
    for (const o of options) o.probability = o.weight / z;

    // Explorare "alergare și rostogolire" (ca la bacterii): drum drept, apoi uneori o direcție nouă.
    if (chosen.type === 'explore' && this.rng.chance(this.action.type === 'explore' ? 0.05 : 0.25)) {
      this.heading = this.rng.uniform(0, TAU);
    }
    this.action = { type: chosen.type, targetId: chosen.targetId, value: chosen.value };
    this.lastOptions = options;

    // Apariția bruscă a unui stimul valoros => descărcare dopaminergică anticipatorie.
    const burst = Math.max(0, bestWant - this.lastBestWant);
    if (burst > 0.05) endo.cue(burst);
    this.lastBestWant = bestWant;

    this.decisionTimer = m.decisionInterval * (0.75 + 0.5 * this.rng.next());
    this.forceDecision = false;
    return chosen;
  }

  // Amenințarea prezisă de stimulii din atenție (alimentează noradrenalina).
  updateThreat(self) {
    let threat = 0;
    for (const pc of this.attended) {
      if (!pc.eval || pc.eval.value >= 0 || !this.percepts.has(pc.id)) continue;
      const d = Math.max(0, Math.hypot(pc.x - self.x, pc.y - self.y) - pc.r - self.radius);
      const proximity = clamp(1 - d / this.p.threatRange, 0, 1) ** 2;
      threat = Math.max(threat, -pc.eval.value * proximity);
    }
    this.threat = threat;
    return threat;
  }

  // ------------------------------------------------------------------------
  // Mișcare
  // ------------------------------------------------------------------------
  triggerReflex(dx, dy) {
    const n = Math.hypot(dx, dy) || 1;
    this.reflex = { x: dx / n, y: dy / n, time: this.p.reflexDuration };
    this.forceDecision = true;
  }

  motor(dt, self, body, bounds) {
    const p = this.p;
    const m = this.mod;
    const weakness = clamp(Math.sqrt(body.energy / 0.15), 0.25, 1);
    const vmax = p.maxSpeed * m.maturation * weakness;
    let dx = 0;
    let dy = 0;
    let speed = 0;

    if (this.reflex) {
      dx = this.reflex.x;
      dy = this.reflex.y;
      speed = p.reflexSpeed * weakness;
      this.reflex.time -= dt;
      if (this.reflex.time <= 0) this.reflex = null;
    } else {
      const target = this.action.targetId !== null ? this.percepts.get(this.action.targetId) : null;
      switch (this.action.type) {
        case 'approach':
          if (target) {
            dx = target.x - self.x;
            dy = target.y - self.y;
            speed = vmax * m.vigor;
          }
          break;
        case 'avoid':
          if (target) {
            dx = self.x - target.x;
            dy = self.y - target.y;
            speed = vmax * m.flightVigor;
          }
          break;
        case 'explore': {
          const clumsiness = 1.6 - 0.6 * m.maturation;
          this.heading += this.rng.normal() * p.wanderTurn * clumsiness * Math.sqrt(dt);
          dx = Math.cos(this.heading);
          dy = Math.sin(this.heading);
          speed = vmax * m.vigor * 0.75;
          break;
        }
        default:
          break;
      }
      const n = Math.hypot(dx, dy);
      if (n > 0) {
        dx /= n;
        dy /= n;
      }

      // Retragere pavloviană automată de lângă stimulii prezişi ca nocivi (doar cei din atenție).
      let rx = 0;
      let ry = 0;
      for (const pc of this.attended) {
        if (!pc.eval || pc.eval.value >= 0 || pc.id === this.action.targetId && this.action.type === 'approach' && pc.eval.value > -0.02) continue;
        if (!this.percepts.has(pc.id)) continue;
        const ox = self.x - pc.x;
        const oy = self.y - pc.y;
        const dist = Math.hypot(ox, oy);
        const gap = Math.max(0.4, dist - pc.r - self.radius);
        if (gap > 5) continue;
        const k = (p.pavlovianRepulsion * -pc.eval.value * m.negativityBias) / (gap * gap + 1);
        rx += (ox / (dist || 1)) * k;
        ry += (oy / (dist || 1)) * k;
      }
      const rmag = Math.hypot(rx, ry);
      if (rmag > 0) {
        dx += rx;
        dy += ry;
        const n2 = Math.hypot(dx, dy) || 1;
        dx /= n2;
        dy /= n2;
        // Retragerea poate pune în mișcare chiar și un organism care stătea.
        speed = Math.max(speed, Math.min(vmax * m.flightVigor, rmag * vmax * 0.5));
      }
    }

    // Pereții arenei: explorarea ricoșează, orice mișcare e împinsă înapoi spre interior.
    const margin = 4;
    if (this.action.type === 'explore' && !this.reflex) {
      const cx = Math.cos(this.heading);
      const cy = Math.sin(this.heading);
      if ((self.x < margin && cx < 0) || (self.x > bounds.width - margin && cx > 0)) {
        this.heading = Math.PI - this.heading + this.rng.normal() * 0.6;
        dx = -dx;
      }
      if ((self.y < margin && cy < 0) || (self.y > bounds.height - margin && cy > 0)) {
        this.heading = -this.heading + this.rng.normal() * 0.6;
        dy = -dy;
      }
    }
    const push = 2.5 / margin;
    if (self.x < margin) dx += (margin - self.x) * push;
    if (self.x > bounds.width - margin) dx -= (self.x - (bounds.width - margin)) * push;
    if (self.y < margin) dy += (margin - self.y) * push;
    if (self.y > bounds.height - margin) dy -= (self.y - (bounds.height - margin)) * push;
    const n3 = Math.hypot(dx, dy);
    if (n3 > 0) {
      dx /= n3;
      dy /= n3;
    }
    return { vx: dx * speed, vy: dy * speed, speedFraction: clamp(speed / p.maxSpeed, 0, 1.4) };
  }

  // ------------------------------------------------------------------------
  // Învățare
  // ------------------------------------------------------------------------

  // Contact cu obiecte în acest pas. `signals` = semnalele interoceptive ale pasului.
  // `rush` = vârful dopaminergic exogen efectiv (după receptori).
  registerContacts(contacts, signals, rush, time) {
    if (contacts.length === 0) return;
    const share = 1 / contacts.length;
    for (const c of contacts) {
      let ep = this.touches.get(c.id);
      if (!ep) {
        const pc = this.percepts.get(c.id);
        const hue = pc ? pc.hue : c.hue + this.rng.normal() * this.p.sensoryNoise;
        ep = {
          id: c.id,
          phi: pc ? pc.phi : this.code.encode(hue),
          start: time,
          last: time,
          energy: 0,
          pain: 0,
          rush: 0,
          ingested: false,
        };
        this.touches.set(c.id, ep);
      }
      ep.last = time;
      ep.energy += signals.energyIn * share;
      ep.pain += signals.nociception * share;
      ep.rush += rush * share;
      if (c.ingested) ep.ingested = true;
    }
  }

  // Închide episoadele de contact terminate și învață din ele.
  settleContacts(body, endo, time) {
    for (const [id, ep] of this.touches) {
      const ended = ep.ingested || time - ep.last > 0.25 || time - ep.start > 2.5;
      if (!ended) continue;
      this.touches.delete(id);
      this.learnOutcome(ep, body, endo, time);
    }
  }

  learnOutcome(ep, body, endo, time) {
    const p = this.p;
    const m = this.mod;
    const phi = ep.phi;

    // Ce aștepta organismul de la acest stimul, în starea de dinainte de contact.
    // Semnalul dopaminergic "trăit" compară rezultatul cu această așteptare, la care
    // contribuie ambele sisteme (Daw et al., 2011).
    const prior = { energy: body.energy - ep.energy, integrity: body.integrity + ep.pain };
    const expected = this.appraise(phi, prior).value;

    // (a) modelul intern al consecințelor (regula delta)
    const kE = this.expectEnergy.predict(phi);
    const kP = this.expectPain.predict(phi);
    const kH = this.expectHedonic.predict(phi);
    // Stingerea unei așteptări pozitive e mai lentă decât achiziția ei (Bouton, 2004).
    const energyRate = ep.energy < kE ? p.rateOutcome * p.extinction : p.rateOutcome;
    this.expectEnergy.update(phi, ep.energy - kE, energyRate);
    const painRate = ep.pain > kP ? p.rateOutcome * m.aversiveLearning : p.rateOutcome;
    this.expectPain.update(phi, ep.pain - kP, painRate);
    this.expectHedonic.update(phi, ep.rush - kH, p.rateOutcome);
    // Experiențele intense se întipăresc mai repede (noutatea dispare mai repede).
    const intensity = ep.energy + ep.pain + ep.rush;
    this.familiarity.update(phi, 1 + 15 * intensity, 1);

    // (b) recompensa homeostatică trăită și erorile de predicție
    const before = this.drive(prior.energy, prior.integrity, m.energyWeight);
    const after = this.drive(body.energy, body.integrity, m.energyWeight);
    const reward = m.hedonicGain * p.homeostaticGain * (before - after) - p.painAversion * ep.pain;
    // Redish (2004): componenta farmacologică a vârfului dopaminergic nu poate fi
    // "anulată" de predicție, deci eroarea nu coboară niciodată sub ea.
    const errorAgainst = (prediction) =>
      ep.rush > 0 && p.noncompensable
        ? Math.max(reward - prediction + ep.rush, ep.rush)
        : reward + ep.rush - prediction;
    const delta = errorAgainst(this.habit.predict(phi)); // învață valoarea de obișnuință
    const felt = errorAgainst(expected); // semnalul fazic resimțit de organism
    let rate = p.rateHabit;
    if (delta < 0) rate *= ep.pain > 0 ? m.aversiveLearning : p.extinction;
    this.habit.update(phi, delta, rate);
    this.habit.clampWeights(-p.habitCap, p.habitCap);

    endo.phasic(felt, ep.pain > 0);

    if (ep.ingested) {
      this.traces.push({ phi, start: time, malaise: 0, expected: Math.max(0, this.expectMalaise.predict(phi)) });
    }
    this.lastOutcome = { time, energy: ep.energy, pain: ep.pain, rush: ep.rush, reward, delta, felt, expected };
  }

  // Leziunea internă tăcută este atribuită ingestiilor recente (ca aversiunea gustativă
  // condiționată, Garcia & Koelling, 1966), cu competiție între cauze posibile.
  learnVisceral(malaise, time, dt) {
    const p = this.p;
    this.expectEnergy.relax(dt);
    this.habit.relax(dt);
    if (this.traces.length === 0) return;
    if (malaise > 0) {
      let z = 0;
      for (const tr of this.traces) {
        tr.weight = Math.exp(-(time - tr.start) / p.malaiseTraceTau) * (tr.expected + 0.01);
        z += tr.weight;
      }
      for (const tr of this.traces) tr.malaise += (malaise * tr.weight) / z;
    }
    const horizon = 3.5 * p.malaiseTraceTau;
    while (this.traces.length > 0 && time - this.traces[0].start > horizon) {
      const tr = this.traces.shift();
      const k = this.expectMalaise.predict(tr.phi);
      this.expectMalaise.update(tr.phi, tr.malaise - k, p.rateMalaise);
    }
  }

  // Instantaneu al cunoașterii învățate, pe tot cercul nuanțelor (pentru vizualizare).
  knowledgeProfile(points = 72) {
    return {
      energy: this.expectEnergy.profile(points),
      pain: this.expectPain.profile(points),
      malaise: this.expectMalaise.profile(points),
      hedonic: this.expectHedonic.profile(points),
      habit: this.habit.profile(points),
      familiarity: this.familiarity.profile(points),
    };
  }
}
