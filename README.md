# Plateforme de jeux en ligne

Une petite **plateforme de jeux multijoueurs en ligne** : on choisit un jeu dans un menu,
on crée un salon, et on joue à distance en partageant un lien. Chaque joueur est sur son
appareil ; l'état est synchronisé en temps réel.

Deux jeux sont disponibles : **Las Vegas** (jeu de dés) et **Smile Life** (jeu de
cartes « faites votre vie »). Le dépôt est conçu pour **accueillir facilement
d'autres jeux** — voir [games/README.md](games/README.md).

La logique est **autoritaire côté serveur** (Node + WebSocket) : chaque joueur n'agit que
pendant son tour, et le serveur valide toutes les actions.

## Fonctionnalités

- 🎮 Menu de sélection de jeu (extensible : un jeu ajouté apparaît tout seul)
- 🌐 Parties en ligne via un lien de partage / un code de salon à 4 caractères
- ⏱️ Synchronisation temps réel (WebSocket) ; les spectateurs suivent en direct
- 🔒 Tours protégés côté serveur (impossible de jouer à la place d'un autre)
- 🔁 Reconnexion automatique (rafraîchissement ou coupure réseau)
- 🕹️ Parties en cours affichées au menu, reprise en un clic ; abandon géré
- 🎨 Thèmes : un thème de base pour le menu, un thème propre à chaque jeu, et un
  thème « VS Code » global (bascule dans le header)
- 📱 Interface responsive (ordinateur, tablette, téléphone)

## Architecture

Le **serveur** est un hôte générique : il gère les salons, le lobby, les connexions et
délègue la logique à un **moteur de jeu** via un registre. Le **front** est une coquille
commune (menu, salon, header, thèmes) qui charge dynamiquement les fichiers d'un jeu.

```
server.js                     Hôte : salons, lobby, WebSocket, registre de jeux, /api/*
package.json                  Dépendances (express, ws)
games/
  README.md                   ← Guide « Ajouter un jeu »
  las-vegas/
    engine.js                 Logique serveur (non exposée au navigateur)
    view.html                 Markup de l'écran de jeu
    view.js                   Module de rendu client
    theme.css                 Thème du jeu (mode normal)
    vscode.css                Rendu du jeu en thème VS Code
public/
  index.html                  Coquille : menu, accueil, salon, résultats, header
  app.js                      Connexion, navigation, thèmes, chargement des jeux
  styles.css                  Thème de BASE (menu) + layout commun
  theme-vscode.css            Thème VS Code (habillage éditeur + écrans communs)
render.yaml                   Déploiement (Render)
```

- **Serveur** : Node.js, Express (statique) et `ws` (WebSocket).
- **Client** : HTML/CSS/JS natif, sans build ni dépendance. Les modules de jeu sont
  chargés à la volée (`fetch` + `import()`) selon le jeu choisi.

## Jouer

1. Choisir un jeu dans le menu.
2. Saisir un pseudo et **créer une partie** (un code + un lien de partage sont générés),
   ou **rejoindre** avec un code.
3. L'hôte **lance la partie** quand tout le monde est là.
4. On joue chacun son tour ; à la fin, le classement s'affiche (l'hôte peut relancer).

Le header propose un menu (retour au menu, abandonner, copier le lien, changer de thème).

### Las Vegas — règles

- 4 manches, 8 dés par joueur.
- Chaque casino (1 à 6) reçoit des billets jusqu'à atteindre au moins 50 k$.
- À son tour, on lance ses dés restants et on place tous les dés d'une même valeur sur le
  casino correspondant.
- Au décompte : sur chaque casino, les joueurs **à égalité de nombre de dés** ne gagnent
  rien ; les autres encaissent les billets (du plus gros au plus petit) par ordre
  décroissant de dés.
- Le plus riche après 4 manches gagne.

### Smile Life — règles (version « cœur jouable »)

- Chacun a **5 cartes en main** (secrètes). À son tour, on **pioche puis on pose
  une carte** : devant soi (pour marquer des *smiles*), en **malus** sur un autre
  joueur, ou à la défausse.
- **Vie pro** : études → métier (selon le niveau d'études) → salaires (selon le
  métier). **Vie perso** : flirts → mariage → enfants. Plus **acquisitions**
  (maisons, voyages, animaux) et **distinctions**.
- On peut **démissionner** (défausser son métier) ou **divorcer** volontairement
  au lieu de piocher.
- **Malus** infligés aux autres : accident, maladie, burn-out, licenciement,
  impôt, divorce, redoublement (certains métiers sont immunisés).
- Le jeu s'arrête **quand la pioche est vide** ; on compte les smiles posés. Le
  plus heureux gagne.
- Écartés de cette première version : cartes spéciales, adultère, prison, attentat.

## Lancer en local

Prérequis : Node.js 18+.

```bash
npm install
npm start
```

Accessible sur http://localhost:3000.

Pour tester à plusieurs sur une même machine, ouvrir **plusieurs onglets** (chaque onglet =
un joueur distinct). Entre appareils du même Wi-Fi, utiliser l'IP locale de l'hôte
(ex. `http://192.168.1.20:3000`).

## Ajouter un jeu

Un jeu = un dossier `games/<id>/` + une ligne d'enregistrement dans `server.js`. Il apparaît
ensuite automatiquement dans le menu. Interface, contrat client, thèmes et checklist :
**[games/README.md](games/README.md)**. Le plus simple est de copier `games/las-vegas/`.

## Déploiement

Fonctionne sur n'importe quel hébergeur Node : commande de démarrage `node server.js`,
port lu depuis `process.env.PORT`. Un `render.yaml` permet un déploiement en un clic sur
[Render](https://render.com) (Web Service, plan gratuit). Railway et Fly.io conviennent aussi.

> ℹ️ Sur les offres gratuites, le serveur se met en veille après une période d'inactivité ;
> le premier accès suivant prend quelques secondes.

## Licence

Projet personnel à but non commercial. *Las Vegas* est une création de Rüdiger Dorn,
éditée par Ravensburger / alea ; ce dépôt en est une adaptation amateur non officielle.
