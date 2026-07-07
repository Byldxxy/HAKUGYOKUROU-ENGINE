const roomLogRepository = require('../repositories/roomLogRepository');
const saveRepository = require('../repositories/saveRepository');
const aiService = require('../services/aiService');
const characterRepository = require('../repositories/characterRepository');
const { isValidRoomId } = require('../domain/validation');
const { DEFAULT_ROOM_RULES, normalizeRoomRules } = require('../domain/roomRules');
const {
  parseRollRequests,
  parseRollActionSkill,
  isRollResultMessage,
} = require('../domain/directives');

const liveRooms = {};
const getOwnedCharacter = (username, characterId) => {
  if (!characterId) return null;
  return characterRepository.listByUsername(username).find((card) => card.id === characterId) || null;
};

const consumeSocketQuota = (socket, max = 30, windowMs = 10_000) => {
  const now = Date.now();
  const quota = !socket.data.eventQuota || socket.data.eventQuota.resetAt <= now
    ? { count: 0, resetAt: now + windowMs }
    : socket.data.eventQuota;
  quota.count += 1;
  socket.data.eventQuota = quota;
  return quota.count <= max;
};

// SECTION: 大厅广播
// NOTE: liveRooms 是内存态，广播时只发送前端需要展示的房主和玩家列表。
const emitLobbyUpdate = (io, roomId) => {
  const room = liveRooms[roomId];
  if (!room) return;

  io.to(roomId).emit('lobby_update', {
    ownerName: room.ownerName,
    roomConfig: room.config,
    players: room.players.map((player) => ({
      id: player.id,
      name: player.name,
      characterId: player.characterId,
      characterName: player.characterName,
      role: player.role,
      hp: player.hp,
      san: player.san,
      mp: player.mp,
    })),
  });
};

// SECTION: 大厅玩家快照
// NOTE: playerName 现在等同于角色卡姓名；accountName 字段暂时保留给旧数据兼容。
const buildLobbyPlayer = ({ socketId, username, characterInfo = {}, existingPlayer = {} }) => {
  const hasCharacterSelection = characterInfo.id !== null && characterInfo.id !== undefined;
  return {
    ...existingPlayer,
    id: socketId,
    name: characterInfo.name,
    accountName: username,
    characterId: hasCharacterSelection ? characterInfo.id : null,
    characterName: hasCharacterSelection ? characterInfo.name : null,
    role: characterInfo.role || '无角色卡',
    hp: characterInfo.hp ?? '-',
    san: characterInfo.san ?? '-',
    mp: characterInfo.mp ?? '-',
    fullData: hasCharacterSelection ? (characterInfo.fullData || null) : null,
  };
};

// SECTION: 角色卡兼容读取
// NOTE: fullData 可能来自角色卡完整结构，也可能来自旧的扁平结构。
const getSyncedCharacterName = (fullData) => {
  return fullData?.basicInfo?.name || fullData?.fullData?.basicInfo?.name || fullData?.name;
};

const getSyncedRole = (fullData) => {
  return fullData?.basicInfo?.occupation || fullData?.fullData?.basicInfo?.occupation || fullData?.role || '未知职业';
};

// SECTION: 重复检定拦截
// NOTE: 新请求优先使用 rollId；旧日志没有 rollId 时回退到“角色 + 技能”判断。
const hasRollResultInCurrentRound = ({ lines, playerName, skillName, rollId }) => {
  if (!skillName && !rollId) return false;

  const lastDmIndex = lines.map((line) => line.type).lastIndexOf('dm_reply');
  const currentRound = lines.slice(lastDmIndex + 1);

  return currentRound.some((line) => (
    line.type === 'player_action' &&
    line.playerName === playerName &&
    isRollResultMessage(line.content) &&
    (
      (rollId && line.rollId === rollId) ||
      (!rollId && parseRollActionSkill(line.content) === skillName)
    )
  ));
};

// SECTION: 玩家名解析
// NOTE: AI 输出的是角色卡姓名，但历史字段里可能叫 name、accountName 或 characterName。
const resolvePlayerName = (room, targetName) => {
  const target = (targetName || '').trim();
  const player = room?.players.find((item) => (
    item.name === target ||
    item.accountName === target ||
    item.characterName === target ||
    item.fullData?.basicInfo?.name === target ||
    item.fullData?.fullData?.basicInfo?.name === target
  ));

  return player?.name || player?.characterName || player?.accountName || null;
};

