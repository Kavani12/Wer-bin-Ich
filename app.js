// =========================
// Firebase Config
// =========================
const firebaseConfig = {
  apiKey: "AIzaSyC03LUB1LEJYsmdwB9P61j571zIoHMDe0w",
  authDomain: "wer-bin-ich-c30fd.firebaseapp.com",
  databaseURL: "https://wer-bin-ich-c30fd-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "wer-bin-ich-c30fd",
  storageBucket: "wer-bin-ich-c30fd.appspot.com",
  messagingSenderId: "477823647225",
  appId: "1:477823647225:web:4885243f5323e2d3c95128"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// ===== Helpers =====
const $ = (s)=>document.querySelector(s);
const byId = (id)=>document.getElementById(id);
const uid = ()=> Math.random().toString(36).slice(2,10);
const shuffle = (arr)=>{ const a=[...arr]; for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]];} return a; };

let me = { id: uid(), name: "", room: "", isHost: false };
let unsub = [];
let playerMap = {};

const DEFAULT_POOL = [
  "Angela Merkel","Harry Potter","Darth Vader","Spongebob","Sherlock Holmes",
  "Taylor Swift","Batman","Asterix","Geralt von Riva","Mona Lisa","Albert Einstein",
  "Elon Musk","Shrek","Spider-Man","Mario","Luigi","Indiana Jones","Katniss Everdeen"
];

function roomRef(room){ return db.ref(`rooms/${room}`); }
function playersRef(room){ return db.ref(`rooms/${room}/players`); }
function setState(room, patch){ return roomRef(room).update(patch); }
function setPill(text){ byId('roomPill').textContent = text; }
function cleanListeners(){ unsub.forEach(u=>u()); unsub=[]; }

function setupPlayerMap(){
  if(!me.room) return;
  const off = playersRef(me.room).on('value', snap=>{ playerMap = snap.val()||{}; });
  unsub.push(()=>playersRef(me.room).off('value', off));
}
function getPlayerName(id){ return playerMap?.[id]?.name || null; }

// ===== Auth / Room =====
async function hostGame(){
  me.name = byId('playerName').value.trim();
  me.room = (byId('roomId').value.trim() || makeRoomId()).toUpperCase();
  if(!me.name){ return alert('Bitte Namen eingeben.'); }
  me.isHost = true;

  const rRef = roomRef(me.room);
  const now = Date.now();
  await rRef.set({
    createdAt: now, hostId: me.id, state: 'lobby',
    round: 0, targetId: null, pool: DEFAULT_POOL, suggestsLocked: false,
    queue: null, queuePos: null
  });
  await playersRef(me.room).child(me.id).set({ id: me.id, name: me.name, ready:false, joinedAt: now });
  enterLobby();
}

async function joinGame(){
  me.name = byId('playerName').value.trim();
  me.room = byId('roomId').value.trim().toUpperCase();
  if(!me.name || !me.room){ return alert('Name und Raum-ID nötig.'); }
  me.isHost = false;
  const now = Date.now();
  await playersRef(me.room).child(me.id).set({ id: me.id, name: me.name, ready:false, joinedAt: now });
  enterLobby();
}

function makeRoomId(){
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out=''; for(let i=0;i<6;i++) out += chars[Math.floor(Math.random()*chars.length)];
  byId('roomId').value = out; return out;
}

// ===== UI Transitions =====
function show(cardId){
  ['authCard','lobbyCard','phaseSuggest','phaseVote','phaseResult'].forEach(id=> byId(id).style.display='none');
  byId(cardId).style.display='block';
}

function enterLobby(){
  setupPlayerMap();
  setPill(`Raum: ${me.room}`);
  byId('isHostTag').textContent = me.isHost ? 'Du bist Host' : 'Du bist Spieler';
  show('lobbyCard');

  const off1 = playersRef(me.room).on('value', snap => {
    const players = snap.val()||{};
    renderPlayers(players);
    const list = Object.values(players);
    const readyCount = list.filter(p=>p.ready).length;
    byId('readyInfo').textContent = `${readyCount}/${list.length} bereit`;
    byId('btnStart').disabled = !(me.isHost && list.length>=3 && readyCount===list.length);
  });
  unsub.push(()=>playersRef(me.room).off('value', off1));

  const off2 = roomRef(me.room).on('value', snap => {
    const data = snap.val(); if(!data) return;
    if(me.isHost){ byId('pool').value = (data.pool||[]).join('\n'); }
    if(data.state==='suggest') enterSuggestPhase(data);
    else if(data.state==='vote') enterVotePhase(data);
    else if(data.state==='result') enterResultPhase(data);
    else if(data.state==='lobby') show('lobbyCard');
  });
  unsub.push(()=>roomRef(me.room).off('value', off2));
}

