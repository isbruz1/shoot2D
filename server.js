const express=require('express');
const http=require('http');
const {WebSocketServer,WebSocket}=require('ws');
const crypto=require('crypto');
const fs=require('fs');
const path=require('path');
const app=express();const server=http.createServer(app);const wss=new WebSocketServer({server});
app.use(express.static(__dirname));app.get('/health',(_,r)=>r.json({ok:true}));
const DB=path.join(__dirname,'players.json');
let db={};
try { db=JSON.parse(fs.readFileSync(DB,'utf8')); } catch { db={}; }
function save(){
  try { const temp=DB+'.tmp';fs.writeFileSync(temp,JSON.stringify(db,null,2));fs.renameSync(temp,DB); }
  catch(e){console.error('Sauvegarde JSON impossible:',e.message);}
}
function markDirty(){save()}
const hash=t=>crypto.createHash('sha256').update(t).digest('hex');
async function accountLogin(name,avatar,token){
  const existing=db[name];
  if(existing){
    if(!token||hash(token)!==existing.token_hash)throw Error('Pseudo déjà utilisé : utilise ton navigateur habituel ou choisis un autre pseudo');
    return {record:existing,token};
  }
  const newToken=crypto.randomBytes(32).toString('hex');
  const record={name,avatar,best:0,token_hash:hash(newToken)};
  db[name]=record;save();return {record,token:newToken};
}
const rooms=new Map();const clients=new Map();
const avatars=['🧑‍🚀','🥷','🧑‍🎤','🧑‍🚒','🦸','🧑‍🔬'];
function send(ws,data){if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify(data))}
function broadcast(room,data){for(const p of room.players.values())send(p.ws,data)}
function leaderboard(){return Object.values(db).sort((a,b)=>b.best-a.best).slice(0,20).map(({name,best,avatar})=>({name,best,avatar}))}
function listRooms(){return [...rooms.values()].map(r=>({id:r.id,name:r.name,players:r.players.size,capacity:r.capacity,level:r.level}))}
function roomState(r){return {type:'state',room:r.id,level:r.level,elapsed:Math.floor(r.elapsed),players:[...r.players.values()].map(p=>({id:p.id,name:p.name,avatar:p.avatar,x:p.x,y:p.y,hp:p.hp,score:p.score,dashReady:p.dashReady,power:p.power,alive:p.hp>0})),enemies:r.enemies.map(e=>({id:e.id,x:e.x,y:e.y,hp:e.hp})),bullets:r.bullets.map(b=>({x:b.x,y:b.y,enemy:b.enemy})),powerups:r.powerups}}
function newRoom(name){const id=crypto.randomBytes(3).toString('hex').toUpperCase();const r={id,name:name.slice(0,30),capacity:6,players:new Map(),enemies:[],bullets:[],powerups:[],level:1,elapsed:0,spawn:0,powerSpawn:0,seq:0,last:Date.now()};rooms.set(id,r);return r}
function leave(ws){const c=clients.get(ws);if(!c?.room)return;const r=rooms.get(c.room);if(r){r.players.delete(c.id);broadcast(r,{type:'notice',message:c.name+' a quitté le salon'});if(!r.players.size)rooms.delete(r.id)}c.room=null;send(ws,{type:'rooms',rooms:listRooms()})}
function join(ws,r){const c=clients.get(ws);if(!r||r.players.size>=r.capacity)return send(ws,{type:'error',message:'Salon introuvable ou complet'});leave(ws);c.room=r.id;r.players.set(c.id,{...c,ws,x:150+Math.random()*400,y:100+Math.random()*300,hp:100,score:0,dx:0,dy:0,lastDash:0,dashReady:true,power:'',powerUntil:0,shot:0,invuln:0});send(ws,{type:'joined',room:r.id,name:r.name,id:c.id});broadcast(r,{type:'notice',message:c.name+' a rejoint le salon'});broadcast(r,roomState(r))}
function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function tick(){const now=Date.now();for(const r of rooms.values()){let dt=Math.min((now-r.last)/1000,.08);r.last=now;if(!r.players.size)continue;r.elapsed+=dt;r.level=1+Math.floor(r.elapsed/25);r.spawn+=dt;r.powerSpawn+=dt;
if(r.spawn>Math.max(.24,1.4-r.level*.065)&&r.enemies.length<65){r.spawn=0;const side=Math.floor(Math.random()*4);r.enemies.push({id:++r.seq,x:side===0?0:side===1?900:Math.random()*900,y:side===2?0:side===3?540:Math.random()*540,hp:1+Math.floor(r.level/7)})}
if(r.powerSpawn>12){r.powerSpawn=0;if(r.powerups.length<4)r.powerups.push({id:++r.seq,x:30+Math.random()*840,y:30+Math.random()*480,type:Math.random()<.5?'heal':'rapid'})}
for(const p of r.players.values()){if(p.hp<=0)continue;let norm=Math.hypot(p.dx,p.dy)||1;let speed=p.power==='speed'&&p.powerUntil>now?270:205;p.x=clamp(p.x+p.dx/norm*speed*dt,14,886);p.y=clamp(p.y+p.dy/norm*speed*dt,14,526);p.dashReady=now-p.lastDash>=3000;if(p.powerUntil<now)p.power='';let target=null,best=Infinity;for(const e of r.enemies){const d=(e.x-p.x)**2+(e.y-p.y)**2;if(d<best){best=d;target=e}}if(target&&now-p.shot>(p.power==='rapid'?130:380)){p.shot=now;const angle=Math.atan2(target.y-p.y,target.x-p.x);r.bullets.push({x:p.x,y:p.y,vx:Math.cos(angle)*500,vy:Math.sin(angle)*500,enemy:false,owner:p.id,life:1.6})}
for(let i=r.powerups.length-1;i>=0;i--){const u=r.powerups[i];if(Math.hypot(u.x-p.x,u.y-p.y)<26){if(u.type==='heal')p.hp=Math.min(100,p.hp+40);else{p.power='rapid';p.powerUntil=now+7000}r.powerups.splice(i,1)}}}
for(const e of r.enemies){let target=null,best=Infinity;for(const p of r.players.values()){if(p.hp<=0)continue;const d=(p.x-e.x)**2+(p.y-e.y)**2;if(d<best){best=d;target=p}}if(!target)continue;const d=Math.sqrt(best)||1;e.x+=(target.x-e.x)/d*(55+r.level*3)*dt;e.y+=(target.y-e.y)/d*(55+r.level*3)*dt;if(d<23&&now>target.invuln){target.hp=Math.max(0,target.hp-16);target.invuln=now+800;if(target.hp===0){const rec=db[target.name];if(rec){rec.best=Math.max(rec.best,target.score);markDirty(target.name)}}}}
for(let i=r.bullets.length-1;i>=0;i--){const b=r.bullets[i];b.x+=b.vx*dt;b.y+=b.vy*dt;b.life-=dt;if(b.life<=0||b.x<0||b.x>900||b.y<0||b.y>540){r.bullets.splice(i,1);continue}let hit=false;for(let j=r.enemies.length-1;j>=0;j--){const e=r.enemies[j];if(Math.hypot(b.x-e.x,b.y-e.y)<19){e.hp--;hit=true;if(e.hp<=0){r.enemies.splice(j,1);const p=r.players.get(b.owner);if(p){p.score+=10;const rec=db[p.name];if(rec&&p.score>rec.best){rec.best=p.score;markDirty(p.name)}}}break}}if(hit)r.bullets.splice(i,1)}
if(r.bullets.length>350)r.bullets.splice(0,r.bullets.length-350);
if(r.enemies.length>65)r.enemies.splice(0,r.enemies.length-65);
broadcast(r,roomState(r))}}
setInterval(tick,50);
wss.on('connection',ws=>{send(ws,{type:'hello',rooms:listRooms(),leaderboard:leaderboard()});ws.on('message',async raw=>{if(raw.length>2048)return;let m;try{m=JSON.parse(raw)}catch{return}const c=clients.get(ws);if(m.type==='login'){const name=String(m.name||'').trim().slice(0,18);if(!/^[\p{L}\p{N}_ -]{2,18}$/u.test(name))return send(ws,{type:'error',message:'Pseudo : 2 à 18 caractères (lettres, chiffres, espaces, _ ou -)'});if(c)return;const avatar=avatars.includes(m.avatar)?m.avatar:avatars[0];try{const result=await accountLogin(name,avatar,String(m.token||''));const id=crypto.randomUUID();clients.set(ws,{id,name,avatar:result.record.avatar,room:null});send(ws,{type:'logged',id,name,avatar:result.record.avatar,best:result.record.best,token:result.token});}catch(e){send(ws,{type:'error',message:e.message})}return}

if(!c)return send(ws,{type:'error',message:'Connecte-toi'});
if(m.type==='rooms')send(ws,{type:'rooms',rooms:listRooms()});
if(m.type==='leaderboard')send(ws,{type:'leaderboard',players:leaderboard()});
if(m.type==='create'){const r=newRoom(String(m.name||'Salon de '+c.name));join(ws,r)}
if(m.type==='join')join(ws,rooms.get(String(m.id||'')));
if(m.type==='leave')leave(ws);
if(m.type==='input'){const r=rooms.get(c.room),p=r?.players.get(c.id);if(!p)return;p.dx=clamp(Number(m.dx)||0,-1,1);p.dy=clamp(Number(m.dy)||0,-1,1);if(m.dash&&Date.now()-p.lastDash>=3000&&p.hp>0){p.lastDash=Date.now();const d=Math.hypot(p.dx,p.dy)||1;p.x=clamp(p.x+p.dx/d*115,14,886);p.y=clamp(p.y+p.dy/d*115,14,526);p.invuln=Date.now()+250}}
if(m.type==='respawn'){const r=rooms.get(c.room),p=r?.players.get(c.id);if(p&&p.hp<=0){p.hp=100;p.x=450;p.y=270;p.score=0;p.invuln=Date.now()+2000}}
});ws.on('close',()=>{leave(ws);clients.delete(ws)})});
process.on('SIGTERM',()=>{save();server.close()});
server.listen(process.env.PORT||3000,'0.0.0.0',()=>console.log('AI Arena listening'));
