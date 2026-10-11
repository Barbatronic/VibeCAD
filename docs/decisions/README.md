# Décisions techniques

Chaque fiche décrit un choix, son contexte, les options étudiées et ses conséquences. Les
décisions marquées « provisoire » correspondent aux points laissés ouverts par le cahier des
charges ; elles ont été prises pour ne pas bloquer le développement et peuvent être revues.

| N° | Décision | État |
| --- | --- | --- |
| [0001](0001-noyau-geometrique.md) | Noyau Open CASCADE via `replicad-opencascadejs` | adoptée (validée par prototype) |
| [0002](0002-pile-technique.md) | TypeScript, Vite, Three.js, Preact | adoptée |
| [0003](0003-format-natif.md) | Format natif JSON `.vibecad` versionné | adoptée ; extension provisoire |
| [0004](0004-solveur-esquisse.md) | Solveur de contraintes maison (Newton pondéré) | adoptée |
| [0005](0005-references-persistantes.md) | Références sémantiques de faces et repère canonique | adoptée |
| [0006](0006-licence.md) | Licence MIT pour le code de l'application | provisoire |
| [0007](0007-nom-application.md) | Nom « VibeCAD » (identifiants techniques `vibecad`) | adoptée |
| [0008](0008-stockage-hors-ligne.md) | IndexedDB, fichiers, PWA | adoptée |
| [0009](0009-memoire-wasm.md) | Contournements mémoire d'OCCT en WASM | adoptée (mesurée) |
