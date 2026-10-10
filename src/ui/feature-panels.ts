/**
 * Registre des panneaux de paramètres (couche interface). Ajouter une fonction avec panneau :
 * créer `features/<type>/panel.tsx` puis l'enregistrer ici.
 */
import type { FunctionComponent } from 'preact';
import type { FeatureType } from '../domain/model';
import { ChamferPanel } from '../features/chamfer/panel';
import { ExtrudePanel } from '../features/extrude/panel';
import { FilletPanel } from '../features/fillet/panel';
import type { FeaturePanelProps } from '../features/panel-types';
import { PocketPanel } from '../features/pocket/panel';

export const FEATURE_PANELS: Partial<Record<FeatureType, FunctionComponent<FeaturePanelProps<never>>>> = {
  extrude: ExtrudePanel as FunctionComponent<FeaturePanelProps<never>>,
  pocket: PocketPanel as FunctionComponent<FeaturePanelProps<never>>,
  fillet: FilletPanel as FunctionComponent<FeaturePanelProps<never>>,
  chamfer: ChamferPanel as FunctionComponent<FeaturePanelProps<never>>,
};
