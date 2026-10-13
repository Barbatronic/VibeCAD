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
import { LoftPanel } from '../features/loft/panel';
import { SweepPanel } from '../features/sweep/panel';
import { MirrorPanel } from '../features/mirror/panel';
import { PatternPanel } from '../features/pattern/panel';
import { PrimitivePanel } from '../features/primitive/panel';
import { GearPanel } from '../features/gear/panel';
import { MovePanel } from '../features/move/panel';
import { HolePanel } from '../features/hole/panel';
import { ShellPanel } from '../features/shell/panel';
import { RevolvePanel } from '../features/revolve/panel';
import { SplitPanel } from '../features/split/panel';
import { DraftPanel } from '../features/draft/panel';
import { ThickenPanel } from '../features/thicken/panel';

export const FEATURE_PANELS: Partial<Record<FeatureType, FunctionComponent<FeaturePanelProps<never>>>> = {
  extrude: ExtrudePanel as FunctionComponent<FeaturePanelProps<never>>,
  pocket: PocketPanel as FunctionComponent<FeaturePanelProps<never>>,
  revolve: RevolvePanel as FunctionComponent<FeaturePanelProps<never>>,
  loft: LoftPanel as FunctionComponent<FeaturePanelProps<never>>,
  sweep: SweepPanel as FunctionComponent<FeaturePanelProps<never>>,
  pattern: PatternPanel as FunctionComponent<FeaturePanelProps<never>>,
  primitive: PrimitivePanel as FunctionComponent<FeaturePanelProps<never>>,
  gear: GearPanel as FunctionComponent<FeaturePanelProps<never>>,
  move: MovePanel as FunctionComponent<FeaturePanelProps<never>>,
  hole: HolePanel as FunctionComponent<FeaturePanelProps<never>>,
  shell: ShellPanel as FunctionComponent<FeaturePanelProps<never>>,
  thicken: ThickenPanel as FunctionComponent<FeaturePanelProps<never>>,
  draft: DraftPanel as FunctionComponent<FeaturePanelProps<never>>,
  split: SplitPanel as FunctionComponent<FeaturePanelProps<never>>,
  mirror: MirrorPanel as FunctionComponent<FeaturePanelProps<never>>,
  fillet: FilletPanel as FunctionComponent<FeaturePanelProps<never>>,
  chamfer: ChamferPanel as FunctionComponent<FeaturePanelProps<never>>,
};
