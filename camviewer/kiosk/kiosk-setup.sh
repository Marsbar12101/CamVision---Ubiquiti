#!/usr/bin/env bash
# Sets up this machine to boot directly into a fullscreen, chrome-less browser
# showing CamViewer on its own attached monitor - no desktop environment needed.
#
# What it does:
#   1. Installs a minimal X server + openbox + Chromium
#   2. Auto-logs in your user on the local console (tty1)
#   3. Auto-starts X, which auto-starts Chromium in --kiosk mode pointed at CamViewer
#
# SSH access is completely unaffected - this only changes what shows up on the
# monitor physically plugged into this machine.
#
# Usage: bash kiosk-setup.sh

set -e

echo "=== CamViewer kiosk setup ==="
echo

read -p "Local user to auto-login as [$(whoami)]: " KIOSK_USER
KIOSK_USER=${KIOSK_USER:-$(whoami)}

read -p "URL to display [http://localhost:3000]: " KIOSK_URL
KIOSK_URL=${KIOSK_URL:-http://localhost:3000}

echo
echo "--- Installing packages ---"
sudo apt update
sudo apt install --no-install-recommends -y \
  xserver-xorg x11-xserver-utils xinit openbox unclutter curl

# Chromium: try the regular package first, fall back to snap (Ubuntu moved it
# to snap-only on some releases).
if ! command -v chromium-browser >/dev/null 2>&1 && ! command -v chromium >/dev/null 2>&1; then
  sudo apt install --no-install-recommends -y chromium-browser || sudo snap install chromium
fi
CHROMIUM_BIN=$(command -v chromium-browser || command -v chromium || true)
if [ -z "$CHROMIUM_BIN" ]; then
  echo "Could not find a chromium binary after install - install it manually, then re-run this script."
  exit 1
fi
echo "Using: $CHROMIUM_BIN"

echo
echo "--- Setting up auto-login on tty1 for '$KIOSK_USER' ---"
sudo mkdir -p /etc/systemd/system/getty@tty1.service.d
sudo tee /etc/systemd/system/getty@tty1.service.d/autologin.conf > /dev/null << EOF
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin $KIOSK_USER --noclear %I \$TERM
EOF
sudo systemctl daemon-reload
# daemon-reload alone only affects FUTURE starts of the unit - the getty already
# running on tty1 needs an explicit restart to actually pick up autologin now,
# otherwise it just sits there still asking for a password as if nothing changed.
sudo systemctl restart getty@tty1.service

echo
echo "--- Setting up auto-start of X on login ---"
BASH_PROFILE="/home/$KIOSK_USER/.bash_profile"
if ! grep -q "startx" "$BASH_PROFILE" 2>/dev/null; then
  cat >> "$BASH_PROFILE" << 'PROFILE_EOF'

# Auto-start the CamViewer kiosk display on the local console only
if [ -z "$DISPLAY" ] && [ "$(tty)" = "/dev/tty1" ]; then
  exec startx
fi
PROFILE_EOF
fi

echo
echo "--- Writing .xinitrc (what X runs on start) ---"
cat > "/home/$KIOSK_USER/.xinitrc" << XINITRC_EOF
#!/bin/sh
xset s off
xset s noblank
xset -dpms
unclutter -idle 1 -root &
openbox-session &

# Wait for CamViewer to actually be reachable before opening it, in case this
# runs before the go2rtc/camviewer services have finished starting up.
until curl -s -o /dev/null "$KIOSK_URL"; do
  sleep 1
done

exec $CHROMIUM_BIN --noerrdialogs --disable-infobars --kiosk --incognito \\
  --no-first-run --disable-session-crashed-bubble --disable-translate \\
  --autoplay-policy=no-user-gesture-required "$KIOSK_URL"
XINITRC_EOF
chmod +x "/home/$KIOSK_USER/.xinitrc"
sudo chown "$KIOSK_USER:$KIOSK_USER" "/home/$KIOSK_USER/.xinitrc" "$BASH_PROFILE"

echo
echo "=== Done ==="
echo
echo "Checking autologin status:"
systemctl status getty@tty1.service --no-pager | grep -E "Active:|autologin" || true
echo
echo "Reboot to try it fully: sudo reboot"
echo "SSH still works as normal - this only affects the attached monitor."
echo
echo "To temporarily get a terminal on the physical screen instead of the kiosk,"
echo "press Ctrl+Alt+F2 (switches to another console) - Ctrl+Alt+F1 switches back."
echo
echo "If the physical screen still asks for a password after rebooting:"
echo "  - Run: systemctl status getty@tty1   (confirm it shows --autologin $KIOSK_USER in the command)"
echo "  - On a Raspberry Pi, the HDMI output isn't always tty1 - check /boot/firmware/cmdline.txt"
echo "    for a 'console=' entry to see which tty is actually your primary display."
