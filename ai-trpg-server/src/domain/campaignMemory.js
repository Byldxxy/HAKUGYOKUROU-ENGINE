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
    const def = change.kind === 'item' && scenario.items?.find(i => i.id === id || i.name === label);
    if (def) id = def.id;
    const entries = campaign.memory;
    let entry = entries.find(e => e.kind === change.kind && e.id === id);
    entry ||= entries.find(e => e.kind === change.kind && e.label === (def?.name || label));
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

module.exports = { actorDirectory, apply, recall, seed };
