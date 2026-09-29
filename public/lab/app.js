const $ = id => document.getElementById(id);
const API = "/api";
let n = 2;
let shots = 1000;
let circuit = [];
let lastResult = null;
let dragGate = null;
let camera = {x:-18,y:28,zoom:1};
let activeTool = "build";
let chatHistory = [];
let aiBusy = false;

const singleGates = ["H","X","Y","Z","S","T"];
const multiGates = ["CX","SWAP","CZ","TOFFOLI","FREDKIN","CCZ","MCX","MCSWAP","MCZ"];

function toast(text){
  $("toast").textContent = text;
  $("toast").style.display = "block";
  clearTimeout(window.__toast);
  window.__toast = setTimeout(()=>$("toast").style.display="none",2200);
}
function setStatus(text, ok=false){
  $("status").textContent=text;
  $("connectionStatus").classList.toggle("online", ok);
  $("connectionStatus").textContent=ok ? "🟢 Backend Connected" : "🟠 Local / Backend";
}
async function api(path, options={}){
  const token=localStorage.getItem("qbytes-session");
  const r = await fetch(API+path,{headers:{"Content-Type":"application/json",...(token?{"Authorization":`Bearer ${token}`}:{ }),...(options.headers||{})},...options});
  const data = await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
}

const gateArity={CX:2,SWAP:2,CZ:2,TOFFOLI:3,FREDKIN:3,CCZ:3,MCX:4,MCSWAP:4,MCZ:4};
function refreshGateLibrary(){document.querySelector(".gate-group-3")?.style.setProperty("display",n>=3?"block":"none");document.querySelector(".gate-group-4")?.style.setProperty("display",n>=4?"block":"none");document.querySelectorAll(".gate").forEach(el=>{const ar=gateArity[el.dataset.gate]||1;el.draggable=ar<=n;el.style.opacity=ar<=n?"1":".38";});}
function buildGrid(){
  $("selectedQubit").innerHTML="";
  for(let q=0;q<n;q++){
    const o=document.createElement("option"); o.value=q; o.textContent=`q${q}`; $("selectedQubit").appendChild(o);
  }
  $("circuit").innerHTML="";
  $("circuit").style.setProperty("--cols", Math.max(8, Math.min(12, 8)));
  for(let q=0;q<n;q++){
    const row=document.createElement("div"); row.className="circuit-row";
    const label=document.createElement("div"); label.className="q-label"; label.textContent=`q${q}`;
    row.appendChild(label);
    for(let col=0;col<8;col++){
      const slot=document.createElement("div"); slot.className="slot"; slot.dataset.q=q; slot.dataset.col=col;
      slot.textContent="·";
      slot.addEventListener("click",()=>cycleSlot(q,col));
      slot.addEventListener("dragover",e=>e.preventDefault());
      slot.addEventListener("drop",e=>{
        e.preventDefault();
        const gate=dragGate;
        if(!gate) return;
        if(singleGates.includes(gate)) setSingle(q,col,gate);
        else if(multiGates.includes(gate)) placeMulti(gate,q,col);
        dragGate=null;
      });
      row.appendChild(slot);
    }
    $("circuit").appendChild(row);
  }
  refreshGateLibrary();
  renderCircuit();
  updateCode();
}
function slotGate(q,col){ return circuit.find(g=>g.column===col && g.qubits.includes(q)); }
function removeAt(q,col){
  circuit=circuit.filter(g=>!(g.column===col && g.qubits.includes(q)));
}
function setSingle(q,col,gate){
  removeAt(q,col);
  circuit.push({gate,qubits:[q],column:col});
  renderCircuit(); updateCode();
}
function placeMulti(gate,q,col){const ar=gateArity[gate]||2;if(n<ar)return toast(`Use at least ${ar} qubits for ${gate}.`);const qs=Array.from({length:ar},(_,i)=>(q+i)%n);qs.forEach(x=>removeAt(x,col));circuit.push({gate,qubits:qs,column:col});renderCircuit();updateCode();}
function cycleSlot(q,col){
  const existing=slotGate(q,col);
  if(existing){ removeAt(q,col); renderCircuit(); updateCode(); return; }
  setSingle(q,col,"H");
}
function renderCircuit(){
  document.querySelectorAll(".slot").forEach(s=>{
    const q=Number(s.dataset.q), col=Number(s.dataset.col);
    const g=slotGate(q,col);
    if(!g){s.className="slot";s.textContent="·";return}
    s.className="slot filled";
    s.textContent=g.gate==="CX" ? (g.qubits[0]===q?"●":"⊕") : g.gate;
    if(g.gate==="SWAP") s.textContent="⇄";
  });
}
function qiskitLocal(){
  const lines=[`from qiskit import QuantumCircuit`,``,`qc = QuantumCircuit(${n}, ${n})`];
  for(const g of [...circuit].sort((a,b)=>a.column-b.column)){
    if(singleGates.includes(g.gate)) lines.push(`qc.${g.gate.toLowerCase()}(${g.qubits[0]})`);
    if(g.gate==="CX") lines.push(`qc.cx(${g.qubits[0]}, ${g.qubits[1]})`);
    if(g.gate==="SWAP") lines.push(`qc.swap(${g.qubits[0]}, ${g.qubits[1]})`);
  }
  lines.push(`qc.measure(range(${n}), range(${n}))`);
  return lines.join("\n");
}
function updateCode(){ $("codeEditor").value=qiskitLocal(); }
function drawChart(counts){
  const canvas=$("probChart"), ctx=canvas.getContext("2d");
  const labels=Object.keys(counts).sort(), values=labels.map(k=>counts[k]);
  // Compact, presentation-style probability chart: responsive canvas, small bars, 0–100% scale.
  const host=canvas.parentElement;
  const hostWidth=Math.max(300, Math.floor(host.getBoundingClientRect().width || 420));
  canvas.width=Math.max(360, Math.min(900, hostWidth));
  canvas.height=205;
  canvas.style.width="100%";
  canvas.style.height="205px";
  ctx.clearRect(0,0,canvas.width,canvas.height);
  const max=Math.max(1,...values), left=42,bottom=34, top=10,h=canvas.height-top-bottom,w=canvas.width-left-12;
  ctx.strokeStyle="rgba(110,130,140,.22)"; ctx.lineWidth=1;
  for(let t=0;t<=4;t++){
    const y=top+h-(h*t/4);
    ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(canvas.width-12,y);ctx.stroke();
    ctx.fillStyle="rgba(100,120,130,.75)";ctx.font="9px system-ui";ctx.textAlign="right";ctx.fillText(`${Math.round(max*t/4)}`,left-7,y+3);
  }
  const step=w/Math.max(1,labels.length);
  const bw=Math.min(28, Math.max(12, step*.34));
  labels.forEach((lab,i)=>{
    const x=left+i*step+(step-bw)/2, bh=values[i]/max*(h-10);
    ctx.fillStyle="#2dd4bf";ctx.fillRect(x,canvas.height-bottom-bh,bw,bh);
    ctx.fillStyle="#8fa3b8";ctx.font="11px monospace";ctx.textAlign="center";ctx.fillText(lab,x+bw/2,canvas.height-12);
    ctx.fillStyle="#eef6ff";ctx.fillText(String(values[i]),x+bw/2,canvas.height-bottom-bh-5);
  });
}
function canvasSize(canvas){
  const rect=canvas.getBoundingClientRect();
  const dpr=Math.min(2,window.devicePixelRatio||1);
  const w=Math.max(240,Math.floor(rect.width)), h=Math.max(220,Math.floor(rect.height));
  canvas.width=Math.floor(w*dpr); canvas.height=Math.floor(h*dpr);
  const ctx=canvas.getContext("2d"); ctx.setTransform(dpr,0,0,dpr,0,0);
  return {ctx,w,h};
}
function rot3(v, rx, ry){
  const ax=rx*Math.PI/180, ay=ry*Math.PI/180;
  const cy=Math.cos(ay),sy=Math.sin(ay),cx=Math.cos(ax),sx=Math.sin(ax);
  let x=v.x*cy+v.z*sy, z=-v.x*sy+v.z*cy;
  let y=v.y*cx-z*sx; z=v.y*sx+z*cx;
  return {x,y,z};
}
function project3(v,cx,cy,r,cam){
  const q=rot3(v,cam.x,cam.y);
  const perspective=1/(1-q.z*0.32);
  return {x:cx+q.x*r*perspective*cam.zoom,y:cy-q.y*r*perspective*cam.zoom,z:q.z,scale:perspective*cam.zoom};
}
function sphereBase(ctx,cx,cy,r,cam,dark){
  const grad=ctx.createRadialGradient(cx-r*.34,cy-r*.38,r*.03,cx,cy,r*1.08);
  if(dark){grad.addColorStop(0,"rgba(116,185,205,.40)");grad.addColorStop(.48,"rgba(48,83,102,.55)");grad.addColorStop(1,"rgba(8,17,28,.95)");}
  else {grad.addColorStop(0,"rgba(255,255,255,.96)");grad.addColorStop(.34,"rgba(220,233,239,.88)");grad.addColorStop(.78,"rgba(178,201,211,.72)");grad.addColorStop(1,"rgba(120,153,168,.62)");}
  ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.fillStyle=grad;ctx.fill();
  const shadow=ctx.createRadialGradient(cx+r*.42,cy+r*.38,r*.15,cx+r*.38,cy+r*.38,r*1.0);
  shadow.addColorStop(0,"rgba(0,0,0,.26)");shadow.addColorStop(1,"rgba(0,0,0,0)");ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.fillStyle=shadow;ctx.fill();
  ctx.strokeStyle=dark?"rgba(150,205,220,.42)":"rgba(78,111,126,.34)";ctx.lineWidth=1.25;ctx.stroke();
}
function gridCurve(ctx,points,front, dark){
  if(points.length<2)return;
  ctx.beginPath();
  points.forEach((p,i)=>{if(i===0)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y)});
  ctx.strokeStyle=front?(dark?"rgba(125,203,220,.42)":"rgba(74,113,129,.36)"):(dark?"rgba(125,203,220,.13)":"rgba(74,113,129,.14)");
  ctx.lineWidth=front?1.05:.8; ctx.setLineDash(front?[]:[4,4]);ctx.stroke();ctx.setLineDash([]);
}
function drawSphereGrid(ctx,cx,cy,r,cam,dark){
  for(let lat=-75;lat<=75;lat+=25){
    const a=lat*Math.PI/180, pts=[];
    for(let i=0;i<=100;i++){const lon=-Math.PI+2*Math.PI*i/100;pts.push(project3({x:Math.cos(a)*Math.cos(lon),y:Math.sin(a),z:Math.cos(a)*Math.sin(lon)},cx,cy,r,cam));}
    gridCurve(ctx,pts,pts.reduce((a,p)=>a+p.z,0)>0,dark);
  }
  for(let lon=0;lon<180;lon+=30){
    const a=lon*Math.PI/180, pts=[];
    for(let i=0;i<=100;i++){const lat=-Math.PI/2+Math.PI*i/100;pts.push(project3({x:Math.cos(lat)*Math.cos(a),y:Math.sin(lat),z:Math.cos(lat)*Math.sin(a)},cx,cy,r,cam));}
    gridCurve(ctx,pts,pts.reduce((a,p)=>a+p.z,0)>0,dark);
    const a2=(lon+180)*Math.PI/180, pts2=[];
    for(let i=0;i<=100;i++){const lat=-Math.PI/2+Math.PI*i/100;pts2.push(project3({x:Math.cos(lat)*Math.cos(a2),y:Math.sin(lat),z:Math.cos(lat)*Math.sin(a2)},cx,cy,r,cam));}
    gridCurve(ctx,pts2,pts2.reduce((a,p)=>a+p.z,0)>0,dark);
  }
}
function pointForState(index,total){
  if(total===4){
    return [{x:0,y:1,z:0},{x:1,y:0,z:0},{x:-1,y:0,z:0},{x:0,y:-1,z:0}][index];
  }
  const phi=Math.acos(1-2*(index+.5)/total), theta=Math.PI*(3-Math.sqrt(5))*index;
  return {x:Math.sin(phi)*Math.cos(theta),y:Math.cos(phi),z:Math.sin(phi)*Math.sin(theta)};
}
function renderQSphere(amplitudes){
  const canvas=$("qsphereCanvas"), {ctx,w,h}=canvasSize(canvas); const dark=document.body.classList.contains("dark");
  const cx=w/2,cy=h/2,r=Math.min(w,h)*.34*qRot.zoom;
  ctx.clearRect(0,0,w,h); sphereBase(ctx,cx,cy,r,{x:qRot.x,y:qRot.y,zoom:1},dark);
  const cam={x:qRot.x,y:qRot.y,zoom:qRot.zoom}; drawSphereGrid(ctx,cx,cy,r/cam.zoom,cam,dark);
  const states=(amplitudes||[]).filter(a=>a.probability>0.00001); const total=1<<n;
  const pts=states.map(a=>{const v=pointForState(parseInt(a.state,2),total), p=project3(v,cx,cy,r/cam.zoom,cam);return {...a,p,v}}).sort((a,b)=>a.p.z-b.p.z);
  pts.forEach(a=>{const size=(6+18*Math.sqrt(Math.max(0,a.probability)))*Math.max(.72,a.p.scale);ctx.beginPath();ctx.arc(a.p.x,a.p.y,size,0,Math.PI*2);ctx.fillStyle=a.p.z<0?(dark?"rgba(75,150,185,.72)":"rgba(73,154,191,.66)"):(dark?"#55d7e7":"#47cbe2");ctx.shadowColor=ctx.fillStyle;ctx.shadowBlur=12;ctx.fill();ctx.shadowBlur=0;ctx.strokeStyle=dark?"rgba(255,255,255,.8)":"rgba(255,255,255,.95)";ctx.lineWidth=1;ctx.stroke();
    ctx.font="700 11px ui-monospace,monospace";ctx.fillStyle=dark?"#f2f7fb":"#173047";ctx.textAlign=a.p.x>cx?"left":"right";ctx.fillText(`|${a.state}⟩`,a.p.x+(a.p.x>cx?size+6:-size-6),a.p.y-3);ctx.font="10px ui-monospace,monospace";ctx.fillStyle=dark?"#9eb1bf":"#637786";ctx.fillText(`${(a.probability*100).toFixed(1)}%`,a.p.x+(a.p.x>cx?size+6:-size-6),a.p.y+10);
  });
  ctx.font="11px system-ui";ctx.fillStyle=dark?"#aebdc8":"#657785";ctx.textAlign="center";ctx.fillText("Drag to rotate 360°  •  Scroll to zoom",cx,h-10);
  $("qsphereInfo").textContent=states.length?states.map(a=>`|${a.state}⟩ ${(a.probability*100).toFixed(1)}%`).join("  ·  "):"No non-zero amplitudes";
}
function renderBloch(){
  const q=Number($("selectedQubit").value||0), b=lastResult?.bloch?.[q] || {x:0,y:0,z:1};
  const canvas=$("blochCanvas"), {ctx,w,h}=canvasSize(canvas); const dark=document.body.classList.contains("dark");
  const cx=w*.43,cy=h*.50,r=Math.min(h*.34,w*.31)*camera.zoom; ctx.clearRect(0,0,w,h);
  sphereBase(ctx,cx,cy,r,{x:camera.x,y:camera.y,zoom:1},dark); drawSphereGrid(ctx,cx,cy,r/camera.zoom,{x:camera.x,y:camera.y,zoom:camera.zoom},dark);
  const axis=(v,label,dx,dy)=>{const p=project3(v,cx,cy,r/camera.zoom,{x:camera.x,y:camera.y,zoom:camera.zoom});const o=project3({x:-v.x,y:-v.y,z:-v.z},cx,cy,r/camera.zoom,{x:camera.x,y:camera.y,zoom:camera.zoom});ctx.beginPath();ctx.moveTo(o.x,o.y);ctx.lineTo(p.x,p.y);ctx.strokeStyle=dark?"rgba(190,207,217,.45)":"rgba(78,102,114,.42)";ctx.lineWidth=1;ctx.stroke();ctx.fillStyle=dark?"#dbe7ee":"#405765";ctx.font="700 12px ui-monospace";ctx.fillText(label,p.x+dx,p.y+dy)};
  axis({x:1,y:0,z:0},"X",6,3);axis({x:0,y:1,z:0},"Y",6,3);axis({x:0,y:0,z:1},"Z",6,3);
  const mag=Math.min(1,Math.hypot(b.x,b.y,b.z)); const endpoint=project3({x:b.x,y:b.y,z:b.z},cx,cy,r/camera.zoom,{x:camera.x,y:camera.y,zoom:camera.zoom});
  ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(endpoint.x,endpoint.y);ctx.strokeStyle=dark?"#63d8ff":"#2e7be8";ctx.lineWidth=4;ctx.shadowColor=ctx.strokeStyle;ctx.shadowBlur=8;ctx.stroke();ctx.shadowBlur=0;
  const ang=Math.atan2(endpoint.y-cy,endpoint.x-cx), ah=9;ctx.beginPath();ctx.moveTo(endpoint.x,endpoint.y);ctx.lineTo(endpoint.x-ah*Math.cos(ang-.5),endpoint.y-ah*Math.sin(ang-.5));ctx.lineTo(endpoint.x-ah*Math.cos(ang+.5),endpoint.y-ah*Math.sin(ang+.5));ctx.closePath();ctx.fillStyle=dark?"#63d8ff":"#2e7be8";ctx.fill();
  ctx.beginPath();ctx.arc(endpoint.x,endpoint.y,7,0,Math.PI*2);ctx.fillStyle=dark?"#72e6ff":"#32c8e5";ctx.shadowColor=ctx.fillStyle;ctx.shadowBlur=14;ctx.fill();ctx.shadowBlur=0;
  const theta=Math.acos(Math.max(-1,Math.min(1,b.z||0))),phi=Math.atan2(b.y,b.x);
  ctx.fillStyle=dark?"#c8d5dd":"#566b78";ctx.font="11px ui-monospace";ctx.textAlign="left";ctx.fillText(`θ ${(theta*180/Math.PI).toFixed(1)}°`,10,h-34);ctx.fillText(`φ ${(phi*180/Math.PI).toFixed(1)}°`,10,h-18);ctx.fillText(`q${q}: X ${b.x.toFixed(2)}  Y ${b.y.toFixed(2)}  Z ${b.z.toFixed(2)}`,Math.min(w-270,220),h-18);
}
function renderResult(data){
  lastResult=data;
  $("shotSummary").textContent=`${data.shots} shots`;
  drawChart(data.counts);
  renderQSphere(data.amplitudes);
  renderBloch();
  $("codeEditor").value=qiskitLocal();
}
async function runCircuit(){
  setStatus("Running…");
  try{
    const data=await api("/quantum/run",{method:"POST",body:JSON.stringify({qubits:n,shots,mode:$("mode").value,circuit})});
    renderResult(data.result); $("codeEditor").value=data.code; setStatus("Simulation complete",true);if(data.awarded)toast(`+${data.awarded} points · circuit saved`);
  }catch(e){setStatus("Run failed");toast(e.message)}
}
async function optimize(){
  setStatus("Optimizing…");
  try{
    const data=await api("/quantum/optimize",{method:"POST",body:JSON.stringify({qubits:n,circuit})});
    circuit=data.circuit; renderCircuit(); $("codeEditor").value=data.code; setStatus("Optimized",true); toast(data.message);
  }catch(e){toast(e.message)}
}
function setChatBusy(busy){
  aiBusy=busy;
  const input=$("chatInput"), button=$("sendBtn");
  input.disabled=busy; button.disabled=busy;
  input.placeholder=busy ? "Quantum AI is thinking…" : "Ask Quantum AI…";
  button.textContent=busy ? "…" : "➤";
}

