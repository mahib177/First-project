require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");

app.use(express.json({ limit: "1mb" }));

const sessions = new Map();
const users = new Map();
const USER_STORE = path.join(__dirname, "data", "users.json");

function loadUsers() {
  try {
    const records = JSON.parse(fs.readFileSync(USER_STORE, "utf8"));
    if (Array.isArray(records)) records.forEach(user => { if (user?.email) users.set(user.email, user); });
  } catch (error) {
    if (error.code !== "ENOENT") console.error("Could not read profile store:", error.message);
  }
}

function saveUsers() {
  fs.mkdirSync(path.dirname(USER_STORE), { recursive: true });
  const temp = `${USER_STORE}.tmp`;
  fs.writeFileSync(temp, JSON.stringify([...users.values()], null, 2), { mode: 0o600 });
  fs.renameSync(temp, USER_STORE);
}

function profileFor(email) {
  const key = String(email || "").trim().toLowerCase();
  let user = users.get(key);
  if (!user) {
    user = { id: crypto.randomUUID(), email: key, name: key.split("@")[0], joinedAt: Date.now(), points: 0, streak: 0, lastActiveDate: null, activeDates: [], stats: { quizAnswers: 0, correctAnswers: 0, quizzesCompleted: 0, flashcardsKnown: 0, circuitsRun: 0 }, quizAttempts: {}, earnedQuizQuestions: [], knownCards: [], savedCircuit: null, lastCircuitRewardDate: null, lastQuizCompletionRewardDate: null };
    users.set(key, user);
  }
  user.stats = { quizAnswers: 0, correctAnswers: 0, quizzesCompleted: 0, flashcardsKnown: 0, circuitsRun: 0, ...(user.stats || {}) };
  user.name ||= key.split("@")[0]; user.points = Number(user.points) || 0;
  user.quizAttempts ||= {}; user.earnedQuizQuestions ||= []; user.knownCards ||= []; user.activeDates ||= [];
  return user;
}

function currentUser(req) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const email = sessions.get(token);
  return email ? users.get(email) || null : null;
}

function markActivity(user) {
  const today = new Date().toISOString().slice(0, 10);
  if (user.lastActiveDate !== today) {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    user.streak = user.lastActiveDate === yesterday ? (user.streak || 0) + 1 : 1;
    user.lastActiveDate = today;
    user.activeDates = [...new Set([...(user.activeDates || []), today])].slice(-90);
  }
}

function awardPoints(user, points) { user.points = Math.max(0, (Number(user.points) || 0) + points); }

function publicProfile(user) {
  return {
    id: user.id, email: user.email, name: user.name, avatar: user.avatar || (user.name?.[0] || user.email[0] || "Q").toUpperCase(),
    joinedAt: user.joinedAt, points: user.points || 0, level: Math.floor((user.points || 0) / 100) + 1,
    levelProgress: (user.points || 0) % 100, streak: user.streak || 0, lastActiveDate: user.lastActiveDate,
    activeDates: user.activeDates || [], stats: user.stats, knownCards: user.knownCards || [], savedCircuit: user.savedCircuit || null
  };
}

loadUsers();
 
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function cleanGate(g) {
  if (!g || typeof g !== "object") return null;
  const gate = String(g.gate || g.type || "").toUpperCase();
  const q = Array.isArray(g.qubits) ? g.qubits.map(Number) : [];
  const col = Number.isInteger(g.column) ? g.column : Number.isInteger(g.col) ? g.col : 0;
  return { gate, qubits: q, column: col };
}

function complexMul(a, b) {
  return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re };
}
function complexAdd(a, b) {
  return { re: a.re + b.re, im: a.im + b.im };
}
function abs2(a) {
  return a.re * a.re + a.im * a.im;
}

const SQRT1_2 = Math.SQRT1_2;
const MATRICES = {
  H: [
    [{re: SQRT1_2,im:0},{re: SQRT1_2,im:0}],
    [{re: SQRT1_2,im:0},{re:-SQRT1_2,im:0}]
  ],
  X: [
    [{re:0,im:0},{re:1,im:0}],
    [{re:1,im:0},{re:0,im:0}]
  ],
  Y: [
    [{re:0,im:0},{re:0,im:-1}],
    [{re:0,im:1},{re:0,im:0}]
  ],
  Z: [
    [{re:1,im:0},{re:0,im:0}],
    [{re:0,im:0},{re:-1,im:0}]
  ],
  S: [
    [{re:1,im:0},{re:0,im:0}],
    [{re:0,im:0},{re:0,im:1}]
  ],
  T: [
    [{re:1,im:0},{re:0,im:0}],
    [{re:0,im:0},{re:Math.SQRT1_2,im:Math.SQRT1_2}]
  ]
};

