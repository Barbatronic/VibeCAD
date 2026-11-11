/**
 * Dossiers de la liste des pièces : du rangement seul, sans effet sur la géométrie ni sur
 * l'assemblage. Une pièce est dans un dossier au plus (`Part.folder`), ou hors dossier.
 */
import { createId } from './ids';
import type { CadDocument, Id, PartFolder } from './model';

export function folderList(doc: CadDocument): PartFolder[] {
  return doc.folders ?? [];
}

export function addFolder(doc: CadDocument, name?: string): { doc: CadDocument; folderId: Id } {
  const folders = folderList(doc);
  const taken = new Set<string>([...folders.map((f) => f.id), ...doc.parts.map((p) => p.id)]);
  const folderId = createId('dir', taken);
  const names = new Set(folders.map((f) => f.name));
  let n = folders.length + 1;
  while (names.has(`Dossier ${n}`)) n++;
  return { doc: { ...doc, folders: [...folders, { id: folderId, name: name ?? `Dossier ${n}` }] }, folderId };
}

export function renameFolder(doc: CadDocument, folderId: Id, name: string): CadDocument {
  return { ...doc, folders: folderList(doc).map((f) => (f.id === folderId ? { ...f, name } : f)) };
}

/** Range une pièce dans un dossier, ou la sort de son dossier (`null`). */
export function setPartFolder(doc: CadDocument, partId: Id, folderId: Id | null): CadDocument {
  if (folderId !== null && !folderList(doc).some((f) => f.id === folderId)) return doc;
  return {
    ...doc,
    parts: doc.parts.map((p) => {
      if (p.id !== partId) return p;
      const { folder: _old, ...rest } = p;
      return folderId === null ? rest : { ...rest, folder: folderId };
    }),
  };
}

/** Supprime un dossier : ses pièces restent dans le projet, hors dossier. */
export function removeFolder(doc: CadDocument, folderId: Id): CadDocument {
  const folders = folderList(doc).filter((f) => f.id !== folderId);
  const { folders: _old, ...rest } = doc;
  return {
    ...rest,
    ...(folders.length ? { folders } : {}),
    parts: doc.parts.map((p) => {
      if (p.folder !== folderId) return p;
      const { folder: _f, ...part } = p;
      return part;
    }),
  };
}

export function setFolderVisible(doc: CadDocument, folderId: Id, visible: boolean): CadDocument {
  return { ...doc, parts: doc.parts.map((p) => (p.folder === folderId && p.visible !== visible ? { ...p, visible } : p)) };
}
