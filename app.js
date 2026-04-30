const SVG_NS = 'http://www.w3.org/2000/svg';

const viewport     = document.getElementById('viewport');
const world        = document.getElementById('world');
const chartImg     = document.getElementById('chartImg');
const overlay      = document.getElementById('overlay');
const markBtn      = document.getElementById('markBtn');
const undoBtn      = document.getElementById('undoBtn');
const clearBtn     = document.getElementById('clearBtn');
const fitBtn       = document.getElementById('fitBtn');
const statusEl     = document.getElementById('status');
const cursorCoord  = document.getElementById('cursorCoord');

// Geographic calibration of map.png (page 29 of worksheets.pdf — Hypothetical
// Bay). Slopes are minutes-of-arc per PDF point; image pixel coords are
// converted to PDF points via state.renderScale (image px per point).
const GEO = {
  LON_SLOPE:     0.035655,
  LON_INTERCEPT: 48.983,
  LON_BASE_DEG:  161,
  LAT_SLOPE:     0.035105,
  LAT_INTERCEPT: 47.367,
  LAT_BASE_DEG:  23,
  LAT_HEMI: 'S',
  LON_HEMI: 'E',
};

// The PDF this image was rendered from is A4 (595 pt wide). renderScale
// (image px per PDF point) is derived from the image's natural width once
// it has loaded.
const PDF_PAGE_WIDTH_PT = 595;

const state = {
  ready: false,
  renderScale: 1,
  worldW: 0, worldH: 0,
  zoom: 1, tx: 0, ty: 0,
  marks: [],
  pan: null,
  pressStart: null,
};

// --- image loading -----------------------------------------------------
if (chartImg.complete && chartImg.naturalWidth) onImageReady();
else chartImg.addEventListener('load', onImageReady);
chartImg.addEventListener('error', () => {
  statusEl.textContent =
    'Failed to load map.png — serve over HTTP (e.g. python3 -m http.server) and reload.';
});

function onImageReady() {
  state.worldW = chartImg.naturalWidth;
  state.worldH = chartImg.naturalHeight;
  state.renderScale = state.worldW / PDF_PAGE_WIDTH_PT;
  overlay.setAttribute('width', state.worldW);
  overlay.setAttribute('height', state.worldH);
  overlay.setAttribute('viewBox', `0 0 ${state.worldW} ${state.worldH}`);
  state.ready = true;
  fitToViewport();
  statusEl.textContent = '';
  redraw();
}

// --- view transform ----------------------------------------------------
fitBtn.addEventListener('click', fitToViewport);

function fitToViewport() {
  if (!state.ready) return;
  const r = viewport.getBoundingClientRect();
  const s = Math.min(r.width / state.worldW, r.height / state.worldH) * 0.96;
  state.zoom = s;
  state.tx = (r.width  - state.worldW * s) / 2;
  state.ty = (r.height - state.worldH * s) / 2;
  applyTransform();
}

function applyTransform() {
  world.style.transform =
    `translate(${state.tx}px, ${state.ty}px) scale(${state.zoom})`;
  // Annotation sizes depend on the current zoom (world↔screen). Rebuild the
  // overlay so every position and dimension matches the new zoom; otherwise
  // rectangles, label offsets, and corner radii drift relative to the text
  // they should contain (causing dark "blob" artifacts on heavy re-zoom).
  redraw();
}

// --- coordinate conversion --------------------------------------------
function pixelToLatLon(canvasX, canvasY) {
  const ptX = canvasX / state.renderScale;
  const ptY = canvasY / state.renderScale;
  const lonMin = GEO.LON_SLOPE * ptX + GEO.LON_INTERCEPT;
  const latMin = GEO.LAT_SLOPE * ptY + GEO.LAT_INTERCEPT;
  return {
    lat: GEO.LAT_BASE_DEG + latMin / 60,
    lon: GEO.LON_BASE_DEG + lonMin / 60,
  };
}

function formatCoord(deg, hemi) {
  const d = Math.floor(deg);
  const m = (deg - d) * 60;
  return `${d}°${m.toFixed(2).padStart(5, '0')}' ${hemi}`;
}

function formatLatLon(lat, lon) {
  return `${formatCoord(lat, GEO.LAT_HEMI)}   ${formatCoord(lon, GEO.LON_HEMI)}`;
}

function bearingDeg(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t = Math.atan2(dx, -dy) * 180 / Math.PI;
  if (t < 0) t += 360;
  return t;
}

function formatBearing(deg) {
  return `${deg.toFixed(1).padStart(5, '0')}° T`;
}

