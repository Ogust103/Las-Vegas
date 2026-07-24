'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');

// ---------- Registre des jeux ----------
// Pour ajouter un jeu : créer games/<id>.js (voir l'interface décrite dans
// games/las-vegas.js) puis l'enregistrer ici.
const GAMES = {};
function registerGame(engine) { GAMES[engine.id] = engine; }
registerGame(require('./games/las-vegas/engine'));
registerGame(require('./games/smile-life/engine'));

const DEFAULT_GAME = 'las-vegas';
function resolveGameType(type) { return GAMES[type] ? type : DEFAULT_GAME; }
function engineOf(room) { return GAMES[room.gameType]; }

// Couleurs de joueur (génériques, attribuées par ordre d'arrivée)
const COLORS = ['#c0392b', '#2980b9', '#27ae60', '#f39c12', '#8e44ad'];

// ---------- Serveur HTTP + statique ----------
const app = express();
app.use(express.static(path.join(__dirname, 'public')));

// Assets client des jeux (view.html, view.js, *.css) — on n'expose JAMAIS le
// code serveur (engine.js).
app.use('/games', (req, res, next) => {
  if (/(^|\/)engine\.js$/.test(req.path)) return res.status(404).end();
  next();
}, express.static(path.join(__dirname, 'games')));

// Liste des jeux disponibles (pour construire le menu côté client)
app.get('/api/games', (req, res) => {
  res.json(Object.values(GAMES).map(g => ({
    id: g.id,
    name: g.name,
    description: g.description || '',
    minPlayers: g.minPlayers,
    maxPlayers: g.maxPlayers,
  })));
});

