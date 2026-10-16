# syntax=docker/dockerfile:1
# Headless Anki desktop + AnkiConnect: the one shared collection that holds
# every Subtitle Decks user's decks (each under a top-level deck named after
# their email). Runs on a private Docker network with no published port; only
# the app container can reach AnkiConnect at http://anki:8765.
FROM python:3.12-slim-bookworm

# Xvfb gives Anki's Qt UI a virtual display; the rest are Qt/QtWebEngine
# runtime libraries the PyQt6 wheels expect from the system.
RUN apt-get update && apt-get install -y --no-install-recommends \
      xvfb xauth curl ca-certificates unzip \
      libxkbcommon0 libxkbcommon-x11-0 libxcb-cursor0 libxcb-icccm4 libxcb-image0 \
      libxcb-keysyms1 libxcb-randr0 libxcb-render-util0 libxcb-shape0 libxcb-xinerama0 \
      libxcb-xkb1 libxcb-xfixes0 libegl1 libgl1 libfontconfig1 libdbus-1-3 libnss3 \
      libxcomposite1 libxdamage1 libxrandr2 libxtst6 libxi6 libxkbfile1 libasound2 \
      libglib2.0-0 libpulse0 \
 && rm -rf /var/lib/apt/lists/*

# Same Anki release the integration was developed and tested against.
ARG ANKI_VERSION=25.9.4
RUN pip install --no-cache-dir "aqt[qt6]==${ANKI_VERSION}"

# AnkiConnect add-on (AnkiWeb code 2055492159), unpacked into the image; it is
# copied into the profile's addons folder at startup (see start.sh).
ARG ANKICONNECT_POINT_VERSION=250900
RUN mkdir -p /opt/ankiconnect \
 && curl -fsSL -o /tmp/ankiconnect.zip \
      "https://ankiweb.net/shared/download/2055492159?v=2.1&p=${ANKICONNECT_POINT_VERSION}" \
 && unzip -q /tmp/ankiconnect.zip -d /opt/ankiconnect \
 && rm /tmp/ankiconnect.zip

RUN useradd --create-home --uid 1001 anki \
 && mkdir -p /data /exports && chown anki:anki /data /exports \
 # The app container (another uid) deletes each export after sending it.
 && chmod 777 /exports
COPY setup_profile.py start.sh /opt/anki/
RUN chmod +x /opt/anki/start.sh

USER anki
ENV QTWEBENGINE_DISABLE_SANDBOX=1 \
    QTWEBENGINE_CHROMIUM_FLAGS="--no-sandbox" \
    ANKI_BASE=/data \
    ANKI_PROFILE=server
VOLUME ["/data"]
EXPOSE 8765

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
  CMD curl -fsS -X POST -d '{"action":"version","version":6}' http://127.0.0.1:8765 >/dev/null || exit 1

CMD ["/opt/anki/start.sh"]
