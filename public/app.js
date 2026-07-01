'use strict';

/*
 * Coquille commune (multi-jeux) : identité, connexion WebSocket, menu, écrans
 * accueil/salon/résultats, thème, et chargement dynamique du module d'un jeu
 * (view.html + view.js + CSS) depuis games/<id>/.
 */

// ---------- Identité du joueur ----------
// sessionStorage = une identité par onglet : plusieurs onglets d'un même
// navigateur = plusieurs joueurs (utile pour tester), et le rafraîchissement
// d'un onglet conserve l'identité (donc la reconnexion fonctionne toujours).
const clientId = (() => {
  let id = sessionStorage.getItem('lv_clientId');
  if (!id) {
    id = 'c' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    sessionStorage.setItem('lv_clientId', id);
  }
  return id;
})();

let ws = null;
let state = null;
let roomCode = null;
let myName = localStorage.getItem('lv_name') || '';
let reconnectTimer = null;
let selectedGame = 'las-vegas';
let activeGameId = null; // jeu reflété dans le chrome (explorateur/onglet/titre)

const $ = id => document.getElementById(id);

const FALLBACK_GAMES = [
  { id: 'las-vegas', name: 'Las Vegas', description: 'Misez vos dés sur les casinos et raflez les plus gros billets.', minPlayers: 2, maxPlayers: 5 },
];
let gamesList = FALLBACK_GAMES.slice();

// ---------- Parties en cours (mémorisées par onglet, comme l'identité) ----------
function savedRooms() { try { return JSON.parse(sessionStorage.getItem('lv_rooms') || '[]'); } catch (e) { return []; } }
function setSavedRooms(list) { try { sessionStorage.setItem('lv_rooms', JSON.stringify(list)); } catch (e) { /* ignore */ } }
function saveRoom(code) { if (!code) return; const l = savedRooms(); if (!l.includes(code)) { l.push(code); setSavedRooms(l); } }
function removeRoom(code) { setSavedRooms(savedRooms().filter(c => c !== code)); }

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

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
  ws.addEventListener('open', () => { hideStatus(); if (onOpen) onOpen(); });
  ws.addEventListener('message', (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch (err) { return; }
    handleServer(msg);
  });
  ws.addEventListener('close', () => {
    if (roomCode) { showStatus('Connexion perdue — reconnexion…'); scheduleReconnect(); }
  });
  ws.addEventListener('error', () => { /* close suivra */ });
}
function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect(() => send({ type: 'join', roomCode, name: myName, clientId }));
  }, 1500);
}

// ---------- Chargement dynamique du module d'un jeu ----------
let loadedGameType = null;
let gameModule = null;
let gameLoading = null;
const gameApi = { $, escapeHtml, send, clientId, getState: () => state };

