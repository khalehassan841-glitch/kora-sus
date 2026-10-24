import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

const socket = io();
const $ = id => document.getElementById(id);
const CHARACTERS = {
 Salah:{emoji:"🔴",color:0xd83b48,kit:"Liverpool"}, Ronaldo:{emoji:"⚪",color:0xe9edf4,kit:"Portugal"}, Messi:{emoji:"🩵",color:0x68bce8,kit:"Argentina"},
 Mbappe:{emoji:"🔵",color:0x304da7,kit:"France"}, Haaland:{emoji:"🟡",color:0xe9c84a,kit:"City"}, Neymar:{emoji:"🟢",color:0x28a36a,kit:"Brazil"},
 Bellingham:{emoji:"⚪",color:0xf0e6cf,kit:"Madrid"}, Vinicius:{emoji:"⚪",color:0xf4eee4,kit:"Madrid"}
};
let currentRoom=null, meReady=false, isHost=false, myRole="player", scene=null, camera=null, renderer=null, localActors=new Map(), move={x:0,z:0}, keys={}, tasks=0, gameStarted=false;
// Mobile touch controls: hold a direction button to move.
for (const button of document.querySelectorAll("[data-key]")) {
  const key = button.dataset.key;
  const down = (event) => { event.preventDefault(); keys[key] = true; button.classList.add("pressed"); };
  const up = (event) => { event.preventDefault(); keys[key] = false; button.classList.remove("pressed"); };
  button.addEventListener("pointerdown", down);
  button.addEventListener("pointerup", up);
  button.addEventListener("pointercancel", up);
  button.addEventListener("pointerleave", up);
}
window.addEventListener("blur", () => { keys = {}; document.querySelectorAll("[data-key]").forEach(b=>b.classList.remove("pressed")); });

