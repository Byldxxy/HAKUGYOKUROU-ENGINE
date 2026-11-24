const config = require('../config');
const rooms = require('../repositories/roomRepository');
const logs = require('../repositories/roomLogRepository');
const saves = require('../repositories/saveRepository');
const characters = require('../repositories/characterRepository');
const ai = require('../services/aiService');
const campaignService = require('../services/campaignService');
const { isValidRoomId } = require('../domain/validation');
const { normalizeRoomRules } = require('../domain/roomRules');
const { parseRollRequests, stripDirectives, isRollResultMessage } = require('../domain/directives');
const { skillValue, rollSkill } = require('../domain/dice');

const credits = require('../services/creditService');
const profiles = require('../services/accountProviderService');
const lobbyChat = require('../repositories/lobbyChatRepository');
const sameName = (left, right) => typeof left === 'string' && typeof right === 'string' && left.trim() === right.trim();
const liveRooms = new Map();
const ownedCharacter = (username, id) => characters.listByUsername(username).find((card) => card.id === id);
const playerFrom = (username, card, id = null) => ({
  id, accountName: username, characterId: card?.id || null, name: card?.name || username,
  characterName: card?.name || null, role: card?.role || '无角色卡',
  hp: card?.hp ?? '-', san: card?.san ?? '-', mp: card?.mp ?? '-', fullData: card || null,
});
const loadRoom = (id) => {
  if (liveRooms.has(id)) return liveRooms.get(id);
  const record = rooms.get(id);
  if (!record) return null;
  const room = { ...record, players: [], campaign: logs.getLatestCampaignState(id), dmInFlight: false };
  liveRooms.set(id, room);
  return room;
};
const persist = (room, removedAccount) => {
  const previous = rooms.get(room.id)?.members || [];
  const members = previous.filter(member => member.accountName !== removedAccount &&
    !room.players.some(player => player.accountName === member.accountName));
  members.push(...room.players.map(({ accountName, characterId }) => ({ accountName, characterId })));
  room.members = members;
  rooms.save({ id: room.id, ownerAccount: room.ownerAccount, config: room.config,
    started: room.started, billing: room.billing, participants: room.participants, members });
};
const ensureCampaign = (room) => {
  if (!room.campaign) return null;
  campaignService.migrateCampaign(room.campaign);
  campaignService.syncPartyStats(room.campaign, room.players);
  campaignService.applyPartyStatsToPlayers(room.campaign, room.players);
  return room.campaign;
};
const turnState = (room) => {
  const lines = logs.readRoomLines(room.id);
  const lastDmIndex = lines.map((line) => line.type).lastIndexOf('dm_reply');
  const round = lines.slice(lastDmIndex + 1);
  // Pending checks belong to persisted party members even if another player reconnects first.
  const rollTargets = room.players.slice();
  for (const member of room.members) {
    const name = room.campaign?.partyStats?.[member.accountName]?.characterName;
    if (name && !rollTargets.some(player => player.accountName === member.accountName)) {
      rollTargets.push({ ...member, name });
    }
  }
  const rollRequests = parseRollRequests(lines[lastDmIndex]?.content || '').flatMap((request) => {
    const player = rollTargets.find((item) => sameName(item.name, request.player));
    if (!player) return [];
    const id = `${lastDmIndex}-${request.index}-${player.name}-${request.skill}`;
    const result = round.find((line) => line.type === 'player_action' &&
      (line.accountName ? line.accountName === player.accountName : sameName(line.playerName, player.name)) &&
      (line.rollId === id || (!line.rollId && isRollResultMessage(line.content) && line.content.startsWith(`[对 ${request.skill} 进行检定]`))));
    return [{ ...request, id, characterId: player.characterId, resolved: Boolean(result), result: result?.content || '' }];
  });
  const pendingRolls = rollRequests.filter((request) => !request.resolved);
  const actedAccounts = room.players.filter((player) => round.some((line) => line.type === 'player_action' &&
    !isRollResultMessage(line.content) && (line.accountName ? line.accountName === player.accountName : sameName(line.playerName, player.name))))
    .map((player) => player.accountName);
  const pendingPlayers = room.players.filter((player) => !actedAccounts.includes(player.accountName)).map((player) => player.name);
  const completed = room.campaign?.phase !== 'active';
  const mode = completed ? 'completed' : room.dmInFlight ? 'waiting_dm' : pendingRolls.length ? 'waiting_rolls' :
    rollRequests.length || !pendingPlayers.length ? 'waiting_dm' : 'waiting_players';
  return { roomId: room.id, mode, inputLocked: mode !== 'waiting_players',
    actedPlayers: room.players.filter((p) => actedAccounts.includes(p.accountName)).map((p) => p.name),
    pendingPlayers: rollRequests.length ? [] : pendingPlayers, rollRequests, pendingRolls,
    pendingRollPlayers: [...new Set(pendingRolls.map((request) => request.player))],
    retryMessage: room.dmError ? room.dmErrorText : undefined,
    canRetry: Boolean(room.dmError) && !room.dmInFlight };
};
const emitState = (io, room) => {
  ensureCampaign(room);
  const owner = room.players.find((player) => player.accountName === room.ownerAccount);
  io.to(room.id).emit('lobby_update', {
    ownerName: owner?.name || room.ownerAccount, ownerId: owner?.id, roomConfig: room.config, started: room.started,
    players: room.players.map(({ id, name, characterId, characterName, role, hp, san, mp, hpMax, sanMax, mpMax }) =>
      ({ id, name, characterId, characterName, role, hp, san, mp, hpMax: hpMax ?? hp, sanMax: sanMax ?? san, mpMax: mpMax ?? mp })),
  });
  if (room.campaign) {
    io.to(room.id).emit('campaign_state', campaignService.getPublicCampaign(room.campaign));
    io.to(room.id).emit('turn_state', turnState(room));
  }
};
const snapshot = (socket, room) => {
  socket.emit('room_snapshot', { roomId: room.id, messages: logs.listRoomMessages(room.id),
    campaign: room.campaign ? campaignService.getPublicCampaign(room.campaign) : null, turnState: turnState(room) });
};
const maybeRunDm = async (io, room) => {
  if (!room.started || !room.players.length || room.dmInFlight || room.campaign?.phase !== 'active') return;
  const state = turnState(room);
  if (state.pendingRolls.length || (!state.rollRequests.length && state.pendingPlayers.length)) return;
  room.dmInFlight = true;
  room.dmError = false;
  let settle;
  const payer = room.ownerAccount;
  emitState(io, room);
  try {
    if (room.billing?.owner !== payer) throw new Error('请房主选择主持 API。');
    const byok = room.billing.mode === 'custom';
    const provider = byok ? profiles.load(payer) : undefined;
    if (byok && !provider) throw new Error('请房主保存自有 API 配置。');
    if (!byok) settle = credits.reserve(payer);
    const result = campaignService.normalizeDirectorResult(await ai.generateDirectorReply({
      provider,
      lines: logs.readRoomLines(room.id),
      directorContext: campaignService.buildDirectorContext({ campaign: room.campaign, players: room.players }),
    }));
    const requestedCount = result.requestedRolls.length;
    const seen = new Set();
    result.requestedRolls = result.requestedRolls.filter((request) => {
      const player = room.players.find((item) => sameName(item.name, request?.player));
      const skill = String(request?.skill || '').trim().replace(/:/g, '：').slice(0, 50);
      if (!player || seen.has(player.accountName) || /[<>:]/.test(skill) || skillValue(player, skill) === null) return false;
      request.skill = skill;
      request.player = player.name.trim();
      seen.add(player.accountName);
      return true;
    });
    if (requestedCount && !result.requestedRolls.length) throw new Error('主持返回的检定目标或技能无效');
    const applied = campaignService.applyDirectorResult({ campaign: room.campaign, directorResult: result });
    const changes = [];
    // A pending roll may not apply its consequences early, including HP/SAN/MP.
    for (const change of result.requestedRolls.length ? [] : result.statChanges.slice(0, room.players.length * 3)) {
      const player = room.players.find((item) => sameName(item.name, change?.player));
      const type = String(change?.type || '').toUpperCase();
      const value = Math.round(Number(change?.value));
      if (player && ['HP', 'SAN', 'MP'].includes(type) && Number.isFinite(value) && value !== 0) {
        changes.push({ accountName: player.accountName, playerName: player.name, type, value: Math.min(100, Math.max(-100, value)) });
      }
    }
    room.campaign = applied.campaign;
    campaignService.applyPartyStatChanges(room.campaign, changes);
    const content = [stripDirectives(result.narration) || '局势暂时没有变化。',
      ...result.requestedRolls.map((request) => `<<ROLL:${request.skill}:${request.player}>>`),
      ...changes.map((change) => `<<STAT:${change.playerName}:${change.type}:${change.value}>>`),
      applied.transition?.entryNarration, applied.ending?.result?.publicNarration].filter(Boolean).join('\n\n');
    logs.appendDmReply({ roomId: room.id, content });
    logs.appendCampaignState({ roomId: room.id, campaign: room.campaign });
    settle?.(true);
    io.to(room.id).emit('new_message', { role: 'dm', sender: '系统 DM', content });
  } catch (error) {
    room.dmError = true;
    room.dmErrorText = /^(请房主|站点额度不足|自有 API 响应超时|自有 API 返回 HTTP \d{3}$|无法连接自有 API)/.test(error.message) ? error.message : '主持调用失败，请检查配置后重试。';
    console.error('AI 推进失败:', error.message);
    io.to(room.id).emit('dm_error', { message: '主持回复失败，行动已保留，可重试。' });
  } finally {
    settle?.(false);
    room.dmInFlight = false;
    io.to(room.id).emit('billing_changed');
    emitState(io, room);
  }
};
const removePlayer = (io, socket, room, preserveMembership = false) => {
  const player = room.players.find((p) => p.accountName === socket.data.user.username);
  if (!player || (player.id && player.id !== socket.id)) return;
  clearTimeout(player.disconnectTimer);
  room.players = room.players.filter((p) => p !== player);
  socket.leave(room.id);
  if (socket.data.roomId === room.id) socket.data.roomId = null;
  const successor = room.players.find((p) => p.id);
  if (room.ownerAccount === player.accountName && (successor || (!preserveMembership && room.billing?.mode !== 'custom'))) {
    if (successor) room.ownerAccount = successor.accountName;
    room.billing = null;
  }
  if (!preserveMembership) persist(room, player.accountName);
  else {
    // Keep the disconnected player's selection for rejoin/restart, but transfer an offline owner.
    const record = rooms.get(room.id);
    record.ownerAccount = room.ownerAccount;
    record.billing = room.billing;
    rooms.save(record);
  }
  emitState(io, room);
  if (!room.dmError) void maybeRunDm(io, room);
  if (!room.players.length && !room.dmInFlight) liveRooms.delete(room.id);
};

