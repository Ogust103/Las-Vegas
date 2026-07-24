'use strict';

/*
 * Smile Life — module de rendu client.
 * Chargé dynamiquement par la coquille (app.js) une fois le fragment view.html
 * injecté dans #game-screen.
 *
 * Interface attendue : export default { init(api), renderGame(state) }
 * `api` : $ (getElementById), escapeHtml, send, clientId, getState.
 *
 * La logique et TOUTES les règles vivent côté serveur. Le client se contente
 * d'afficher les tableaux, la main privée (state.myHand) et les actions
 * autorisées (state.myActions) fournies par le moteur.
 */

let api;
let selectedUid = null; // carte de la main sélectionnée (pour choisir l'action)

const STATUS_LABEL = { fonctionnaire: 'fonctionnaire', interimaire: 'intérimaire' };

function esc(s) { return api.escapeHtml(String(s)); }
function playerColor(state, id) { const p = state.players.find(x => x.id === id); return p ? p.color : '#999'; }

function cardMeta(c) {
  switch (c.type) {
    case 'etude': return { icon: '🎓', cls: 'c-etude', sub: c.double ? 'double (2 niv.)' : '1 niveau' };
    case 'metier': return { icon: '💼', cls: 'c-metier', sub: STATUS_LABEL[c.status] || ('études ' + (c.studyReq || 0)) };
    case 'salaire': return { icon: '💶', cls: 'c-salaire', sub: 'niveau ' + c.level + (c.invested ? ' · investi' : '') };
    case 'flirt': return { icon: '💗', cls: 'c-flirt', sub: c.place + (c.allowChild ? ' 👶' : '') };
    case 'mariage': return { icon: '💍', cls: 'c-mariage', sub: '' };
    case 'enfant': return { icon: '👶', cls: 'c-enfant', sub: '' };
    case 'acquisition': return {
      icon: c.subtype === 'animal' ? '🐾' : c.subtype === 'maison' ? '🏠' : '✈️',
      cls: 'c-acq', sub: c.subtype === 'animal' ? 'gratuit' : ('coût ' + c.price),
    };
    case 'distinction': return { icon: c.subtype === 'legion' ? '🎖️' : '🌟', cls: 'c-distinction', sub: '' };
    case 'malus': return { icon: '⚠️', cls: 'c-malus', sub: '' };
  }
  return { icon: '🃏', cls: '', sub: '' };
}

function cardChip(c, opts) {
  opts = opts || {};
  const m = cardMeta(c);
  const cls = ['card-chip', m.cls];
  if (opts.clickable) cls.push('clickable');
  if (opts.selected) cls.push('selected');
  if (c.invested) cls.push('invested');
  const attrs = opts.clickable ? ' data-uid="' + c.uid + '"' : '';
  const sub = (opts.showSub !== false && m.sub) ? '<span class="cc-sub">' + esc(m.sub) + '</span>' : '';
  const smile = c.smiles ? '<span class="cc-smile">😊' + c.smiles + '</span>' : '';
  return '<div class="' + cls.join(' ') + '"' + attrs + ' title="' + esc(c.name) + (m.sub ? ' — ' + esc(m.sub) : '') + '">' +
    '<span class="cc-icon">' + m.icon + '</span>' +
    '<span class="cc-body"><span class="cc-name">' + esc(c.name) + '</span>' + sub + '</span>' +
    smile +
    '</div>';
}

function section(label, cards, extra) {
  if ((!cards || !cards.length) && !extra) return '';
  const chips = (cards || []).map(c => cardChip(c, { showSub: label !== 'Enfants' })).join('');
  return '<div class="tab-section">' +
    '<div class="tab-label">' + label + (extra ? ' <span class="tab-extra">' + extra + '</span>' : '') + '</div>' +
    '<div class="tab-cards">' + chips + '</div>' +
    '</div>';
}

