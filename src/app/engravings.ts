/**
 * Dessins des opérations Gravure d'une pièce, en 3D : pour la découpe laser (calque de gravure) et
 * pour l'affichage d'un marquage de surface (profondeur 0), qui ne change pas le volume.
 */
import type { Part, SketchParams } from '../domain/model';
import { frameToWorld, type Frame3D } from '../math/frame';
import type { Vec3 } from '../math/vec';
import { extractProfiles, loopPolyline } from '../sketch/profiles';

/** Ce qu'il faut d'une esquisse résolue : son repère et sa géométrie. */
type SolvedSketch = { featureId: string; frame: Frame3D | null; solved: SketchParams };

/** Une région du dessin : contour extérieur et trous (une lettre « O » a un trou). */
export interface EngravedRegion {
  outer: Vec3[];
  holes: Vec3[][];
}

/** Dessin d'une opération Gravure : régions en 3D, normale sortante de la face gravée, réglages. */
export interface Engraving {
  regions: EngravedRegion[];
  normal: Vec3;
  depth: number;
  /** Laser : balayage de la surface (`fill`) ou trait (`outline`). */
  mode: 'outline' | 'fill';
  /** Impression 3D : fiche matière de la zone gravée. */
  material?: string;
}

/** Tous les contours d'une gravure (extérieurs et trous), pour un tracé en trait. */
export const engravingLoops = (e: Engraving): Vec3[][] => e.regions.flatMap((r) => [r.outer, ...r.holes]);

/** Régions d'une esquisse résolue, gardées tant qu'elle ne change pas (l'affichage les redemande souvent). */
const cache = new WeakMap<SketchParams, EngravedRegion[] | null>();

/** Gravures de la pièce, d'après les esquisses résolues de son dernier recalcul. */
export function partEngravings(part: Part, sketches: readonly SolvedSketch[]): Engraving[] {
  return part.features.flatMap((f) => {
    if (f.type !== 'engrave') return [];
    const sketch = sketches.find((x) => x.featureId === f.params.sketchId);
    const frame = sketch?.frame;
    if (!sketch || !frame) return [];
    if (!cache.has(sketch.solved)) {
      // Le résultat transmis par le worker est résumé : on reprend les contours de l'esquisse résolue.
      const profile = extractProfiles(sketch.solved);
      const to3d = (loop: Parameters<typeof loopPolyline>[0]) => loopPolyline(loop).map((q) => frameToWorld(frame, q));
      cache.set(sketch.solved, profile.ok ? profile.regions.map((r) => ({ outer: to3d(r.outer), holes: r.holes.map(to3d) })) : null);
    }
    const regions = cache.get(sketch.solved);
    return regions ? [{ regions, normal: frame.normal, depth: f.params.depth, mode: f.params.mode ?? 'outline', ...(f.params.material ? { material: f.params.material } : {}) }] : [];
  });
}
