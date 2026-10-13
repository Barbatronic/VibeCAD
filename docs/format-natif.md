# Format natif `.vibecad` (version de schéma 1)

Le format natif enregistre **tout le projet** : pièces, historique de construction, esquisses,
contraintes, cotes, paramètres, dépendances, unités, noms, couleurs, et le contenu des fichiers
importés. C'est un fichier **JSON UTF-8** lisible, indenté, sans dépendance à un logiciel
particulier. Le schéma formel est dans [`vibecad.schema.json`](vibecad.schema.json)
(JSON Schema 2020-12).

- Extension : `.vibecad` (définitive depuis le 12 octobre 2026, définie dans
  `src/io/native-format.ts`) — à ne pas confondre avec STEP (`.step`) ni avec FreeCAD (`.FCStd`).
- **Format gelé** : le schéma 1 est stable (voir « Stabilité du format » plus bas).
- Type MIME proposé : `application/vnd.vibecad+json`.
- Aucun objet du noyau géométrique n'est enregistré : la géométrie est reconstruite à
  l'ouverture. L'**état de validité** des étapes (erreurs, avertissements) est recalculé lui
  aussi ; il n'est pas stocké.

## Enveloppe

```json
{
  "format": "vibecad",
  "schemaVersion": 1,
  "generator": { "name": "VibeCAD", "version": "0.1.0" },
  "savedAt": "2026-10-09T12:00:00.000Z",
  "document": { "…": "voir ci-dessous" }
}
```

| Champ | Rôle |
| --- | --- |
| `format` | toujours `"vibecad"` : identifie le fichier |
| `schemaVersion` | version du schéma (entier). Un fichier plus récent que l'application est refusé avec un message clair ; un fichier plus ancien est migré |
| `generator` | logiciel et version qui ont écrit le fichier (informatif) |
| `savedAt` | date d'enregistrement (ISO 8601) |
| `document` | le projet |

## Document

```json
{
  "id": "doc-k3x9q2m1",
  "name": "Plaque percée",
  "units": "mm",
  "createdAt": "2026-10-09T11:40:00.000Z",
  "modifiedAt": "2026-10-09T12:00:00.000Z",
  "parts": [ { "…": "pièces" } ],
  "resources": { "res-a1b2c3d4": { "…": "contenu des fichiers importés" } }
}
```

`units` vaut toujours `"mm"` en version 1 : toutes les longueurs du fichier sont en millimètres.

## Pièce

```json
{
  "id": "part-7h2k1m0p",
  "name": "Pièce 1",
  "color": "#4f86c6",
  "visible": true,
  "features": [ { "…": "étapes de l'historique, dans l'ordre" } ]
}
```

## Fonctions (étapes de l'historique)

Chaque fonction a un identifiant stable (`id`), un `type`, un `name`, des paramètres typés
(`params`) et la liste de ses dépendances (`dependsOn`, identifiants des étapes utilisées).
`dependsOn` est **déduit des paramètres** : il est écrit pour rendre le fichier lisible et
recalculé à l'ouverture.

### Esquisse (`"type": "sketch"`)

```json
{
  "id": "sk-9f8e7d6c",
  "type": "sketch",
  "name": "Esquisse 2",
  "visible": false,
  "dependsOn": ["ex-1a2b3c4d"],
  "params": {
    "support": { "kind": "face", "ref": { "featureId": "ex-1a2b3c4d", "role": "end" } },
    "entities": [
      { "id": "p1", "type": "point", "x": 15, "y": 15 },
      { "id": "c1", "type": "circle", "center": "p1", "radius": 3 }
    ],
    "constraints": [
      { "id": "k1", "type": "diameter", "circle": "c1", "value": 6 },
      { "id": "k2", "type": "distanceX", "a": "origin", "b": "p1", "value": 15 },
      { "id": "k3", "type": "distanceY", "a": "origin", "b": "p1", "value": 15 }
    ]
  }
}
```

**Support** :

