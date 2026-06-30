# Las Vegas — en ligne

Jeu de dés *Las Vegas* multijoueur (2 à 5 joueurs), jouable à distance via un lien partagé.
Serveur **Node + WebSocket** : la logique de jeu est autoritaire côté serveur et chaque
joueur ne peut agir que pendant son tour.

## Structure

```
server.js          Serveur HTTP + WebSocket + logique de jeu (salons)
package.json       Dépendances (express, ws)
public/
  index.html       Écrans : accueil, salon, jeu, résultats
  client.js        Connexion WebSocket + rendu piloté par l'état serveur
  styles.css       Styles (responsive mobile inclus)
render.yaml        Déploiement Render (hébergeur gratuit)
```

## Lancer en local

```bash
npm install
npm start
```

Puis ouvre http://localhost:3000.
Pour tester à plusieurs sur le même PC : ouvre plusieurs onglets (chaque onglet est un
joueur distinct car l'identité est stockée par onglet/navigateur). Pour de vrais appareils
différents sur le même Wi-Fi, utilise l'adresse IP locale de la machine, ex.
`http://192.168.1.20:3000`.

## Déployer gratuitement (Render)

1. Pousse ce dossier sur un dépôt GitHub.
2. Sur https://render.com → **New** → **Web Service** → connecte le dépôt.
3. Render détecte `render.yaml` automatiquement (sinon : Build `npm install`,
   Start `node server.js`, plan *Free*).
4. À la fin du déploiement tu obtiens une URL publique du type
   `https://las-vegas-online.onrender.com`.

> Note offre gratuite Render : le service s'endort après ~15 min d'inactivité.
> Le premier accès après une pause prend quelques secondes à se réveiller.

D'autres hébergeurs gratuits fonctionnent aussi (Railway, Fly.io) : il suffit que la
commande de démarrage soit `node server.js` et que le port soit lu via `process.env.PORT`
(déjà géré).

## Comment jouer

1. **Hôte** : saisis ton pseudo → **Créer une partie**. Un code de salon (4 lettres) et un
   lien de partage apparaissent.
2. **Invités** : ouvrent le lien (ou saisissent le code), entrent leur pseudo → **Rejoindre**.
3. L'hôte clique sur **Lancer la partie** quand tout le monde est là (2 à 5 joueurs).
4. À ton tour : **Lancer les dés**, puis place tous les dés d'une même valeur sur le casino
   correspondant. Les autres voient la partie en direct.
5. Après 4 manches, classement final. L'hôte peut **Rejouer** avec les mêmes joueurs.

## Règles (version implémentée)

- 4 manches, 8 dés par joueur.
- Chaque casino (1 à 6) reçoit des billets jusqu'à atteindre au moins 50 k$.
- Au décompte d'une manche : sur chaque casino, les joueurs **à égalité de nombre de dés**
  sont éliminés du paiement de ce casino ; les autres encaissent les billets, du plus gros
  au plus petit, par ordre décroissant de dés.
- Reconnexion automatique : un refresh ou une coupure réseau te ramène dans ta partie.
