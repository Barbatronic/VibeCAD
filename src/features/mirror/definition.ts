import { makeMirrorFeature } from '../../domain/document';
import type { MirrorFeature, MirrorPlane } from '../../domain/model';
import type { FeatureDefinition, ParamIssue } from '../definition';

export function describeMirrorPlane(plane: MirrorPlane): string {
  return plane.kind === 'plane' ? `le plan ${plane.plane}` : 'une face';
}

export const mirrorDefinition: FeatureDefinition<MirrorFeature> = {
  type: 'mirror',
  label: 'Symétrie',
  namePrefix: 'Symétrie',
  explanation: 'Symétrie : ajouter le reflet de la pièce (ou d’une étape) dans un miroir, de l’autre côté d’un plan.',
  icon: 'mirror',
  affectsSolid: true,
  dependencies: (feature) => {
    const p = feature.params;
    return Array.from(new Set([...(p.source.kind === 'feature' ? [p.source.featureId] : []), ...(p.plane.kind === 'face' ? [p.plane.ref.featureId] : [])]));
  },
  validate(feature) {
    const issues: ParamIssue[] = [];
    if (feature.params.source.kind === 'feature' && !feature.params.source.featureId) issues.push({ field: 'source', message: 'Choisissez l’étape à copier.' });
    return issues;
  },
  summary(feature) {
    const what = feature.params.source.kind === 'part' ? 'toute la pièce' : 'une étape';
    return `${what}, par rapport à ${describeMirrorPlane(feature.params.plane)}`;
  },
  tool: {
    input: 'part',
    requiresSolid: true,
    requiresSolidReason: 'Une symétrie copie un volume : créez d’abord une extrusion ou une révolution.',
    previewKind: 'modify',
    create: (doc, part) => makeMirrorFeature(doc, part),
    initialFields: () => ({}),
  },
};
