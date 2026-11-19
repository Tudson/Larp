import { clamp } from '../core/math.js';

/**
 * Observatorul: "psihologul" care privește organismul din exterior.
 *
 * Organismul nu are nicio variabilă numită frică, frustrare, calm sau apatie.
 * Observatorul citește doar fiziologia și comportamentul (fără să le modifice)
 * și le proiectează într-un spațiu afectiv clasic:
 *   - valență (plăcut / neplăcut) și activare (calm / agitat): modelul circumplex
 *     al afectului (Russell, 1980), "core affect" (Barrett, 2006);
 *   - direcția motivațională (apropiere / evitare), care separă frica de frustrare
 *     (Harmon-Jones, 2003).
 * Etichetele sunt interpretarea observatorului despre regiunea în care se află
 * organismul, nu cauze ale comportamentului. Un test verifică că rularea cu și fără
 * observator produce exact aceeași viață.
 */

export const STATES = [
  { id: 'calm', label: 'Calm' },
  { id: 'alert', label: 'Alertă' },
  { id: 'euphoria', label: 'Euforie' },
  { id: 'fear', label: 'Frică' },
  { id: 'discomfort', label: 'Disconfort' },
  { id: 'apathy', label: 'Apatie' },
  { id: 'frustration', label: 'Frustrare' },
];
const STATE_INDEX = Object.fromEntries(STATES.map((s, i) => [s.id, i]));

// Ordinea contează doar pentru grafice (culorile vecine rămân distinguibile).
export const ACTIVITIES = [
  { id: 'food', label: 'Spre hrană' },
  { id: 'search', label: 'Caută' },
  { id: 'avoid', label: 'Evită' },
  { id: 'substance', label: 'Spre substanță' },
  { id: 'rest', label: 'Repaus' },
  { id: 'other', label: 'Altceva' },
];
const ACTIVITY_INDEX = Object.fromEntries(ACTIVITIES.map((a, i) => [a.id, i]));

// Câmpurile înregistrate la fiecare eșantion (serii de timp pentru grafice).
const FIELDS = [
  't', 'energy', 'integrity', 'ghrelin', 'noradrenaline', 'cortisol', 'dopamine', 'receptor',
  'blood', 'organLoad', 'incentive', 'omega', 'attention', 'reaction', 'beta', 'valence',
  'arousal', 'approach', 'state', 'activity', 'wantSubstance', 'goalSubstance', 'likeSubstance',
  'wantFood', 'goalFood', 'threat', 'phase', 'hungry', 'foodInView', 'chasing',
];

// Ce urmărește organismul (ținta apropierii sau, la căutare, lucrul căutat).
export const CHASE = ['none', 'food', 'substance', 'other'];

const SAMPLE_EVERY = 0.5; // secunde simulate

export class Observer {
  constructor(sim) {
    this.sim = sim;
    this.kinds = sim.params.kinds;
    this.history = Object.fromEntries(FIELDS.map((f) => [f, []]));
    this.narrative = [];
    this.nextSample = 0;
    this.painEMA = 0;
    this.motive = 0;
    this.activityLevel = 0;
    this.stateId = 'calm';
    this.candidate = 'calm';
    this.candidateSince = 0;
    this.valence = 0;
    this.arousal = 0;
    this.lastFeed = -Infinity;
    this.flags = {};
    this.counts = { selfMeals: 0, fedMeals: 0, doses: 0, thornContacts: 0 };
    this.mealLog = []; // { time, fed }
    this.doseLog = [];
    this.painLog = [];
    this.shockRecovery = null;
    this.substanceSeen = null;
    this.stats = this.blankStats();
    this.consumedSeen = new Set();
    sim.on((event) => this.onEvent(event));
  }

  blankStats() {
    return {
      stateTime: Object.fromEntries(STATES.map((s) => [s.id, 0])),
      byState: Object.fromEntries(STATES.map((s) => [s.id, { n: 0, explore: 0, rest: 0, reaction: 0, attention: 0 }])),
    };
  }

