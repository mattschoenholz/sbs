/* ============================================================
   SBS-SENSOR-TOAST.JS — Sensor health toast + status-dot helpers
   Used by helm.html and index.html.

   Provides:
     <sensor-toast>           — bottom-right toast renderer (single instance,
                                auto-mounted on first import). Listens on
                                SBSData event channel 'sensor:health'.

     <sensor-status-dot
        node-id="sv-esperanza-wind">
                              — small green/amber/red dot reflecting the
                                latest health state for the named node.

     SBSSensorEvents.publish(node_id, severity, message, ts?)
                              — manual emitter (used by polling fallback).

   Backing data flow:
     1) The boat-side relay_server logs sensor events to SQLite at
        /var/lib/sailboat/sensor_events.db and serves the latest per-node
        state at GET /api/sensor_status.
     2) This module polls /api/sensor_status every 5 s and fans out a
        'sensor:health' event with {node_id, severity, message, ts}.
     3) <sensor-toast> renders any non-info severity as a toast with
        auto-dismiss (sticky for 'fault' until the next 'ok' arrives).
     4) <sensor-status-dot> mirrors the latest known state per node.

   The renderer reuses styling tokens from css/sbs-theme.css (--c-red,
   --c-yellow, --c-green) so toasts and dots stay in the existing palette.
   ============================================================ */

(() => {
  const POLL_MS = 5000;
  const STATUS_URL = '/api/sensor_status';

  // ── Data layer ─────────────────────────────────────────────────────────
  const lastByNode = new Map();           // node_id → {severity, message, ts}
  const listeners = new Set();             // ({node_id,...}) => void

  function emit(evt) {
    lastByNode.set(evt.node_id, evt);
    listeners.forEach(fn => { try { fn(evt); } catch (_) {} });
    // Also fan out via SBSData if available — keeps existing alert plumbing in sync.
    if (typeof window !== 'undefined' && window.SBSData && typeof window.SBSData.emit === 'function') {
      window.SBSData.emit('sensor:health', evt);
    }
  }

  async function poll() {
    try {
      const r = await fetch(STATUS_URL, { cache: 'no-store' });
      if (!r.ok) return;
      const rows = await r.json();
      // Expected shape: [{node_id, severity, message, ts}, ...]
      rows.forEach(row => {
        const prev = lastByNode.get(row.node_id);
        if (!prev || prev.ts !== row.ts || prev.severity !== row.severity) {
          emit(row);
        }
      });
    } catch (_) {
      // Silent — offline is the common case at sea, not an error.
    }
  }

  setInterval(poll, POLL_MS);
  // Initial fetch as soon as the module loads.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', poll, { once: true });
  } else {
    poll();
  }

  // ── Public emitter (also used by tests) ────────────────────────────────
  window.SBSSensorEvents = {
    publish(node_id, severity, message, ts) {
      emit({ node_id, severity, message, ts: ts ?? Date.now() / 1000 });
    },
    subscribe(fn) {
      listeners.add(fn);
      // Replay last-known per node so late subscribers (status dots) get state immediately.
      lastByNode.forEach(v => { try { fn(v); } catch (_) {} });
      return () => listeners.delete(fn);
    },
    latest(node_id) {
      return lastByNode.get(node_id);
    },
  };

  // ── <sensor-status-dot node-id="..."> ──────────────────────────────────
  class SensorStatusDot extends HTMLElement {
    static get observedAttributes() { return ['node-id']; }
    connectedCallback() {
      this._unsub = window.SBSSensorEvents.subscribe(evt => {
        if (evt.node_id === this.getAttribute('node-id')) this.render(evt);
      });
      const last = window.SBSSensorEvents.latest(this.getAttribute('node-id'));
      this.render(last || { severity: 'unknown' });
    }
    disconnectedCallback() {
      if (this._unsub) this._unsub();
    }
    attributeChangedCallback() {
      const last = window.SBSSensorEvents.latest(this.getAttribute('node-id'));
      this.render(last || { severity: 'unknown' });
    }
    render(evt) {
      const sev = evt.severity || 'unknown';
      const color = sev === 'fault' ? 'var(--c-red, #d33)'
                  : sev === 'warn'  ? 'var(--c-yellow, #cc0)'
                  : sev === 'ok' || sev === 'info' ? 'var(--c-green, #2c2)'
                  : 'var(--t-secondary, #666)';
      const title = `${this.getAttribute('node-id')}: ${sev}` +
                    (evt.message ? ` — ${evt.message}` : '');
      this.innerHTML =
        `<span title="${title}" style="display:inline-block;` +
        `width:0.65em;height:0.65em;border-radius:50%;` +
        `background:${color};vertical-align:middle;margin-left:4px;"></span>`;
    }
  }
  customElements.define('sensor-status-dot', SensorStatusDot);

  // ── <sensor-toast> — single bottom-right stack ─────────────────────────
  class SensorToast extends HTMLElement {
    connectedCallback() {
      this.style.cssText = 'position:fixed;right:12px;bottom:12px;display:flex;' +
                           'flex-direction:column;gap:6px;z-index:9999;pointer-events:none;';
      this._unsub = window.SBSSensorEvents.subscribe(evt => this._onEvent(evt));
    }
    disconnectedCallback() { if (this._unsub) this._unsub(); }

    _onEvent(evt) {
      // Only render warn/fault. 'ok' transitions clear sticky 'fault' toasts.
      if (evt.severity === 'ok' || evt.severity === 'info') {
        this._clearSticky(evt.node_id);
        return;
      }
      const isFault = evt.severity === 'fault';
      const el = document.createElement('div');
      el.dataset.nodeId = evt.node_id;
      el.dataset.severity = evt.severity;
      el.style.cssText =
        'pointer-events:auto;padding:8px 12px;border-radius:6px;' +
        'font-family:var(--font-mono, monospace);font-size:13px;' +
        'box-shadow:0 2px 6px rgba(0,0,0,0.4);max-width:320px;' +
        'background:' + (isFault
          ? 'var(--c-red-dim, #511)'
          : 'var(--c-yellow-dim, #553)') + ';' +
        'color:' + (isFault
          ? 'var(--c-red, #f66)'
          : 'var(--c-yellow, #fc6)') + ';' +
        'border:1px solid currentColor;';
      el.textContent = `${evt.node_id}: ${evt.message || evt.severity}`;
      this.appendChild(el);
      if (!isFault) {
        setTimeout(() => el.remove(), 6000);
      }
    }
    _clearSticky(nodeId) {
      this.querySelectorAll('div').forEach(d => {
        if (d.dataset.nodeId === nodeId) d.remove();
      });
    }
  }
  customElements.define('sensor-toast', SensorToast);

  // Auto-mount one toast container if none was placed manually.
  document.addEventListener('DOMContentLoaded', () => {
    if (!document.querySelector('sensor-toast')) {
      document.body.appendChild(document.createElement('sensor-toast'));
    }
  }, { once: true });
})();
