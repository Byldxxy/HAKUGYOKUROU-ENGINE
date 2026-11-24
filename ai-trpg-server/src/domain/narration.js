// Older KP replies can end with a labelled list of suggested actions. Only remove
// explicit menus, leaving ordinary dialogue, inventories and following paragraphs intact.
const heading = /(^|[。！？!?…][”’」』]?)[ \t]*(?:[\p{L}\p{N}·_-]{1,40}[，,][ \t]*)?(?:\*\*)?(?:你(?:们)?(?:现在|接下来)?可以(?:选择)?|(?:可选行动|行动选项|行动建议|下一步建议))[：:](?:\*\*)?[ \t]*/gmu;
const menuItems = /^(?:[ \t\r\n]*(?:[·•]|[-*][ \t]+|\d{1,2}[.、)）])[^\r\n]*)+/u;

const cleanKpNarration = (text) => {
  if (typeof text !== 'string') return text;
  // Saved messages may have stat and roll directives after the narration on the same line.
  return text.split(/(<<(?:ROLL|STAT):[^<>]+>>?)/g).map(part => {
    if (part.startsWith('<<')) return part;
    let end = 0;
    let cleaned = '';
    for (const match of part.matchAll(heading)) {
      if (match.index < end) continue;
      const after = match.index + match[0].length;
      const items = menuItems.exec(part.slice(after));
      if (!items) continue;
      cleaned += part.slice(end, match.index) + match[1];
      end = after + items[0].length;
    }
    return cleaned + part.slice(end);
  }).join('').trim();
};

module.exports = { cleanKpNarration };
