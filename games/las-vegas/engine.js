'use strict';

/*
 * Moteur du jeu "Las Vegas".
 *
 * Interface d'un module de jeu (voir server.js) :
 *   { id, name, description, minPlayers, maxPlayers,
 *     start(room, ctx), action(room, clientId, msg, ctx),
 *     reset(room), dispose(room), state(room, ctx) }
 *
 * Le serveur (hôte générique) gère les salons, les connexions, le lobby et les
 * joueurs (identité). Toute la logique propre au jeu vit ici, dans `room.game`.
 * `ctx` fournit des utilitaires de l'hôte : addLog, dot, escapeHtml, colorOf,
 * playerById, broadcast.
 */

const TOTAL_ROUNDS = 4;
const DICE_PER_PLAYER = 8;
const RESOLVE_DELAY_MS = 2800; // pause pour laisser voir le décompte

function shuffledBillDeck() {
  const values = [];
  for (let v = 10; v <= 90; v += 10) {
    for (let copies = 0; copies < 8; copies++) values.push(v);
  }
  for (let i = values.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [values[i], values[j]] = [values[j], values[i]];
  }
  return values;
}

function currentPlayerId(room) {
  const g = room.game;
  if (!g || !g.turnOrder.length) return null;
  return g.turnOrder[g.turnPointer % g.turnOrder.length];
}

function allDiceUsed(room) {
  const g = room.game;
  return room.players.every(p => (g.diceLeft[p.clientId] || 0) === 0);
}

function startRound(room, ctx) {
  const g = room.game;
  const deck = shuffledBillDeck();
  g.casinoBills = [];
  for (let c = 0; c < 6; c++) {
    const bills = [];
    let sum = 0;
    while (sum < 50 && deck.length > 0) {
      const v = deck.shift();
      bills.push(v);
      sum += v;
    }
    bills.sort((a, b) => b - a);
    g.casinoBills.push(bills.map(v => ({ value: v, takenBy: null })));
  }
  g.boardDice = [[], [], [], [], [], []];
  room.players.forEach(p => { g.diceLeft[p.clientId] = DICE_PER_PLAYER; });
  g.turnOrder = [];
  for (let i = 0; i < room.players.length; i++) {
    g.turnOrder.push(room.players[(g.startPlayerIndex + i) % room.players.length].clientId);
  }
  g.turnPointer = 0;
  g.hand = null;
  g.handOwnerId = null;
  ctx.addLog(room, '— Manche ' + g.round + ' —');
  advanceToNextActivePlayer(room, ctx, true);
}

function advanceToNextActivePlayer(room, ctx, isFirstCall) {
  const g = room.game;
  if (!isFirstCall) g.turnPointer++;
  let safety = 0;
  while (safety < room.players.length + 1) {
    if (allDiceUsed(room)) {
      resolveRound(room, ctx);
      return;
    }
    const id = g.turnOrder[g.turnPointer % g.turnOrder.length];
    if ((g.diceLeft[id] || 0) > 0) {
      g.hand = null;
      g.handOwnerId = null;
      return;
    }
    g.turnPointer++;
    safety++;
  }
}

function handleRoll(room, clientId, ctx) {
  const g = room.game;
  if (room.phase !== 'playing' || g.resolving) return;
  if (currentPlayerId(room) !== clientId) return;
  if (g.hand) return;
  const left = g.diceLeft[clientId] || 0;
  if (left <= 0) return;
  const hand = [];
  for (let i = 0; i < left; i++) hand.push(1 + Math.floor(Math.random() * 6));
  g.hand = hand;
  g.handOwnerId = clientId;
  ctx.broadcast(room);
}

function handlePlace(room, clientId, value, ctx) {
  const g = room.game;
  if (room.phase !== 'playing' || g.resolving) return;
  if (currentPlayerId(room) !== clientId) return;
  if (!g.hand) return;
  value = parseInt(value, 10);
  if (!(value >= 1 && value <= 6)) return;
  const count = g.hand.filter(v => v === value).length;
  if (count === 0) return; // valeur non présente dans le lancer
  const p = ctx.playerById(room, clientId);
  for (let i = 0; i < count; i++) g.boardDice[value - 1].push(clientId);
  g.diceLeft[clientId] -= count;
  ctx.addLog(room, ctx.dot(room, clientId) + ctx.escapeHtml(p.name) + ' place ' + count + ' dé(s) de valeur ' + value + ' sur le casino ' + value + '.');
  g.hand = null;
  g.handOwnerId = null;
  advanceToNextActivePlayer(room, ctx, false);
  ctx.broadcast(room);
}

