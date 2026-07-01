'use strict';

/*
 * Las Vegas — module de rendu client.
 * Chargé dynamiquement par la coquille (app.js) une fois le fragment view.html
 * injecté dans #game-screen.
 *
 * Interface attendue par la coquille :
 *   export default { init(api), renderGame(state) }
 * `api` fournit : $ (getElementById), escapeHtml, send, clientId, getState.
 */

let api;

function playerColor(state, id) {
  const p = state.players.find(x => x.id === id);
  return p ? p.color : '#999';
}

function renderScoreboard(state) {
  const el = api.$('scoreboard');
  const leadMoney = Math.max(0, ...state.players.map(p => p.money || 0));
  el.innerHTML = state.players.map(p => {
    const isActive = p.id === state.currentPlayerId;
    const isLeader = (p.money || 0) > 0 && p.money === leadMoney;
    const dice = p.diceLeft || 0;
    const pips = Array.from({ length: state.dicePerPlayer }, (_, d) =>
      '<span class="pip' + (d < dice ? ' filled' : '') + '"></span>'
    ).join('');
    const diceWord = dice > 1 ? 'dés' : 'dé';
    const msg = (p.money || 0) + ' k$  ·  ' + dice + ' ' + diceWord;
    return '<div class="score-row' + (isActive ? ' active' : '') + (p.connected ? '' : ' offline') + '" style="--pc:' + p.color + '">' +
      '<div class="score-main">' +
        '<span class="score-name">' +
          '<span class="dot" style="background:' + p.color + '"></span>' +
          api.escapeHtml(p.name) +
          (isLeader ? '<span class="crown">👑</span>' : '') +
          (isActive ? '<span class="turn-arrow">▶</span>' : '') +
          (p.connected ? '' : '<span class="tag off">⚠</span>') +
        '</span>' +
        '<span class="score-money">' + (p.money || 0) + ' <small>k$</small></span>' +
      '</div>' +
      '<div class="score-dice" title="' + dice + ' dés restants">' + pips + '</div>' +
      '<div class="score-msg">' + msg + '</div>' +
    '</div>';
  }).join('');
}

function renderBoard(state) {
  const boardEl = api.$('board');
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
      bd.className = 'bill b' + b.value + (b.takenBy !== null ? ' taken' : '');
      bd.textContent = b.value + ' k$';
      billsDiv.appendChild(bd);
    });
    div.appendChild(billsDiv);

    const diceDiv = document.createElement('div');
    diceDiv.className = 'dice-on-casino';
    (state.boardDice[c] || []).forEach(pid => {
      const d = document.createElement('div');
      d.className = 'die';
      d.style.background = playerColor(state, pid);
      diceDiv.appendChild(d);
    });
    div.appendChild(diceDiv);

    boardEl.appendChild(div);
  }
}

function renderControls(state) {
  const banner = api.$('turnBanner');
  const rollBtn = api.$('rollBtn');
  const handEl = api.$('hand');
  const choicesEl = api.$('choices');

  const myTurn = state.currentPlayerId === api.clientId;
  const current = state.players.find(p => p.id === state.currentPlayerId);

  if (state.resolving) {
    banner.innerHTML = 'Décompte…';
  } else if (myTurn) {
    banner.innerHTML = '<span style="color:' + playerColor(state, api.clientId) + '">●</span> Toi — ' + (current ? current.diceLeft : 0) + ' dés';
  } else if (current) {
    banner.innerHTML = '<span style="color:' + current.color + '">●</span> <b>' + api.escapeHtml(current.name) + '</b> — ' + current.diceLeft + ' dés';
  } else {
    banner.textContent = '';
  }

  // Main (dés lancés) — visible par tout le monde, groupés par valeur
  if (state.hand && state.hand.length) {
    const canPlace = myTurn && !state.resolving;
    const groups = {};
    state.hand.forEach(v => { (groups[v] = groups[v] || []).push(v); });
    handEl.innerHTML = Object.keys(groups).sort((a, b) => a - b).map(vStr => {
      const v = parseInt(vStr, 10);
      const n = groups[v].length;
      const attrs = canPlace
        ? ' class="die-group clickable" data-v="' + v + '" title="Placer ' + n + '×' + v + ' sur le casino ' + v + '"'
        : ' class="die-group"';
      return '<div' + attrs + '>' +
        groups[v].map(() => '<div class="die v' + v + '">' + v + '</div>').join('') +
        '</div>';
    }).join('');
  } else {
    handEl.innerHTML = '';
  }

  const canRoll = myTurn && !state.resolving && !state.hand;
  rollBtn.style.display = myTurn && !state.resolving ? 'inline-block' : 'none';
  rollBtn.disabled = !canRoll;

  choicesEl.innerHTML = '';
  if (myTurn && !state.resolving && state.hand && state.hand.length) {
    const counts = {};
    state.hand.forEach(v => { counts[v] = (counts[v] || 0) + 1; });
    Object.keys(counts).sort().forEach(vStr => {
      const v = parseInt(vStr, 10);
      const btn = document.createElement('button');
      btn.className = 'choice-btn secondary';
      btn.textContent = 'Placer ' + counts[v] + '×' + v + ' sur casino ' + v;
      btn.addEventListener('click', () => api.send({ type: 'place', value: v, clientId: api.clientId }));
      choicesEl.appendChild(btn);
    });
  }
}

function renderLog(state) {
  api.$('log').innerHTML = (state.log || []).map(l => '<div>' + l + '</div>').join('');
}

function attachHandlers() {
  api.$('rollBtn').addEventListener('click', () => api.send({ type: 'roll', clientId: api.clientId }));
  // clic sur un dé (ou son groupe) pour placer tous les dés de cette valeur
  api.$('hand').addEventListener('click', (e) => {
    const group = e.target.closest('.die-group');
    if (!group || !group.classList.contains('clickable')) return;
    const s = api.getState();
    if (!s || s.currentPlayerId !== api.clientId || s.resolving || !s.hand) return;
    const v = parseInt(group.dataset.v, 10);
    if (v >= 1 && v <= 6) api.send({ type: 'place', value: v, clientId: api.clientId });
  });
}

export default {
  init(a) { api = a; attachHandlers(); },
  renderGame(state) {
    api.$('roundBadge').textContent = 'Manche ' + state.round + ' / ' + state.totalRounds;
    renderScoreboard(state);
    renderBoard(state);
    renderControls(state);
    renderLog(state);
  },
};
