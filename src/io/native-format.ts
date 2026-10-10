/**
 * Format natif `.vibecad` : JSON UTF-8 ouvert, documenté (docs/format-natif.md) et versionné.
 *
 * Le fichier contient le modèle métier complet (pièces, esquisses, contraintes, paramètres,
 * dépendances, unités, noms) et les ressources géométriques des imports (STEP embarqués).
 * Aucun objet du noyau n'est sérialisé : la géométrie est reconstruite à l'ouverture.
 */
import type {
  Assembly,
  AssemblyInstance,
  AssemblyJoint,
  CadDocument,
  LcsRef,
  EdgeRef,
  FaceRef,
  Feature,
  Part,
  Resource,
  SketchConstraint,
  SketchEntity,
  SketchParams,
  SketchSupport,
} from '../domain/model';
import { constraintReferences, ORIGIN_POINT_ID } from '../domain/model';
import { featureDependencies } from '../features/registry';
import { APP_NAME, APP_VERSION } from '../meta';

export const FORMAT_ID = 'vibecad';
export const SCHEMA_VERSION = 1;
export const NATIVE_EXTENSION = '.vibecad';
export const NATIVE_MIME = 'application/vnd.vibecad+json';

export interface NativeFile {
  format: typeof FORMAT_ID;
  schemaVersion: number;
  generator: { name: string; version: string };
  savedAt: string;
  document: SerializedDocument;
}

type SerializedFeature = Feature & { dependsOn: string[] };
type SerializedPart = Omit<Part, 'features'> & { features: SerializedFeature[] };
type SerializedDocument = Omit<CadDocument, 'parts'> & { parts: SerializedPart[] };

export function serializeDocument(doc: CadDocument, savedAt = new Date().toISOString()): string {
  const file: NativeFile = {
    format: FORMAT_ID,
    schemaVersion: SCHEMA_VERSION,
    generator: { name: APP_NAME, version: APP_VERSION },
    savedAt,
    document: {
      id: doc.id,
      name: doc.name,
      units: doc.units,
      createdAt: doc.createdAt,
      modifiedAt: doc.modifiedAt,
      parts: doc.parts.map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        visible: p.visible,
        features: p.features.map((f) => ({ ...f, dependsOn: featureDependencies(f) })),
      })),
      resources: doc.resources,
      ...(doc.assembly ? { assembly: doc.assembly } : {}),
    },
  };
  return JSON.stringify(file, null, 2);
}

export type ParseOutcome =
  | { ok: true; doc: CadDocument; warnings: string[]; migratedFrom: number | null; savedAt: string | null }
  | { ok: false; error: string; details: string[] };

/** Migration explicite d'un document brut de la version `n` vers `n + 1`. */
export type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

/** Table des migrations : clé = version de départ. Aucune pour l'instant (version 1). */
export const MIGRATIONS: Record<number, Migration> = {};

export function parseNativeFile(text: string, migrations: Record<number, Migration> = MIGRATIONS, currentVersion = SCHEMA_VERSION): ParseOutcome {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "Ce fichier n’est pas un projet lisible : son contenu n’est pas du JSON valide.", details: [] };
  }
  if (!isObject(raw) || raw.format !== FORMAT_ID) {
    return { ok: false, error: `Ce fichier n’est pas un projet ${APP_NAME}.`, details: [] };
  }
  const version = raw.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { ok: false, error: 'La version du format de ce fichier est inconnue.', details: [] };
  }
  if (version > currentVersion) {
    return {
      ok: false,
      error: `Ce projet a été enregistré avec une version plus récente de ${APP_NAME} (format ${version}). Mettez l’application à jour pour l’ouvrir.`,
      details: [],
    };
  }
  let file: Record<string, unknown> = raw;
  for (let v = version; v < currentVersion; v++) {
    const migrate = migrations[v];
    if (!migrate) return { ok: false, error: `Aucune migration n’est disponible depuis le format ${v}.`, details: [] };
    file = { ...migrate(file), schemaVersion: v + 1 };
  }
  const v = new Validator();
  const doc = readDocument(v, file.document, 'document');
  if (v.errors.length > 0 || !doc) {
    return {
      ok: false,
      error: "Le projet est endommagé ou incomplet : il ne peut pas être ouvert sans risque d’erreur.",
      details: v.errors.slice(0, 20),
    };
  }
  checkReferences(v, doc);
  if (v.errors.length > 0) {
    return { ok: false, error: 'Le projet contient des références incohérentes entre ses étapes.', details: v.errors.slice(0, 20) };
  }
  return {
    ok: true,
    doc,
    warnings: v.warnings,
    migratedFrom: version < currentVersion ? version : null,
    savedAt: typeof file.savedAt === 'string' ? file.savedAt : null,
  };
}