for(const [name] of Object.entries(CHARACTERS)){const o=document.createElement("option");o.value=name;o.textContent=name;$("character").append(o);}
$("character").value="Salah";
const myName=()=> $("playerName").value.trim() || "Player";
function show(id){["home","lobby","game"].forEach(k=>$(k).classList.toggle("hidden",k!==id));}
function notice(id,msg){$(id).textContent=msg||"";}
function createRoom(){socket.emit("room:create",{name:myName(),character:$("character").value},res=>{if(!res?.ok)return notice("homeNotice","حصلت مشكلة في إنشاء الروم.");currentRoom=res.room;meReady=false;renderRoom(res.room);show("lobby");});}
function joinRoom(){socket.emit("room:join",{code:$("roomCode").value,name:myName(),character:$("character").value},res=>{if(!res?.ok)return notice("homeNotice",res?.error||"تعذر دخول الروم.");currentRoom=res.room;meReady=false;renderRoom(res.room);show("lobby");});}
$("createBtn").onclick=createRoom;$("joinBtn").onclick=joinRoom;
$("roomCode").addEventListener("input",e=>e.target.value=e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,""));
$("character").addEventListener("change",()=>{if(currentRoom&&!gameStarted)socket.emit("player:customize",{name:myName(),character:$("character").value});});
$("playerName").addEventListener("change",()=>{if(currentRoom&&!gameStarted)socket.emit("player:customize",{name:myName(),character:$("character").value});});
$("readyBtn").onclick=()=>{meReady=!meReady;socket.emit("player:ready",meReady);$("readyBtn").textContent=meReady?"إلغاء الجاهزية ↩":"أنا جاهز ✓";};
$("startBtn").onclick=()=>socket.emit("room:start");
$("copyBtn").onclick=async()=>{try{await navigator.clipboard.writeText(currentRoom.code);notice("lobbyNotice","تم نسخ كود الروم.");}catch{notice("lobbyNotice","كود الروم: "+currentRoom.code);}};
function leave(){socket.emit("room:leave");currentRoom=null;gameStarted=false;meReady=false;disposeGame();show("home");}
$("leaveBtn").onclick=leave;$("exitGameBtn").onclick=()=>{disposeGame();gameStarted=false;show("lobby");};
socket.on("room:update",room=>{if(!currentRoom||room.code!==currentRoom.code)return;currentRoom=room;renderRoom(room);});
socket.on("notice",msg=>{notice(gameStarted?"gameNotice":"lobbyNotice",msg);});
socket.on("game:role",({role})=>{myRole=role;});
socket.on("game:started",room=>{currentRoom=room;gameStarted=true;tasks=0;$("taskCount").textContent="المهام 0/3";$("roleTitle").textContent="الجولة بدأت";$("roleBadge").textContent=myRole==="impostor"?"دورك: Impostor — خليك متخفي":"مهمتك: أنجز المهام واكتشف المخادع";show("game");startGame(room);});
function renderRoom(room){
 $("codeText").textContent=room.code;$("playerCount").textContent=room.players.length;
 isHost=room.hostId===socket.id;
 $("startBtn").classList.toggle("hidden",!isHost);$("readyBtn").classList.remove("hidden");
 $("lobbyStatus").textContent=isHost?"أنت المضيف — محتاجين 4 لاعبين وكلهم جاهزين.":"استنى المضيف يبدأ الجولة.";
 const list=$("playerList");list.innerHTML="";
 for(const p of room.players){
  const card=document.createElement("div");card.className="player-card";
  const avatar=document.createElement("div");avatar.className="avatar";avatar.style.borderBottom="3px solid #"+(CHARACTERS[p.character]?.color||0x80f0bd).toString(16).padStart(6,"0");avatar.textContent=CHARACTERS[p.character]?.emoji||"⚽";
  const meta=document.createElement("div");meta.className="player-meta";
  const nm=document.createElement("strong");nm.textContent=p.name+(p.id===socket.id?" (أنت)":"");
  const sub=document.createElement("small");sub.textContent=(CHARACTERS[p.character]?.kit||"Football")+" • "+p.character+(p.host?" • المضيف":"");
  meta.append(nm,sub);
  const pill=document.createElement("span");pill.className="pill"+(p.ready?"":" wait");pill.textContent=p.ready?"جاهز":"لسه";
  card.append(avatar,meta,pill);list.append(card);
 }
}
let animationId=null, lastMoveSent=0;
function startGame(room){
 initScene();for(const p of room.players)makeActor(p);
 room.players.forEach(p=>{if(p.id!==socket.id&&p.x!==undefined)moveActor(p.id,p.x,p.z);});
 $("taskToast").textContent="اتحرك بالـ WASD أو الأسهم";
}
function initScene(){
 const canvas=$("gameCanvas");scene=new THREE.Scene();scene.background=new THREE.Color(0x0d1b2a);scene.fog=new THREE.Fog(0x0d1b2a,22,45);
 camera=new THREE.PerspectiveCamera(48,canvas.clientWidth/canvas.clientHeight,.1,100);camera.position.set(0,15,18);camera.lookAt(0,0,0);
 renderer=new THREE.WebGLRenderer({canvas,antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setSize(canvas.clientWidth,canvas.clientHeight,false);renderer.shadowMap.enabled=true;
 scene.add(new THREE.HemisphereLight(0xb8dcff,0x263344,2.2));const sun=new THREE.DirectionalLight(0xffffff,2.5);sun.position.set(-5,12,7);sun.castShadow=true;scene.add(sun);
 const floor=new THREE.Mesh(new THREE.PlaneGeometry(24,18),new THREE.MeshStandardMaterial({color:0x203247,roughness:.85}));floor.rotation.x=-Math.PI/2;floor.receiveShadow=true;scene.add(floor);
 const grid=new THREE.GridHelper(24,24,0x3e5e77,0x2b4358);grid.position.y=.015;scene.add(grid);
 addBox(0,-.15,-9,24,.5,.5,0x34536b);addBox(0,-.15,9,24,.5,.5,0x34536b);addBox(-12,-.15,0,.5,.5,18,0x34536b);addBox(12,-.15,0,.5,.5,18,0x34536b);
 // Football pitch markings
 const lineMat=new THREE.MeshBasicMaterial({color:0x8ca9b8});
 const circle=new THREE.Mesh(new THREE.RingGeometry(2.45,2.5,64),lineMat);circle.rotation.x=-Math.PI/2;circle.position.y=.03;scene.add(circle);
 addBox(0,.025,0,24,.025,.06,0xb8d4d9);
 for(let i=0;i<3;i++){addBox(-8+i*8,.1,-6,1.2,.18,1.2,[0x347b82,0x79684c,0x3e688e][i]);addBox(-8+i*8,.22,-6,.8,.08,.8,0x92d6d0);}
 window.addEventListener("resize",resizeScene);
 function animate(){animationId=requestAnimationFrame(animate);if(!renderer)return;const actor=localActors.get(socket.id);if(actor&&gameStarted){let dx=0,dz=0;if(keys.ArrowLeft||keys.KeyA)dx-=1;if(keys.ArrowRight||keys.KeyD)dx+=1;if(keys.ArrowUp||keys.KeyW)dz-=1;if(keys.ArrowDown||keys.KeyS)dz+=1;if(dx||dz){const len=Math.hypot(dx,dz);actor.group.position.x=Math.max(-10,Math.min(10,actor.group.position.x+dx/len*.09));actor.group.position.z=Math.max(-7,Math.min(7,actor.group.position.z+dz/len*.09));actor.group.rotation.y=Math.atan2(dx,dz);const now=performance.now();if(now-lastMoveSent>70){socket.emit("game:move",{x:actor.group.position.x,z:actor.group.position.z});lastMoveSent=now;}}camera.position.x+=(actor.group.position.x-camera.position.x)*.025;camera.position.z+=(actor.group.position.z+15-camera.position.z)*.025;camera.lookAt(actor.group.position.x,0,actor.group.position.z);}
 renderer.render(scene,camera);}
 animate();
}
function addBox(x,y,z,w,h,d,color){const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),new THREE.MeshStandardMaterial({color,roughness:.75}));mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;scene.add(mesh);return mesh;}
function makeActor(p){
 if(!scene)return;const c=CHARACTERS[p.character]||CHARACTERS.Salah;const group=new THREE.Group();group.position.set(p.id===socket.id?0:(p.x||Math.random()*4-2),0,p.id===socket.id?2:(p.z||Math.random()*4-2));
 const skin=new THREE.MeshStandardMaterial({color:0xb97c59,roughness:.9}),kit=new THREE.MeshStandardMaterial({color:c.color,roughness:.65}),dark=new THREE.MeshStandardMaterial({color:0x18202a,roughness:.85}),white=new THREE.MeshStandardMaterial({color:0xf4f7fa,roughness:.35});
 const body=new THREE.Mesh(new THREE.CapsuleGeometry(.42,.62,5,10),kit);body.position.y=1.05;body.castShadow=true;group.add(body);
 const head=new THREE.Mesh(new THREE.SphereGeometry(.29,20,16),skin);head.position.y=1.77;head.castShadow=true;group.add(head);
 const hair=new THREE.Mesh(new THREE.SphereGeometry(.3,16,10,0,Math.PI*2,0,Math.PI*.55),dark);hair.position.y=1.91;group.add(hair);
 const shorts=new THREE.Mesh(new THREE.CapsuleGeometry(.33,.24,4,8),dark);shorts.position.y=.55;group.add(shorts);
 for(let i=-1;i<=1;i+=2){const leg=new THREE.Mesh(new THREE.CylinderGeometry(.095,.11,.42,10),kit);leg.position.set(i*.17,.28,0);group.add(leg);const shoe=new THREE.Mesh(new THREE.BoxGeometry(.18,.1,.28),white);shoe.position.set(i*.17,.07,.06);group.add(shoe);}
 for(let i=-1;i<=1;i+=2){const arm=new THREE.Mesh(new THREE.CapsuleGeometry(.09,.38,4,8),kit);arm.position.set(i*.49,1.12,0);arm.rotation.z=i*.18;group.add(arm);}
 // little football at the player's feet
 const ball=new THREE.Mesh(new THREE.SphereGeometry(.13,14,12),white);ball.position.set(.47,.13,.15);group.add(ball);
 scene.add(group);localActors.set(p.id,{group,character:p.character});
}
function moveActor(id,x,z){const a=localActors.get(id);if(a){a.group.position.x=x;a.group.position.z=z;}}
socket.on("game:playerMoved",p=>moveActor(p.id,p.x,p.z));
function resizeScene(){if(!renderer||!camera)return;const c=$("gameCanvas");renderer.setSize(c.clientWidth,c.clientHeight,false);camera.aspect=c.clientWidth/c.clientHeight;camera.updateProjectionMatrix();}
function disposeGame(){if(animationId)cancelAnimationFrame(animationId);animationId=null;if(renderer){renderer.dispose();renderer=null;}if(scene){scene.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material){if(Array.isArray(o.material))o.material.forEach(m=>m.dispose());else o.material.dispose();}});}scene=null;camera=null;localActors.clear();window.removeEventListener("resize",resizeScene);}
window.addEventListener("keydown",e=>{keys[e.code]=true;if(["ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Space"].includes(e.code))e.preventDefault();});
window.addEventListener("keyup",e=>keys[e.code]=false);
$("taskBtn").onclick=()=>{if(myRole==="impostor"){$("taskToast").textContent="أنت المخادع — حاول ما تتكشفش!";return;}tasks=Math.min(3,tasks+1);$("taskCount").textContent=`المهام ${tasks}/3`;$("taskToast").textContent=tasks===3?"خلصت مهامك التجريبية!":"تم إنجاز مهمة تجريبية ✓";};
$("reportBtn").onclick=()=>notice("gameNotice","🚨 تم تسجيل بلاغ تجريبي. نظام الاجتماعات والتصويت هيتضاف في المرحلة التالية.");
