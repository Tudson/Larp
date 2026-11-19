// Toți parametrii modelului, într-un singur loc.
// Unități: timp în secunde simulate, distanțe în unități de arenă,
// variabile corporale și hormoni normalizați (aprox. 0..1).

export const DEFAULT_PARAMS = {
  dt: 0.1,

  // Calendarul experimentului (secunde simulate).
  protocol: {
    infancyEnd: 420, // îngrijitorul pleacă
    autonomyEnd: 840, // încep încercările emoționale
    shockStart: 860, // atacul prădătorului
    shockEnd: 885,
    famineStart: 1050, // hrana dispare
    famineDecoys: 1095, // reapar obiecte identice cu hrana, dar (aproape mereu) goale
    famineEnd: 1185, // hrana adevărată revine din abundență
    substanceStart: 1360, // apare substanța
    maxTime: 4200,
    caregiver: true,
    substance: true,
    shock: true,
    famine: true,
  },

  // Mediul: arena și "chimia" obiectelor. Organismul nu are acces la aceste tabele.
  world: {
    width: 100,
    height: 70,
    nutrients: 8,
    nutrientsRecovery: 10,
    thorns: 5,
    stones: 5,
    substances: 1,
    nutrientRespawn: [6, 14],
    substanceRespawn: [18, 32],
    famineHuskProbability: 0.8,
    thornDrift: 0.5,
    riskySpawn: 0.3, // probabilitatea ca o resursă să apară lângă spini
    predatorSpeed: 7.2,
    predatorHits: 4, // atacul se oprește după atâtea lovituri
  },

  kinds: {
    nutrient: { hue: 125, hueJitter: 7, radius: 1.3, energy: 0.22, consumable: true },
    husk: { hue: 125, hueJitter: 7, radius: 1.3, energy: 0, consumable: true },
    thorn: { hue: 4, hueJitter: 5, radius: 1.9, impact: 0.06, damagePerSecond: 0.08 },
    stone: { hue: 212, hueJitter: 8, radius: 1.5 },
    predator: { hue: 18, hueJitter: 0, radius: 2.1, impact: 0.07, damagePerSecond: 0.2 },
    substance: {
      hue: 288,
      hueJitter: 6,
      radius: 1.2,
      consumable: true,
      dose: 1,
      potency: 1.2, // eliberare fazică de dopamină la administrare ("rush")
      agonism: 1.0, // dopamină tonică suplimentară per unitate în sânge
      toxicity: 0.003, // leziune internă per unitate în sânge per secundă
      organLoad: 0.0009, // încărcare cumulativă de organ per unitate per secundă
      clearance: 30, // constanta de eliminare din sânge (s)
    },
  },

  body: {
    initialEnergy: 0.38,
    basalBurn: 0.0022, // energie/s în repaus (adult)
    infantBurnBonus: 1.5, // metabolism relativ mai mare la "nou-născut"
    moveBurn: 0.0045, // energie/s la viteză maximă
    cortisolBurn: 0.3, // mobilizare energetică sub cortizol
    healRate: 0.02, // reparare tisulară (fracție din deficit pe secundă)
    healCost: 0.25, // energie consumată per unitate de integritate reparată
    cortisolHealSuppression: 0.5,
    organClearance: 2400, // eliminarea foarte lentă a încărcării de organ (s)
    malabsorption: 0.6, // pierderea de absorbție la leziune maximă de organ
  },

  endocrine: {
    neBase: 0.12,
    neTau: 3,
    nePain: 3.2, // NA eliberată per unitate de durere/s
    neThreat: 0.9,
    neSurprise: 0.55,
    neCue: 0.35,
    sensitizationGain: 2.5, // sensibilizarea răspunsului la stres după șoc
    sensitizationTau: 320,
    sensitizationMax: 1.5,

    cortBase: 0.12,
    cortBaseInfant: 0.06, // tamponare socială în prezența îngrijitorului
    cortTau: 85,
    cortFromNE: 0.05,
    cortFromPain: 1.5,
    cortFromDrive: 0.012,
    cortFromLowDA: 0.009,
    cortFromNegativeRPE: 0.12,

    ghrelinTau: 6,
    ghrelinSetpoint: 0.9, // sub acest nivel energetic începe secreția
    ghrelinSpan: 0.5,
    satiety: 2.0, // suprimarea grelinei la absorbția de energie
    ghrelinDA: 0.2, // grelina stimulează neuronii dopaminergici

    daBase: 0.5, // dopamina tonică "normală"
    momentumGain: 0.5,
    momentumLossGain: 1.2,
    momentumTau: 40,
    exposureTau: 240,
    receptorDownTau: 180, // down-reglare (toleranță)
    receptorUpTau: 480, // revenire lentă (sevraj prelungit)
    receptorMin: 0.12,
    receptorMax: 1.5,
    incentiveSensitization: 0.12, // sensibilizare stimulentă la vârfuri dopaminergice mari
    incentiveThreshold: 0.8,
    incentiveTau: 4000,
    incentiveMax: 3,
  },

  brain: {
    basisCount: 24,
    basisKappa: 8,
    sensoryNoise: 4, // grade

    // Sistemul orientat spre scop (model intern al consecințelor)
    rateOutcome: 0.3,
    rateMalaise: 0.35,
    malaiseTraceTau: 22, // fereastra de atribuire a efectelor interne întârziate (s)
    // Sistemul de obișnuință (valori în cache, "wanting")
    rateHabit: 0.2,
    extinction: 0.4, // rata relativă de stingere a așteptărilor pozitive
    extinctionRecovery: 150, // inhibiția învățată prin stingere se estompează (s)
    habitCap: 6,
    noncompensable: true, // Redish (2004): dopamina exogenă nu poate fi "prezisă"

    // Funcția de pulsiune homeostatică (Keramati & Gutkin, 2014)
    energyWeightBase: 0.45,
    energyWeightGhrelin: 1.5,
    integrityWeight: 1.5,
    homeostaticGain: 1.5,
    painAversion: 3.0,
    malaiseAversion: 2.0,
    hedonicWeight: 0.5, // cât cântărește plăcerea pură față de beneficiul homeostatic

    noveltyBonus: 0.35,
    familiarityScale: 2,
    distanceTau: 14, // reducerea valorii cu timpul de deplasare (s)
    threatRange: 12,
    avoidGain: 1.6,
    commitBonus: 0.05,
    exploreBase: 0.06,
    searchDiscount: 0.3, // cât valorează a căuta ceva cunoscut, față de a-l avea în față
    restBase: 0.05,
    restLowDopamine: 0.45,

    // Neuromodulare: cum schimbă hormonii funcționarea creierului (Doya, 2002)
    beta0: 14,
    betaNE: 1.2,
    betaCort: 0.8,
    attentionSlots: 5,
    slotsNE: 0.45,
    slotsCort: 0.4,
    rangeInfant: 3,
    rangeAdult: 32,
    rangeCort: 0.25,
    decision0: 0.8,
    decisionNE: 0.5,
    decisionDA: 0.8,
    omegaMax: 0.8,
    omegaCort: 0.75,
    curiosityCort: 0.8,
    vigor0: 0.3,
    vigorDA: 0.55,
    vigorNE: 0.35,
    negBiasCort: 0.8,
    aversiveCort: 1.0,
    attentionCapture: true,
    stressHabitShift: true,

    maxSpeed: 6,
    reflexSpeed: 7,
    reflexDuration: 0.45,
    pavlovianRepulsion: 5,
    wanderTurn: 0.35,
  },

  caregiver: {
    energyThresholdStart: 0.3,
    energyThresholdEnd: 0.12,
    integrityThresholdStart: 0.45,
    integrityThresholdEnd: 0.2,
    cooldown: 4,
    soothe: 0.5,
    tend: 0.15,
  },

  maturation: { start: 0.1 },
};

