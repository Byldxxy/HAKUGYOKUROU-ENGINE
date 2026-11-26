import { useEffect, useRef, useState, type SetStateAction } from 'react';
import { apiFetch } from '../../config';
import { socket } from '../../socket';
import type { GraphEdge, GraphNode } from '../../components/RelationGraph';

export type Notebook = { freeNotes: string; clues: string[]; graphNodes: GraphNode[]; graphEdges: GraphEdge[] };
export type NotebookConflict = { base: Notebook; local: Notebook; server: Notebook; revision: string };
const empty: Notebook = { freeNotes: '', clues: [], graphNodes: [], graphEdges: [] };
const contentOf = ({ freeNotes, clues, graphNodes, graphEdges }: Notebook): Notebook => ({
  freeNotes: freeNotes || '', clues: clues || [], graphNodes: graphNodes || [], graphEdges: graphEdges || [],
});
type Editor = {
  roomId: string;
  key: string;
  draft: Notebook | null;
  saved: Notebook | null;
  revision: string;
  conflict: NotebookConflict | null;
  notify: (conflict: NotebookConflict | null) => void;
  writes: Promise<void>;
  timer?: number;
  detached?: boolean;
};

function storeDraft(editor: Editor) {
  if (!editor.draft || editor.detached) return;
  try {
    if (editor.saved === editor.draft) sessionStorage.removeItem(editor.key);
    else sessionStorage.setItem(editor.key, JSON.stringify({
      revision: editor.revision, base: editor.saved, draft: editor.draft,
    }));
  } catch { /* The in-memory draft still works when browser storage is unavailable. */ }
}

function readDraft(key: string): { revision: string; base: Notebook; draft: Notebook } | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || 'null');
    if (typeof value?.revision === 'string' && value.base && value.draft &&
      [value.base, value.draft].every(n => typeof n.freeNotes === 'string' &&
        Array.isArray(n.clues) && Array.isArray(n.graphNodes) && Array.isArray(n.graphEdges))) return value;
  } catch { /* Ignore inaccessible or obsolete browser data. */ }
  return null;
}

function writeDraft(editor: Editor) {
  window.clearTimeout(editor.timer);
  const write = editor.writes.then(async () => {
    if (editor.conflict) throw new Error('请先合并两台设备上的笔记。');
    const draft = editor.draft;
    if (!draft || editor.saved === draft) return;
    storeDraft(editor);
    const response = await apiFetch('/api/notebooks', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId: editor.roomId, notebook: draft, baseRevision: editor.revision }),
    });
    if (!response.ok && response.status !== 409) throw new Error('个人笔记保存失败，请检查连接后重试。');
    const { notebook } = await response.json();
    const remote = contentOf(notebook);
    if (response.status === 409 && JSON.stringify(remote) !== JSON.stringify(draft)) {
      editor.conflict = { base: editor.saved!, local: editor.draft!, server: remote, revision: notebook.revision };
      editor.notify(editor.conflict);
      throw new Error('请先合并两台设备上的笔记。');
    }
    editor.revision = notebook.revision;
    editor.saved = draft;
    storeDraft(editor);
  });
  editor.writes = write.catch(() => {});
  return write;
}

export function useCampaignNotebook(roomId?: string) {
  const current = useRef<Editor | null>(null);
  const [loaded, setLoaded] = useState<{ roomId: string; draft: Notebook } | null>(null);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState<NotebookConflict | null>(null);

  useEffect(() => {
    if (!roomId) return;
    const editor: Editor = {
      roomId, key: 'trpg_notebook:' + JSON.stringify([localStorage.getItem('trpg_username'), roomId]),
      draft: null, saved: null, revision: '0', conflict: null, writes: Promise.resolve(),
      notify: next => { if (current.current === editor) setConflict(next); },
    };
    current.current = editor;
    async function load() {
      try {
        const response = await apiFetch('/api/notebooks?roomId=' + encodeURIComponent(editor.roomId));
        if (!response.ok) throw new Error();
        const { notebook } = await response.json();
        if (current.current !== editor) return;
        const server = contentOf(notebook);
        editor.draft = editor.saved = server;
        editor.revision = notebook.revision;
        const backup = readDraft(editor.key);
        if (backup && JSON.stringify(backup.draft) !== JSON.stringify(server)) {
          editor.draft = backup.draft;
          if (backup.revision !== editor.revision) {
            editor.conflict = { base: backup.base, local: backup.draft, server, revision: editor.revision };
            editor.saved = backup.base;
            editor.revision = backup.revision;
          }
        }
        editor.notify(editor.conflict);
        setLoaded({ roomId: editor.roomId, draft: editor.draft });
        setError('');
        if (!editor.conflict) { storeDraft(editor); await writeDraft(editor); }
      } catch {
        if (current.current === editor) setError(editor.draft ? '个人笔记保存失败，请检查连接后重试。' : '个人笔记加载失败，请刷新页面重试。');
      }
    }
    void load();
    const flushForSave = async (request: { roomId: string }, acknowledge: (reply: { success: boolean }) => void) => {
      if (request.roomId !== editor.roomId || !editor.draft) return acknowledge({ success: false });
      try {
        await writeDraft(editor);
        acknowledge({ success: true });
      } catch { acknowledge({ success: false }); }
    };
    const persist = () => storeDraft(editor);
    window.addEventListener('pagehide', persist);
    socket.on('flush_notebook', flushForSave);
    return () => {
      socket.off('flush_notebook', flushForSave);
      window.removeEventListener('pagehide', persist);
      current.current = null;
      persist();
      editor.detached = true;
      if (!editor.conflict) void writeDraft(editor).catch(() => {});
    };
  }, [roomId]);

  function change<K extends keyof Notebook>(key: K, action: SetStateAction<Notebook[K]>) {
    const editor = current.current;
    if (!editor?.draft || editor.conflict || editor.roomId !== roomId) return;
    const value = typeof action === 'function' ? action(editor.draft[key]) : action;
    if (editor.draft[key] === value) return;
    editor.draft = { ...editor.draft, [key]: value };
    setLoaded({ roomId: editor.roomId, draft: editor.draft });
    setError('');
    window.clearTimeout(editor.timer);
    editor.timer = window.setTimeout(() => {
      void writeDraft(editor).catch(e => { if (current.current === editor) setError(e.message); });
    }, 500);
  }

  function resolveConflict(draft: Notebook) {
    const editor = current.current;
    if (!editor?.conflict) return;
    editor.saved = editor.conflict.server;
    editor.revision = editor.conflict.revision;
    editor.draft = draft;
    editor.conflict = null;
    editor.notify(null);
    setError('');
    setLoaded({ roomId: editor.roomId, draft });
    storeDraft(editor);
    void writeDraft(editor).catch(e => { if (current.current === editor) setError(e.message); });
  }

  return {
    ...(loaded?.roomId === roomId ? loaded?.draft || empty : empty),
    ready: Boolean(loaded && loaded.roomId === roomId) && !conflict, error, conflict, resolveConflict,
    setFreeNotes: (value: string) => change('freeNotes', value),
    setClues: (value: SetStateAction<string[]>) => change('clues', value),
    setGraphNodes: (value: SetStateAction<GraphNode[]>) => change('graphNodes', value),
    setGraphEdges: (value: SetStateAction<GraphEdge[]>) => change('graphEdges', value),
    flush: () => current.current ? writeDraft(current.current) : Promise.resolve(),
  };
}