// ---------- Tableaux des joueurs ----------
function renderBoards(state) {
  const el = api.$('boards');
  const lead = Math.max(0, ...state.players.map(p => p.score || 0));
  el.innerHTML = state.players.map(p => {
    const isActive = p.id === state.currentPlayerId;
    const isMe = p.id === api.clientId;
    const isLeader = (p.score || 0) > 0 && p.score === lead;
    const proExtra = p.metier
      ? ('salaire ≤ ' + p.maxSalary + ' · argent dispo ' + (p.availableMoney || 0))
      : ('études niv. ' + (p.studyLevel || 0));

    const pro =
      section('Études', p.etudes, 'niv. ' + (p.studyLevel || 0)) +
      (p.metier ? section('Métier', [p.metier]) : '') +
      section('Salaires', p.salaires, p.metier ? proExtra : '');

    const perso =
      section('Flirts', p.flirts) +
      (p.mariage ? section('Mariage', [p.mariage]) : '') +
      section('Enfants', p.enfants);

    const bonus = section('Acquisitions', p.acquisitions) + section('Distinctions', p.distinctions);
    const malus = section('Malus subis', p.malus);

    const body = (pro || perso || bonus || malus)
      ? (pro + perso + bonus + malus)
      : '<div class="tab-empty">Aucune carte posée pour l\'instant.</div>';

    return '<div class="board' + (isActive ? ' active' : '') + (isMe ? ' me' : '') + (p.connected ? '' : ' offline') + '" style="--pc:' + p.color + '">' +
      '<div class="board-head">' +
        '<span class="bh-name"><span class="dot" style="background:' + p.color + '"></span>' + esc(p.name) +
          (isMe ? ' <span class="tag you">toi</span>' : '') +
          (isLeader ? ' <span class="crown">👑</span>' : '') +
          (isActive ? ' <span class="turn-arrow">▶</span>' : '') +
          ((p.skips || 0) > 0 ? ' <span class="tag skip">⏭ ' + p.skips + '</span>' : '') +
          (p.connected ? '' : ' <span class="tag off">⚠</span>') +
        '</span>' +
        '<span class="bh-score">' + (p.score || 0) + ' <small>😊</small></span>' +
      '</div>' +
      '<div class="board-meta">🃏 ' + (p.handCount || 0) + ' en main</div>' +
      '<div class="board-body">' + body + '</div>' +
      '</div>';
  }).join('');
}

// ---------- Barre latérale : scores compacts (réutilisée en chat VS Code) ----------
function renderScoreboard(state) {
  const el = api.$('scoreboard');
  const lead = Math.max(0, ...state.players.map(p => p.score || 0));
  el.innerHTML = state.players.map(p => {
    const isActive = p.id === state.currentPlayerId;
    const isLeader = (p.score || 0) > 0 && p.score === lead;
    const bits = [];
    if (p.metier) bits.push(esc(p.metier.name)); else bits.push('études niv. ' + (p.studyLevel || 0));
    if (p.mariage) bits.push('marié'); else if (p.flirts && p.flirts.length) bits.push(p.flirts.length + ' flirt(s)');
    if (p.enfants && p.enfants.length) bits.push(p.enfants.length + ' enfant(s)');
    const msg = bits.join(' · ');
    return '<div class="score-row' + (isActive ? ' active' : '') + (p.connected ? '' : ' offline') + '" style="--pc:' + p.color + '">' +
      '<div class="score-main">' +
        '<span class="score-name">' +
          '<span class="dot" style="background:' + p.color + '"></span>' + esc(p.name) +
          (isLeader ? '<span class="crown">👑</span>' : '') +
          (isActive ? '<span class="turn-arrow">▶</span>' : '') +
          (p.connected ? '' : '<span class="tag off">⚠</span>') +
        '</span>' +
        '<span class="score-money">' + (p.score || 0) + ' <small>😊</small></span>' +
      '</div>' +
      '<div class="score-msg">' + msg + '</div>' +
      '</div>';
  }).join('');
}

// ---------- Contrôles (tour, main, actions) ----------
function renderControls(state) {
  const myTurn = state.currentPlayerId === api.clientId;
  const current = state.players.find(p => p.id === state.currentPlayerId);
  const banner = api.$('turnBanner');
  const deckRow = api.$('deckRow');
  const handEl = api.$('hand');
  const handLabel = api.$('handLabel');
  const actionPanel = api.$('actionPanel');
  const turnActions = api.$('turnActions');

  // Bannière de tour
  if (myTurn) {
    banner.innerHTML = '<span style="color:' + playerColor(state, api.clientId) + '">●</span> À toi de jouer' +
      (state.hasDrawn ? ' — pose une carte.' : ' — pioche d\'abord.');
  } else if (current) {
    banner.innerHTML = 'Au tour de <span style="color:' + current.color + '">●</span> <b>' + esc(current.name) + '</b>…';
  } else {
    banner.textContent = '';
  }

  // Ligne pioche / défausse
  const deckBtn = (myTurn && !state.hasDrawn)
    ? '<button id="drawBtn" class="draw-btn">🂠 Piocher</button>'
    : '';
  const deckInfo = '<span class="deck-info">Pioche : <b>' + (state.deckCount || 0) + '</b></span>';
  const discardInfo = state.discardTop
    ? '<span class="deck-info">Défausse (' + (state.discardCount || 0) + ') : ' + cardChip(state.discardTop, { showSub: false }) + '</span>'
    : '<span class="deck-info">Défausse vide</span>';
  deckRow.innerHTML = deckBtn + deckInfo + discardInfo;
  const db = api.$('drawBtn');
  if (db) db.addEventListener('click', () => api.send({ type: 'draw', clientId: api.clientId }));

  // Main privée
  const myHand = state.myHand || [];
  const canAct = myTurn && state.hasDrawn;
  handLabel.textContent = 'Ta main (' + myHand.length + '/' + (state.myHandLimit || 5) + ')';
  handEl.innerHTML = myHand.map(c => cardChip(c, { clickable: canAct, selected: canAct && c.uid === selectedUid })).join('') ||
    '<div class="tab-empty">Main vide.</div>';

  // Panneau d'action pour la carte sélectionnée
  actionPanel.innerHTML = '';
  if (canAct && selectedUid) {
    const c = myHand.find(x => x.uid === selectedUid);
    const info = (state.myActions || {})[selectedUid] || {};
    if (c) actionPanel.appendChild(buildActionPanel(state, c, info));
  }

  // Actions de début de tour : démission / divorce (au lieu de piocher)
  turnActions.innerHTML = '';
  if (myTurn && !state.hasDrawn) {
    if (state.canResign) turnActions.appendChild(mkBtn('secondary', 'Démissionner (défausser le métier)', () => api.send({ type: 'resign', clientId: api.clientId })));
    if (state.canDivorce) turnActions.appendChild(mkBtn('secondary', 'Divorcer (défausser le mariage)', () => api.send({ type: 'divorce', clientId: api.clientId })));
  }
}