function applySingle(state, n, target, matrix) {
  const out = state.map(z => ({...z}));
  const mask = 1 << target;
  for (let i = 0; i < state.length; i++) {
    if ((i & mask) === 0) {
      const j = i | mask;
      const a = state[i], b = state[j];
      out[i] = complexAdd(complexMul(matrix[0][0], a), complexMul(matrix[0][1], b));
      out[j] = complexAdd(complexMul(matrix[1][0], a), complexMul(matrix[1][1], b));
    }
  }
  return out;
}

function applyCX(state, control, target) {
  const out = state.map(z => ({...z}));
  const cm = 1 << control, tm = 1 << target;
  for (let i = 0; i < state.length; i++) {
    if ((i & cm) !== 0 && (i & tm) === 0) {
      const j = i | tm;
      out[i] = state[j];
      out[j] = state[i];
    }
  }
  return out;
}

function applySWAP(state, a, b) {
  if (a === b) return state;
  const out = state.map(z => ({...z}));
  const ma = 1 << a, mb = 1 << b;
  for (let i = 0; i < state.length; i++) {
    const abit = (i & ma) !== 0, bbit = (i & mb) !== 0;
    if (abit !== bbit) {
      const j = i ^ ma ^ mb;
      if (i < j) {
        out[i] = state[j];
        out[j] = state[i];
      }
    }
  }
  return out;
}

function normalizeGateList(circuit, n) {
  const list = Array.isArray(circuit) ? circuit : [];
  const normalized = [];
  for (const item of list) {
    const g = cleanGate(item);
    if (!g || !g.gate) continue;
    if (["H","X","Y","Z","S","T"].includes(g.gate)) {
      const q = g.qubits[0];
      if (Number.isInteger(q) && q >= 0 && q < n) normalized.push({ ...g, qubits:[q] });
    } else if (g.gate === "CX" || g.gate === "CNOT") {
      if (g.qubits.length >= 2 && g.qubits[0] !== g.qubits[1] &&
          g.qubits.every(q => Number.isInteger(q) && q >= 0 && q < n)) {
        normalized.push({ ...g, gate:"CX", qubits:g.qubits.slice(0,2) });
      }
    } else if (["CZ"].includes(g.gate)) { if(g.qubits.length>=2 && new Set(g.qubits.slice(0,2)).size===2 && g.qubits.slice(0,2).every(q=>Number.isInteger(q)&&q>=0&&q<n)) normalized.push({...g,qubits:g.qubits.slice(0,2)});
    } else if (["TOFFOLI","FREDKIN","CCZ","MCX","MCSWAP","MCZ"].includes(g.gate)) { const need={TOFFOLI:3,FREDKIN:3,CCZ:3,MCX:4,MCSWAP:4,MCZ:4}[g.gate]; if(g.qubits.length>=need && new Set(g.qubits.slice(0,need)).size===need && g.qubits.slice(0,need).every(q=>Number.isInteger(q)&&q>=0&&q<n)) normalized.push({...g,qubits:g.qubits.slice(0,need)});
    } else if (g.gate === "SWAP") {
      if (g.qubits.length >= 2 && g.qubits[0] !== g.qubits[1] &&
          g.qubits.every(q => Number.isInteger(q) && q >= 0 && q < n)) {
        normalized.push({ ...g, qubits:g.qubits.slice(0,2) });
      }
    }
  }
  return normalized;
}

