// Cards: swipe true/false quiz. Questions and mistakes live in a private GitHub repo;
// this code holds no secrets. The key is pasted once and kept only in this browser.
"use strict";
const ROUND = 20;                       // cards per round
const $ = id => document.getElementById(id);

// ---------- storage (always wrapped: private windows can block it) ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

// ---------- GitHub ----------
const gh = (path, opts = {}) => {
  const s = store.get("setup");
  return fetch(`https://api.github.com/repos/${s.repo}/contents/${path}`, {
    ...opts, headers: { Authorization: `Bearer ${s.token}`, Accept: "application/vnd.github+json", ...(opts.headers || {}) },
  });
};
const b64 = str => { let bin = ""; for (const b of new TextEncoder().encode(str)) bin += String.fromCharCode(b); return btoa(bin); };

let testMode = false, lastError = "";                   // true when questions.json sits next to the page (laptop testing only)

async function loadQuestions() {
  if (store.get("setup")) {
    try {
      const r = await gh("questions.json", { headers: { Accept: "application/vnd.github.raw+json" } });
      if (!r.ok) throw new Error(r.status === 401 ? "401: the key is wrong or expired" :
        r.status === 404 ? "404: the key can't see this repo (check repo name, and that the key has cards-data + Contents)" : "error " + r.status);
      const qs = await r.json(); store.set("questions", qs); return qs;
    } catch (e) { lastError = e.message; const c = store.get("questions"); if (c) return c; throw e; }
  }
  const r = await fetch("questions.json", { cache: "no-store" });
  if (!r.ok) return null;
  testMode = true; return r.json();
}

async function uploadPending() {
  const pend = store.get("pending", []);
  if (!pend.length || testMode || !store.get("setup")) return pend.length;
  const left = [];
  for (const rec of pend) {
    try {
      const r = await gh(`mistakes/${rec.type || "round"}-${rec.stamp}.json`, { method: "PUT",
        body: JSON.stringify({ message: `round ${rec.stamp}`, content: b64(JSON.stringify(rec, null, 1)) }) });
      if (!r.ok && r.status !== 422) left.push(rec);      // 422 = already uploaded
    } catch { left.push(rec); }
  }
  store.set("pending", left); return left.length;
}

// ---------- picking a round: rank-weighted, no repeats ----------
function pickRound(qs) {
  const pool = qs.map(q => ({ q, w: (q.rank || 1) * (q.boost ? 1.5 : 1) }));
  const out = [];
  while (out.length < Math.min(ROUND, qs.length)) {
    let r = Math.random() * pool.reduce((s, p) => s + p.w, 0);
    const i = pool.findIndex(p => (r -= p.w) <= 0);
    out.push(pool.splice(i < 0 ? pool.length - 1 : i, 1)[0].q);
  }
  return out;
}

// ---------- tiny markdown: **bold** and "- " bullets ----------
const esc = s => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function md(text) {
  const lines = esc(text).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\*(.+?)\*/g, "<i>$1</i>").split("\n");
  let html = "", inList = false;
  for (const l of lines) {
    if (l.startsWith("- ")) { if (!inList) { html += "<ul>"; inList = true; } html += `<li>${l.slice(2)}</li>`; }
    else { if (inList) { html += "</ul>"; inList = false; } if (l.trim()) html += `<p>${l}</p>`; }
  }
  return html + (inList ? "</ul>" : "");
}

// ---------- screens ----------
const show = id => { ["setup", "home", "play", "end"].forEach(s => $(s).hidden = s !== id); window.scrollTo(0, 0); };
let questions = [], round = [], idx = 0, phase = "q", answers = [];

async function home() {
  show("home");
  $("homeInfo").textContent = "Loading…";
  try { questions = await loadQuestions(); } catch { questions = null; }
  if (!questions) { if (!store.get("setup")) return show("setup"); $("homeInfo").textContent = "Couldn't load questions. " + (lastError || "No internet?"); return; }
  const fams = [...new Set(questions.map(q => q.family))];
  $("homeInfo").textContent = `${questions.length} cards · ${fams.join(" · ")}` + (testMode ? " · test mode (nothing is saved)" : "");
  $("forget").hidden = testMode;
  const later = store.get("later", []).length;
  $("explainLater").hidden = !later;
  $("explainLater").textContent = `✍️ Explain ${later} mistake${later === 1 ? "" : "s"} saved for later`;
  const left = await uploadPending();
  $("pending").textContent = left ? `${left} round(s) waiting to upload — will retry next time.` : "";
}

function start() { round = pickRound(questions); idx = 0; answers = []; show("play"); render(); }