function mkBtn(cls, label, onClick) {
  const b = document.createElement('button');
  b.className = 'choice-btn ' + cls;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function buildActionPanel(state, c, info) {
  const wrap = document.createElement('div');
  wrap.className = 'action-inner';
  const meta = cardMeta(c);
  const head = document.createElement('div');
  head.className = 'action-head';
  head.innerHTML = 'Carte : <b>' + meta.icon + ' ' + esc(c.name) + '</b>';
  wrap.appendChild(head);

  const row = document.createElement('div');
  row.className = 'action-btns';

  if (c.type === 'malus') {
    (info.malus || []).forEach(m => {
      const p = state.players.find(x => x.id === m.id);
      if (!p) return;
      const b = mkBtn('danger', '⚠ Infliger à ' + p.name, () => {
        api.send({ type: 'play', cardId: c.uid, dest: 'malus', targetPlayerId: m.id, clientId: api.clientId });
        selectedUid = null;
      });
      if (!m.ok) { b.disabled = true; b.title = m.reason || 'Impossible'; }
      row.appendChild(b);
    });
    if (!(info.malus || []).some(m => m.ok)) {
      const none = document.createElement('div');
      none.className = 'action-note';
      none.textContent = 'Aucune cible valide pour ce malus.';
      row.appendChild(none);
    }
  } else {
    const b = mkBtn('primary', '⬇ Poser devant moi', () => {
      api.send({ type: 'play', cardId: c.uid, dest: 'self', clientId: api.clientId });
      selectedUid = null;
    });
    if (!info.self) { b.disabled = true; b.title = info.selfReason || 'Pose impossible'; }
    row.appendChild(b);
    if (!info.self && info.selfReason) {
      const note = document.createElement('div');
      note.className = 'action-note';
      note.textContent = info.selfReason;
      row.appendChild(note);
    }
  }

  row.appendChild(mkBtn('secondary', '🗑 Défausser', () => {
    api.send({ type: 'play', cardId: c.uid, dest: 'discard', clientId: api.clientId });
    selectedUid = null;
  }));
  row.appendChild(mkBtn('ghost', 'Annuler', () => { selectedUid = null; renderControls(api.getState()); }));

  wrap.appendChild(row);
  return wrap;
}

function renderLog(state) {
  api.$('log').innerHTML = (state.log || []).map(l => '<div>' + l + '</div>').join('');
}

function attachHandlers() {
  api.$('hand').addEventListener('click', (e) => {
    const chip = e.target.closest('.card-chip.clickable');
    if (!chip) return;
    const s = api.getState();
    if (!s || s.currentPlayerId !== api.clientId || !s.hasDrawn) return;
    const uid = chip.dataset.uid;
    selectedUid = (selectedUid === uid) ? null : uid;
    renderControls(s);
  });
}

export default {
  init(a) { api = a; selectedUid = null; attachHandlers(); },
  renderGame(state) {
    // la carte sélectionnée doit toujours exister dans la main
    if (selectedUid && !(state.myHand || []).some(c => c.uid === selectedUid)) selectedUid = null;
    api.$('roundBadge').innerHTML = 'Pioche : <b>' + (state.deckCount || 0) + '</b>';
    renderScoreboard(state);
    renderBoards(state);
    renderControls(state);
    renderLog(state);
  },
};