function renderPlayers(players){
  const el = byId('players'); el.innerHTML='';
  Object.values(players).sort((a,b)=>a.joinedAt-b.joinedAt).forEach(p=>{
    const div=document.createElement('div');
    div.className='player';
    div.innerHTML = `<div><b>${escapeHtml(p.name)}</b></div>
      <div class="small muted">${p.id===me.id? 'Das bist du' : 'Mitspieler'}</div>
      <div style="margin-top:6px"><span class="badge">${p.ready?'bereit ✔':'wartet…'}</span></div>`;
    el.appendChild(div);
  });
}

function escapeHtml(s){return s.replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));}

// ===== Lobby Actions =====
byId('btnReady').onclick = ()=> playersRef(me.room).child(me.id).update({ready:true});
byId('btnUnready').onclick = ()=> playersRef(me.room).child(me.id).update({ready:false});

// Host startet eine komplette „Session“ (Queue über alle Spieler)
byId('btnStart').onclick = async ()=>{
  if(!me.isHost) return;
  const lines = byId('pool').value.split('\n').map(x=>x.trim()).filter(Boolean);
  const pool = lines.length? lines : DEFAULT_POOL;
  await setState(me.room, { pool });
  await startSession(); // neu: ganze Reihenfolge erstellen
};

// ===== Queue/Session =====
async function startSession(){
  const pSnap = await playersRef(me.room).get();
  const players = Object.values(pSnap.val()||{});
  const readyPlayers = players.filter(p=>p.ready);
  if(readyPlayers.length < 3) return alert('Mindestens 3 Spieler (bereit).');

  // zufällige Reihenfolge der Zielpersonen
  const queue = shuffle(readyPlayers.map(p=>p.id));
  const first = queue[0];

  const updates = {};
  updates[`rooms/${me.room}/round`] = firebase.database.ServerValue.increment(1);
  updates[`rooms/${me.room}/state`] = 'suggest';
  updates[`rooms/${me.room}/targetId`] = first;
  updates[`rooms/${me.room}/queue`] = queue;
  updates[`rooms/${me.room}/queuePos`] = 0;
  updates[`rooms/${me.room}/suggestsLocked`] = false;
  updates[`rooms/${me.room}/suggests`] = null;
  updates[`rooms/${me.room}/votes`] = null;
  await db.ref().update(updates);
}

// ===== Suggest Phase =====
function enterSuggestPhase(data){
  show('phaseSuggest');
  const target = data.targetId;
  const targetName = getPlayerName(target);
  byId('targetNameA').textContent = targetName||'(unbekannt)';

  // Zielperson: sieht KEINE Vorschläge (geheime Liste)
  const sRef = roomRef(me.room).child('suggests');
  const off = sRef.on('value', snap=>{ renderSuggestList(snap.val()||{}, target); });
  unsub.push(()=>sRef.off('value', off));

  // Eingabe/Buttons
  byId('btnSuggest').disabled = false;
  byId('suggestInput').value = '';

  byId('btnSuggest').onclick = async ()=>{
    const val = byId('suggestInput').value.trim();
    if(!val) return alert('Bitte einen Vorschlag eingeben.');
    if(me.id===target) return alert('Die Zielperson darf keinen Vorschlag abgeben.');
    await roomRef(me.room).child('suggests').child(me.id).set({ by: me.id, text: val, at: Date.now() });
    byId('btnSuggest').disabled = true;
  };

  byId('btnLockSuggests').style.display = me.isHost? 'inline-flex':'none';
  byId('btnLockSuggests').onclick = async ()=>{ await setState(me.room, { suggestsLocked: true, state: 'vote' }); };
}

function renderSuggestList(obj, targetId){
  const el = byId('suggestList'); el.innerHTML = '';

  // Wenn ICH die Zielperson bin → keine Liste anzeigen
  if(me.id === targetId){
    el.innerHTML = '<div class="muted small">Du bist die Zielperson – Vorschläge bleiben für dich geheim.</div>';
    return;
  }

  const items = Object.values(obj);
  if(items.length===0){
    el.innerHTML = '<div class="muted small">Noch keine Vorschläge…</div>';
    return;
  }
  items.sort((a,b)=>a.at-b.at).forEach(s=>{
    const div = document.createElement('div');
    div.className='player';
    const byName = getPlayerName(s.by)||'?';
    div.innerHTML = `<div><b>${escapeHtml(s.text)}</b></div><div class="small muted">von ${escapeHtml(byName)}</div>`;
    el.appendChild(div);
  });
}

