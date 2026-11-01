// Defend ATOM - Bloons-style layered monsters defend the ATOM core.
const cv=document.getElementById('game'),ctx=cv.getContext('2d');
const PATH=[[0,225],[180,225],[180,90],[420,90],[420,320],[620,320],[620,180],[760,180]];
const CORE={x:790,y:180};
let credits=1000,lives=20,wave=0,score=0,pops=0,running=false,paused=false;
let towers=[],enemies=[],shots=[],bursts=[],selected=null,selectedHero=null,heroPlaced=false;
let stars=Array.from({length:70},()=>({x:Math.random()*800,y:Math.random()*450,s:Math.random()*1.6+.4,tw:Math.random()*6}));
const TOWERS=[{name:'Validator',cost:100,dmg:1,range:110,rate:35,color:'#ffd166'},{name:'Cryo',cost:120,dmg:1,range:95,rate:30,color:'#7bdff2',slow:true},{name:'Nova',cost:180,dmg:2,range:120,rate:55,color:'#ff8fab'},{name:'Railgun',cost:220,dmg:2,range:170,rate:80,color:'#c792ea'},{name:'Ion',cost:160,dmg:1,range:130,rate:40,color:'#90ee90'}];
const LAYER_COLORS={1:'#7bdff2',2:'#90ee90',3:'#ffd166',4:'#ff6b6b',5:'#c792ea'};
const el=id=>document.getElementById(id);
function pathLen(){let L=0;for(let i=0;i<PATH.length-1;i++)L+=Math.hypot(PATH[i+1][0]-PATH[i][0],PATH[i+1][1]-PATH[i][1]);return L;}
function pointAt(d){let rem=d;for(let i=0;i<PATH.length-1;i++){const a=PATH[i],b=PATH[i+1],len=Math.hypot(b[0]-a[0],b[1]-a[1]);if(rem<=len){const t=rem/len;return [a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];}rem-=len;}return PATH[PATH.length-1];}
function makeMonster(d,layers,speed,split){return {d,layers,maxLayers:layers,speed,split,r:8+layers*4,slow:0};}
function spawnWave(){wave++;el('wave').textContent=wave;const n=6+wave*2;for(let i=0;i<n;i++){const boss=wave%5===0&&i===0;const layers=boss?5:Math.min(4,1+Math.floor(wave/4)+(i%2));enemies.push(makeMonster(-i*48,layers,boss?0.45:0.85+wave*0.03+(4-layers)*0.08,boss?2:1));}}
async function submitProgress(won){const addr=localStorage.getItem('voidfall_address')||localStorage.getItem('game_address');if(!addr)return;try{const r=await fetch('/api/progress',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({address:addr,score,waveReached:wave,won})});const j=await r.json();if(j.unlocked&&j.unlocked.length)el('gameMsg').textContent+=' Unlocked: '+j.unlocked.join(', ')+'!';}catch{}}
function popMonster(e,idx){pops++;score+=10;bursts.push({x:e.x,y:e.y,r:10+e.layers*3,life:14});e.layers--;if(e.layers<=0){score+=40;credits+=20;bursts.push({x:e.x,y:e.y,r:20,life:18});enemies.splice(idx,1);if(e.split>0&&e.maxLayers>1){for(let k=0;k<2;k++){const c=makeMonster(e.d-6,e.maxLayers-1,e.speed*1.25,0);enemies.push(c);}}}}
function loop(){ctx.clearRect(0,0,800,450);ctx.fillStyle='#050814';ctx.fillRect(0,0,800,450);const t=Date.now()/1000;stars.forEach(s=>{ctx.globalAlpha=.4+.6*Math.abs(Math.sin(t+s.tw));ctx.fillStyle='#fff';ctx.fillRect(s.x,s.y,s.s,s);});ctx.globalAlpha=1;
 ctx.strokeStyle='#2a356e';ctx.lineWidth=34;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(PATH[0][0],PATH[0][1]);PATH.slice(1).forEach(p=>ctx.lineTo(p[0],p[1]));ctx.stroke();
 // ATOM core
 const pulse=1+0.12*Math.sin(t*3);ctx.save();ctx.translate(CORE.x,CORE.y);ctx.fillStyle='rgba(255,209,102,.25)';ctx.beginPath();ctx.arc(0,0,30*pulse,0,7);ctx.fill();ctx.fillStyle='#ffd166';ctx.beginPath();ctx.arc(0,0,18,0,7);ctx.fill();ctx.fillStyle='#0b1026';ctx.font='bold 16px Arial';ctx.textAlign='center';ctx.fillText('A',0,6);ctx.restore();ctx.fillStyle='#fff';ctx.font='bold 12px Arial';ctx.textAlign='center';ctx.fillText('ATOM CORE',CORE.x-38,CORE.y-32);
 if(!paused){
  towers.forEach(tw=>{ctx.fillStyle=tw.color;ctx.beginPath();ctx.arc(tw.x,tw.y,tw.hero?19:16,0,7);ctx.fill();if(tw.hero){ctx.fillStyle='#0b1026';ctx.fillRect(tw.x-9,tw.y-5,18,7);}ctx.fillStyle='#000';ctx.font='bold 11px Arial';ctx.textAlign='center';ctx.fillText(tw.name[0],tw.x,tw.y+4);tw.cd=(tw.cd||0)-1;const e=enemies.find(e=>Math.hypot(e.x-tw.x,e.y-tw.y)<tw.range);if(e&&tw.cd<=0){tw.cd=tw.rate;shots.push({x:tw.x,y:tw.y,e,dmg:tw.dmg,slow:tw.slow});}});
  enemies.forEach(e=>{e.d+=(e.slow>0?e.speed*0.5:e.speed);e.slow=Math.max(0,e.slow-1);const [x,y]=pointAt(Math.max(0,e.d));e.x=x;e.y=y;const col=LAYER_COLORS[e.layers]||'#fff';ctx.fillStyle=col;ctx.beginPath();ctx.arc(x,y,e.r,0,7);ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();ctx.fillStyle='#0b1026';ctx.beginPath();ctx.arc(x-4,y-2,2,0,7);ctx.arc(x+4,y-2,2,0,7);ctx.fill();ctx.fillStyle='#fff';ctx.font='bold 10px Arial';ctx.textAlign='center';ctx.fillText('L'+e.layers,x,y+e.r+11);});
  shots=shots.filter(s=>{const idx=enemies.indexOf(s.e);if(idx<0)return false;const dx=s.e.x-s.x,dy=s.e.y-s.y,d=Math.hypot(dx,dy);if(d<10){if(s.slow)s.e.slow=40;for(let k=0;k<s.dmg;k++){if(enemies.includes(s.e))popMonster(s.e,enemies.indexOf(s.e));}return false;}s.x+=dx/d*7;s.y+=dy/d*7;ctx.fillStyle='#ffe66d';ctx.beginPath();ctx.arc(s.x,s.y,3,0,7);ctx.fill();return true;});
  bursts=bursts.filter(b=>{b.life--;b.r+=1;ctx.strokeStyle='rgba(255,209,102,'+(b.life/18)+')';ctx.beginPath();ctx.arc(b.x,b.y,b.r,0,7);ctx.stroke();return b.life>0;});
  enemies=enemies.filter(e=>{if(e.d>=pathLen()){lives-=e.layers;return false;}return true;});
  el('credits').textContent=credits;el('lives').textContent=lives;el('score').textContent=score;const pp=el('pops');if(pp)pp.textContent=pops;
  if(enemies.length===0&&running){if(wave>=20){el('gameMsg').textContent='You win! The ATOM core held for all 20 waves. Pops: '+pops;running=false;submitProgress(true);}else{el('gameMsg').textContent='Wave cleared. Pops: '+pops+'. Start the next wave.';running=false;submitProgress(false);}}
  if(lives<=0){el('gameMsg').textContent='The ATOM core fell. Game over.';running=false;submitProgress(false);}
 }
 requestAnimationFrame(loop);}