function applyControlledX(state,controls,target){const out=state.map(z=>({...z})),tm=1<<target;for(let i=0;i<state.length;i++)if(controls.every(c=>(i&(1<<c))!==0)&&(i&tm)===0){const j=i|tm;out[i]=state[j];out[j]=state[i];}return out;}
function applyCZ(state,a,b){const out=state.map(z=>({...z}));for(let i=0;i<state.length;i++)if((i&(1<<a))&&(i&(1<<b)))out[i]={re:-state[i].re,im:-state[i].im};return out;}
function applyCCZ(state,qs){const out=state.map(z=>({...z}));for(let i=0;i<state.length;i++)if(qs.every(c=>(i&(1<<c))!==0))out[i]={re:-state[i].re,im:-state[i].im};return out;}
function applyCSWAP(state,control,a,b){const out=state.map(z=>({...z})),mc=1<<control,ma=1<<a,mb=1<<b;for(let i=0;i<state.length;i++)if((i&mc)&&(((i&ma)!==0)!==((i&mb)!==0))){const j=i^ma^mb;if(i<j){out[i]=state[j];out[j]=state[i];}}return out;}
function simulate(n, circuit, shots = 1000, mode = "simulator") {
  n = clamp(Number(n) || 2, 1, 4);
  shots = clamp(Number(shots) || 1000, 100, 10000);
  const gates = normalizeGateList(circuit, n);
  let state = Array.from({length: 1 << n}, (_, i) => i === 0 ? {re:1,im:0} : {re:0,im:0});

  for (const g of gates) {
    if (MATRICES[g.gate]) state = applySingle(state, n, g.qubits[0], MATRICES[g.gate]);
    else if (g.gate === "CX") state = applyCX(state, g.qubits[0], g.qubits[1]);
    else if (g.gate === "SWAP") state = applySWAP(state, g.qubits[0], g.qubits[1]);
    else if (g.gate === "CZ") state = applyCZ(state,g.qubits[0],g.qubits[1]);
    else if (g.gate === "TOFFOLI") state = applyControlledX(state,g.qubits.slice(0,2),g.qubits[2]);
    else if (g.gate === "MCX") state = applyControlledX(state,g.qubits.slice(0,-1),g.qubits[g.qubits.length-1]);
    else if (g.gate === "CCZ" || g.gate === "MCZ") state = applyCCZ(state,g.qubits);
    else if (g.gate === "FREDKIN" || g.gate === "MCSWAP") state = applyCSWAP(state,g.qubits[0],g.qubits[1],g.qubits[2]);
  }

  const probabilities = state.map(abs2);
  const total = probabilities.reduce((a,b) => a+b, 0) || 1;
  for (let i=0;i<probabilities.length;i++) probabilities[i] /= total;

  const cumulative = [];
  let running = 0;
  for (const p of probabilities) { running += p; cumulative.push(running); }

  const counts = {};
  const noisyRate = mode === "noisy" ? 0.025 : 0;
  for (let s=0;s<shots;s++) {
    let r = Math.random();
    let idx = cumulative.findIndex(c => r <= c);
    if (idx < 0) idx = cumulative.length - 1;
    if (noisyRate && Math.random() < noisyRate) {
      const bit = 1 << Math.floor(Math.random() * n);
      idx ^= bit;
    }
    const bitstring = idx.toString(2).padStart(n, "0");
    counts[bitstring] = (counts[bitstring] || 0) + 1;
  }

  const amplitudes = state.map((z, i) => ({
    state: i.toString(2).padStart(n,"0"),
    re: Number(z.re.toFixed(8)),
    im: Number(z.im.toFixed(8)),
    probability: Number(probabilities[i].toFixed(8))
  })).filter(x => x.probability > 1e-10);

  const bloch = [];
  for (let q=0;q<n;q++) {
    let x=0,y=0,z=0;
    const mask = 1 << q;
    for (let i=0;i<state.length;i++) {
      if ((i & mask) === 0) {
        const j=i|mask;
        const a=state[i], b=state[j];
        const cross=complexMul({re:a.re, im:-a.im}, b);
        x += 2*cross.re;
        y += 2*cross.im;
        z += abs2(a)-abs2(b);
      }
    }
    bloch.push({
      qubit:q,
      x:Number(x.toFixed(6)),
      y:Number(y.toFixed(6)),
      z:Number(z.toFixed(6))
    });
  }

  return { n, shots, mode, circuit:gates, counts, probabilities, amplitudes, bloch };
}

function optimizeCircuit(circuit, n) {
  const gates = normalizeGateList(circuit, n);
  const out = [];
  for (const g of gates) {
    const prev = out[out.length-1];
    if (prev && g.gate === prev.gate && ["X","Y","Z","H"].includes(g.gate) &&
        JSON.stringify(g.qubits) === JSON.stringify(prev.qubits)) {
      out.pop();
      continue;
    }
    out.push(g);
  }
  return {
    circuit: out,
    removed: gates.length - out.length,
    message: gates.length === out.length
      ? "No safe local simplifications were found."
      : `Removed ${gates.length - out.length} redundant adjacent gate operation(s).`
  };
}