function injectCss(href) {
  if (document.querySelector('link[data-game-css="' + href + '"]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = href;
  l.setAttribute('data-game-css', href);
  document.head.appendChild(l);
}

function ensureGameLoaded(gameType) {
  if (!gameType || loadedGameType === gameType) return Promise.resolve();
  if (gameLoading) return gameLoading;
  gameLoading = (async () => {
    injectCss('/games/' + gameType + '/casino.css');
    injectCss('/games/' + gameType + '/vscode.css');
    const html = await fetch('/games/' + gameType + '/view.html').then(r => r.text());
    $('game-screen').innerHTML = html;
    const mod = await import('/games/' + gameType + '/view.js');
    gameModule = mod.default || mod;
    if (gameModule.init) gameModule.init(gameApi);
    loadedGameType = gameType;
    gameLoading = null;
    render();
  })();
  gameLoading.catch(() => { gameLoading = null; });
  return gameLoading;
}

// ---------- Chrome VS Code partagé (explorateur / onglet / titre) ----------
function renderChrome() {
  // explorateur : les jeux listés dans un dossier games/
  const files = gamesList.map(g =>
    '<div class="vsc-row vsc-file game-file' + (g.id === activeGameId ? ' active' : '') + '" data-game="' + g.id + '" style="padding-left:40px">' +
      '<span class="fi js">JS</span>' + escapeHtml(g.name) +
    '</div>'
  ).join('');
  $('vscTree').innerHTML =
    '<div class="vsc-row vsc-folder open">▾ PARTIES-EN-LIGNE</div>' +
    '<div class="vsc-row vsc-folder open" style="padding-left:24px">▾ games</div>' +
    files;

  const g = gamesList.find(x => x.id === activeGameId);
  $('vscTabs').innerHTML = g
    ? '<div class="vsc-tab active"><span class="fi js">JS</span>' + escapeHtml(g.name) + '<span class="vsc-close">×</span></div>'
    : '<div class="vsc-tab active">Accueil<span class="vsc-close">×</span></div>';
  $('vscTitle').textContent = (g ? g.name : 'Parties en ligne') + ' — Visual Studio Code';
}

// ---------- Menu : choix du jeu ----------
function renderGames(games) {
  $('gameList').innerHTML = games.map(g =>
    '<button class="game-tile" data-game="' + g.id + '">' +
      '<div class="gt-name">' + escapeHtml(g.name) + '</div>' +
      '<div class="gt-desc">' + escapeHtml(g.description || '') + '</div>' +
      '<div class="gt-meta">' + g.minPlayers + '–' + g.maxPlayers + ' joueurs</div>' +
    '</button>'
  ).join('');
}
function loadGames() {
  fetch('/api/games')
    .then(r => r.ok ? r.json() : Promise.reject())
    .then(games => { gamesList = (games && games.length) ? games : FALLBACK_GAMES; })
    .catch(() => { gamesList = FALLBACK_GAMES; })
    .then(() => { renderGames(gamesList); renderChrome(); });
}
function selectGame(id, name) {
  selectedGame = id;
  activeGameId = id;
  applyGameAttr(); // le thème du jeu s'applique dès la sélection
  const g = gamesList.find(x => x.id === id);
  $('homeGameTitle').textContent = (g && g.name) || name || id;
  renderChrome();
  ensureGameLoaded(id); // préchargement
  showScreen('home-screen');
}

// parties en cours affichées sous les jeux dans le menu
function renderMenuRooms() {
  const saved = savedRooms();
  if (!saved.length) { $('menuRooms').style.display = 'none'; return; }
  fetch('/api/rooms?ids=' + encodeURIComponent(saved.join(',')))
    .then(r => r.ok ? r.json() : [])
    .then(rooms => {
      const active = rooms.filter(r => r.phase !== 'finished');
      setSavedRooms(active.map(r => r.code)); // on oublie les salons disparus/terminés
      if (!active.length) { $('menuRooms').style.display = 'none'; return; }
      $('roomList').innerHTML = active.map(r =>
        '<button class="game-tile room-tile" data-code="' + r.code + '">' +
          '<div class="gt-name">' + escapeHtml(r.gameName) + '</div>' +
          '<div class="gt-desc">Salon ' + r.code + ' · ' + r.players + ' joueur(s) · ' + (r.phase === 'lobby' ? 'en attente' : 'en cours') + '</div>' +
          '<div class="gt-meta">Reprendre ▸</div>' +
        '</button>'
      ).join('');
      $('menuRooms').style.display = 'block';
    })
    .catch(() => { $('menuRooms').style.display = 'none'; });
}
function rejoinRoom(code) {
  if (!myName) myName = ($('homeName').value || '').trim();
  connect(() => send({ type: 'join', roomCode: code, name: myName, clientId }));
}

// ---------- Actions utilisateur ----------
function createGame() {
  myName = $('homeName').value.trim();
  localStorage.setItem('lv_name', myName);
  connect(() => send({ type: 'create', name: myName, clientId, gameType: selectedGame }));
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
    saveRoom(roomCode);
    history.replaceState(null, '', location.origin + location.pathname + '?room=' + roomCode);
    if (msg.gameType) ensureGameLoaded(msg.gameType);
    return;
  }
  if (msg.type === 'error') {
    showStatus(msg.message, true);
    if (!state) setTimeout(hideStatus, 4000);
    return;
  }
  if (msg.type === 'state') {
    state = msg;
    roomCode = msg.roomCode;
    if (msg.phase === 'finished') removeRoom(msg.roomCode); // plus « en cours »
    if (msg.gameType && msg.gameType !== activeGameId) { activeGameId = msg.gameType; renderChrome(); }
    applyGameAttr();
    ensureGameLoaded(msg.gameType);
    render();
  }
}

// ---------- Statut ----------
function showStatus(text, isError) {
  const el = $('conn-status');
  el.textContent = text;
  el.className = 'conn-status' + (isError ? ' error' : '');
  el.style.display = 'block';
}
function hideStatus() { $('conn-status').style.display = 'none'; }

// ---------- Navigation entre écrans ----------
function showScreen(id) {
  ['menu-screen', 'home-screen', 'lobby-screen', 'game-screen', 'final-screen'].forEach(s => {
    $(s).style.display = (s === id) ? (s === 'game-screen' ? 'flex' : 'block') : 'none';
  });
  // le retour au menu (thème casino) n'a pas de sens sur l'écran menu lui-même
  $('toMenuBtn').style.display = (id === 'menu-screen') ? 'none' : 'block';
}

function isHost() { return state && state.hostId === clientId; }

// ---------- Retour au menu (quitte le salon courant, garde la partie rejoignable) ----------
function returnToMenu() {
  roomCode = null;            // avant close() pour éviter la reconnexion auto
  if (ws) { try { ws.close(); } catch (e) { /* ignore */ } ws = null; }
  state = null;
  activeGameId = null;
  applyGameAttr(); // retire le thème du jeu → thème de base sur le menu
  history.replaceState(null, '', location.origin + location.pathname);
  hideStatus();
  renderChrome();
  showScreen('menu-screen');
  renderMenuRooms();
}

// ---------- Abandon (on quitte définitivement le salon) ----------
function abandonGame() {
  const code = roomCode;
  if (code && ws && ws.readyState === 1) send({ type: 'leave', clientId });
  if (code) removeRoom(code);
  returnToMenu();
}
function copyRoomLink() {
  if (!roomCode) return;
  const url = location.origin + location.pathname + '?room=' + roomCode;
  navigator.clipboard.writeText(url)
    .then(() => { showStatus('Lien du salon copié.'); setTimeout(hideStatus, 1500); })
    .catch(() => { /* ignore */ });
}

// ---------- Menu déroulant du header ----------
let headerMenuActions = [];
function headerMenuItems() {
  const inRoom = !!state;
  const items = [{ label: '🏠 Retour au menu', action: returnToMenu }];
  if (inRoom) items.push({ label: '🏳️ Abandonner la partie', action: abandonGame });
  if (inRoom) items.push({ label: '🔗 Copier le lien du salon', action: copyRoomLink });
  items.push({ label: '🎨 Changer de thème', action: () => applyTheme(currentTheme() === 'vscode' ? 'casino' : 'vscode') });
  return items;
}
function headerMenuIsOpen() { return $('headerMenu').style.display === 'block'; }
function closeHeaderMenu() { $('headerMenu').style.display = 'none'; }
function openHeaderMenu(trigger) {
  const items = headerMenuItems();
  headerMenuActions = items.map(it => it.action);
  const hm = $('headerMenu');
  hm.innerHTML = items.map((it, i) => '<div class="header-menu-item" data-i="' + i + '">' + it.label + '</div>').join('');
  const r = trigger.getBoundingClientRect();
  hm.style.display = 'block';
  hm.style.top = (r.bottom + 4) + 'px';
  hm.style.left = Math.max(6, r.left) + 'px';
}

// ---------- Rendu principal ----------
function render() {
  if (!state) return;
  if (state.phase === 'lobby') { showScreen('lobby-screen'); renderLobby(); }
  else if (state.phase === 'finished') { showScreen('final-screen'); renderFinal(); }
  else {
    // en jeu : on délègue au module du jeu (chargé dynamiquement)
    if (!gameModule) { ensureGameLoaded(state.gameType); return; }
    showScreen('game-screen');
    gameModule.renderGame(state, gameApi);
  }
}

// ---------- Salon ----------
function renderLobby() {
  $('lobbyCode').textContent = state.roomCode;
  $('shareLink').value = location.origin + location.pathname + '?room=' + state.roomCode;
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

// ---------- Résultats (générique) ----------
function renderFinal() {
  const note = $('finalNote');
  if (state.endNote) { note.textContent = '⚠ ' + state.endNote; note.style.display = 'block'; }
  else { note.style.display = 'none'; }
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

// ---------- Branchement des boutons (coquille) ----------
$('gameList').addEventListener('click', (e) => {
  const tile = e.target.closest('.game-tile');
  if (!tile) return;
  selectGame(tile.dataset.game, tile.querySelector('.gt-name').textContent);
});
$('backToMenu').addEventListener('click', returnToMenu);
$('toMenuBtn').addEventListener('click', (e) => { e.stopPropagation(); headerMenuIsOpen() ? closeHeaderMenu() : openHeaderMenu($('toMenuBtn')); });
$('vscMenuHome').addEventListener('click', (e) => { e.stopPropagation(); headerMenuIsOpen() ? closeHeaderMenu() : openHeaderMenu($('vscMenuHome')); });
$('headerMenu').addEventListener('click', (e) => {
  const it = e.target.closest('.header-menu-item');
  if (!it) return;
  const action = headerMenuActions[+it.dataset.i];
  closeHeaderMenu();
  if (action) action();
});
$('roomList').addEventListener('click', (e) => {
  const t = e.target.closest('.room-tile');
  if (t) rejoinRoom(t.dataset.code);
});
document.addEventListener('click', (e) => {
  if (headerMenuIsOpen() && !e.target.closest('#headerMenu') && !e.target.closest('#toMenuBtn') && !e.target.closest('#vscMenuHome')) closeHeaderMenu();
});
// clic sur un jeu dans l'explorateur de gauche (chrome VS Code)
$('vscTree').addEventListener('click', (e) => {
  const row = e.target.closest('.game-file');
  if (!row) return;
  const g = gamesList.find(x => x.id === row.dataset.game);
  selectGame(row.dataset.game, g && g.name);
});
$('createBtn').addEventListener('click', createGame);
$('joinBtn').addEventListener('click', () => joinGame());
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

// ---------- Thème (casino / VS Code) ----------
function currentTheme() {
  return document.documentElement.getAttribute('data-theme') || 'base';
}
// applique le thème du jeu actif (data-game) — sauf en mode VS Code (qui prime)
function applyGameAttr() {
  const el = document.documentElement;
  if (currentTheme() === 'vscode' || !activeGameId) el.removeAttribute('data-game');
  else el.setAttribute('data-game', activeGameId);
}
function applyTheme(theme) {
  if (theme === 'vscode') document.documentElement.setAttribute('data-theme', 'vscode');
  else document.documentElement.removeAttribute('data-theme');
  try { localStorage.setItem('lv_theme', theme); } catch (e) { /* ignore */ }
  $('themeToggle').textContent = theme === 'vscode' ? '🎨 Thème normal' : '🖥️ VS Code';
  applyGameAttr();
}
$('themeToggle').addEventListener('click', () => {
  applyTheme(currentTheme() === 'vscode' ? 'casino' : 'vscode');
});
applyTheme(currentTheme());

// ---------- Démarrage ----------
(function init() {
  if (myName) $('homeName').value = myName;
  renderChrome();
  loadGames();
  const params = new URLSearchParams(location.search);
  const urlRoom = (params.get('room') || '').toUpperCase().trim();
  if (urlRoom) {
    $('joinCode').value = urlRoom;
    showStatus('Salon ' + urlRoom + ' — entre ton pseudo puis « Rejoindre ».');
    showScreen('home-screen');
  } else {
    showScreen('menu-screen');
    renderMenuRooms();
  }
})();
