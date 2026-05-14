/* ============================================================
   SBS-WIND-CONTROLS.JS — Wind sensor calibration controls
   Triggers the three ESPHome services on sv-esperanza-wind via the
   relay_server proxy at /api/wind/<service>.

   Embedded in helm.html via <wind-cal-controls>. Designed to drop into
   the Nav Station settings drawer — see helm.html for the mount point.
   ============================================================ */

(() => {
  const NODE_ID = 'sv-esperanza-wind';
  const ENDPOINTS = {
    calibrate_direction: '/api/wind/calibrate_direction',
    set_heading_zero:    '/api/wind/set_heading_zero',
    reset_to_factory:    '/api/wind/reset_to_factory',
  };

  async function trigger(service, btn) {
    const url = ENDPOINTS[service];
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = '...';
    try {
      const r = await fetch(url, { method: 'POST' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      btn.textContent = '✓';
      // Surface as an info toast through the same event bus.
      if (window.SBSSensorEvents) {
        window.SBSSensorEvents.publish(NODE_ID, 'warn',
          `cal: ${service} requested`);
      }
    } catch (e) {
      btn.textContent = '✗';
      if (window.SBSSensorEvents) {
        window.SBSSensorEvents.publish(NODE_ID, 'fault',
          `cal: ${service} failed (${e.message})`);
      }
    } finally {
      setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 2000);
    }
  }

  class WindCalControls extends HTMLElement {
    connectedCallback() {
      this.style.cssText =
        'display:flex;flex-direction:column;gap:6px;padding:8px;' +
        'border:1px solid var(--c-border, #333);border-radius:4px;' +
        'background:var(--c-bg-2, #1a1a1a);font-family:var(--font-mono, monospace);font-size:12px;';
      this.innerHTML = `
        <div style="font-weight:bold;display:flex;align-items:center;gap:6px;">
          Wind sensor
          <sensor-status-dot node-id="${NODE_ID}"></sensor-status-dot>
        </div>
        <button data-svc="calibrate_direction"
          title="Enters 5-minute spin-the-vane mode and stores new offsets/gains">
          Calibrate Direction (5 min spin)
        </button>
        <button data-svc="set_heading_zero"
          title="Captures current AWA as 0° offset (point boat into known wind)">
          Set 0° = Current Heading
        </button>
        <button data-svc="reset_to_factory"
          title="Restores bench-measured constants from 2026-04-25">
          Reset to Factory Defaults
        </button>
      `;
      this.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => trigger(btn.dataset.svc, btn));
      });
    }
  }
  customElements.define('wind-cal-controls', WindCalControls);
})();