| `kind` | Champs | Sens |
| --- | --- | --- |
| `plane` | `plane` : `XY`, `XZ` ou `YZ` ; `offset` (mm) | plan d'origine (décalé le long de sa normale). XY : vu de dessus (normale +Z) ; XZ : vu de face (normale −Y) ; YZ : vu de droite (normale +X), comme FreeCAD |
| `face` | `ref` : `{ featureId, role, entityId?, index? }` | face plane désignée par une **référence sémantique** : `end` / `start` (faces d'arrivée / de départ d'une extrusion ou d'une poche), `side` + `entityId` (face latérale engendrée par cet élément d'esquisse ; des segments alignés ou des arcs d'un même cercle qui se suivent donnent une seule face, désignée par chacun d'eux), `imported` + `index` (face d'un solide importé), `blend` + `index` (face créée par un congé ou un chanfrein) |

**Éléments** (`entities`), coordonnées en mm dans le repère de l'esquisse :

| `type` | Champs |
| --- | --- |
| `point` | `x`, `y` |
| `line` | `a`, `b` : identifiants de ses points d'extrémité |
| `circle` | `center` : identifiant du point centre ; `radius` |
| `arc` | `center`, `start`, `end` : points ; l'arc va de `start` à `end` dans le sens trigonométrique. Le rayon est la distance centre–départ ; le solveur maintient l'arrivée à la même distance. Les cotes `radius` / `diameter` acceptent un arc dans leur champ `circle` |
| `ellipse` | `center`, `major` : points (centre, bout du grand axe : rayon et orientation) ; `minorRadius` : demi-axe perpendiculaire. Les cotes `radius` / `diameter` visent alors le petit axe ; le grand axe se cote par une distance entre `center` et `major` |
| `spline` | `points` : au moins deux points par lesquels passe la courbe ; `closed` : fermée ou non. Courbe de Catmull-Rom uniforme, enregistrée comme une suite de courbes de Bézier cubiques (extrémités d'une spline ouverte : tangente naturelle). Une spline ouverte relie ses deux extrémités dans un contour, comme un segment |

Segments et cercles acceptent deux champs facultatifs :

- `"construction": true` : trait de construction (repère), ignoré pour former le contour ;
- `"reference": { "edge": { "faces": [faceRef, faceRef] } }` : arête de la pièce **projetée**
  dans l'esquisse. Ses points et son rayon sont fixes pour le solveur et recalculés à chaque
  reconstruction à partir de l'arête désignée (état de la pièce juste avant l'esquisse) ; les
  coordonnées enregistrées sont la dernière projection. Une arête introuvable garde sa position
  et l'esquisse passe en avertissement `REFERENCE_LOST`. L'esquisse dépend (`dependsOn`) des
  étapes qui ont créé ces faces.

Les coordonnées enregistrées sont celles **résolues** par le solveur ; à l'ouverture, l'esquisse
est résolue à nouveau à partir des contraintes. L'identifiant réservé `"origin"` désigne
l'origine fixe (0, 0) de l'esquisse.

**Contraintes** (`constraints`) :

| `type` | Champs | Équation |
| --- | --- | --- |
| `coincident` | `a`, `b` (points) | les deux points sont confondus |
| `horizontal` / `vertical` | `line` | le segment est horizontal / vertical |
| `length` | `line`, `value` | longueur du segment |
| `distance` | `a`, `b`, `value` | distance alignée entre deux points |
| `distanceX` | `a`, `b`, `value` | x(b) − x(a) = value (≥ 0) |
| `distanceY` | `a`, `b`, `value` | y(b) − y(a) = value (≥ 0) |
| `diameter` / `radius` | `circle`, `value` | diamètre / rayon du cercle |
| `parallel` / `perpendicular` | `a`, `b` (segments) | directions parallèles / perpendiculaires |
| `collinear` | `a`, `b` (segments) | sur une même droite |
| `equal` | `a`, `b` (deux segments ou deux cercles) | même longueur / même rayon |
| `tangent` | `a` (segment ou cercle), `b` (cercle), `internal?` | tangence ; `internal` : un cercle dans l'autre |
| `pointOn` | `point`, `curve` (segment ou cercle) | le point est sur la droite portant le segment, ou sur le cercle |
| `midpoint` | `point`, `line` | le point est au milieu du segment |
| `angle` | `a`, `b` (segments), `value` (degrés, 0–180), `supplementary?` | angle entre les directions des segments (de leur premier point vers le second) ; `supplementary` retourne la direction de `b` |
| `pointLineDistance` | `point`, `line`, `value` | distance du point à la droite portant le segment |

Les cotes peuvent porter des champs facultatifs de **placement d'affichage**, choisis en faisant
glisser leur libellé (sans effet géométrique) : `offset` (mm) — décalage latéral de la ligne de
cote (longueur, distance alignée), position par rapport au milieu des deux points (distance
horizontale / verticale), longueur du repère au-delà du cercle (diamètre, rayon), rayon de l'arc
(angle) ou glissement le long du segment (distance point-segment) ; `labelAngle` (degrés) —
direction du libellé d'un diamètre ou d'un rayon. Sans ces champs, le placement est automatique.

### Extrusion (`"type": "extrude"`)

```json
{ "id": "ex-1a2b3c4d", "type": "extrude", "name": "Extrusion 1", "dependsOn": ["sk-…"],
  "params": { "sketchId": "sk-…", "distance": 5, "direction": "default" } }
```

`direction` : `default` (du côté de la normale de l'esquisse), `reversed`, `symmetric` ou
`twoSides` (`distance` du côté de la normale, `distance2` de l'autre côté).
`upTo` (facultatif, faceRef) : l'extrusion part de l'esquisse et s'arrête sur le plan de cette face
plane de la pièce (même inclinée), du côté où elle se trouve ; `distance` et `direction` sont alors
ignorées. La face d'arrivée garde le rôle `end`. Erreurs : `EXTRUDE_FACE_LOST` (face disparue ou
courbe), `EXTRUDE_FACE_PARALLEL` (plan parallèle à la direction d'extrusion), `EXTRUDE_FACE_MISSED`
(face dans le plan de l'esquisse).

### Poche (`"type": "pocket"`)

```json
{ "id": "po-…", "type": "pocket", "name": "Poche 1", "dependsOn": ["sk-…"],
  "params": { "sketchId": "sk-…", "extent": { "kind": "throughAll" }, "direction": "default" } }
```

`extent` : `{ "kind": "distance", "distance": 3 }` ou `{ "kind": "throughAll" }` (traversante).
`direction` : `default` (contre la normale, c'est-à-dire dans la matière sous une face),
`reversed`, `symmetric` ou `twoSides` : `extent` vaut alors pour le côté « dans la matière » (contre
la normale) et `extent2` (même forme, facultatif ailleurs) pour l'autre côté.

### Congé (`"type": "fillet"`) et chanfrein (`"type": "chamfer"`)

```json
{ "id": "fi-…", "type": "fillet", "name": "Congé 1", "dependsOn": ["ex-1a2b3c4d"],
  "params": {
    "edges": [
      { "faces": [ { "featureId": "ex-1a2b3c4d", "role": "end" },
                   { "featureId": "ex-1a2b3c4d", "role": "side", "entityId": "l1" } ] }
    ],
    "radius": 2 } }
```

Le chanfrein a la même forme avec `distance` (mm) à la place de `radius`. Chaque arête est une
**référence sémantique** : la paire des faces voisines, décrites comme le support d'une esquisse
(`start`, `end`, `side`, `imported`, ou `blend` + `index` pour une face créée par un congé ou un
chanfrein précédent). À la reconstruction, l'arête est celle que partagent les deux faces ; si
elle n'existe plus, l'étape passe en erreur `EDGE_LOST` et l'utilisateur choisit de nouvelles
arêtes. `dependsOn` contient les étapes qui ont créé ces faces.

### Révolution (`"type": "revolve"`)

```json
{ "id": "re-…", "type": "revolve", "name": "Révolution 1", "dependsOn": ["sk-…"],
  "params": { "sketchId": "sk-…", "axis": { "kind": "sketch-y" }, "angle": 360, "reversed": false, "operation": "add" } }
```

`axis` : `{ "kind": "sketch-x" }`, `{ "kind": "sketch-y" }` (axes du repère de l'esquisse) ou
`{ "kind": "line", "lineId": "l5" }` (segment de l'esquisse). `angle` en degrés (0 < angle ≤ 360 ;
360 = tour complet). `reversed` tourne dans l'autre sens. `operation` : `add` (ajouter), `cut`
(creuser : gorge, perçage conique…) ou `common` (garder la partie commune) ; absent dans les
fichiers antérieurs, il vaut `add`. Creuser sans volume : `POCKET_WITHOUT_SOLID`. Le profil doit rester d'un seul côté de
l'axe (`REVOLVE_CROSSES_AXIS` sinon). Faces : `start` / `end` (révolution partielle), `side` +
élément d'esquisse.

### Répétition (`"type": "pattern"`)

```json
{ "id": "pa-…", "type": "pattern", "name": "Répétition 1", "dependsOn": ["po-…"],
  "params": { "sourceId": "po-…", "kind": "linear", "axis": { "kind": "axis", "axis": "X" },
              "count": 3, "spacing": 15, "angle": 360, "reversed": false,
              "second": { "axis": { "kind": "axis", "axis": "Y" }, "count": 2, "spacing": 10, "reversed": false } } }
```

`sourceId` : l'étape répétée (extrusion, poche ou révolution placée avant) ; son volume ajouté ou
retiré est refait à chaque exemplaire. `kind` : `linear` (le long de `axis`, tous les `spacing`
mm ; `second` facultatif pour une grille) ou `circular` (autour de `axis` ; `angle` total en
degrés, 360 = exemplaires répartis sur un tour). `count` compte l'original. `axis` :
`{ "kind": "axis", "axis": "X" | "Y" | "Z" }` (passant par l'origine) ou
`{ "kind": "edge", "edge": edgeRef }` (arête droite : sa direction ; bord circulaire : son axe ;
le sens retenu rend positive la plus grande composante, `reversed` l'inverse). Les faces de la
copie n° k portent `featureId` = la répétition, le rôle (`start`, `end`, `side` + élément) de la
face d'origine et `index` = k (1, 2… ; en grille : i + j × `count`). Erreurs :
`PATTERN_SOURCE_MISSING`, `PATTERN_AXIS_INVALID`, `EDGE_LOST` ; avertissement
`PATTERN_COPIES_OUTSIDE` quand des exemplaires d'une poche tombent hors de la pièce.

### Épaissir (`"type": "thicken"`)

```json
{ "id": "th-…", "type": "thicken", "name": "Épaisseur 1", "params": { "distance": -0.2, "corners": "round" } }
```

Toute la pièce est décalée de `distance` mm : positif, elle grossit (les trous rétrécissent) ;
négatif, elle s'amincit. `corners` : `round` (distance exacte, coins sortants arrondis) ou `sharp`
(faces prolongées). Chaque face garde les étiquettes de son originale ; les faces de raccord sont
`side` + `join`. Erreur `THICKEN_FAILED` (par exemple amincir plus que la moitié d'une paroi).

### Dépouille (`"type": "draft"`)

```json
{ "id": "dp-…", "type": "draft", "name": "Dépouille 1", "dependsOn": ["pr-…"],
  "params": { "faces": [faceRef, …], "angle": 5, "neutral": { "kind": "plane", "plane": "XY" }, "reversed": false } }
```

`faces` : faces à incliner (planes, cylindriques ou coniques). `angle` : degrés (0 à 45 dans
l'interface). `neutral` : plan où les faces ne bougent pas, comme `plane` de la symétrie. Sens de
démoulage : +Z, +Y ou +X pour un plan d'origine, vers l'intérieur de la pièce pour une face ; la
pièce rétrécit dans ce sens (`reversed` : elle s'élargit). Les faces gardent leurs étiquettes.
Avertissement `DRAFT_NO_FACE` (aucune face, pièce inchangée) ; erreurs `DRAFT_FACE_LOST`,
`DRAFT_NEUTRAL_LOST`, `DRAFT_FAILED` (face parallèle au plan neutre, raccord impossible).

### Découpe (`"type": "split"`)

```json
{ "id": "sp-…", "type": "split", "name": "Découpe 1",
  "params": { "plane": { "kind": "plane", "plane": "XY" }, "offset": 2.5, "keep": "both", "gap": 10 } }
```

`plane` : comme pour la symétrie, `{ "kind": "plane", "plane": "XY" | "XZ" | "YZ" }` (normale +Z,
+Y ou +X, plan placé à la coordonnée `offset`) ou `{ "kind": "face", "ref": faceRef }` (face plane,
plan décalé de `offset` mm le long de sa normale extérieure ; négatif : dans la pièce). `keep` :
`below` (côté opposé à la normale), `above` (côté de la normale) ou `both` (les deux morceaux, celui
du dessus écarté de `gap` mm le long de la normale, au moins 0,5 mm ; ses faces gardent leurs
étiquettes). Faces de coupe : `start` (morceau du dessous) et `end` (morceau du dessus), au nom de
la découpe. Erreurs : `SPLIT_PLANE_LOST`, `SPLIT_NOTHING_LEFT` (rien de ce côté) ; avertissement
`SPLIT_OUTSIDE` quand le plan ne traverse pas la pièce.

### Balayage (`"type": "sweep"`)

```json
{ "id": "sw-…", "type": "sweep", "name": "Balayage 1", "dependsOn": ["sk-…", "sk-…"],
  "params": { "profileId": "sk-…", "pathId": "sk-…", "operation": "add" } }
```

`profileId` : esquisse du profil (un contour fermé, trous permis) ; `pathId` : esquisse du chemin
(segments et arcs bout à bout, ouverts ou fermés, ou un cercle seul). `operation` : `add`, `cut` ou `common`.
Faces : `start`, `end` et `side` + élément du profil.

### Lissage (`"type": "loft"`)

```json
{ "id": "lo-…", "type": "loft", "name": "Lissage 1", "dependsOn": ["sk-…", "sk-…"],
  "params": { "sketchIds": ["sk-…", "sk-…"], "ruled": false, "operation": "add" } }
```

`sketchIds` : au moins deux esquisses, chacune avec un seul contour fermé sans trou, reliées dans
cet ordre (celui de l'historique). `ruled` : raccords droits. `operation` : `add`, `cut` ou `common`.
Faces : `start` (premier contour), `end` (dernier), `side` + élément du premier contour.
Avec `common`, une partie commune vide donne l'erreur `COMMON_EMPTY`. Erreur `LOFT_PROFILE` si une esquisse n'a pas exactement un contour fermé sans trou.

### Coque (`"type": "shell"`)

```json
{ "id": "sh-…", "type": "shell", "name": "Coque 1", "dependsOn": ["pr-…"],
  "params": { "open": [faceRef], "thickness": 2, "outward": false } }
```

`open` : faces retirées (laissées ouvertes) ; vide : pièce creuse fermée. `thickness` : épaisseur
de la paroi (mm) ; `outward` : paroi ajoutée à l'extérieur. Faces créées : `side` + `inner`
(+ rang de la face d'origine) pour la paroi intérieure. Erreurs : `SHELL_FACE_LOST`,
`SHELL_FAILED`.

### Forme toute faite (`"type": "primitive"`)

```json
{ "id": "pr-…", "type": "primitive", "name": "Forme 1", "dependsOn": [],
  "params": { "shape": "box", "position": { "x": 0, "y": 0, "z": 0 }, "width": 40, "depth": 30,
              "height": 10, "diameter": 20, "thickness": 6, "operation": "add" } }
```

`shape` : `box` (coin en `position`, `width` × `depth` × `height`), `cylinder` (centre de la base,
`diameter` × `height`, axe Z), `sphere` (centre, `diameter`), `torus` (centre, `diameter` de la ligne
centrale, `thickness` du tube, axe Z). Les dimensions inutiles pour la forme sont conservées.
`operation` : `add` (ajouter), `cut` (creuser) ou `common` (garder seulement la matière commune, intersection). Faces : `start` (dessous), `end` (dessus), `side`
+ `x-`, `x+`, `y-`, `y+` (boîte), `wall` (cylindre), `surface` (sphère, tore). Une forme peut être
répétée ou reproduite par symétrie.

### Symétrie (`"type": "mirror"`)

```json
{ "id": "mi-…", "type": "mirror", "name": "Symétrie 1", "dependsOn": [],
  "params": { "source": { "kind": "part" }, "plane": { "kind": "plane", "plane": "YZ" } } }
```

`source` : `{ "kind": "part" }` (le reflet de toute la pièce est ajouté) ou
`{ "kind": "feature", "featureId": "po-…" }` (le volume ajouté ou retiré par cette étape est
reproduit). `plane` : `{ "kind": "plane", "plane": "XY" | "XZ" | "YZ" }` (plan d'origine) ou
`{ "kind": "face", "ref": faceRef }` (face plane de la pièce). Faces du reflet : symétrie d'une
étape, comme une copie de répétition (`index` = 1) ; symétrie de la pièce, `featureId` = la
symétrie, `role` d'origine, `entityId` = « <étape d'origine>/<élément> », `index` d'origine.
Erreur `MIRROR_PLANE_LOST` si la face n'existe plus ; avertissement `MIRROR_NOTHING_ADDED` si le
reflet se superpose à la pièce.

### Solide importé (`"type": "imported-solid"`)

```json
{ "id": "im-…", "type": "imported-solid", "name": "support", "dependsOn": [],
  "params": { "resourceId": "res-a1b2c3d4", "solidIndex": 0 } }
```

`solidIndex` est le rang du solide dans le fichier embarqué (ordre de lecture, toujours le même
puisque le fichier est figé dans le projet).

## Assemblage (champ facultatif `assembly`)

```json
"assembly": {
  "instances": [
    { "id": "in-…", "partId": "part-…", "name": "Plaque", "position": { "x": 0, "y": 0, "z": 0 } },
    { "id": "in-…", "partId": "part-…", "name": "Goupille", "position": { "x": 80, "y": 0, "z": 0 } }
  ],
  "joints": [
    { "id": "jt-…", "name": "Liaison 1", "kind": "revolute",
      "moving": { "instanceId": "in-…", "lcs": { "kind": "circle", "edge": { "faces": [faceRef, faceRef] } } },
      "base":   { "instanceId": "in-…", "lcs": { "kind": "face", "face": faceRef } },
      "flip": false, "angle": 90, "offset": -5, "angleLimits": [0, 110] }
  ],
  "fasteners": [
    { "id": "fs-…", "kind": "iso4762", "size": "M3", "length": 12,
      "at": { "instanceId": "in-…", "edge": { "faces": [faceRef, faceRef] } } },
    { "id": "fs-…", "kind": "iso4032", "size": "M3",
      "at": { "instanceId": "in-…", "edge": { "faces": [faceRef, faceRef] } }, "flip": true }
  ]
}
```

La première pièce insérée est fixe. `position` sert tant qu'une pièce n'est tenue par aucune
liaison. Repères (`lcs`) : `face` (centre d'une face plane, axe = normale), `circle` (centre d'un
bord circulaire, axe du cercle), `edge` (milieu d'une arête droite, axe = direction de l'arête), `vertex` (sommet d'une face plane :
`face` et deux `edges` qui s'y rejoignent ; axe = normale de la face) ; une `face` sphérique désigne
le centre de la sphère,
désignés comme les congés par leurs faces. `kind` : `fixed`, `revolute`, `slider`,
`cylindrical`, `spherical` (rotule : `tilt` inclinaison et `tiltDirection` direction en degrés, `tiltLimit` inclinaison maximale facultative) ; `angle` en degrés, `offset` en mm, limites facultatives `[min, max]`. Un projet
sans assemblage n'a pas ce champ. Détails : [assemblage.md](assemblage.md).

`fasteners` (facultatif) : visserie normalisée posée sur le bord circulaire (`at.edge`) d'un trou
d'une pièce insérée. `kind` : `iso4762` (vis CHC), `iso7380` (BHC), `iso10642` (FHC), `iso4017`
(vis H), `iso4032` (écrou H), `iso7089` (rondelle plate) ; `size` de `M2` à `M12` ; `length` (mm,
vis seulement) ; `flip` facultatif. Une taille absente de la norme ou une longueur non normalisée
rend le fichier invalide ; un élément posé sur une pièce retirée est supprimé à la lecture (avec un
avertissement).

## Simulation (champ facultatif `simulation`)

```json
"simulation": {
  "studies": [
    { "partId": "part-…", "materialId": "pla", "quality": "normal",
      "fixed": [faceRef],
      "load": { "faces": [faceRef], "kind": "mass", "value": 1, "direction": "-z" } }
  ]
}
```

Une étude par pièce ; `partId` vaut `"@assembly"` pour l'étude de l'assemblage (pièces qui se
touchent collées), dont les faces portent en plus `instanceId` (la pièce insérée). `materialId` : `pla`, `petg`, `abs`, `tpu`, `plywood`, `acrylic`,
`aluminium`, `steel` ; `quality` : `coarse`, `normal`, `fine` ; charge `mass` (kg) ou `force` (N),
`direction` : `push` (appuie sur la face) ou un axe (`-z`, `+z`, `-x`, `+x`, `-y`, `+y`). Les
résultats ne sont pas enregistrés : ils se recalculent. Détails : [simulation.md](simulation.md).

## Fabrication (champ facultatif `fabrication`)

```json
"fabrication": {
  "print": { "bed": { "x": 220, "y": 220, "z": 250 }, "spacing": 5,
             "items": [ { "partId": "part-…", "copies": 2, "scale": 100, "downFace": faceRef } ] },
  "laser": { "materials": [ { "id": "mat-3", "name": "Contreplaqué 3 mm", "thickness": 3,
                              "sheet": { "w": 300, "h": 200 }, "kerf": 0.15 } ],
             "spacing": 4,
             "items": [ { "partId": "part-…", "copies": 1, "face": faceRef, "materialId": "mat-3" } ] }
}
```

Réglages de l'onglet Fabrication : plateau d'impression (mm), espacement, et par pièce le nombre
d'exemplaires, l'échelle (%) et la face posée sur le plateau (les plateaux supplémentaires sont
calculés, pas enregistrés) ; pour la découpe laser, les matériaux (nom, épaisseur, plaque, trait de
coupe), et par pièce la face qui donne le contour et le matériau (`materialId` absent : choix
automatique par l'épaisseur). Les premiers fichiers avaient une seule plaque (`sheet`,
`thickness`, `kerf` directement sous `laser`) : ils sont lus comme un matériau unique. Voir
[fabrication.md](fabrication.md).

## Ressources embarquées

Le contenu exact des fichiers importés est copié dans le projet : il reste disponible sans le
fichier d'origine, sur un autre ordinateur, dans dix ans. Jamais de chemin vers le fichier source.

```json
"res-a1b2c3d4": {
  "id": "res-a1b2c3d4",
  "kind": "step",
  "fileName": "support.step",
  "encoding": "utf8",
  "data": "ISO-10303-21;\nHEADER;\n…",
  "byteLength": 35607,
  "sha256": "9b0e…",
  "importedAt": "2026-10-09T11:55:00.000Z"
}
```

`kind` : `step` ou `stl` (le STL est relu à chaque ouverture : triangles cousus en volume, faces
planes reconstituées). `encoding` vaut `utf8` (texte STEP ou STL texte tel quel) ou `base64` (octets bruts) si le fichier n'est pas
du texte UTF-8 valide. `sha256` permet de vérifier l'intégrité à l'ouverture. Une ressource qui
n'est plus utilisée par aucune fonction est retirée du projet.

## Validation à l'ouverture

`parseNativeFile` (`src/io/native-format.ts`) :

1. vérifie que le contenu est du JSON et que `format` vaut `"vibecad"` ;
2. refuse un `schemaVersion` plus récent que l'application (message : mettre l'application à
   jour) ;
3. applique les **migrations** explicites jusqu'à la version courante ;
4. valide chaque champ (types, valeurs autorisées, nombres finis, couleurs `#rrggbb`) et
   indique le chemin exact des erreurs (ex. `document.parts[0].features[1].params.distance :
   nombre attendu`) ;
5. vérifie la cohérence : identifiants uniques, segments et cercles qui visent des points
   existants, extrusions et poches qui visent une esquisse. Une référence vers une étape absente
   est **récupérable** : le projet s'ouvre avec un avertissement et l'étape concernée est signalée
   en erreur dans l'historique ;
6. vérifie l'empreinte des ressources importées.

## Stabilité du format (gel du 12 octobre 2026)

Le nom du logiciel et l'extension étant fixés, le **schéma 1 est gelé** : un projet enregistré
aujourd'hui s'ouvrira dans toutes les versions futures de VibeCAD.

- **Permis sans changer de version** :
  - ajouter un champ **facultatif** (absent, il garde son sens actuel). Une version plus ancienne
    l'ignore et le signale à l'ouverture (« ce projet vient d'une version plus récente… ») : il
    serait perdu si on enregistrait le projet avec elle ;
  - ajouter une **valeur** à une liste (un nouveau type d'étape comme les générateurs
    d'engrenages, un nouveau matériau…). Un projet qui l'utilise ne s'ouvre pas dans une version
    plus ancienne : elle le refuse avec un message clair (mettre l'application à jour), sans rien
    abîmer ; les projets qui ne l'utilisent pas restent lisibles partout.
- **Interdit dans le schéma 1** : supprimer ou renommer un champ, changer son sens ou son unité,
  rendre obligatoire un champ facultatif. Un tel changement passe au **schéma 2**, avec une
  migration (ci-dessous) qui transforme automatiquement les anciens fichiers.
- **Garde-fou** : `tests/fixtures/reference-schema-1.vibecad` est un projet complet enregistré le
  jour du gel (historique, assemblage avec liaison et visserie, fabrication, études de
  simulation). `tests/geometry/format-freeze.test.ts` vérifie qu'il s'ouvre sans avertissement,
  valide le schéma publié, garde tout son contenu, se réécrit à l'identique et se reconstruit avec
  le même volume. Ce fichier ne se modifie pas : si le test échoue, c'est que le format a changé.

## Versions et migrations

- Toute modification incompatible du format incrémente `schemaVersion`.
- Chaque nouvelle version ajoute une migration dans `MIGRATIONS` (`src/io/native-format.ts`) :
  une fonction pure qui transforme un document brut de la version `n` en version `n + 1`.
- Les migrations sont appliquées dans l'ordre à l'ouverture ; le projet migré est enregistré dans
  la nouvelle version au prochain enregistrement.
- Les tests (`tests/unit/native-format.test.ts`) vérifient l'aller-retour sans perte, le refus
  des fichiers invalides et l'application ordonnée des migrations.
