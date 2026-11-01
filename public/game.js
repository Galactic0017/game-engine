// Defend ATOM - Bloons-style layered monsters defend the ATOM core.
// Real image sprites (assets/sprites/) over the generated battlefield.
// The path below is the traced centerline of the glowing path in battlefield.jpg.
const cv=document.getElementById('game'),ctx=cv.getContext('2d');
const PATH=[[0,161],[20,169],[40,192],[60,260],[80,274],[100,278],[120,262],[140,224],[160,204],[180,203],[200,205],[220,277],[240,289],[260,290],[280,279],[300,250],[320,225],[340,195],[360,189],[380,185],[400,194],[420,226],[440,249],[460,251],[480,259],[500,259],[520,257],[540,250],[560,248],[580,247],[600,246],[620,246],[640,248],[660,256],[680,259],[700,254],[720,250],[740,246],[760,233],[780,211],[800,196]];
const CORE={x:790,y:196};
let credits=1000,lives=20,wave=0,score=0,pops=0,running=false,paused=false;
let towers=[],enemies=[],shots=[],bursts=[],particles=[],selected=null,selectedHero=null,heroPlaced=false;
let shake=0,banner=null,mouse={x:-999,y:-999};
let stars=Array.from({length:40},()=>({x:Math.random()*800,y:Math.random()*450,s:Math.random()*1.6+.4,tw:Math.random()*6}));
function loadImg(src){const i=new Image();i.src=src;return i;}
const bgImg=loadImg('assets/sprites/battlefield.jpg');
const monsterImgs={1:loadImg('assets/sprites/monster-1.png'),2:loadImg('assets/sprites/monster-2.png'),3:loadImg('assets/sprites/monster-3.png'),4:loadImg('assets/sprites/monster-4.png'),5:loadImg('assets/sprites/monster-5.png')};
const towerImgs={Validator:loadImg('assets/sprites/tower-validator.png'),Cryo:loadImg('assets/sprites/tower-cryo.png'),Nova:loadImg('assets/sprites/tower-nova.png'),Railgun:loadImg('assets/sprites/tower-railgun.png'),Ion:loadImg('assets/sprites/tower-ion.png')};
const heroImgs={astra:loadImg('assets/sprites/hero-astra.png'),lyra:loadImg('assets/sprites/hero-lyra.png'),koda:loadImg('assets/sprites/hero-koda.png'),nova7:loadImg('assets/sprites/hero-nova7.png'),vex:loadImg('assets/sprites/hero-vex.png'),orin:loadImg('assets/sprites/hero-orin.png')};
function imgReady(i){return i&&i.complete&&i.naturalWidth>0;}
function drawImgCentered(img,x,y,w,h,alpha,rot){if(!imgReady(img))return false;ctx.save();ctx.globalAlpha=alpha===undefined?1:alpha;ctx.translate(x,y);if(rot)ctx.rotate(rot);ctx.drawImage(img,-w/2,-h/2,w,h);ctx.restore();return true;}
const TOWERS=[{name:'Validator',cost:100,dmg:1,range:110,rate:35,color:'#ffd166'},{name:'Cryo',cost:120,dmg:1,range:95,rate:30,color:'#7bdff2',slow:true},{name:'Nova',cost:180,dmg:2,range:120,rate:55,color:'#ff8fab'},{name:'Railgun',cost:220,dmg:2,range:170,rate:80,color:'#c792ea'},{name:'Ion',cost:160,dmg:1,range:130,rate:40,color:'#90ee90'}];
const LAYER_COLORS={1:'#7bdff2',2:'#90ee90',3:'#ffd166',4:'#ff6b6b',5:'#c792ea'};
const el=id=>document.getElementById(id);
function pathLen(){let L=0;for(let i=0;i<PATH.length-1;i++)L+=Math.hypot(PATH[i+1][0]-PATH[i][0],PATH[i+1][1]-PATH[i][1]);return L;}
function pointAt(d){let rem=d;for(let i=0;i<PATH.length-1;i++){const a=PATH[i],b=PATH[i+1],len=Math.hypot(b[0]-a[0],b[1]-a[1]);if(rem<=len){const t=rem/len;return [a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];}rem-=len;}return PATH[PATH.length-1];}
function makeMonster(d,layers,speed,split){return {d,layers,maxLayers:layers,speed,split,r:8+layers*4,slow:0};}
function spawnWave(){wave++;el('wave').textContent=wave;banner={text:'WAVE '+wave,life:95};const n=6+wave*2;for(let i=0;i<n;i++){const boss=wave%5===0&&i===0;const layers=boss?5:Math.min(4,1+Math.floor(wave/4)+(i%2));enemies.push(makeMonster(-i*48,layers,boss?0.45:0.85+wave*0.03+(4-layers)*0.08,boss?2:1));}}
async function submitProgress(won){const addr=localStorage.getItem('voidfall_address')||localStorage.getItem('game_address');if(!addr)return;try{const r=await fetch('/api/progress',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({address:addr,score,waveReached:wave,won})});const j=await r.json();if(j.unlocked&&j.unlocked.length)el('gameMsg').textContent+=' Unlocked: '+j.unlocked.join(', ')+'!';}catch{}}
function popMonster(e,idx){pops++;score+=10;const col=LAYER_COLORS[e.layers]||'#fff';bursts.push({x:e.x,y:e.y,r:10+e.layers*3,life:14});for(let k=0;k<8;k++){const a=Math.random()*6.28;particles.push({x:e.x,y:e.y,vx:Math.cos(a)*(1+Math.random()*2.5),vy:Math.sin(a)*(1+Math.random()*2.5),life:18+Math.random()*8,color:col});}e.layers--;if(e.layers<=0){score+=40;credits+=20;bursts.push({x:e.x,y:e.y,r:20,life:18});enemies.splice(idx,1);if(e.split>0&&e.maxLayers>1){for(let k=0;k<2;k++){const c=makeMonster(e.d-6,e.maxLayers-1,e.speed*1.25,0);enemies.push(c);}}}}
function drawPath(){ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();ctx.moveTo(PATH[0][0],PATH[0][1]);PATH.slice(1).forEach(p=>ctx.lineTo(p[0],p[1]));ctx.strokeStyle='rgba(80,230,255,.16)';ctx.lineWidth=30;ctx.stroke();ctx.strokeStyle='rgba(160,245,255,.14)';ctx.lineWidth=16;ctx.stroke();}
function loop(){ctx.save();if(shake>0){ctx.translate((Math.random()-.5)*shake,(Math.random()-.5)*shake);shake*=0.85;if(shake<0.5)shake=0;}
 ctx.clearRect(-20,-20,840,490);
 if(imgReady(bgImg)){ctx.drawImage(bgImg,0,0,800,450);}else{ctx.fillStyle='#050814';ctx.fillRect(0,0,800,450);}
 ctx.fillStyle='rgba(5,8,20,.22)';ctx.fillRect(0,0,800,450);
 const t=Date.now()/1000;stars.forEach(s=>{ctx.globalAlpha=.35+.55*Math.abs(Math.sin(t+s.tw));ctx.fillStyle='#fff';ctx.fillRect(s.x,s.y,s.s,s);});ctx.globalAlpha=1;
 drawPath();
 // ATOM core
 const pulse=1+0.12*Math.sin(t*3);ctx.save();ctx.translate(CORE.x,CORE.y);const g=ctx.createRadialGradient(0,0,4,0,0,42*pulse);g.addColorStop(0,'rgba(255,209,102,.85)');g.addColorStop(.45,'rgba(255,209,102,.28)');g.addColorStop(1,'rgba(255,209,102,0)');ctx.fillStyle=g;ctx.beginPath();ctx.arc(0,0,42*pulse,0,7);ctx.fill();ctx.fillStyle='#ffd166';ctx.beginPath();ctx.arc(0,0,17,0,7);ctx.fill();ctx.strokeStyle='rgba(255,255,255,.85)';ctx.lineWidth=2;ctx.beginPath();ctx.arc(0,0,23*pulse,0,7);ctx.stroke();ctx.fillStyle='#0b1026';ctx.font='bold 16px Arial';ctx.textAlign='center';ctx.fillText('A',0,6);ctx.restore();ctx.fillStyle='#fff';ctx.font='bold 12px Arial';ctx.textAlign='center';ctx.fillText('ATOM CORE',CORE.x-40,CORE.y-34);
 // placement ghost + range ring
 if(selected!==null||selectedHero){const ghost=selectedHero?null:TOWERS[selected];const gx=mouse.x,gy=mouse.y;if(gx>=0&&gy>=0){ctx.globalAlpha=.55;if(selectedHero){const hi=heroImgs[selectedHero.defId];if(imgReady(hi)){ctx.save();ctx.beginPath();ctx.arc(gx,gy,24,0,7);ctx.clip();ctx.drawImage(hi,gx-24,gy-24,48,48);ctx.restore();}}else if(ghost){drawImgCentered(towerImgs[ghost.name],gx,gy,64,64,.55);}ctx.globalAlpha=.25;ctx.strokeStyle='#fff';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(gx,gy,selectedHero?145:ghost.range,0,7);ctx.stroke();ctx.globalAlpha=1;}}
 if(!paused){
  towers.forEach(tw=>{ctx.fillStyle='rgba(0,0,0,.35)';ctx.beginPath();ctx.ellipse(tw.x,tw.y+18,20,7,0,0,7);ctx.fill();
   if(tw.hero){const hi=heroImgs[tw.defId];if(imgReady(hi)){ctx.save();ctx.beginPath();ctx.arc(tw.x,tw.y,22,0,7);ctx.clip();ctx.drawImage(hi,tw.x-22,tw.y-22,44,44);ctx.restore();ctx.strokeStyle='#ffd166';ctx.lineWidth=3;ctx.beginPath();ctx.arc(tw.x,tw.y,22,0,7);ctx.stroke();}else{ctx.fillStyle=tw.color;ctx.beginPath();ctx.arc(tw.x,tw.y,19,0,7);ctx.fill();}}
   else if(!drawImgCentered(towerImgs[tw.name],tw.x,tw.y,64,64,1,tw.flash>0?-0.03:0)){ctx.fillStyle=tw.color;ctx.beginPath();ctx.arc(tw.x,tw.y,16,0,7);ctx.fill();}
   if(tw.flash>0){tw.flash--;ctx.fillStyle='rgba(255,255,220,.9)';ctx.beginPath();ctx.arc(tw.x+Math.cos(tw.aim||0)*22,tw.y+Math.sin(tw.aim||0)*22,5,0,7);ctx.fill();}
   tw.cd=(tw.cd||0)-1;const e=enemies.find(e=>Math.hypot(e.x-tw.x,e.y-tw.y)<tw.range);if(e&&tw.cd<=0){tw.cd=tw.rate;tw.flash=5;tw.aim=Math.atan2(e.y-tw.y,e.x-tw.x);shots.push({x:tw.x,y:tw.y,e,dmg:tw.dmg,slow:tw.slow,color:tw.color});}});
  enemies.forEach(e=>{e.d+=(e.slow>0?e.speed*0.5:e.speed);e.slow=Math.max(0,e.slow-1);const [x,y]=pointAt(Math.max(0,e.d));e.x=x;e.y=y;const boss=e.maxLayers>=5&&e.split>0;const size=(e.r*2.3)*(boss?1.3:1);const bob=Math.sin(t*4+e.d*0.08)*2;const wob=Math.sin(t*2.5+e.d*0.05)*0.07;
   ctx.fillStyle='rgba(0,0,0,.35)';ctx.beginPath();ctx.ellipse(x,y+size*0.42,size*0.42,8,0,0,7);ctx.fill();
   if(!drawImgCentered(monsterImgs[e.layers],x,y+bob,size,size,1,wob)){const col=LAYER_COLORS[e.layers]||'#fff';ctx.fillStyle=col;ctx.beginPath();ctx.arc(x,y,e.r,0,7);ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();}
   if(e.slow>0){ctx.strokeStyle='rgba(123,223,242,.85)';ctx.lineWidth=2;ctx.beginPath();ctx.arc(x,y+bob,size*0.55,0,7);ctx.stroke();}
   ctx.fillStyle='rgba(5,8,20,.85)';const lw=26;ctx.fillRect(x-lw/2,y+bob+size/2+4,lw,15);ctx.fillStyle='#fff';ctx.font='bold 10px Arial';ctx.textAlign='center';ctx.fillText('L'+e.layers,x,y+bob+size/2+15);});
  shots=shots.filter(s=>{const idx=enemies.indexOf(s.e);if(idx<0)return false;const dx=s.e.x-s.x,dy=s.e.y-s.y,d=Math.hypot(dx,dy);if(d<12){if(s.slow)s.e.slow=40;for(let k=0;k<s.dmg;k++){if(enemies.includes(s.e))popMonster(s.e,enemies.indexOf(s.e));}return false;}s.x+=dx/d*7;s.y+=dy/d*7;ctx.save();ctx.shadowColor=s.color||'#ffe66d';ctx.shadowBlur=12;ctx.fillStyle=s.color||'#ffe66d';ctx.beginPath();ctx.arc(s.x,s.y,4,0,7);ctx.fill();ctx.restore();return true;});
  bursts=bursts.filter(b=>{b.life--;b.r+=1;ctx.strokeStyle='rgba(255,209,102,'+(b.life/18)+')';ctx.lineWidth=2;ctx.beginPath();ctx.arc(b.x,b.y,b.r,0,7);ctx.stroke();return b.life>0;});
  particles=particles.filter(p=>{p.life--;p.x+=p.vx;p.y+=p.vy;p.vy+=0.08;ctx.globalAlpha=Math.max(0,p.life/24);ctx.fillStyle=p.color;ctx.fillRect(p.x-2,p.y-2,4,4);ctx.globalAlpha=1;return p.life>0;});
  const leaked=enemies.filter(e=>e.d>=pathLen());if(leaked.length){lives-=leaked.reduce((s,e)=>s+e.layers,0);shake=10;}
  enemies=enemies.filter(e=>e.d<pathLen());
  el('credits').textContent=credits;el('lives').textContent=lives;el('score').textContent=score;const pp=el('pops');if(pp)pp.textContent=pops;
  if(enemies.length===0&&running){if(wave>=20){el('gameMsg').textContent='You win! The ATOM core held for all 20 waves. Pops: '+pops;running=false;submitProgress(true);}else{el('gameMsg').textContent='Wave cleared. Pops: '+pops+'. Start the next wave.';running=false;submitProgress(false);}}
  if(lives<=0){el('gameMsg').textContent='The ATOM core fell. Game over.';running=false;submitProgress(false);}
 }
 if(banner&&banner.life>0){banner.life--;const a=Math.min(1,banner.life/30);ctx.globalAlpha=a;ctx.fillStyle='#fff';ctx.font='bold 34px Arial';ctx.textAlign='center';ctx.shadowColor='#7bdff2';ctx.shadowBlur=18;ctx.fillText(banner.text,400,70);ctx.shadowBlur=0;ctx.globalAlpha=1;}
 ctx.restore();
 requestAnimationFrame(loop);}
