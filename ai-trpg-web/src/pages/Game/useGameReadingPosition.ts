import { useLayoutEffect, useRef, useState } from 'react';
import type { Message } from '../../domain/types';

export function useGameReadingPosition(messages: Message[], arrivals: number, ready: boolean, archive: boolean) {
  const historyRef = useRef<HTMLDivElement>(null);
  const [readThrough, setReadThrough] = useState<number | null>(null);
  const reviewing = archive || readThrough !== null;
  const unread = readThrough === null ? 0 : Math.max(0, arrivals - readThrough);
  const pending = useRef<{ seq: number; top?: number } | null>(null);
  const onHistoryScroll = () => {
    const box = historyRef.current;
    if (!box) return;
    if (!archive && box.scrollHeight - box.clientHeight - box.scrollTop <= 32) setReadThrough(null);
    else setReadThrough(prev => prev ?? arrivals);
  };
  useLayoutEffect(() => {
    const box = historyRef.current;
    if (!ready || !box) return;
    const target = pending.current;
    if (target) {
      const element = document.getElementById(`log-message-${target.seq}`);
      if (element) {
        if (target.top !== undefined) box.scrollTop += element.getBoundingClientRect().top - target.top;
        else {
          element.focus({ preventScroll: true });
          element.scrollIntoView({ block: 'center', behavior: 'instant' });
        }
        pending.current = null;
        return;
      }
    }
    if (!reviewing) box.scrollTop = box.scrollHeight;
  }, [messages, ready, reviewing]);

  // Capture the viewport immediately before changing pages, independent of browser scroll anchoring.
  const keepPosition = () => {
    const box = historyRef.current;
    if (!box) return;
    const top = box.getBoundingClientRect().top;
    const anchor = Array.from(box.querySelectorAll<HTMLElement>('[data-seq]'))
      .find(el => el.getBoundingClientRect().bottom >= top);
    if (anchor) pending.current = { seq: Number(anchor.dataset.seq), top: anchor.getBoundingClientRect().top };
  };
  const returnToLatest = () => {
    pending.current = null;
    setReadThrough(null);
    const box = historyRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  };
  const jumpToSource = (seq: number) => {
    pending.current = { seq };
    setReadThrough(prev => prev ?? arrivals);
    const element = document.getElementById(`log-message-${seq}`);
    if (element) {
      element.focus({ preventScroll: true });
      element.scrollIntoView({ block: 'center', behavior: 'instant' });
      pending.current = null;
      return true;
    }
    return false;
  };
  return { historyRef, reviewing, unread, onHistoryScroll, keepPosition, returnToLatest, jumpToSource,
    cancelPosition: () => { pending.current = null; } };
}