function render() {
  const q = round[idx]; phase = "q";
  $("progress").textContent = `${idx + 1} / ${round.length}`;
  $("family").textContent = q.family;
  $("statement").textContent = q.statement;
  $("result").hidden = true; $("why").hidden = true;
  $("hint").textContent = "← false · true →";
  resetCard();
}

function answer(said) {
  const q = round[idx], right = said === q.answer;
  answers.push({ q, said, right }); phase = "a";
  const r = $("result");
  r.hidden = false; r.className = "result " + (right ? "ok" : "bad");
  r.textContent = (right ? "✓ Right" : "✗ Wrong") + ` — it's ${q.answer ? "TRUE" : "FALSE"}`;
  $("hint").textContent = "↑ why · ↓ thumb slip · swipe sideways for next";
}

function showWhy() {
  const q = round[idx];
  $("why").innerHTML = (q.hack ? `<p><b>Hack:</b> ${esc(q.hack).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")}</p>` : "") + md(q.reality) +
    `<p class="muted small">From: ${esc(q.source)}</p>`;
  $("why").hidden = false;
}

function next() { dragging = false; idx++; if (idx < round.length) render(); else end(); }

// thumb slip: drop this answer and send the card to the end of the round, once per card
function slip() {
  const q = round[idx];
  if (q._slipped) { $("hint").textContent = "Already re-asked once · swipe sideways for next"; return; }
  answers.pop();
  round.push({ ...q, _slipped: true });
  $("hint").textContent = "Slip noted: it comes back at the end";
  setTimeout(next, 600);
}

// ---------- explaining mistakes: one card at a time, or "later" ----------
// later pile = mistakes saved without a reason; explained from the home screen any time
function explain(queue, onDone) {
  show("end");
  let i = 0; const done = [];
  const draw = () => {
    if (i >= queue.length) return onDone(done);
    const m = queue[i];
    $("explainCount").textContent = `Mistake ${i + 1} of ${queue.length}` + (i ? " · swipe ↓ to go back" : "");
    $("exFamily").textContent = m.family;
    $("exStatement").textContent = m.statement;
    $("exAnswer").textContent = `You said ${m.said ? "TRUE" : "FALSE"} · it's ${m.correct ? "TRUE" : "FALSE"}`;
    $("exWhy").value = done[i] ? done[i].why : "";                  // coming back: show what was written
  };
  const put = item => { done[i] = item; i++; draw(); };
  // an empty "save & next" counts as "later": nothing is lost
  $("nextOne").onclick = () => { const why = $("exWhy").value.trim(); put({ ...queue[i], why, later: !why }); };
  $("laterOne").onclick = () => put({ ...queue[i], why: "", later: true });
  $("backOne").onclick = () => { if (i > 0) { i--; draw(); } };
  $("allLater").onclick = () => { while (i < queue.length) { done[i] = done[i] && done[i].why ? done[i] : { ...queue[i], why: "", later: true }; i++; } draw(); };
  $("explainCard").hidden = false; $("allLater").hidden = false; $("saveMsg").textContent = "";
  draw();
}

async function save(rec, laterItems) {
  $("explainCard").hidden = true; $("allLater").hidden = true; $("explainCount").textContent = "";
  store.set("later", [...store.get("later", []), ...laterItems]);   // kept even in test mode, so "later" can be tried
  if (testMode) { console.log(rec); $("saveMsg").textContent = "Test mode: not uploaded (see console)."; setTimeout(home, 1500); return; }
  store.set("pending", [...store.get("pending", []), rec]);
  $("saveMsg").textContent = "Saving…";
  const left = await uploadPending();
  $("saveMsg").textContent = left ? "Saved on the phone; will upload when online." : "Saved ✓";
  setTimeout(home, 1000);
}

const stampNow = () => new Date().toISOString().slice(0, 16).replace(":", "-");

function end() {
  const wrong = answers.filter(a => !a.right);
  const score = `${answers.length - wrong.length} / ${answers.length}`;
  $("score").textContent = score;
  const stamp = stampNow();
  const queue = wrong.map(a => ({ round: stamp, id: a.q.id, family: a.q.family, statement: a.q.statement,
    correct: a.q.answer, said: a.said, source: a.q.source }));
  const finish = done => save({ stamp, type: "round", score: score.replace(/ /g, ""), mistakes: done },
    done.filter(d => d.later));
  if (!queue.length) { show("end"); $("score").textContent = score + " · no mistakes"; return save({ stamp, type: "round", score, mistakes: [] }, []); }
  explain(queue, finish);
}

