const { createHash } = require('node:crypto');

// One current world state per entity. Each observer keeps the last version they actually learned.
const short = (value, max) => typeof value === 'string' && value.trim().length <= max ? value.trim() : '';
const kinds = new Set(['item', 'promise', 'information']);

function actorDirectory(scenario, campaign) {
  return [
    ...(scenario.actors || []).map(({ id, name }) => ({ id, name })),
    ...Object.values(campaign.partyStats || {}).map(p => ({ id: 'pc:' + p.characterId, name: p.characterName?.trim() })),
  ];
}

function actor(value, actors) {
  const token = short(value, 100);
  if (!token) return '';
  const exact = actors.find(a => a.id === token);
  if (exact) return exact.id;
  const matches = actors.filter(a => a.name === token.replace(/^npc:/, ''));
  if (matches.length === 1) return matches[0].id;
  return !matches.length && /^npc:[\p{L}\p{N}_-]{1,30}$/u.test(token) ? token : '';
}

function seed(campaign, scenario) {
  return (campaign.inventory || []).map(id => ({
    kind: 'item', id, label: scenario.items?.find(item => item.id === id)?.name || id,
    state: { holder: 'party' }, scene: campaign.currentSceneId, createdRound: 0, round: 0,
    evidence: '存档队伍物品栏', observers: [],
  }));
}

// Snapshot starting possessions once per character and campaign, including older saves.
function importCardItems(campaign, player) {
  const member = campaign.partyStats?.[player.accountName];
  const data = player.fullData?.fullData || player.fullData;
  if (!data || !member || member.cardItemsImported) return false;
  const holder = 'pc:' + player.characterId;
  const bg = data.bgInfo || {};
  const lines = value => typeof value === 'string' ? value.split(/\r?\n/).map(v => v.trim()).filter(Boolean) : [];
  const carried = lines(bg.carriedItems);
  const treasures = lines(bg.treasuredItem).filter(label => !carried.includes(label));
  const counts = new Map();
  for (const label of [...carried, ...treasures]) {
    const copy = (counts.get(label) || 0) + 1;
    counts.set(label, copy);
    const id = 'gear-' + createHash('sha256').update(JSON.stringify([holder, label, copy])).digest('hex').slice(0, 24);
    // An older save may already track this possession under a narrative ID.
    const previous = campaign.memory.find(e => e.kind === 'item' && e.label === label && !e.cardOwner &&
      (e.state.holder === holder || e.observers.some(o => o.state.holder === holder)));
    if (previous) { previous.cardOwner = holder; continue; }
    const state = { holder };
    const version = { state, round: 0, scene: campaign.currentSceneId, evidence: '角色卡随身物品' };
    campaign.memory.push({ kind: 'item', id, label, cardOwner: holder, createdRound: 0,
      ...version, observers: [{ who: holder, ...version }] });
    campaign.inventory.push(id);
  }
  member.cardItemsImported = true;
  return true;
}

function notebookItems(campaign, scenario, characterId) {
  if (!characterId) return [];
  const holder = 'pc:' + characterId;
  return campaign.memory.filter(e => e.kind === 'item' && [holder, 'party'].includes(e.state.holder))
    .map(e => {
      const definition = scenario.items?.find(item => item.id === e.id);
      const knownName = e.cardOwner || !definition || e.evidence?.includes(e.label);
      const name = definition?.publicName || (knownName && e.label) || definition?.publicDescription || '未辨明的物品';
      const group = e.state.holder === 'party' ? 'shared' : e.cardOwner === holder ? 'card' : 'story';
      return { name, group };
    });
}

// Use the investigator's observation, even when someone else later moves the item
// or disproves a rumor. Only echo details also present in that reply's public text.
function notebookRecap(campaign, scenario, characterId, sources) {
  if (!characterId || !sources?.size) return [];
  const self = 'pc:' + characterId;
  const names = new Map(actorDirectory(scenario, campaign).map(a => [a.id, a.name]));
  const rows = [];
  for (const entry of campaign.memory || []) {
    const seen = entry.observers.find(observer => observer.who === self);
    const source = seen && sources.get(seen.round);
    if (!source || !seen.evidence || !source.content.includes(seen.evidence)) continue;
    const { state, evidence } = seen;
    const attested = value => typeof value === 'string' && value && evidence.includes(value) ? value : '';
    let kind = 'event', text;
    if (entry.kind === 'item') {
      const label = attested(entry.label) || '这件物品';
      const name = names.get(state.holder) || state.holder?.replace(/^npc:/, '');
      const holder = state.holder === self ? '你' : attested(name);
      const location = attested(state.location);
      text = holder ? `你上次见到的${label}由${holder}保管。`
        : location ? `你上次在${location}见到了${label}。` : `你见证了${label}的变化。`;
    } else if (entry.kind === 'promise') {
      const status = { open: '待履行', kept: '已履行', broken: '已违约', released: '已解除' }[state.status];
      if (!status) continue;
      kind = state.status === 'open' ? 'promise' : 'event';
      const terms = attested(state.terms) || attested(entry.label) || attested(names.get(state.from)) || '这项约定';
      text = `${terms}（${status}）`;
    } else if (entry.kind === 'information') {
      kind = state.basis === 'heard' ? 'rumor' : 'event';
      text = attested(state.statement) || attested(entry.label);
    } else continue;
    // A one-sentence quotation preserves natural wording when the model paraphrased
    // the observation. Never copy a whole multi-event paragraph into a private recap.
    const sentences = evidence.match(/[^。！？!?\n]+[。！？!?]?/gu) || [];
    if (sentences.length === 1 && sentences[0].length <= 180) {
      text = entry.kind === 'promise' ? text + ' · ' + sentences[0].trim() : sentences[0].trim();
    }
    rows.push({ round: seen.round, logIndex: source.logIndex, kind, text: text || '你听到或见证了一条消息。' });
  }
  return rows.sort((a,b) => b.round - a.round);
}

