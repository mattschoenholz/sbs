/* Library page logic */

const HOST = window.location.hostname;
const KIWIX_URL = `http://${HOST}:8080`;
const OLLAMA_URL = `/ollama`; // nginx-proxied from 127.0.0.1:11434

// ── KIWIX STATUS CHECK ─────────────────────────────────────────
async function checkKiwix() {
  const dot    = document.getElementById('kiwix-dot');
  const text   = document.getElementById('kiwix-status-text');
  const btn    = document.getElementById('kiwix-open-btn');
  if (!dot) return;
  try {
    const res = await fetch(`${KIWIX_URL}/`, { signal: AbortSignal.timeout(3000), mode: 'no-cors' });
    // no-cors: a successful fetch (even opaque) means the server responded
    dot.classList.add('online');
    text.textContent = 'Online';
    btn.href = KIWIX_URL;
    btn.classList.remove('offline');
  } catch {
    dot.classList.remove('online');
    text.textContent = 'Offline';
    btn.classList.add('offline');
  }
}

// ── ADMIN LINK ─────────────────────────────────────────────────
const skLink = document.getElementById('lib-signalk-link');
if (skLink) skLink.href = `http://${HOST}:3000`;

// ── KIWIX COLLECTION LINKS ─────────────────────────────────────
// Map card element IDs to Kiwix ZIM path prefixes (derived from filenames).
// Paths confirmed via /catalog/search on the Pi.
const KIWIX_BOOKS = {
  'kcc-wikipedia':   '/wikipedia_en_all_nopic_2025-12',
  'kcc-wikibooks':   '/wikibooks_en_all_maxi_2026-01',
  'kcc-wikivoyage':  '/wikivoyage_en_all_nopic_2025-12',
  'kcc-ifixit':      '/ifixit_en_all_2025-12',
  'kcc-diy':         '/diy.stackexchange.com_en_all_2026-02',
  'kcc-medical':     '/medicalsciences.stackexchange.com_en_all_2026-02',
  'kcc-mechanics':   '/mechanics.stackexchange.com_en_all_2026-02',
  'kcc-ham':         '/ham.stackexchange.com_en_all_2026-02',
  'kcc-cooking':     '/cooking.stackexchange.com_en_all_2026-02',
  'kcc-outdoors':    '/outdoors.stackexchange.com_en_all_2026-02',
  'kcc-knots':       '/zimgit-knots_en_2024-08',
  'kcc-medicine':    '/zimgit-medicine_en_2024-08',
  'kcc-water':       '/zimgit-water_en_2024-08',
  'kcc-food':        '/zimgit-food-preparation_en_2025-04',
  'kcc-postdisaster':'/zimgit-post-disaster_en_2024-05',
  'kcc-gutenberg':   '/gutenberg_en_lcc-r_2025-12',
};

function wireKiwixCards() {
  for (const [id, path] of Object.entries(KIWIX_BOOKS)) {
    const el = document.getElementById(id);
    if (el) el.href = `${KIWIX_URL}${path}`;
  }
}

// ── AUDIO FILE BROWSER ─────────────────────────────────────────
async function loadAudio() {
  const list = document.getElementById('audio-list');
  if (!list) return;
  try {
    const res  = await fetch('/docs/audio/');
    const html = await res.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const links = [...doc.querySelectorAll('a[href]')]
      .map(a => a.getAttribute('href'))
      .filter(h => /\.(mp3|m4b|opus|ogg|aac)$/i.test(h));

    if (!links.length) return;

    list.innerHTML = links.map(f => {
      const name = decodeURIComponent(f).replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
      const ext  = f.split('.').pop().toUpperCase();
      return `<a class="lib-doc" href="/docs/audio/${f}" target="_blank">
        <span class="lib-doc-icon">🎧</span>
        <div class="lib-doc-info">
          <div class="lib-doc-title">${name}</div>
          <div class="lib-doc-meta">${ext} · /docs/audio/${f}</div>
        </div>
        <span class="lib-doc-arrow">→</span>
      </a>`;
    }).join('');
  } catch { /* keep placeholder */ }
}

