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
| Date | 9 octobre 2026, mesures refaites le 10 octobre 2026 (après contraintes, projection, frise, 3MF) |

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
| Code de l'interface | 0,82 Mo (0,22 Mo gzip) |

Avant correction, la mémoire croissait d'environ 0,37 Mo par recalcul. Les causes (booléens,
mode destructif, vérificateur BRepCheck) et leurs contournements sont décrits dans la
[décision 0009](decisions/0009-memoire-wasm.md) ; le test `tests/perf/memory.test.ts` empêche
toute régression.

## Reproduire

```bash
npm run bench                 # durées et mémoire (≈ 1 min)
cat tests/output/bench.json
```

Les temps varient selon la charge de la machine ; comparer des médianes.