function distanceNM(a, b) {
  const A = pixelToLatLon(a.x, a.y);
  const B = pixelToLatLon(b.x, b.y);
  const R = 3440.065;
  const φ1 = A.lat * Math.PI / 180;
  const φ2 = B.lat * Math.PI / 180;
  const dφ = (B.lat - A.lat) * Math.PI / 180;
  const dλ = (B.lon - A.lon) * Math.PI / 180;
  const s1 = Math.sin(dφ / 2);
  const s2 = Math.sin(dλ / 2);
  const h = s1 * s1 + Math.cos(φ1) * Math.cos(φ2) * s2 * s2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function formatDistance(nm) {
  return nm >= 10 ? `${nm.toFixed(1)} NM` : `${nm.toFixed(2)} NM`;
}

// --- input: pointer events for mouse, touch, and pen ------------------
const pointers = new Map();   // pointerId -> {x, y}
let pinchPrev   = null;       // {cx, cy, d} from previous pinch frame
let didPinch    = false;      // true if any pinch happened this gesture

function clientToWorld(clientX, clientY) {
  const r = viewport.getBoundingClientRect();
  return {
    x: (clientX - r.left - state.tx) / state.zoom,
    y: (clientY - r.top  - state.ty) / state.zoom,
  };
}

function zoomAnchored(clientX, clientY, factor) {
  const r = viewport.getBoundingClientRect();
  const sx = clientX - r.left;
  const sy = clientY - r.top;
  const nz = Math.max(0.05, Math.min(30, state.zoom * factor));
  state.tx = sx - ((sx - state.tx) / state.zoom) * nz;
  state.ty = sy - ((sy - state.ty) / state.zoom) * nz;
  state.zoom = nz;
  applyTransform();
}

function pinchSnapshot() {
  const [a, b] = [...pointers.values()];
  return {
    cx: (a.x + b.x) / 2,
    cy: (a.y + b.y) / 2,
    d:  Math.hypot(b.x - a.x, b.y - a.y),
  };
}

function viewportCenter() {
  const r = viewport.getBoundingClientRect();
  return { x: r.width / 2, y: r.height / 2 };
}

function reticleWorld() {
  const c = viewportCenter();
  return {
    x: (c.x - state.tx) / state.zoom,
    y: (c.y - state.ty) / state.zoom,
  };
}

function inBounds(p) {
  return p.x >= 0 && p.x <= state.worldW && p.y >= 0 && p.y <= state.worldH;
}

function updateHud() {
  const w = reticleWorld();
  if (state.ready && inBounds(w)) {
    const { lat, lon } = pixelToLatLon(w.x, w.y);
    cursorCoord.textContent = formatLatLon(lat, lon);
  } else {
    cursorCoord.textContent = '—';
  }
}

function recenterAt(clientX, clientY) {
  const w = clientToWorld(clientX, clientY);
  const c = viewportCenter();
  state.tx = c.x - w.x * state.zoom;
  state.ty = c.y - w.y * state.zoom;
  applyTransform();
}

viewport.addEventListener('wheel', (e) => {
  e.preventDefault();
  zoomAnchored(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015));
}, { passive: false });

viewport.addEventListener('pointerdown', (e) => {
  if (!state.ready) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  viewport.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (pointers.size === 1) {
    state.pressStart = { x: e.clientX, y: e.clientY };
    state.pan = { sx: e.clientX, sy: e.clientY, tx: state.tx, ty: state.ty };
    didPinch = false;
  } else if (pointers.size === 2) {
    state.pan = null;
    pinchPrev = pinchSnapshot();
    didPinch = true;
  }
  e.preventDefault();
});

viewport.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (pointers.size === 1 && state.pan) {
    const dx = e.clientX - state.pan.sx;
    const dy = e.clientY - state.pan.sy;
    if (Math.hypot(dx, dy) > 4) viewport.classList.add('panning');
    state.tx = state.pan.tx + dx;
    state.ty = state.pan.ty + dy;
    applyTransform();
  } else if (pointers.size >= 2 && pinchPrev) {
    const cur = pinchSnapshot();
    const factor = cur.d / pinchPrev.d;
    const nz = Math.max(0.05, Math.min(30, state.zoom * factor));
    state.tx = cur.cx - ((pinchPrev.cx - state.tx) / state.zoom) * nz;
    state.ty = cur.cy - ((pinchPrev.cy - state.ty) / state.zoom) * nz;
    state.zoom = nz;
    pinchPrev = cur;
    applyTransform();
  }
});

