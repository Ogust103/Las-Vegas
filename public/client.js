'use strict';

// ---------- Identité persistante (survit aux refresh) ----------
const clientId = (() => {
  let id = localStorage.getItem('lv_clientId');
  if (!id) {
    id = 'c' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem('lv_clientId', id);
  }
  return id;
})();

let ws = null;
let state = null;
let roomCode = null;
let myName = localStorage.getItem('lv_name') || '';
let reconnectTimer = null;

const $ = id => document.getElementById(id);

// ---------- Connexion ----------
function wsUrl() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return proto + '://' + location.host;
}

function send(obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function connect(onOpen) {
  ws = new WebSocket(wsUrl());
  ws.addEventListener('open', () => {
    hideStatus();
    if (onOpen) onOpen();
  });
  ws.addEventListener('message', (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch (err) { return; }
    handleServer(msg);
  });
  ws.addEventListener('close', () => {
    if (roomCode) {
      showStatus('Connexion perdue — reconnexion…');
      scheduleReconnect();
    }
  });
  ws.addEventListener('error', () => { /* close suivra */ });
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect(() => {
      // rejoindre le même salon avec le même clientId
      send({ type: 'join', roomCode, name: myName, clientId });
    });
  }, 1500);
}

// ---------- Actions utilisateur ----------
function createGame() {
  myName = $('homeName').value.trim();
  localStorage.setItem('lv_name', myName);
  connect(() => send({ type: 'create', name: myName, clientId }));
}

function joinGame(code) {
  myName = $('homeName').value.trim();
  localStorage.setItem('lv_name', myName);
  code = (code || $('joinCode').value).toUpperCase().trim();
  if (code.length !== 4) { alert('Entre un code de salon à 4 caractères.'); return; }
  connect(() => send({ type: 'join', roomCode: code, name: myName, clientId }));
}

// ---------- Réception serveur ----------
function handleServer(msg) {
  if (msg.type === 'joined') {
    roomCode = msg.roomCode;
    const url = location.origin + location.pathname + '?room=' + roomCode;
    history.replaceState(null, '', url);
    return;
  }
  if (msg.type === 'error') {
    showStatus(msg.message, true);
    // si on n'est jamais entré dans un salon, rester sur l'accueil
    if (!state) setTimeout(hideStatus, 4000);
    return;
  }
  if (msg.type === 'state') {
    state = msg;
    roomCode = msg.roomCode;
    render();
  }
}

// ---------- Statut de connexion ----------
function showStatus(text, isError) {
  const el = $('conn-status');
  el.textContent = text;
  el.className = 'conn-status' + (isError ? ' error' : '');
  el.style.display = 'block';
}
function hideStatus() { $('conn-status').style.display = 'none'; }