requestAnimationFrame(loop);
el('startWave').onclick=()=>{if(!running&&lives>0){running=true;spawnWave();}};
el('pauseBtn').onclick=()=>{paused=!paused;};
const tw=document.getElementById('towers');TOWERS.forEach((t,i)=>{const b=document.createElement('button');b.textContent=t.name+' $'+t.cost;b.onclick=()=>{selected=i;selectedHero=null;};tw.appendChild(b);});
const hb=document.createElement('button');hb.textContent='Place Hero';hb.onclick=()=>{if(!window._equippedHero){alert('Equip a hero in My Heroes first.');return;}selectedHero=window._equippedHero;selected=null;};tw.appendChild(hb);
cv.addEventListener('click',ev=>{const r=cv.getBoundingClientRect(),x=(ev.clientX-r.left)*800/r.width,y=(ev.clientY-r.top)*450/r.height;
 if(selectedHero){if(heroPlaced){alert('Hero already placed this game.');return;}towers.push({x,y,name:selectedHero.name,dmg:2,range:145,rate:42,color:selectedHero.color,hero:true});heroPlaced=true;selectedHero=null;return;}
 if(selected===null)return;const t=TOWERS[selected];if(credits<t.cost){alert('Not enough credits');return;}credits-=t.cost;towers.push({x,y,...t});selected=null;});
