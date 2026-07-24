'use strict';

/*
 * Moteur du jeu "Smile Life" (adaptation amateur, version « cœur jouable »).
 *
 * Interface d'un module de jeu (voir server.js) :
 *   { id, name, description, minPlayers, maxPlayers,
 *     start(room, ctx), action(room, clientId, msg, ctx),
 *     reset(room), dispose(room), removePlayer(room, clientId, ctx),
 *     state(room, ctx)         → état PUBLIC (identique pour tous)
 *     privateState(room, id, ctx) → sur-couche PRIVÉE par joueur (la main) }
 *
 * Boucle : à son tour on PIOCHE puis on POSE une carte (devant soi / en malus
 * sur un autre / à la défausse). Le jeu s'arrête quand la pioche est vide ; on
 * compte alors les smiles posés devant soi. Le plus heureux gagne.
 *
 * Périmètre v1 : études → métier → salaires ; flirts → mariage → enfants ;
 * acquisitions (maisons/voyages/animaux) ; distinctions ; démission / divorce
 * volontaire ; malus courants (accident, maladie, burn-out, licenciement,
 * impôt, divorce, redoublement). Sont volontairement écartés du deck pour
 * l'instant : cartes spéciales, adultère, prison, attentat.
 */

const HAND_BASE = 5;
const MAX_ETUDES = 6;      // cartes études cumulables
const MAX_FLIRTS = 5;      // flirts cumulables (barman : illimité avant mariage)

// Lieux de flirt ; hôtel et camping autorisent un (seul) enfant sans mariage.
const FLIRT_PLACES = [
  'Sur internet', 'Au restaurant', "À l'hôtel", 'Au camping',
  'À la plage', 'En boîte de nuit', 'Au bureau', 'En vacances',
];
const CHILD_PLACES = ["À l'hôtel", 'Au camping'];

const CHILD_NAMES = ['Leïa', 'Noé', 'Jade', 'Lucas', 'Emma', 'Gabin', 'Chloé', 'Tom', 'Léa', 'Sacha'];

const PET_NAMES = ['Chat', 'Chien', 'Lapin', 'Poisson rouge', 'Perroquet'];
const HOUSE_NAMES = ['Studio', 'Appartement', 'Maison de ville', 'Villa', 'Château'];
const TRAVEL_NAMES = ['Week-end', 'Road-trip', 'Croisière', "Tour d'Europe", 'Tour du monde'];

