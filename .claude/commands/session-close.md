---
name: session-close
description: End-of-session documentation ritual for SailboatServer. Updates CHANGELOG, PENDING_WORK, commits all changes with logical grouping, pushes to GitHub, and appends to the Obsidian Agent Log. Run at the end of every work session.
---

# Session Close — SailboatServer

Perform the end-of-session documentation and commit ritual. Work through each step in order.

---

## Step 1 — Assess what changed

```!
git diff --stat HEAD
git status --short
```

Review the diff. Group changes into logical commits (e.g. one for a new feature, one for ESPHome changes, one for docs). Do not batch unrelated changes into a single commit.

---

## Step 2 — Update `docs/CHANGELOG.md`

Add a new session entry at the top (below the header, before the previous session). Format:

```markdown
## Session: YYYY-MM-DD — Short Title

### Feature/area name
- Bullet describing what changed and why
- Include file names, service names, config keys where relevant
- Note any hardware changes (sensors, wiring, new devices)
- Note any Pi-side changes (new services, systemd units, packages)

### Bug Fixes / Polish
- ...

### Files Changed
| File | Change |
|------|--------|
| ... | ... |
```

Use `docs/CHANGELOG.md` format from prior entries as reference. Today's date is available via `date +%Y-%m-%d`.

---

## Step 3 — Update `docs/PENDING_WORK.md`

- Update the "Status as of" date at the top
- Move newly completed items into the `## ✅ Recently Completed` section
- Remove or update tasks that are now irrelevant
- Add any new immediate tasks discovered during the session

---

## Step 4 — Update agent docs if needed

Check if any agent files in `docs/agents/` are now stale:
- `marine-systems.md` — ESP32 sensors, NMEA instruments, hardware
- `backend-pi.md` — relay_server.py API endpoints, systemd services
- `frontend.md` / `data-instruments.md` — if UI or data layer changed significantly

Only update if meaningfully out of date. Don't add trivial changes.

---

## Step 5 — Commit in logical groups

Stage and commit files by logical group. Example groupings:
- New feature (source files only)
- ESPHome firmware changes
- Documentation (CHANGELOG, LESSONS_LEARNED, PENDING_WORK, agent docs)
- Design files / assets

For each commit:
```bash
git add <specific files>
git commit -m "$(cat <<'EOF'
Short imperative summary (50 chars max)

- Bullet detail 1
- Bullet detail 2

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

Do **not** use `git add -A` or `git add .` — stage specific files only to avoid accidentally committing secrets or large binaries.

---

## Step 6 — Push to GitHub

```bash
git push origin main
```

Confirm output shows the commits pushed.

---

## Step 7 — Update Obsidian Agent Log

Append a new entry to `/Users/mattschoenholz/Desktop/CurrentProjects/makerMatt/MyObsidianVault/02_Boat_Project/Agent Log.md`.

Format:
```markdown
## [boat] Brief title
*YYYY-MM-DD*

- What was built/changed and why
- Any hardware incidents or discoveries
- What's pending from this session
- Links to LESSONS_LEARNED sections if new lessons were added

---
```

Insert the new entry **after** the first `---` separator (at the top of the log entries, not at the bottom).

---

## Step 8 — Update Obsidian Boat Overview if status changed

If any system status changed (e.g. a sensor went from "Planned" to "✅ Done"), update the Systems Status table in `/Users/mattschoenholz/Desktop/CurrentProjects/makerMatt/MyObsidianVault/02_Boat_Project/Boat Overview.md`.

---

## Done

Confirm to the user:
- Number of commits made and their one-line summaries
- Whether Obsidian was updated
- Any items left in PENDING_WORK that need physical action at the boat
