const roomLogRepository = require('../repositories/roomLogRepository');
const saveRepository = require('../repositories/saveRepository');
const aiService = require('../services/aiService');

const liveRooms = {};

const emitLobbyUpdate = (io, roomId) => {
  const room = liveRooms[roomId];
  if (!room) return;

  io.to(roomId).emit('lobby_update', {
    ownerName: room.ownerName,
    players: room.players,
  });
};

const buildLobbyPlayer = ({ socketId, playerName, characterInfo = {}, existingPlayer = {} }) => ({
  ...existingPlayer,
  id: socketId,
  name: playerName,
  accountName: playerName,
  characterId: characterInfo.id || existingPlayer.characterId,
  characterName: characterInfo.name || existingPlayer.characterName,
  role: characterInfo.role || existingPlayer.role || '暂无角色',
  hp: characterInfo.hp ?? existingPlayer.hp,
  san: characterInfo.san ?? existingPlayer.san,
  mp: characterInfo.mp ?? existingPlayer.mp,
  fullData: characterInfo.fullData || existingPlayer.fullData,
});

const getSyncedCharacterName = (fullData) => {
  return fullData?.basicInfo?.name || fullData?.fullData?.basicInfo?.name || fullData?.name;
};

const getSyncedRole = (fullData) => {
  return fullData?.basicInfo?.occupation || fullData?.fullData?.basicInfo?.occupation || fullData?.role || '未知职业';
};

const parseExpectedRollers = (dmMessage) => {
  const rollRegex = /<<ROLL:(.*?):(.*?)(?:>>|>)/g;
  const expectedRollers = new Set();
  let match;

  while ((match = rollRegex.exec(dmMessage || '')) !== null) {
    expectedRollers.add(match[2].trim());
  }

  return expectedRollers;
};

const parseRollActionSkill = (message) => {
  const match = String(message || '').match(/^\[对\s*(.*?)\s*进行检定\]/);
  return match?.[1]?.trim() || '';
};

const hasRollResultInCurrentRound = ({ lines, playerName, skillName }) => {
  if (!skillName) return false;

  const lastDmIndex = lines.map((line) => line.type).lastIndexOf('dm_reply');
  const currentRound = lines.slice(lastDmIndex + 1);

  return currentRound.some((line) => (
    line.type === 'player_action' &&
    line.playerName === playerName &&
    parseRollActionSkill(line.content) === skillName &&
    String(line.content || '').includes('D100 =')
  ));
};

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

