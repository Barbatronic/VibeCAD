/**
 * Raccourcis clavier, selon le mode actif. Les touches tapées dans un champ de saisie ne sont
 * pas interceptées (Suppr efface du texte, Ctrl+Z annule la frappe…).
 */
import { allows } from './levels';
import {
  cancelEditor,
  clearSelection,
  confirmEditor,
  confirmInput,
  deleteSelection,
  escape,
  finishSpline,
  redo,
  setTool,
  toggleConstruction,
  typeIntoEditor,
  typeIntoInput,
  undo,
  type SketchTool,
} from '../sketch/session';
import type { StandardView } from '../viewport/camera-rig';
import type { AppController } from './controller';

const VIEW_KEYS: Record<string, StandardView> = { '0': 'iso', '1': 'front', '2': 'top', '3': 'right', '4': 'back', '5': 'bottom', '6': 'left' };
const SKETCH_KEYS: Record<string, SketchTool> = { l: 'line', r: 'rectangle', c: 'circle', d: 'dimension', h: 'horizontal', v: 'vertical', o: 'coincident', s: 'select', p: 'project', a: 'arc', t: 'trim' };

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (target as HTMLInputElement).type;
    return !['checkbox', 'radio', 'button', 'color', 'range'].includes(type);
  }
  return false;
}

export function installKeyboard(controller: AppController): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    const s = controller.state;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (s.dialog) return;

    // Raccourcis valables partout (sauf dans un champ pour annuler/rétablir).
    if (mod && key === 's') {
      e.preventDefault();
      if (e.shiftKey) void controller.saveAs();
      else void controller.save();
      return;
    }
    if (mod && key === 'o') {
      e.preventDefault();
      void controller.showOpenDialog();
      return;
    }
    if (e.key === 'F1') {
      e.preventDefault();
      controller.toggleHelp();
      return;
    }
    if (isTyping(e.target)) return;
    // Création d'une liaison : Maj maintenue verrouille la face survolée pour viser un sommet.
    if (s.mode.kind === 'joint' && e.key === 'Shift') {
      if (!e.repeat) controller.lockJointFace(true);
      return;
    }

    if (mod && (key === 'z' || key === 'y')) {
      e.preventDefault();
      const isRedo = key === 'y' || e.shiftKey;
      if (s.mode.kind === 'sketch') controller.updateSession(isRedo ? redo : undo);
      else if (isRedo) controller.redo();
      else controller.undo();
      return;
    }
    if (mod || e.altKey) return;

    // Chiffres tapés pendant un tracé ou une cote alors qu'aucun champ n'a le focus : ils sont
    // ajoutés directement à l'état (le champ prend le focus juste après, rien n'est perdu).
    if (s.mode.kind === 'sketch') {
      const sess = s.mode.session;
      const isValueKey = /^[0-9.,+*/()-]$/.test(e.key) || e.key === 'Backspace';
      if (sess.editor) {
        if (isValueKey) {
          e.preventDefault();
          controller.updateSession((x) => typeIntoEditor(x, e.key));
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          controller.updateSession(confirmEditor);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          controller.updateSession(cancelEditor);
          return;
        }
      } else if (sess.input && sess.start) {
        if (isValueKey && (e.key !== 'Backspace' || sess.input.values.some((v) => v))) {
          e.preventDefault();
          controller.updateSession((x) => typeIntoInput(x, e.key));
          return;
        }
        if (e.key === 'Tab' && sess.input.values.length > 1) {
          e.preventDefault();
          controller.updateSession((x) => typeIntoInput(x, 'Tab'));
          return;
        }
        if (e.key === 'Enter' && sess.input.values.some((v) => v)) {
          e.preventDefault();
          controller.updateSession(confirmInput);
          return;
        }
      }
    }

    // Spline en cours : Entrée la termine (ouverte).
    if (e.key === 'Enter' && s.mode.kind === 'sketch' && s.mode.session.tool === 'spline' && s.mode.session.spline) {
      e.preventDefault();
      controller.updateSession(finishSpline);
      return;
    }
    if (e.key === 'Escape') {
      if (s.helpOpen) return controller.toggleHelp(false);
      switch (s.mode.kind) {
        case 'sketch':
          controller.updateSession(escape);
          return;
        case 'feature':
          controller.cancelDraft();
          return;
        case 'pick-support':
          controller.cancelPickSupport();
          return;
        case 'measure':
          controller.exitMeasure();
          return;
        case 'joint':
          controller.cancelJoint();
          return;
        case 'pick-fab-face':
          controller.cancelFabricationPick();
          return;
        case 'pick-sim-face':
          controller.cancelSimulationPick();
          return;
        case 'fastener':
          controller.cancelFastener();
          return;
        default:
          if (s.workspace === 'assembly') controller.selectInAssembly(null);
          else controller.select(null);
          return;
      }
    }
    // Espace dans l'esquisse : tout désélectionner (sauf sur un bouton, qu'Espace actionne).
    if (e.key === ' ' && s.mode.kind === 'sketch' && !(e.target as HTMLElement | null)?.closest?.('button, [role="button"], a, [data-constraint]')) {
      e.preventDefault();
      controller.updateSession(clearSelection);
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      if (s.mode.kind === 'sketch') controller.updateSession(deleteSelection);
      else if (s.workspace === 'assembly') {
        const sel = s.assemblySelection;
        if (sel?.kind === 'joint') controller.removeJoint(sel.id);
        else if (sel?.kind === 'fasteners') controller.removeFasteners(sel.ids);
        else if (sel) controller.removeInstance(sel.id);
      } else if (s.mode.kind === 'model') controller.deleteSelection();
      return;
    }
    if (e.key === 'Enter' && s.mode.kind === 'feature') {
      e.preventDefault();
      controller.confirmDraft();
      return;
    }
    if (s.mode.kind === 'sketch') {
      const tool = key === 'r' && e.shiftKey ? 'centerRectangle' : SKETCH_KEYS[key];
      // Raccourci d'un outil masqué à ce niveau : ignoré.
      if (tool && allows(s.level, `sketch:${tool}`) && !s.mode.session.input?.values.some((v) => v)) {
        e.preventDefault();
        controller.updateSession((x) => setTool(x, tool));
      }
      if (key === 'g' && allows(s.level, 'sketch-construction') && !s.mode.session.input?.values.some((v) => v)) {
        e.preventDefault();
        controller.updateSession(toggleConstruction);
      }
      if (key === 'f') controller.fitAll();
      return;
    }
    if (s.mode.kind === 'model' || s.mode.kind === 'measure' || s.mode.kind === 'pick-support') {
      const view = VIEW_KEYS[e.key];
      if (view) {
        e.preventDefault();
        controller.setView(view);
        return;
      }
      if (key === 'f') {
        e.preventDefault();
        controller.fitAll();
      }
    }
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key === 'Shift') controller.lockJointFace(false);
  };
  // Fenêtre quittée touche enfoncée : on déverrouille.
  const onBlur = () => controller.lockJointFace(false);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  return () => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
  };
}
