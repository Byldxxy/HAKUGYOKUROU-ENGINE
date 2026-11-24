// Isolated regression: no production accounts, logs, or model charges.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { io } = require('../../ai-trpg-web/node_modules/socket.io-client');
const { once } = require('node:events');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trpg-test-'));
const sockets = [];
let child, output = '', aiCalls = 0, failNext = false, port;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const empty = { narration: '主持继续叙述。', requestedRolls: [], statChanges: [], revealedClueIds: [], proposedStateChanges: {}, proposedTransition: null, pacing: 'hold' };
const mock = http.createServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk;
  assert.ok(JSON.parse(body).messages.some(m => m.role === 'system' && m.content.includes('权威导演上下文')));
  if (failNext) { failNext = false; res.writeHead(400); res.end('{"error":{"message":"fixture failure"}}'); return; }
  aiCalls++;
  const content = aiCalls === 1 ? { ...empty, requestedRolls: [{ player: '调查员甲', skill: '侦查' }, { player: '调查员乙', skill: '射击:手枪' }], statChanges: [{ player: '调查员甲', type: 'HP', value: -5 }] }
    : { ...empty, statChanges: [{ player: '调查员甲', type: 'HP', value: -2 }] };
  res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }));
});
const start = async () => {
  child = spawn(process.execPath, ['app.js'], { cwd: path.resolve(__dirname, '..'), env: { ...process.env,
    NODE_ENV: 'development', TRPG_DATA_DIR: dataDir, PORT: String(port), HOST: '127.0.0.1', API_KEY: 'test-only',
    BASE_URL: `http://127.0.0.1:${mock.address().port}/v1`, MODEL_NAME: 'fixture', AI_DEBUG_RAW: 'false', RECONNECT_GRACE_MS: '250' } });
  child.stdout.on('data', chunk => output += chunk); child.stderr.on('data', chunk => output += chunk);
  for (let i=0;i<100;i++) { try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return; } catch {} await delay(30); }
  throw new Error('Server did not start: '+output);
};
const stop = async () => { if (child && child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); } };
const api = async (route, cookie, data, method) => {
  const response = await fetch(`http://127.0.0.1:${port}/api${route}`, { method: method || (data ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: data ? JSON.stringify(data) : undefined });
  return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
};
const connect = async cookie => {
  const socket = io(`http://127.0.0.1:${port}`, { extraHeaders: { cookie }, transports: ['websocket'], reconnection: false });
  sockets.push(socket);
  await Promise.race([once(socket, 'connect'), delay(3000).then(() => { throw new Error('socket timeout'); })]);
  socket.on('turn_state', data => socket.turn = data); socket.on('lobby_update', data => socket.lobby = data); return socket;
};
const send = (socket, event, payload) => new Promise((resolve, reject) => socket.timeout(4000).emit(event, payload, (error, ack) => error ? reject(error) : resolve(ack)));
const wait = async (predicate, label) => { for(let i=0;i<150;i++) { if(predicate()) return; await delay(20); } throw new Error('Timed out: '+label); };
const draft = name => ({ basicInfo: { name, occupation: '' }, stats: { str:50,con:50,siz:50,dex:50,app:50,int:50,pow:50,edu:50,luc:50 },
  statMode:'buy', bgInfo:{}, skills:[{id:'spot',name:'侦查',base:25,job:25,interest:0,grow:0},{id:'gun',name:'射击:手枪',base:20,job:0,interest:10,grow:0}] });
(async () => {
  mock.listen(0,'127.0.0.1'); await once(mock,'listening');
  const probe=http.createServer(); probe.listen(0,'127.0.0.1'); await once(probe,'listening'); port=probe.address().port; await new Promise(resolve=>probe.close(resolve));
  await start();
  assert.equal((await api('/characters')).status,401);
  assert.equal((await api('/register',null,{username:'__proto__',password:'test-password-123'})).status,400);
  const a=await api('/register',null,{username:'tester_a',password:'test-password-123'});
  const b=await api('/register',null,{username:'tester_b',password:'test-password-123'});
  const x=await api('/register',null,{username:'outsider',password:'test-password-123'});
  assert.equal(a.status,200);
  assert.equal((await api('/login',null,{username:'tester_a',password:{bad:true}})).status,400);
  assert.equal((await api('/login',null,{username:'tester_a',password:'incorrect'})).status,401);
  assert.equal((await api('/login',null,{username:'tester_a',password:'test-password-123'})).status,200);
  assert.equal((await api('/me',a.cookie)).data.username,'tester_a');
  const ca=(await api('/characters',a.cookie,{cardData:draft('调查员甲')})).data.card;
  const cb=(await api('/characters',b.cookie,{cardData:draft('调查员乙')})).data.card;
  assert.ok(ca?.id); assert.ok(cb?.id);
  assert.equal((await api('/characters',b.cookie,{cardData:{...draft('冒名'),id:ca.id}})).status,404);
  assert.equal((await api(`/characters/${ca.id}`,b.cookie,null,'DELETE')).status,404);
  assert.equal((await api('/characters',a.cookie,{cardData:{...draft('无效'),stats:{str:-1}}})).status,400);
  const sa=await connect(a.cookie), sb=await connect(b.cookie), sx=await connect(x.cookie);
  const roomId=(await send(sa,'create_room',{})).roomId;
  assert.match(roomId,/^\d{6}$/);
  assert.equal((await send(sx,'join_lobby',{roomId:'000000'})).reason,'room_not_found');
  assert.equal((await send(sa,'join_lobby',{roomId,characterInfo:{id:ca.id}})).success,true);
  assert.equal((await send(sb,'join_lobby',{roomId,characterInfo:{id:ca.id}})).reason,'invalid_character');
  assert.equal((await send(sb,'join_lobby',{roomId,characterInfo:{}})).success,true);
  assert.equal((await send(sa,'host_start_game',{roomId})).reason,'missing_character');
  assert.equal((await send(sb,'join_lobby',{roomId,characterInfo:{id:cb.id}})).success,true);
  const twin=(await api('/characters',x.cookie,{cardData:draft('调查员甲')})).data.card;
  assert.equal((await send(sx,'join_lobby',{roomId,characterInfo:{id:twin.id}})).reason,'duplicate_name');
  assert.equal((await send(sx,'join_room',roomId)).reason,'forbidden');
  for(const route of ['/room_history?roomId='+roomId,'/notebooks?roomId='+roomId]) assert.equal((await api(route,x.cookie)).status,403);
  assert.equal((await api('/saves',x.cookie,{roomId})).status,403);
  assert.equal((await send(sb,'update_room_config',{roomId,scriptId:'ontology',rules:{}})).reason,'forbidden');
  assert.equal((await send(sa,'update_room_config',{roomId,scriptId:'ontology',rules:{pointBuyLimit:480,occupationSkillLimit:80,interestSkillLimit:70}})).success,true);
  assert.equal((await send(sa,'host_start_game',{roomId})).success,true);
  assert.equal((await send(sa,'host_start_game',{roomId})).reason,'game_started');
  await send(sa,'join_room',roomId); await send(sb,'join_room',roomId);
  assert.equal((await send(sa,'player_action',{roomId,message:'D100 = 1'})).reason,'invalid_action');
  assert.equal((await send(sa,'player_action',{roomId,message:'我查看周围。'})).success,true);
  assert.equal((await send(sa,'player_action',{roomId,message:'再次行动。'})).reason,'turn_locked');
  assert.equal((await send(sb,'player_action',{roomId,message:'我警戒。'})).success,true);
  await wait(()=>sa.turn?.mode==='waiting_rolls','two roll requests');
  assert.equal(sa.turn.pendingRolls.length,2);
  assert.equal(sa.lobby.players.find(p=>p.characterId===ca.id).hp,10,'pending rolls must not apply damage');
  const ra=sa.turn.pendingRolls.find(r=>r.player==='调查员甲').id, rb=sa.turn.pendingRolls.find(r=>r.player==='调查员乙').id;
  assert.equal((await send(sa,'player_action',{roomId,message:'偷偷行动'})).reason,'turn_locked');
  assert.equal((await send(sa,'player_action',{roomId,isRoll:true,rollId:rb})).reason,'invalid_roll');
  assert.equal((await send(sa,'player_action',{roomId,isRoll:true,rollId:ra,message:'D100 = 1 / 999'})).success,true);
  assert.equal((await send(sa,'player_action',{roomId,isRoll:true,rollId:ra})).reason,'invalid_roll');
  assert.equal((await send(sb,'player_action',{roomId,isRoll:true,rollId:rb})).success,true);
  await wait(()=>sa.turn?.mode==='waiting_players' && sa.lobby.players.find(p=>p.characterId===ca.id).hp===8,'settlement');
  const history=(await api('/room_history?roomId='+roomId,a.cookie)).data;
  assert.equal(history.messages.filter(m=>m.role==='roll').length,2);
  assert.ok(history.messages.filter(m=>m.role==='roll').every(m=>!m.content.includes('999')));
  assert.equal((await api('/notebooks',a.cookie,{roomId,notebook:{freeNotes:'线索记录',clues:['线索一'],graphNodes:[],graphEdges:[]}},'PUT')).status,200);
  assert.equal((await api('/notebooks?roomId='+roomId,a.cookie)).data.notebook.freeNotes,'线索记录');
  assert.equal((await api('/notebooks?roomId='+roomId,b.cookie)).data.notebook.freeNotes,'');
  failNext=true;
  await send(sa,'player_action',{roomId,message:'失败后重试测试'}); await send(sb,'player_action',{roomId,message:'继续观察'});
  await wait(()=>sa.turn?.canRetry,'AI error');
  assert.equal((await send(sa,'retry_dm',{roomId})).success,true);
  await wait(()=>sa.turn?.mode==='waiting_players'&&!sa.turn.canRetry,'AI retry');
  assert.equal((await api('/saves',a.cookie,{roomId,saveName:'回归存档'})).status,200);
  const save=(await api('/saves',a.cookie)).data.saves[0];
  sa.disconnect(); await delay(350);
  assert.equal(sb.lobby.ownerId,sb.id,'owner handover');
  const sa2=await connect(a.cookie); assert.equal((await send(sa2,'join_room',roomId)).success,true);
  assert.equal(sa2.lobby.players.find(p=>p.characterId===ca.id).hp,6,'rejoin preserves HP');
  const second=(await send(sa2,'create_room',{})).roomId;
  await send(sa2,'leave_room',{roomId}); await send(sb,'leave_room',{roomId});
  await send(sa2,'join_lobby',{roomId:second,characterInfo:{id:ca.id}});
  assert.equal((await send(sa2,'host_start_game',{roomId:second,loadSaveId:save.id})).reason,'save_party_mismatch');
  await send(sb,'join_lobby',{roomId:second,characterInfo:{id:cb.id}});
  assert.equal((await send(sa2,'host_start_game',{roomId:second,loadSaveId:save.id})).success,true);
  await wait(()=>sa2.lobby.players.find(p=>p.characterId===ca.id).hp===6,'save HP');
  for(const socket of sockets) socket.disconnect(); await stop(); await start();
  const restored=await connect(a.cookie);
  assert.equal((await send(restored,'join_room',second)).success,true);
  assert.equal(restored.lobby.players.find(p=>p.characterId===ca.id).hp,6,'restart HP');
  assert.equal((await api('/room_history?roomId='+second,x.cookie)).status,403);
  assert.equal((await send(restored,'player_action',null)).success,false);
  assert.equal((await api('/health')).status,200);
  assert.equal((await api('/logout',a.cookie,{},'POST')).status,200);
  assert.equal((await api('/me',a.cookie)).status,401,'logged out cookie must be revoked');
  console.log('PASS: auth, ownership, room ACL, duplicate names, config, start, multiplayer turns, server dice, retry, notes, saves, reconnect, restart, malformed packets.');
})().catch(error=>{ console.error(error); console.error(output); process.exitCode=1; }).finally(async()=>{
  sockets.forEach(socket=>socket.disconnect()); await stop(); await new Promise(resolve=>mock.close(resolve)); fs.rmSync(dataDir,{recursive:true,force:true});
});
