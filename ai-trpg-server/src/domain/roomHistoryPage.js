// Cursors refer to physical log indices so legacy saves, roll IDs and notebook links
// keep their original addresses even though state snapshots are not public messages.
const PAGE_SIZE = 50;

function lowerBound(messages, seq) {
  let low = 0;
  let high = messages.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (messages[middle].logIndex < seq) low = middle + 1;
    else high = middle;
  }
  return low;
}

function historyPage(messages, { beforeSeq, afterSeq, aroundSeq } = {}) {
  let end = messages.length;
  let start = Math.max(0, end - PAGE_SIZE);
  if (beforeSeq !== undefined) {
    end = lowerBound(messages, beforeSeq);
    start = Math.max(0, end - PAGE_SIZE);
  } else if (afterSeq !== undefined) {
    start = lowerBound(messages, afterSeq + 1);
    end = Math.min(messages.length, start + PAGE_SIZE);
  } else if (aroundSeq !== undefined) {
    const anchor = lowerBound(messages, aroundSeq);
    start = Math.max(0, Math.min(anchor - Math.floor(PAGE_SIZE / 2), messages.length - PAGE_SIZE));
    end = Math.min(messages.length, start + PAGE_SIZE);
  }
  const page = messages.slice(start, end);
  // If a page ends mid-check, attach results that would normally come from the next page.
  const lastDm = page.findLastIndex(message => message.role === 'dm');
  if (lastDm >= 0 && page[lastDm].content.includes('<<ROLL:')) {
    const followingRolls = [];
    for (let i = end; i < messages.length && messages[i].role !== 'dm'; i++) {
      if (messages[i].role === 'roll') {
        const { sender, rollId, content } = messages[i];
        followingRolls.push({ sender, rollId, content });
      }
    }
    if (followingRolls.length) page[lastDm] = { ...page[lastDm], followingRolls };
  }
  return { messages: page, hasEarlier: start > 0, hasLater: end < messages.length,
    latestSeq: messages.at(-1)?.logIndex ?? -1 };
}

function pageQuery(query) {
  const cursor = {};
  for (const name of ['beforeSeq', 'afterSeq', 'aroundSeq']) {
    const value = query[name];
    if (value === undefined) continue;
    if (Object.keys(cursor).length || typeof value !== 'string' || !/^\d+$/.test(value) ||
        !Number.isSafeInteger(Number(value))) return null;
    cursor[name] = Number(value);
  }
  return cursor;
}

module.exports = { historyPage, pageQuery };