function endPointer(e) {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);

  if (pointers.size === 0) {
    const moved = state.pressStart
      ? Math.hypot(e.clientX - state.pressStart.x, e.clientY - state.pressStart.y)
      : Infinity;
    state.pan = null;
    pinchPrev = null;
    viewport.classList.remove('panning');
    if (moved < 6 && !didPinch && state.ready) {
      // Tap recenters the chart on the tapped point so it sits under the
      // crosshair; the toolbar Mark button (or M key) commits it.
      recenterAt(e.clientX, e.clientY);
    }
    state.pressStart = null;
    didPinch = false;
  } else if (pointers.size === 1) {
    // Pinch ended; resume single-finger pan from the surviving pointer.
    const [p] = [...pointers.values()];
    state.pan = { sx: p.x, sy: p.y, tx: state.tx, ty: state.ty };
    state.pressStart = { x: p.x, y: p.y };
    pinchPrev = null;
  }
}

viewport.addEventListener('pointerup',     endPointer);
viewport.addEventListener('pointercancel', endPointer);

function dropMarkAtReticle() {
  const w = reticleWorld();
  if (!state.ready || !inBounds(w)) return;
  const { lat, lon } = pixelToLatLon(w.x, w.y);
  state.marks.push({ x: w.x, y: w.y, lat, lon });
  redraw();
}

markBtn.addEventListener('click', dropMarkAtReticle);
undoBtn.addEventListener('click', () => { state.marks.pop(); redraw(); });
clearBtn.addEventListener('click', () => {
  if (!state.marks.length) return;
  state.marks = [];
  redraw();
});

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    state.marks.pop();
    redraw();
  } else if (e.key === 'm' || e.key === 'M' || e.key === ' ') {
    e.preventDefault();
    dropMarkAtReticle();
  }
});

// Reticle world position depends on viewport size; refresh on resize so the
// HUD readout and the live preview line track the current center.
window.addEventListener('resize', () => { if (state.ready) applyTransform(); });

// --- rendering --------------------------------------------------------
function redraw() {
  while (overlay.firstChild) overlay.removeChild(overlay.firstChild);
  for (let i = 1; i < state.marks.length; i += 2) {
    drawSegment(state.marks[i - 1], state.marks[i], false);
  }
  if (state.marks.length % 2 === 1) {
    const w = reticleWorld();
    if (inBounds(w)) {
      drawSegment(state.marks[state.marks.length - 1], w, true);
    }
  }
  for (const m of state.marks) drawMark(m);
  updateHud();
}

function drawSegment(a, b, preview) {
  if (a.x === b.x && a.y === b.y) return;

  overlay.appendChild(svgEl('line', {
    class: 'seg-line' + (preview ? ' preview' : ''),
    x1: a.x, y1: a.y, x2: b.x, y2: b.y,
  }));

  // Bearing is reported looking FROM the second point TO the first (the anchor).
  const label = `${formatBearing(bearingDeg(b, a))}   ${formatDistance(distanceNM(a, b))}`;
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const off = 16 / state.zoom;
  const nx = -dy / len * off;
  const ny =  dx / len * off;
  const fs = 12 / state.zoom;
  const w = label.length * fs * 0.6 + fs * 0.6;
  const h = fs * 1.5;

  const g = svgEl('g', { transform: `translate(${mid.x + nx}, ${mid.y + ny})` });
  g.appendChild(svgEl('rect', {
    class: 'bearing-bg',
    x: -w / 2, y: -h / 2,
    width: w, height: h, rx: 3 / state.zoom,
  }));
  const t = svgEl('text', {
    class: 'bearing-label',
    x: 0, y: 0,
    'font-size': fs,
    'text-anchor': 'middle',
    'dominant-baseline': 'central',
  });
  t.textContent = label;
  g.appendChild(t);
  overlay.appendChild(g);
}

function drawMark(m) {
  const label = formatLatLon(m.lat, m.lon);
  const fs = 12 / state.zoom;
  overlay.appendChild(svgEl('circle', {
    class: 'mark-dot',
    cx: m.x, cy: m.y, r: 5 / state.zoom,
  }));

  const offset = 10 / state.zoom;
  const w = label.length * fs * 0.6 + fs * 0.6;
  const h = fs * 1.5;
  const g = svgEl('g', { transform: `translate(${m.x + offset}, ${m.y - offset})` });
  g.appendChild(svgEl('rect', {
    class: 'mark-bg',
    x: -fs * 0.3, y: -h + fs * 0.3,
    width: w, height: h, rx: 3 / state.zoom,
  }));
  const t = svgEl('text', {
    class: 'mark-label',
    x: 0, y: 0,
    'font-size': fs,
  });
  t.textContent = label;
  g.appendChild(t);
  overlay.appendChild(g);
}

function svgEl(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}
