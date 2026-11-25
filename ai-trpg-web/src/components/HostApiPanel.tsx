import { useCallback, useEffect, useRef, useState } from 'react';
import { socket, socketRequest, type SocketAck } from '../socket';
import './HostApiPanel.css';

export type HostReadiness = Pick<SocketAck, 'mode' | 'configured' | 'balance'>;

export default function HostApiPanel({ roomId, onReadiness }: {
  roomId: string;
  onReadiness?: (value: HostReadiness) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [status, setStatus] = useState<SocketAck | null>(null);
  const [mode, setMode] = useState<'site' | 'custom'>('site');
  const [url, setUrl] = useState('');
  const [model, setModel] = useState('');
  const [key, setKey] = useState('');
  const [code, setCode] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const receive = useCallback((value: SocketAck) => {
    setStatus(value);
    onReadiness?.({ mode: value.mode, configured: value.configured, balance: value.balance });
  }, [onReadiness]);
  useEffect(() => {
    let active = true;
    const refresh = () => socketRequest('host_api_status', { roomId }).then(value => {
      if (active) receive(value);
    }).catch(() => {});
    void refresh();
    socket.on('billing_changed', refresh);
    socket.on('connect', refresh);
    return () => { active = false; socket.off('billing_changed', refresh); socket.off('connect', refresh); };
  }, [roomId, receive]);
  const openPanel = async () => {
    setBusy(true);
    try {
      const value = await socketRequest('host_api_status', { roomId });
      receive(value);
      setMode(value.mode || (value.profile ? 'custom' : 'site'));
      setUrl(value.profile?.url || '');
      setModel(value.profile?.model || '');
      setKey('');
      setNotice('');
      dialog.current?.showModal();
    } catch (error) { alert((error as Error).message); }
    finally { setBusy(false); }
  };
  const forget = async () => {
    if (!window.confirm('删除此账号保存的自有 API 配置？使用该配置的房间需要重新设置。')) return;
    setBusy(true);
    try {
      receive(await socketRequest('forget_host_api', { roomId }));
      setUrl(''); setModel(''); setKey(''); setNotice('已删除账号保存的配置。');
    } catch (error) { setNotice((error as Error).message); }
    finally { setBusy(false); }
  };
  const reuseKey = Boolean(status?.profile && url.trim() === status.profile.url);
  const run = async (redeem: boolean) => {
    setBusy(true);
    try {
      const value = redeem ? await socketRequest('redeem_cdk', { roomId, code })
        : await socketRequest('set_host_api', mode === 'site' ? { roomId, mode } : { roomId, mode, url, model, key });
      receive(value);
      if (redeem) setCode(''); else setKey('');
      setNotice(redeem ? '兑换成功。' : '主持 API 已保存。');
    } catch (error) { setNotice((error as Error).message); }
    finally { setBusy(false); }
  };
  return <>
    <button className="flat-btn secondary small" disabled={busy} onClick={openPanel}>主持 API{status?.mode === 'site' ? ` · ${status.balance} 点` : ''}</button>
    <dialog className="host-api-dialog flat-box" ref={dialog} aria-label="主持 API" onClose={() => { setKey(''); setCode(''); }}>
      <div className="host-api-title"><h3>主持 API</h3><button className="flat-btn small secondary" onClick={() => dialog.current?.close()}>关闭</button></div>
      <p>当前使用：{status?.configured ? (status.mode === 'site' ? '站点 API' : '自有 API') : '待配置'} · 账户余额：{status?.balance ?? '…'} 点</p>
      <form onSubmit={e => { e.preventDefault(); void run(false); }}>
        <fieldset><legend>选择服务</legend>
          <label><input type="radio" checked={mode === 'site'} onChange={() => setMode('site')} />站点 API</label>
          <label><input type="radio" checked={mode === 'custom'} onChange={() => setMode('custom')} />自有 API</label>
        </fieldset>
        {mode === 'site' ? <p>每成功生成一条主持回复，扣房主 1 点。失败不扣点。</p> : <>
          <p>房间剧情将发送至此接口。URL 和模型随账号保存，Key 加密存储。</p>
          <label>API URL<input className="flat-input" type="url" value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://api.example.com/v1" required /></label>
          <label>模型名<input className="flat-input" value={model} onChange={e=>setModel(e.target.value)} required /></label>
          <label>API Key<input className="flat-input" type="password" autoComplete="off" value={key} placeholder={reuseKey ? '已保存，留空沿用' : '输入此接口的 Key'} onChange={e=>setKey(e.target.value)} required={!reuseKey} /></label>
        </>}
        <button className="flat-btn primary small" disabled={busy}>保存 API 配置</button>
        {mode === 'custom' && status?.profile && <button type="button" className="flat-btn secondary small" disabled={busy} onClick={forget}>删除已保存的配置</button>}
      </form>
      <form onSubmit={e => { e.preventDefault(); void run(true); }}>
        <label>CDK 兑换码<input className="flat-input" value={code} onChange={e=>setCode(e.target.value)} required /></label>
        <button className="flat-btn secondary small" disabled={busy}>兑换额度</button>
      </form>
      <p role="status">{notice}</p>
    </dialog>
  </>;
}
