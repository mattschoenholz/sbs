---
name: deploy
description: Deploy SailboatServer web, server, and ESPHome files to the Raspberry Pi. Runs scripts/deploy.sh. Pass "remote" to use Tailscale IP instead of local hostname.
---

# Deploy SailboatServer

Deploy all changed files to the Pi.

$ARGUMENTS defaults to local (sailboatserver.local). Pass `remote` to deploy over Tailscale.

## Pre-deploy checks

Verify there are no uncommitted changes that should be included:

```!
git status --short
```

## Run deploy

If $ARGUMENTS is "remote" or the local host is unreachable, use Tailscale IP `100.109.248.77`.

For **local deploy** (on boat WiFi):
```bash
bash scripts/deploy.sh
```

For **remote deploy** (over Tailscale):
```bash
PI_HOST=100.109.248.77 bash scripts/deploy.sh
```

Run the appropriate command using the Bash tool. Show the output to the user.

## Post-deploy

After a successful deploy, confirm:
1. Any relay_server.py changes → service was restarted (deploy.sh does this automatically if the file changed)
2. Any HTML/CSS/JS changes → cache-busted with `?v=<timestamp>` by deploy.sh
3. If ESPHome YAML was changed → remind user to run `/flash-esp32` to push firmware OTA

**Do not restart relay.service manually unless deploy.sh failed to do so** — unnecessary restarts can momentarily float GPIO pins and glitch relays.