// ---------------------------------------------------------------------------
// Validation structurelle

class Validator {
  errors: string[] = [];
  warnings: string[] = [];
  error(path: string, message: string) {
    this.errors.push(`${path} : ${message}`);
  }
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function str(v: Validator, o: Record<string, unknown>, key: string, path: string): string {
  const x = o[key];
  if (typeof x !== 'string') {
    v.error(`${path}.${key}`, 'texte attendu');
    return '';
  }
  return x;
}

function num(v: Validator, o: Record<string, unknown>, key: string, path: string, opts: { min?: number; max?: number; integer?: boolean } = {}): number {
  const x = o[key];
  if (typeof x !== 'number' || !Number.isFinite(x)) {
    v.error(`${path}.${key}`, 'nombre attendu');
    return 0;
  }
  if (opts.integer && !Number.isInteger(x)) v.error(`${path}.${key}`, 'nombre entier attendu');
  if (opts.min !== undefined && x < opts.min) v.error(`${path}.${key}`, `doit être ≥ ${opts.min}`);
  if (opts.max !== undefined && x > opts.max) v.error(`${path}.${key}`, `doit être ≤ ${opts.max}`);
  return x;
}

function bool(v: Validator, o: Record<string, unknown>, key: string, path: string, fallback?: boolean): boolean {
  const x = o[key];
  if (typeof x !== 'boolean') {
    if (fallback !== undefined && x === undefined) return fallback;
    v.error(`${path}.${key}`, 'booléen attendu');
    return false;
  }
  return x;
}

function oneOf<T extends string>(v: Validator, o: Record<string, unknown>, key: string, path: string, values: readonly T[]): T {
  const x = o[key];
  if (typeof x !== 'string' || !values.includes(x as T)) {
    v.error(`${path}.${key}`, `valeur attendue parmi ${values.join(', ')}`);
    return values[0]!;
  }
  return x as T;
}

function obj(v: Validator, x: unknown, path: string): Record<string, unknown> | null {
  if (!isObject(x)) {
    v.error(path, 'objet attendu');
    return null;
  }
  return x;
}

function arr(v: Validator, o: Record<string, unknown>, key: string, path: string): unknown[] {
  const x = o[key];
  if (!Array.isArray(x)) {
    v.error(`${path}.${key}`, 'liste attendue');
    return [];
  }
  return x;
}

function readDocument(v: Validator, x: unknown, path: string): CadDocument | null {
  const o = obj(v, x, path);
  if (!o) return null;
  const units = o.units;
  if (units !== 'mm') v.error(`${path}.units`, 'seule l’unité « mm » est prise en charge');
  const parts = arr(v, o, 'parts', path).map((p, i) => readPart(v, p, `${path}.parts[${i}]`));
  const resourcesRaw = obj(v, o.resources ?? {}, `${path}.resources`) ?? {};
  const resources: Record<string, Resource> = {};
  for (const [id, r] of Object.entries(resourcesRaw)) {
    const res = readResource(v, r, `${path}.resources.${id}`);
    if (res) {
      if (res.id !== id) v.error(`${path}.resources.${id}.id`, 'identifiant différent de la clé');
      resources[id] = res;
    }
  }
  const doc: CadDocument = {
    id: str(v, o, 'id', path),
    name: str(v, o, 'name', path),
    units: 'mm',
    createdAt: str(v, o, 'createdAt', path),
    modifiedAt: str(v, o, 'modifiedAt', path),
    parts: parts.filter((p): p is Part => p !== null),
    resources,
  };
  if (o.assembly !== undefined) {
    const assembly = readAssembly(v, o.assembly, `${path}.assembly`, new Set(doc.parts.map((p) => p.id)));
    if (assembly) doc.assembly = assembly;
  }
  return doc;
}

function readLcs(v: Validator, x: unknown, path: string): LcsRef {
  const o = obj(v, x, path) ?? {};
  const kind = oneOf(v, o, 'kind', path, ['face', 'circle', 'edge'] as const);
  if (kind === 'face') return { kind, face: readFaceRef(v, o.face, `${path}.face`) };
  const e = obj(v, o.edge, `${path}.edge`) ?? {};
  const faces = arr(v, e, 'faces', `${path}.edge`);
  if (faces.length !== 2) v.error(`${path}.edge.faces`, 'deux faces attendues');
  return { kind, edge: { faces: [readFaceRef(v, faces[0], `${path}.edge.faces[0]`), readFaceRef(v, faces[1], `${path}.edge.faces[1]`)] } };
}

function readLimits(v: Validator, o: Record<string, unknown>, key: string, path: string): [number, number] | undefined {
  if (o[key] === undefined) return undefined;
  const a = Array.isArray(o[key]) ? (o[key] as unknown[]) : [];
  if (a.length !== 2 || a.some((x) => typeof x !== 'number' || !Number.isFinite(x))) {
    v.error(`${path}.${key}`, 'deux nombres attendus [min, max]');
    return undefined;
  }
  return [a[0] as number, a[1] as number];
}

function readAssembly(v: Validator, x: unknown, path: string, partIds: ReadonlySet<string>): Assembly | null {
  const o = obj(v, x, path);
  if (!o) return null;
  const instances: AssemblyInstance[] = [];
  arr(v, o, 'instances', path).forEach((raw, i) => {
    const ip = `${path}.instances[${i}]`;
    const io = obj(v, raw, ip);
    if (!io) return;
    const pos = obj(v, io.position, `${ip}.position`) ?? {};
    const instance: AssemblyInstance = {
      id: str(v, io, 'id', ip),
      partId: str(v, io, 'partId', ip),
      name: str(v, io, 'name', ip),
      position: { x: num(v, pos, 'x', `${ip}.position`), y: num(v, pos, 'y', `${ip}.position`), z: num(v, pos, 'z', `${ip}.position`) },
    };
    if (!partIds.has(instance.partId)) {
      v.warnings.push(`Assemblage : « ${instance.name} » vise une pièce absente ; elle est retirée de l’assemblage.`);
      return;
    }
    instances.push(instance);
  });
  const ids = new Set(instances.map((i) => i.id));
  const joints: AssemblyJoint[] = [];
  arr(v, o, 'joints', path).forEach((raw, i) => {
    const jp = `${path}.joints[${i}]`;
    const jo = obj(v, raw, jp);
    if (!jo) return;
    const end = (key: 'moving' | 'base') => {
      const eo = obj(v, jo[key], `${jp}.${key}`) ?? {};
      return { instanceId: str(v, eo, 'instanceId', `${jp}.${key}`), lcs: readLcs(v, eo.lcs, `${jp}.${key}.lcs`) };
    };
    const joint: AssemblyJoint = {
      id: str(v, jo, 'id', jp),
      name: str(v, jo, 'name', jp),
      kind: oneOf(v, jo, 'kind', jp, ['fixed', 'revolute', 'slider', 'cylindrical'] as const),
      moving: end('moving'),
      base: end('base'),
      flip: jo.flip === true,
      angle: num(v, jo, 'angle', jp),
      offset: num(v, jo, 'offset', jp),
    };
    const angleLimits = readLimits(v, jo, 'angleLimits', jp);
    const offsetLimits = readLimits(v, jo, 'offsetLimits', jp);
    if (angleLimits) joint.angleLimits = angleLimits;
    if (offsetLimits) joint.offsetLimits = offsetLimits;
    if (!ids.has(joint.moving.instanceId) || !ids.has(joint.base.instanceId)) {
      v.warnings.push(`Assemblage : la liaison « ${joint.name} » vise une pièce retirée ; elle est supprimée.`);
      return;
    }
    joints.push(joint);
  });
  return { instances, joints };
}

function readPart(v: Validator, x: unknown, path: string): Part | null {
  const o = obj(v, x, path);
  if (!o) return null;
  const color = str(v, o, 'color', path);
  if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) v.error(`${path}.color`, 'couleur #rrggbb attendue');
  const features = arr(v, o, 'features', path).map((f, i) => readFeature(v, f, `${path}.features[${i}]`));
  return {
    id: str(v, o, 'id', path),
    name: str(v, o, 'name', path),
    color,
    visible: bool(v, o, 'visible', path, true),
    features: features.filter((f): f is Feature => f !== null),
  };
}

