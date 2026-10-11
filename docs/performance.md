# Performances et mémoire

Les mesures sont produites par `npm run bench` (fichiers `tests/perf/*.test.ts`) ; les valeurs
brutes sont écrites dans `tests/output/bench.json` et `tests/output/memory.json`.

## Machine de référence

| Élément | Valeur |
| --- | --- |
| Processeur | Intel Core i7-12650H (16 cœurs logiques) |
| Mémoire | 30,5 Go |
| Système | Linux 7.0.0-34-generic (Ubuntu) |
| Exécution des mesures | Node.js v22.22.1 (même WASM que dans le navigateur) |
| Navigateurs des parcours | Chromium (Playwright 1.63) et Firefox 155 (Playwright), Firefox 156 installé |
| Date | 9 octobre 2026, mesures refaites le 10 octobre 2026 (après contraintes, projection, frise, 3MF) et le 11 octobre 2026 (audit) |

## Durées (médianes)

| Opération | Durée | Commentaire |
| --- | --- | --- |
| Chargement du noyau WASM | 140–390 ms | mesuré à 145–158 ms dans Chromium (`initMs`) |
| Plaque percée, recalcul complet à froid (4 étapes) | 16 ms | sans cache (19 ms le 9/10) |
| Plaque percée, largeur modifiée | 10 ms | seules les étapes en aval sont recalculées |
| Maillage d'affichage | 3,8 ms | mis en cache par clé d'étape |
| Export STEP | 3,4 ms | |
| Import STEP (relecture) | 7,2 ms | |
| Résolution de l'esquisse du rectangle coté | 0,08 ms | solveur étendu (nouvelles contraintes) |
| Résolution de 40 rectangles cotés (≈ 320 inconnues) | 5,7 ms | 288 ms avant la décomposition en composantes |
| Pièce de 20 extrusions successives, recalcul à froid | 330 ms | cas chargé, à l'ouverture seulement |

Dans le navigateur, un aller-retour interface → worker → interface pour une modification reste
inférieur à 50 ms. L'interface ne se bloque pas pendant les calculs : ils s'exécutent dans le
worker, et les demandes intermédiaires (aperçu pendant la frappe) sont remplacées par la plus
récente.

## Mémoire

| Mesure | Valeur |
| --- | --- |
| Mémoire WASM au démarrage | 100 Mo |
| Après 100 / 300 recalculs (largeurs différentes) | 100 Mo / 100 Mo |
| Après 1 500 recalculs avec maillage | 127 Mo (stable depuis le recalcul 1 000) |
| Fichier WASM téléchargé | 23 Mo (7,3 Mo compressé gzip) |
| Code de l'interface | 1,09 Mo (0,30 Mo gzip) au 11 octobre 2026 ; worker 0,18 Mo (0,06 Mo gzip) |

Avant correction, la mémoire croissait d'environ 0,37 Mo par recalcul. Les causes (booléens,
mode destructif, vérificateur BRepCheck) et leurs contournements sont décrits dans la
[décision 0009](decisions/0009-memoire-wasm.md) ; le test `tests/perf/memory.test.ts` empêche
toute régression.

## Audit du 11 octobre 2026

Les fonctions ajoutées depuis (répétitions, congés, coque, découpe, mises en plan, vue en coupe,
collisions, import STL, ellipses et splines) sont mesurées par `tests/perf/scenarios.test.ts`
(résultats : `tests/output/scenarios.json`). Le banc de base (`tests/perf/bench.test.ts`) ne
montre aucune dégradation : plaque recalculée en 8 ms après un changement de cote, mémoire stable.

| Scénario | Avant | Après | Cause et correction |
| --- | --- | --- | --- |
| Maillage d'une pièce de 4 000 faces (STL facetté) | 13,7 s | 0,8 s | recherche des arêtes de chaque face en temps quadratique (empreinte recalculée dans le WASM à chaque comparaison) ; table d'empreintes calculée une fois |
| Maillage d'une pièce de 10 000 faces | 83 s | 1,3 s | même correction |
| Plaque + grille de 6 × 3 trous + congé, largeur modifiée | 255 ms | 92 ms | un booléen par exemplaire contre une pièce de plus en plus chargée, plus une analyse complète après chaque trou ; un seul booléen avec tous les exemplaires comme outils |
| Même pièce, recalcul complet à froid | 275 ms | 133 ms | idem |

Autres mesures (médianes, machine de référence) :

| Mesure | Durée |
| --- | --- |
| Maillage d'affichage de la grille de trous | 31 ms |
| Mise en plan de la grille (trois vues, traits cachés) | 35 ms |
| Vue en coupe de la grille | 28 ms |
| Collisions entre deux pièces qui se chevauchent | 160 ms |
| Import STL de 4 000 / 10 000 triangles (lecture, couture, faces planes fusionnées) | 0,7 s / 1,7 s |
| Maillage puis mise en plan de ce STL de 10 000 triangles | 1,3 s puis 0,16 s |

Dans Chromium (version de production, fichiers en cache) : application prête en 0,34 s (noyau
WASM 0,17 s). Le survol d'une pièce coûte 2,4 ms de script par mouvement de souris (0,4 ms dans
le vide), sans mise en page ni recalcul de styles notables ; la rotation de la vue ne déclenche
presque pas de script. Le reste du temps observé dans les tests vient du rendu WebGL logiciel du
navigateur sans écran, pas de l'application.

Pistes restantes, par ordre d'intérêt pour une salle de classe :

1. Premier chargement : le WASM fait 7 Mo compressés ; il est ensuite gardé hors ligne par le
   service worker. Un noyau compilé avec seulement les modules utilisés réduirait ce poids, mais
   c'est un chantier de compilation d'OCCT à part entière.
2. Code de l'interface (0,30 Mo compressé, un seul fichier) : charger à la demande les mises en
   plan (PDF), la découpe laser et les parcours guidés allégerait le démarrage.
3. Pièce de 20 extrusions successives à froid (300 ms) : coût normal des booléens successifs ; il
   ne se paie qu'à l'ouverture, ensuite le cache par étape ne recalcule que l'aval.
4. Import STL : 30 000 triangles au plus, pour que la pièce reste fluide à modifier.

## Reproduire

```bash
npm run bench                 # durées, mémoire et scénarios récents (≈ 1 min)
cat tests/output/bench.json tests/output/scenarios.json
```

Les temps varient selon la charge de la machine ; comparer des médianes.
