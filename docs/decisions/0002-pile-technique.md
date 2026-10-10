# 0002 — Pile technique : TypeScript, Vite, Three.js, Preact

## Décision

| Rôle | Choix | Version | Raison |
| --- | --- | --- | --- |
| Langage | TypeScript (strict) | 7.0.2 (compilateur natif) | typage du modèle métier et du protocole ; vérification en ~1 s |
| Outil de build | Vite | 8.2.4 | serveur de développement, workers ES, fichiers WASM ; version 8.2.4 = correctif de sécurité du 06/10/2026 rétroporté |
| Vue 3D | Three.js | 0.186.1 | standard ouvert, MIT ; contrôles d'orbite, traits épais, étiquettes HTML |
| Interface | Preact | 10.29.8 | couche UI légère (~4 ko), composants et crochets ; la version 11, trop récente, n'a pas été retenue |
| Tests | Vitest 5.0.1, Playwright 1.63.0 | — | tests unitaires et géométriques sous Node avec le vrai WASM ; parcours navigateur Chromium et Firefox |

Pas de framework d'état : un petit magasin observable (`src/app/store.ts`) suffit. Pas de
bibliothèque de validation : le format natif est validé par un code explicite qui produit des
messages en français ; un schéma JSON publié est vérifié par Ajv dans les tests.

## Versions

Toutes les dépendances sont épinglées à une version exacte et `package-lock.json` est conservé.
Les versions choisies avaient au moins deux semaines au moment du choix, sauf Vite 8.2.4
(correctif de sécurité officiel).

`.npmrc` contient `legacy-peer-deps=true` : la résolution des dépendances pairs *optionnelles* de
Vite/Vitest (outils de développement facultatifs) fait échouer npm 9 et 10 ; toutes les
dépendances requises sont déclarées explicitement.