// SECTION: 房间玩家名单
// NOTE: 回合状态只关心当前可行动的展示名，过滤掉空值避免锁定异常。
const getRoomPlayerNames = (room) => {
  return (room?.players || []).map((player) => player.name || player.characterName || player.accountName).filter(Boolean);
};

// SECTION: 当前回合切片
// NOTE: 最后一条 DM 之后的所有日志都属于当前玩家行动/检定回合。
const getCurrentRound = (lines) => {
  const lastDmIndex = lines.map((line) => line.type).lastIndexOf('dm_reply');
  return {
    lastDmIndex,
    lastDmMessage: lastDmIndex !== -1 ? lines[lastDmIndex].content : '',
    currentRound: lines.slice(lastDmIndex + 1),
  };
};

// SECTION: 检定结果定位
// NOTE: turn_state 需要知道每个 ROLL 是否已有结果，才能决定是否继续锁输入框。
const findRollResultLine = ({ currentRound, playerName, skillName, rollId }) => {
  return currentRound.find((line) => (
    line.type === 'player_action' &&
    line.playerName === playerName &&
    isRollResultMessage(line.content) &&
    (
      (rollId && line.rollId === rollId) ||
      (!line.rollId && parseRollActionSkill(line.content) === skillName)
    )
  ));
};

// NOTE: 回合状态由后端统一推导，前端只负责展示和锁定输入。
const buildTurnState = ({ roomId, room, lines }) => {
  const playerNames = getRoomPlayerNames(room);
  const { lastDmIndex, lastDmMessage, currentRound } = getCurrentRound(lines);
  const rollRequests = parseRollRequests(lastDmMessage).map((request) => {
    const playerName = resolvePlayerName(room, request.player) || request.player;
    // NOTE: rollId 必须稳定可复算，刷新后前端才能把结果回填到同一个判定框。
    const rollId = `${lastDmIndex}-${request.index}-${playerName}-${request.skill}`;
    const resultLine = findRollResultLine({
      currentRound,
      playerName,
      skillName: request.skill,
      rollId,
    });

    return {
      id: rollId,
      index: request.index,
      skill: request.skill,
      player: playerName,
      originalPlayer: request.player,
      resolved: Boolean(resultLine),
      result: resultLine?.content || '',
    };
  });

  // NOTE: 玩家普通行动不包含 D100；检定结果属于 ROLL 流程，不算作普通发言。
  const pendingRolls = rollRequests.filter((request) => !request.resolved);
  const actionLines = currentRound.filter((line) => line.type === 'player_action' && !isRollResultMessage(line.content));
  const actedPlayers = Array.from(new Set(actionLines.map((line) => line.playerName)));
  const pendingPlayers = playerNames.filter((name) => !actedPlayers.includes(name));

  if (rollRequests.length > 0) {
    // NOTE: 只要 DM 发出了 ROLL，本轮就进入检定门；全部投完后等待 AI 结算。
    return {
      roomId,
      mode: pendingRolls.length > 0 ? 'waiting_rolls' : 'waiting_dm',
      inputLocked: true,
      players: playerNames,
      actedPlayers,
      pendingPlayers: [],
      rollRequests,
      pendingRolls,
      pendingRollPlayers: Array.from(new Set(pendingRolls.map((request) => request.player))),
    };
  }

  return {
    roomId,
    mode: pendingPlayers.length > 0 ? 'waiting_players' : 'waiting_dm',
    inputLocked: pendingPlayers.length === 0,
    players: playerNames,
    actedPlayers,
    pendingPlayers,
    rollRequests: [],
    pendingRolls: [],
    pendingRollPlayers: [],
  };
};

// SECTION: 回合状态广播
// NOTE: 每次玩家进房、同步角色、行动、AI 回复后都应广播，保证刷新/重连能恢复锁定状态。
const emitTurnState = (io, roomId) => {
  const room = liveRooms[roomId];
  if (!room) return null;

  const lines = roomLogRepository.readRoomLines(roomId);
  const turnState = buildTurnState({ roomId, room, lines });
  io.to(roomId).emit('turn_state', turnState);
  return turnState;
};

// SECTION: AI 触发条件
// NOTE: 不直接读取前端状态，而是复用 buildTurnState，确保广播状态和触发条件一致。
const shouldTriggerDm = ({ room, lines }) => {
  if (!room || room.players.length === 0) return false;

  const turnState = buildTurnState({ roomId: undefined, room, lines });
  if (turnState.rollRequests.length > 0) {
    if (turnState.pendingRolls.length > 0) {
      console.log(`⏳ [等待检定] 还需要等待: ${turnState.pendingRollPlayers.join(', ')}`);
      return false;
    }
    return true;
  }

  const allActed = turnState.pendingPlayers.length === 0;
  if (!allActed) {
    console.log(`⏳ [等待发言] 房间共 ${room.players.length} 人，当前已有 ${turnState.actedPlayers.length} 人行动`);
  }
  return allActed;
};