// ---------- Navigation entre écrans ----------
function showScreen(id) {
  ['home-screen', 'lobby-screen', 'game-screen', 'final-screen'].forEach(s => {
    $(s).style.display = (s === id) ? (s === 'game-screen' ? 'flex' : 'block') : 'none';
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

// ---------- Rendu principal ----------
function render() {
  if (!state) return;
  if (state.phase === 'lobby') { showScreen('lobby-screen'); renderLobby(); }
  else if (state.phase === 'finished') { showScreen('final-screen'); renderFinal(); }
  else { showScreen('game-screen'); renderGame(); }
}

function isHost() { return state && state.hostId === clientId; }

// ---------- Lobby ----------
function renderLobby() {
  $('lobbyCode').textContent = state.roomCode;
  const url = location.origin + location.pathname + '?room=' + state.roomCode;
  $('shareLink').value = url;

  $('lobbyPlayers').innerHTML = state.players.map(p => {
    const tags = [];
    if (p.isHost) tags.push('<span class="tag host">hôte</span>');
    if (p.id === clientId) tags.push('<span class="tag you">toi</span>');
    if (!p.connected) tags.push('<span class="tag off">déconnecté</span>');
    return '<div class="lobby-player">' +
      '<span class="dot" style="background:' + p.color + '"></span>' +
      '<span class="lp-name">' + escapeHtml(p.name) + '</span>' +
      tags.join('') +
      '</div>';
  }).join('');

  const startBtn = $('startGameBtn');
  const enough = state.players.length >= state.minPlayers;
  if (isHost()) {
    startBtn.style.display = 'block';
    startBtn.disabled = !enough;
    $('lobbyHint').textContent = enough
      ? state.players.length + ' joueur(s) — tu peux lancer la partie.'
      : 'En attente d\'au moins ' + state.minPlayers + ' joueurs…';
  } else {
    startBtn.style.display = 'none';
    $('lobbyHint').textContent = 'En attente que l\'hôte lance la partie…';
  }
}

// ---------- Jeu ----------
function playerColor(id) {
  const p = state.players.find(x => x.id === id);
  return p ? p.color : '#999';
}

function renderGame() {
  $('roundBadge').textContent = 'Manche ' + state.round + ' / ' + state.totalRounds;
  renderScoreboard();
  renderBoard();
  renderControls();
  renderLog();
}

function renderScoreboard() {
  const el = $('scoreboard');
  const leadMoney = Math.max(0, ...state.players.map(p => p.money));
  el.innerHTML = state.players.map(p => {
    const isActive = p.id === state.currentPlayerId;
    const isLeader = p.money > 0 && p.money === leadMoney;
    const pips = Array.from({ length: state.dicePerPlayer }, (_, d) =>
      '<span class="pip' + (d < p.diceLeft ? ' filled' : '') + '"></span>'
    ).join('');
    return '<div class="score-row' + (isActive ? ' active' : '') + (p.connected ? '' : ' offline') + '" style="--pc:' + p.color + '">' +
      '<div class="score-main">' +
        '<span class="score-name">' +
          '<span class="dot" style="background:' + p.color + '"></span>' +
          escapeHtml(p.name) +
          (isLeader ? '<span class="crown">👑</span>' : '') +
          (isActive ? '<span class="turn-arrow">▶</span>' : '') +
          (p.connected ? '' : '<span class="tag off">⚠</span>') +
        '</span>' +
        '<span class="score-money">' + p.money + ' <small>k$</small></span>' +
      '</div>' +
      '<div class="score-dice" title="' + p.diceLeft + ' dés restants">' + pips + '</div>' +
    '</div>';
  }).join('');
}

function renderBoard() {
  const boardEl = $('board');
  boardEl.innerHTML = '';
  for (let c = 0; c < 6; c++) {
    const div = document.createElement('div');
    div.className = 'casino';

    const num = document.createElement('div');
    num.className = 'num';
    num.textContent = c + 1;
    div.appendChild(num);

    const billsDiv = document.createElement('div');
    billsDiv.className = 'bills';
    (state.casinoBills[c] || []).forEach(b => {
      const bd = document.createElement('div');
      bd.className = 'bill' + (b.takenBy !== null ? ' taken' : '');
      bd.textContent = b.value + ' k$';
      billsDiv.appendChild(bd);
    });
    div.appendChild(billsDiv);

    const diceDiv = document.createElement('div');
    diceDiv.className = 'dice-on-casino';
    (state.boardDice[c] || []).forEach(pid => {
      const d = document.createElement('div');
      d.className = 'die';
      d.style.background = playerColor(pid);
      diceDiv.appendChild(d);
    });
    div.appendChild(diceDiv);

    boardEl.appendChild(div);
  }
}

function renderControls() {
  const banner = $('turnBanner');
  const rollBtn = $('rollBtn');
  const handEl = $('hand');
  const choicesEl = $('choices');

  const myTurn = state.currentPlayerId === clientId;
  const current = state.players.find(p => p.id === state.currentPlayerId);

  // Bannière
  if (state.resolving) {
    banner.innerHTML = 'Décompte de la manche ' + state.round + '…';
  } else if (myTurn) {
    banner.innerHTML = '<span style="color:' + playerColor(clientId) + '">●</span> À toi de jouer ! — dés restants : ' + (current ? current.diceLeft : 0);
  } else if (current) {
    banner.innerHTML = '<span style="color:' + current.color + '">●</span> Au tour de <b>' + escapeHtml(current.name) + '</b> — dés restants : ' + current.diceLeft;
  } else {
    banner.textContent = '';
  }

  // Main (dés lancés) — visible par tout le monde
  if (state.hand && state.hand.length) {
    handEl.innerHTML = state.hand.slice().sort((a, b) => a - b)
      .map(v => '<div class="die">' + v + '</div>').join('');
  } else {
    handEl.innerHTML = '';
  }

  // Bouton lancer
  const canRoll = myTurn && !state.resolving && !state.hand;
  rollBtn.style.display = myTurn && !state.resolving ? 'inline-block' : 'none';
  rollBtn.disabled = !canRoll;

  // Choix de placement
  choicesEl.innerHTML = '';
  if (myTurn && !state.resolving && state.hand && state.hand.length) {
    const counts = {};
    state.hand.forEach(v => { counts[v] = (counts[v] || 0) + 1; });
    Object.keys(counts).sort().forEach(vStr => {
      const v = parseInt(vStr, 10);
      const btn = document.createElement('button');
      btn.className = 'choice-btn secondary';
      btn.textContent = 'Placer ' + counts[v] + '×' + v + ' sur casino ' + v;
      btn.addEventListener('click', () => send({ type: 'place', value: v, clientId }));
      choicesEl.appendChild(btn);
    });
  }
}

function renderLog() {
  $('log').innerHTML = (state.log || []).map(l => '<div>' + l + '</div>').join('');
}

// ---------- Résultats ----------
function renderFinal() {
  const ranked = state.rankings || [];
  const maxMoney = ranked.length ? ranked[0].money : 0;
  $('finalRanks').innerHTML = ranked.map((p, i) =>
    '<div class="rank' + (p.money === maxMoney ? ' win' : '') + '">' +
      '<span><span style="color:' + p.color + '">●</span> ' + (i + 1) + '. ' + escapeHtml(p.name) + '</span>' +
      '<span>' + p.money + ' k$</span>' +
    '</div>'
  ).join('');

  const btn = $('restartBtn');
  if (isHost()) {
    btn.style.display = 'inline-block';
    $('finalHint').textContent = 'Tu peux relancer une partie avec les mêmes joueurs.';
  } else {
    btn.style.display = 'none';
    $('finalHint').textContent = 'En attente que l\'hôte relance une partie…';
  }
}

// ---------- Branchement des boutons ----------
$('createBtn').addEventListener('click', createGame);
$('joinBtn').addEventListener('click', () => joinGame());
$('rollBtn').addEventListener('click', () => send({ type: 'roll', clientId }));
$('startGameBtn').addEventListener('click', () => send({ type: 'start', clientId }));
$('restartBtn').addEventListener('click', () => send({ type: 'restart', clientId }));
$('copyBtn').addEventListener('click', () => {
  const link = $('shareLink');
  link.select();
  navigator.clipboard.writeText(link.value).then(() => {
    $('copyBtn').textContent = 'Copié ✓';
    setTimeout(() => { $('copyBtn').textContent = 'Copier le lien'; }, 1500);
  }).catch(() => { document.execCommand('copy'); });
});
$('joinCode').addEventListener('input', (e) => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});

// ---------- Démarrage : pré-remplissage ----------
(function init() {
  if (myName) $('homeName').value = myName;
  const params = new URLSearchParams(location.search);
  const urlRoom = (params.get('room') || '').toUpperCase().trim();
  if (urlRoom) {
    $('joinCode').value = urlRoom;
    showStatus('Salon ' + urlRoom + ' — entre ton pseudo puis « Rejoindre ».');
  }
  showScreen('home-screen');
})();