const DIRECTIONS = ['default', 'reversed', 'symmetric'] as const;

function readFeature(v: Validator, x: unknown, path: string): Feature | null {
  const o = obj(v, x, path);
  if (!o) return null;
  const id = str(v, o, 'id', path);
  const name = str(v, o, 'name', path);
  const type = oneOf(v, o, 'type', path, ['sketch', 'extrude', 'pocket', 'revolve', 'imported-solid', 'fillet', 'chamfer'] as const);
  const p = obj(v, o.params, `${path}.params`);
  if (!p) return null;
  const pp = `${path}.params`;
  switch (type) {
    case 'sketch':
      return { id, name, type, visible: bool(v, o, 'visible', path, true), params: readSketchParams(v, p, pp) };
    case 'extrude':
      return {
        id,
        name,
        type,
        params: {
          sketchId: str(v, p, 'sketchId', pp),
          distance: num(v, p, 'distance', pp),
          direction: oneOf(v, p, 'direction', pp, DIRECTIONS),
        },
      };
    case 'revolve': {
      const a = obj(v, p.axis, `${pp}.axis`) ?? {};
      const kind = oneOf(v, a, 'kind', `${pp}.axis`, ['sketch-x', 'sketch-y', 'line'] as const);
      const axis = kind === 'line' ? { kind, lineId: str(v, a, 'lineId', `${pp}.axis`) } : { kind };
      return {
        id,
        name,
        type,
        params: { sketchId: str(v, p, 'sketchId', pp), axis, angle: num(v, p, 'angle', pp, { min: 0, max: 360 }), reversed: p.reversed === true },
      };
    }
    case 'pocket': {
      const e = obj(v, p.extent, `${pp}.extent`);
      const kind = e ? oneOf(v, e, 'kind', `${pp}.extent`, ['distance', 'throughAll'] as const) : 'throughAll';
      const extent = kind === 'distance' && e ? { kind, distance: num(v, e, 'distance', `${pp}.extent`) } : ({ kind: 'throughAll' } as const);
      return {
        id,
        name,
        type,
        params: { sketchId: str(v, p, 'sketchId', pp), extent, direction: oneOf(v, p, 'direction', pp, DIRECTIONS) },
      };
    }
    case 'imported-solid':
      return {
        id,
        name,
        type,
        params: { resourceId: str(v, p, 'resourceId', pp), solidIndex: num(v, p, 'solidIndex', pp, { min: 0, integer: true }) },
      };
    case 'fillet':
      return { id, name, type, params: { edges: readEdges(v, p, pp), radius: num(v, p, 'radius', pp, { min: 0 }) } };
    case 'chamfer':
      return { id, name, type, params: { edges: readEdges(v, p, pp), distance: num(v, p, 'distance', pp, { min: 0 }) } };
  }
}

