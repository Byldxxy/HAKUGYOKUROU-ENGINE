import { useEffect, useRef, useState, type SetStateAction } from 'react';
import { apiFetch } from '../../config';
import { socket } from '../../socket';
import type { GraphEdge, GraphNode } from '../../components/RelationGraph';

type Notebook = { freeNotes: string; clues: string[]; graphNodes: GraphNode[]; graphEdges: GraphEdge[] };
const empty: Notebook = { freeNotes: '', clues: [], graphNodes: [], graphEdges: [] };
type Editor = {
  roomId: string;
  draft: Notebook | null;
  saved: Notebook | null;
  writes: Promise<void>;
  timer?: number;
};

// Serialize autosave and manual flush. A slow request for an older draft must finish
// before the checkpoint can acknowledge the current one.
function writeDraft(editor: Editor) {
  window.clearTimeout(editor.timer);
  const draft = editor.draft;
  const write = editor.writes.then(async () => {
    if (!draft || editor.saved === draft) return;
    const response = await apiFetch('/api/notebooks', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId: editor.roomId, notebook: draft }),
    });
    if (!response.ok) throw new Error('个人笔记保存失败，请检查连接后重试。');
    editor.saved = draft;
  });
  editor.writes = write.catch(() => {});
  return write;
}

export function useCampaignNotebook(roomId?: string) {
  const current = useRef<Editor | null>(null);
  const [loaded, setLoaded] = useState<{ roomId: string; draft: Notebook } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!roomId) return;
    const editor: Editor = { roomId, draft: null, saved: null, writes: Promise.resolve() };
    current.current = editor;
    async function load() {
      try {
        const response = await apiFetch('/api/notebooks?roomId=' + encodeURIComponent(editor.roomId));
        if (!response.ok) throw new Error();
        const { notebook } = await response.json();
        if (current.current !== editor) return;
        const draft = { freeNotes: notebook.freeNotes || '', clues: notebook.clues || [],
          graphNodes: notebook.graphNodes || [], graphEdges: notebook.graphEdges || [] };
        editor.draft = editor.saved = draft;
        setLoaded({ roomId: editor.roomId, draft });
        setError('');
      } catch {
        if (current.current === editor) setError('个人笔记加载失败，请刷新页面重试。');
      }
    }
    void load();
    const flushForSave = async (request: { roomId: string }, acknowledge: (reply: { success: boolean }) => void) => {
      if (request.roomId !== editor.roomId) return acknowledge({ success: false });
      try {
        await writeDraft(editor);
        acknowledge({ success: true });
      } catch {
        acknowledge({ success: false });
      }
    };
    socket.on('flush_notebook', flushForSave);
    return () => {
      socket.off('flush_notebook', flushForSave);
      current.current = null;
      void writeDraft(editor).catch(e => console.error(e));
    };
  }, [roomId]);

  function change<K extends keyof Notebook>(key: K, action: SetStateAction<Notebook[K]>) {
    const editor = current.current;
    if (!editor?.draft || editor.roomId !== roomId) return;
    const value = typeof action === 'function' ? action(editor.draft[key]) : action;
    if (editor.draft[key] === value) return;
    editor.draft = { ...editor.draft, [key]: value };
    setLoaded({ roomId: editor.roomId, draft: editor.draft });
    setError('');
    window.clearTimeout(editor.timer);
    editor.timer = window.setTimeout(() => {
      void writeDraft(editor).catch(e => {
        if (current.current === editor) setError(e.message);
      });
    }, 500);
  }

  return {
    ...(loaded?.roomId === roomId ? loaded?.draft || empty : empty),
    ready: Boolean(loaded && loaded.roomId === roomId), error,
    setFreeNotes: (value: string) => change('freeNotes', value),
    setClues: (value: SetStateAction<string[]>) => change('clues', value),
    setGraphNodes: (value: SetStateAction<GraphNode[]>) => change('graphNodes', value),
    setGraphEdges: (value: SetStateAction<GraphEdge[]>) => change('graphEdges', value),
    flush: () => current.current ? writeDraft(current.current) : Promise.resolve(),
  };
}
