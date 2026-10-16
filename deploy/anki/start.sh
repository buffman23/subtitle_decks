#!/bin/sh
# Prepare the Anki profile + AnkiConnect config, then run Anki on a virtual display.
set -e
python /opt/anki/setup_profile.py

# Start Xvfb directly: xvfb-run waits for a SIGUSR1 readiness handshake that
# hangs when it is the container's PID 1, so Anki would never launch. A
# restarted container keeps its /tmp, so clear the previous run's lock/socket.
rm -f /tmp/.X99-lock /tmp/.X11-unix/X99
Xvfb :99 -screen 0 1280x800x24 -nolisten tcp &
export DISPLAY=:99
i=0
while [ ! -e /tmp/.X11-unix/X99 ]; do
  i=$((i + 1))
  if [ "$i" -gt 100 ]; then echo "[anki] Xvfb did not start" >&2; exit 1; fi
  sleep 0.1
done

exec anki -b "$ANKI_BASE" -p "$ANKI_PROFILE"
