# Assistant de conception (serveur MCP)

Un assistant IA (Claude Code, Claude Desktop ou tout client MCP) peut piloter le projet ouvert dans
VibeCAD : créer des esquisses cotées, des extrusions, des perçages, des congés, lire la géométrie
et prendre une capture de la vue. Chaque action apparaît en direct dans la vue 3D et l'historique,
et s'annule avec Ctrl+Z comme une action faite à la souris.

## Mise en route

1. `npm run dev`, puis ouvrir http://localhost:5173/ dans le navigateur.
2. Dans Claude Code, à la racine du dépôt : le fichier `.mcp.json` déclare le serveur `vibecad`
   (accepter son activation au premier lancement). Pour un autre client MCP :
   `node mcp/vibecad-mcp.mjs` (transport stdio ; `VIBECAD_URL` si le serveur n'est pas sur le port 5173).

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

## Outils

| Outil | Rôle |
| --- | --- |
| `get_document` | pièces, historique et statut de chaque étape, volume, encombrement |
| `get_feature` | paramètres complets d'une étape ; repère et points résolus d'une esquisse |
| `list_feature_types` | étapes créables et l'entrée qu'elles attendent |
| `new_part` | nouvelle pièce |
| `create_sketch` | esquisse sur un plan ou une face : rectangle, cercle, segment, polygone, arc, point, texte, cotées automatiquement par rapport à l'origine, et contraintes |
| `update_sketch` | changer des cotes, ajouter ou supprimer des éléments |
| `add_feature` / `update_feature` / `delete_feature` | étapes volumiques (extrusion, poche, perçage, révolution, congé, chanfrein, répétition…) |
| `list_geometry` | faces et arêtes numérotées (normales, extrémités) pour désigner un support ou des arêtes |
| `screenshot` | image de la vue (vue standard au choix) |
| `export` | fichier STEP (solides exacts, pour FreeCAD) ou STL (impression 3D), en mm, écrit sur disque : `exports/<pièce>.step` par défaut (dossier ignoré par git), ou `path` ; un fichier existant n'est remplacé qu'avec `overwrite: true` |
| `get_print_plates` | impression 3D : taille du plateau, plateaux et leurs pièces, pièces imprimables, disposition calculée (impressions nécessaires, grammes, avertissements) |
| `set_print_plate` | crée (`plate: "new"`), renomme ou vide un plateau ; ajoute, met à jour ou retire des pièces (exemplaires, échelle, face posée par index de `list_geometry`) ; une seule action annulable, puis le plateau s'affiche dans Fabrication |
| `get_laser_layout` | découpe laser : matériaux (épaisseur, plaque, trait de coupe), pièces à découper, disposition calculée (plaque, centre, angle, encombrement de chaque exemplaire), avertissements |
| `set_laser` | exemplaires, face posée, matériau de chaque pièce ; crée ou règle des matériaux ; espace entre pièces, gravure des noms ; `optimize` imbrique au plus serré (action annulable séparée), `reset_placements` revient au rangement par rangées |
| `export_laser` | plaques d'un matériau en SVG ou DXF (1:1, mm), écrites sur disque comme `export` : `exports/<projet> - laser - <matériau>.svg` par défaut |
| `undo` / `redo` | annuler / rétablir |
