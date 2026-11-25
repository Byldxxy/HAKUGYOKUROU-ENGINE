import { useState } from 'react';
import { socketRequest } from '../socket';
import './OfflineRollPreference.css';

export default function OfflineRollPreference({ roomId, enabled }: { roomId: string; enabled?: boolean }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const change = async (value: boolean) => {
    setSaving(true);
    setError('');
    try {
      await socketRequest('set_offline_roll', { roomId, enabled: value });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return <div className="offline-roll-setting">
    <label>
      <input type="checkbox" checked={Boolean(enabled)} disabled={enabled === undefined || saving}
        onChange={e => void change(e.target.checked)} />
      本房间离线超时后，允许服务器替我掷骰
    </label>
    {error && <div role="alert">{error}</div>}
  </div>;
}