function readState(change, actors) {
  if (change.kind === 'item') {
    const holder = change.holder === 'party' ? 'party' : actor(change.holder, actors);
    const location = short(change.location, 80);
    if (Boolean(change.holder) === Boolean(change.location) || (!holder && !location)) return;
    const condition = short(change.condition, 80);
    return { ...(holder ? { holder } : { location }), ...(condition && { condition }) };
  }
  if (change.kind === 'promise') {
    const from = actor(change.from, actors), to = actor(change.to, actors);
    const terms = short(change.terms, 180);
    if (from && to && terms && ['open', 'kept', 'broken', 'released'].includes(change.status)) {
      return { from, to, terms, status: change.status };
    }
  }
  if (change.kind === 'information') {
    const statement = short(change.statement, 180), source = short(change.source, 80);
    if (statement && source && ['heard', 'observed'].includes(change.basis)) {
      return { statement, source, basis: change.basis };
    }
  }
}

function apply(campaign, scenario, changes, narration) {
  const actors = actorDirectory(scenario, campaign);
  const paragraphs = narration.split(/\n+/).map(p => p.trim()).filter(Boolean);
  for (const change of changes.slice(0, 12)) {
    if (!kinds.has(change?.kind)) continue;
    const label = short(change.label, 60);
    const quote = short(change.evidence, 180);
    const paragraph = Number.isInteger(change.evidenceParagraph) ? paragraphs[change.evidenceParagraph - 1] : '';
    const evidence = quote && narration.includes(quote) ? quote : short(paragraph, 1200);
    if (!label || !evidence) continue;
    let id = short(change.id, 80);
    if (!/^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u.test(id)) continue;
    const entries = campaign.memory;
    let entry = entries.find(e => e.kind === change.kind && e.id === id);
    const def = change.kind === 'item' && !entry && scenario.items?.find(i => i.id === id || i.name === label);
    if (def) {
      id = def.id;
      entry = entries.find(e => e.kind === 'item' && e.id === id);
    }
    if (!entry && !def) {
      const matches = entries.filter(e => e.kind === change.kind && e.label === label);
      if (matches.length > 1) continue;
      entry = matches[0];
    }
    const state = readState(change, actors);
    if (!state || !Array.isArray(change.witnesses) || change.witnesses.length > 24) continue;
    const witnesses = change.witnesses.map(v => actor(v, actors));
    if (witnesses.includes('') || (change.kind === 'information' && !witnesses.length)) continue;
    if (entry?.kind === 'promise' && (entry.state.from !== state.from || entry.state.to !== state.to)) continue;
    if (!entry) {
      entry = { kind: change.kind, id, label: def?.name || label, createdRound: campaign.round, observers: [] };
      entries.push(entry);
    }
    const version = { state, round: campaign.round, scene: campaign.currentSceneId, evidence };
    Object.assign(entry, version);
    for (const who of new Set(witnesses)) {
      const previous = entry.observers.find(o => o.who === who);
      if (previous) Object.assign(previous, version);
      else entry.observers.push({ who, ...version });
    }
    if (entry.kind === 'item') {
      campaign.inventory = campaign.inventory.filter(item => item !== entry.id);
      if (state.holder === 'party' || state.holder?.startsWith('pc:')) campaign.inventory.push(entry.id);
    }
  }
}

function recall(entries, sceneId, lines, actors) {
  const lastReply = lines.findLastIndex(line => line.type === 'dm_reply');
  // A roll result may name only a skill. Include the preceding exchange as a weaker cue.
  const latest = lines.slice(lastReply + 1).filter(l => l.type === 'player_action').map(l => l.content).join(' ');
  const previous = lines.slice(0, lastReply + 1).filter(l => ['player_action', 'dm_reply'].includes(l.type))
    .slice(-3).map(l => l.content).join(' ');
  const actorNames = new Map(actors.map(({ id, name }) => [id, name]));
  function relevance(entry) {
    const { state } = entry;
    const terms = [state.location, state.source, state.terms, state.statement,
      ...[state.holder, state.from, state.to, ...entry.observers.map(o => o.who)]
        .map(ref => actorNames.get(ref) || ref?.replace(/^npc:/, ''))].filter(Boolean);
    const score = cue => (cue.includes(entry.label) || cue.includes(entry.id) ? 8 : 0)
      + (terms.some(t => cue.includes(t)) ? 3 : 0);
    return 4 * score(latest) + score(previous) + Number(entry.scene === sceneId)
      + Number(state.status === 'open');
  }
  return entries.map(entry => ({ entry, score: relevance(entry) }))
    .sort((a,b) => b.score - a.score || b.entry.round - a.entry.round)
    .slice(0, 12).map(({ entry }) => entry);
}

module.exports = { actorDirectory, apply, importCardItems, notebookItems, notebookRecap, recall, seed };