module.exports = (io) => {
  io.on('connection', (socket) => {
    const username = socket.data.user.username;
    const handle = (event, fn) => socket.on(event, async (payload, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      try {
        if (!require('../middleware/authenticate').getAuthenticatedUser(socket.handshake.headers.cookie)) { socket.disconnect(true); return; }
        const now = Date.now();
        if (!socket.data.quota || now > socket.data.quota.until) socket.data.quota = { count: 0, until: now + 10000 };
        if (++socket.data.quota.count > 60) { reply({ success: false, reason: 'rate_limited' }); return; }
        await fn(payload, reply);
      } catch (error) {
        console.error(`Socket ${event}:`, error.message);
        reply({ success: false, reason: 'invalid_request' });
        socket.emit('action_rejected', { reason: 'invalid_request' });
      }
    });
    const member = (id) => {
      if (!isValidRoomId(id)) return null;
      const room = loadRoom(id);
      return room?.players.some((p) => p.accountName === username && p.id === socket.id) ? room : null;
    };
    const attach = (room, card) => {
      if (socket.data.roomId && socket.data.roomId !== room.id) {
        const old = liveRooms.get(socket.data.roomId);
        if (old) removePlayer(io, socket, old);
      }
      let player = room.players.find((p) => p.accountName === username);
      if (player?.id && player.id !== socket.id) {
        const oldSocket = io.sockets.sockets.get(player.id);
        oldSocket?.emit('session_error', { reason: 'session_replaced' });
        oldSocket?.leave(room.id);
        if (oldSocket) oldSocket.data.roomId = null;
      }
      clearTimeout(player?.disconnectTimer);
      const replacement = playerFrom(username, card, socket.id);
      if (player) Object.assign(player, replacement); else { player = replacement; room.players.push(player); }
      socket.join(room.id);
      socket.data.roomId = room.id;
      if (!room.participants.includes(username)) room.participants.push(username);
      persist(room);
      ensureCampaign(room);
    };
    handle('create_room', (_, ack) => {
      const room = rooms.create(username);
      if (profiles.summary(username)?.preferred) {
        room.billing = { owner: username, mode: 'custom' };
        rooms.save(room);
      }
      ack({ success: true, roomId: room.id });
    });
    handle('join_lobby', (data, ack) => {
      const { roomId, characterInfo = {} } = data || {};
      if (!isValidRoomId(roomId)) return ack({ success: false, reason: 'invalid_room' });
      const room = loadRoom(roomId);
      if (!room) return ack({ success: false, reason: 'room_not_found' });
      const savedMember = rooms.get(roomId).members.find((p) => p.accountName === username);
      if (room.started && !savedMember) return ack({ success: false, reason: 'game_started' });
      const characterId = room.started ? savedMember.characterId : characterInfo.id;
      const card = characterId ? ownedCharacter(username, characterId) : null;
      if (characterId && !card) return ack({ success: false, reason: 'invalid_character' });
      if (room.players.some((p) => p.accountName !== username && sameName(p.name, card?.name || username))) {
        return ack({ success: false, reason: 'duplicate_name' });
      }
      attach(room, card);
      emitState(io, room);
      if (!room.started) socket.emit('lobby_chat_snapshot', { roomId, ...lobbyChat.history(roomId) });
      ack({ success: true, started: room.started, characterId: card?.id || null });
    });
    handle('join_room', (roomId, ack) => {
      if (!isValidRoomId(roomId) || !rooms.isMember(roomId, username)) return ack({ success: false, reason: 'forbidden' });
      const room = loadRoom(roomId);
      if (!room?.started) return ack({ success: false, reason: 'not_started' });
      const selection = rooms.get(roomId).members.find((p) => p.accountName === username);
      const card = ownedCharacter(username, selection.characterId);
      if (!card) return ack({ success: false, reason: 'invalid_character' });
      attach(room, card);
      snapshot(socket, room);
      emitState(io, room);
      ack({ success: true, characterId: card.id });
      if (!room.dmError) void maybeRunDm(io, room);
    });
    handle('sync_character', (data, ack) => {
      const room = member(data?.roomId);
      if (!room) return ack({ success: false, reason: 'forbidden' });
      // Started games use the server's selected character, never an incoming client snapshot.
      emitState(io, room);
      ack({ success: true });
    });
    handle('update_room_config', (data, ack) => {
      const room = member(data?.roomId);
      if (!room || room.ownerAccount !== username) return ack({ success: false, reason: 'forbidden' });
      if (room.started) return ack({ success: false, reason: 'game_started' });
      if (!campaignService.isSupportedScriptId(data.scriptId)) return ack({ success: false, reason: 'scenario_not_implemented' });
      room.config = { scriptId: data.scriptId, rules: normalizeRoomRules(data.rules || {}, room.config.rules) };
      persist(room);
      emitState(io, room);
      ack({ success: true, roomConfig: room.config });
    });
    const ownerOnly = (event, callback) => handle(event, (data, ack) => {
      const room = member(data?.roomId);
      if (!room || room.ownerAccount !== username) return ack({ success: false, reason: 'forbidden' });
      try { callback(room, data, ack); }
      catch (error) { ack({ success: false, message: error.message }); }
    });
    const accountState = room => {
      const profile = profiles.summary(username);
      const mode = room.billing?.owner === username ? room.billing.mode : null;
      return { success: true, balance: credits.balance(username), mode, profile,
        configured: mode === 'site' || (mode === 'custom' && Boolean(profile)) };
    };
    ownerOnly('host_api_status', (room, _, ack) => ack(accountState(room)));
    ownerOnly('redeem_cdk', (room, data, ack) => { credits.redeem(username, data.code); ack(accountState(room)); });
    ownerOnly('set_host_api', (room, data, ack) => {
      if (room.dmInFlight) return ack({ success: false, message: '请等待当前主持回复后再切换。' });
      if (!['custom', 'site'].includes(data.mode)) return ack({ success: false, message: '请选择 API。' });
      if (data.mode === 'custom') profiles.save(username, data);
      else profiles.preferSite(username);
      room.billing = { owner: username, mode: data.mode };
      persist(room);
      ack(accountState(room));
    });
    ownerOnly('forget_host_api', (room, _, ack) => {
      if (room.dmInFlight) return ack({ success: false, message: '请等待当前主持回复结束。' });
      profiles.forget(username);
      ack(accountState(room));
    });
    handle('host_start_game', (data, ack) => {
      const room = member(data?.roomId);
      if (!room || room.ownerAccount !== username) return ack({ success: false, reason: 'forbidden' });
      if (room.started || room.dmInFlight) return ack({ success: false, reason: 'game_started' });
      if (room.billing?.owner !== username || (room.billing.mode === 'custom' && !profiles.load(username))) return ack({ success: false, message: '请先配置主持 API。' });
      if (room.billing.mode === 'site' && credits.balance(username) < 1) return ack({ success: false, message: '请先兑换 CDK 或使用自有 API。' });
      if (!room.players.length || room.players.some((p) => !p.characterId || !p.id)) return ack({ success: false, reason: 'missing_character' });
      for (const player of room.players) {
        const card = ownedCharacter(player.accountName, player.characterId);
        const error = require('../domain/characterValidation').validateForRoom(card, room.config.rules);
        if (error) return ack({ success: false, reason: 'invalid_character_rules', message: `${player.name}：${error}` });
        Object.assign(player, playerFrom(player.accountName, card, player.id));
      }
      if (data.loadSaveId) {
        const save = saves.findOwnedSave(username, data.loadSaveId);
        if (!save) return ack({ success: false, reason: 'invalid_save' });
        const savedLines = require('../storage/jsonFile').readJsonLines(saves.getSavePath(save.id));
        const campaign = [...savedLines].reverse().find((line) => line.type === 'campaign_state')?.campaign;
        if (!campaign) return ack({ success: false, reason: 'invalid_save' });
        const savedParty = Object.entries(campaign.partyStats || {});
        if (savedParty.length !== room.players.length || savedParty.some(([account, stats]) =>
          !room.players.some((p) => p.accountName === account && p.characterId === stats.characterId && sameName(p.name, stats.characterName)))) {
          return ack({ success: false, reason: 'save_party_mismatch' });
        }
        if (!logs.loadLogFrom(room.id, saves.getSavePath(save.id))) return ack({ success: false, reason: 'invalid_save' });
        room.campaign = campaign;
        room.config.scriptId = campaign.scriptId;
      } else {
        room.campaign = campaignService.createCampaign(room.config.scriptId);
        ensureCampaign(room);
        logs.resetRoomLog(room.id);
        const scene = campaignService.getCurrentScene(campaignService.getScenario(room.campaign), room.campaign);
        logs.appendDmReply({ roomId: room.id, content: scene.entryNarration });
        logs.appendCampaignState({ roomId: room.id, campaign: room.campaign });
      }
      room.participants = room.players.map(player => player.accountName);
      room.started = true;
      persist(room);
      ack({ success: true });
      io.to(room.id).emit('go_to_game');
      emitState(io, room);
    });
    handle('lobby_chat_history', (data, ack) => {
      const room = member(data?.roomId);
      if (!room) return ack({ success: false, reason: 'forbidden' });
      ack({ success: true, roomId: room.id, ...lobbyChat.history(room.id, data.page) });
    });
    handle('lobby_chat_send', (data, ack) => {
      const room = member(data?.roomId);
      if (!room) return ack({ success: false, reason: 'forbidden' });
      const player = room.players.find((p) => p.accountName === username);
      const text = String(data.msg?.text || '').trim().slice(0, 2000);
      if (!text) return ack({ success: false, message: '请输入消息。' });
      const message = lobbyChat.append(room.id, player.name, text);
      io.to(room.id).emit('lobby_chat_receive', message);
      ack({ success: true });
    });
    handle('leave_room', (data, ack) => {
      const room = member(data?.roomId);
      if (room) removePlayer(io, socket, room);
      ack({ success: true });
    });
    handle('player_action', (data, ack) => {
      const room = member(data?.roomId);
      const reject = (reason) => { ack({ success: false, reason }); socket.emit(data?.isRoll ? 'roll_rejected' : 'action_rejected', { reason, rollId: data?.rollId }); };
      if (!room || !room.started) return reject('forbidden');
      if (room.campaign?.phase !== 'active') return reject('campaign_completed');
      if (room.dmInFlight || room.dmError) return reject('waiting_dm');
      const player = room.players.find((p) => p.accountName === username);
      const state = turnState(room);
      let message;
      let rollId;
      if (data.isRoll) {
        const request = state.pendingRolls.find((roll) => roll.id === data.rollId && roll.characterId === player.characterId);
        if (!request) return reject('invalid_roll');
        message = rollSkill(player, request.skill);
        rollId = request.id;
      } else {
        if (state.inputLocked || state.actedPlayers.includes(player.name)) return reject('turn_locked');
        message = String(data.message || '').trim().slice(0, 4000);
        if (!message || isRollResultMessage(message) || /<<(?:ROLL|STAT):/.test(message)) return reject('invalid_action');
      }
      logs.appendAction({ roomId: room.id, playerName: player.name, accountName: username, content: message, rollId });
      io.to(room.id).emit('new_message', { role: data.isRoll ? 'roll' : 'player', sender: player.name, content: message, rollId });
      ack({ success: true });
      emitState(io, room);
      void maybeRunDm(io, room);
    });
    handle('retry_dm', (data, ack) => {
      const room = member(data?.roomId);
      if (!room || !room.dmError) return ack({ success: false, reason: 'not_retryable' });
      ack({ success: true });
      void maybeRunDm(io, room);
    });
    socket.on('disconnect', () => {
      const room = liveRooms.get(socket.data.roomId);
      const player = room?.players.find((p) => p.id === socket.id);
      if (!player) return;
      player.id = null;
      emitState(io, room);
      player.disconnectTimer = setTimeout(() => removePlayer(io, socket, room, true), config.reconnectGraceMs);
      player.disconnectTimer.unref();
    });
  });
};