function qiskitCode(n, circuit) {
  const lines = [`from qiskit import QuantumCircuit`, ``, `qc = QuantumCircuit(${n}, ${n})`];
  for (const g of normalizeGateList(circuit,n)) {
    if (["H","X","Y","Z","S","T"].includes(g.gate)) lines.push(`qc.${g.gate.toLowerCase()}(${g.qubits[0]})`);
    else if (g.gate === "CX") lines.push(`qc.cx(${g.qubits[0]}, ${g.qubits[1]})`);
    else if (g.gate === "SWAP") lines.push(`qc.swap(${g.qubits[0]}, ${g.qubits[1]})`);
  }
  lines.push(`qc.measure(range(${n}), range(${n}))`);
  return lines.join("\n");
}

function aiConfigPresent() {
  return Boolean(process.env.QUANTUM_AI_API_KEY && process.env.QUANTUM_AI_API_URL);
}

const AI_ALLOWED_GATES = new Set(["H","X","Y","Z","S","T","CX","CNOT","CZ","SWAP","TOFFOLI","FREDKIN","CCZ","MCX","MCSWAP","MCZ"]);

function sanitizeAICircuit(circuit, qubits = 2) {
  const n = clamp(Number(qubits) || 2, 1, 4);
  if (!Array.isArray(circuit)) return [];
  return circuit.slice(0, 32).map((item, i) => {
    const g = cleanGate(item);
    if (!g || !AI_ALLOWED_GATES.has(g.gate)) return null;
    const arity = ["H","X","Y","Z","S","T"].includes(g.gate) ? 1 :
      ["CX","CNOT","CZ","SWAP"].includes(g.gate) ? 2 :
      ["TOFFOLI","FREDKIN","CCZ"].includes(g.gate) ? 3 : 4;
    const qs = Array.isArray(g.qubits) ? g.qubits.slice(0, arity) : [];
    if (qs.length !== arity || new Set(qs).size !== arity || qs.some(q => !Number.isInteger(q) || q < 0 || q >= n)) return null;
    return { gate: g.gate === "CNOT" ? "CX" : g.gate, qubits: qs, column: clamp(Number.isInteger(g.column) ? g.column : i, 0, 7) };
  }).filter(Boolean);
}

function parseAIJson(text) {
  if (!text) return null;
  const cleaned = String(text).trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  try { return JSON.parse(cleaned); } catch {}
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first >= 0 && last > first) {
    try { return JSON.parse(cleaned.slice(first, last + 1)); } catch {}
  }
  return null;
}

