# SHOOT2D V3 — Squad Survival

Jeu multijoueur avec personnages humains, tir automatique, salons, classement et comptes JSON.

## Lancer
`npm install` puis `npm start`.

## Render
Root Directory: `ai-arena-v1` ; Build: `npm install` ; Start: `npm start`. Aucune variable DATABASE_URL nécessaire.

## Mode IA
Le bouton « Activer le mode IA » montre un JSON d’état et des commandes cliquables. Dans la console navigateur : `window.shoot2dAI.getState()`, `window.shoot2dAI.move(dx,dy)`, `window.shoot2dAI.dash()`, `window.shoot2dAI.stop()`, `window.shoot2dAI.respawn()`. Une IA doit avoir accès au navigateur pour utiliser ces commandes ; aucune connexion automatique à ChatGPT.

Les données players.json ne sont pas durables sur Render gratuit.