const shouldTriggerDm = ({ room, lines }) => {
  if (!room || room.players.length === 0) return false;

  const lastDmIndex = lines.map((line) => line.type).lastIndexOf('dm_reply');
  const lastDmMessage = lastDmIndex !== -1 ? lines[lastDmIndex].content : '';
  const currentRound = lines.slice(lastDmIndex + 1);

  const expectedRollers = parseExpectedRollers(lastDmMessage);
  const validExpectedRollers = [...expectedRollers]
    .map((name) => resolvePlayerName(room, name))
    .filter(Boolean);

  if (validExpectedRollers.length > 0) {
    const actualRollers = new Set(
      currentRound
        .filter((line) => (line.content || '').includes('D100 ='))
        .map((line) => line.playerName)
    );

    const allRolled = validExpectedRollers.every((player) => actualRollers.has(player));
    if (!allRolled) {
      console.log(`⏳ [等待检定] 还需要等待: ${validExpectedRollers.filter((p) => !actualRollers.has(p)).join(', ')}`);
    }
    return allRolled;
  }

  const actedPlayers = new Set(
    currentRound
      .filter((line) => line.type === 'player_action')
      .map((line) => line.playerName)
  );

  const allActed = actedPlayers.size >= room.players.length;
  if (!allActed) {
    console.log(`⏳ [等待发言] 房间共 ${room.players.length} 人，当前已有 ${actedPlayers.size} 人行动`);
  }
  return allActed;
};

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
    console.log(`⚡ 新玩家已连接，连接 ID: ${socket.id}`);

    socket.on('join_lobby', ({ roomId, playerName, characterInfo }) => {
      socket.join(roomId);

      if (!liveRooms[roomId]) {
        liveRooms[roomId] = {
          ownerName: playerName,
          players: [],
        };
        console.log(`🏠 玩家 ${playerName} 创建了新房间: ${roomId} 并成为房主`);
      }

      const room = liveRooms[roomId];
      const existingPlayerIndex = room.players.findIndex((player) => (
        player.id === socket.id ||
        player.accountName === playerName ||
        player.name === playerName ||
        player.characterName === playerName
      ));

      if (existingPlayerIndex !== -1) {
        const existingPlayer = room.players[existingPlayerIndex];
        const wasOwner = [existingPlayer.name, existingPlayer.accountName, existingPlayer.characterName].includes(room.ownerName);
        room.players[existingPlayerIndex] = buildLobbyPlayer({
          socketId: socket.id,
          playerName,
          characterInfo,
          existingPlayer,
        });
        if (wasOwner) room.ownerName = playerName;
      } else {
        room.players.push(buildLobbyPlayer({ socketId: socket.id, playerName, characterInfo }));
      }

      emitLobbyUpdate(io, roomId);
    });

    socket.on('join_room', (roomId) => {
      socket.join(roomId);
      emitLobbyUpdate(io, roomId);
    });

    socket.on('sync_character', ({ roomId, nickname, fullData }) => {
      socket.join(roomId);
      const room = liveRooms[roomId];
      if (!room) return;

      let player = room.players.find((item) => (
        item.id === socket.id ||
        item.accountName === nickname ||
        item.name === nickname ||
        item.characterName === nickname
      ));
      const characterName = getSyncedCharacterName(fullData);
      const role = getSyncedRole(fullData);

      if (player) {
        const wasOwner = [player.name, player.accountName, player.characterName].includes(room.ownerName);
        player.id = socket.id;
        player.name = nickname;
        player.accountName = nickname;
        player.fullData = fullData;
        player.characterId = fullData?.id || player.characterId;
        player.characterName = characterName || player.characterName;
        player.hp = fullData?.hp;
        player.san = fullData?.san;
        player.mp = fullData?.mp;
        player.role = role;
        if (wasOwner) room.ownerName = nickname;
      } else {
        room.players.push({
          id: socket.id,
          name: nickname,
          accountName: nickname,
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
      console.log(`🔄 玩家 ${nickname} 的角色卡已同步至房间 ${roomId}`);
    });

    socket.on('host_start_game', ({ roomId, loadSaveId }) => {
      const room = liveRooms[roomId];
      const player = room?.players.find((item) => item.id === socket.id);

      if (!room || !player || player.name !== room.ownerName) return;

      if (loadSaveId) {
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
      io.to(roomId).emit('lobby_chat_receive', msg);
    });

    socket.on('leave_room', ({ roomId, playerName }, ack) => {
      if (!roomId) {
        if (typeof ack === 'function') ack({ success: false });
        return;
      }
      removePlayerFromRoom({ io, socket, roomId, playerName, reason: '主动离开' });
      if (typeof ack === 'function') ack({ success: true });
    });

    socket.on('player_action', async (data) => {
      const { roomId, playerName, message, isRoll } = data;
      const room = liveRooms[roomId];
      const linesBeforeAction = roomLogRepository.readRoomLines(roomId);

      if (isRoll) {
        const skillName = parseRollActionSkill(message);
        if (hasRollResultInCurrentRound({ lines: linesBeforeAction, playerName, skillName })) {
          console.log(`🛑 [重复检定拦截] ${playerName} 已完成 ${skillName} 检定，忽略重复骰子`);
          socket.emit('roll_rejected', { reason: 'duplicate_roll', skillName });
          return;
        }
      }

      roomLogRepository.appendAction({ roomId, playerName, content: message });
      console.log(`💾 [房间 ${roomId}] 收到行动: ${playerName}`);

      io.to(roomId).emit('new_message', {
        role: isRoll ? 'roll' : 'player',
        sender: playerName,
        content: message,
      });

      const lines = roomLogRepository.readRoomLines(roomId);
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
      } catch (error) {
        console.error('❌ AI 接口调用失败:', error.message);
        io.to(roomId).emit('new_message', {
          role: 'dm',
          sender: '系统 DM',
          content: '（星舰通讯受阻...）',
        });
      }
    });

    socket.on('disconnect', () => {
      for (const roomId in liveRooms) {
        if (removePlayerFromRoom({ io, socket, roomId, reason: '断开连接' })) break;
      }
    });
  });
};

module.exports = registerRoomSocket;
