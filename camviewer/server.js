// CamViewer backend
//
// Responsibilities:
//   1. Serve the frontend (public/)
//   2. Keep a small JSON file of "cameras" the user has added (name, company, rtsp url,
//      enabled/disabled state, tile layout)
//   3. Whenever a camera is added/removed, tell go2rtc about it via its HTTP API
//      so the browser can actually play the RTSP stream (browsers can't play RTSP directly)
//   4. Proxy exactly one thing from go2rtc: its WebRTC signaling WebSocket. The frontend
//      speaks WebRTC directly (see public/app.js) instead of embedding go2rtc's own player,
//      which gives it full control to fill each tile without black bars, drop the on-video
//      name label, and - importantly - only keep a live connection open for cameras that are
//      actually visible right now, so hidden/off-screen cameras don't chew up bandwidth.
//
// Requires Node.js 18+ (for built-in fetch). Check with: node -v

const express = require('express');
const fs = require('fs');
const path = require('path');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = process.env.PORT || 3000;
// go2rtc's own API - only ever called from this server (loopback), never directly by the browser.
const GO2RTC_API = process.env.GO2RTC_API || 'http://127.0.0.1:1984';
const DATA_FILE = path.join(__dirname, 'config', 'cameras.json');
const LAYOUT_MODE_FILE = path.join(__dirname, 'config', 'layout-mode.json');

// The only thing the browser ever needs from go2rtc directly: WebRTC signaling.
// /go2rtc-ws?src=<id>  ->  ws://127.0.0.1:1984/api/ws?src=<id>
const go2rtcWsProxy = createProxyMiddleware({
  target: GO2RTC_API,
  changeOrigin: true,
  ws: true,
  pathRewrite: { '^/go2rtc-ws': '/api/ws' },
});
app.use('/go2rtc-ws', go2rtcWsProxy);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function loadCameras() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    return [];
  }
}

function saveCameras(cams) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(cams, null, 2));
}

// UniFi Protect's "Share" links look like:
//   rtsps://192.168.1.1:7441/lk0udRKvI5648CYj?enableSrtp
// go2rtc can't consume that exact form - it needs the rtspx:// scheme (its own marker for
// "RTSP over TLS with UniFi's SRTP media encryption") and no ?enableSrtp suffix.
// This lets the user paste the link exactly as UniFi shows it.
function normalizeForGo2rtc(rawUrl) {
  let url = rawUrl.trim();
  if (/^rtsps:\/\//i.test(url)) {
    url = url.replace(/^rtsps:\/\//i, 'rtspx://');
  }
  url = url.replace(/[?&]enableSrtp\b/i, '');
  return url;
}

// Register a stream with go2rtc: PUT /api/streams?src=<rtsp-url>&name=<id>
async function go2rtcAddStream(name, rawSrc) {
  const src = normalizeForGo2rtc(rawSrc);
  const url = `${GO2RTC_API}/api/streams?name=${encodeURIComponent(name)}&src=${encodeURIComponent(src)}`;
  const res = await fetch(url, { method: 'PUT' });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`go2rtc rejected the stream (HTTP ${res.status}): ${body}`);
  }
}

// Remove a stream from go2rtc: DELETE /api/streams?src=<id>
async function go2rtcRemoveStream(name) {
  const url = `${GO2RTC_API}/api/streams?src=${encodeURIComponent(name)}`;
  try {
    await fetch(url, { method: 'DELETE' });
  } catch (e) {
    console.error(`Could not remove ${name} from go2rtc:`, e.message);
  }
}

// On boot, re-register every saved camera with go2rtc (enabled or not - disabling a camera
// just hides its tile in the UI, it doesn't tear down the underlying stream registration).
// This matters because go2rtc's in-memory stream list is separate from our cameras.json,
// so if go2rtc restarts (reboot, crash, service restart) it forgets everything until we tell it again.
async function syncAllCamerasToGo2rtc() {
  const cams = loadCameras();
  for (const cam of cams) {
    try {
      await go2rtcAddStream(cam.id, cam.rtsp);
      console.log(`Registered "${cam.name}" with go2rtc`);
    } catch (e) {
      console.error(`Failed to register "${cam.name}" with go2rtc: ${e.message}`);
    }
  }
}

app.get('/api/cameras', (req, res) => {
  res.json(loadCameras());
});

