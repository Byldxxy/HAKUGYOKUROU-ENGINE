import { useState } from 'react';
import OfflineRollPreference from '../../components/OfflineRollPreference';
import type { GameCharacter } from '../../domain/types';

type Props = {
  self: GameCharacter;
  teammates: GameCharacter[];
  roomId?: string;
  offlineRoll?: boolean;
  onCharacter: (id: string) => void;
  onNotebook: () => void;
};

const vitals = ['hp', 'san', 'mp'] as const;

export default function GameSidebar({ self, teammates, roomId, offlineRoll, onCharacter, onNotebook }: Props) {
  const [showTeam, setShowTeam] = useState(false);
  return (
    <aside className="game-sidebar" aria-label="调查员与小队">
      <div className="flat-box my-character-panel">
        <button type="button" className="avatar-box clickable" onClick={() => onCharacter('self')}
          aria-label={`查看${self.name}的完整角色卡`}>
          {self.avatar && <img src={self.avatar} alt="" className="game-portrait" />}
          <span className={self.avatar ? 'portrait-name' : undefined}>{self.name}</span>
        </button>
        <div className="stats-board">
          {vitals.map(key => {
            const { current, max } = self[key];
            return <div key={key} className="stat-item">
              <span className="vital-label">{key.toUpperCase()}</span>
              <div className="stat-bar-bg" aria-hidden="true"><div className={`stat-bar-fill ${key}`}
                style={{ width: max > 0 ? Math.max(0, Math.min(100, current / max * 100)) + '%' : '0%' }} /></div>
              <span className="vital-value">{current}/{max}</span>
            </div>;
          })}
        </div>
        <button type="button" className="flat-btn secondary notebook-btn" onClick={onNotebook} aria-label="打开战役笔记">
          <span className="full-notebook-label">打开战役笔记</span><span className="mobile-notebook-label">笔记</span>
        </button>
        <button type="button" className="flat-btn secondary team-toggle" aria-controls="team-details"
          aria-expanded={showTeam} onClick={() => setShowTeam(!showTeam)}>队伍</button>
      </div>
      <div id="team-details" className={`team-details${showTeam ? ' is-open' : ''}`}>
        {roomId && <OfflineRollPreference roomId={roomId} enabled={offlineRoll} />}
        {teammates.length > 0 && <section className="teammates-section" aria-label="小队成员">
          <h4 className="section-subtitle">小队成员</h4>
          {teammates.map(mate => <div key={mate.id} className="flat-box teammate-card">
            <button type="button" className="teammate-name clickable" onClick={() => onCharacter(mate.id)}>
              {mate.name} <span className="teammate-role">({mate.role})</span>
            </button>
            <div className="teammate-mini-stats">
              {vitals.map(key => <span key={key} className={`mini-stat ${key}`}>
                {key.toUpperCase()} {mate[key].current}/{mate[key].max}
              </span>)}
            </div>
          </div>)}
        </section>}
      </div>
    </aside>
  );
}
