# 0001 — Noyau géométrique : Open CASCADE via `replicad-opencascadejs`

## Contexte

Le cahier des charges impose un vrai noyau B-Rep (pas un maillage), le calcul local dans le
navigateur et l'échange STEP avec FreeCAD. Il demande d'évaluer OpenCascade.js par un prototype :
créer un solide, retirer un cylindre, exporter en STEP, réimporter.

## Options étudiées (octobre 2026)

| Option | Constat |
| --- | --- |
| `opencascade.js` 1.1.1 (stable) | publiée en 2023, OCCT ancien, ~67 Mo décompressés, API à suffixes `_1`, `_2` |
| `opencascade.js` 2.0.0-beta | non maintenue depuis 2023, build « full » très lourde |
| `occt-import-js` | lecture seule (import) : insuffisant |
| **`replicad-opencascadejs` 1.1.0** (sept. 2026) | build maintenue d'OCCT (chaîne TauCAD/opencascade.js), WASM 23 Mo (7 Mo gzip), surcharges résolues automatiquement, exceptions OCCT lisibles, STEP lecture/écriture, XCAF (noms et couleurs à l'export), booléens avec historique, congés/chanfreins, extracteurs de maillage |

## Décision

Utiliser `replicad-opencascadejs@1.1.0` (version exacte verrouillée), chargé dans un Web Worker.
Seul le dossier `src/geometry/occt/` connaît cette bibliothèque ; le reste du code passe par
l'interface `GeometryKernel` (`src/geometry/kernel.ts`).

## Validation par prototype

- Plaque 60 × 30 × 5 percée Ø 6 : volume 8 858,6283 mm³ (exact), solide valide (BRepCheck).
- Historique : `MakePrism.FirstShape/LastShape/Generated` et `BRepAlgoAPI.Modified/IsDeleted`
  disponibles → références persistantes de faces possibles.
- Export STEP AP214 avec noms et couleurs (XCAF), unités MM ; réimport : volumes identiques.
- **FreeCAD 1.1.4** (AppImage, mode console) ouvre les exports : objets nommés, solides valides,
  volumes et boîtes englobantes exacts (voir `docs/verification-freecad.md`).
- Temps sous Node : chargement du WASM ~150–250 ms, découpe ~10 ms.

## Limites constatées

- Classes non utilisables dans cette build : `NCollection_IndexedMap` (type de base non lié),
  `BRepBuilderAPI_*::Error()`. Contournements : hachage `ReplicadShapeHasher` + `IsSame`,
  `IsDone()`.
- Lecture STEP avec noms (`STEPCAFControl_Reader`) absente : les noms sont lus dans le texte du
  fichier (`stepProductNames`).
- Particularités mémoire documentées dans [0009](0009-memoire-wasm.md).

## Conséquences

Licence LGPL 2.1 (+ exception Open CASCADE) à respecter lors de toute redistribution
(`THIRD_PARTY_NOTICES.md`). Le fichier WASM est séparé et remplaçable. Changer de noyau ne
demanderait qu'une nouvelle implémentation de `GeometryKernel`.
