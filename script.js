// Downloads random data from Cloudflare's free speed-test endpoint (no key, no account).
// Data is only counted and thrown away.
// Two ways to run:
//  1) Cool / Normal / Max: screen stays on (can be fully black). Speed limit, rest breaks, auto streams.
//  2) Background: Android Chrome only. Keeps going with the screen off or the app closed.
//     Chrome controls the speed (no limit, no breaks) and shows its own download notification.
const URL_BASE = "https://speed.cloudflare.com/__down?bytes=25000000";
const PROFILES = {                       // mbit = speed limit (0 = none), on/rest in seconds
  cool:   { mbit: 20, on: 120, rest: 60 },
  normal: { mbit: 50, on: 180, rest: 60 },
  max:    { mbit: 0,  on: 120, rest: 120 }
};
const MAX_GB = 50, MAX_BG_GB = 5;        // background mode keeps the data on disk until the end, so it is capped
const GB = 1e9, CIRC = 553, MAX_STREAMS = 4, BLACK_AFTER_MS = 8000;
const BG_ID = "data-eater", CHUNK_BG = 100e6;
const $ = id => document.getElementById(id);

let running = false, bgMode = false, bgReg = null, phase = "on", total = 0, target = 0, profile = PROFILES.cool;
let startTime = 0, activeMs = 0, phaseMs = 0, winMs = 0, lastBytes = 0, lastRate = 0, lastTick = 0;
let streams = 0, noMore = false, controllers = [], wakeLock = null, ticker = null, blackTimer = null;

const sleep = ms => new Promise(r => setTimeout(r, ms));
function clock(s) { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }
function setStatus(t, on) { $("status").textContent = t; $("status").className = "pill" + (on ? " on" : ""); }
function setRunningUI(on) { $("go").textContent = on ? "Stop" : "Start"; $("go").className = on ? "stop" : ""; }

/* ---------- screen-on mode: download workers ---------- */
async function worker() {
  while (running) {
    if (phase !== "on") { await sleep(300); continue; }
    const c = new AbortController();
    controllers.push(c);
    try {
      const r = await fetch(URL_BASE + "&r=" + Math.random(), { cache: "no-store", signal: c.signal });
      const reader = r.body.getReader();
      while (running && phase === "on") {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;                       // chunk is discarded right away
        if (total >= target) { finish("Target reached"); return; }
        if (profile.mbit) {                          // speed limit: wait if we are ahead of schedule
          const bps = profile.mbit * 125000;
          const ahead = total - bps * (activeMs / 1000 + 0.5);
          if (ahead > 0) await sleep(ahead / bps * 1000);
        }
      }
      reader.cancel().catch(() => {});
    } catch (e) {
      if (!running) return;
      if (phase === "on") { setStatus("Retrying...", true); await sleep(1500); }
    }
  }
}

function addWorker() { streams++; worker(); }

// Automatic streams: add one only if the speed keeps improving and the limit is not reached yet.
function checkStreams() {
  const rate = (total - lastBytes) / (winMs / 1000);
  lastBytes = total; winMs = 0;
  if (!noMore) {
    if (streams > 1 && rate < lastRate * 1.15) noMore = true;
    else if (streams < MAX_STREAMS && (!profile.mbit || rate < profile.mbit * 125000 * 0.85)) addWorker();
  }
  lastRate = rate;
}

/* ---------- ticker: clock, rest cycles, UI ---------- */
function tick() {
  if (bgMode) { draw(); return; }
  const now = Date.now(), dt = now - lastTick; lastTick = now;
  phaseMs += dt;
  if (phase === "on") {
    activeMs += dt; winMs += dt;
    if (winMs >= 4000) checkStreams();
    if (phaseMs >= profile.on * 1000) {
      phase = "rest"; phaseMs = 0;
      controllers.forEach(c => c.abort()); controllers = [];
    }
  } else if (phaseMs >= profile.rest * 1000) {
    phase = "on"; phaseMs = 0; winMs = 0; lastBytes = total;
  }
  draw();
}

function draw() {
  const secs = (Date.now() - startTime) / 1000;
  const rate = bgMode ? total / (secs || 1) : (activeMs > 0 ? total / (activeMs / 1000) : 0);   // bytes/s
  let eta = "-";
  if (running && rate > 0) {
    const act = (target - total) / rate;
    eta = clock(bgMode ? act : act + Math.floor(act / profile.on) * profile.rest);
  }
  $("total").textContent = (total / GB).toFixed(2);
  $("ring").style.strokeDashoffset = CIRC * (1 - Math.min(1, total / (target || 1)));
  $("speed").textContent = phase === "on" ? (rate * 8 / 1e6).toFixed(1) : "0.0";
  $("time").textContent = clock(secs);
  $("left").textContent = eta;
  if (running) {
    if (bgMode) setStatus("Downloading (background ok)", true);
    else setStatus(phase === "on" ? "Downloading" : "Resting " + clock(profile.rest - phaseMs / 1000), phase === "on");
  }
  $("bt").textContent = (total / GB).toFixed(2) + " / " + (target / GB).toFixed(2) + " GB" + (phase === "rest" ? " - rest" : "");
}

/* ---------- black screen ---------- */
function showBlack() { if (running && !bgMode) $("black").hidden = false; }
function hideBlack() { $("black").hidden = true; }
$("black").onclick = hideBlack;