function offlineQuantumAI(messages, context = {}) {
  const text = String(messages?.[messages.length - 1]?.content || "").trim();
  const lower = text.toLowerCase();
  const currentN = clamp(Number(context.qubits) || 2, 1, 4);
  const currentCircuit = Array.isArray(context.circuit) ? context.circuit : [];

  if (/bell/.test(lower)) {
    return { answer: "Built a Bell state: H on q0, followed by CNOT q0→q1. I also prepared it for simulation.", configured: false, actions: [{type:"set_circuit", qubits:2, circuit:[{gate:"H",qubits:[0],column:1},{gate:"CX",qubits:[0,1],column:3}]}], run: true };
  }
  if (/\bghz\b|3.?qubit.*entangl/.test(lower)) {
    return { answer: "Built a 3-qubit GHZ state: H(q0) → CX(q0,q1) → CX(q1,q2).", configured: false, actions: [{type:"set_circuit", qubits:3, circuit:[{gate:"H",qubits:[0],column:1},{gate:"CX",qubits:[0,1],column:3},{gate:"CX",qubits:[1,2],column:5}]}], run: true };
  }
  const xMatch = lower.match(/\b([xyz])\s*(?:gate\s*)?(?:on|at)\s*q?([0-3])\b/);
  if (xMatch) {
    const gate = xMatch[1].toUpperCase(), q = Number(xMatch[2]);
    const next = currentCircuit.filter(g => !(Number(g.column) === 1 && Array.isArray(g.qubits) && g.qubits.includes(q)));
    next.push({gate,qubits:[q],column:1});
    return { answer: `Added ${gate} to q${q}.`, configured: false, actions: [{type:"set_circuit", qubits:Math.max(currentN,q+1), circuit:next}], run: true };
  }
  if (/\b(clear|reset)\b.*\b(circuit|lab)\b/.test(lower)) {
    return { answer: "Cleared the circuit. You can start building again.", configured: false, actions: [{type:"set_circuit", qubits:currentN, circuit:[]}], run: false };
  }
  if (/\b(explain|what does|how does)\b/.test(lower)) {
    const count = currentCircuit.length;
    const gates = currentCircuit.map(g => `${g.gate}(q${(g.qubits||[]).join(",q")})`).join(" → ");
    const result = context.lastResult;
    const distribution = result?.counts ? Object.entries(result.counts).sort((a,b)=>b[1]-a[1]).slice(0,4).map(([k,v])=>`${k}: ${v}`).join(", ") : "not simulated yet";
    return { answer: `Your ${currentN}-qubit circuit has ${count} gate operation(s): ${gates || "none"}. The current measurement distribution is ${distribution}. Add gates or run the circuit to explore how the state changes.`, configured:false };
  }
  if (/\b(debug|mistake|error|wrong)\b/.test(lower)) {
    const duplicate = currentCircuit.some((g,i)=>currentCircuit.slice(0,i).some(h=>h.gate===g.gate && JSON.stringify(h.qubits)===JSON.stringify(g.qubits) && Math.abs((h.column??0)-(g.column??0))===1 && ["H","X","Y","Z"].includes(g.gate)));
    return { answer: duplicate ? "I found adjacent identical single-qubit operations that may cancel for H/X/Y/Z. Try Optimize Circuit and then re-run." : `I don't see an obvious structural error in the ${currentN}-qubit circuit. Check qubit order, control/target order, and whether you have run the latest version.`, configured:false };
  }
  if (/\b(optimize|simplify)\b/.test(lower)) {
    const optimized = optimizeCircuit(currentCircuit, currentN);
    return { answer: optimized.message, configured:false, actions:[{type:"set_circuit",qubits:currentN,circuit:optimized.circuit}], run:true };
  }
  return { answer: "I can build and explain quantum circuits. Try: “Create a Bell state”, “Create a 3 qubit GHZ state”, “Use X on q0”, “Explain this circuit”, “Debug my circuit”, or “Optimize my circuit”. For open-ended quantum questions, configure the AI provider in .env.", configured:false };
}

async function callQuantumAI(messages, context = {}) {
  if (!aiConfigPresent()) return offlineQuantumAI(messages, context);

  const system = [
    "You are Quantum AI inside Q-BYTES, an educational quantum-computing lab.",
    "Give precise, practical, beginner-friendly quantum-computing answers.",
    "You have access to the user's current circuit and simulator result in the context.",
    "When the user asks to build, change, clear, or optimize a circuit, return an executable action so the UI can apply it.",
    "Never claim a real quantum-hardware execution; the lab simulator is local unless explicitly stated otherwise.",
    "Circuit action rules: max 4 qubits, columns 0-7. Allowed gates: H,X,Y,Z,S,T,CX,CZ,SWAP,TOFFOLI,FREDKIN,CCZ,MCX,MCSWAP,MCZ.",
    "Return ONLY valid JSON with this shape: {\"answer\":\"string\",\"actions\":[{\"type\":\"set_circuit\",\"qubits\":2,\"circuit\":[{\"gate\":\"H\",\"qubits\":[0],\"column\":1}]}],\"run\":true}.",
    "If no circuit change is needed, use actions:[] and run:false. Keep answer concise but useful. Do not use markdown outside the JSON string.",
    `Current lab context: ${JSON.stringify({qubits:context.qubits,circuit:context.circuit,lastResult:context.lastResult})}`
  ].join("\n");

  const payload = {
    model: process.env.QUANTUM_AI_MODEL || "openai/gpt-4o-mini",
    messages: [{role:"system",content:system}, ...messages.slice(-12)],
    temperature: 0.15,
    max_tokens: 1200
  };
  const apiUrl = process.env.QUANTUM_AI_API_URL.trim();
  const apiKey = process.env.QUANTUM_AI_API_KEY.trim();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(apiUrl, {
      method:"POST",
      headers:{"Authorization":`Bearer ${apiKey}`,"Content-Type":"application/json","HTTP-Referer":"http://localhost:3000","X-Title":"Q-BYTES Quantum Learning Platform"},
      body:JSON.stringify(payload),
      signal:controller.signal
    });
    const rawText = await response.text();
    let data={}; try { data=JSON.parse(rawText); } catch {}
    if (!response.ok) {
      const msg=data?.error?.message || data?.error || rawText || `AI provider returned HTTP ${response.status}`;
      throw new Error(String(msg));
    }
    const content=data?.choices?.[0]?.message?.content;
    const rawAnswer = typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content.map(part => typeof part === "string" ? part : (part?.text || part?.content || "")).join("\n")
        : data?.choices?.[0]?.text || data?.output_text || data?.answer;
    if (!rawAnswer) throw new Error("AI provider returned no assistant text.");
    const parsed=parseAIJson(rawAnswer);
    if (!parsed || typeof parsed.answer !== "string") {
      return {answer:String(rawAnswer),configured:true,model:payload.model,actions:[],run:false};
    }
    const safeActions=Array.isArray(parsed.actions) ? parsed.actions.map(a => {
      if (a?.type !== "set_circuit") return null;
      const q=clamp(Number(a.qubits)||2,1,4);
      return {type:"set_circuit",qubits:q,circuit:sanitizeAICircuit(a.circuit,q)};
    }).filter(Boolean) : [];
    return {answer:parsed.answer.trim(),configured:true,model:payload.model,actions:safeActions,run:Boolean(parsed.run)};
  } finally {
    clearTimeout(timer);
  }
}

