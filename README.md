# CamViewer

A self-hosted, low-latency live view for RTSP cameras - built for UniFi Protect,
but works with any camera that exposes an RTSP/RTSPS stream. Add cameras through
a web page, arrange them into UniFi-style grid layouts (or drag/resize them
freely), and only the cameras you're actually looking at stay connected.

Runs on a Raspberry Pi, a small home server, or any Linux box on your network.
No cloud account, no subscription - everything stays on your own LAN.

## Features

- **Add cameras through the browser** - paste a UniFi Protect RTSP(S) share
  link and go; no config files to hand-edit.
- **UniFi-style grid presets (1-10 cameras)** - the same asymmetric "big tile
  + smaller ones" layouts UniFi Protect's own dashboard uses, filling the
  screen edge-to-edge.
- **Drag-and-drop** - in a grid preset, drag one camera onto another to swap
  their slots (e.g. put your main camera in the big tile). Or switch to Free
  mode and position/resize tiles anywhere you like.
- **Low-latency WebRTC playback** with automatic reconnection - no
  transcoding, no page refresh needed if a connection drops.
- **Bandwidth-aware** - only cameras currently visible on screen stay
  connected. Add 10 cameras but only look at 4 at a time, and only those 4
  are ever actually streaming.
- **Manage cameras panel** - toggle any camera on/off without deleting it,
  and keep a note of which company/site it belongs to (kept out of the
  video overlay - just for your own reference).

## How it works

Browsers can't play raw RTSP, so a small streaming engine called
[go2rtc](https://github.com/AlexxIT/go2rtc) runs alongside this app and
re-packages each RTSP feed into WebRTC (no transcoding - same quality as the
camera outputs, just repackaged). The frontend speaks WebRTC to go2rtc
directly and draws it into a `<video>` element it fully controls, which is
what makes automatic reconnection and clean scaling possible. The Node
backend (`server.js`) manages the camera list and tells go2rtc which RTSP
sources to use; go2rtc itself is never exposed to the network, only this
app's one port is.

---

## Requirements

- A Linux machine on the same network as your cameras (Raspberry Pi 4/5,
  Ubuntu/Debian box, etc.)
- [Node.js](https://nodejs.org) 18 or newer
- [go2rtc](https://github.com/AlexxIT/go2rtc) (a single static binary, no
  install needed beyond downloading it)

## Installation

**Clone the repo, then run the installer:**

```bash
git clone https://github.com/YOUR-USERNAME/camviewer.git
cd camviewer
bash install.sh
```

That's it. `install.sh` installs Node.js if needed, downloads the right
go2rtc binary for your machine's CPU, installs dependencies, sets up both
services to run on boot (systemd), starts everything, and at the end asks
whether you also want fullscreen kiosk mode on this machine's own monitor.
It's safe to re-run - it skips whatever's already done.

When it finishes, visit `http://<this-machine's-ip>:3000` from any device
on your network.

<details>
<summary>Prefer to do it manually, or install.sh didn't work for you?</summary>

**1. Install Node.js** (skip if `node -v` already shows 18+)

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

**2. Download go2rtc** for your platform

```bash
uname -m
#   aarch64   -> Raspberry Pi, 64-bit OS  -> go2rtc_linux_arm64
#   armv7l    -> Raspberry Pi, 32-bit OS  -> go2rtc_linux_armv7
#   x86_64    -> Ubuntu/Debian PC         -> go2rtc_linux_amd64

curl -L -o go2rtc https://github.com/AlexxIT/go2rtc/releases/latest/download/go2rtc_linux_arm64
chmod +x go2rtc
```

**3. Install dependencies**

```bash
npm install
```

**4. Run it**

```bash
# Terminal 1
./go2rtc -config go2rtc.yaml

# Terminal 2
node server.js
```

See [Running on boot](#running-on-boot) below to set these up as services
instead of running them manually in terminals.

</details>

## Adding a camera

Open the menu icon in the top-right corner → **+ Add camera**. Give it a
name and (optionally) a company for your own reference. Paste the RTSP link
exactly as UniFi Protect gives it to you (Camera settings → Advanced →
RTSP), e.g.:

```
rtsps://192.168.1.1:7441/lk0udRKvI5648CYj?enableSrtp
```

The backend automatically rewrites it into the form go2rtc needs - no
manual editing required.

## Layouts

Pick a preset **1-10** from the corner menu for an edge-to-edge grid, or
**Free** to drag and resize tiles anywhere. In a grid preset, drag one tile
onto another to swap their slots - handy for putting your most important
camera in the layout's biggest tile. Your arrangement is remembered across
restarts.

A small dot in the corner of each tile shows connection status (green =
live, red = connecting/reconnecting).

## Managing cameras

Open the corner menu → **Manage cameras** for an overview of everything
you've added, with a toggle to turn each one on/off. Turning a camera off
hides its tile and disconnects its stream (saving bandwidth) without
deleting it.

## Running on boot

If you used `install.sh`, this is already done - it sets up and starts both
services automatically. This section is only for the manual install path,
or if you want to see/edit the generated services.

```bash
systemctl status go2rtc
systemctl status camviewer
journalctl -u camviewer -f
```

Static service file templates (`go2rtc.service`, `camviewer.service`) are
also included if you'd rather set them up by hand - edit the paths/user
inside them first if your setup doesn't match `pi` / `/home/pi/camviewer`,
then:

```bash
sudo cp go2rtc.service camviewer.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now go2rtc
sudo systemctl enable --now camviewer
```

## Kiosk mode (show it directly on a monitor)

`install.sh` offers to set this up automatically at the end. To set it up
separately (or re-run it), if you're on a headless machine (e.g. Ubuntu
Server on a Pi) with a monitor plugged straight into it:

```bash
bash kiosk/kiosk-setup.sh
```

It'll ask which local user to auto-login as and which URL to show (defaults
to `http://localhost:3000`), then installs a minimal X session + Chromium and
wires it to start on boot. SSH access is unaffected - this only changes what
appears on the attached monitor. Reboot to try it:

```bash
sudo reboot
```

To get a terminal on the physical screen instead of the kiosk view (for
maintenance), press `Ctrl+Alt+F2` (and `Ctrl+Alt+F1` to switch back).

---

## Bandwidth and quality

- **No transcoding** - go2rtc repackages the camera's existing H.264 stream
  as-is, so quality matches the source with no extra CPU cost.
- **WebRTC over UDP** - lower overhead than HTTP-polling methods like
  HLS/MJPEG.
- **Only visible tiles stay connected** - the biggest lever for bandwidth.
  A 10-camera setup viewed on a "4" preset only ever streams 4 at a time.
- For further savings, use UniFi Protect's "medium" or "low" quality RTSP
  link for cameras you mostly glance at rather than study closely.

## Troubleshooting

<details>
<summary>Kiosk mode still asks for a password on the monitor</summary>

`kiosk-setup.sh` restarts the tty1 login prompt itself so autologin takes
effect immediately, but if you still see a password prompt after rebooting:

- Run `systemctl status getty@tty1` and check the command line shown -
  it should include `--autologin <your-username>`. If it doesn't, the
  drop-in config wasn't applied - re-run `kiosk/kiosk-setup.sh`.
- On some Raspberry Pi setups, the HDMI output isn't actually `tty1`.
  Check `/boot/firmware/cmdline.txt` for a `console=` entry to see which
  tty is your real primary display, and let us know if it's not `tty1`.
</details>

<details>
<summary>A tile stays on the red dot / never connects</summary>

Confirm go2rtc is running and that the machine can reach your UniFi
Protect controller's IP. Check `journalctl -u go2rtc -f` (or its terminal
output) for the specific stream's error.
</details>

