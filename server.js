'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');

// ---------- Constantes de jeu ----------
const COLORS = ['#c0392b', '#2980b9', '#27ae60', '#f39c12', '#8e44ad'];
const TOTAL_ROUNDS = 4;
const DICE_PER_PLAYER = 8;
const MAX_PLAYERS = 5;
const MIN_PLAYERS = 2;
const RESOLVE_DELAY_MS = 2800; // pause pour laisser voir le décompte

// ---------- Serveur HTTP + statique ----------
const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('Serveur démarré sur le port ' + PORT);
});

// ---------- État global : les salons ----------
/** roomCode -> room */
const rooms = new Map();

function makeRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans I/O/0/1 ambigus
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms.has(code));
  return code;
}

function createRoom() {
  const code = makeRoomCode();
  const room = {
    code,
    phase: 'lobby', // lobby | playing | finished
    players: [],     // {clientId, name, money, diceLeft, connected, ws}
    hostId: null,
    round: 1,
    startPlayerIndex: 0,
    casinoBills: [], // 6 x [{value, takenBy}]
    boardDice: [],   // 6 x [clientId]
    turnOrder: [],   // [clientId]
    turnPointer: 0,
    hand: null,        // [valeurs] du lancer en cours
    handOwnerId: null,
    resolving: false,
    log: [],
    timer: null,
  };
  rooms.set(code, room);
  return room;
}

// ---------- Helpers ----------
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function playerById(room, id) {
  return room.players.find(p => p.clientId === id) || null;
}

function colorOf(room, id) {
  return COLORS[room.players.findIndex(p => p.clientId === id)] || '#999';
}

function dot(room, id) {
  return '<span style="color:' + colorOf(room, id) + '">●</span> ';
}

function addLog(room, text) {
  room.log.unshift(text);
  if (room.log.length > 40) room.log.pop();
}

function currentPlayerId(room) {
  if (!room.turnOrder.length) return null;
  return room.turnOrder[room.turnPointer % room.turnOrder.length];
}

function allDiceUsed(room) {
  return room.players.every(p => p.diceLeft === 0);
}

// ---------- Sérialisation envoyée aux clients ----------
function publicPlayers(room) {
  return room.players.map((p, i) => ({
    id: p.clientId,
    name: p.name,
    color: COLORS[i],
    money: p.money,
    diceLeft: p.diceLeft,
    connected: p.connected,
    isHost: p.clientId === room.hostId,
  }));
}

function rankings(room) {
  const ranked = room.players
    .map((p, i) => ({ id: p.clientId, name: p.name, color: COLORS[i], money: p.money }))
    .sort((a, b) => b.money - a.money);
  return ranked;
}

function buildState(room) {
  return {
    type: 'state',
    phase: room.phase,
    roomCode: room.code,
    hostId: room.hostId,
    round: room.round,
    totalRounds: TOTAL_ROUNDS,
    dicePerPlayer: DICE_PER_PLAYER,
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    players: publicPlayers(room),
    casinoBills: room.casinoBills,
    boardDice: room.boardDice,
    currentPlayerId: room.phase === 'playing' && !room.resolving ? currentPlayerId(room) : null,
    resolving: room.resolving,
    hand: room.hand,
    handOwnerId: room.handOwnerId,
    log: room.log,
    rankings: room.phase === 'finished' ? rankings(room) : null,
  };
}

function broadcast(room) {
  const payload = JSON.stringify(buildState(room));
  room.players.forEach(p => {
    if (p.connected && p.ws && p.ws.readyState === 1) {
      try { p.ws.send(payload); } catch (e) { /* ignore */ }
    }
  });
}

function sendTo(ws, obj) {
  if (ws && ws.readyState === 1) {
    try { ws.send(JSON.stringify(obj)); } catch (e) { /* ignore */ }
  }
}

// ---------- Logique de jeu ----------
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

function startGame(room) {
  room.phase = 'playing';
  room.round = 1;
  room.startPlayerIndex = 0;
  room.log = [];
  room.players.forEach(p => { p.money = 0; });
  startRound(room);
}

