"""Idempotent first-run setup for the headless Anki instance.

Creates the Anki base folder and profile (skipping Anki's first-run language
dialog, which would block a headless start), and installs/configures the
AnkiConnect add-on from /opt/ankiconnect. The AnkiConnect config is rewritten
on every start so env changes (e.g. ANKICONNECT_KEY) take effect.
"""
import json
import os
import shutil

from aqt.profiles import ProfileManager

ADDON_ID = "2055492159"
base = os.environ.get("ANKI_BASE", "/data")
profile = os.environ.get("ANKI_PROFILE", "server")

pm = ProfileManager(ProfileManager.get_created_base_folder(base))
pm.setupMeta()
pm.meta["firstRun"] = False
pm.meta["defaultLang"] = "en_US"
if profile not in pm.profiles():
    pm.create(profile)
pm.load(profile)
pm.set_last_loaded_profile_name(profile)
pm.save()

addon_dir = os.path.join(base, "addons21", ADDON_ID)
shutil.rmtree(addon_dir, ignore_errors=True)
shutil.copytree("/opt/ankiconnect", addon_dir)
config = {
    "apiKey": os.environ.get("ANKICONNECT_KEY") or None,
    "apiLogPath": None,
    # Reachable only on the private Docker network (no port is published).
    "webBindAddress": "0.0.0.0",
    "webBindPort": 8765,
    "webCorsOriginList": [],
    "ignoreOriginList": [],
}
with open(os.path.join(addon_dir, "meta.json"), "w") as fh:
    json.dump({"name": "AnkiConnect", "disabled": False, "update_enabled": False, "config": config}, fh)
print(f"[anki] profile '{profile}' ready in {base}; AnkiConnect configured")
