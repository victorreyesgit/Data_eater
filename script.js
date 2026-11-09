// Downloads random data from Cloudflare's free speed-test endpoint (no key, no account).
// Data is only counted and thrown away: nothing is stored on the phone.
const URL_BASE = "https://speed.cloudflare.com/__down?bytes=25000000";
const MAX_GB = 50;           // hard safety cap
const GB = 1e9;              // carriers count decimal GB
const CIRC = 553;            // ring circumference (2 * pi * 88)
const $ = id => document.getElementById(id);
let running = false, total = 0, target = 0, startTime = 0, wakeLock = null, controllers = [];

function clock(s) { s = Math.round(s); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }

function setStatus(text, on) {
  $("status").textContent = text;
  $("status").className = "pill" + (on ? " on" : "");
}

function update() {
  const secs = (Date.now() - startTime) / 1000 || 1;
  const rate = total / secs;                         // bytes per second
  $("total").textContent = (total / GB).toFixed(2);
  $("ring").style.strokeDashoffset = CIRC * (1 - Math.min(1, total / target));
  $("speed").textContent = (rate * 8 / 1e6).toFixed(1);
  $("time").textContent = clock(secs);
  $("left").textContent = running && rate > 0 ? clock((target - total) / rate) : "-";
}

async function worker() {
  while (running) {
    const c = new AbortController();
    controllers.push(c);
    try {
      const r = await fetch(URL_BASE + "&r=" + Math.random(), { cache: "no-store", signal: c.signal });
      const reader = r.body.getReader();
      while (running) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;     // chunk is discarded right after counting
        update();
        if (total >= target) { stop("Target reached"); return; }
      }
    } catch (e) {
      if (!running) return;
      setStatus("Retrying...", true);
      await new Promise(r => setTimeout(r, 1500));
      if (running) setStatus("Downloading", true);
    }
  }
}

async function start() {
  let g = parseFloat($("target").value);
  if (!(g > 0)) { setStatus("Enter a target", false); return; }
  g = Math.min(g, MAX_GB);
  $("target").value = g;

  const net = navigator.connection && navigator.connection.type;
  let msg = "Download " + g + " GB now?";
  if (net === "wifi") msg += "\n\nYou seem to be on Wi-Fi, not mobile data.";
  if (!confirm(msg)) return;

  target = g * GB; total = 0; startTime = Date.now(); running = true;
  $("go").textContent = "Stop"; $("go").className = "stop";
  setStatus("Downloading", true);
  try { wakeLock = await navigator.wakeLock.request("screen"); } catch (e) {}
  for (let i = 0; i < parseInt($("streams").value); i++) worker();
}

function stop(msg) {
  running = false;
  controllers.forEach(c => c.abort()); controllers = [];
  if (wakeLock) { wakeLock.release(); wakeLock = null; }
  $("go").textContent = "Start"; $("go").className = "";
  update();
  setStatus(msg || "Stopped", false);
}

$("go").onclick = () => running ? stop() : start();

// Safety: leaving the app or locking the screen stops everything. Nothing resumes by itself.
document.addEventListener("visibilitychange", () => {
  if (running && document.visibilityState === "hidden") stop("Stopped (app left screen)");
});
window.addEventListener("pagehide", () => { if (running) stop(); });

if ("serviceWorker" in navigator) navigator.serviceWorker.register("service-worker.js");
