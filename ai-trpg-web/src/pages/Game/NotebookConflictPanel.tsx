import { useState } from 'react';
import type { Notebook, NotebookConflict } from './useCampaignNotebook';

type Group = 'notes' | 'clues' | 'graph';
const names = { notes: '自由笔记', clues: '线索摘录', graph: '关系图谱' };
const groups: Group[] = ['notes', 'clues', 'graph'];
const value = (book: Notebook, group: Group) => {
  if (group === 'notes') return book.freeNotes;
  if (group === 'clues') return book.clues;
  return { nodes: book.graphNodes, edges: book.graphEdges };
};
const describe = (book: Notebook, group: Group) => {
  if (group === 'notes') return book.freeNotes;
  if (group === 'clues') return book.clues.join('\n');
  const nodes = new Map(book.graphNodes.map(n => [n.id, n.name]));
  return [
    ...book.graphNodes.map(n => `${n.name}（${Math.round(n.x)}, ${Math.round(n.y)}）`),
    ...book.graphEdges.map(e => `${nodes.get(e.source)} → ${nodes.get(e.target)}  ${e.label}`),
  ].join('\n');
};

export default function NotebookConflictPanel({ conflict, onSave }: {
  conflict: NotebookConflict; onSave: (book: Notebook) => void;
}) {
  const { local, server, base } = conflict;
  const [choices, setChoices] = useState<Partial<Record<Group, 'local' | 'server'>>>({});
  const [notes, setNotes] = useState(local.freeNotes);
  const automatic = (group: Group) => {
    const previous = JSON.stringify(value(base, group));
    const remote = JSON.stringify(value(server, group));
    const draft = JSON.stringify(value(local, group));
    if (draft === previous || draft === remote) return 'server';
    if (remote === previous) return 'local';
  };
  const changedOnBoth = groups.filter(group => !automatic(group));
  const save = () => {
    const pick = (group: Group) => (automatic(group) ?? choices[group]) === 'server' ? server : local;
    onSave({
      freeNotes: changedOnBoth.includes('notes') ? notes : pick('notes').freeNotes,
      clues: pick('clues').clues, graphNodes: pick('graph').graphNodes, graphEdges: pick('graph').graphEdges,
    });
  };
  return <section className="notebook-conflict" aria-label="合并笔记">
    <h3>合并两台设备上的笔记</h3>
    <p>另一台设备已保存新版本。只在一端修改的内容会自动合并。</p>
    {changedOnBoth.map(group => <fieldset key={group}>
      <legend>{names[group]}</legend>
      {group === 'notes' ? <>
        <details><summary>查看服务器上的自由笔记</summary><pre>{server.freeNotes || '（空）'}</pre></details>
        <label>合并后的自由笔记
          <textarea className="flat-textarea" value={notes} maxLength={100000} onChange={e => setNotes(e.target.value)} />
        </label>
      </> : (['local', 'server'] as const).map(side => <div key={side}>
        <label><input type="radio" name={'merge-' + group} checked={choices[group] === side}
          onChange={() => setChoices(previous => ({ ...previous, [group]: side }))} />
          {side === 'local' ? '保留本机版本' : '保留服务器版本'}</label>
        <pre>{describe(side === 'local' ? local : server, group) || '（空）'}</pre>
      </div>)}
    </fieldset>)}
    <button type="button" className="flat-btn primary small"
      disabled={changedOnBoth.some(group => group !== 'notes' && !choices[group])} onClick={save}>保存合并结果</button>
  </section>;
}