app.get("/api/health", (req,res) => {
  res.json({
    ok:true,
    service:"Q-BYTES backend",
    aiConfigured: aiConfigPresent(),
    time:new Date().toISOString()
  });
});

app.get("/api/quizzes", (req,res) => {
  const file = path.join(PUBLIC_DIR,"data","quizzes.json");
  const data = JSON.parse(fs.readFileSync(file,"utf8"));
  res.json(data);
});

app.post("/api/quiz/answer", (req,res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ok:false,error:"Sign in to save quiz progress."});
  const questionId = Number(req.body?.questionId), selectedIndex = Number(req.body?.selectedIndex), attemptId = String(req.body?.attemptId || "").slice(0,80);
  if (!Number.isInteger(questionId) || !Number.isInteger(selectedIndex) || !attemptId) return res.status(400).json({ok:false,error:"Invalid quiz answer."});
  const questions = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR,"data","quizzes.json"),"utf8")).questions || [];
  const question = questions.find(item => Number(item.id) === questionId);
  if (!question || selectedIndex < 0 || selectedIndex >= question.options.length) return res.status(400).json({ok:false,error:"Quiz question was not found."});
  const attempt = user.quizAttempts[attemptId] ||= { answers: {}, completed: false, startedAt: Date.now() };
  if (attempt.answers[questionId]) return res.json({ok:true,recorded:true,duplicate:true,correct:attempt.answers[questionId].correct,awarded:0,profile:publicProfile(user)});
  const correct = selectedIndex === Number(question.ans);
  attempt.answers[questionId] = { selectedIndex, correct, at: Date.now() };
  user.stats.quizAnswers++;
  let awarded = 0;
  if (correct) { user.stats.correctAnswers++; if (!user.earnedQuizQuestions.includes(questionId)) { user.earnedQuizQuestions.push(questionId); awarded = 10; awardPoints(user,awarded); } }
  markActivity(user); saveUsers();
  res.json({ok:true,recorded:true,correct,awarded,profile:publicProfile(user)});
});

app.post("/api/quiz/submit", (req,res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ok:false,error:"Sign in to save quiz progress."});
  const attemptId = String(req.body?.attemptId || "").slice(0,80), attempt = user.quizAttempts[attemptId];
  const total = clamp(Number(req.body?.total) || 0, 0, 100);
  if (!attempt || !total) return res.status(400).json({ok:false,error:"Quiz attempt was not found."});
  const answers = Object.values(attempt.answers);
  if (answers.length < total) return res.status(400).json({ok:false,error:"Answer all questions before completing the quiz."});
  const score = answers.filter(answer => answer.correct).length;
  let awarded = 0;
  if (!attempt.completed) {
    attempt.completed = true; attempt.completedAt = Date.now(); attempt.total = total; attempt.score = score; user.stats.quizzesCompleted++;
    const today = new Date().toISOString().slice(0,10);
    if (user.lastQuizCompletionRewardDate !== today) { awarded = 20; user.lastQuizCompletionRewardDate = today; awardPoints(user,awarded); }
    markActivity(user); saveUsers();
  }
  res.json({ok:true,score,total,percentage:Number((score/total*100).toFixed(1)),awarded,profile:publicProfile(user)});
});