// SECTION: 玩家离房
// NOTE: 主动离开和断线共用同一逻辑；房间空了就销毁内存状态。
const removePlayerFromRoom = ({ io, socket, roomId, playerName, reason = '离开' }) => {
  const room = liveRooms[roomId];
  if (!room) return false;

  const playerIndex = room.players.findIndex((player) => (
    player.id === socket.id ||
    (playerName && (player.accountName === playerName || player.name === playerName))
  ));
  if (playerIndex === -1) return false;

  const removedPlayer = room.players.splice(playerIndex, 1)[0];
  socket.leave(roomId);
  console.log(`🚪 玩家 ${removedPlayer.name} ${reason}了房间 ${roomId}`);

  if (room.players.length === 0) {
    delete liveRooms[roomId];
    console.log(`🗑️ 房间 ${roomId} 已清空并销毁`);
  } else {
    emitLobbyUpdate(io, roomId);
  }

  return true;
};

const registerRoomSocket = (io) => {
  io.on('connection', (socket) => {
    const username = socket.data.user.username;
    socket.use((event, next) => {
      if (socket.data.user.expiresAt <= Math.floor(Date.now() / 1000)) {
        socket.disconnect(true);
        return;
      }
      next();
    });
    console.log(`⚡ 新玩家已连接，连接 ID: ${socket.id}`);

    // SECTION: 大厅加入
    // NOTE: 大厅身份以角色卡姓名为准；同一 socket 或同一角色名重复进入时更新旧条目。
    socket.on('join_lobby', ({ roomId, characterInfo = {} }, ack) => {
      if (!isValidRoomId(roomId)) {
        if (typeof ack === 'function') ack({ success: false, reason: 'invalid_room' });
        return;
      }
      if (!consumeSocketQuota(socket)) {
        if (typeof ack === 'function') ack({ success: false, reason: 'rate_limited' });
        return;
      }
      const hasRequestedCharacter = Boolean(characterInfo.id);
      const ownedCharacter = hasRequestedCharacter ? getOwnedCharacter(username, characterInfo.id) : null;
      if (hasRequestedCharacter && !ownedCharacter) {
        console.warn(`⚠️ 账号 ${username} 加入房间 ${roomId} 失败：角色 ${characterInfo.id || '(empty)'} 不属于该账号`);
        socket.emit('session_error', { reason: 'invalid_character' });
        if (typeof ack === 'function') ack({ success: false, reason: 'invalid_character' });
        return;
      }
      const lobbyCharacter = ownedCharacter || {
        id: null,
        name: username,
        role: '无角色卡',
        hp: '-',
        san: '-',
        mp: '-',
      };
      const playerName = lobbyCharacter.name;
      socket.join(roomId);

      if (!liveRooms[roomId]) {
        liveRooms[roomId] = {
          ownerName: playerName,
          ownerAccount: username,
          config: {
            scriptId: 'peach',
            rules: { ...DEFAULT_ROOM_RULES },
          },
          players: [],
        };
        console.log(`🏠 玩家 ${playerName} 创建了新房间: ${roomId} 并成为房主`);
      }

      const room = liveRooms[roomId];
      const existingPlayerIndex = room.players.findIndex((player) => (
        player.id === socket.id ||
        player.accountName === username
      ));

      if (existingPlayerIndex !== -1) {
        const existingPlayer = room.players[existingPlayerIndex];
        // NOTE: 房主切换角色名时，ownerName 必须跟着迁移，否则会丢房主权限。
        const wasOwner = [existingPlayer.name, existingPlayer.accountName, existingPlayer.characterName].includes(room.ownerName);
        room.players[existingPlayerIndex] = buildLobbyPlayer({
          socketId: socket.id,
          username,
          characterInfo: lobbyCharacter,
          existingPlayer,
        });
        if (wasOwner) room.ownerName = playerName;
      } else {
        room.players.push(buildLobbyPlayer({ socketId: socket.id, username, characterInfo: lobbyCharacter }));
      }

      socket.data.roomId = roomId;
      emitLobbyUpdate(io, roomId);
      if (typeof ack === 'function') {
        ack({ success: true, ownerName: room.ownerName, playerCount: room.players.length });
      }
    });

    // SECTION: 房主房规配置
    // NOTE: 只有当前房主账号能修改；数值在服务端归一化后再广播，客户端输入不能直接成为房间状态。
    socket.on('update_room_config', ({ roomId, scriptId, rules }, ack) => {
      if (!isValidRoomId(roomId) || !consumeSocketQuota(socket)) return;
      const room = liveRooms[roomId];
      if (!room || room.ownerAccount !== username) {
        if (typeof ack === 'function') ack({ success: false, reason: 'forbidden' });
        return;
      }

      const normalizedScriptId = String(scriptId || room.config?.scriptId || 'peach').slice(0, 50);
      room.config = {
        scriptId: normalizedScriptId,
        rules: normalizeRoomRules(rules, room.config?.rules || DEFAULT_ROOM_RULES),
      };
      emitLobbyUpdate(io, roomId);
      if (typeof ack === 'function') ack({ success: true, roomConfig: room.config });
    });

    // SECTION: 游戏房间加入
    // NOTE: 游戏页加入后立刻补发 turn_state，让刷新后的输入锁保持正确。
    socket.on('join_room', (roomId) => {
      if (!isValidRoomId(roomId) || !consumeSocketQuota(socket)) return;
      socket.join(roomId);
      socket.data.roomId = roomId;
      emitLobbyUpdate(io, roomId);
      emitTurnState(io, roomId);
    });

    // SECTION: 角色同步
    // NOTE: 参数 nickname 是旧命名，现在实际传入角色卡姓名。
    socket.on('sync_character', ({ roomId, fullData }) => {
      if (!isValidRoomId(roomId) || !consumeSocketQuota(socket)) return;
      const characterId = fullData?.id || fullData?.fullData?.id;
      const ownedCharacter = getOwnedCharacter(username, characterId);
      if (!ownedCharacter) {
        socket.emit('session_error', { reason: 'invalid_character' });
        return;
      }
      const nickname = ownedCharacter.name;
      fullData = ownedCharacter;
      socket.join(roomId);
      if (!liveRooms[roomId]) {
        liveRooms[roomId] = {
          ownerName: nickname,
          ownerAccount: username,
          config: { scriptId: 'peach', rules: { ...DEFAULT_ROOM_RULES } },
          players: [],
        };
      }
      const room = liveRooms[roomId];

      let player = room.players.find((item) => (
        item.id === socket.id ||
        item.accountName === username ||
        item.name === nickname ||
        item.characterName === nickname
      ));
      const characterName = getSyncedCharacterName(fullData);
      const role = getSyncedRole(fullData);

      if (player) {
        // NOTE: 同一个玩家进入游戏页后 socket.id 会变化，这里用最新连接覆盖旧连接。
        const wasOwner = [player.name, player.accountName, player.characterName].includes(room.ownerName);
        player.id = socket.id;
        player.name = nickname;
        player.accountName = username;
        player.fullData = fullData;
        player.characterId = fullData?.id || player.characterId;
        player.characterName = characterName || player.characterName;
        player.hp = fullData?.hp;
        player.san = fullData?.san;
        player.mp = fullData?.mp;
        player.role = role;
        if (wasOwner) room.ownerName = nickname;
      } else {
        // NOTE: 允许游戏页直接同步角色，以兜底大厅玩家列表丢失或后端重启后的情况。
        room.players.push({
          id: socket.id,
          name: nickname,
          accountName: username,
          characterId: fullData?.id,
          characterName,
          fullData,
          hp: fullData?.hp,
          san: fullData?.san,
          mp: fullData?.mp,
          role,
        });
      }

      emitLobbyUpdate(io, roomId);
      emitTurnState(io, roomId);
      socket.data.roomId = roomId;
      console.log(`🔄 玩家 ${nickname} 的角色卡已同步至房间 ${roomId}`);
    });

    // SECTION: 房主发车
    // NOTE: 新游戏会清空旧日志；加载存档会把存档 JSONL 恢复成当前房间日志。
    socket.on('host_start_game', ({ roomId, loadSaveId }) => {
      if (!isValidRoomId(roomId) || !consumeSocketQuota(socket)) return;
      const room = liveRooms[roomId];
      const player = room?.players.find((item) => item.id === socket.id);

      if (!room || !player || room.ownerAccount !== username) return;

      if (loadSaveId) {
        if (!saveRepository.findOwnedSave(username, loadSaveId)) {
          socket.emit('session_error', { reason: 'invalid_save' });
          return;
        }
        const loaded = roomLogRepository.loadLogFrom(roomId, saveRepository.getSavePath(loadSaveId));
        if (loaded) {
          console.log(`📂 房主加载了存档 ${loadSaveId}，房间 ${roomId} 恢复记忆`);
        }
      } else {
        roomLogRepository.resetRoomLog(roomId);
        console.log(`🧹 房间 ${roomId} 的旧时间线已被抹除，开启全新战役`);
      }

      console.log('🎮 房主下达发车指令！全员进入正式游戏');
      io.to(roomId).emit('go_to_game');
    });

    socket.on('lobby_chat_send', ({ roomId, msg }) => {
      if (!isValidRoomId(roomId) || !consumeSocketQuota(socket)) return;
      const player = liveRooms[roomId]?.players.find((item) => item.id === socket.id && item.accountName === username);
      const text = String(msg?.text || '').trim().slice(0, 1000);
      if (!player || !text) return;
      io.to(roomId).emit('lobby_chat_receive', {
        id: Date.now(),
        sender: player.name,
        text,
        isSystem: false,
      });
    });

    // SECTION: 主动离开
    // NOTE: ack 用于让前端不用等 disconnect，也能立刻返回大厅。
    socket.on('leave_room', ({ roomId }, ack) => {
      if (!roomId) {
        if (typeof ack === 'function') ack({ success: false });
        return;
      }
      removePlayerFromRoom({ io, socket, roomId, playerName: username, reason: '主动离开' });
      if (typeof ack === 'function') ack({ success: true });
    });

    // SECTION: 玩家行动入口
    // NOTE: 普通行动和骰子结果共用入口，isRoll 用于区分日志角色和 AI 触发条件。
    socket.on('player_action', async (data) => {
      if (!consumeSocketQuota(socket, 12, 10_000)) return;
      const { roomId, isRoll, rollId } = data;
      if (!isValidRoomId(roomId)) return;
      const room = liveRooms[roomId];
      const player = room?.players.find((item) => item.id === socket.id && item.accountName === username);
      if (!room || !player) return;
      const playerName = player.name;
      const message = String(data.message || '').trim().slice(0, 4000);
      if (!message) return;
      const linesBeforeAction = roomLogRepository.readRoomLines(roomId);

      if (isRoll) {
        const skillName = parseRollActionSkill(message);
        // NOTE: 这里是刷新后防重复投骰的最后防线，前端按钮锁不能作为安全依据。
        if (hasRollResultInCurrentRound({ lines: linesBeforeAction, playerName, skillName, rollId })) {
          console.log(`🛑 [重复检定拦截] ${playerName} 已完成 ${skillName} 检定，忽略重复骰子`);
          socket.emit('roll_rejected', { reason: 'duplicate_roll', skillName, rollId });
          return;
        }
      }

      roomLogRepository.appendAction({ roomId, playerName, content: message, rollId });
      console.log(`💾 [房间 ${roomId}] 收到行动: ${playerName}`);

      io.to(roomId).emit('new_message', {
        role: isRoll ? 'roll' : 'player',
        sender: playerName,
        content: message,
        rollId,
      });

      const lines = roomLogRepository.readRoomLines(roomId);
      // NOTE: 先广播 turn_state，让所有客户端立刻看到“等待谁”的最新状态。
      emitTurnState(io, roomId);
      if (!shouldTriggerDm({ room, lines })) return;

      console.log('✅ [触发条件满足] 呼叫 AI...');
      try {
        const dmReplyContent = await aiService.generateDmReply(lines);
        roomLogRepository.appendDmReply({ roomId, content: dmReplyContent });

        io.to(roomId).emit('new_message', {
          role: 'dm',
          sender: '系统 DM',
          content: dmReplyContent,
        });
        emitTurnState(io, roomId);
      } catch (error) {
        console.error('❌ AI 接口调用失败:', error.message);
        io.to(roomId).emit('new_message', {
          role: 'dm',
          sender: '系统 DM',
          content: '（星舰通讯受阻...）',
        });
        emitTurnState(io, roomId);
      }
    });

    // SECTION: 断线清理
    // NOTE: 当前版本断线即移出房间；后续如果做断线重连，需要改成保留席位。
    socket.on('disconnect', () => {
      for (const roomId in liveRooms) {
        if (removePlayerFromRoom({ io, socket, roomId, reason: '断开连接' })) break;
      }
    });
  });
};

module.exports = registerRoomSocket;
