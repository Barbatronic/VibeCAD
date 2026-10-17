# Ajouter un outil, une fonction paramétrique ou un format

Le code est découpé pour qu'une nouvelle capacité s'ajoute **dans son propre dossier**, avec
seulement une ligne d'enregistrement dans de petits registres. Ce guide prend des exemples
concrets.

## 1. Ajouter une fonction paramétrique (ex. « Révolution »)

Une fonction = un dossier `src/features/<type>/` contenant trois fichiers :

| Fichier | Couche | Contenu |
| --- | --- | --- |
| `definition.ts` | domaine (pur) | libellés, explication pédagogique, validation, dépendances, résumé ; `tool` (création depuis la barre d'outils) |
| `evaluate.ts` | calcul (worker) | construction géométrique via l'interface `GeometryKernel` uniquement |
| `panel.tsx` | interface | panneau des paramètres (Preact) |

Étapes :

1. **Modèle** — dans `src/domain/model.ts`, ajouter le type de fonction et ses paramètres typés,
   puis l'ajouter à l'union `Feature` :
   ```ts
   export interface RevolveParams { sketchId: Id; axis: 'X' | 'Y'; angle: number }
   export type RevolveFeature = FeatureBase<'revolve', RevolveParams>;
   export type Feature = SketchFeature | ExtrudeFeature | PocketFeature | FilletFeature | ChamferFeature | ImportedSolidFeature | RevolveFeature;
   ```
2. **Définition** — `src/features/revolve/definition.ts` : un objet `FeatureDefinition<RevolveFeature>`
   (voir `features/extrude/definition.ts`). `dependencies()` renvoie `[sketchId]` ; `validate()`
   produit des messages en français ; `tool.create()` choisit des valeurs par défaut sensées et
   `tool.initialFields()` le texte des champs. `tool.input` vaut `'sketch'` (la fonction part
   d'une esquisse, comme l'extrusion) ou `'edges'` (la fonction part d'arêtes cliquées dans la
   vue 3D, comme le congé et le chanfrein : voir `features/fillet/` et `features/blend-common.ts`).
3. **Évaluation** — `src/features/revolve/evaluate.ts` : un `FeatureEvaluator` qui utilise
   `resolveProfile()` (profil fermé de l'esquisse), puis le noyau. Si le noyau n'a pas encore
   l'opération, l'ajouter à l'interface `GeometryKernel` (`src/geometry/kernel.ts`), puis à
   `OcctKernel` (`src/geometry/occt/occt-kernel.ts`) **en étiquetant les faces créées** (rôles
   `start`, `end`, `side` + élément d'esquisse) pour que les esquisses posées dessus restent
   attachées.
4. **Panneau** — `src/features/revolve/panel.tsx` : composant qui reçoit `FeaturePanelProps`
   (`src/features/panel-types.ts`) ; réutiliser `SketchSelect`, `LengthField`, `Segmented`,
   `PreviewStatus` (`src/ui/components/`).
5. **Enregistrement** (une ligne chacun) :
   - `src/features/registry.ts` → `FEATURE_DEFINITIONS`
   - `src/features/evaluators.ts` → `FEATURE_EVALUATORS`
   - `src/ui/feature-panels.ts` → `FEATURE_PANELS`
6. **Format natif** — dans `src/io/native-format.ts`, lire les nouveaux paramètres dans
   `readFeature()` ; ajouter le cas au schéma `docs/vibecad.schema.json`. Si des fichiers
   existants doivent être transformés, incrémenter `SCHEMA_VERSION` et ajouter une migration.
7. **Tests** — un test géométrique (`tests/geometry/`) qui vérifie volume, boîte englobante et
   validité du solide ; un test d'aller-retour du format.

Le bouton apparaît automatiquement dans la barre d'outils (les fonctions ayant un `tool`), avec
son explication quand il est indisponible, et l'aperçu fonctionne sans autre code. Pour le ranger
dans le bon secteur (Esquisse, Ajouter, Enlever, Modifier, Répéter), l'ajouter à `PART_SECTORS`
(`src/ui/TopBar.tsx`) ; à défaut il va dans « Modifier ». Les outils de `main` restent sortis
quand la barre manque de place ; les autres passent alors dans le menu ▾ du secteur.

## 2. Ajouter un outil d'esquisse (ex. « Arc »)

1. Ajouter l'élément au modèle (`SketchEntity` dans `src/domain/model.ts`) et ses fonctions
   d'ajout dans `src/sketch/model.ts`.
2. Ajouter ses équations au solveur (`buildSystem` dans `src/sketch/solver.ts`) et, si besoin, de
   nouvelles contraintes (type dans le modèle, équations avec dérivées exactes).
3. Gérer l'élément dans les profils (`src/sketch/profiles.ts` : segments du contour) et dans le
   noyau (`buildWire` de l'adaptateur OCCT).
4. Ajouter l'outil dans la session (`SketchTool`, `TOOL_LABELS`, `TOOL_HELP`, gestion des clics
   et de la saisie au clavier dans `src/sketch/session.ts`), son aperçu (`sessionPreview`) et sa
   détection sous le curseur (`src/sketch/hit-test.ts`).
5. Ajouter son rendu (`src/viewport/sketch-render.ts`), son bouton (son secteur dans
   `SKETCH_SECTORS`, `src/ui/TopBar.tsx`) et son raccourci (`src/app/keyboard.ts`).
6. Tester la session sans navigateur (`tests/unit/sketch-session.test.ts`).

## 3. Ajouter un format d'export

Exemple réel : le GLB (`src/io/gltf.ts`, test `tests/unit/gltf.test.ts`).

1. Écrire le convertisseur pur dans `src/io/` (entrée : `MeshData` du noyau, sortie :
   `Uint8Array`), sur le modèle de `src/io/stl.ts` ou `src/io/gltf.ts`, avec un test.
2. Si le format a besoin des formes exactes (comme STEP), ajouter une requête au protocole du
   worker (`src/geometry/protocol.ts`), son traitement dans `src/workers/geometry-service.ts` et
   `geometry.worker.ts`, et une méthode dans `src/geometry/client.ts`. Un format de maillage
   (comme GLB) peut partir des maillages d'affichage déjà reçus, sans passer par le worker.
3. Ajouter l'entrée du menu Fichier (`src/ui/TopBar.tsx`) et l'action du contrôleur
   (`showExportDialog` / `confirmExport` dans `src/app/controller.ts`).
4. Documenter ce que le format contient et ne contient pas (unités, historique).

## Règles à respecter

- `npm run check` doit rester vert : types, **règles de couches** (`npm run lint:arch`), tests.
- Le domaine ne dépend ni du DOM, ni de Three.js, ni d'Open CASCADE.
- Jamais de fonction visible mais inopérante : un bouton indisponible explique ce qu'il faut faire.
- Messages en français, sans jargon ; détail technique éventuel dans une zone repliée.
- Ne jamais remplacer une opération CAO par un effet visuel : si le noyau ne permet pas une
  opération, exposer la limite.