  // ---------------------------------------------------------------------------
  // Evenimentele protocolului (mediu) -> jurnal
  // ---------------------------------------------------------------------------
  onEvent(e) {
    const say = (text, tone = 'neutral') => this.log(e.time, text, tone);
    switch (e.type) {
      case 'caregiver-feed':
        this.lastFeed = e.time;
        if (!this.flags.firstFeed) {
          this.flags.firstFeed = true;
          say('Îngrijitorul îl hrănește pentru prima dată: obiectul verde ajunge direct la gură.', 'care');
        }
        break;
      case 'caregiver-rescue':
        if (!this.flags.firstRescue) {
          this.flags.firstRescue = true;
          say('Îngrijitorul îl scoate de lângă ce îl rănea și îl liniștește.', 'care');
        }
        break;
      case 'caregiver-leaves': {
        const n = this.sim.caregiver.interventions.length;
        say(`Îngrijitorul pleacă definitiv, după ${n} intervenții. De acum își reglează singur echilibrul.`, 'phase');
        break;
      }
      case 'phase':
        if (e.phase === 'trials') say('Încep încercările: mediul devine ostil pentru o vreme.', 'phase');
        break;
      case 'shock-start':
        say('Un prădător intră în arenă și atacă.', 'danger');
        break;
      case 'shock-end':
        say('Prădătorul a plecat. Amenințarea a dispărut din mediu.', 'neutral');
        this.shockRecovery = { start: e.time, cortisolPeak: this.sim.organism.endocrine.cortisol, reported: false };
        break;
      case 'famine-start':
        say('Foamete: toată hrana dispare din mediu.', 'danger');
        break;
      case 'famine-decoys':
        say('Reapar obiecte identice cu hrana, dar aproape toate sunt goale.', 'danger');
        break;
      case 'famine-end':
        say('Hrana adevărată revine din abundență.', 'neutral');
        break;
      case 'substance-start':
        say('Apare o substanță nouă în mediu (violet). Organismul nu știe nimic despre ea.', 'phase');
        break;
      case 'death': {
        const causes = { starvation: 'inaniție', toxicity: 'intoxicație (leziuni interne)', trauma: 'leziuni' };
        say(`Colaps: organismul moare prin ${causes[e.cause] ?? e.cause}.`, 'death');
        break;
      }
      default:
        break;
    }
  }

  log(time, text, tone = 'neutral') {
    this.narrative.push({ time, text, tone });
  }

  // ---------------------------------------------------------------------------
  // Citirea organismului (apelată după fiecare pas al simulării)
  // ---------------------------------------------------------------------------
  observe() {
    const sim = this.sim;
    const org = sim.organism;
    const dt = sim.dt;
    const body = org.body;
    const endo = org.endocrine;
    const brain = org.brain;

    this.trackConsumption();

    // Semnale lente pentru afect (urme exponențiale).
    const fade = (x, target, tau) => target + (x - target) * Math.exp(-dt / tau);
    const painNow = this.painThisStep();
    this.painEMA = fade(this.painEMA, painNow, 4);
    const a = brain.action.type;
    const motiveNow = a === 'approach' ? 1 : a === 'avoid' ? -1 : a === 'explore' ? 0.5 : 0;
    this.motive = fade(this.motive, motiveNow, 5);
    this.activityLevel = fade(this.activityLevel, body.speedFraction, 6);

    this.readAffect(org);
    this.classify(sim.time);
    this.detectMilestones(sim.time);

    if (sim.time >= this.nextSample) {
      this.nextSample += SAMPLE_EVERY;
      this.sample();
    }
  }

  // Durerea se citește din lume: există un obiect dureros în contact cu organismul?
  painThisStep() {
    const org = this.sim.organism;
    let pain = 0;
    for (const o of this.sim.world.objects) {
      if ((o.kind === 'thorn' || o.kind === 'predator') && o.touching) pain = 1;
    }
    if (pain && !this.wasInPain) {
      this.painLog.push(this.sim.time);
      this.counts.thornContacts++;
      if (!this.flags.firstPain) {
        this.flags.firstPain = true;
        this.log(this.sim.time, 'Prima durere: a atins un obiect roșu. Reflexul îl retrage, nu știe încă de ce.', 'danger');
      }
      const target = this.targetKind(org.brain.action.targetId);
      if (this.sim.phase.id === 'substance' && target === 'substance' && !this.flags.painForSubstance) {
        this.flags.painForSubstance = true;
        this.log(this.sim.time, 'Se rănește în drum spre substanță: pericolul nu mai e luat în seamă.', 'danger');
      }
    }
    this.wasInPain = pain === 1;
    return pain;
  }

  targetKind(id) {
    if (id === null || id === undefined) return null;
    const o = this.sim.world.objects.find((x) => x.id === id);
    if (!o) return null;
    return o.kind === 'husk' ? 'nutrient' : o.kind;
  }

