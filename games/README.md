# Ajouter un jeu

La plateforme est modulaire : un jeu = un dossier `games/<id>/` + une ligne
d'enregistrement dans `server.js`. Une fois enregistré, le jeu apparaît
automatiquement dans le menu (via `/api/games`).

## Fichiers d'un jeu

```
games/<id>/
  engine.js     (obligatoire) logique serveur — JAMAIS servie au navigateur
  view.html     (obligatoire) fragment injecté dans #game-screen
  view.js       (obligatoire) module de rendu client (ES module)
  casino.css    (recommandé)  thème du jeu (mode normal), sous [data-game="<id>"]
  vscode.css    (recommandé)  rendu du jeu en thème VS Code, sous [data-theme="vscode"]
```

Les noms de fichiers sont fixes (la coquille les charge par convention).
`engine.js` est bloqué côté HTTP : le code serveur n'est jamais exposé.

## 1. Le moteur serveur — `engine.js`

```js
module.exports = {
  id: 'mon-jeu',
  name: 'Mon Jeu',
  description: 'Une phrase.',
  minPlayers: 2,
  maxPlayers: 4,

  start(room, ctx) { /* initialiser room.game ; passer en jeu */ },
  action(room, clientId, msg, ctx) { /* actions de jeu (msg.type custom) */ },
  reset(room) { /* retour au lobby (rejouer) — optionnel */ },
  dispose(room) { /* nettoyage (timers) à la fermeture — optionnel */ },
  removePlayer(room, clientId, ctx) { /* abandon en cours de partie — optionnel */ },

  // état propre au jeu, fusionné dans l'état diffusé aux clients
  state(room, ctx) {
    return {
      /* ...ce que le client doit afficher... */
      playersState: { /* [clientId]: { ...données par joueur } */ },
    };
  },
};
```

- **`room`** (fourni par l'hôte) : `{ code, gameType, phase, players:[{clientId,name,connected,ws}], hostId, log:[], game }`.
  Range tout l'état de jeu dans `room.game` (initialisé dans `start`).
- **`ctx`** (utilitaires de l'hôte) : `{ escapeHtml, playerById, colorOf, dot, addLog, broadcast }`.
  Appelle `ctx.broadcast(room)` après chaque changement d'état.
- **`state()`** : renvoie l'état spécifique au jeu. La clé spéciale `playersState`
  (indexée par `clientId`) est fusionnée dans `players` côté client (ex. score, main…).
- L'hôte gère pour toi : salons, lobby, connexions/reconnexions, hôte, abandon,
  fin de partie quand il ne reste plus assez de joueurs.

Enregistre le jeu dans **`server.js`** :

```js
registerGame(require('./games/mon-jeu/engine'));
```

## 2. La vue client — `view.html` + `view.js`

`view.html` = le markup de l'écran de jeu (injecté dans `#game-screen`).

`view.js` = un **module ES** :

```js
let api;
export default {
  init(a) { api = a; /* brancher les écouteurs sur les éléments de view.html */ },
  renderGame(state) { /* (re)dessiner à partir de state */ },
};
```

- **`api`** : `{ $, escapeHtml, send, clientId, getState }`.
  - `api.$('id')` → `getElementById`.
  - `api.send({ type:'...', clientId: api.clientId, ... })` → envoie une action au moteur.
  - `api.getState()` → dernier état reçu (utile dans les écouteurs).
- `renderGame(state)` est appelé à chaque nouvel état. `state` contient :
  `phase, roomCode, gameType, gameName, hostId, minPlayers, maxPlayers,
  players (avec playersState fusionné), log, endNote`, plus tout ce que
  `engine.state()` renvoie.

## 3. Les thèmes (CSS)

- **`casino.css`** : le thème du jeu. Scoper le look « pleine page » sous
  `[data-game="<id>"]` (il s'applique dès la sélection : accueil + salon + jeu),
  et styler les éléments de l'écran de jeu.
- **`vscode.css`** : le rendu du jeu quand le thème VS Code est actif
  (`[data-theme="vscode"]`). La coquille fournit déjà l'habillage éditeur
  (barre de titre, explorateur, barre d'état) ; à toi de styler l'écran de jeu.

Les deux fichiers sont chargés automatiquement quand le jeu est ouvert. S'ils
sont absents, le jeu s'affiche sans style dédié (le thème de base s'applique).

## Checklist

- [ ] `games/<id>/engine.js` implémente l'interface + exporte `id/name/min/maxPlayers`.
- [ ] `registerGame(require('./games/<id>/engine'))` ajouté dans `server.js`.
- [ ] `games/<id>/view.html` (markup) + `games/<id>/view.js` (`{ init, renderGame }`).
- [ ] `games/<id>/casino.css` et `games/<id>/vscode.css` (styles des deux thèmes).
- [ ] Tester : le jeu apparaît dans le menu, une partie se crée/joue/rejoue.

Le plus simple : copier le dossier `games/las-vegas/` comme point de départ.
