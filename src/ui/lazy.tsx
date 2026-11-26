/**
 * Parties de l'interface chargées à la demande : les ateliers Fabrication, Simulation, Rendu et Versions,
 * la découpe laser, l'aide, les parcours guidés, les bibliothèques de composants et l'import d'un
 * dessin. Leur code n'est téléchargé qu'à leur première ouverture ; le démarrage ne charge que la
 * conception. Une fois chargé (ou mis en cache hors ligne), l'affichage est immédiat.
 */
import type { ComponentType } from 'preact';
import { useEffect, useState } from 'preact/hooks';

/** Composant dont le module est importé à son premier affichage (rien n'est montré d'ici là). */
function lazyComponent<P extends object>(load: () => Promise<ComponentType<P>>): (props: P) => preact.JSX.Element | null {
  let Loaded: ComponentType<P> | null = null;
  let pending: Promise<void> | null = null;
  return function Lazy(props: P) {
    const [, refresh] = useState(0);
    useEffect(() => {
      if (Loaded) return;
      let alive = true;
      pending ??= load().then((c) => {
        Loaded = c;
      });
      void pending.then(() => alive && refresh((n) => n + 1));
      return () => {
        alive = false;
      };
    }, []);
    return Loaded ? <Loaded {...props} /> : null;
  };
}

const fabrication = () => import('./FabricationUi');
const simulation = () => import('./SimulationUi');
const versions = () => import('./VersionsUi');
const render = () => import('./RenderUi');

export const FabricationTools = lazyComponent(() => fabrication().then((m) => m.FabricationTools));
export const FabricationSection = lazyComponent(() => fabrication().then((m) => m.FabricationSection));
export const FabricationRightPanel = lazyComponent(() => fabrication().then((m) => m.FabricationRightPanel));
export const SimulationTools = lazyComponent(() => simulation().then((m) => m.SimulationTools));
export const SimulationSection = lazyComponent(() => simulation().then((m) => m.SimulationSection));
export const SimulationRightPanel = lazyComponent(() => simulation().then((m) => m.SimulationRightPanel));
export const SimulationTimeline = lazyComponent(() => simulation().then((m) => m.SimulationTimeline));
export const RenderTools = lazyComponent(() => render().then((m) => m.RenderTools));
export const RenderSection = lazyComponent(() => render().then((m) => m.RenderSection));
export const RenderTimeline = lazyComponent(() => render().then((m) => m.RenderTimeline));
export const VersionsTools = lazyComponent(() => versions().then((m) => m.VersionsTools));
export const VersionsSection = lazyComponent(() => versions().then((m) => m.VersionsSection));
export const VersionsRightPanel = lazyComponent(() => versions().then((m) => m.VersionsRightPanel));
export const LaserBoard = lazyComponent(() => import('./LaserBoard').then((m) => m.LaserBoard));
export const DrawingBoard = lazyComponent(() => import('./DrawingBoard').then((m) => m.DrawingBoard));
export const HelpDrawer = lazyComponent(() => import('./HelpDrawer').then((m) => m.HelpDrawer));
export const Tutorial = lazyComponent(() => import('./Tutorial').then((m) => m.Tutorial));
export const ComponentsDialog = lazyComponent(() => import('./ComponentsDialog').then((m) => m.ComponentsDialog));
export const TraceStampDialog = lazyComponent(() => import('./TraceStampDialog').then((m) => m.TraceStampDialog));