  // Nuanța -> tipul de obiect cel mai apropiat (doar observatorul cunoaște tipurile).
  kindOfHue(hue) {
    if (hue === null || hue === undefined) return null;
    let best = null;
    let bestD = Infinity;
    for (const k of ['nutrient', 'thorn', 'stone', 'substance']) {
      let d = Math.abs(((hue - this.kinds[k].hue + 540) % 360) - 180);
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    return bestD < 30 ? best : null;
  }

  trackConsumption() {
    for (const ev of this.sim.world.events) {
      if (ev.type !== 'consume' || this.consumedSeen.has(ev)) continue;
      this.consumedSeen.add(ev);
      const t = ev.time;
      if (ev.kind === 'nutrient' || ev.kind === 'husk') {
        const fed = t - this.lastFeed < 1.5;
        this.mealLog.push({ time: t, fed, empty: ev.kind === 'husk' });
        if (ev.kind === 'nutrient') {
          if (fed) this.counts.fedMeals++;
          else this.counts.selfMeals++;
          if (!fed && !this.flags.firstSelfMeal) {
            this.flags.firstSelfMeal = true;
            this.log(t, 'Prima masă găsită singur: s-a îndreptat spre un obiect verde și l-a mâncat.', 'good');
          }
        }
      } else if (ev.kind === 'substance') {
        this.counts.doses++;
        this.doseLog.push(t);
        if (!this.flags.firstDose) {
          this.flags.firstDose = true;
          const delay = this.sim.protocol.substanceStart ? t - this.sim.protocol.substanceStart : 0;
          this.log(t, `Prima doză, după ${delay.toFixed(0)} s: a atins-o din curiozitate (obiect nou). Un val de dopamină.`, 'drug');
        }
      }
    }
    // curăță referințele la evenimente expirate
    if (this.consumedSeen.size > 64) {
      const live = new Set(this.sim.world.events);
      for (const e of this.consumedSeen) if (!live.has(e)) this.consumedSeen.delete(e);
    }
  }

  readAffect(org) {
    const endo = org.endocrine;
    const brain = org.brain;
    const body = org.body;
    const drive = brain.drive(body.energy, body.integrity, brain.mod.energyWeight);
    const hedonic = clamp(endo.daNorm - 1, -1, 1.5);
    this.valence = Math.tanh(
      1.5 * hedonic -
        1.1 * Math.max(0, drive - 0.12) -
        4 * this.painEMA -
        1.2 * brain.threat -
        0.9 * Math.max(0, endo.cortisol - 0.25),
    );
    this.arousal = clamp(
      1.1 * Math.max(0, endo.noradrenaline - 0.12) +
        0.75 * Math.max(0, endo.cortisol - 0.14) +
        0.3 * Math.max(0, endo.daNorm - 1.3),
      0,
      1,
    );
  }

  // Regiunea din spațiul afectiv + contextul (Barrett, 2017: emoția = afect de bază
  // interpretat în context). Cu histerezis: o stare trebuie să persiste 2 s.
  classify(time) {
    const org = this.sim.organism;
    const endo = org.endocrine;
    const v = this.valence;
    const a = this.arousal;
    const dopamine = endo.daNorm;
    const lastPain = this.painLog.length ? this.painLog[this.painLog.length - 1] : -Infinity;
    const hurtRecently = time - lastPain < 120;
    const threatened = org.brain.threat > 0.05;
    let next;
    if (dopamine > 1.5 && v > 0.3) next = 'euphoria';
    else if (v < -0.2 && (threatened || (hurtRecently && (a > 0.12 || endo.cortisol > 0.25)))) next = 'fear';
    else if (v < -0.2 && this.motive > 0.1 && ((endo.momentum < -0.12 && a > 0.1) || (this.motive > 0.3 && a > 0.3)))
      next = 'frustration';
    else if (v < -0.15 && dopamine < 0.8 && this.activityLevel < 0.3) next = 'apathy';
    else if (v < -0.25) next = 'discomfort'; // neplăcere fără activare mare: o nevoie nesatisfăcută
    else if (a > 0.35) next = 'alert';
    else next = 'calm';

    if (next !== this.candidate) {
      this.candidate = next;
      this.candidateSince = time;
    }
    if (this.candidate !== this.stateId && time - this.candidateSince >= 2) {
      this.stateId = this.candidate;
    }
  }

  detectMilestones(time) {
    const org = this.sim.organism;
    const brain = org.brain;
    const endo = org.endocrine;
    const appraiseHue = (hue) => brain.appraise(brain.code.encode(hue), org.body);
    const flag = (key, cond, text, tone) => {
      if (!this.flags[key] && cond) {
        this.flags[key] = true;
        this.log(time, text, tone);
      }
    };

    if (Math.floor(time * 10) % 10 === 0) {
      const food = appraiseHue(this.kinds.nutrient.hue);
      const thorn = appraiseHue(this.kinds.thorn.hue);
      flag('learnedFood', food.kE > 0.12, 'A învățat singur: lucrurile verzi îi refac energia.', 'good');
      flag('learnedThorn', thorn.kP > 0.04, 'A învățat singur: lucrurile roșii doare. Le ocolește de acum.', 'good');
    }

    // Persistența stresului după atac
    if (this.shockRecovery && !this.shockRecovery.reported) {
      const s = this.shockRecovery;
      s.cortisolPeak = Math.max(s.cortisolPeak, endo.cortisol);
      if (endo.cortisol < 0.2 || time - s.start > 400) {
        s.reported = true;
        s.duration = time - s.start;
        this.log(time, `Cortizolul a rămas ridicat ${s.duration.toFixed(0)} s după plecarea prădătorului: starea a persistat fără stimul.`, 'neutral');
      }
    }

    if (this.sim.phase.id === 'substance' && this.counts.doses > 0) {
      flag('tolerance', endo.receptor < 0.5, 'Toleranță: receptorii dopaminergici au scăzut la jumătate. Aceeași doză face mai puțin.', 'drug');
      flag(
        'withdrawal',
        org.body.blood < 0.05 && endo.daNorm < 0.65,
        'Prima sevrare: fără substanță, dopamina scade sub normal. Totul pare mai puțin valoros.',
        'drug',
      );
      const sub = appraiseHue(this.kinds.substance.hue);
      flag(
        'wantOverLike',
        sub.want > 1.5 && sub.want > 3 * Math.max(sub.kH, 0.05),
        'Dorința a depășit cu mult plăcerea: o vrea tot mai mult, deși îi face tot mai puțină plăcere.',
        'drug',
      );
      flag(
        'habitControl',
        brain.mod.omega < 0.4,
        'Stresul cronic mută controlul deciziilor spre sistemul de obișnuință.',
        'drug',
      );
      const foodSeen = brain.attended.some((pc) => this.targetKind(pc.id) === 'nutrient');
      flag(
        'ignoresFood',
        foodSeen && endo.ghrelin > 0.6 && this.chasing() === 'substance',
        'Flămând, cu hrană în câmpul atenției, alege totuși substanța.',
        'danger',
      );
    }
  }

  chasing() {
    const brain = this.sim.organism.brain;
    const a = brain.action;
    let kind = null;
    if (a.type === 'approach') kind = this.targetKind(a.targetId);
    else if (a.type === 'explore') kind = this.kindOfHue(brain.sought.hue);
    if (kind === 'nutrient') return 'food';
    if (kind === 'substance') return 'substance';
    return kind ? 'other' : 'none';
  }

  activityNow() {
    const brain = this.sim.organism.brain;
    const a = brain.action;
    if (a.type === 'rest') return 'rest';
    if (a.type === 'avoid') return 'avoid';
    if (a.type === 'explore') return 'search';
    const kind = this.targetKind(a.targetId);
    if (kind === 'nutrient') return 'food';
    if (kind === 'substance') return 'substance';
    return 'other';
  }

  sample() {
    const sim = this.sim;
    const org = sim.organism;
    const endo = org.endocrine;
    const brain = org.brain;
    const body = org.body;
    const h = this.history;
    const sub = brain.appraise(brain.code.encode(this.kinds.substance.hue), body);
    const food = brain.appraise(brain.code.encode(this.kinds.nutrient.hue), body);
    const push = (k, v) => h[k].push(v);
    push('t', sim.time);
    push('energy', body.energy);
    push('integrity', Math.max(0, body.integrity));
    push('ghrelin', endo.ghrelin);
    push('noradrenaline', endo.noradrenaline);
    push('cortisol', endo.cortisol);
    push('dopamine', endo.daNorm);
    push('receptor', endo.receptor);
    push('blood', body.blood);
    push('organLoad', body.organLoad);
    push('incentive', endo.incentiveGain);
    push('omega', brain.mod.omega);
    push('attention', brain.mod.attentionSlots);
    push('reaction', brain.mod.decisionInterval);
    push('beta', brain.mod.beta);
    push('valence', this.valence);
    push('arousal', this.arousal);
    push('approach', this.motive);
    push('state', STATE_INDEX[this.stateId]);
    push('activity', ACTIVITY_INDEX[this.activityNow()]);
    push('wantSubstance', sub.want);
    push('goalSubstance', sub.goal);
    push('likeSubstance', sub.kH);
    push('wantFood', food.want);
    push('goalFood', food.goal);
    push('threat', brain.threat);
    push('phase', sim.phase.index);
    push('hungry', endo.ghrelin > 0.5 ? 1 : 0);
    push('foodInView', brain.attended.some((pc) => this.targetKind(pc.id) === 'nutrient') ? 1 : 0);
    push('chasing', CHASE.indexOf(this.chasing()));

    // statistici comportamentale pe stări (persistența influențează deciziile)
    const st = this.stats.byState[this.stateId];
    this.stats.stateTime[this.stateId] += SAMPLE_EVERY;
    st.n++;
    st.explore += brain.action.type === 'explore' ? 1 : 0;
    st.rest += brain.action.type === 'rest' ? 1 : 0;
    st.reaction += brain.mod.decisionInterval;
    st.attention += brain.mod.attentionSlots;
  }

  get state() {
    return STATES[STATE_INDEX[this.stateId]];
  }
}