<details>
<summary>go2rtc error: <code>yaml: did not find expected key</code></summary>

go2rtc writes its own config file as it goes, and can occasionally save a
malformed one. Your camera list is safe either way - it's stored in
`config/cameras.json` by CamViewer, not in `go2rtc.yaml`, and gets re-sent
to go2rtc automatically every time `server.js` starts. To fix it:

```bash
# stop go2rtc first, then:
cat > go2rtc.yaml << 'EOF'
api:
  listen: "127.0.0.1:1984"
  origin: "*"

streams:
EOF
# restart go2rtc, then restart node server.js
```
</details>

<details>
<summary>Works on this machine's own browser but not from another device</summary>

Use the machine's actual LAN IP (not `localhost`), and make sure port 3000
isn't blocked by a firewall.
</details>

<details>
<summary>go2rtc error: <code>websocket: request origin not allowed by Upgrader.CheckOrigin</code></summary>

This is already handled by `api.origin: "*"` in `go2rtc.yaml` - if you
still see it, make sure you're running the latest `go2rtc.yaml` from this
repo and restarted go2rtc (not just the Node app).
</details>

## Project structure

```
camviewer/
├── install.sh          # One-shot setup: installs everything and starts it
├── server.js            # Backend: camera list, go2rtc control, WebRTC signaling proxy
├── go2rtc.yaml           # go2rtc config (streams are added at runtime, not listed here)
├── go2rtc.service         # systemd unit template for go2rtc (install.sh generates its own)
├── camviewer.service       # systemd unit template for the Node app (ditto)
├── kiosk/
│   └── kiosk-setup.sh       # Optional: boot straight into fullscreen on an attached monitor
├── public/
│   ├── index.html
│   ├── style.css
│   └── app.js               # Grid layouts, drag/resize, WebRTC client
└── config/                  # Created automatically - your camera list & layout (gitignored)
```

## Credits

Built on [go2rtc](https://github.com/AlexxIT/go2rtc) by AlexxIT, which does
the heavy lifting of turning RTSP into WebRTC.

## License

[MIT](LICENSE)