function readFaceRef(v: Validator, x: unknown, path: string): FaceRef {
  const r = obj(v, x, path) ?? {};
  const ref: FaceRef = {
    featureId: str(v, r, 'featureId', path),
    role: oneOf(v, r, 'role', path, ['start', 'end', 'side', 'imported', 'blend'] as const),
  };
  if (r.entityId !== undefined) ref.entityId = str(v, r, 'entityId', path);
  if (r.index !== undefined) ref.index = num(v, r, 'index', path, { integer: true, min: 0 });
  return ref;
}

function readEdges(v: Validator, p: Record<string, unknown>, path: string): EdgeRef[] {
  return arr(v, p, 'edges', path).map((e, i) => {
    const ep = `${path}.edges[${i}]`;
    const o = obj(v, e, ep) ?? {};
    const faces = arr(v, o, 'faces', ep);
    if (faces.length !== 2) v.error(`${ep}.faces`, 'deux faces attendues');
    return { faces: [readFaceRef(v, faces[0], `${ep}.faces[0]`), readFaceRef(v, faces[1], `${ep}.faces[1]`)] };
  });
}

function readSupport(v: Validator, x: unknown, path: string): SketchSupport {
  const o = obj(v, x, path);
  if (!o) return { kind: 'plane', plane: 'XY', offset: 0 };
  const kind = oneOf(v, o, 'kind', path, ['plane', 'face'] as const);
  if (kind === 'plane') {
    return { kind, plane: oneOf(v, o, 'plane', path, ['XY', 'XZ', 'YZ'] as const), offset: typeof o.offset === 'number' ? o.offset : 0 };
  }
  const r = obj(v, o.ref, `${path}.ref`);
  if (!r) return { kind: 'plane', plane: 'XY', offset: 0 };
  return { kind, ref: readFaceRef(v, r, `${path}.ref`) };
}