function applyAIActions(actions){
  if(!Array.isArray(actions)) return false;
  let changed=false;
  for(const action of actions){
    if(action?.type!=="set_circuit") continue;
    const requestedN=Math.max(1,Math.min(4,Number(action.qubits)||2));
    const raw=Array.isArray(action.circuit)?action.circuit:[];
    const safe=[];
    for(const g of raw.slice(0,32)){
      const gate=String(g?.gate||"").toUpperCase()==="CNOT"?"CX":String(g?.gate||"").toUpperCase();
      const arity=gateArity[gate]||1;
      const qs=Array.isArray(g?.qubits)?g.qubits.slice(0,arity).map(Number):[];
      const col=Math.max(0,Math.min(7,Number.isFinite(Number(g?.column))?Number(g.column):safe.length));
      if(![...singleGates,...multiGates].includes(gate)) continue;
      if(qs.length!==arity || new Set(qs).size!==arity || qs.some(q=>!Number.isInteger(q)||q<0||q>=requestedN)) continue;
      safe.push({gate,qubits:qs,column:col});
    }
    n=requestedN;
    $("qubits").value=String(n);
    circuit=safe;
    buildGrid();
    changed=true;
  }
  return changed;
}

async function askAI(text){
  if(aiBusy || !text) return;
  addMessage("user",text);
  chatHistory.push({role:"user",content:text});
  setChatBusy(true);
  try{
    const data=await api("/quantum-chat",{method:"POST",body:JSON.stringify({
      messages:chatHistory.slice(-12),
      context:{qubits:n,circuit,lastResult,mode:$('mode')?.value||'simulator',shots}
    })});
    const answer=String(data.answer||"I couldn't generate an answer.");
    addMessage("assistant",answer);
    chatHistory.push({role:"assistant",content:answer});
    const changed=applyAIActions(data.actions);
    if(changed){
      updateCode();
      toast("Quantum AI updated your circuit");
      if(data.run) await runCircuit();
    } else if(data.run){
      await runCircuit();
    }
    $("copilotModeText").textContent=data.configured ? `Connected Quantum AI${data.model ? ` · ${data.model}` : ""}` : "Smart Offline Assistant";
  }catch(e){
    addMessage("assistant",`AI unavailable: ${e.message}`);
  }finally{
    setChatBusy(false);
    $("chatInput").focus();
  }
}
function addMessage(role,text){
  const el=document.createElement("div");
  el.className=`msg ${role==="user"?"user-msg":"bot-msg"}`;
  el.textContent=text;
  $("messages").appendChild(el);
  $("messages").scrollTop=$("messages").scrollHeight;
}
function applyToolPrompt(){
  const prompts={
    build:"Build the circuit I describe and give me the gate sequence.",
    explain:"Explain my current quantum circuit step by step.",
    debug:"Debug my current circuit and identify likely mistakes.",
    optimize:"Optimize my current circuit while preserving its behavior.",
    teach:"Teach me the quantum concept behind my current circuit."
  };
  askAI(prompts[activeTool]);
}