requestAnimationFrame(loop);
el('startWave').onclick=()=>{if(!running&&lives>0){running=true;spawnWave();}};
el('pauseBtn').onclick=()=>{paused=!paused;};
cv.addEventListener('mousemove',ev=>{const r=cv.getBoundingClientRect();mouse.x=(ev.clientX-r.left)*800/r.width;mouse.y=(ev.clientY-r.top)*450/r.height;});
const tw=document.getElementById('towers');TOWERS.forEach((t,i)=>{const b=document.createElement('button');b.className='towerBtn';b.innerHTML='<img src="assets/sprites/tower-'+t.name.toLowerCase()+'.png" alt="'+t.name+'"><span>'+t.name+' $'+t.cost+'</span>';b.onclick=()=>{selected=i;selectedHero=null;};tw.appendChild(b);});
const hb=document.createElement('button');hb.className='towerBtn';hb.innerHTML='<span>Place Hero</span>';hb.onclick=()=>{if(!window._equippedHero){alert('Equip a hero in My Heroes first.');return;}selectedHero=window._equippedHero;selected=null;};tw.appendChild(hb);
cv.addEventListener('click',ev=>{const r=cv.getBoundingClientRect(),x=(ev.clientX-r.left)*800/r.width,y=(ev.clientY-r.top)*450/r.height;
 if(selectedHero){if(heroPlaced){alert('Hero already placed this game.');return;}towers.push({x,y,name:selectedHero.name,dmg:2,range:145,rate:42,color:selectedHero.color,hero:true,defId:selectedHero.defId});heroPlaced=true;selectedHero=null;return;}
 if(selected===null)return;const t=TOWERS[selected];if(credits<t.cost){alert('Not enough credits');return;}credits-=t.cost;towers.push({x,y,...t});selected=null;});
