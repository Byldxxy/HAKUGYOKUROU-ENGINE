import { useRef, type KeyboardEvent } from 'react';

// WebKit can deliver compositionend just before the Enter that commits the candidate.
export function useChatEnter() {
  const composing = useRef(false);
  const endedAt = useRef(-Infinity);
  return {
    compositionEvents: {
      onCompositionStart: () => { composing.current = true; },
      onCompositionEnd: () => { composing.current = false; endedAt.current = performance.now(); },
      onKeyUp: () => { endedAt.current = -Infinity; },
    },
    shouldSubmit(event: KeyboardEvent) {
      if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing ||
          event.nativeEvent.keyCode === 229 || composing.current || performance.now() - endedAt.current < 30) return false;
      event.preventDefault();
      return !event.repeat;
    },
  };
}
