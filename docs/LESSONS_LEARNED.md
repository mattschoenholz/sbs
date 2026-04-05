# SailboatServer — Lessons Learned

Hard-won knowledge. Read before touching the relevant system.

---

## nginx

### 1. `sed -i` multi-line replacements will destroy config blocks
`sed -i` with complex substitutions on a live nginx config is dangerous — it can eat surrounding location blocks if the line counts are off. Twice we ended up with orphaned `autoindex on;` lines floating outside any location block.

**Rule:** For any nginx config edit involving more than 2 lines, write a Python script, copy it to the Pi, and run it. Use string replacement on the file contents, not line-number operations.

### 2. `sub_filter` requires `--with-http_sub_module`
Not compiled into all nginx builds. Verify with `sudo nginx -V 2>&1 | grep sub_module` before using. On Raspberry Pi OS Bookworm the full nginx package includes it.

### 3. `proxy_buffering off` is required for SSE/streaming responses
Ollama's `/api/chat` with `stream: true` sends newline-delimited JSON as it generates. If `proxy_buffering` is on, nginx buffers the whole response before forwarding — the user sees nothing until the model finishes. Always set `proxy_buffering off` and `proxy_read_timeout 300s` on any proxy that streams.

### 4. nginx autoindex `sub_filter` only works for HTML responses
The `sub_filter` directive only matches and replaces in text/html responses. It won't affect JSON, binary, etc. This is fine for autoindex (which produces HTML), but don't expect it to work on API endpoints.

### 5. The WMS tile cache key is the full request URI including bbox
The FastCGI cache key `"$request_uri"` includes the `bbox=` parameter, which is computed by Leaflet's floating-point math in the browser. ARM64 Python/Node and x86 Chrome produce subtly different doubles for the same tile bbox → permanent cache miss if you pre-warm from the server side. **Always warm `warm.html` in a desktop browser.** See `CLAUDE.md` for the full explanation.

---

## Ollama / LLM

### 6. Ollama 0.18+ rejects browser requests without `OLLAMA_ORIGINS=*`
Browsers send an `Origin` header with every cross-origin request. Ollama's default CORS policy rejects origins other than localhost, returning HTTP 403. This was the root cause of the "HTTP 403 error" in the AI chat panel.

**Fix:** `/etc/systemd/system/ollama.service.d/override.conf`:
```ini
[Service]
Environment="OLLAMA_ORIGINS=*"
```
Then `sudo systemctl daemon-reload && sudo systemctl restart ollama`.

**Note:** `curl` from the terminal doesn't send an `Origin` header, so curl tests pass even when the browser gets 403. Always test with an explicit `-H 'Origin: http://sailboatserver.local'` to simulate browser behavior.

### 7. phi4-mini is the Pi 5 sweet spot (as of early 2026)
- **phi4-mini Q4_K_M**: 3.8B params, 2.5GB on disk, ~3–6 tokens/sec on Pi 5 8GB
- Llamarine (maritime fine-tune) is 70B — doesn't fit in 8GB RAM
- Larger models (7B+) are usable but noticeably slower on Pi 5 without a GPU
- Model lives at `/usr/share/ollama/.ollama/models/` (Ollama's home is the `ollama` system user's home)

### 8. The model knows nothing about your documents
phi4-mini's weights are frozen at training time. Dropping PDFs on the boat does nothing to its knowledge. To make the model answer from your documents, you need RAG (Retrieval Augmented Generation): embed document chunks, store vectors, retrieve relevant passages at query time, inject into context. See PENDING_WORK.md.

### 9. System prompt injection is the fastest way to add boat-specific context
For facts that don't change often (boat name, MMSI, home port, engine model, crew count), add them directly to `AI_SYSTEM` in `library.js`. For live data (SOG, wind, etc.), the `buildBoatContext()` function prepends a `VESSEL STATE` block to each message — the model sees it but the UI hides it from the user.

---

## Kiwix

### 10. Kiwix ZIM files can be silently corrupted
Two ZIM files from the SD card backup (security.stackexchange, wikispecies) caused `kiwix-manage` to fail with a cryptic error. The symptom was the service refusing to start. Isolate by testing each ZIM individually:
```bash
kiwix-serve --port=8080 /home/pi/zims/suspect.zim
```
Corrupted files should be moved out of the glob directory.

### 11. `kiwix-serve` with a glob is simpler than `kiwix-manage` + library XML
`kiwix-serve --port=8080 /home/pi/zims/*.zim` just works and auto-discovers all ZIMs. The `kiwix-manage` + library XML approach adds complexity and failure modes (file ordering matters, XML must be valid). Use the glob. Drop new ZIMs → restart service.

### 12. Kiwix ZIM URL paths are derived from the filename (without extension and date suffix)
The Kiwix serve path for `wikipedia_en_all_nopic_2025-12.zim` is `/wikipedia_en_all_nopic_2025-12`. Confirm with:
```bash
curl -s 'http://localhost:8080/catalog/search?count=50' | grep 'type="text/html"'
```
When adding new ZIM cards to the library page, always verify the path from the catalog before hardcoding it in `KIWIX_BOOKS`.

---

## Deploy / Shell

### 13. `deploy.sh` has a hardcoded file list — new files must be added manually
The script explicitly names every HTML, CSS, and JS file in `scp` and `sudo cp` commands. If you create a new file, you must add it in three places: the scp upload line, the remote sudo cp line, and the cache-bust sed line. There is no wildcard/glob. This is intentional (avoids accidentally deploying drafts) but easy to forget.

