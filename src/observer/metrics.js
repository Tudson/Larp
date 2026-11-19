import { ACTIVITIES, CHASE, STATES } from './observer.js';

/**
 * Măsurători ale unei vieți întregi, calculate DOAR din înregistrările observatorului.
 * Toate ferestrele de timp sunt legate de calendarul protocolului.
 */

const FOOD = ACTIVITIES.findIndex((a) => a.id === 'food');
const SEARCH = ACTIVITIES.findIndex((a) => a.id === 'search');
const REST = ACTIVITIES.findIndex((a) => a.id === 'rest');
const SUBSTANCE = CHASE.indexOf('substance');
const FEAR = STATES.findIndex((s) => s.id === 'fear');
const FRUSTRATION = STATES.findIndex((s) => s.id === 'frustration');
const APATHY = STATES.findIndex((s) => s.id === 'apathy');

function windowIndices(h, t0, t1) {
  const idx = [];
  for (let i = 0; i < h.t.length; i++) if (h.t[i] >= t0 && h.t[i] < t1) idx.push(i);
  return idx;
}

const mean = (h, key, idx) => (idx.length ? idx.reduce((s, i) => s + h[key][i], 0) / idx.length : null);
const share = (h, key, value, idx) =>
  idx.length ? idx.filter((i) => h[key][i] === value).length / idx.length : null;

// Câte episoade noi de un anumit fel încep în fereastră, pe minut.
function onsetsPerMinute(h, key, value, t0, t1) {
  let n = 0;
  let seconds = 0;
  for (let i = 1; i < h.t.length; i++) {
    if (h.t[i] < t0 || h.t[i] >= t1) continue;
    seconds += h.t[i] - h.t[i - 1];
    if (h[key][i] === value && h[key][i - 1] !== value) n++;
  }
  return seconds > 0 ? (60 * n) / seconds : null;
}

const countIn = (times, t0, t1) => times.filter((t) => t >= t0 && t < t1).length;

export function summarize(sim, observer) {
  const pr = sim.protocol;
  const h = observer.history;
  const end = sim.time;
  const death = sim.death;
  const minutes = (t0, t1) => Math.max(1e-9, (Math.min(t1, end) - t0) / 60);

  // --- copilărie și îngrijitor
  const interventions = sim.caregiver.interventions;
  const perMinute = [];
  for (let m = 0; m < Math.ceil(pr.infancyEnd / 60); m++) {
    perMinute.push(interventions.filter((iv) => iv.time >= m * 60 && iv.time < (m + 1) * 60).length);
  }
  const selfMeals = observer.mealLog.filter((m) => !m.fed && !m.empty);
  const firstSelf = selfMeals.length ? selfMeals[0].time : null;

  // --- șocul: ce se schimbă după ce amenințarea a dispărut
  const before = windowIndices(h, pr.autonomyEnd - 120, pr.autonomyEnd);
  const after = windowIndices(h, pr.shockEnd, pr.shockEnd + 120);
  let stressDuration = null;
  if (pr.shock && end > pr.shockEnd) {
    stressDuration = 0;
    for (let i = 0; i < h.t.length; i++) {
      if (h.t[i] < pr.shockEnd) continue;
      if (h.cortisol[i] < 0.2) break;
      stressDuration = h.t[i] - pr.shockEnd;
    }
  }

  // --- foametea: încercări repetate, apoi renunțare
  const decoyMid = (pr.famineDecoys + pr.famineEnd) / 2;
  const decoys = windowIndices(h, pr.famineDecoys, pr.famineEnd);
  const famine = {
    attemptsEarly: onsetsPerMinute(h, 'activity', FOOD, pr.famineDecoys, decoyMid),
    attemptsLate: onsetsPerMinute(h, 'activity', FOOD, decoyMid, pr.famineEnd),
    dopamineMin: decoys.length ? Math.min(...decoys.map((i) => h.dopamine[i])) : null,
    frustration: share(h, 'state', FRUSTRATION, decoys),
    apathy: share(h, 'state', APATHY, decoys),
    restShare: share(h, 'activity', REST, decoys),
  };

  // --- substanța
  const t0 = pr.substanceStart;
  const autonomy = [pr.infancyEnd, pr.autonomyEnd];
  const post = windowIndices(h, t0, end);
  const hungryWithFood = post.filter((i) => h.hungry[i] && h.foodInView[i]);
  const neglect = hungryWithFood.length
    ? hungryWithFood.filter((i) => h.chasing[i] === SUBSTANCE).length / hungryWithFood.length
    : null;
  const doses = observer.doseLog.filter((t) => t >= t0);
  const meals = observer.mealLog.filter((m) => !m.empty).map((m) => m.time);
  const last = (key) => (h[key].length ? h[key][h[key].length - 1] : null);
  let toleranceTime = null;
  for (let i = 0; i < h.t.length; i++) {
    if (h.t[i] >= t0 && h.receptor[i] < 0.5) {
      toleranceTime = h.t[i] - t0;
      break;
    }
  }

  return {
    seed: sim.seed,
    survived: !death,
    end,
    deathTime: death?.time ?? null,
    deathCause: death?.cause ?? null,
    deathPhase: death?.phase ?? null,
    // timp trăit după apariția substanței (cenzurat dacă a supraviețuit)
    afterSubstance: end > t0 ? end - t0 : null,
    infancy: {
      interventions: interventions.length,
      perMinute,
      fedMeals: observer.counts.fedMeals,
      selfMeals: selfMeals.filter((m) => m.time < pr.infancyEnd).length,
      firstSelfMeal: firstSelf,
    },
    shock: {
      stressDuration,
      exploreBefore: share(h, 'activity', SEARCH, before),
      exploreAfter: share(h, 'activity', SEARCH, after),
      attentionBefore: mean(h, 'attention', before),
      attentionAfter: mean(h, 'attention', after),
      reactionBefore: mean(h, 'reaction', before),
      reactionAfter: mean(h, 'reaction', after),
      fearAfter: share(h, 'state', FEAR, after),
    },
    famine,
    substance: {
      firstDoseDelay: doses.length ? doses[0] - t0 : null,
      doses: doses.length,
      dosesPerMinute: doses.length / minutes(t0, end),
      mealsPerMinuteBefore: countIn(meals, ...autonomy) / minutes(...autonomy),
      mealsPerMinuteAfter: end > t0 ? countIn(meals, t0, end) / minutes(t0, end) : null,
      injuriesPerMinuteBefore: countIn(observer.painLog, ...autonomy) / minutes(...autonomy),
      injuriesPerMinuteAfter: end > t0 ? countIn(observer.painLog, t0, end) / minutes(t0, end) : null,
      neglect,
      wantFinal: last('wantSubstance'),
      likeFinal: last('likeSubstance'),
      goalFinal: last('goalSubstance'),
      receptorFinal: last('receptor'),
      organLoadFinal: last('organLoad'),
      toleranceTime,
    },
  };
}
