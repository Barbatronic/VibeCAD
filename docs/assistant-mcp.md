# Assistant de conception (serveur MCP)

Un assistant IA (Claude Code, Claude Desktop ou tout client MCP) peut piloter le projet ouvert dans
VibeCAD : créer des esquisses cotées (formes exactes, booléens), des extrusions, des perçages, des
congés, copier ou refléter des pièces, régler les paramètres du projet, lire la géométrie, prendre
une capture de la vue et préparer la fabrication (plateaux d'impression, découpe laser). Chaque
action apparaît en direct dans la vue 3D et l'historique, et s'annule avec Ctrl+Z comme une action
faite à la souris.

## Mise en route

1. `npm run dev`, puis ouvrir http://localhost:5173/ dans le navigateur.
2. Dans Claude Code, à la racine du dépôt : le fichier `.mcp.json` déclare le serveur `vibecad`
   (accepter son activation au premier lancement). Son chemin est relatif : lancé depuis un
   sous-dossier, Claude Code ne trouve pas le serveur (mettre alors un chemin absolu dans un
   `.mcp.json` local). Pour un autre client MCP : `node mcp/vibecad-mcp.mjs` (transport stdio ;
   `VIBECAD_URL` si le serveur n'est pas sur le port 5173).
3. Après une modification de `mcp/vibecad-mcp.mjs` (liste ou schémas des outils), reconnecter le
   serveur (`/mcp` dans Claude Code). Une modification de `src/app/mcp-bridge.ts` est prise en
   compte tout de suite.

Le pont n'existe qu'avec le serveur de développement : la version publiée de l'application ne
l'embarque pas.

## Fonctionnement

```text
client MCP ──stdio──► mcp/vibecad-mcp.mjs ──POST /__vibecad_mcp──► plugin Vite
                                                                     │ WebSocket de Vite
                                                                     ▼
                                              onglet VibeCAD : src/app/mcp-bridge.ts
                                              (controller.commit → recalcul → réponse)
```

- `mcp/vibecad-mcp.mjs` : serveur MCP sans dépendance ; décrit les outils et relaie les appels.
- `scripts/vite-plugin-mcp-bridge.ts` : relais HTTP → WebSocket. Seul le dernier onglet ouvert
  ou revenu au premier plan reçoit les appels. Les requêtes venues d'un navigateur (en-tête
  `Origin`) sont refusées.
- `src/app/mcp-bridge.ts` : exécute les outils sur le contrôleur. Les paramètres par défaut d'une
  étape sont ceux de l'interface (`FeatureTool.create`), complétés par ceux de l'assistant puis
  validés (`validateFeature`). Une étape qui finit en erreur est annulée et l'erreur renvoyée.
  Le module se remplace à chaud (`import.meta.hot.accept`) : modifier ce fichier ne recharge pas
  la page et ne fait pas perdre le projet ouvert. Chaque version repose ses écouteurs du WebSocket
  (Vite retire ceux de la version remplacée) ; l'état partagé est gardé dans `globalThis`.
  Les autres fichiers de `src/` rechargent toujours la page : enregistrer le projet avant.
- `src/sketch/boolean2d.ts` : formes 2D exactes (segments et arcs, pas de polygone approché) et
  booléens union / différence / intersection. Un morceau de contour est gardé si la matière du
  résultat n'est que d'un côté de lui ; les bords communs à deux formes sont ainsi traités.
  Testé dans `tests/unit/sketch-boolean2d.test.ts`.

## Outils

| Outil | Rôle |
| --- | --- |
| `get_document` | pièces, historique et statut de chaque étape, volume, encombrement |
| `get_feature` | paramètres complets d'une étape ; repère et points résolus d'une esquisse |
| `list_feature_types` | étapes créables et l'entrée qu'elles attendent |
| `new_part` | nouvelle pièce ; renvoie son `partId` |
| `rename_part` / `delete_part` | renommer une pièce ; supprimer une ou plusieurs pièces |
| `copy_part` | copie indépendante, ou variante symétrique liée (plan XY, XZ ou YZ, elle suit les modifications de l'original) ; `count` + `move` : réseau linéaire ou circulaire de pièces |
| `create_sketch` | esquisse sur un plan ou une face : rectangle (coins arrondis avec `radius`), cercle, segment, polygone (`corner_radius`), polygone régulier, oblong, ellipse, spline, arc, point, texte, contour décalé (`offset`), booléen (`boolean` : union, différence, intersection, imbricables) ; formes simples cotées automatiquement par rapport à l'origine, et contraintes |
| `update_sketch` | changer des cotes (nombre ou équation), ajouter ou supprimer des éléments |
| `add_feature` / `update_feature` | étapes volumiques (extrusion, poche, perçage, révolution, congé, chanfrein, répétition, symétrie, déplacement…) ; `expressions` lie des champs à des paramètres |
| `delete_feature` | supprimer une étape et celles qui en dépendent ; `with_following: true` supprime aussi toute la suite (déplacements compris) |
| `get_parameters` / `set_parameters` | paramètres du projet (valeur ou équation, commentaire) et ce qui les utilise ; créer, modifier, renommer (les équations suivent), supprimer ; tout ce qui est lié est recalculé |
| `batch` | plusieurs outils à la suite comme une seule action annulable ; `"$N.chemin"` reprend le résultat de l'opération N (`"$0.partId"`) ; si une opération échoue, tout le lot est annulé |
| `list_geometry` | faces et arêtes numérotées (normales, extrémités) pour désigner un support ou des arêtes |
| `screenshot` | image de la vue (vue standard au choix) ; la vue est posée sans animation, ce qui marche aussi quand l'onglet est en arrière-plan |
| `export` | fichier STEP (solides exacts, pour FreeCAD) ou STL (impression 3D), en mm, écrit sur disque : `exports/<pièce>.step` par défaut (dossier ignoré par git), ou `path` ; un fichier existant n'est remplacé qu'avec `overwrite: true` |
| `get_print_plates` | impression 3D : taille du plateau, plateaux et leurs pièces, pièces imprimables, disposition calculée (impressions nécessaires, grammes, avertissements) |
| `set_print_plate` | crée (`plate: "new"`), renomme ou vide un plateau ; ajoute, met à jour ou retire des pièces (exemplaires, échelle, face posée par index de `list_geometry`) ; une seule action annulable, puis le plateau s'affiche dans Fabrication |
| `get_laser_layout` | découpe laser : matériaux (épaisseur, plaque, trait de coupe), pièces à découper, disposition calculée (plaque, centre, angle, encombrement de chaque exemplaire), avertissements |
| `set_laser` | exemplaires, face posée, matériau de chaque pièce ; crée ou règle des matériaux ; espace entre pièces, gravure des noms ; `optimize` imbrique au plus serré (action annulable séparée), `reset_placements` revient au rangement par rangées |
| `export_laser` | plaques d'un matériau en SVG ou DXF (1:1, mm), écrites sur disque comme `export` : `exports/<projet> - laser - <matériau>.svg` par défaut |
| `undo` / `redo` | annuler / rétablir |

## Paramétrique

Les paramètres du projet (`set_parameters`) se réutilisent par leur nom dans des équations :

- **cotes d'esquisse** : `width` / `height` d'un rectangle, `diameter` / `radius` d'un cercle,
  `value` d'une contrainte, ou `update_sketch` → `set_values`, par exemple `"largeur/2-marge"` ;
- **champs d'étapes** : `expressions: { distance: "epaisseur*2" }` dans `add_feature` ou
  `update_feature` (extrusion, poche : `distance` ; congé, chanfrein : `size` ; déplacement :
  `tx`, `ty`, `tz` ; répétition : `count`, `spacing`…).

Changer un paramètre recalcule tout ce qui l'utilise ; `get_parameters` liste ces liens. Les formes
exactes (oblong, booléen…) ne prennent pas encore d'équation.
