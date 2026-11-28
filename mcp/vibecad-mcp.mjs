#!/usr/bin/env node
/**
 * Serveur MCP de VibeCAD (conception assistée) — transport stdio, sans dépendance.
 *
 * Il ne calcule rien lui-même : chaque appel d'outil est relayé au serveur de développement
 * (`npm run dev`, plugin `scripts/vite-plugin-mcp-bridge.ts`), qui le transmet à l'onglet VibeCAD
 * ouvert (`src/app/mcp-bridge.ts`). Les modifications apparaissent donc en direct dans la vue 3D
 * et l'historique, et s'annulent avec Ctrl+Z.
 *
 * Variable d'environnement : VIBECAD_URL (défaut http://localhost:5173).
 */
import { createInterface } from 'node:readline';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Racine du dépôt : les chemins d'export relatifs partent d'ici (dossier `exports/` par défaut). */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE_URL = (process.env.VIBECAD_URL ?? 'http://localhost:5173').replace(/\/$/, '');
const SERVER_INFO = { name: 'vibecad', version: '0.1.0' };
const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const INSTRUCTIONS = `VibeCAD : CAO paramétrique 3D (Open CASCADE) ouverte dans le navigateur de l'utilisateur, qui voit chaque modification en direct.
Unités : millimètres. Plans d'origine : XY (vu de dessus, normale +Z), XZ (vu de face, normale −Y), YZ (vu de droite, normale +X).
Démarche : get_document → create_sketch (profil fermé, coté) → add_feature (extrude, pocket, hole, revolve, fillet…) → screenshot pour vérifier.
Les faces et arêtes se désignent par l'index renvoyé par list_geometry (face_index, edge_indices), converti en référence persistante.
Une étape en erreur est annulée automatiquement et l'erreur est renvoyée. Tout s'annule avec undo (ou Ctrl+Z dans l'interface).
Le public est pédagogique (enseignants, élèves de 9-10 ans) : noms d'étapes et de pièces clairs, en français.`;

const point = { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2, description: '[x, y] en mm, repère de l’esquisse' };
const partId = { type: 'string', description: 'Pièce visée (défaut : pièce active).' };
const featureId = { type: 'string', description: 'Identifiant d’étape (voir get_document).' };

const supportSchema = {
  type: 'object',
  description: 'Support : { plane: "XY"|"XZ"|"YZ", offset?: mm } | { face_index: n } (index de list_geometry, face plane) | { face: FaceRef } | { datum: id d’un plan de construction }. Défaut : XY.',
};

const shapesSchema = {
  type: 'array',
  description:
    'Formes à dessiner. Chaque forme a un "type" et un "id" facultatif (alias) réutilisable dans les contraintes. ' +
    'rectangle { at:[x,y] (coin bas-gauche, ou centre si centered:true), width, height } → alias.bottom/.right/.top/.left (segments), .bl/.br/.tr/.tl (coins). ' +
    'circle { center:[x,y], diameter | radius } → alias (cercle), alias.center. ' +
    'line { from, to } → alias, alias.start, alias.end. ' +
    'polygon { points:[[x,y],…] } (fermé) → alias.l0…, alias.p0…. ' +
    'arc { center, start, end } (sens trigonométrique) → alias, .center, .start, .end. ' +
    'point { at } (ex. centre d’un perçage) → alias. ' +
    'text { at, text, height, angle? }. ' +
    'Formes exactes (vrais segments et arcs, sans cotes ; alias = 1re courbe, alias.c0, .c1… chaque courbe) : ' +
    'rectangle avec radius (coins arrondis) ; polygon avec corner_radius (un rayon, ou un par sommet, 0 = vif) ; ' +
    'regular_polygon { center, sides, radius (sommets) | across_flats (entre plats), angle° du 1er sommet (défaut 90), corner_radius? } ; ' +
    'slot { from, to (centres des bouts), width } (oblong). ' +
    'boolean { op:"union"|"difference"|"intersection", shapes:[rectangle|circle|polygon|regular_polygon|slot|boolean…] } : un seul contour propre ' +
    '(difference = 1re forme moins les suivantes ; une forme entièrement dedans devient un trou). ' +
    'Courbes lisses : ellipse { center, rx, ry, angle°? } ; spline { points:[[x,y],…], closed (défaut true) } passant par les points (lissage sans centaines de points). ' +
    'offset { of: alias d’une courbe d’un contour fermé déjà dessiné, distance (+ vers l’extérieur, − vers l’intérieur) } : contour décalé lié à l’original (segments, arcs, cercles). ' +
    'Les contours d’une esquisse ne doivent pas se chevaucher : combiner des formes qui se touchent avec boolean. ' +
    'Options : dimensions (défaut true : cotes de taille et de position par rapport à l’origine ; pour polygon, horizontales/verticales), construction:true (ignorée pour le volume). ' +
    'Paramétrique : width/height du rectangle et diameter/radius du cercle acceptent une équation de paramètres ("longueur") ; leurs cotes sont nommées alias.width, alias.height, alias.diameter.',
  items: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['rectangle', 'circle', 'line', 'polygon', 'regular_polygon', 'slot', 'ellipse', 'spline', 'arc', 'point', 'text', 'offset', 'boolean'] },
      id: { type: 'string' },
    },
    required: ['type'],
  },
};