function startRound(room) {
  const deck = shuffledBillDeck();
  room.casinoBills = [];
  for (let c = 0; c < 6; c++) {
    const bills = [];
    let sum = 0;
    while (sum < 50 && deck.length > 0) {
      const v = deck.shift();
      bills.push(v);
      sum += v;
    }
    bills.sort((a, b) => b - a);
    room.casinoBills.push(bills.map(v => ({ value: v, takenBy: null })));
  }
  room.boardDice = [[], [], [], [], [], []];
  room.players.forEach(p => { p.diceLeft = DICE_PER_PLAYER; });
  room.turnOrder = [];
  for (let i = 0; i < room.players.length; i++) {
    room.turnOrder.push(room.players[(room.startPlayerIndex + i) % room.players.length].clientId);
  }
  room.turnPointer = 0;
  room.hand = null;
  room.handOwnerId = null;
  addLog(room, '— Manche ' + room.round + ' —');
  advanceToNextActivePlayer(room, true);
}

function advanceToNextActivePlayer(room, isFirstCall) {
  if (!isFirstCall) room.turnPointer++;
  let safety = 0;
  while (safety < room.players.length + 1) {
    if (allDiceUsed(room)) {
      resolveRound(room);
      return;
    }
    const id = room.turnOrder[room.turnPointer % room.turnOrder.length];
    const p = playerById(room, id);
    if (p && p.diceLeft > 0) {
      room.hand = null;
      room.handOwnerId = null;
      return;
    }
    room.turnPointer++;
    safety++;
  }
}

function handleRoll(room, clientId) {
  if (room.phase !== 'playing' || room.resolving) return;
  if (currentPlayerId(room) !== clientId) return;
  if (room.hand) return;
  const p = playerById(room, clientId);
  if (!p || p.diceLeft <= 0) return;
  const hand = [];
  for (let i = 0; i < p.diceLeft; i++) hand.push(1 + Math.floor(Math.random() * 6));
  room.hand = hand;
  room.handOwnerId = clientId;
  broadcast(room);
}

function handlePlace(room, clientId, value) {
  if (room.phase !== 'playing' || room.resolving) return;
  if (currentPlayerId(room) !== clientId) return;
  if (!room.hand) return;
  value = parseInt(value, 10);
  if (!(value >= 1 && value <= 6)) return;
  const count = room.hand.filter(v => v === value).length;
  if (count === 0) return; // valeur non présente dans le lancer
  const p = playerById(room, clientId);
  for (let i = 0; i < count; i++) room.boardDice[value - 1].push(clientId);
  p.diceLeft -= count;
  addLog(room, dot(room, clientId) + escapeHtml(p.name) + ' place ' + count + ' dé(s) de valeur ' + value + ' sur le casino ' + value + '.');
  room.hand = null;
  room.handOwnerId = null;
  advanceToNextActivePlayer(room, false);
  broadcast(room);
}

function resolveRound(room) {
  room.resolving = true;
  room.hand = null;
  room.handOwnerId = null;

  for (let c = 0; c < 6; c++) {
    const counts = {};
    room.boardDice[c].forEach(id => { counts[id] = (counts[id] || 0) + 1; });
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
      addLog(room, '⚖️ Égalité à ' + cnt + ' dés au casino ' + (c + 1) + ' entre ' +
        group.map(id => escapeHtml(playerById(room, id).name)).join(' et ') +
        ' — ils reprennent leurs dés sans gain.');
    });

    remaining.sort((a, b) => b.cnt - a.cnt);

    const bills = room.casinoBills[c];
    let billPointer = 0;
    remaining.forEach(({ id, cnt }) => {
      const p = playerById(room, id);
      if (billPointer < bills.length) {
        bills[billPointer].takenBy = id;
        p.money += bills[billPointer].value;
        addLog(room, dot(room, id) + escapeHtml(p.name) + ' remporte ' + bills[billPointer].value + ' k$ au casino ' + (c + 1) + ' (' + cnt + ' dés).');
        billPointer++;
      } else {
        addLog(room, dot(room, id) + escapeHtml(p.name) + ' reprend ses dés du casino ' + (c + 1) + ' sans gain (plus de billets disponibles).');
      }
    });
    if (billPointer < bills.length) {
      addLog(room, (bills.length - billPointer) + ' billet(s) restant(s) au casino ' + (c + 1) + ' sont retirés (aucun joueur restant à payer).');
    }
  }

  broadcast(room);

  if (room.timer) clearTimeout(room.timer);
  room.timer = setTimeout(() => {
    room.timer = null;
    room.resolving = false;
    if (room.round >= TOTAL_ROUNDS) {
      room.phase = 'finished';
    } else {
      room.round++;
      room.startPlayerIndex = (room.startPlayerIndex + 1) % room.players.length;
      startRound(room);
    }
    broadcast(room);
  }, RESOLVE_DELAY_MS);
}

