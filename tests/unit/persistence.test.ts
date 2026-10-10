import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { parseNativeFile, serializeDocument } from '../../src/io/native-format';
import { AutosaveScheduler, type AutosaveStatus } from '../../src/persistence/autosave';
import { ProjectStore } from '../../src/persistence/db';
import { buildPlateDocument } from '../helpers/plate';

describe('stockage local (IndexedDB)', () => {
  it('enregistre, liste, relit et supprime des projets', async () => {
    const store = await ProjectStore.open(new IDBFactory());
    const { doc } = buildPlateDocument();
    const text = serializeDocument(doc);
    await store.putProject({ id: doc.id, name: doc.name, savedAt: '2026-10-09T10:00:00.000Z', text, size: text.length });
    const list = await store.listProjects();
    expect(list).toEqual([{ id: doc.id, name: doc.name, savedAt: '2026-10-09T10:00:00.000Z', size: text.length }]);
    const rec = await store.getProject(doc.id);
    const parsed = parseNativeFile(rec!.text);
    expect(parsed.ok && parsed.doc).toEqual(doc);
    await store.setSetting('lastProjectId', doc.id);
    expect(await store.getSetting('lastProjectId')).toBe(doc.id);
    await store.deleteProject(doc.id);
    expect(await store.listProjects()).toEqual([]);
    store.close();
  });

  it('écrit une sauvegarde automatique récupérable', async () => {
    const store = await ProjectStore.open(new IDBFactory());
    const statuses: AutosaveStatus[] = [];
    const autosave = new AutosaveScheduler(store, (s) => statuses.push(s), 10_000);
    const { doc } = buildPlateDocument();
    autosave.schedule(doc, null);
    expect(statuses.at(-1)).toEqual({ kind: 'pending' });
    await autosave.flush();
    expect(statuses.at(-1)?.kind).toBe('saved');
    const saved = await store.getAutosave(doc.id);
    expect(saved?.basedOnSavedAt).toBeNull();
    const parsed = parseNativeFile(saved!.text);
    expect(parsed.ok && parsed.doc.parts[0]!.features).toHaveLength(4);
    expect((await store.listAutosaves()).map((a) => a.projectId)).toEqual([doc.id]);
    store.close();
  });
});