// ===== Vote Phase =====
function enterVotePhase(data){
  show('phaseVote');
  const target = data.targetId;
  byId('targetNameB').textContent = getPlayerName(target)||'(unbekannt)';
  roomRef(me.room).child('suggests').get().then(snap=>{ renderVoteOptions(snap.val()||{}); });
}

function renderVoteOptions(obj){
  const el = byId('voteOptions'); el.innerHTML='';
  const entries = Object.values(obj);
  if(entries.length===0){
    el.innerHTML = '<div class="muted small">Keine Vorschläge vorhanden.</div>';
    return;
  }

  entries.forEach((s, idx)=>{
    const row = document.createElement('div');
    row.className='vote';
    row.innerHTML = `<div style="flex:1"><b>${escapeHtml(s.text)}</b><div class="small muted">von ${escapeHtml(getPlayerName(s.by)||'?')}</div></div>`;
    const btn = document.createElement('button');
    btn.textContent='Stimme geben';
    btn.onclick = async ()=>{
      await roomRef(me.room).child('votes').child(me.id).set({ choiceIdx: idx, at: Date.now() });
      [...el.querySelectorAll('button')].forEach(b=>b.disabled=true);
    };
    row.appendChild(btn);
    el.appendChild(row);
  });

  const off = playersRef(me.room).on('value', async snap=>{
    const players = Object.values(snap.val()||{});
    const vSnap = await roomRef(me.room).child('votes').get();
    const votes = vSnap.val()||{};
    if(Object.keys(votes).length===players.length){ tallyAndAdvance(entries); }
  });
  unsub.push(()=>playersRef(me.room).off('value', off));
}

// ===== Tally + Auto-Advance =====
async function tallyAndAdvance(entries){
  const vSnap = await roomRef(me.room).child('votes').get();
  const votes = Object.values(vSnap.val()||{});
  const counts = new Array(entries.length).fill(0);
  votes.forEach(v=>{ if(v && Number.isInteger(v.choiceIdx)) counts[v.choiceIdx]++; });
  let winIdx = 0, max=-1;
  counts.forEach((c,i)=>{ if(c>max){ max=c; winIdx=i; } });

  // Ergebnis speichern (für Anzeige), aber danach automatisch weiter
  await setState(me.room, { state:'result', result:{ winnerIdx: winIdx, counts, entries } });
}

function enterResultPhase(data){
  show('phaseResult');
  const res = data.result||{};
  const entries = res.entries||[];
  const win = entries[res.winnerIdx] || { text:'(keiner)', by:'' };
  byId('winnerChar').textContent = win.text;
  byId('targetNameC').textContent = getPlayerName(data.targetId)||'?';
  const breakdown = (res.counts||[]).map((c,i)=>`<div>• ${escapeHtml(entries[i]?.text||'?')} – <b>${c}</b> Stimmen</div>`).join('');
  byId('voteBreakdown').innerHTML = breakdown;

  // Buttons
  byId('btnNextRound').onclick = ()=> advanceNextTarget();
  byId('btnBackLobby').onclick = ()=> setState(me.room, { state:'lobby' });

  // Auto-Weiter nach 2.5s (nur Host steuert)
  if(me.isHost){
    setTimeout(()=>advanceNextTarget(), 2500);
  }
}

async function advanceNextTarget(){
  const snap = await roomRef(me.room).get();
  const data = snap.val()||{};
  const queue = data.queue||[];
  const pos = Number.isInteger(data.queuePos) ? data.queuePos : 0;

  // nächster?
  if(pos+1 < queue.length){
    const nextId = queue[pos+1];
    const updates = {};
    updates[`rooms/${me.room}/state`] = 'suggest';
    updates[`rooms/${me.room}/targetId`] = nextId;
    updates[`rooms/${me.room}/queuePos`] = pos+1;
    updates[`rooms/${me.room}/suggestsLocked`] = false;
    updates[`rooms/${me.room}/suggests`] = null;
    updates[`rooms/${me.room}/votes`] = null;
    await db.ref().update(updates);
  } else {
    // fertig: zurück zur Lobby / neue Session möglich
    await setState(me.room, { state:'lobby', targetId:null, queue:null, queuePos:null, result:null, suggests:null, votes:null, suggestsLocked:false });
  }
}

// ===== Wire =====
byId('btnHost').onclick = hostGame;
byId('btnJoin').onclick = joinGame;
window.addEventListener('error', (e)=>{ console.warn('JS Error:', e.message); });
