import type { ImportedSolidFeature } from '../../domain/model';
import type { FeatureDefinition, ParamIssue } from '../definition';

export const importedSolidDefinition: FeatureDefinition<ImportedSolidFeature> = {
  type: 'imported-solid',
  label: 'Solide importé',
  namePrefix: 'Solide importé',
  explanation:
    "Solide importé : un volume venu d’un fichier STEP. Sa forme est conservée dans le projet, mais pas les étapes qui ont servi à le dessiner.",
  icon: 'import',
  affectsSolid: true,
  dependencies: () => [],
  validate(feature) {
    const issues: ParamIssue[] = [];
    if (!Number.isInteger(feature.params.solidIndex) || feature.params.solidIndex < 0) {
      issues.push({ field: 'solidIndex', message: 'Le numéro de solide est invalide.' });
    }
    return issues;
  },
  summary: (feature) => `solide n° ${feature.params.solidIndex + 1} du fichier embarqué`,
};