function downloadActions(){
  const blob=new Blob([JSON.stringify({qubits:n,shots,circuit},null,2)],{type:"application/json"});
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="qbytes-circuit.json";a.click();URL.revokeObjectURL(a.href);
}
function loadExample(){
  n=2;$("qubits").value="2";circuit=[{gate:"H",qubits:[0],column:1},{gate:"CX",qubits:[0,1],column:3}];buildGrid();runCircuit();
}
function clearAll(){circuit=[];renderCircuit();updateCode();lastResult=null;$("codeEditor").value=qiskitLocal();setStatus("Ready")}
async function health(){
  try{const h=await api("/health");setStatus(h.ok ? "Backend connected" : "Backend issue",h.ok);$("copilotModeText").textContent=h.aiConfigured?"Connected Quantum AI":"Offline Quantum Assistant";}
  catch{setStatus("Offline mode")}
}

document.querySelectorAll(".gate").forEach(el=>el.addEventListener("dragstart",()=>dragGate=el.dataset.gate));
$("qubits").addEventListener("change",()=>{n=Number($("qubits").value);circuit=[];buildGrid()});
$("shots").addEventListener("change",()=>shots=Number($("shots").value));
$("runBtn").onclick=runCircuit;$("compileBtn").onclick=runCircuit;$("optimizeBtn").onclick=optimize;$("downloadBtn").onclick=downloadActions;$("clearBtn").onclick=clearAll;$("exampleBtn").onclick=loadExample;
$("selectedQubit").addEventListener("change",renderBloch);
$("chatInput").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();const v=$("chatInput").value.trim();if(v){$("chatInput").value="";askAI(v)}}});
$("sendBtn").onclick=()=>{const v=$("chatInput").value.trim();if(v){$("chatInput").value="";askAI(v)}};
document.querySelectorAll(".quick button").forEach(b=>b.onclick=()=>askAI(b.dataset.prompt));
document.querySelectorAll(".copilot-tool").forEach(b=>b.onclick=()=>{document.querySelectorAll(".copilot-tool").forEach(x=>x.classList.remove("active"));b.classList.add("active");activeTool=b.dataset.action;applyToolPrompt()});
document.querySelectorAll(".mini-view").forEach(b=>b.onclick=()=>{
  document.querySelectorAll(".mini-view").forEach(x=>x.classList.remove("active"));b.classList.add("active");
  const v=b.dataset.view;
  if(v==="reset"){camera={x:-18,y:28,zoom:1}}
  if(v==="z"){camera={x:0,y:0,zoom:1}}
  if(v==="x"){camera={x:0,y:90,zoom:1}}
  if(v==="y"){camera={x:90,y:0,zoom:1}}
  renderBloch();
});
let dragging=false,lastX=0,lastY=0;
$("blochStage").addEventListener("pointerdown",e=>{dragging=true;lastX=e.clientX;lastY=e.clientY;$("blochStage").setPointerCapture(e.pointerId)});
$("blochStage").addEventListener("pointermove",e=>{if(!dragging)return;camera.y+=(e.clientX-lastX)*.55;camera.x-=(e.clientY-lastY)*.55;camera.x=Math.max(-89,Math.min(89,camera.x));lastX=e.clientX;lastY=e.clientY;renderBloch()});
$("blochStage").addEventListener("pointerup",()=>dragging=false);$("blochStage").addEventListener("pointercancel",()=>dragging=false);
$("blochStage").addEventListener("wheel",e=>{e.preventDefault();camera.zoom=Math.max(.72,Math.min(1.55,camera.zoom-e.deltaY*.001));renderBloch()},{passive:false});