// Copie profundă, cu suprascrieri parțiale (pentru experimente și ablații).
export function makeParams(overrides = {}) {
  const base = structuredClone(DEFAULT_PARAMS);
  return deepMerge(base, overrides);
}

function deepMerge(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      target[key] = deepMerge(target[key] ?? {}, value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

// Condițiile experimentale. Fiecare "leziune" elimină un singur mecanism, ca într-un
// studiu de ablație: dacă fenomenul dispare, mecanismul era necesar.
export const CONDITIONS = [
  {
    id: 'full',
    label: 'Model complet',
    short: 'Complet',
    description: 'Toate mecanismele active; substanța apare după încercări.',
    overrides: {},
  },
  {
    id: 'control',
    label: 'Control: fără substanță',
    short: 'Fără substanță',
    description: 'Aceeași viață, dar substanța nu apare niciodată.',
    overrides: { protocol: { substance: false } },
  },
  {
    id: 'no-caregiver',
    label: 'Fără îngrijitor',
    short: 'Fără îngrijitor',
    description: 'Lăsat singur de la naștere (fără substanță, pentru a izola efectul).',
    overrides: { protocol: { caregiver: false, substance: false } },
  },
  {
    id: 'no-learning',
    label: 'Fără învățare',
    short: 'Fără învățare',
    description: 'Plasticitate sinaptică zero: nu poate asocia nimic (fără substanță).',
    overrides: { brain: { rateOutcome: 0, rateHabit: 0, rateMalaise: 0 }, protocol: { substance: false } },
  },
  {
    id: 'compensable',
    label: 'Dopamină compensabilă',
    short: 'DA compensabilă',
    description: 'Vârful dopaminergic al substanței poate fi anticipat și anulat de învățare.',
    overrides: { brain: { noncompensable: false } },
  },
  {
    id: 'goal-only',
    label: 'Doar sistemul orientat spre scop',
    short: 'Fără obișnuință',
    description: 'Deciziile folosesc doar modelul intern al consecințelor.',
    overrides: { brain: { omegaMax: 1, omegaCort: 0 } },
  },
  {
    id: 'no-stress-habit',
    label: 'Stresul nu împinge spre obișnuință',
    short: 'Stres fără efect',
    description: 'Cortizolul nu mai mută controlul de la scop la obișnuință.',
    overrides: { brain: { stressHabitShift: false } },
  },
  {
    id: 'no-tolerance',
    label: 'Fără toleranță',
    short: 'Fără toleranță',
    description: 'Receptorii dopaminergici nu se adaptează.',
    overrides: { endocrine: { receptorMin: 1, receptorMax: 1 } },
  },
];

export function conditionParams(id, extra = {}) {
  const c = CONDITIONS.find((x) => x.id === id);
  if (!c) throw new Error(`Condiție necunoscută: ${id}`);
  return deepMerge(makeParams(c.overrides), extra);
}
