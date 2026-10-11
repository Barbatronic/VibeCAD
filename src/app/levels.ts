/**
 * Niveaux de l'interface (Débutant, Intermédiaire, Expert) : chaque niveau montre plus d'outils.
 * Un outil d'un niveau supérieur est masqué (l'écran reste simple), mais un projet fait à un
 * niveau supérieur s'ouvre toujours : ses étapes restent visibles et modifiables dans
 * l'historique. Le niveau est retenu sur l'appareil, pas dans le projet.
 */
import type { FeatureType } from '../domain/model';
import type { SketchTool } from '../sketch/session';

export type Level = 'debutant' | 'intermediaire' | 'expert';

export const LEVELS: { id: Level; label: string; description: string }[] = [
  { id: 'debutant', label: 'Débutant', description: 'Les outils de base : dessiner, coter, extruder, percer, imprimer.' },
  { id: 'intermediaire', label: 'Intermédiaire', description: 'En plus : arcs et formes, révolution, congés, répétitions, assemblage, découpe laser, plans.' },
  { id: 'expert', label: 'Expert', description: 'Tous les outils, dont l’import de fichiers d’autres logiciels.' },
];

const RANK: Record<Level, number> = { debutant: 0, intermediaire: 1, expert: 2 };

/** Ce que le niveau peut montrer. */
export type Capability =
  | `feature:${FeatureType}`
  | `sketch:${SketchTool}`
  | 'sketch-construction'
  | 'sketch-lists'
  | 'workspace:assembly'
  | 'fabrication:laser'
  | 'fabrication:docs'
  | 'import-step'
  | 'view-section'
  | 'view-centroid'
  | 'tutorial:assembly'
  | 'tutorial:fabrication';

/**
 * Niveau minimal de chaque outil (absent : Débutant). Pour déplacer un outil d'un niveau à
 * l'autre, il suffit de changer sa ligne ici.
 */
export const CAPABILITY_LEVEL: Partial<Record<Capability, Level>> = {
  'feature:revolve': 'intermediaire',
  'feature:fillet': 'intermediaire',
  'feature:chamfer': 'intermediaire',
  'feature:pattern': 'intermediaire',
  'feature:mirror': 'intermediaire',
  'feature:shell': 'intermediaire',
  'sketch:arc': 'intermediaire',
  'sketch:centerRectangle': 'intermediaire',
  'sketch:polygon': 'intermediaire',
  'sketch:slot': 'intermediaire',
  'sketch:trim': 'intermediaire',
  'sketch:offset': 'expert',
  'sketch:project': 'intermediaire',
  'sketch:parallel': 'intermediaire',
  'sketch:perpendicular': 'intermediaire',
  'sketch:equal': 'intermediaire',
  'sketch:collinear': 'intermediaire',
  'sketch:tangent': 'intermediaire',
  'sketch:pointOn': 'intermediaire',
  'sketch:midpoint': 'intermediaire',
  'sketch:concentric': 'intermediaire',
  'sketch-construction': 'intermediaire',
  'workspace:assembly': 'intermediaire',
  'fabrication:laser': 'intermediaire',
  'fabrication:docs': 'intermediaire',
  'tutorial:assembly': 'intermediaire',
  'tutorial:fabrication': 'intermediaire',
  'view-section': 'intermediaire',
  'view-centroid': 'intermediaire',
  'feature:loft': 'expert',
  'feature:sweep': 'expert',
  'feature:split': 'expert',
  'sketch-lists': 'expert',
  'feature:draft': 'expert',
  'feature:thicken': 'expert',
  'import-step': 'expert',
};

export function levelOf(cap: Capability): Level {
  return CAPABILITY_LEVEL[cap] ?? 'debutant';
}

export function allows(level: Level, cap: Capability): boolean {
  return RANK[level] >= RANK[levelOf(cap)];
}

export function levelLabel(level: Level): string {
  return LEVELS.find((l) => l.id === level)!.label;
}

/** Niveau lu dans un texte (adresse `?niveau=expert`, réglage enregistré), accents facultatifs. */
export function parseLevel(text: string | null | undefined): Level | null {
  const t = (text ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return t === 'debutant' || t === 'intermediaire' || t === 'expert' ? t : null;
}
