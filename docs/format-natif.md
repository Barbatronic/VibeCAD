# Format natif `.vibecad` (version de schéma 1)

Le format natif enregistre **tout le projet** : pièces, historique de construction, esquisses,
contraintes, cotes, paramètres, dépendances, unités, noms, couleurs, et le contenu des fichiers
importés. C'est un fichier **JSON UTF-8** lisible, indenté, sans dépendance à un logiciel
particulier. Le schéma formel est dans [`vibecad.schema.json`](vibecad.schema.json)
(JSON Schema 2020-12).

- Extension : `.vibecad` (provisoire, définie dans `src/io/native-format.ts`) — à ne pas
  confondre avec STEP (`.step`) ni avec FreeCAD (`.FCStd`).
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
| `face` | `ref` : `{ featureId, role, entityId?, index? }` | face plane désignée par une **référence sémantique** : `end` / `start` (faces d'arrivée / de départ d'une extrusion ou d'une poche), `side` + `entityId` (face latérale engendrée par cet élément d'esquisse), `imported` + `index` (face d'un solide importé), `blend` + `index` (face créée par un congé ou un chanfrein) |

**Éléments** (`entities`), coordonnées en mm dans le repère de l'esquisse :

| `type` | Champs |
| --- | --- |
| `point` | `x`, `y` |
| `line` | `a`, `b` : identifiants de ses points d'extrémité |
| `circle` | `center` : identifiant du point centre ; `radius` |
| `arc` | `center`, `start`, `end` : points ; l'arc va de `start` à `end` dans le sens trigonométrique. Le rayon est la distance centre–départ ; le solveur maintient l'arrivée à la même distance. Les cotes `radius` / `diameter` acceptent un arc dans leur champ `circle` |

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

`direction` : `default` (du côté de la normale de l'esquisse), `reversed`, `symmetric`.

### Poche (`"type": "pocket"`)

```json
{ "id": "po-…", "type": "pocket", "name": "Poche 1", "dependsOn": ["sk-…"],
  "params": { "sketchId": "sk-…", "extent": { "kind": "throughAll" }, "direction": "default" } }
```

`extent` : `{ "kind": "distance", "distance": 3 }` ou `{ "kind": "throughAll" }` (traversante).
`direction` : `default` (contre la normale, c'est-à-dire dans la matière sous une face),
`reversed`, `symmetric`.

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
  "params": { "sketchId": "sk-…", "axis": { "kind": "sketch-y" }, "angle": 360, "reversed": false } }
```

`axis` : `{ "kind": "sketch-x" }`, `{ "kind": "sketch-y" }` (axes du repère de l'esquisse) ou
`{ "kind": "line", "lineId": "l5" }` (segment de l'esquisse). `angle` en degrés (0 < angle ≤ 360 ;
360 = tour complet). `reversed` tourne dans l'autre sens. Le profil doit rester d'un seul côté de
l'axe (`REVOLVE_CROSSES_AXIS` sinon). Faces : `start` / `end` (révolution partielle), `side` +
élément d'esquisse.

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
  ]
}
```

La première pièce insérée est fixe. `position` sert tant qu'une pièce n'est tenue par aucune
liaison. Repères (`lcs`) : `face` (centre d'une face plane, axe = normale), `circle` (centre d'un
bord circulaire, axe du cercle), `edge` (milieu d'une arête droite, axe = direction de l'arête),
désignés comme les congés par leurs faces. `kind` : `fixed`, `revolute`, `slider`,
`cylindrical` ; `angle` en degrés, `offset` en mm, limites facultatives `[min, max]`. Un projet
sans assemblage n'a pas ce champ. Détails : [assemblage.md](assemblage.md).

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

`encoding` vaut `utf8` (texte STEP tel quel) ou `base64` (octets bruts) si le fichier n'est pas
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

## Versions et migrations

- Toute modification incompatible du format incrémente `schemaVersion`.
- Chaque nouvelle version ajoute une migration dans `MIGRATIONS` (`src/io/native-format.ts`) :
  une fonction pure qui transforme un document brut de la version `n` en version `n + 1`.
- Les migrations sont appliquées dans l'ordre à l'ouverture ; le projet migré est enregistré dans
  la nouvelle version au prochain enregistrement.
- Les tests (`tests/unit/native-format.test.ts`) vérifient l'aller-retour sans perte, le refus
  des fichiers invalides et l'application ordonnée des migrations.
