// Downloads random data from Cloudflare's free speed-test endpoint (no key, no account).
// Data is only counted and thrown away: nothing is stored on the phone.
//  - Android Chrome: uses Background Fetch, so it keeps going with the screen off
//    and the service worker shows a notification when it finishes.
//  - Other browsers (iPhone, Firefox): foreground mode, screen must stay on.
const BASE = "https://speed.cloudflare.com/__down?bytes=";
const CHUNK_FG = 25e6, CHUNK_BG = 100e6;
const MAX_GB = 50;           // hard safety cap
const GB = 1e9;              // carriers count decimal GB
const CIRC = 553;            // ring circumference (2 * pi * 88)
const BG_ID = "data-eater";
const $ = id => document.getElementById(id);
let running = false, mode = "fg", total = 0, target = 0, startTime = 0;
let wakeLock = null, controllers = [], bgReg = null;

function clock(s) { s = Math.round(s); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }
function setStatus(text, on) { $("status").textContent = text; $("status").className = "pill" + (on ? " on" : ""); }

function update() {
  const secs = (Date.now() - startTime) / 1000 || 1;
  const rate = total / secs;
  $("total").textContent = (total / GB).toFixed(2);
  $("ring").style.strokeDashoffset = CIRC * (1 - Math.min(1, total / (target || 1)));
  $("speed").textContent = (rate * 8 / 1e6).toFixed(1);
  $("time").textContent = clock(secs);
  $("left").textContent = running && rate > 0 ? clock((target - total) / rate) : "-";
}

function setRunningUI(on) {
  $("go").textContent = on ? "Stop" : "Start";
  $("go").className = on ? "stop" : "";
}

async function notifyDone(text) {
  try {
    if (Notification.permission !== "granted") return;
    const reg = await navigator.serviceWorker.ready;
    reg.showNotification("Data Eater", { body: text, icon: "icon-192.png", badge: "icon-192.png", tag: "data-eater" });
  } catch (e) {}
}

/* ---------- foreground mode ---------- */
async function worker() {
  while (running) {
    const c = new AbortController();
    controllers.push(c);
    try {
      const r = await fetch(BASE + CHUNK_FG + "&r=" + Math.random(), { cache: "no-store", signal: c.signal });
      const reader = r.body.getReader();
      while (running) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;     // chunk is discarded right after counting
        update();
        if (total >= target) { stopFg("Target reached"); return; }
      }
    } catch (e) {
      if (!running) return;
      setStatus("Retrying...", true);
      await new Promise(r => setTimeout(r, 1500));
      if (running) setStatus("Downloading", true);
    }
  }
}

async function startFg() {
  mode = "fg"; running = true;
  setRunningUI(true); setStatus("Downloading", true);
  try { wakeLock = await navigator.wakeLock.request("screen"); } catch (e) {}
  for (let i = 0; i < parseInt($("streams").value); i++) worker();
}

function stopFg(msg) {
  running = false;
  controllers.forEach(c => c.abort()); controllers = [];
  if (wakeLock) { wakeLock.release(); wakeLock = null; }
  setRunningUI(false); update();
  setStatus(msg || "Stopped", false);
  if (msg === "Target reached") notifyDone("Done: " + (total / GB).toFixed(2) + " GB downloaded");
}

/* ---------- background mode (Android Chrome) ---------- */
function attachBg(r) {
  bgReg = r; mode = "bg"; running = true;
  target = r.downloadTotal || target;
  setRunningUI(true); setStatus("Downloading (background ok)", true);
  r.addEventListener("progress", () => {
    total = r.downloaded; update();
    if (r.result) endBg(r.result === "success" ? "Target reached" : "Stopped");
  });
}

function endBg(msg) {
  running = false; bgReg = null;
  setRunningUI(false); update();
  setStatus(msg, false);
}

async function startBg(reg) {
  const n = Math.ceil(target / CHUNK_BG);
  target = n * CHUNK_BG;                       // rounded up to 0.1 GB steps
  const urls = [];
  for (let i = 0; i < n; i++) urls.push(BASE + CHUNK_BG + "&r=" + Math.random() + "-" + i);
  const r = await reg.backgroundFetch.fetch(BG_ID, urls, {
    title: "Data Eater",
    icons: [{ src: "icon-192.png", sizes: "192x192", type: "image/png" }],
    downloadTotal: target
  });
  attachBg(r);
}

/* ---------- start / stop ---------- */
async function start() {
  let g = parseFloat($("target").value);
  if (!(g > 0)) { setStatus("Enter a target", false); return; }
  g = Math.min(g, MAX_GB);
  $("target").value = g;

  const net = navigator.connection && navigator.connection.type;
  let msg = "Download " + g + " GB now?";
  if (net === "wifi") msg += "\n\nYou seem to be on Wi-Fi, not mobile data.";
  if (!confirm(msg)) return;

  try { if ("Notification" in window && Notification.permission === "default") await Notification.requestPermission(); } catch (e) {}

  target = g * GB; total = 0; startTime = Date.now();
  try { localStorage.setItem("de-start", startTime); } catch (e) {}

  let reg = null;
  try { reg = await navigator.serviceWorker.ready; } catch (e) {}
  if (reg && reg.backgroundFetch) {
    try { await startBg(reg); return; }
    catch (e) { setStatus("Background failed, using screen-on mode", false); }
  }
  startFg();
}

function stop() {
  if (mode === "bg" && bgReg) { bgReg.abort(); endBg("Stopped"); }
  else stopFg();
}

$("go").onclick = () => running ? stop() : start();

// Foreground mode: leaving the app stops everything. Background mode keeps going on purpose.
document.addEventListener("visibilitychange", async () => {
  if (!running) return;
  if (mode === "fg" && document.visibilityState === "hidden") stopFg("Stopped (app left screen)");
  if (mode === "bg" && document.visibilityState === "visible") {
    const reg = await navigator.serviceWorker.ready;
    const r = await reg.backgroundFetch.get(BG_ID);
    if (!r) endBg("Finished while away");
    else if (r.result) endBg(r.result === "success" ? "Target reached" : "Stopped");
    else { total = r.downloaded; update(); }
  }
});
window.addEventListener("pagehide", () => { if (running && mode === "fg") stopFg(); });

// If the app is reopened while a background download is still running, reconnect to it.
async function resume() {
  try {
    const reg = await navigator.serviceWorker.ready;
    if (!reg.backgroundFetch) return;
    const r = await reg.backgroundFetch.get(BG_ID);
    if (r && !r.result) {
      startTime = parseInt(localStorage.getItem("de-start")) || Date.now();
      total = r.downloaded; attachBg(r); update();
    }
  } catch (e) {}
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("service-worker.js").then(resume);
}