app.post('/api/cameras', async (req, res) => {
  const { name, company, rtsp } = req.body || {};
  if (!name || !rtsp) {
    return res.status(400).json({ error: 'name and rtsp are required' });
  }
  if (!/^rtsp[sx]?:\/\//i.test(rtsp)) {
    return res.status(400).json({ error: 'Must be an rtsp://, rtsps://, or rtspx:// URL' });
  }

  const id = 'cam_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  try {
    await go2rtcAddStream(id, rtsp);
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }

  const cams = loadCameras();
  // Stagger new tiles a bit so they don't stack exactly on top of each other
  const offset = (cams.length % 6) * 24;
  const camera = {
    id,
    name,
    company: company || '',
    rtsp,
    enabled: true,
    x: 20 + offset,
    y: 20 + offset,
    w: 480,
    h: 270,
    z: cams.length + 1,
  };
  cams.push(camera);
  saveCameras(cams);
  res.json(camera);
});

// Update a tile's position/size/stacking order (called continuously while dragging/resizing)
app.put('/api/cameras/:id/layout', (req, res) => {
  const cams = loadCameras();
  const cam = cams.find((c) => c.id === req.params.id);
  if (!cam) return res.status(404).json({ error: 'not found' });

  const { x, y, w, h, z } = req.body || {};
  if (typeof x === 'number') cam.x = x;
  if (typeof y === 'number') cam.y = y;
  if (typeof w === 'number') cam.w = w;
  if (typeof h === 'number') cam.h = h;
  if (typeof z === 'number') cam.z = z;

  saveCameras(cams);
  res.json(cam);
});

app.put('/api/cameras/:id/rename', (req, res) => {
  const cams = loadCameras();
  const cam = cams.find((c) => c.id === req.params.id);
  if (!cam) return res.status(404).json({ error: 'not found' });
  const { name, company } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  cam.name = name;
  if (typeof company === 'string') cam.company = company;
  saveCameras(cams);
  res.json(cam);
});

// Turn a camera's tile on/off without deleting it (used by the "manage cameras" overview)
app.put('/api/cameras/:id/enabled', (req, res) => {
  const cams = loadCameras();
  const cam = cams.find((c) => c.id === req.params.id);
  if (!cam) return res.status(404).json({ error: 'not found' });
  const { enabled } = req.body || {};
  if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be true/false' });
  cam.enabled = enabled;
  saveCameras(cams);
  res.json(cam);
});

app.delete('/api/cameras/:id', async (req, res) => {
  const cams = loadCameras();
  const idx = cams.findIndex((c) => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  const [removed] = cams.splice(idx, 1);
  saveCameras(cams);
  await go2rtcRemoveStream(removed.id);
  res.json({ ok: true });
});

// The current layout mode: 'free' (drag/resize anywhere) or a number 1-10
// (auto-arranged grid preset). gridOrder is the list of camera ids in the order they
// fill the grid's slots (slot 0 = the layout's first/largest cell, etc) - this is what
// lets you drag a camera into a specific spot (e.g. the big tile) in a preset.
function loadLayoutConfig() {
  try {
    const cfg = JSON.parse(fs.readFileSync(LAYOUT_MODE_FILE, 'utf8'));
    return { mode: cfg.mode || 'free', order: Array.isArray(cfg.order) ? cfg.order : [] };
  } catch (e) {
    return { mode: 'free', order: [] };
  }
}

function saveLayoutConfig(cfg) {
  fs.mkdirSync(path.dirname(LAYOUT_MODE_FILE), { recursive: true });
  fs.writeFileSync(LAYOUT_MODE_FILE, JSON.stringify(cfg));
}

app.get('/api/layout-mode', (req, res) => {
  res.json(loadLayoutConfig());
});

app.put('/api/layout-mode', (req, res) => {
  const { mode } = req.body || {};
  const valid = mode === 'free' || (Number.isInteger(mode) && mode >= 1 && mode <= 10);
  if (!valid) return res.status(400).json({ error: "mode must be 'free' or an integer 1-10" });
  const cfg = loadLayoutConfig();
  cfg.mode = mode;
  saveLayoutConfig(cfg);
  res.json(cfg);
});

app.put('/api/layout-order', (req, res) => {
  const { order } = req.body || {};
  // Each entry is a camera id occupying that slot, or null for an empty slot.
  if (!Array.isArray(order) || !order.every((id) => typeof id === 'string' || id === null)) {
    return res.status(400).json({ error: 'order must be an array of camera ids or null' });
  }
  const cfg = loadLayoutConfig();
  cfg.order = order;
  saveLayoutConfig(cfg);
  res.json(cfg);
});

syncAllCamerasToGo2rtc().finally(() => {
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`CamViewer running -> http://<this-machine-ip>:${PORT}`);
  });
  // WebRTC signaling needs the raw WebSocket upgrade, proxied separately from normal HTTP.
  server.on('upgrade', go2rtcWsProxy.upgrade);
});