// ── KIWIX RESTART ──────────────────────────────────────────────
function initKiwixRestart() {
  const btn = document.getElementById('kiwix-restart-btn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = '↺ Restarting…';
    try {
      const res = await fetch(`http://${HOST}:5000/system/restart-kiwix`, { method: 'POST' });
      const data = await res.json();
      btn.textContent = res.ok ? '✓ Done' : '✗ Failed';
      setTimeout(() => { btn.textContent = '↺ REINDEX'; btn.disabled = false; }, 8000);
    } catch {
      btn.textContent = '✗ Error';
      setTimeout(() => { btn.textContent = '↺ REINDEX'; btn.disabled = false; }, 4000);
    }
  });
}

// ── AI CHAT ────────────────────────────────────────────────────
const AI_MODEL  = 'phi4-mini';
const AI_SYSTEM = `You are the sailing assistant aboard SV Esperanza, a live-aboard cruising sailboat. You are an expert in seamanship, COLREGS (International Regulations for Preventing Collisions at Sea), celestial navigation, weather interpretation, offshore passage planning, engine troubleshooting, boat systems maintenance, and marine first aid. You have the full text of Bowditch, COLREGS, and Pub. 229 available as reference. Be practical, concise, and precise — especially on safety and rules. When relevant, cite the specific rule or table number. You are running offline on a Raspberry Pi 5 aboard the vessel. Each user message will begin with a VESSEL STATE block containing live instrument readings — use these when answering questions about current conditions, routing, or sail trim.`;

// Compass point from degrees
function degToCompass(d) {
  if (d == null) return '---';
  const pts = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return pts[Math.round(((d % 360) + 360) % 360 / 22.5) % 16];
}

function buildBoatContext() {
  const s = (typeof SBSData !== 'undefined') ? SBSData : null;
  if (!s) return '';

  const fmt = (v, dec=1) => v != null ? v.toFixed(dec) : '---';
  const fmtDeg = (v) => v != null ? `${Math.round(((v % 360)+360)%360)}°` : '---';

  const now = new Date();
  const utc = now.toISOString().replace('T', ' ').substring(0, 16) + ' UTC';

  const pos = s.position;
  const posStr = pos && pos.latitude != null
    ? `${Math.abs(pos.latitude).toFixed(4)}°${pos.latitude>=0?'N':'S'} ${Math.abs(pos.longitude).toFixed(4)}°${pos.longitude>=0?'E':'W'}`
    : '---';

  const windDir = s.twd != null ? `${fmtDeg(s.twd)} (${degToCompass(s.twd)})` : '---';

  const t = (typeof SBSData !== 'undefined' && s.t) ? s.t : {};

  // Passage info
  const p = s.passage;
  let passageStr = 'None active';
  if (p && p.waypoints && p.waypoints.length >= 2) {
    const from = p.from || 'current position';
    const to   = p.to   || `${p.waypoints[p.waypoints.length-1].lat.toFixed(3)}°N`;
    const eta  = p.planETA ? new Date(p.planETA).toISOString().replace('T',' ').substring(0,16)+' UTC' : '---';
    const dist = p.totalDist ? `${p.totalDist.toFixed(1)} nm` : '---';
    passageStr = `${from} → ${to} | ${dist} | ETA ${eta}`;
  }

  const lines = [
    `=== SV ESPERANZA — VESSEL STATE (${utc}) ===`,
    `Position : ${posStr}`,
    `SOG      : ${fmt(s.sog)} kt   COG: ${fmtDeg(s.cog)}   Heading: ${fmtDeg(s.heading)}M`,
    `Wind     : ${fmt(s.tws)} kt true from ${windDir}`,
    `Depth    : ${s.depth != null ? (s.depth * 3.28084).toFixed(1)+' ft' : '---'}`,
    `Barometer: ${fmt(s.pressure, 1)} hPa`,
    `Air temp : ${fmt(s.temp, 1)}°F   Cabin: ${fmt(t.cabin, 1)}°F   Engine: ${fmt(t.engine, 1)}°F   Water: ${fmt(t.water, 1)}°F`,
    `Passage  : ${passageStr}`,
    `===`,
    '',
  ];
  return lines.join('\n');
}

let aiReady   = false;
let aiTyping  = false;
const aiMessages = []; // { role, content }

