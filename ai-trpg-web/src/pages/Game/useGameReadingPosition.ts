import { useLayoutEffect, useRef, useState } from 'react';

export function useGameReadingPosition(roomId: string | undefined, messageCount: number, ready: boolean) {
  const historyRef = useRef<HTMLDivElement>(null);
  const [pause, setPause] = useState<{ roomId: string | undefined; readThrough: number } | null>(null);
  const reviewing = pause !== null && pause.roomId === roomId;
  // A snapshot replaces the entire message array on reconnect. Its existing
  // prefix has already been seen, so only the extra entries count as new.
  const unread = reviewing ? Math.max(0, messageCount - pause.readThrough) : 0;

  useLayoutEffect(() => {
    const box = historyRef.current;
    if (ready && box && !reviewing) box.scrollTop = box.scrollHeight;
  }, [messageCount, ready, reviewing, roomId]);

  const pauseHere = () => setPause(previous =>
    previous && previous.roomId === roomId ? previous : { roomId, readThrough: messageCount });

  const onHistoryScroll = () => {
    const box = historyRef.current;
    if (!box) return;
    if (box.scrollHeight - box.clientHeight - box.scrollTop <= 32) setPause(null);
    else pauseHere();
  };

  const returnToLatest = () => {
    const box = historyRef.current;
    if (box) box.scrollTop = box.scrollHeight;
    setPause(null);
  };

  const jumpToSource = (index: number) => {
    const source = document.getElementById(`log-message-${index}`);
    if (!source) return;
    source.focus({ preventScroll: true });
    source.scrollIntoView({ block: 'center', behavior: 'instant' });
    onHistoryScroll();
  };

  return { historyRef, reviewing, unread, onHistoryScroll, returnToLatest, jumpToSource };
}
