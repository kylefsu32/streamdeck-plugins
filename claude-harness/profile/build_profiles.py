#!/usr/bin/env python3
"""Build the ready-made Stream Deck profiles that ship with the plugin.

One profile per device type; the plugin manifest's "Profiles" list binds each
to its DeviceType, so the Stream Deck app offers only the one that fits. The
layout idea comes from kotyzap/Stream-Deck-Claude-Plugin (MIT): install the
plugin and a working page appears, no dragging keys around first. The file
format is Stream Deck 6.5+/7's v3 profile: a zip holding <UUID>.sdProfile/
with a top manifest and one folder per page.

    python3 profile/build_profiles.py     (or: npm run profiles)
"""
import json
import os
import shutil
import tempfile
import uuid
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
SDPLUGIN = os.path.join(HERE, "..", "com.kylefsu.claude-harness.sdPlugin")
MANIFEST = json.load(open(os.path.join(SDPLUGIN, "manifest.json")))
PLUGIN = {"Name": MANIFEST["Name"], "UUID": MANIFEST["UUID"], "Version": MANIFEST["Version"]}


def key(action, **settings):
    return {"action": action, "settings": settings}


def agents(cols, rows, start=1):
    """Agent keys filling `rows` from the top, numbered left to right."""
    n = start
    out = {}
    for r in rows:
        for c in range(cols):
            out[f"{c},{r}"] = key("agent", slot=str(n))
            n += 1
    return out


# Model codes: 20GAA9902 Stream Deck MK.2 (5x3), 20GAI9901 Mini (3x2),
# 20GAT9901 XL (8x4), 20GBD9901 Stream Deck + (4x2 keys).
def options(cells):
    """Option keys 1..n at the given positions."""
    return {pos: key("option", option=str(i + 1)) for i, pos in enumerate(cells)}


LAYOUTS = {
    # The everyday pages.
    "Claude Harness": dict(model="20GAA9902", keys={
        **agents(4, [0]), "4,0": key("overview"),
        **agents(4, [1], start=5), "4,1": key("inbox"),
        "0,2": key("question"), "1,2": key("allow"), "2,2": key("always"),
        "3,2": key("deny"), "4,2": key("terminal"),
    }),
    "Claude Harness Mini": dict(model="20GAI9901", keys={
        **agents(2, [0]),
        "2,0": key("overview"),
        "0,1": key("question"), "1,1": key("allow"), "2,1": key("deny"),
    }),
    "Claude Harness XL": dict(model="20GAT9901", keys={
        **agents(8, [0, 1]),
        "0,2": key("usage", metric="seven_day", style="bar"),
        "1,2": key("usage", metric="five_hour", style="ring"),
        "2,2": key("usage", metric="seven_day", style="forecast"),
        "0,3": key("question"), "1,3": key("allow"), "2,3": key("always"), "3,3": key("deny"),
        "4,3": key("terminal"), "6,3": key("inbox"), "7,3": key("overview"),
    }),
    "Claude Harness Plus": dict(model="20GBD9901", keys={
        **agents(4, [0]),
        "0,1": key("question"), "1,1": key("allow"), "2,1": key("deny"), "3,1": key("overview"),
    }),
    # The answer pages the deck jumps to while a multiple-choice question is held,
    # after hardkoded/streamdeck-claude-answer: the question, its options, a way out.
    "Claude Harness Answer": dict(model="20GAA9902", keys={
        "0,0": key("question"), "4,0": key("terminal"),
        **options(["0,1", "1,1", "2,1", "3,1"]),
        "4,2": key("overview"),
    }),
    "Claude Harness Answer Mini": dict(model="20GAI9901", keys={
        "0,0": key("question"), **options(["1,0", "2,0", "0,1", "1,1"]), "2,1": key("terminal"),
    }),
    "Claude Harness Answer XL": dict(model="20GAT9901", keys={
        "0,0": key("question"), "7,0": key("terminal"),
        **options(["2,1", "3,1", "4,1", "5,1"]),
    }),
    "Claude Harness Answer Plus": dict(model="20GBD9901", keys={
        **options(["0,0", "1,0", "2,0", "3,0"]),
        "0,1": key("question"), "3,1": key("terminal"),
    }),
}

NAMES = {a["UUID"].rsplit(".", 1)[1]: a["Name"] for a in MANIFEST["Actions"]}


def action_entry(spec):
    return {
        "ActionID": str(uuid.uuid4()),
        "LinkedTitle": True,
        "Name": NAMES[spec["action"]],
        "Plugin": PLUGIN,
        "Resources": None,
        "Settings": spec["settings"],
        "State": 0,
        "States": [{"FontFamily": "", "FontSize": 12, "FontStyle": "", "FontUnderline": False,
                    "OutlineThickness": 2, "ShowTitle": False, "TitleAlignment": "middle",
                    "TitleColor": "#ffffff"}],
        "UUID": f"{PLUGIN['UUID']}.{spec['action']}",
    }


def build(name, layout, work):
    profile_id = str(uuid.uuid4()).upper()
    page_id = str(uuid.uuid4()).upper()
    root = os.path.join(work, f"{profile_id}.sdProfile")
    page = os.path.join(root, "Profiles", page_id)
    os.makedirs(os.path.join(page, "Images"))
    os.makedirs(os.path.join(root, "Images"))

    actions = {pos: action_entry(spec) for pos, spec in layout["keys"].items()}
    with open(os.path.join(page, "manifest.json"), "w") as f:
        json.dump({"Controllers": [{"Actions": actions, "Type": "Keypad"}], "Icon": "", "Name": ""}, f, indent=2)
    with open(os.path.join(root, "manifest.json"), "w") as f:
        json.dump({
            "Device": {"Model": layout["model"], "UUID": ""},  # empty UUID: any device of this model
            "Name": name,
            "Pages": {"Current": page_id.lower(), "Default": page_id.lower(), "Pages": [page_id.lower()]},
            "Version": "3.0",
        }, f, indent=2)

    out = os.path.join(SDPLUGIN, f"{name}.streamDeckProfile")
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for dirpath, _, files in os.walk(root):
            for fn in files:
                full = os.path.join(dirpath, fn)
                z.write(full, os.path.relpath(full, work))
    print("wrote", os.path.relpath(out, os.path.join(HERE, "..")))


def main():
    names = {p["Name"] for p in MANIFEST.get("Profiles", [])}
    for name, layout in LAYOUTS.items():
        assert name in names, f"{name} is missing from the manifest's Profiles"
        work = tempfile.mkdtemp()
        try:
            build(name, layout, work)
        finally:
            shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    main()