function resolveRound(room, ctx) {
  const g = room.game;
  g.resolving = true;
  g.hand = null;
  g.handOwnerId = null;

  for (let c = 0; c < 6; c++) {
    const counts = {};
    g.boardDice[c].forEach(id => { counts[id] = (counts[id] || 0) + 1; });
    const entries = Object.entries(counts).map(([id, cnt]) => ({ id, cnt }));
    if (entries.length === 0) continue;

    const byCount = {};
    entries.forEach(e => { (byCount[e.cnt] = byCount[e.cnt] || []).push(e.id); });

    const eliminated = [];
    const remaining = [];
    Object.keys(byCount).forEach(cntStr => {
      const cnt = parseInt(cntStr, 10);
      const group = byCount[cnt];
      if (group.length > 1) eliminated.push({ cnt, group });
      else remaining.push({ cnt, id: group[0] });
    });

    eliminated.forEach(({ cnt, group }) => {
      ctx.addLog(room, '⚖️ Égalité à ' + cnt + ' dés au casino ' + (c + 1) + ' entre ' +
        group.map(id => ctx.escapeHtml(ctx.playerById(room, id).name)).join(' et ') +
        ' — ils reprennent leurs dés sans gain.');
    });

    remaining.sort((a, b) => b.cnt - a.cnt);

    const bills = g.casinoBills[c];
    let billPointer = 0;
    remaining.forEach(({ id, cnt }) => {
      const p = ctx.playerById(room, id);
      if (billPointer < bills.length) {
        bills[billPointer].takenBy = id;
        g.money[id] = (g.money[id] || 0) + bills[billPointer].value;
        ctx.addLog(room, ctx.dot(room, id) + ctx.escapeHtml(p.name) + ' remporte ' + bills[billPointer].value + ' k$ au casino ' + (c + 1) + ' (' + cnt + ' dés).');
        billPointer++;
      } else {
        ctx.addLog(room, ctx.dot(room, id) + ctx.escapeHtml(p.name) + ' reprend ses dés du casino ' + (c + 1) + ' sans gain (plus de billets disponibles).');
      }
    });
    if (billPointer < bills.length) {
      ctx.addLog(room, (bills.length - billPointer) + ' billet(s) restant(s) au casino ' + (c + 1) + ' sont retirés (aucun joueur restant à payer).');
    }
  }

  ctx.broadcast(room);

  if (g.timer) clearTimeout(g.timer);
  g.timer = setTimeout(() => {
    g.timer = null;
    g.resolving = false;
    if (g.round >= TOTAL_ROUNDS) {
      room.phase = 'finished';
    } else {
      g.round++;
      g.startPlayerIndex = (g.startPlayerIndex + 1) % room.players.length;
      startRound(room, ctx);
    }
    ctx.broadcast(room);
  }, RESOLVE_DELAY_MS);
}

function rankings(room, ctx) {
  const g = room.game;
  return room.players
    .map(p => ({ id: p.clientId, name: p.name, color: ctx.colorOf(room, p.clientId), money: g.money[p.clientId] || 0 }))
    .sort((a, b) => b.money - a.money);
}

module.exports = {
  id: 'las-vegas',
  name: 'Las Vegas',
  description: 'Misez vos dés sur les casinos et raflez les plus gros billets.',
  minPlayers: 2,
  maxPlayers: 5,

  // Démarrage : initialise l'état de jeu dans room.game
  start(room, ctx) {
    const g = room.game = {
      round: 1,
      startPlayerIndex: 0,
      casinoBills: [],
      boardDice: [],
      turnOrder: [],
      turnPointer: 0,
      hand: null,
      handOwnerId: null,
      resolving: false,
      timer: null,
      money: {},
      diceLeft: {},
    };
    room.players.forEach(p => { g.money[p.clientId] = 0; });
    startRound(room, ctx);
  },

  // Actions de jeu envoyées par un joueur
  action(room, clientId, msg, ctx) {
    if (msg.type === 'roll') return handleRoll(room, clientId, ctx);
    if (msg.type === 'place') return handlePlace(room, clientId, msg.value, ctx);
  },

  // Retour au lobby (rejouer)
  reset(room) {
    if (room.game && room.game.timer) clearTimeout(room.game.timer);
    room.game = null;
  },

  // Nettoyage à la fermeture du salon
  dispose(room) {
    if (room.game && room.game.timer) clearTimeout(room.game.timer);
  },

  // Un joueur abandonne en cours de partie : on le retire du tour et du plateau
  removePlayer(room, clientId, ctx) {
    const g = room.game;
    if (!g) return;
    for (let c = 0; c < 6; c++) g.boardDice[c] = g.boardDice[c].filter(id => id !== clientId);
    delete g.diceLeft[clientId];
    delete g.money[clientId];
    const idx = g.turnOrder.indexOf(clientId);
    g.turnOrder = g.turnOrder.filter(id => id !== clientId);
    if (idx !== -1 && idx < g.turnPointer) g.turnPointer--; // garder le pointeur aligné
    if (!g.turnOrder.length) return; // le serveur supprimera le salon si vide
    g.hand = null;
    g.handOwnerId = null;
    advanceToNextActivePlayer(room, ctx, true);
  },

  // État propre au jeu, fusionné dans l'état diffusé aux clients
  state(room, ctx) {
    const g = room.game;
    if (!g) {
      return {
        round: 1, totalRounds: TOTAL_ROUNDS, dicePerPlayer: DICE_PER_PLAYER,
        casinoBills: [], boardDice: [], currentPlayerId: null, resolving: false,
        hand: null, handOwnerId: null, rankings: null, playersState: {},
      };
    }
    const playersState = {};
    room.players.forEach(p => {
      playersState[p.clientId] = {
        money: g.money[p.clientId] || 0,
        diceLeft: g.diceLeft[p.clientId] || 0,
      };
    });
    return {
      round: g.round,
      totalRounds: TOTAL_ROUNDS,
      dicePerPlayer: DICE_PER_PLAYER,
      casinoBills: g.casinoBills,
      boardDice: g.boardDice,
      currentPlayerId: (room.phase === 'playing' && !g.resolving) ? currentPlayerId(room) : null,
      resolving: g.resolving,
      hand: g.hand,
      handOwnerId: g.handOwnerId,
      rankings: room.phase === 'finished' ? rankings(room, ctx) : null,
      playersState,
    };
  },
};