// ---------- Gestion des messages WebSocket ----------
function handleMessage(ws, msg) {
  const type = msg && msg.type;
  const clientId = msg && msg.clientId;
  if (!type || !clientId) return;

  if (type === 'create') {
    const room = createRoom();
    const name = sanitizeName(msg.name);
    const p = { clientId, name, money: 0, diceLeft: DICE_PER_PLAYER, connected: true, ws };
    room.players.push(p);
    room.hostId = clientId;
    ws.clientId = clientId;
    ws.roomCode = room.code;
    sendTo(ws, { type: 'joined', roomCode: room.code, clientId });
    broadcast(room);
    return;
  }

  if (type === 'join') {
    const code = String(msg.roomCode || '').toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) { sendTo(ws, { type: 'error', message: "Ce salon n'existe pas (ou a été fermé)." }); return; }

    const existing = playerById(room, clientId);
    if (existing) {
      // reconnexion
      existing.ws = ws;
      existing.connected = true;
      if (msg.name) existing.name = sanitizeName(msg.name);
      ws.clientId = clientId;
      ws.roomCode = code;
      sendTo(ws, { type: 'joined', roomCode: code, clientId });
      broadcast(room);
      return;
    }

    if (room.phase !== 'lobby') { sendTo(ws, { type: 'error', message: 'La partie a déjà commencé.' }); return; }
    if (room.players.length >= MAX_PLAYERS) { sendTo(ws, { type: 'error', message: 'Ce salon est complet (' + MAX_PLAYERS + ' joueurs max).' }); return; }

    const p = { clientId, name: sanitizeName(msg.name), money: 0, diceLeft: DICE_PER_PLAYER, connected: true, ws };
    room.players.push(p);
    if (!room.hostId) room.hostId = clientId;
    ws.clientId = clientId;
    ws.roomCode = code;
    sendTo(ws, { type: 'joined', roomCode: code, clientId });
    broadcast(room);
    return;
  }

  // À partir d'ici il faut un salon valide
  const room = rooms.get(ws.roomCode);
  if (!room) return;

  if (type === 'start') {
    if (clientId !== room.hostId) return;
    if (room.phase !== 'lobby') return;
    if (room.players.length < MIN_PLAYERS) {
      sendTo(ws, { type: 'error', message: 'Il faut au moins ' + MIN_PLAYERS + ' joueurs pour commencer.' });
      return;
    }
    startGame(room);
    broadcast(room);
    return;
  }

  if (type === 'roll') { handleRoll(room, clientId); return; }
  if (type === 'place') { handlePlace(room, clientId, msg.value); return; }

  if (type === 'restart') {
    if (clientId !== room.hostId) return;
    if (room.timer) { clearTimeout(room.timer); room.timer = null; }
    room.phase = 'lobby';
    room.resolving = false;
    room.casinoBills = [];
    room.boardDice = [];
    room.hand = null;
    room.handOwnerId = null;
    room.log = [];
    room.players.forEach(p => { p.money = 0; p.diceLeft = DICE_PER_PLAYER; });
    broadcast(room);
    return;
  }
}

function sanitizeName(name) {
  const n = String(name || '').trim().slice(0, 20);
  return n || 'Joueur';
}

function handleClose(ws) {
  const room = rooms.get(ws.roomCode);
  if (!room) return;
  const p = playerById(room, ws.clientId);
  if (!p) return;

  if (room.phase === 'lobby') {
    // En lobby : on retire le joueur
    room.players = room.players.filter(x => x.clientId !== ws.clientId);
    if (room.hostId === ws.clientId) {
      room.hostId = room.players.length ? room.players[0].clientId : null;
    }
    if (room.players.length === 0) {
      if (room.timer) clearTimeout(room.timer);
      rooms.delete(room.code);
      return;
    }
  } else {
    // En partie : on garde le slot pour permettre la reconnexion
    p.connected = false;
    p.ws = null;
    // Si plus personne n'est connecté, on nettoie le salon
    if (room.players.every(x => !x.connected)) {
      if (room.timer) clearTimeout(room.timer);
      rooms.delete(room.code);
      return;
    }
  }
  broadcast(room);
}

wss.on('connection', (ws) => {
  ws.clientId = null;
  ws.roomCode = null;
  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch (e) { return; }
    try { handleMessage(ws, msg); } catch (e) { console.error('handleMessage error', e); }
  });
  ws.on('close', () => {
    try { handleClose(ws); } catch (e) { console.error('handleClose error', e); }
  });
  ws.on('error', () => { /* ignore */ });
});