// État de salons donnés (pour afficher les « parties en cours » du joueur)
app.get('/api/rooms', (req, res) => {
  const ids = String(req.query.ids || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  const out = [];
  ids.forEach(code => {
    const room = rooms.get(code);
    if (room) {
      const engine = engineOf(room);
      out.push({ code, gameType: room.gameType, gameName: engine.name, phase: room.phase, players: room.players.length });
    }
  });
  res.json(out);
});

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

function createRoom(gameType) {
  const code = makeRoomCode();
  const room = {
    code,
    gameType: resolveGameType(gameType),
    phase: 'lobby', // lobby | playing | finished
    players: [],     // {clientId, name, connected, ws} — identité générique
    hostId: null,
    log: [],
    game: null,      // état propre au jeu (géré par le moteur)
  };
  rooms.set(code, room);
  return room;
}

// ---------- Helpers génériques (partagés avec les moteurs via ctx) ----------
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

function sanitizeName(name) {
  const n = String(name || '').trim().slice(0, 20);
  return n || 'Joueur';
}

// envoie un message d'erreur ciblé à un joueur (feedback d'action illégale)
function sendError(room, clientId, message) {
  const p = playerById(room, clientId);
  if (p && p.ws) sendTo(p.ws, { type: 'error', message });
}

// contexte fourni aux moteurs de jeu
const ctx = { escapeHtml, playerById, colorOf, dot, addLog, broadcast, sendError };

// ---------- Sérialisation envoyée aux clients ----------
function publicPlayers(room) {
  return room.players.map((p, i) => ({
    id: p.clientId,
    name: p.name,
    color: COLORS[i],
    connected: p.connected,
    isHost: p.clientId === room.hostId,
  }));
}

function buildState(room) {
  const engine = engineOf(room);
  const envelope = {
    type: 'state',
    phase: room.phase,
    roomCode: room.code,
    gameType: room.gameType,
    gameName: engine.name,
    hostId: room.hostId,
    minPlayers: engine.minPlayers,
    maxPlayers: engine.maxPlayers,
    players: publicPlayers(room),
    log: room.log,
    endNote: room.endNote || null,
  };
  const gameState = engine.state ? engine.state(room, ctx) : {};
  // fusion des données de jeu par joueur (argent, dés, …) dans players
  if (gameState.playersState) {
    envelope.players = envelope.players.map(p => ({ ...p, ...(gameState.playersState[p.id] || {}) }));
    delete gameState.playersState;
  }
  return Object.assign(envelope, gameState);
}

function broadcast(room) {
  const base = buildState(room);
  const engine = engineOf(room);
  // Certains jeux (cartes en main secrètes) diffusent une vue privée par joueur.
  const hasPrivate = engine && typeof engine.privateState === 'function';
  const sharedPayload = hasPrivate ? null : JSON.stringify(base);
  room.players.forEach(p => {
    if (p.connected && p.ws && p.ws.readyState === 1) {
      let payload = sharedPayload;
      if (hasPrivate) {
        const priv = engine.privateState(room, p.clientId, ctx) || {};
        payload = JSON.stringify(Object.assign({}, base, priv));
      }
      try { p.ws.send(payload); } catch (e) { /* ignore */ }
    }
  });
}

function sendTo(ws, obj) {
  if (ws && ws.readyState === 1) {
    try { ws.send(JSON.stringify(obj)); } catch (e) { /* ignore */ }
  }
}

// ---------- Gestion des messages WebSocket ----------
function handleMessage(ws, msg) {
  const type = msg && msg.type;
  const clientId = msg && msg.clientId;
  if (!type || !clientId) return;

  if (type === 'create') {
    const room = createRoom(msg.gameType);
    const p = { clientId, name: sanitizeName(msg.name), connected: true, ws };
    room.players.push(p);
    room.hostId = clientId;
    ws.clientId = clientId;
    ws.roomCode = room.code;
    sendTo(ws, { type: 'joined', roomCode: room.code, clientId, gameType: room.gameType });
    broadcast(room);
    return;
  }

  if (type === 'join') {
    const code = String(msg.roomCode || '').toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) { sendTo(ws, { type: 'error', message: "Ce salon n'existe pas (ou a été fermé)." }); return; }
    const engine = engineOf(room);

    const existing = playerById(room, clientId);
    if (existing) {
      // reconnexion
      existing.ws = ws;
      existing.connected = true;
      if (msg.name) existing.name = sanitizeName(msg.name);
      ws.clientId = clientId;
      ws.roomCode = code;
      sendTo(ws, { type: 'joined', roomCode: code, clientId, gameType: room.gameType });
      broadcast(room);
      return;
    }

    if (room.phase !== 'lobby') { sendTo(ws, { type: 'error', message: 'La partie a déjà commencé.' }); return; }
    if (room.players.length >= engine.maxPlayers) { sendTo(ws, { type: 'error', message: 'Ce salon est complet (' + engine.maxPlayers + ' joueurs max).' }); return; }

    const p = { clientId, name: sanitizeName(msg.name), connected: true, ws };
    room.players.push(p);
    if (!room.hostId) room.hostId = clientId;
    ws.clientId = clientId;
    ws.roomCode = code;
    sendTo(ws, { type: 'joined', roomCode: code, clientId, gameType: room.gameType });
    broadcast(room);
    return;
  }

  // À partir d'ici il faut un salon valide
  const room = rooms.get(ws.roomCode);
  if (!room) return;
  const engine = engineOf(room);

  if (type === 'start') {
    if (clientId !== room.hostId) return;
    if (room.phase !== 'lobby') return;
    if (room.players.length < engine.minPlayers) {
      sendTo(ws, { type: 'error', message: 'Il faut au moins ' + engine.minPlayers + ' joueurs pour commencer.' });
      return;
    }
    room.phase = 'playing';
    room.log = [];
    room.endNote = null;
    engine.start(room, ctx);
    broadcast(room);
    return;
  }

  if (type === 'restart') {
    if (clientId !== room.hostId) return;
    if (engine.reset) engine.reset(room);
    room.phase = 'lobby';
    room.log = [];
    room.endNote = null;
    broadcast(room);
    return;
  }

  if (type === 'leave') {
    const p = playerById(room, clientId);
    const name = p ? p.name : 'Un joueur';
    const wasPlaying = room.phase === 'playing';
    room.players = room.players.filter(x => x.clientId !== clientId);
    if (room.hostId === clientId) room.hostId = room.players.length ? room.players[0].clientId : null;
    ws.roomCode = null;
    if (room.players.length === 0) {
      if (engine.dispose) engine.dispose(room);
      rooms.delete(room.code);
      return;
    }
    if (wasPlaying) {
      if (room.players.length >= engine.minPlayers) {
        // assez de joueurs : la partie continue sans lui
        addLog(room, escapeHtml(name) + ' a abandonné la partie.');
        if (engine.removePlayer) engine.removePlayer(room, clientId, ctx);
      } else {
        // plus assez de joueurs : fin de partie pour les restants
        if (engine.dispose) engine.dispose(room); // stoppe les timers en cours
        room.phase = 'finished';
        room.endNote = escapeHtml(name) + ' a abandonné — plus assez de joueurs, partie terminée.';
      }
    }
    broadcast(room);
    return;
  }

  // toute autre action est déléguée au moteur de jeu
  if (room.phase === 'playing' && engine.action) {
    engine.action(room, clientId, msg, ctx);
  }
}

function handleClose(ws) {
  const room = rooms.get(ws.roomCode);
  if (!room) return;
  const engine = engineOf(room);
  const p = playerById(room, ws.clientId);
  if (!p) return;

  if (room.phase === 'lobby') {
    // En lobby : on retire le joueur
    room.players = room.players.filter(x => x.clientId !== ws.clientId);
    if (room.hostId === ws.clientId) {
      room.hostId = room.players.length ? room.players[0].clientId : null;
    }
    if (room.players.length === 0) {
      if (engine.dispose) engine.dispose(room);
      rooms.delete(room.code);
      return;
    }
  } else {
    // En partie : on garde le slot pour permettre la reconnexion
    p.connected = false;
    p.ws = null;
    if (room.players.every(x => !x.connected)) {
      if (engine.dispose) engine.dispose(room);
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