const constraintsSchema = {
  type: 'array',
  description:
    'Contraintes supplémentaires { type, … } ; les éléments se désignent par alias ou identifiant, plus "origin", "axis-x", "axis-y". ' +
    'coincident{a,b} horizontal{line} vertical{line} length{line,value} distance{a,b,value} distanceX{a,b,value≥0 : x(b)−x(a)} distanceY{a,b,value≥0} ' +
    'diameter{circle,value} radius{circle,value} parallel{a,b} perpendicular{a,b} collinear{a,b} equal{a,b} tangent{a,b} pointOn{point,curve} midpoint{point,line} ' +
    'symmetric{a,b,about} angle{a,b,value°} pointLineDistance{point,line,value}. Éviter les contraintes redondantes avec les cotes automatiques. ' +
    'value : nombre ou équation de paramètres ("largeur/2-marge"). id facultatif : alias de la contrainte (pour set_values).',
  items: { type: 'object', properties: { type: { type: 'string' } }, required: ['type'] },
};

const TOOLS = [
  {
    name: 'get_document',
    description: 'État du projet ouvert : pièces, historique de chaque pièce (id, type, nom, résumé, statut ok/warning/error/blocked, degrés de liberté des esquisses), volume, boîte englobante, annuler/rétablir.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_feature',
    description: 'Détail d’une étape : paramètres complets (JSON du modèle) ; pour une esquisse, son repère 3D et la position résolue des points.',
    inputSchema: { type: 'object', properties: { feature_id: featureId }, required: ['feature_id'] },
  },
  {
    name: 'list_feature_types',
    description: 'Types d’étapes créables avec add_feature, avec leur entrée (sketch, edges, faces, part) et s’ils exigent un volume existant.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'new_part',
    description: 'Ajoute une pièce vide au projet et la rend active. Renvoie { partId, name }.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
  },
  {
    name: 'create_sketch',
    description: 'Crée une esquisse cotée sur un plan ou une face. Renvoie son id, ses degrés de liberté (0 = entièrement contrainte), son profil et la table alias → identifiants.',
    inputSchema: {
      type: 'object',
      properties: { part_id: partId, name: { type: 'string' }, support: supportSchema, shapes: shapesSchema, constraints: constraintsSchema },
      required: ['shapes'],
    },
  },
  {
    name: 'update_sketch',
    description: 'Modifie une esquisse : change des cotes (set_values [{id, value}] — id de contrainte, voir get_feature ; value : nombre, ou équation de paramètres qui lie la cote ; un nombre retire le lien), ajoute des formes et contraintes, supprime des éléments ou contraintes (remove [ids]), change de support.',
    inputSchema: {
      type: 'object',
      properties: {
        feature_id: featureId,
        name: { type: 'string' },
        set_values: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, value: { type: ['number', 'string'] } }, required: ['id', 'value'] } },
        add_shapes: shapesSchema,
        add_constraints: constraintsSchema,
        remove: { type: 'array', items: { type: 'string' } },
        support: supportSchema,
      },
      required: ['feature_id'],
    },
  },
  {
    name: 'add_feature',
    description:
      'Ajoute une étape (extrude, pocket, hole, revolve, fillet, chamfer, pattern, mirror, shell, primitive, gear…). Les paramètres par défaut de l’interface sont complétés par "params" (fusion profonde). ' +
      'Exemples : extrude params {distance, direction:"default"|"reversed"|"symmetric"} ; pocket {extent:{kind:"distance",distance}|{kind:"throughAll"}} ; ' +
      'hole {size:"M3"…|"custom", diameter, through, depth, kind:"clearance"|"counterbore"|"countersink"|"tapped"} (un trou par point ou centre de cercle de l’esquisse) ; ' +
      'revolve {axis:{kind:"sketch-x"|"sketch-y"}|{kind:"line",lineId}, angle} ; fillet {radius} ; chamfer {distance}. ' +
      'Entrée : sketch_id (défaut : dernière esquisse de la pièce), edge_indices / face_indices (de list_geometry). Renvoie le statut et les paramètres retenus ; une étape en erreur est annulée. ' +
      'expressions : { champ: "équation" } lie un champ à des paramètres du projet (extrude/pocket : distance ; fillet/chamfer : size ; move : tx, ty, tz ; pattern : count, spacing…).',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string' },
        part_id: partId,
        sketch_id: { type: 'string' },
        edge_indices: { type: 'array', items: { type: 'integer' } },
        face_indices: { type: 'array', items: { type: 'integer' } },
        params: { type: 'object' },
        expressions: { type: 'object', description: 'Champs liés à des paramètres : { distance: "epaisseur*2" }.' },
        name: { type: 'string' },
      },
      required: ['type'],
    },
  },
  {
    name: 'update_feature',
    description: 'Modifie les paramètres d’une étape existante (fusion profonde ; null supprime un champ) puis recalcule les étapes suivantes. Annulée si l’étape devient en erreur. expressions : { champ: "équation" } lie un champ à des paramètres du projet (null retire le lien).',
    inputSchema: { type: 'object', properties: { feature_id: featureId, params: { type: 'object' }, expressions: { type: 'object' }, name: { type: 'string' } }, required: ['feature_id'] },
  },
  {
    name: 'delete_feature',
    description: 'Supprime une étape et celles qui en dépendent. with_following:true supprime aussi toutes les étapes qui la suivent (déplacements compris) : repartir de cette étape.',
    inputSchema: { type: 'object', properties: { feature_id: featureId, with_following: { type: 'boolean' } }, required: ['feature_id'] },
  },
  {
    name: 'get_parameters',
    description: 'Paramètres du projet (nom, équation, valeur, commentaire, erreur, ce qui les utilise) et liste des champs et cotes liés à une équation.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'set_parameters',
    description:
      'Crée ou modifie des paramètres du projet en une action annulable ; tout ce qui leur est lié (cotes, champs d’étapes) est recalculé. ' +
      'set : [{ name, value | expression ("largeur*2"), comment? }] ; rename : [{ from, to }] (les équations suivent) ; remove : [noms] (refusé s’il est utilisé, sauf force:true). ' +
      'Nom : lettre puis lettres, chiffres ou _. Renvoie les paramètres et les étapes devenues en erreur (features_in_error).',
    inputSchema: {
      type: 'object',
      properties: {
        set: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, value: { type: 'number' }, expression: { type: 'string' }, comment: { type: 'string' } }, required: ['name'] } },
        rename: { type: 'array', items: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] } },
        remove: { type: 'array', items: { type: 'string' } },
        force: { type: 'boolean' },
      },
    },
  },
  {
    name: 'copy_part',
    description:
      'Copie une pièce en une action annulable. mode "copy" (défaut) : copie indépendante, avec son propre historique. ' +
      'mode "mirror" : variante symétrique par rapport au plan plane ("XY" | "XZ" | "YZ", défaut YZ, passant par l’origine) ; elle SUIT les modifications de l’original (pièce gauche / pièce droite). ' +
      'count : nombre d’exemplaires (défaut 1) ; move { translation {x,y,z}, axis "X"|"Y"|"Z", angle°, center } : l’exemplaire k est déplacé k fois (réseau linéaire ou circulaire de pièces). ' +
      'name (un seul exemplaire) ou names : noms des nouvelles pièces. Renvoie leurs id, noms et volumes.',
    inputSchema: {
      type: 'object',
      properties: {
        part: { type: 'string' },
        mode: { type: 'string', enum: ['copy', 'mirror'] },
        plane: { type: 'string', enum: ['XY', 'XZ', 'YZ'] },
        count: { type: 'integer' },
        move: { type: 'object', properties: { translation: { type: 'object' }, axis: { type: 'string', enum: ['X', 'Y', 'Z'] }, angle: { type: 'number' }, center: { type: 'object' } } },
        name: { type: 'string' },
        names: { type: 'array', items: { type: 'string' } },
      },
      required: ['part'],
    },
  },
  {
    name: 'rename_part',
    description: 'Renomme une pièce (part : id ou nom actuel).',
    inputSchema: { type: 'object', properties: { part: { type: 'string' }, name: { type: 'string' } }, required: ['part', 'name'] },
  },
  {
    name: 'delete_part',
    description: 'Supprime une pièce (part) ou plusieurs (parts : [id ou nom]) en une action annulable ; leurs insertions dans l’assemblage disparaissent aussi.',
    inputSchema: { type: 'object', properties: { part: { type: 'string' }, parts: { type: 'array', items: { type: 'string' } } } },
  },
  {
    name: 'batch',
    description:
      'Exécute plusieurs outils à la suite comme UNE seule action annulable (ex. new_part, create_sketch, add_feature, add_feature…). ' +
      'operations : [{ tool, args }]. Dans args, une chaîne "$N.chemin" est remplacée par le résultat de l’opération N (0 = première) : "$0.partId", "$1.sketch.id" ; "$prev" = opération précédente. ' +
      'Si une opération échoue, tout le lot est annulé et l’erreur indique laquelle. label : nom de l’action dans l’historique. Renvoie les résultats de chaque opération.',
    inputSchema: {
      type: 'object',
      properties: {
        operations: { type: 'array', items: { type: 'object', properties: { tool: { type: 'string' }, args: { type: 'object' } }, required: ['tool'] } },
        label: { type: 'string' },
      },
      required: ['operations'],
    },
  },
  {
    name: 'list_geometry',
    description: 'Faces (index, type de surface, plan : origine + normale sortante, cylindre, aire, référence) et arêtes (index, faces voisines, droite : extrémités, cercle : centre/rayon, longueur) du volume d’une pièce. Sert à choisir face_index / edge_indices.',
    inputSchema: { type: 'object', properties: { part_id: partId, max: { type: 'integer', description: 'Nombre maximal de faces et d’arêtes (défaut 200).' } } },
  },
  {
    name: 'screenshot',
    description: 'Image de la vue 3D. view : iso, front, back, top, bottom, right, left (sans view : la vue actuelle de l’utilisateur).',
    inputSchema: { type: 'object', properties: { view: { type: 'string', enum: ['iso', 'front', 'back', 'top', 'bottom', 'right', 'left'] } } },
  },
  {
    name: 'export',
    description:
      'Exporte des pièces en STEP (solides exacts, pour FreeCAD et les autres logiciels de CAO) ou en STL (maillage, pour l’impression 3D), en millimètres, à leur place de modélisation. ' +
      'Le fichier est écrit sur disque : "path" (absolu, ou relatif à la racine du dépôt) ; défaut exports/<nom>.step|.stl. Un fichier existant n’est remplacé qu’avec overwrite:true.',
    inputSchema: {
      type: 'object',
      properties: {
        format: { type: 'string', enum: ['step', 'stl'] },
        part_ids: { type: 'array', items: { type: 'string' }, description: 'Pièces à exporter (défaut : toutes les pièces visibles).' },
        path: { type: 'string' },
        overwrite: { type: 'boolean' },
      },
      required: ['format'],
    },
  },
  {
    name: 'get_print_plates',
    description:
      'Impression 3D (atelier Fabrication) : taille du plateau, plateaux du projet et leurs pièces (exemplaires, échelle, face du dessous), ' +
      'pièces qu’on peut y mettre, et disposition calculée du plateau affiché (impressions nécessaires, grammes de PLA, avertissements).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'set_print_plate',
    description:
      'Prépare un plateau d’impression 3D en une seule action annulable, puis l’affiche (atelier Fabrication › Impression 3D). ' +
      'plate : id ou nom d’un plateau, "new" pour en créer un (défaut : plateau affiché). ' +
      'items : [{ part (id ou nom de pièce), copies (0 = retirer), scale (%), down_face_index (face plane posée sur le plateau, index de list_geometry ; null = orientation d’origine) }] ; ' +
      'une pièce déjà sur le plateau est mise à jour. clear:true vide d’abord le plateau. bed {x,y,z} : taille du plateau (mm, commune à tous les plateaux). ' +
      'Quand tout ne tient pas, VibeCAD répartit sur plusieurs impressions (layout_of_current_plate.prints_needed).',
    inputSchema: {
      type: 'object',
      properties: {
        plate: { type: 'string' },
        name: { type: 'string', description: 'Nouveau nom du plateau.' },
        clear: { type: 'boolean' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              part: { type: 'string' },
              copies: { type: 'integer' },
              scale: { type: 'number' },
              down_face_index: { type: ['integer', 'null'] },
            },
            required: ['part'],
          },
        },
        bed: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } } },
        show: { type: 'boolean', description: 'Afficher le plateau dans l’atelier Fabrication (défaut true).' },
      },
    },
  },
  {
    name: 'get_laser_layout',
    description:
      'Découpe laser (atelier Fabrication) : matériaux (épaisseur, taille de plaque, trait de coupe), pièces à découper (exemplaires, face posée, matériau retenu, épaisseur détectée) ' +
      'et disposition calculée : plaques utilisées et, pour chaque exemplaire, plaque, centre, angle et encombrement (bbox, mm, repère de la plaque). Avertissements.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'set_laser',
    description:
      'Prépare la découpe laser en une seule action annulable, puis l’affiche (atelier Fabrication › Découpe laser). ' +
      'items : [{ part (id ou nom), copies (0 = ne pas découper), face_index (face plane posée sur la plaque, index de list_geometry ; null = plus grande face plane), material (id ou nom ; null = automatique, épaisseur la plus proche) }]. ' +
      'materials : [{ material (id, nom, ou "new"), name, thickness (mm), sheet {w,h} (mm), kerf (mm) }] ; changer la plaque ou le trait remet le rangement automatique. ' +
      'spacing : espace entre pièces (mm). engrave_names : graver le nom des pièces. ' +
      'optimize : true (tous les matériaux) ou id/nom d’un matériau : imbrication serrée avec rotations (action séparée). reset_placements : true ou id/nom : retour au rangement par rangées.',
    inputSchema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              part: { type: 'string' },
              copies: { type: 'integer' },
              face_index: { type: ['integer', 'null'] },
              material: { type: ['string', 'null'] },
            },
            required: ['part'],
          },
        },
        materials: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              material: { type: 'string' },
              name: { type: 'string' },
              thickness: { type: 'number' },
              sheet: { type: 'object', properties: { w: { type: 'number' }, h: { type: 'number' } } },
              kerf: { type: 'number' },
            },
            required: ['material'],
          },
        },
        spacing: { type: 'number' },
        engrave_names: { type: 'boolean' },
        optimize: { type: ['boolean', 'string'] },
        reset_placements: { type: ['boolean', 'string'] },
        show: { type: 'boolean', description: 'Afficher les plaques dans l’atelier Fabrication (défaut true).' },
      },
    },
  },
  {
    name: 'export_laser',
    description:
      'Exporte les plaques d’un matériau en SVG ou DXF (échelle 1:1, mm ; rouge : découpe, bleu : gravure), une page/calque par plaque. ' +
      'material : id ou nom (obligatoire si plusieurs matériaux ont des pièces). "path" (absolu, ou relatif à la racine du dépôt) ; défaut exports/<projet> - laser - <matériau>.svg|.dxf. ' +
      'Un fichier existant n’est remplacé qu’avec overwrite:true.',
    inputSchema: {
      type: 'object',
      properties: {
        format: { type: 'string', enum: ['svg', 'dxf'] },
        material: { type: 'string' },
        path: { type: 'string' },
        overwrite: { type: 'boolean' },
      },
    },
  },
  { name: 'undo', description: 'Annule la dernière action (comme Ctrl+Z).', inputSchema: { type: 'object', properties: {} } },
  { name: 'redo', description: 'Rétablit l’action annulée.', inputSchema: { type: 'object', properties: {} } },
];