function readSketchParams(v: Validator, p: Record<string, unknown>, path: string): SketchParams {
  const support = readSupport(v, p.support, `${path}.support`);
  const entities: SketchEntity[] = [];
  arr(v, p, 'entities', path).forEach((e, i) => {
    const ep = `${path}.entities[${i}]`;
    const o = obj(v, e, ep);
    if (!o) return;
    const type = oneOf(v, o, 'type', ep, ['point', 'line', 'circle', 'arc'] as const);
    const id = str(v, o, 'id', ep);
    if (type === 'point') {
      entities.push({ id, type, x: num(v, o, 'x', ep), y: num(v, o, 'y', ep) });
      return;
    }
    const flags: { construction?: boolean; reference?: { edge: EdgeRef } } = {};
    if (o.construction === true) flags.construction = true;
    if (o.reference !== undefined) {
      const r = obj(v, o.reference, `${ep}.reference`);
      const faces = r ? arr(v, obj(v, r.edge, `${ep}.reference.edge`) ?? {}, 'faces', `${ep}.reference.edge`) : [];
      if (faces.length !== 2) v.error(`${ep}.reference.edge.faces`, 'deux faces attendues');
      else flags.reference = { edge: { faces: [readFaceRef(v, faces[0], `${ep}.reference.edge.faces[0]`), readFaceRef(v, faces[1], `${ep}.reference.edge.faces[1]`)] } };
    }
    if (type === 'line') entities.push({ id, type, a: str(v, o, 'a', ep), b: str(v, o, 'b', ep), ...flags });
    else if (type === 'arc') entities.push({ id, type, center: str(v, o, 'center', ep), start: str(v, o, 'start', ep), end: str(v, o, 'end', ep), ...flags });
    else entities.push({ id, type, center: str(v, o, 'center', ep), radius: num(v, o, 'radius', ep, { min: 0 }), ...flags });
  });
  const constraints: SketchConstraint[] = [];
  arr(v, p, 'constraints', path).forEach((c, i) => {
    const cp = `${path}.constraints[${i}]`;
    const o = obj(v, c, cp);
    if (!o) return;
    const id = str(v, o, 'id', cp);
    const type = oneOf(v, o, 'type', cp, [
      'coincident',
      'horizontal',
      'vertical',
      'length',
      'distance',
      'distanceX',
      'distanceY',
      'diameter',
      'radius',
      'parallel',
      'perpendicular',
      'collinear',
      'equal',
      'tangent',
      'pointOn',
      'midpoint',
      'angle',
      'pointLineDistance',
    ] as const);
    const offset = {
      ...(typeof o.offset === 'number' && Number.isFinite(o.offset) ? { offset: o.offset } : {}),
      ...(typeof o.labelAngle === 'number' && Number.isFinite(o.labelAngle) ? { labelAngle: o.labelAngle } : {}),
    };
    switch (type) {
      case 'coincident':
        constraints.push({ id, type, a: str(v, o, 'a', cp), b: str(v, o, 'b', cp) });
        break;
      case 'horizontal':
      case 'vertical':
        constraints.push({ id, type, line: str(v, o, 'line', cp) });
        break;
      case 'length':
        constraints.push({ id, type, line: str(v, o, 'line', cp), value: num(v, o, 'value', cp, { min: 0 }), ...offset });
        break;
      case 'distance':
      case 'distanceX':
      case 'distanceY':
        constraints.push({ id, type, a: str(v, o, 'a', cp), b: str(v, o, 'b', cp), value: num(v, o, 'value', cp, { min: 0 }), ...offset });
        break;
      case 'diameter':
      case 'radius':
        constraints.push({ id, type, circle: str(v, o, 'circle', cp), value: num(v, o, 'value', cp, { min: 0 }), ...offset });
        break;
      case 'parallel':
      case 'perpendicular':
      case 'collinear':
      case 'equal':
        constraints.push({ id, type, a: str(v, o, 'a', cp), b: str(v, o, 'b', cp) });
        break;
      case 'tangent':
        constraints.push({ id, type, a: str(v, o, 'a', cp), b: str(v, o, 'b', cp), ...(o.internal === true ? { internal: true } : {}) });
        break;
      case 'pointOn':
        constraints.push({ id, type, point: str(v, o, 'point', cp), curve: str(v, o, 'curve', cp) });
        break;
      case 'midpoint':
        constraints.push({ id, type, point: str(v, o, 'point', cp), line: str(v, o, 'line', cp) });
        break;
      case 'angle':
        constraints.push({
          id,
          type,
          a: str(v, o, 'a', cp),
          b: str(v, o, 'b', cp),
          value: num(v, o, 'value', cp, { min: 0, max: 180 }),
          ...(o.supplementary === true ? { supplementary: true } : {}),
          ...offset,
        });
        break;
      case 'pointLineDistance':
        constraints.push({ id, type, point: str(v, o, 'point', cp), line: str(v, o, 'line', cp), value: num(v, o, 'value', cp, { min: 0 }), ...offset });
        break;
    }
  });
  return { support, entities, constraints };
}