function initTheme(){
  const saved=localStorage.getItem('qbytes-lab-theme');
  if(saved==='dark') document.body.classList.add('dark');
  updateThemeButton();
}
function updateThemeButton(){
  const dark=document.body.classList.contains('dark');
  $("themeBtn").textContent=dark?'☀ Light':'☾ Dark';
  $("themeBtn").setAttribute('aria-label',dark?'Switch to light theme':'Switch to dark theme');
}
$("themeBtn").addEventListener('click',()=>{
  document.body.classList.toggle('dark');
  localStorage.setItem('qbytes-lab-theme',document.body.classList.contains('dark')?'dark':'light');
  updateThemeButton();
});

let qDrag=false,qLastX=0,qLastY=0,qRot={x:-16,y:24,zoom:1};
$("qsphere").addEventListener("pointerdown",e=>{qDrag=true;qLastX=e.clientX;qLastY=e.clientY;$("qsphere").setPointerCapture(e.pointerId)});
$("qsphere").addEventListener("pointermove",e=>{if(!qDrag)return;qRot.y+=(e.clientX-qLastX)*.55;qRot.x-=(e.clientY-qLastY)*.55;qRot.x=Math.max(-89,Math.min(89,qRot.x));qLastX=e.clientX;qLastY=e.clientY;renderQSphere(lastResult?.amplitudes||[])});
$("qsphere").addEventListener("pointerup",()=>qDrag=false);$("qsphere").addEventListener("pointercancel",()=>qDrag=false);
$("qsphere").addEventListener("wheel",e=>{e.preventDefault();qRot.zoom=Math.max(.72,Math.min(1.55,qRot.zoom-e.deltaY*.001));renderQSphere(lastResult?.amplitudes||[])},{passive:false});
window.addEventListener("resize",()=>{renderQSphere(lastResult?.amplitudes||[]);renderBloch()});

async function loadSavedCircuit(){if(!localStorage.getItem("qbytes-session"))return;try{const data=await api("/profile");const saved=data.user?.savedCircuit;if(!saved)return;n=Number(saved.qubits)||2;$("qubits").value=String(n);circuit=Array.isArray(saved.circuit)?saved.circuit:[];buildGrid();renderCircuit();updateCode();toast("Your saved circuit is ready.");}catch(_){}}
buildGrid();health();loadSavedCircuit();
function initLabProfile(){const email=localStorage.getItem("qbytes-user-email"),el=$("labProfile");if(!email||!el)return;el.hidden=false;const name=email.split("@")[0];$("labProfileName").textContent=name;$("labAvatar").textContent=(name[0]||"Q").toUpperCase();}initLabProfile();
initTheme();
renderQSphere([]);renderBloch();