async function checkAI() {
  const dot       = document.getElementById('ai-dot');
  const statusTxt = document.getElementById('ai-status-text');
  const badge     = document.getElementById('ai-model-badge');
  const modelLbl  = document.getElementById('ai-model-label');
  if (!dot) return;
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error('bad status');
    const data = await res.json();
    const models = (data.models || []).map(m => m.name);
    const found = models.find(m => m.startsWith(AI_MODEL));
    if (found) {
      dot.classList.add('online');
      statusTxt.textContent = 'Online';
      badge.textContent = found.split(':')[0];
      badge.classList.add('online');
      modelLbl.textContent = found;
      aiReady = true;
    } else {
      dot.classList.remove('online');
      statusTxt.textContent = 'Model not loaded';
      badge.textContent = 'OFFLINE';
      badge.classList.remove('online');
      modelLbl.textContent = models.length ? models.join(', ') : 'no models';
    }
  } catch {
    dot.classList.remove('online');
    statusTxt.textContent = 'Offline';
    badge.textContent = 'OFFLINE';
    badge.classList.remove('online');
    modelLbl.textContent = '';
    aiReady = false;
  }
}

function scrollMessages() {
  const el = document.getElementById('ai-messages');
  if (el) el.scrollTop = el.scrollHeight;
}

function appendMessage(role, content) {
  const container = document.getElementById('ai-messages');
  if (!container) return;
  const div = document.createElement('div');
  div.className = `ai-msg ai-msg-${role}`;
  const bubble = document.createElement('div');
  bubble.className = 'ai-msg-bubble';
  bubble.textContent = content;
  div.appendChild(bubble);
  container.appendChild(div);
  scrollMessages();
  return bubble; // returned so streaming can update it
}

function showTypingIndicator() {
  const container = document.getElementById('ai-messages');
  if (!container) return null;
  const div = document.createElement('div');
  div.className = 'ai-msg ai-msg-assistant';
  div.id = 'ai-typing-indicator';
  div.innerHTML = '<div class="ai-msg-bubble ai-typing"><span></span><span></span><span></span></div>';
  container.appendChild(div);
  scrollMessages();
  return div;
}

function removeTypingIndicator() {
  const el = document.getElementById('ai-typing-indicator');
  if (el) el.remove();
}

async function sendMessage(userText) {
  if (!userText.trim() || aiTyping) return;
  if (!aiReady) {
    appendMessage('system', 'AI assistant is offline. Check that Ollama is running on the Pi.');
    return;
  }

  aiTyping = true;
  document.getElementById('ai-send-btn').disabled = true;
  document.getElementById('ai-input').disabled = true;

  const context = buildBoatContext();
  const fullContent = context ? context + userText : userText;
  aiMessages.push({ role: 'user', content: fullContent });
  appendMessage('user', userText); // show clean text in UI, context is invisible to user

  const typingEl = showTypingIndicator();

  try {
    const body = {
      model: AI_MODEL,
      messages: [
        { role: 'system', content: AI_SYSTEM },
        ...aiMessages
      ],
      stream: true
    };

    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    removeTypingIndicator();
    const bubble = appendMessage('assistant', '');
    let fullText = '';

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split('\n')) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          if (obj.message?.content) {
            fullText += obj.message.content;
            bubble.textContent = fullText;
            scrollMessages();
          }
        } catch { /* partial JSON — skip */ }
      }
    }

    aiMessages.push({ role: 'assistant', content: fullText });

  } catch (err) {
    removeTypingIndicator();
    appendMessage('system', `Error: ${err.message}`);
  } finally {
    aiTyping = false;
    const sendBtn = document.getElementById('ai-send-btn');
    const input   = document.getElementById('ai-input');
    if (sendBtn) sendBtn.disabled = false;
    if (input) { input.disabled = false; input.focus(); }
  }
}

function initAIChat() {
  const input   = document.getElementById('ai-input');
  const sendBtn = document.getElementById('ai-send-btn');
  if (!input || !sendBtn) return;

  sendBtn.addEventListener('click', () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    input.style.height = 'auto';
    sendMessage(text);
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendBtn.click();
    }
  });

  // auto-resize textarea
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  });

  // quick prompt buttons
  document.querySelectorAll('.ai-qp-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const prompt = btn.dataset.prompt;
      if (!prompt) return;
      input.value = prompt;
      input.dispatchEvent(new Event('input'));
      sendBtn.click();
    });
  });
}

// ── INIT ───────────────────────────────────────────────────────
checkKiwix();
wireKiwixCards();
initKiwixRestart();
loadAudio();
checkAI();
initAIChat();

if (typeof SBSNav !== 'undefined') SBSNav.init();
