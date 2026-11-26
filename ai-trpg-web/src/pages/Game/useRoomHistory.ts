import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../config';
import type { Message } from '../../domain/types';

type Page = {
  messages: Message[];
  latestSeq: number;
  hasEarlier: boolean;
  hasLater: boolean;
};
export type HistorySnapshot = Page & { delta: boolean };
const emptyPage: Page = { messages: [], latestSeq: -1, hasEarlier: false, hasLater: false };

function mergeMessages(older: Message[], newer: Message[]) {
  if (!newer.length) return older;
  if (!older.length || older.at(-1)!.logIndex! < newer[0].logIndex!) return [...older, ...newer];
  const entries = new Map(older.map(message => [message.logIndex, message]));
  for (const message of newer) entries.set(message.logIndex, message);
  return Array.from(entries.values()).sort((a, b) => a.logIndex! - b.logIndex!);
}

export function useRoomHistory(roomId?: string) {
  const [tail, setTail] = useState<Page>(emptyPage);
  const [archive, setArchive] = useState<Page | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [arrivals, setArrivals] = useState(0);
  const cursor = useRef<number>(-1);
  const generation = useRef(0);
  const viewGeneration = useRef(0);
  const syncing = useRef(true);
  const receivedThrough = useRef(-1);
  const loading = useRef(false);

  const fetchPage = useCallback(async (direction: string, seq: number) => {
    const res = await apiFetch(`/api/room_history?historyVersion=1&roomId=${encodeURIComponent(roomId || '')}&${direction}=${seq}`);
    if (!res.ok) throw new Error('记录加载失败，请重试。');
    return await res.json() as Page;
  }, [roomId]);

  const interrupt = useCallback(() => {
    generation.current++;
    viewGeneration.current++;
    syncing.current = true;
    loading.current = false;
    setBusy(false);
  }, []);
  useEffect(() => () => { generation.current++; viewGeneration.current++; }, []);

  const live = useCallback((message: Message) => {
    if (message.logIndex === undefined || message.logIndex <= receivedThrough.current) return;
    receivedThrough.current = message.logIndex;
    if (!syncing.current) cursor.current = message.logIndex;
    setTail(prev => ({ ...prev, messages: mergeMessages(prev.messages, [message]), latestSeq: message.logIndex! }));
    setArrivals(n => n + 1);
  }, []);

  const snapshot = useCallback(async (first: HistorySnapshot) => {
    const token = ++generation.current;
    syncing.current = true;
    setError('');
    if (!first.delta) {
      viewGeneration.current++;
      loading.current = false;
      setBusy(false);
      setArchive(null);
      setTail(first);
      receivedThrough.current = first.latestSeq;
      setArrivals(0);
    } else {
      let missed = 0;
      let page: Page = first;
      while (generation.current === token) {
        const messages = page.messages;
        missed += messages.filter(message => message.logIndex! <= first.latestSeq).length;
        setTail(prev => ({ ...prev, messages: mergeMessages(prev.messages, messages),
          latestSeq: Math.max(prev.latestSeq, first.latestSeq) }));
        const last = page.messages.at(-1)?.logIndex;
        if (!page.hasLater || last === undefined || last >= first.latestSeq) break;
        try {
          const next = await fetchPage('afterSeq', last);
          if (!next.messages.length) throw new Error();
          page = next;
        } catch {
          if (generation.current !== token) return false;
          throw new Error('断线期间的记录尚未同步，请重试。');
        }
      }
      if (generation.current !== token) return false;
      setArrivals(n => n + missed);
      receivedThrough.current = Math.max(receivedThrough.current, first.latestSeq);
    }
    cursor.current = receivedThrough.current;
    syncing.current = false;
    return true;
  }, [fetchPage]);

  const page = archive ?? tail;
  const load = async (direction: 'beforeSeq' | 'afterSeq' | 'aroundSeq', seq: number, beforeApply?: () => void) => {
    if (loading.current) return false;
    const token = ++viewGeneration.current;
    loading.current = true;
    setBusy(true);
    setError('');
    try {
      const next = await fetchPage(direction, seq);
      if (token !== viewGeneration.current) return false;
      beforeApply?.();
      if (direction === 'aroundSeq') setArchive(next);
      else if (archive) setArchive(current => current && ({
        ...current,
        messages: mergeMessages(current.messages, next.messages),
        ...(direction === 'beforeSeq' ? { hasEarlier: next.hasEarlier } : { hasLater: next.hasLater }),
      }));
      else setTail(current => ({ ...current, messages: mergeMessages(current.messages, next.messages), hasEarlier: next.hasEarlier }));
      return true;
    } catch {
      if (token === viewGeneration.current) setError('记录加载失败，请重试。');
      return false;
    } finally {
      if (token === viewGeneration.current) { loading.current = false; setBusy(false); }
    }
  };
  const leaveArchive = () => {
    viewGeneration.current++;
    loading.current = false;
    setBusy(false);
    setArchive(null);
    setError('');
  };
  return { page, archive: Boolean(archive), busy, error, arrivals, live, cursor, interrupt, snapshot, load, leaveArchive };
}
