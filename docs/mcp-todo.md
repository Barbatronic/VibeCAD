# MCP VibeCAD : ce qui manque

Ces manques ont été relevés en construisant la tour Eiffel (découpe laser) et la voiture (impression 3D) depuis l'assistant. Aujourd'hui, chacun est contourné par un script Python.

## Connexion

- [x] **Serveur MCP qui démarre quel que soit le dossier de lancement.** (contourné : `testMCP/.mcp.json` avec chemin absolu) Le chemin dans `.mcp.json` est relatif, donc le serveur échoue si Claude Code est lancé depuis `testMCP/`. Utiliser un chemin absolu, ou résoudre le chemin depuis l'emplacement du script.

## Outils manquants (du plus rentable au moins rentable)

- [x] **Formes 2D dans une esquisse.** (fait : `rectangle` avec `radius`, `polygon` avec `corner_radius`, `regular_polygon`, `slot`, `ellipse`, `spline`, `offset`, `boolean` union/différence/intersection exacts — `src/sketch/boolean2d.ts`, testé) Restant : arrondir les coins d'un résultat de booléen ; décaler un contour qui contient une spline ou une ellipse.
- [x] **Répétition et symétrie de pièces** : `copy_part` (copie indépendante, variante symétrique liée XY/XZ/YZ, réseau linéaire ou circulaire avec `count` + `move`). Testé : le miroir de la roue avant droite coïncide avec la roue avant gauche. Pour répéter des étapes dans une pièce, `add_feature` pattern / mirror existait déjà.
- [x] **`new_part` qui renvoie l'id de la pièce créée.** Il le renvoyait déjà (`partId`) ; c'est maintenant écrit dans sa description.
- [x] **Supprimer et renommer une pièce** : `delete_part` (une ou plusieurs), `rename_part`.
- [x] **Plusieurs opérations en un seul appel** : `batch` (une seule action annulable, références `$N.chemin`, tout est annulé si une opération échoue). Un premier essai s'est bloqué longtemps avant de s'annuler, non reproduit ensuite ; à surveiller.
- [x] **Supprimer une étape et toute la suite** : `delete_feature` avec `with_following: true`.
- [x] **Paramètres du projet** : `get_parameters`, `set_parameters` ; équations dans les cotes (rectangle, cercle, contraintes, `set_values`) et dans les champs d'étapes (`expressions`). Testé : plaque entièrement contrainte, longueur 60 → 100 et trous liés à l'épaisseur, volumes exacts. Restant : équations dans les formes exactes (slot, boolean…) et dans les positions automatiques.

## Bugs

- [x] **`npm run lint:arch` plantait sous Windows** (pathname d'URL utilisé comme chemin) : corrigé avec `fileURLToPath`.
- [x] **`screenshot` ignorait la vue demandée** : l'animation de caméra n'avance pas dans un onglet en arrière-plan, et `fitAll` repartait de l'ancienne direction. Corrigé dans le pont (vue posée sans animation, en passant par le `viewport` privé du contrôleur). Reste à exposer proprement `animate` dans `controller.setView` (demande un rechargement de la page).

## Fabrication (ajouté dans cette session, à valider)

- [x] `get_print_plates` / `set_print_plate` : plateaux d'impression 3D. Testé sur la voiture : 2 plateaux, 12 pièces, aucun avertissement.
- [x] `get_laser_layout` / `set_laser` / `export_laser` : découpe laser, testés sur la voiture (placement, optimisation sans popup, export SVG).
- [x] `get_print_plates` / `get_laser_layout` : numéro de la face posée (`down_face_index`, `face_index`).
- [x] Rechargement à chaud de `src/app/mcp-bridge.ts` (testé : le projet ouvert reste intact). Les autres fichiers de `src/` rechargent toujours la page : enregistrer le projet avant.
- [x] Mettre à jour `docs/assistant-mcp.md` avec les outils de fabrication.

## Ce qui restera en Python

Les calculs propres à un modèle, comme la disposition des pièces de la tour Eiffel sur la planche ou le profil d'une roue. C'est le travail de conception, pas un manque du MCP.
