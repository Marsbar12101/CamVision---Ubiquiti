#!/usr/bin/env bash
# One-shot CamViewer installer.
#
# Run this once from inside the cloned repo:
#   bash install.sh
#
# It will:
#   1. Install Node.js 20 (if not already present)
#   2. Download the right go2rtc binary for this machine's CPU
#   3. Install Node dependencies (npm install)
#   4. Generate and enable systemd services for go2rtc + CamViewer, with the
#      correct paths/user filled in automatically (no manual editing needed)
#   5. Start everything and wait until it's actually reachable
#   6. Optionally set up fullscreen kiosk mode on this machine's own monitor
#
# Safe to re-run - it skips steps that are already done.

set -e

INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_USER="$(whoami)"
cd "$INSTALL_DIR"

echo "=== CamViewer installer ==="
echo "Install directory: $INSTALL_DIR"
echo "Running as:         $INSTALL_USER"
echo

# --- 1. Node.js ---
NODE_OK=false
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR=$(node -v | sed 's/^v//;s/\..*//')
  if [ "$NODE_MAJOR" -ge 18 ] 2>/dev/null; then
    NODE_OK=true
  fi
fi
if [ "$NODE_OK" = true ]; then
  echo "--- Node.js $(node -v) already installed, skipping ---"
else
  echo "--- Installing Node.js 20.x ---"
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

# --- 2. go2rtc binary ---
if [ -f "$INSTALL_DIR/go2rtc" ]; then
  echo "--- go2rtc binary already present, skipping download ---"
else
  echo "--- Downloading go2rtc ---"
  ARCH="$(uname -m)"
  case "$ARCH" in
    aarch64) GO2RTC_ASSET="go2rtc_linux_arm64" ;;
    armv7l)  GO2RTC_ASSET="go2rtc_linux_armv7" ;;
    x86_64)  GO2RTC_ASSET="go2rtc_linux_amd64" ;;
    *)
      echo "Unrecognized CPU architecture: $ARCH"
      echo "Download the matching binary yourself from:"
      echo "  https://github.com/AlexxIT/go2rtc/releases/latest"
      echo "save it as '$INSTALL_DIR/go2rtc', chmod +x it, then re-run this script."
      exit 1
      ;;
  esac
  curl -L -o go2rtc "https://github.com/AlexxIT/go2rtc/releases/latest/download/$GO2RTC_ASSET"
  chmod +x go2rtc
fi

# --- 3. Node dependencies ---
echo "--- Installing Node dependencies ---"
npm install

# --- 4. systemd services (generated fresh, so paths/user are always correct) ---
echo "--- Setting up systemd services ---"
NODE_BIN="$(command -v node)"
GO2RTC_BIN="$INSTALL_DIR/go2rtc"

sudo tee /etc/systemd/system/go2rtc.service > /dev/null << EOF
[Unit]
Description=go2rtc streaming engine
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR
ExecStart=$GO2RTC_BIN -config $INSTALL_DIR/go2rtc.yaml
Restart=on-failure
RestartSec=3
User=$INSTALL_USER

[Install]
WantedBy=multi-user.target
EOF

sudo tee /etc/systemd/system/camviewer.service > /dev/null << EOF
[Unit]
Description=CamViewer web app
After=network-online.target go2rtc.service
Wants=network-online.target
Requires=go2rtc.service

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR
ExecStart=$NODE_BIN $INSTALL_DIR/server.js
Restart=on-failure
RestartSec=3
User=$INSTALL_USER
Environment=PORT=3000
Environment=GO2RTC_API=http://127.0.0.1:1984

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now go2rtc
sudo systemctl enable --now camviewer

# --- 5. Wait for it to come up ---
echo "--- Waiting for CamViewer to start ---"
UP=false
for i in $(seq 1 30); do
  if curl -s -o /dev/null "http://localhost:3000"; then
    UP=true
    break
  fi
  sleep 1
done

IP="$(hostname -I | awk '{print $1}')"
echo
if [ "$UP" = true ]; then
  echo "=== CamViewer is running ==="
else
  echo "=== Services started, but CamViewer isn't responding yet ==="
  echo "Check status with: systemctl status camviewer   and   systemctl status go2rtc"
fi
echo "Visit: http://$IP:3000"
echo

# --- 6. Optional kiosk mode ---
echo
echo "Note: kiosk mode requires Ubuntu Desktop (not Server) - it uses GDM"
echo "to auto-login and auto-launch a fullscreen browser."
read -p "Also set up fullscreen kiosk mode on this machine's own monitor? [y/N]: " SETUP_KIOSK
if [[ "$SETUP_KIOSK" =~ ^[Yy]$ ]]; then
  bash "$INSTALL_DIR/kiosk/kiosk-setup.sh"
else
  echo "Skipping kiosk mode. You can set it up later with: bash kiosk/kiosk-setup.sh"
fi
