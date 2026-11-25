import './NotebookRecap.css';

export type RecapEntry = { round: number; logIndex: number; kind: string; text: string };

export default function NotebookRecap({ entries, onJump }: {
  entries: RecapEntry[]; onJump: (logIndex: number) => void;
}) {
  if (!entries.length) return <p className="recap-empty">还没有你的见闻记录。</p>;
  return <div className="notebook-inventory notebook-recap">
    {([['promise', '尚待履行的约定'], ['rumor', '听说的消息'], ['event', '亲历的事件']] as const).map(([kind, title]) => {
      const records = entries.filter(entry => entry.kind === kind);
      if (!records.length) return null;
      return <section key={kind}>
        <h3>{title}</h3>
        <ul>{records.map((entry, i) => <li key={i}>
          <span>{entry.text}</span>
          <button type="button" onClick={() => onJump(entry.logIndex)} aria-label={`查看第 ${entry.round} 轮原话`}>
            第 {entry.round} 轮 · 查看原话
          </button>
        </li>)}</ul>
      </section>;
    })}
  </div>;
}