/* ---------- notifications ---------- */
async function notify(text) {
  try {
    if (Notification.permission !== "granted") return;
    const reg = await navigator.serviceWorker.ready;
    reg.showNotification("Data Eater", { body: text, icon: "icon-192.png", badge: "icon-192.png", tag: "data-eater" });
  } catch (e) {}
}

/* ---------- background mode (Android Chrome) ---------- */
function attachBg(r) {
  bgMode = true; bgReg = r; running = true; phase = "on";
  target = r.downloadTotal || target;
  setRunningUI(true);
  clearInterval(ticker); ticker = setInterval(tick, 1000);
  r.addEventListener("progress", () => {
    total = r.downloaded;
    if (r.result) endBg(r.result === "success" ? "Target reached" : "Stopped"); else draw();
  });
  draw();
}

function endBg(msg) {
  bgMode = false; bgReg = null; running = false; phase = "on";
  clearInterval(ticker); setRunningUI(false); draw(); setStatus(msg, false);
}

async function startBg(g) {
  let reg = null;
  try { reg = await navigator.serviceWorker.ready; } catch (e) {}
  if (!reg || !reg.backgroundFetch) { setStatus("Needs Chrome on Android", false); return; }
  const n = Math.ceil(g * GB / CHUNK_BG);
  target = n * CHUNK_BG; total = 0; startTime = Date.now();
  try { localStorage.setItem("de-start", startTime); } catch (e) {}
  const urls = [];
  for (let i = 0; i < n; i++) urls.push("https://speed.cloudflare.com/__down?bytes=" + CHUNK_BG + "&r=" + Math.random() + "-" + i);
  try {
    const r = await reg.backgroundFetch.fetch(BG_ID, urls, {
      title: "Data Eater",
      icons: [{ src: "icon-192.png", sizes: "192x192", type: "image/png" }],
      downloadTotal: target
    });
    attachBg(r);
  } catch (e) { setStatus("Could not start (" + (e.name || "error") + ")", false); }
}

async function resyncBg() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const r = await reg.backgroundFetch.get(BG_ID);
    if (!r) endBg("Finished while away");
    else if (r.result) endBg(r.result === "success" ? "Target reached" : "Stopped");
    else { total = r.downloaded; draw(); }
  } catch (e) {}
}

// If the app is reopened while a background download is still running, reconnect to it.
async function resume() {
  try {
    const reg = await navigator.serviceWorker.ready;
    if (!reg.backgroundFetch) return;
    const r = await reg.backgroundFetch.get(BG_ID);
    if (r && !r.result) {
      startTime = parseInt(localStorage.getItem("de-start")) || Date.now();
      total = r.downloaded; attachBg(r);
    }
  } catch (e) {}
}

/* ---------- start / stop ---------- */
async function start() {
  const m = $("mode").value, isBg = m === "bg";
  let g = parseFloat($("target").value);
  if (!(g > 0)) { setStatus("Enter a target", false); return; }
  const cap = isBg ? MAX_BG_GB : MAX_GB;
  g = Math.min(g, cap); $("target").value = g;

  let msg = "Download " + g + " GB now?";
  if (isBg) msg += "\n\nIt keeps going with the screen off. Needs " + g + " GB of free space until it finishes (then it is deleted).";
  const net = navigator.connection && navigator.connection.type;
  if (net === "wifi") msg += "\n\nYou seem to be on Wi-Fi, not mobile data.";
  if (!confirm(msg)) return;

  try { if ("Notification" in window && Notification.permission === "default") await Notification.requestPermission(); } catch (e) {}

  if (isBg) { await startBg(g); return; }

  profile = PROFILES[m];
  total = 0; target = g * GB; startTime = lastTick = Date.now();
  activeMs = phaseMs = winMs = lastBytes = lastRate = 0; streams = 0; noMore = false; phase = "on";
  running = true; setRunningUI(true);
  try { wakeLock = await navigator.wakeLock.request("screen"); } catch (e) {}
  addWorker();
  ticker = setInterval(tick, 500);
  if ($("auto").checked) blackTimer = setTimeout(showBlack, BLACK_AFTER_MS);
}

function halt() {
  running = false; clearInterval(ticker); clearTimeout(blackTimer);
  controllers.forEach(c => c.abort()); controllers = [];
  if (wakeLock) { wakeLock.release(); wakeLock = null; }
  hideBlack(); setRunningUI(false);
}

function finish(msg) {
  halt(); phase = "on"; draw(); setStatus(msg, false);
  notify(msg === "Target reached" ? "Done: " + (total / GB).toFixed(2) + " GB downloaded" : msg + " at " + (total / GB).toFixed(2) + " GB");
}

function stopBg() { if (bgReg) bgReg.abort(); endBg("Stopped"); }

$("go").onclick = () => running ? (bgMode ? stopBg() : finish("Stopped")) : start();

// Screen-on modes: if the page is hidden the browser freezes it, so stop cleanly.
// Background mode keeps going on purpose and just re-syncs when you come back.
document.addEventListener("visibilitychange", () => {
  if (!running) return;
  if (!bgMode && document.visibilityState === "hidden") finish("Stopped (screen turned off)");
  if (bgMode && document.visibilityState === "visible") resyncBg();
});
window.addEventListener("pagehide", () => { if (running && !bgMode) halt(); });

if ("serviceWorker" in navigator) navigator.serviceWorker.register("service-worker.js").then(resume);
