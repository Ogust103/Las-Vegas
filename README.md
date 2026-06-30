# Las Vegas — en ligne

Adaptation web et multijoueur en ligne du jeu de dés **Las Vegas**. De 2 à 5 joueurs
s'affrontent à distance, chacun sur son appareil, en partageant simplement un lien.

La logique de jeu est **autoritaire côté serveur** (Node + WebSocket) : l'état de la partie
est synchronisé en temps réel et chaque joueur ne peut agir que pendant son propre tour.

## Fonctionnalités

- 🎲 Parties en ligne de 2 à 5 joueurs via un lien de partage
- 🏠 Salons rejoignables par code à 4 caractères
- ⏱️ Synchronisation temps réel (WebSocket) ; les spectateurs suivent la partie en direct
- 🔒 Tours protégés : impossible de jouer à la place d'un autre joueur
- 🔁 Reconnexion automatique après un rafraîchissement ou une coupure réseau
- 📱 Interface responsive (ordinateur, tablette, téléphone)

## Règles du jeu

- 4 manches, 8 dés par joueur.
- Chaque casino (numéroté de 1 à 6) reçoit des billets jusqu'à atteindre au moins 50 k$.
- À son tour, un joueur lance tous ses dés restants, puis choisit une valeur : tous les dés
  de cette valeur sont placés sur le casino correspondant.
- Au décompte d'une manche, sur chaque casino : les joueurs **à égalité de nombre de dés**
  sont éliminés du paiement de ce casino. Les autres encaissent les billets — du plus gros
  au plus petit — par ordre décroissant de nombre de dés.
- Le joueur le plus riche après 4 manches gagne.

## Comment jouer

1. Un joueur saisit son pseudo et **crée une partie** : un code de salon et un lien de
   partage sont générés.
2. Les autres ouvrent le lien (ou saisissent le code), choisissent un pseudo et **rejoignent**.
3. L'hôte **lance la partie** une fois tout le monde présent (2 à 5 joueurs).
4. Chacun joue à son tour : **lancer les dés**, puis placer une valeur sur un casino.
5. Après 4 manches, le classement final s'affiche ; l'hôte peut relancer une partie.

## Stack technique

- **Serveur** : Node.js, Express (fichiers statiques) et `ws` (WebSocket)
- **Client** : HTML/CSS/JavaScript natif, sans dépendance ni build

```
server.js          Serveur HTTP + WebSocket + logique de jeu (salons)
package.json       Dépendances
public/
  index.html       Écrans : accueil, salon, jeu, résultats
  client.js        Connexion WebSocket et rendu piloté par l'état serveur
  styles.css       Styles (responsive inclus)
render.yaml        Configuration de déploiement (Render)
```

## Lancer en local

Prérequis : Node.js 18 ou supérieur.

```bash
npm install
npm start
```

L'application est accessible sur http://localhost:3000.

Pour tester à plusieurs sur une même machine, il suffit d'ouvrir plusieurs onglets. Pour
jouer entre appareils du même réseau Wi-Fi, utilisez l'adresse IP locale de la machine hôte
(par exemple `http://192.168.1.20:3000`).

## Déploiement

Le projet fonctionne sur n'importe quel hébergeur Node. La commande de démarrage est
`node server.js` et le port est lu depuis `process.env.PORT`.

Un fichier `render.yaml` est fourni pour un déploiement en un clic sur
[Render](https://render.com) : créer un **Web Service** à partir du dépôt, le reste est
détecté automatiquement (plan gratuit disponible). Railway et Fly.io conviennent également.

> ℹ️ Sur les offres gratuites, le serveur peut se mettre en veille après une période
> d'inactivité ; le premier accès suivant prend alors quelques secondes.

## Licence

Projet personnel à but non commercial. *Las Vegas* est une création de Rüdiger Dorn,
éditée par Ravensburger / alea ; ce dépôt en est une adaptation amateur non officielle.
