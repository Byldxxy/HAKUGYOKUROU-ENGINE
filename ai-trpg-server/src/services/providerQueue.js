function publicError(message, code) {
  return Object.assign(new Error(message), { publicMessage: message, code });
}

// Each lane is FIFO. A slot is transferred synchronously to the next waiter.
function createQueue(limit, maxWaiting) {
  let active = 0;
  const waiting = new Set();
  async function acquire(signal) {
    signal.throwIfAborted();
    if (active < limit) {
      active++;
      return;
    }
    if (waiting.size >= maxWaiting) throw publicError('主持接口繁忙，请稍后重试。', 'queue_full');
    await new Promise((resolve, reject) => {
      const ready = () => {
        signal.removeEventListener('abort', cancel);
        resolve();
      };
      const cancel = () => {
        waiting.delete(ready);
        reject(signal.reason);
      };
      waiting.add(ready);
      signal.addEventListener('abort', cancel, { once: true });
    });
  }
  function release() {
    const next = waiting.values().next().value;
    if (next) {
      waiting.delete(next);
      next();
    } else active--;
  }
  return { acquire, release };
}

module.exports = { createQueue, publicError };
