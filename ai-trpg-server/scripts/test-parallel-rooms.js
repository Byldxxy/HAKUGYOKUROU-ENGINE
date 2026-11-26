// An old thousand-turn campaign and a second table share a real isolated HTTP/socket server.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const { spawn } = require('node:child_process');
const { io } = require('../../ai-trpg-web/node_modules/socket.io-client');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trpg-parallel-'));
Object.assign(process.env, { TRPG_DATA_DIR: root, API_KEY: 'fixture', AI_DEBUG_RAW: 'false',
  SESSION_SECRET: 'isolated-parallel-rooms-test-secret', MODEL_NAME: 'fixture', NODE_ENV: 'development' });
const rooms = require('../src/repositories/roomRepository');
const cards = require('../src/repositories/characterRepository');
const logs = require('../src/repositories/roomLogRepository');
const campaign = require('../src/services/campaignService');
const credits = require('../src/services/creditService');

function seed(username, name, length, roll) {
  const { card } = cards.saveForUsername(username, { basicInfo: { name, occupation: '' },
    stats: { str:50, con:50, siz:50, dex:50, app:50, int:50, pow:50, edu:50, luc:50 },
    statMode:'buy', bgInfo:{}, skills:[{id:'spot',name:'侦查',base:25,job:25,interest:0,grow:0}] });
  const room = rooms.create(username);
  Object.assign(room, { started:true, members:[{accountName:username,characterId:card.id}], billing:{owner:username,mode:'site'} });
  rooms.save(room);
  credits.redeem(username, credits.issue(4));
  const state = campaign.createCampaign('harbour');
  campaign.syncPartyStats(state, [{ name, characterId:card.id, accountName:username, hp:10,san:50,mp:10 }]);
  const lines = [];
  for (let i=1; i<=length; i++) {
    state.round = i+1;
    lines.push({type:'player_action', accountName:username, playerName:name, content:'我查看档案。'},
      {type:'dm_reply', playerName:'系统 DM', content:'档案第'+i+'页。' + (roll && i===length ? '<<ROLL:侦查:'+name+'>>' : '')},
      {type:'campaign_state', campaign:{...state}});
  }
  fs.writeFileSync(logs.getRoomLogPath(room.id), lines.map(line=>JSON.stringify(line)).join('\n')+'\n');
  return room.id;
}

const sockets = [];
const timeout = ms => new Promise(resolve=>setTimeout(resolve,ms));
async function poll(check, label) {
  for(let attempt=0; attempt<200; attempt++) { if(await check()) return; await timeout(25); }
  throw new Error('Timed out: '+label);
}
async function test() {
  const large = seed('long_table','长团调查员',1000,false);
  const small = seed('short_table','短团调查员',1,true);
  let unblock, pending = false;
  const provider = http.createServer(async(req,res) => {
    let text = ''; for await(const chunk of req) text+=chunk;
    if (text.includes('等待并发验收')) {
      pending = true;
      await new Promise(resolve=>{ unblock=resolve; });
      pending = false;
    }
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({choices:[{message:{content:'{"narration":"记录已经核对。"}'}}]}));
  });
  let child, diagnostics = '';
  try {
    provider.listen(0,'127.0.0.1'); await once(provider,'listening');
    const probe = http.createServer(); probe.listen(0,'127.0.0.1'); await once(probe,'listening');
    const port = probe.address().port; await new Promise(resolve=>probe.close(resolve));
    const base = 'http://127.0.0.1:'+port;
    child = spawn(process.execPath,['app.js'],{cwd:path.resolve(__dirname,'..'),
      env:{...process.env,BASE_URL:'http://127.0.0.1:'+provider.address().port,PORT:String(port),HOST:'127.0.0.1'}});
    child.stdout.on('data',chunk=>diagnostics+=chunk); child.stderr.on('data',chunk=>diagnostics+=chunk);
    await poll(async()=>{try{return(await fetch(base+'/api/health')).ok;}catch{return false;}},'server startup');
    const send = (socket,event,data)=>socket.timeout(3500).emitWithAck(event,data);
    async function join(username,roomId) {
      const res=await fetch(base+'/api/register',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({username,password:'isolated-password'})});
      assert.equal(res.status,200);
      const cookie=res.headers.get('set-cookie').split(';')[0];
      const socket=io(base,{transports:['websocket'],extraHeaders:{cookie},autoConnect:false,reconnection:false});
      sockets.push(socket);
      socket.on('turn_state',state=>socket.turn=state);
      socket.on('room_snapshot',snapshot=>{socket.snapshot=snapshot;socket.turn=snapshot.turnState;});
      socket.connect(); await once(socket,'connect');
      assert.ok((await send(socket,'join_room',{roomId,historyVersion:1})).success);
      return socket;
    }
    const a=await join('long_table',large);
    const b=await join('short_table',small);
    assert.equal(a.snapshot.messages.length,50);
    assert.ok(a.snapshot.hasEarlier);
    const action={roomId:large,expectedTurnId:a.turn.turnId,clientActionId:'parallel-action-00001',message:'等待并发验收。'};
    assert.ok((await send(a,'player_action',action)).success);
    await poll(()=>pending,'long-room host entered upstream');
    const start=performance.now();
    assert.ok((await send(b,'player_action',{roomId:small,isRoll:true,rollId:b.turn.pendingRolls[0].id})).success);
    const rollAckMs=performance.now()-start;
    await poll(()=>b.turn.mode==='waiting_players','second room settles before first');
    assert.equal(pending,true);
    unblock();
    await poll(()=>a.turn.mode==='waiting_players'&&a.turn.turnId!==action.expectedTurnId,'long room settles');
    assert.ok((await send(a,'player_action',action)).success);
    const report=fs.readFileSync(logs.getRoomLogPath(large),'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(report.filter(entry=>entry.clientActionId===action.clientActionId).length,1);
    assert.equal(credits.balance('long_table'),3);
    assert.equal(credits.balance('short_table'),3);
    console.log('PASS 1,000-round legacy room, 50-message first page, independent concurrent roll and settlement, repeat action ACK; local roll ACK '+rollAckMs.toFixed(1)+' ms.');
  } catch(error) { console.error(diagnostics.slice(-2000)); throw error; }
  finally {
    unblock?.();
    sockets.forEach(socket=>socket.disconnect());
    if(child && child.exitCode===null){ child.kill(); await once(child,'exit'); }
    provider.closeAllConnections(); await new Promise(resolve=>provider.close(resolve));
    fs.rmSync(root,{recursive:true,force:true});
  }
}
test().catch(error=>{console.error(error);process.exitCode=1;});