// Les 30 métiers : niveau d'études requis, niveau de salaire max, smiles,
// statut (fonctionnaire/intérimaire) et avantages PASSIFS implémentés.
// adv : noAccident | noMaladie | noDivorce | noLicenciement | noImpot |
//       sixCards | flirtsUnlimited | canStudyWithJob
const JOBS = [
  { name: 'Serveur',          studyReq: 0, maxSalary: 1, smiles: 1, status: 'interimaire' },
  { name: 'Barman',           studyReq: 0, maxSalary: 1, smiles: 2, status: 'interimaire', adv: ['flirtsUnlimited'] },
  { name: 'Stripteaser',      studyReq: 0, maxSalary: 2, smiles: 2, status: 'interimaire' },
  { name: 'Pizzaïolo',        studyReq: 0, maxSalary: 1, smiles: 1 },
  { name: 'Jardinier',        studyReq: 0, maxSalary: 1, smiles: 2, status: 'interimaire' },
  { name: 'Plombier',         studyReq: 1, maxSalary: 2, smiles: 2, status: 'interimaire' },
  { name: 'Garagiste',        studyReq: 1, maxSalary: 2, smiles: 1, adv: ['noAccident'] },
  { name: 'Bandit',           studyReq: 0, maxSalary: 4, smiles: 0, adv: ['noLicenciement', 'noImpot'] },
  { name: 'Gourou',           studyReq: 0, maxSalary: 4, smiles: 0 },
  { name: 'Médium',           studyReq: 2, maxSalary: 3, smiles: 2 },
  { name: 'Militaire',        studyReq: 2, maxSalary: 2, smiles: 2, status: 'fonctionnaire' },
  { name: 'Policier',         studyReq: 2, maxSalary: 2, smiles: 2, status: 'fonctionnaire' },
  { name: 'Prof de maths',    studyReq: 2, maxSalary: 2, smiles: 3, status: 'fonctionnaire', prof: true },
  { name: 'Prof de français', studyReq: 2, maxSalary: 2, smiles: 3, status: 'fonctionnaire', prof: true },
  { name: "Prof d'anglais",   studyReq: 2, maxSalary: 2, smiles: 3, status: 'fonctionnaire', prof: true },
  { name: "Prof d'histoire",  studyReq: 2, maxSalary: 2, smiles: 3, status: 'fonctionnaire', prof: true },
  { name: 'Journaliste',      studyReq: 3, maxSalary: 3, smiles: 3, grandPrix: true },
  { name: 'Écrivain',         studyReq: 3, maxSalary: 3, smiles: 4, grandPrix: true },
  { name: 'Chercheur',        studyReq: 5, maxSalary: 3, smiles: 4, adv: ['sixCards'], grandPrix: true },
  { name: 'Designer',         studyReq: 4, maxSalary: 3, smiles: 3 },
  { name: 'Pilote de ligne',  studyReq: 4, maxSalary: 4, smiles: 4 },
  { name: 'Chef des achats',  studyReq: 4, maxSalary: 4, smiles: 3 },
  { name: 'Chef des ventes',  studyReq: 4, maxSalary: 4, smiles: 3 },
  { name: 'Architecte',       studyReq: 5, maxSalary: 4, smiles: 4 },
  { name: 'Avocat',           studyReq: 5, maxSalary: 4, smiles: 4, adv: ['noDivorce'] },
  { name: 'Pharmacien',       studyReq: 4, maxSalary: 3, smiles: 3, adv: ['noMaladie'] },
  { name: 'Médecin',          studyReq: 5, maxSalary: 4, smiles: 5, adv: ['noMaladie', 'canStudyWithJob'] },
  { name: 'Chirurgien',       studyReq: 6, maxSalary: 4, smiles: 6, adv: ['noMaladie', 'canStudyWithJob'] },
  { name: 'Astronaute',       studyReq: 6, maxSalary: 4, smiles: 6 },
  // Grand prof : à la fois métier et promotion ; ne se pose que si on est déjà prof.
  { name: 'Grand prof',       studyReq: 0, maxSalary: 3, smiles: 5, status: 'fonctionnaire', prof: true, requiresProf: true },
];

const MALUS_DEFS = [
  { subtype: 'accident',     label: 'Accident',     count: 5 },
  { subtype: 'maladie',      label: 'Maladie',      count: 5 },
  { subtype: 'burnout',      label: 'Burn-out',     count: 5 },
  { subtype: 'licenciement', label: 'Licenciement', count: 5 },
  { subtype: 'impot',        label: 'Impôt',        count: 5 },
  { subtype: 'divorce',      label: 'Divorce',      count: 5 },
  { subtype: 'redoublement', label: 'Redoublement', count: 5 },
];

// ---------- Construction du deck ----------
let uidCounter = 0;
function card(props) { return Object.assign({ uid: 'k' + (++uidCounter) }, props); }