app.post("/api/progress/event", (req,res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ok:false,error:"Sign in to save learning progress."});
  if (req.body?.type !== "flashcard_known") return res.status(400).json({ok:false,error:"Unsupported progress event."});
  const level = Number(req.body.level), card = Number(req.body.card);
  if (!Number.isInteger(level) || level < 0 || level > 12 || !Number.isInteger(card) || card < 0 || card > 30) return res.status(400).json({ok:false,error:"Invalid flashcard progress."});
  const key = `${level}:${card}`;
  let awarded = 0;
  if (!user.knownCards.includes(key)) { user.knownCards.push(key); user.stats.flashcardsKnown++; awardPoints(user,5); markActivity(user); awarded = 5; saveUsers(); }
  res.json({ok:true,awarded,profile:publicProfile(user)});
});

app.get("/api/profile", (req,res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ok:false,error:"Not signed in"});
  res.json({ok:true,user:publicProfile(user)});
});

app.patch("/api/profile", (req,res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ok:false,error:"Not signed in"});
  const name = String(req.body?.name || "").trim();
  if (name.length < 1 || name.length > 40) return res.status(400).json({ok:false,error:"Name must be between 1 and 40 characters."});
  user.name = name; user.avatar = name[0].toUpperCase(); saveUsers();
  res.json({ok:true,user:publicProfile(user)});
});

app.get("/api/profile/export", (req,res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ok:false,error:"Not signed in"});
  res.setHeader("Content-Disposition","attachment; filename=qbytes-learning-data.json");
  res.json({exportedAt:new Date().toISOString(),profile:publicProfile(user),quizAttempts:user.quizAttempts});
});

app.delete("/api/profile", (req,res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ok:false,error:"Not signed in"});
  users.delete(user.email);
  for (const [token,email] of sessions) if (email === user.email) sessions.delete(token);
  saveUsers(); res.json({ok:true});
});

app.post("/api/quantum/run", (req,res) => {
  try {
    const result = simulate(req.body?.qubits, req.body?.circuit, req.body?.shots, req.body?.mode);
    const user = currentUser(req);
    let awarded = 0;
    if (user) {
      user.savedCircuit = {qubits:result.n,circuit:result.circuit,updatedAt:Date.now()};
      user.stats.circuitsRun++;
      const today = new Date().toISOString().slice(0,10);
      if (user.lastCircuitRewardDate !== today) { awarded = 3; user.lastCircuitRewardDate = today; awardPoints(user,awarded); markActivity(user); }
      saveUsers();
    }
    res.json({ok:true, result, code:qiskitCode(result.n,result.circuit),awarded,profile:user?publicProfile(user):null});
  } catch (e) {
    res.status(400).json({ok:false,error:e.message});
  }
});

app.post("/api/quantum/optimize", (req,res) => {
  try {
    const n = clamp(Number(req.body?.qubits) || 2, 1, 4);
    const result = optimizeCircuit(req.body?.circuit, n);
    res.json({ok:true,...result,code:qiskitCode(n,result.circuit)});
  } catch (e) {
    res.status(400).json({ok:false,error:e.message});
  }
});

app.post("/api/quantum-chat", async (req,res) => {
  try {
    const messages = Array.isArray(req.body?.messages) ? req.body.messages.slice(-20) : [];
    const context = req.body?.context || {};
    const result = await callQuantumAI(messages, context);
    res.json(result);
  } catch (e) {
    res.status(502).json({error:e.message});
  }
});

app.post("/api/auth/email", (req,res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ok:false,error:"Please enter a valid email address."});
  }
  const user = profileFor(email); user.avatar ||= (user.name[0] || "Q").toUpperCase(); markActivity(user);
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token,email); saveUsers();
  res.json({
    ok:true,
    token,
    user:{email,name:user.name},
    message:"Demo sign-in complete. Learning data is saved on this server. Email ownership is not verified yet."
  });
});

app.use(express.static(PUBLIC_DIR));

app.get("*", (req,res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({error:"API route not found"});
  res.sendFile(path.join(PUBLIC_DIR,"index.html"));
});

app.listen(PORT, () => {
  console.log(`Q-BYTES running at http://localhost:${PORT}`);
  console.log(`Quantum AI configured: ${aiConfigPresent() ? "yes" : "no (add key later)"}`);
});
