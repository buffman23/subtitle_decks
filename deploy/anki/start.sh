#!/bin/sh
# Prepare the Anki profile + AnkiConnect config, then run Anki on a virtual display.
set -e
python /opt/anki/setup_profile.py
exec xvfb-run -a -s "-screen 0 1280x800x24" anki -b "$ANKI_BASE" -p "$ANKI_PROFILE"