### 14. SSH heredocs don't survive multi-hop shell quoting
When trying to run Python scripts via `ssh pi@host "python3 << 'EOF' ... EOF"`, shell quoting breaks because zsh/bash processes the heredoc before SSH sees it. The reliable pattern is:
1. Write the script to a local temp file
2. `scp` it to the Pi
3. `ssh pi@host "python3 /tmp/script.py"`

### 15. Sudoers files must be mode 0440
`visudo -c` will reject sudoers files with wrong permissions with "bad permissions, should be mode 0440". Always `sudo chmod 440 /etc/sudoers.d/yourfile` after creation. A broken sudoers file can lock you out of sudo — visudo -c catches this before it takes effect.

---

## Raspberry Pi 5 / GPIO

### 16. Pi 5 GPIO: use `lgpio`, not `RPi.GPIO`
`RPi.GPIO` doesn't support Pi 5. `lgpio` is the correct library. The relay board is active-LOW (LOW signal = relay ON). This is already correctly implemented in `relay_server.py`.

### 17. GPIO relay restart causes a momentary float → relays can glitch
When `relay_server.py` restarts, GPIO pins float briefly before being initialized to HIGH (OFF). The deploy script deliberately skips the relay service restart if `relay_server.py` hasn't changed — this protects relays (especially CH4 Bilge Pump) from unexpected toggling. Never force-restart relay.service unless the file actually changed.

---

## Browser / JavaScript

### 18. Leaflet `fitBounds` on every waypoint add is disorienting
Calling `map.fitBounds(polyline.getBounds())` every time a waypoint is added causes the map to zoom out to show all waypoints — undoing any manual zoom the user has done. Only auto-fit when the route line first appears (when `wps.length === 2` transitions from 1 to 2 points). After that, let the user control the zoom.

### 19. CSS `auto-fill minmax` creates awkward partial-width columns on wide screens
`grid-template-columns: repeat(auto-fill, minmax(130px, 1fr))` on a 1200px screen creates 9 columns of 133px — not 5. Use explicit breakpoints instead so tiles always fill the full row predictably:
```css
.inst-tiles { grid-template-columns: repeat(2, 1fr); }
@media (min-width: 480px) { .inst-tiles { grid-template-columns: repeat(3, 1fr); } }
@media (min-width: 720px) { .inst-tiles { grid-template-columns: repeat(4, 1fr); } }
@media (min-width: 960px) { .inst-tiles { grid-template-columns: repeat(5, 1fr); } }
```

### 20. Streaming Ollama responses: parse NDJSON line by line, handle partial chunks
The Ollama `/api/chat` response with `stream: true` is newline-delimited JSON. The ReadableStream `reader.read()` chunks don't align with JSON object boundaries — a single `value` from the reader may contain multiple JSON objects, or a partial object split across chunks. Always split by `\n`, skip empty lines, and wrap each `JSON.parse()` in try/catch.

---

## TP22 Autotiller (Simrad)

### 21. TP22 NMEA wiring and Nav mode — dock test results (2026-04-04)

**Wiring:** MacArthur HAT UART4 TX (GPIO12, pin 32) connects to TP22 NMEA IN. The **original wire orientation is correct** — swapping the wires (trying NMEA IN+ vs IN-) caused the TP22 to receive garbage and produce a false alarm beep, not valid nav mode. Leave wires as originally installed.

**Nav mode sentences required:** Both APB and RMB must be sent together at 1 Hz. APB alone is not sufficient to hold nav mode.

```
$GPAPB,A,A,0.10,R,N,V,V,{bearing},T,{wpt_id},{bearing},T,{bearing},T*{cs}
$GPRMB,A,0.10,R,,{wpt_id},{lat},{lon},0.50,{bearing},0.1,V*{cs}
```

**Button sequence:** Press Auto (compass hold), then press Nav while data is streaming.

**Two-beep dropout:** If Nav mode drops immediately with two beeps, the sentences are not reaching the unit or the NMEA data is malformed. Verify checksums and that the `$` prefix is present (easy to lose in shell string handling — use heredoc or Python, never `echo "$..."` in double-quoted SSH commands).

**Dock testing:** Nav mode confirmed working at dock. Speed = 0 is OK. The tiller will deflect toward the commanded bearing.

**Serial port:** `/dev/ttyOP_tp22` → `/dev/ttyAMA4`, 4800 baud, 8N1. UART4 enabled via `dtoverlay=uart4-pi5` in `/boot/firmware/config.txt`.

---

## Hardware / Sensors

### 22. INA226 power monitor — never connect V+ and V- directly to the battery rails

The INA226 breakout board has an **onboard shunt resistor** (~0.1Ω). Connecting V+ to battery positive (12V) and V- to battery negative (0V) places the full 12V across that shunt, drawing ~120A and ~1440W — instant destruction of the chip. In the same incident the 3.3V rail spiked, destroying the ESP32 and BMP280 on the same I2C bus.

**Correct wiring with a marine shunt (e.g. 100A/75mV type):**
- The marine shunt is wired in-line on the battery negative lead between the battery and the loads
- INA226 **VIN+** → small measurement terminal on the battery side of the shunt
- INA226 **VIN-** → small measurement terminal on the load side of the shunt
- At full 100A load, only **75mV** appears across the INA226 sense inputs — well within its ±81.92mV range
- INA226 **VCC** → 3.3V, **GND** → system ground
- V+ and V- on the breakout board are the sense inputs, **not** the power supply pins

**ESPHome config for 100A/75mV shunt:**
```yaml
ina226_shunt_resistance: "0.00075"   # 100A/75mV shunt = 0.00075 Ω
ina226_max_current:      "100.0"     # amps
```

**Never connect INA226 V+ and V- to full battery voltage without an external shunt in the circuit.**
