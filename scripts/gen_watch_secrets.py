#!/usr/bin/env python3
"""
gen_watch_secrets.py — generate watch/src/secrets.h from esphome/secrets.yaml

Run from repo root:
    python3 scripts/gen_watch_secrets.py

The generated file is git-ignored. Re-run whenever esphome/secrets.yaml changes.
Both files share the same source of truth — edit esphome/secrets.yaml only.
"""

import sys
from pathlib import Path

SECRETS_YAML = Path(__file__).parent.parent / "esphome" / "secrets.yaml"
OUT_H        = Path(__file__).parent.parent / "watch" / "src" / "secrets.h"

# Map YAML key → C macro name
KEY_MAP = {
    "wifi_ssid":                 "WIFI_SSID_BOAT",
    "wifi_password":             "WIFI_PASS_BOAT",
    "phone_hotspot_ssid":        "WIFI_SSID_PHONE",
    "phone_hotspot_wifi_password": "WIFI_PASS_PHONE",
    "ota_password":              "OTA_PASSWORD",
}

def parse_secrets(path: Path) -> dict:
    secrets = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if ":" not in line:
            continue
        key, _, val = line.partition(":")
        val = val.strip().strip('"').strip("'")
        secrets[key.strip()] = val
    return secrets

def main():
    if not SECRETS_YAML.exists():
        print(f"ERROR: {SECRETS_YAML} not found", file=sys.stderr)
        sys.exit(1)

    secrets = parse_secrets(SECRETS_YAML)
    missing = [k for k in KEY_MAP if k not in secrets]
    if missing:
        print(f"WARNING: missing keys in secrets.yaml: {', '.join(missing)}", file=sys.stderr)

    lines = [
        "// AUTO-GENERATED — do not edit by hand.",
        "// Source: esphome/secrets.yaml  →  scripts/gen_watch_secrets.py",
        "// This file is git-ignored. Re-run the script after editing secrets.yaml.",
        "#pragma once",
        "",
    ]
    for yaml_key, macro in KEY_MAP.items():
        val = secrets.get(yaml_key, "")
        lines.append(f'#define {macro:<28} "{val}"')

    OUT_H.parent.mkdir(parents=True, exist_ok=True)
    OUT_H.write_text("\n".join(lines) + "\n")
    print(f"Generated {OUT_H}")

if __name__ == "__main__":
    main()
