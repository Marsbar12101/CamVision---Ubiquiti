#!/usr/bin/env bash
# Sets this machine up to boot straight into a fullscreen, chrome-less browser
# showing CamViewer, using Ubuntu Desktop's own display manager (GDM) rather
# than a hand-rolled X session. This is the recommended approach on a
# Raspberry Pi - GDM already handles HDMI/monitor detection reliably as part
# of normal desktop startup, which a minimal headless X11 setup often doesn't.
#
# Requires a desktop environment to already be installed. If you're on
# Ubuntu Server and haven't installed one yet:
#   sudo apt update
#   sudo apt install ubuntu-desktop-minimal     # lighter, recommended for a Pi
#   sudo reboot
# then run this script.
#
# Usage: bash kiosk-setup.sh

set -e

echo "=== CamViewer kiosk setup (Ubuntu Desktop) ==="
echo

GDM_CONF="/etc/gdm3/custom.conf"
if [ ! -f "$GDM_CONF" ]; then
  echo "Could not find $GDM_CONF - it looks like GDM (Ubuntu Desktop's display"
  echo "manager) isn't installed on this machine."
  echo
  echo "Install a desktop environment first, then re-run this script:"
  echo "  sudo apt update"
  echo "  sudo apt install ubuntu-desktop-minimal"
  echo "  sudo reboot"
  exit 1
fi

read -p "Local user to auto-login as [$(whoami)]: " KIOSK_USER
KIOSK_USER=${KIOSK_USER:-$(whoami)}

read -p "URL to display [http://localhost:3000]: " KIOSK_URL
KIOSK_URL=${KIOSK_URL:-http://localhost:3000}

echo
echo "--- Installing Chromium (and curl, if missing) ---"
sudo apt update
sudo apt install --no-install-recommends -y curl
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
echo "--- Setting up GDM autologin for '$KIOSK_USER' ---"
sudo cp "$GDM_CONF" "$GDM_CONF.bak.$(date +%s)"
if grep -q "AutomaticLoginEnable" "$GDM_CONF"; then
  sudo sed -i \
    -e "s/^#\?\s*AutomaticLoginEnable\s*=.*/AutomaticLoginEnable = true/" \
    -e "s/^#\?\s*AutomaticLogin\s*=.*/AutomaticLogin = $KIOSK_USER/" \
    "$GDM_CONF"
else
  sudo sed -i "/\[daemon\]/a AutomaticLoginEnable = true\nAutomaticLogin = $KIOSK_USER" "$GDM_CONF"
fi

echo
echo "--- Writing kiosk launcher script ---"
mkdir -p "/home/$KIOSK_USER/.local/bin"
cat > "/home/$KIOSK_USER/.local/bin/camviewer-kiosk.sh" << EOF
#!/bin/sh
# Give the desktop session a moment to fully settle before touching it
sleep 3

# Stop the screen from blanking/sleeping during kiosk use
gsettings set org.gnome.desktop.session idle-delay 0 2>/dev/null || true
gsettings set org.gnome.settings-daemon.plugins.power sleep-inactive-ac-type 'nothing' 2>/dev/null || true
xset s off 2>/dev/null || true
xset -dpms 2>/dev/null || true

# Wait for CamViewer to actually be reachable before opening it, in case this
# runs before the go2rtc/camviewer services have finished starting up.
until curl -s -o /dev/null "$KIOSK_URL"; do
  sleep 1
done

exec $CHROMIUM_BIN --noerrdialogs --disable-infobars --kiosk --incognito \\
  --no-first-run --disable-session-crashed-bubble --disable-translate \\
  --autoplay-policy=no-user-gesture-required "$KIOSK_URL"
EOF
chmod +x "/home/$KIOSK_USER/.local/bin/camviewer-kiosk.sh"

echo
echo "--- Setting up autostart entry ---"
mkdir -p "/home/$KIOSK_USER/.config/autostart"
cat > "/home/$KIOSK_USER/.config/autostart/camviewer-kiosk.desktop" << EOF
[Desktop Entry]
Type=Application
Name=CamViewer Kiosk
Exec=/home/$KIOSK_USER/.local/bin/camviewer-kiosk.sh
X-GNOME-Autostart-enabled=true
EOF

sudo chown -R "$KIOSK_USER:$KIOSK_USER" "/home/$KIOSK_USER/.local" "/home/$KIOSK_USER/.config"

echo
echo "=== Done ==="
echo "Reboot to try it: sudo reboot"
echo
echo "Expected behavior: boots to desktop -> auto-logs in as $KIOSK_USER ->"
echo "a few seconds later, Chromium opens fullscreen showing CamViewer."
echo
echo "To get out of kiosk mode temporarily (for maintenance): Alt+F4 closes"
echo "Chromium and drops you on the normal desktop. SSH access is unaffected"
echo "by any of this either way."