function readResource(v: Validator, x: unknown, path: string): Resource | null {
  const o = obj(v, x, path);
  if (!o) return null;
  const data = str(v, o, 'data', path);
  return {
    id: str(v, o, 'id', path),
    kind: oneOf(v, o, 'kind', path, ['step'] as const),
    fileName: str(v, o, 'fileName', path),
    encoding: oneOf(v, o, 'encoding', path, ['utf8', 'base64'] as const),
    data,
    byteLength: num(v, o, 'byteLength', path, { min: 0, integer: true }),
    sha256: str(v, o, 'sha256', path),
    importedAt: str(v, o, 'importedAt', path),
  };
}

// ---------------------------------------------------------------------------
// Cohérence des références

function checkReferences(v: Validator, doc: CadDocument): void {
  const ids = new Set<string>();
  const unique = (id: string, path: string) => {
    if (ids.has(id)) v.error(path, `identifiant en double « ${id} »`);
    ids.add(id);
  };
  unique(doc.id, 'document.id');
  doc.parts.forEach((part, pi) => {
    unique(part.id, `document.parts[${pi}].id`);
    const seen = new Map<string, Feature>();
    part.features.forEach((f, fi) => {
      const path = `document.parts[${pi}].features[${fi}]`;
      unique(f.id, `${path}.id`);
      for (const dep of featureDependencies(f)) {
        const target = seen.get(dep);
        if (!target) {
          // Référence vers une étape absente ou placée après : récupérable (erreur affichée à l'étape).
          v.warnings.push(`${f.name} : l’étape référencée « ${dep} » est introuvable avant elle.`);
        } else if ((f.type === 'extrude' || f.type === 'pocket') && target.type !== 'sketch') {
          v.error(`${path}.params.sketchId`, 'doit désigner une esquisse');
        }
      }
      if (f.type === 'imported-solid' && !doc.resources[f.params.resourceId]) {
        v.warnings.push(`${f.name} : les données du fichier importé sont absentes.`);
      }
      if (f.type === 'sketch') checkSketch(v, f.params, f.name, path);
      seen.set(f.id, f);
    });
  });
}

function checkSketch(v: Validator, sketch: SketchParams, name: string, path: string): void {
  const entityIds = new Set<string>();
  const points = new Set<string>([ORIGIN_POINT_ID]);
  sketch.entities.forEach((e, i) => {
    if (entityIds.has(e.id) || e.id === ORIGIN_POINT_ID) v.error(`${path}.params.entities[${i}].id`, `identifiant en double « ${e.id} »`);
    entityIds.add(e.id);
    if (e.type === 'point') points.add(e.id);
  });
  for (const e of sketch.entities) {
    if (e.type === 'line' && (!points.has(e.a) || !points.has(e.b))) v.error(`${path}.params`, `le segment « ${e.id} » vise un point absent`);
    if (e.type === 'circle' && !points.has(e.center)) v.error(`${path}.params`, `le cercle « ${e.id} » vise un centre absent`);
    if (e.type === 'arc' && (!points.has(e.center) || !points.has(e.start) || !points.has(e.end))) v.error(`${path}.params`, `l’arc « ${e.id} » vise un point absent`);
  }
  const constraintIds = new Set<string>();
  for (const c of sketch.constraints) {
    if (constraintIds.has(c.id)) v.error(`${path}.params`, `contrainte en double « ${c.id} »`);
    constraintIds.add(c.id);
    const refs = constraintReferences(c);
    if (refs.some((r) => r !== ORIGIN_POINT_ID && !entityIds.has(r))) {
      v.warnings.push(`${name} : une contrainte vise un élément absent ; elle sera ignorée.`);
    }
  }
}