function explainLaterPile() {
  const pile = store.get("later", []);
  $("score").textContent = "Explain later";
  explain(pile, done => {
    const filled = done.filter(d => !d.later);
    store.set("later", done.filter(d => d.later));                    // still-later ones stay in the pile
    if (!filled.length) return home();
    const rec = { stamp: stampNow(), type: "explanations", items: filled.map(d => ({ round: d.round, id: d.id, why: d.why })) };
    if (testMode) { console.log(rec); return home(); }
    store.set("pending", [...store.get("pending", []), rec]);
    uploadPending().then(home);
  });
}

// ---------- gestures ----------
const card = $("card");
let sx = 0, sy = 0, dx = 0, dy = 0, dragging = false, lastPointer = null;
const TH = 80;
function resetCard() { card.classList.add("snap"); card.style.transform = ""; card.classList.remove("tilt-true", "tilt-false"); }
card.addEventListener("pointerdown", e => { dragging = true; sx = e.clientX; sy = e.clientY; dx = dy = 0; card.classList.remove("snap"); lastPointer = e.pointerId; card.setPointerCapture(e.pointerId); });
card.addEventListener("pointermove", e => {
  if (!dragging) return;
  dx = e.clientX - sx; dy = e.clientY - sy;
  if (Math.abs(dx) > Math.abs(dy)) {
    card.style.transform = `translateX(${dx}px) rotate(${dx / 20}deg)`;
    if (phase === "q") { card.classList.toggle("tilt-true", dx > TH); card.classList.toggle("tilt-false", dx < -TH); }
  }
});
function release() {
  if (!dragging) return; dragging = false;
  const horiz = Math.abs(dx) > Math.abs(dy);
  try { card.releasePointerCapture(lastPointer); } catch {}
  if (horiz && Math.abs(dx) > TH) {
    if (phase === "q") { resetCard(); answer(dx > 0); }
    else next();
  } else if (!horiz && dy < -TH && phase === "a") { resetCard(); showWhy(); }
  else if (!horiz && dy > TH && phase === "a") { resetCard(); slip(); }
  else resetCard();
}
card.addEventListener("pointerup", release);
card.addEventListener("pointercancel", release);
document.addEventListener("keydown", e => {            // laptop testing
  if ($("play").hidden) return;
  if (e.key === "ArrowRight" || e.key === "ArrowLeft") phase === "q" ? answer(e.key === "ArrowRight") : next();
  if (e.key === "ArrowUp" && phase === "a") showWhy();
  if (e.key === "ArrowDown" && phase === "a") slip();
});

// ---------- gestures on the explain card: → save & next, ← later ----------
// a swipe that starts inside the text box is ignored, so typing and selecting text still work
const ex = $("explainCard");
let ex0 = null;
ex.addEventListener("pointerdown", e => {
  if (e.target.closest("textarea, button")) return;
  ex0 = { x: e.clientX, y: e.clientY, id: e.pointerId }; ex.classList.remove("snap"); ex.setPointerCapture(e.pointerId);
});
ex.addEventListener("pointermove", e => {
  if (!ex0) return;
  const d = e.clientX - ex0.x;
  if (Math.abs(d) > Math.abs(e.clientY - ex0.y)) {
    ex.style.transform = `translateX(${d}px) rotate(${d / 25}deg)`;
    ex.classList.toggle("tilt-true", d > TH); ex.classList.toggle("tilt-later", d < -TH);
  }
});
function exRelease(e) {
  if (!ex0) return;
  const d = e.clientX - ex0.x, down = e.clientY - ex0.y, horiz = Math.abs(d) > Math.abs(down);
  try { ex.releasePointerCapture(ex0.id); } catch {}
  ex0 = null; ex.classList.add("snap"); ex.style.transform = ""; ex.classList.remove("tilt-true", "tilt-later");
  if (horiz && d > TH) $("nextOne").click();
  else if (horiz && d < -TH) $("laterOne").click();
  else if (!horiz && down > TH) $("backOne").click();
}
ex.addEventListener("pointerup", exRelease);
ex.addEventListener("pointercancel", exRelease);

// ---------- setup ----------
$("saveSetup").onclick = () => {
  const repo = $("repo").value.trim(), token = $("token").value.trim();
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !token) { alert("Enter repo as owner/name and the key."); return; }
  store.set("setup", { repo, token }); home();
};
$("forget").onclick = () => { if (confirm("Remove the key from this phone?")) { store.del("setup"); store.del("questions"); show("setup"); } };
$("start").onclick = start;
$("explainLater").onclick = explainLaterPile;

if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js");
home();