// ---------------------------------------------------------------------------
// Relais vers l'onglet VibeCAD

async function relay(tool, args) {
  let res;
  try {
    res = await fetch(`${BASE_URL}/__vibecad_mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-VibeCAD-MCP': '1' },
      body: JSON.stringify({ tool, args }),
    });
  } catch {
    return { ok: false, error: `Serveur VibeCAD injoignable à ${BASE_URL} : lancez « npm run dev » dans le dossier du projet, puis ouvrez la page.` };
  }
  try {
    return await res.json();
  } catch {
    return { ok: false, error: `Réponse inattendue du serveur VibeCAD (HTTP ${res.status}).` };
  }
}

/** Écrit un fichier exporté ; renvoie son chemin absolu. */
function saveExport(base64, result, args) {
  const ext = `.${String(result.format ?? 'bin')}`;
  const safe = String(result.suggestedName ?? 'export').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim() || 'export';
  let path = typeof args.path === 'string' && args.path.trim() ? args.path.trim() : join('exports', `${safe}${ext}`);
  if (!isAbsolute(path)) path = resolve(ROOT, path);
  if (!extname(path)) path += ext;
  if (existsSync(path) && args.overwrite !== true) {
    if (typeof args.path === 'string' && args.path.trim()) throw new Error(`${path} existe déjà (overwrite:true pour le remplacer).`);
    const stem = path.slice(0, -ext.length);
    let n = 2;
    while (existsSync(`${stem} (${n})${ext}`)) n++;
    path = `${stem} (${n})${ext}`;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.from(base64, 'base64'));
  delete result.suggestedName;
  return path;
}

async function callTool(name, args) {
  if (!TOOLS.some((t) => t.name === name)) return { content: [{ type: 'text', text: `Outil inconnu : ${name}` }], isError: true };
  const answer = await relay(name, args ?? {});
  if (!answer.ok) return { content: [{ type: 'text', text: answer.error ?? 'Erreur inconnue.' }], isError: true };
  if (answer.file) {
    try {
      answer.result.path = saveExport(answer.file, answer.result, args ?? {});
    } catch (err) {
      return { content: [{ type: 'text', text: `Export calculé mais non enregistré : ${err.message}` }], isError: true };
    }
  }
  const content = [{ type: 'text', text: JSON.stringify(answer.result, null, 1) }];
  if (answer.image) content.push({ type: 'image', data: answer.image, mimeType: 'image/png' });
  return { content };
}

// ---------------------------------------------------------------------------
// JSON-RPC sur stdio (un message par ligne)

const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
const replyError = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

async function handle(msg) {
  const { id, method, params } = msg;
  const isRequest = id !== undefined && id !== null;
  switch (method) {
    case 'initialize': {
      const asked = params?.protocolVersion;
      return reply(id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case 'ping':
      return reply(id, {});
    case 'tools/list':
      return reply(id, { tools: TOOLS });
    case 'tools/call':
      return reply(id, await callTool(params?.name, params?.arguments));
    default:
      if (isRequest) replyError(id, -32601, `Méthode inconnue : ${method}`);
  }
}

const inFlight = new Set();
const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return replyError(null, -32700, 'JSON invalide');
  }
  const task = handle(msg)
    .catch((err) => {
      if (msg.id !== undefined) replyError(msg.id, -32603, err?.message ?? String(err));
    })
    .finally(() => inFlight.delete(task));
  inFlight.add(task);
});
// Fin de l'entrée : on termine les appels en cours avant de quitter.
rl.on('close', () => void Promise.allSettled([...inFlight]).then(() => process.exit(0)));