function buildDeck() {
  const deck = [];

  // 25 études (22 simples niveau 1, 3 doubles niveau 2)
  for (let i = 0; i < 22; i++) deck.push(card({ type: 'etude', name: 'Études', level: 1, smiles: 1 }));
  for (let i = 0; i < 3; i++) deck.push(card({ type: 'etude', name: 'Études doubles', level: 2, smiles: 2, double: true }));

  // 30 métiers
  JOBS.forEach(j => deck.push(card(Object.assign({ type: 'metier' }, j))));

  // 40 salaires (10 par niveau 1..4) — smiles = niveau, valeur monnaie = niveau
  for (let lvl = 1; lvl <= 4; lvl++) {
    for (let i = 0; i < 10; i++) deck.push(card({ type: 'salaire', name: 'Salaire', level: lvl, smiles: lvl }));
  }

  // 20 flirts (répartis sur les lieux)
  for (let i = 0; i < 20; i++) {
    const place = FLIRT_PLACES[i % FLIRT_PLACES.length];
    deck.push(card({ type: 'flirt', name: 'Flirt', smiles: 1, place, allowChild: CHILD_PLACES.includes(place) }));
  }

  // 7 mariages
  for (let i = 0; i < 7; i++) deck.push(card({ type: 'mariage', name: 'Mariage', smiles: 3 }));

  // 10 enfants
  for (let i = 0; i < 10; i++) deck.push(card({ type: 'enfant', name: CHILD_NAMES[i % CHILD_NAMES.length], smiles: 2 }));

  // 15 acquisitions : 5 animaux (gratuits), 5 maisons, 5 voyages
  PET_NAMES.forEach(n => deck.push(card({ type: 'acquisition', subtype: 'animal', name: n, smiles: 2, price: 0 })));
  const housePrice = [5, 6, 7, 8, 9], houseSmiles = [4, 5, 6, 7, 9];
  HOUSE_NAMES.forEach((n, i) => deck.push(card({ type: 'acquisition', subtype: 'maison', name: n, smiles: houseSmiles[i], price: housePrice[i] })));
  const travelPrice = [3, 4, 5, 6, 7], travelSmiles = [3, 4, 5, 6, 8];
  TRAVEL_NAMES.forEach((n, i) => deck.push(card({ type: 'acquisition', subtype: 'voyage', name: n, smiles: travelSmiles[i], price: travelPrice[i] })));

  // 3 distinctions
  deck.push(card({ type: 'distinction', subtype: 'grandprix', name: "Grand prix d'excellence", smiles: 5 }));
  deck.push(card({ type: 'distinction', subtype: 'grandprix', name: "Grand prix d'excellence", smiles: 5 }));
  deck.push(card({ type: 'distinction', subtype: 'legion', name: "Légion d'honneur", smiles: 10 }));

  // 35 malus
  MALUS_DEFS.forEach(m => {
    for (let i = 0; i < m.count; i++) deck.push(card({ type: 'malus', subtype: m.subtype, name: m.label, smiles: 0 }));
  });

  // Mélange (Fisher-Yates)
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function emptyTableau() {
  return {
    etudes: [], metier: null, salaires: [],
    flirts: [], mariage: null, enfants: [],
    acquisitions: [], distinctions: [], malus: [],
  };
}

// ---------- Accès / dérivés ----------
function g(room) { return room.game; }
function hand(room, id) { return room.game.hands[id] || []; }
function tab(room, id) { return room.game.tableaux[id]; }
function currentId(room) {
  const gm = room.game;
  if (!gm || !gm.turnOrder.length) return null;
  return gm.turnOrder[gm.turnPointer % gm.turnOrder.length];
}
function studyLevel(t) { return t.etudes.reduce((s, e) => s + (e.level || 1), 0); }
function hasJob(t) { return !!t.metier; }
function jobHasAdv(t, adv) { return !!(t.metier && t.metier.adv && t.metier.adv.includes(adv)); }
function isMarried(t) { return !!t.mariage; }
function effectiveMaxSalary(t) {
  if (!t.metier) return 0;
  const gp = t.distinctions.some(d => d.subtype === 'grandprix');
  return gp ? 4 : t.metier.maxSalary;
}
function availableMoney(t) { return t.salaires.filter(s => !s.invested).reduce((sum, s) => sum + s.level, 0); }
function handLimit(room, id) { return jobHasAdv(tab(room, id), 'sixCards') ? HAND_BASE + 1 : HAND_BASE; }

function findInHand(room, id, uid) {
  const h = hand(room, id);
  const idx = h.findIndex(c => c.uid === uid);
  return idx === -1 ? null : { idx, card: h[idx] };
}
function removeFromHand(room, id, uid) {
  const h = hand(room, id);
  const idx = h.findIndex(c => c.uid === uid);
  if (idx === -1) return null;
  return h.splice(idx, 1)[0];
}
function toDiscard(room, c) { room.game.discard.push(c); }

// ---------- Déroulement des tours ----------
function endGame(room, ctx) {
  room.phase = 'finished';
  ctx.addLog(room, '🏁 La pioche est vide — fin de partie ! On compte les smiles.');
}

function advanceTurn(room, ctx) {
  const gm = room.game;
  gm.hasDrawn = false;
  let safety = 0;
  do {
    gm.turnPointer++;
    const id = currentId(room);
    if ((gm.pendingSkips[id] || 0) > 0) {
      gm.pendingSkips[id]--;
      const p = ctx.playerById(room, id);
      if (p) ctx.addLog(room, ctx.dot(room, id) + ctx.escapeHtml(p.name) + ' passe son tour (malus).');
      safety++;
      continue;
    }
    break;
  } while (safety <= room.players.length + 1);
}

function drawFor(room, id, ctx) {
  const gm = room.game;
  if (gm.deck.length === 0) { endGame(room, ctx); return false; }
  const c = gm.deck.pop();
  hand(room, id).push(c);
  return true;
}

// ---------- Légalité + application d'une pose devant soi ----------
function canPlaySelf(room, id, c) {
  const t = tab(room, id);
  switch (c.type) {
    case 'etude': {
      if (hasJob(t) && !jobHasAdv(t, 'canStudyWithJob')) return { ok: false, reason: 'Avoir un métier stoppe les études.' };
      if (t.etudes.length >= MAX_ETUDES) return { ok: false, reason: '6 études maximum.' };
      return { ok: true };
    }
    case 'metier': {
      if (c.requiresProf) {
        if (!(t.metier && t.metier.prof)) return { ok: false, reason: 'Il faut déjà être professeur.' };
        return { ok: true };
      }
      if (hasJob(t)) return { ok: false, reason: 'Un seul métier à la fois (démissionne d\'abord).' };
      if (studyLevel(t) < c.studyReq) return { ok: false, reason: 'Niveau d\'études insuffisant (' + c.studyReq + ' requis).' };
      return { ok: true };
    }
    case 'salaire': {
      if (!hasJob(t)) return { ok: false, reason: 'Il faut un métier pour poser un salaire.' };
      if (c.level > effectiveMaxSalary(t)) return { ok: false, reason: 'Salaire trop élevé pour ce métier (max niv. ' + effectiveMaxSalary(t) + ').' };
      return { ok: true };
    }
    case 'flirt': {
      if (isMarried(t)) return { ok: false, reason: 'Marié : plus de flirt (sauf adultère, non géré).' };
      const unlimited = jobHasAdv(t, 'flirtsUnlimited');
      if (!unlimited && t.flirts.length >= MAX_FLIRTS) return { ok: false, reason: '5 flirts maximum.' };
      return { ok: true };
    }
    case 'mariage': {
      if (isMarried(t)) return { ok: false, reason: 'Déjà marié.' };
      if (t.flirts.length < 1) return { ok: false, reason: 'Il faut au moins un flirt pour se marier.' };
      return { ok: true };
    }
    case 'enfant': {
      if (isMarried(t)) return { ok: true };
      const top = t.flirts[t.flirts.length - 1];
      if (top && top.allowChild && t.enfants.length === 0) return { ok: true };
      return { ok: false, reason: 'Il faut être marié (ou un flirt à l\'hôtel/camping pour un seul enfant).' };
    }
    case 'acquisition': {
      if (c.subtype === 'animal') return { ok: true };
      const price = isMarried(t) ? Math.ceil(c.price / 2) : c.price;
      if (availableMoney(t) < price) return { ok: false, reason: 'Salaires insuffisants (coût ' + price + ').' };
      return { ok: true };
    }
    case 'distinction': {
      if (c.subtype === 'legion') {
        if (t.metier && t.metier.name === 'Bandit') return { ok: false, reason: 'Un bandit ne peut pas recevoir la Légion d\'honneur.' };
        return { ok: true };
      }
      // grand prix
      if (!(t.metier && t.metier.grandPrix)) return { ok: false, reason: 'Réservé à écrivain, chercheur ou journaliste.' };
      if (t.distinctions.some(d => d.subtype === 'grandprix')) return { ok: false, reason: 'Un seul grand prix par métier.' };
      return { ok: true };
    }
    case 'malus': return { ok: false, reason: 'Un malus se pose sur un autre joueur.' };
  }
  return { ok: false, reason: 'Carte non jouable ici.' };
}

// Applique une pose devant soi (déjà validée). Retourne un libellé de log.
function applySelf(room, id, c, ctx) {
  const t = tab(room, id);
  const p = ctx.playerById(room, id);
  const who = ctx.dot(room, id) + ctx.escapeHtml(p.name);
  switch (c.type) {
    case 'etude':
      t.etudes.push(c);
      return who + ' pose ' + (c.double ? 'des études doubles' : 'des études') + ' (niveau total ' + studyLevel(t) + ').';
    case 'metier':
      if (c.requiresProf && t.metier) { toDiscard(room, t.metier); }
      t.metier = c;
      // Chercheur : joue avec 6 cartes → pioche une carte de plus tout de suite.
      if (jobHasAdv(t, 'sixCards')) { if (drawFor(room, id, ctx)) { /* main portée à 6 */ } }
      return who + ' devient ' + ctx.escapeHtml(c.name) + '.';
    case 'salaire':
      t.salaires.push(Object.assign({ invested: false }, c));
      return who + ' pose un salaire de niveau ' + c.level + '.';
    case 'flirt': {
      t.flirts.push(c);
      let extra = '';
      // Vol du dernier flirt (non recouvert) d'un autre joueur au même lieu.
      for (const other of room.players) {
        if (other.clientId === id) continue;
        const ot = tab(room, other.clientId);
        if (!ot || isMarried(ot) || !ot.flirts.length) continue;
        const otop = ot.flirts[ot.flirts.length - 1];
        if (otop.place === c.place) {
          const stolen = ot.flirts.pop();
          t.flirts.push(stolen);
          extra = ' et pique le flirt de ' + ctx.escapeHtml(ctx.playerById(room, other.clientId).name) + ' (' + c.place + ') !';
          break;
        }
      }
      return who + ' flirte (' + c.place + ')' + extra;
    }
    case 'mariage':
      t.mariage = c;
      return who + ' se marie 💍.';
    case 'enfant':
      t.enfants.push(c);
      return who + ' a un enfant : ' + ctx.escapeHtml(c.name) + '.';
    case 'acquisition': {
      if (c.subtype === 'animal') { t.acquisitions.push(c); return who + ' adopte un animal : ' + ctx.escapeHtml(c.name) + '.'; }
      const price = isMarried(t) ? Math.ceil(c.price / 2) : c.price;
      // On « retourne » (investit) des salaires jusqu'à couvrir le prix.
      let paid = 0;
      for (const s of t.salaires) {
        if (paid >= price) break;
        if (!s.invested) { s.invested = true; paid += s.level; }
      }
      t.acquisitions.push(c);
      return who + ' achète ' + ctx.escapeHtml(c.name) + ' (' + c.subtype + ') pour ' + price + '.';
    }
    case 'distinction':
      t.distinctions.push(c);
      if (c.subtype === 'grandprix') return who + ' reçoit un grand prix d\'excellence (salaire porté au niveau 4) 🌟.';
      return who + ' reçoit la Légion d\'honneur 🎖️.';
  }
  return who + ' pose une carte.';
}

// ---------- Malus infligés à un autre joueur ----------
function malusEligibility(room, targetId, c) {
  const t = tab(room, targetId);
  switch (c.subtype) {
    case 'accident':
      if (jobHasAdv(t, 'noAccident')) return { ok: false, reason: 'Garagiste : immunisé contre les accidents.' };
      return { ok: true };
    case 'maladie':
      if (jobHasAdv(t, 'noMaladie')) return { ok: false, reason: 'Immunisé contre la maladie.' };
      return { ok: true };
    case 'burnout':
      if (!hasJob(t)) return { ok: false, reason: 'Cible sans métier.' };
      return { ok: true };
    case 'licenciement':
      if (!hasJob(t)) return { ok: false, reason: 'Cible sans métier.' };
      if (t.metier.status === 'fonctionnaire') return { ok: false, reason: 'Fonctionnaire : pas de licenciement.' };
      if (jobHasAdv(t, 'noLicenciement')) return { ok: false, reason: 'Bandit : pas de licenciement.' };
      return { ok: true };
    case 'impot':
      if (!hasJob(t)) return { ok: false, reason: 'Cible sans métier.' };
      if (jobHasAdv(t, 'noImpot')) return { ok: false, reason: 'Bandit : pas d\'impôt.' };
      if (t.salaires.some(s => !s.invested) === false) return { ok: false, reason: 'Aucun salaire à imposer.' };
      return { ok: true };
    case 'divorce':
      if (!isMarried(t)) return { ok: false, reason: 'Cible non mariée.' };
      if (jobHasAdv(t, 'noDivorce')) return { ok: false, reason: 'Avocat : pas de divorce subi.' };
      return { ok: true };
    case 'redoublement':
      if (hasJob(t) || t.etudes.length === 0) return { ok: false, reason: 'Réservé aux étudiants (études sans métier).' };
      return { ok: true };
  }
  return { ok: false, reason: 'Malus inconnu.' };
}

function applyMalus(room, fromId, targetId, c, ctx) {
  const gm = room.game;
  const t = tab(room, targetId);
  const from = ctx.playerById(room, fromId);
  const target = ctx.playerById(room, targetId);
  const tag = ctx.dot(room, fromId) + ctx.escapeHtml(from.name) + ' → ' + ctx.dot(room, targetId) + ctx.escapeHtml(target.name) + ' : ';
  let effect = '';
  switch (c.subtype) {
    case 'accident': gm.pendingSkips[targetId] = (gm.pendingSkips[targetId] || 0) + 1; effect = 'accident, passe son prochain tour.'; break;
    case 'maladie':  gm.pendingSkips[targetId] = (gm.pendingSkips[targetId] || 0) + 1; effect = 'maladie, passe son prochain tour.'; break;
    case 'burnout':  gm.pendingSkips[targetId] = (gm.pendingSkips[targetId] || 0) + 1; effect = 'burn-out, passe son prochain tour.'; break;
    case 'licenciement': { const j = t.metier; t.metier = null; if (j) toDiscard(room, j); trimHand(room, targetId, ctx); effect = 'licencié, perd son métier.'; break; }
    case 'impot': {
      for (let i = t.salaires.length - 1; i >= 0; i--) { if (!t.salaires[i].invested) { toDiscard(room, t.salaires.splice(i, 1)[0]); break; } }
      effect = 'imposé, perd son dernier salaire.'; break;
    }
    case 'divorce': { const m = t.mariage; t.mariage = null; if (m) toDiscard(room, m); effect = 'divorce, perd son mariage.'; break; }
    case 'redoublement': { const e = t.etudes.pop(); if (e) toDiscard(room, e); effect = 'redouble, perd sa dernière carte études.'; break; }
  }
  t.malus.push(c); // le malus est conservé (face à la cible), sans smile
  ctx.addLog(room, tag + effect);
}

// Après une perte de métier, si le poste chercheur donnait 6 cartes, ramener la main à 5.
function trimHand(room, id, ctx) {
  const lim = handLimit(room, id);
  const h = hand(room, id);
  while (h.length > lim) {
    const c = h.pop();
    toDiscard(room, c);
    const p = ctx.playerById(room, id);
    if (p) ctx.addLog(room, ctx.dot(room, id) + ctx.escapeHtml(p.name) + ' défausse une carte (fin du poste de chercheur).');
  }
}

// ---------- Actions reçues ----------
function actDraw(room, clientId, ctx) {
  const gm = room.game;
  if (currentId(room) !== clientId || gm.hasDrawn) return;
  if (gm.deck.length === 0) { endGame(room, ctx); ctx.broadcast(room); return; }
  drawFor(room, clientId, ctx);
  gm.hasDrawn = true;
  ctx.broadcast(room);
}

function actPlay(room, clientId, msg, ctx) {
  const gm = room.game;
  if (currentId(room) !== clientId || !gm.hasDrawn) return;
  const found = findInHand(room, clientId, msg.cardId);
  if (!found) return;
  const c = found.card;
  const dest = msg.dest;

  if (dest === 'discard') {
    removeFromHand(room, clientId, c.uid);
    toDiscard(room, c);
    const p = ctx.playerById(room, clientId);
    ctx.addLog(room, ctx.dot(room, clientId) + ctx.escapeHtml(p.name) + ' défausse une carte.');
    advanceTurn(room, ctx);
    ctx.broadcast(room);
    return;
  }

  if (dest === 'self') {
    if (c.type === 'malus') return;
    const chk = canPlaySelf(room, clientId, c);
    if (!chk.ok) { ctx.sendError && ctx.sendError(room, clientId, chk.reason); return; }
    removeFromHand(room, clientId, c.uid);
    const log = applySelf(room, clientId, c, ctx);
    ctx.addLog(room, log);
    advanceTurn(room, ctx);
    ctx.broadcast(room);
    return;
  }

  if (dest === 'malus') {
    if (c.type !== 'malus') return;
    const targetId = msg.targetPlayerId;
    if (!targetId || targetId === clientId) return;
    if (!ctx.playerById(room, targetId)) return;
    const chk = malusEligibility(room, targetId, c);
    if (!chk.ok) { ctx.sendError && ctx.sendError(room, clientId, chk.reason); return; }
    removeFromHand(room, clientId, c.uid);
    applyMalus(room, clientId, targetId, c, ctx);
    advanceTurn(room, ctx);
    ctx.broadcast(room);
    return;
  }
}

// Démission : au lieu de piocher, défausser son métier. Intérimaire : reste en
// jeu (peut piocher/poser ensuite) ; sinon on passe le tour.
function actResign(room, clientId, ctx) {
  const gm = room.game;
  if (currentId(room) !== clientId || gm.hasDrawn) return;
  const t = tab(room, clientId);
  if (!hasJob(t)) return;
  const interim = t.metier.status === 'interimaire';
  const j = t.metier; t.metier = null; toDiscard(room, j);
  trimHand(room, clientId, ctx);
  const p = ctx.playerById(room, clientId);
  ctx.addLog(room, ctx.dot(room, clientId) + ctx.escapeHtml(p.name) + ' démissionne' + (interim ? ' (intérimaire) et rejoue.' : ' et passe son tour.'));
  if (!interim) advanceTurn(room, ctx);
  ctx.broadcast(room);
}

// Divorce volontaire : au lieu de piocher, défausser son mariage puis passer.
function actDivorce(room, clientId, ctx) {
  const gm = room.game;
  if (currentId(room) !== clientId || gm.hasDrawn) return;
  const t = tab(room, clientId);
  if (!isMarried(t)) return;
  const m = t.mariage; t.mariage = null; toDiscard(room, m);
  const p = ctx.playerById(room, clientId);
  ctx.addLog(room, ctx.dot(room, clientId) + ctx.escapeHtml(p.name) + ' divorce volontairement et passe son tour.');
  advanceTurn(room, ctx);
  ctx.broadcast(room);
}

// ---------- Scoring ----------
function scoreOf(t) {
  let s = 0;
  const add = arr => arr.forEach(c => { s += (c.smiles || 0); });
  add(t.etudes); if (t.metier) s += t.metier.smiles || 0; add(t.salaires);
  add(t.flirts); if (t.mariage) s += t.mariage.smiles || 0; add(t.enfants);
  add(t.acquisitions); add(t.distinctions);
  return s;
}
function rankings(room, ctx) {
  return room.players
    .map(p => ({ id: p.clientId, name: p.name, color: ctx.colorOf(room, p.clientId), money: scoreOf(tab(room, p.clientId)) }))
    .sort((a, b) => b.money - a.money);
}

// ---------- Sérialisation ----------
function publicTableau(t) {
  return {
    etudes: t.etudes.map(cardView),
    studyLevel: studyLevel(t),
    metier: t.metier ? cardView(t.metier) : null,
    salaires: t.salaires.map(s => Object.assign(cardView(s), { invested: !!s.invested })),
    availableMoney: availableMoney(t),
    maxSalary: effectiveMaxSalary(t),
    flirts: t.flirts.map(cardView),
    mariage: t.mariage ? cardView(t.mariage) : null,
    enfants: t.enfants.map(cardView),
    acquisitions: t.acquisitions.map(cardView),
    distinctions: t.distinctions.map(cardView),
    malus: t.malus.map(cardView),
    score: scoreOf(t),
  };
}
function cardView(c) {
  const v = { uid: c.uid, type: c.type, name: c.name, smiles: c.smiles || 0 };
  if (c.subtype) v.subtype = c.subtype;
  if (c.level != null) v.level = c.level;
  if (c.place) v.place = c.place;
  if (c.allowChild) v.allowChild = true;
  if (c.double) v.double = true;
  if (c.price != null) v.price = c.price;
  if (c.status) v.status = c.status;
  if (c.studyReq != null) v.studyReq = c.studyReq;
  if (c.maxSalary != null) v.maxSalary = c.maxSalary;
  if (c.adv) v.adv = c.adv;
  return v;
}

// Légalité par carte pour le joueur courant (source unique des règles côté
// serveur ; le client n'affiche que ce qui est permis).
function handActions(room, clientId) {
  const gm = room.game;
  const out = {};
  if (!gm || currentId(room) !== clientId || !gm.hasDrawn) return out;
  hand(room, clientId).forEach(c => {
    const info = { self: false, selfReason: '', malus: [] };
    if (c.type === 'malus') {
      room.players.forEach(op => {
        if (op.clientId === clientId) return;
        const e = malusEligibility(room, op.clientId, c);
        info.malus.push({ id: op.clientId, ok: e.ok, reason: e.reason || '' });
      });
    } else {
      const chk = canPlaySelf(room, clientId, c);
      info.self = chk.ok; info.selfReason = chk.reason || '';
    }
    out[c.uid] = info;
  });
  return out;
}

module.exports = {
  id: 'smile-life',
  name: 'Smile Life',
  description: 'Faites votre vie : études, métier, amour, enfants… posez un max de smiles !',
  minPlayers: 2,
  maxPlayers: 5,

  start(room, ctx) {
    const deck = buildDeck();
    const gm = room.game = {
      deck,
      discard: [],
      hands: {},
      tableaux: {},
      turnOrder: room.players.map(p => p.clientId),
      turnPointer: 0,
      hasDrawn: false,
      pendingSkips: {},
    };
    room.players.forEach(p => {
      gm.hands[p.clientId] = [];
      gm.tableaux[p.clientId] = emptyTableau();
      gm.pendingSkips[p.clientId] = 0;
    });
    // Distribution : 5 cartes chacun.
    for (let n = 0; n < HAND_BASE; n++) {
      room.players.forEach(p => { if (deck.length) gm.hands[p.clientId].push(deck.pop()); });
    }
    ctx.addLog(room, '🎉 Nouvelle partie de Smile Life ! Piochez puis posez une carte.');
  },

  action(room, clientId, msg, ctx) {
    switch (msg.type) {
      case 'draw':    return actDraw(room, clientId, ctx);
      case 'play':    return actPlay(room, clientId, msg, ctx);
      case 'resign':  return actResign(room, clientId, ctx);
      case 'divorce': return actDivorce(room, clientId, ctx);
    }
  },

  reset(room) { room.game = null; },
  dispose(room) { /* pas de timer */ },

  removePlayer(room, clientId, ctx) {
    const gm = room.game;
    if (!gm) return;
    const wasCurrent = currentId(room) === clientId;
    const idx = gm.turnOrder.indexOf(clientId);
    gm.turnOrder = gm.turnOrder.filter(x => x !== clientId);
    delete gm.hands[clientId];
    delete gm.tableaux[clientId];
    delete gm.pendingSkips[clientId];
    if (!gm.turnOrder.length) return; // le serveur fermera le salon
    if (idx !== -1 && idx < gm.turnPointer) gm.turnPointer--;
    if (wasCurrent) { gm.hasDrawn = false; if (gm.turnPointer > 0) gm.turnPointer--; advanceTurn(room, ctx); }
  },

  // État PUBLIC (identique pour tous) : tableaux, tour, pioche/défausse, log.
  state(room, ctx) {
    const gm = room.game;
    if (!gm) {
      return { deckCount: 0, discardTop: null, discardCount: 0, currentPlayerId: null, hasDrawn: false, rankings: null, playersState: {} };
    }
    const playersState = {};
    room.players.forEach(p => {
      playersState[p.clientId] = Object.assign(publicTableau(tab(room, p.clientId)), {
        handCount: hand(room, p.clientId).length,
        skips: gm.pendingSkips[p.clientId] || 0,
      });
    });
    return {
      deckCount: gm.deck.length,
      discardCount: gm.discard.length,
      discardTop: gm.discard.length ? cardView(gm.discard[gm.discard.length - 1]) : null,
      currentPlayerId: room.phase === 'playing' ? currentId(room) : null,
      hasDrawn: gm.hasDrawn,
      rankings: room.phase === 'finished' ? rankings(room, ctx) : null,
      playersState,
    };
  },

  // Sur-couche PRIVÉE : la main du joueur destinataire, jamais celle des autres.
  privateState(room, clientId, ctx) {
    const gm = room.game;
    if (!gm) return { myHand: [], myHandLimit: HAND_BASE, myActions: {}, canResign: false, canDivorce: false };
    const isMine = currentId(room) === clientId;
    const t = tab(room, clientId);
    return {
      myHand: hand(room, clientId).map(cardView),
      myHandLimit: handLimit(room, clientId),
      myActions: handActions(room, clientId),
      canResign: isMine && !gm.hasDrawn && hasJob(t),
      canDivorce: isMine && !gm.hasDrawn && isMarried(t),
    };
  },
};
