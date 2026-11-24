(() => {
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const k in attrs) {
    const v = attrs[k]; if (v == null || v === false) continue;
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) { if (c == null || c === false) continue; e.append(c.nodeType ? c : document.createTextNode(c)); }
  return e;
};
const prefs = {
  get(k, d) { try { const v = localStorage.getItem('cr.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('cr.' + k, JSON.stringify(v)); } catch (e) { /* storage may be unavailable */ } }
};
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const reduced = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const CSCALE = 0.30; // saturation slider 0..100 maps to chroma 0..0.30

/* Each built-in color carries its own tolerances, because color names cover different ranges:
   "blue" runs from navy to pale sky, while dark orange stops being orange and becomes brown. */
const SWATCHES = [
  { id: 'red', name: 'Red', L: .55, C: .21, H: 27, tH: 20, tL: .25, tC: .11 },
  { id: 'orange', name: 'Orange', L: .72, C: .17, H: 55, tH: 22, tL: .18, tC: .09 },
  { id: 'yellow', name: 'Yellow', L: .88, C: .17, H: 98, tH: 22, tL: .14, tC: .10 },
  { id: 'green', name: 'Green', L: .60, C: .17, H: 142, tH: 30, tL: .32, tC: .13 },
  { id: 'aqua', name: 'Aqua', L: .65, C: .12, H: 195, tH: 28, tL: .32, tC: .085 },
  { id: 'blue', name: 'Blue', L: .58, C: .17, H: 255, tH: 30, tL: .34, tC: .13 },
  { id: 'purple', name: 'Purple', L: .55, C: .19, H: 300, tH: 24, tL: .30, tC: .14 },
  { id: 'pink', name: 'Pink', L: .72, C: .20, H: 350, tH: 24, tL: .20, tC: .14 },
  { id: 'brown', name: 'Brown', L: .48, C: .085, H: 55, tH: 28, tL: .22, tC: .045 },
  { id: 'white', name: 'White', L: .95, C: 0, H: 0, tH: 24, tL: .12, tC: .06 },
  { id: 'grey', name: 'Grey', L: .58, C: 0, H: 0, tH: 24, tL: .25, tC: .05 },
  { id: 'black', name: 'Black', L: .12, C: 0, H: 0, tH: 24, tL: .16, tC: .08 }];
const EMOJI = ['🍊', '🍋', '🍓', '🫐', '🥝', '🍇', '🌸', '🌊', '🌿', '📷', '⭐', ''];
const APP = 'Satsuma';
const TIP_URL = ''; // paste a Ko-fi / Buy Me a Coffee / GitHub Sponsors link here and a "Tip jar" link shows on the first page

function colorName(c) {
  const C = Engine.fit(c.L, c.C, c.H);
  if (C < 0.04) return c.L > 0.8 ? 'White' : c.L < 0.3 ? 'Black' : 'Grey';
  if (c.H >= 40 && c.H < 110 && c.L >= 0.75 && C < 0.08) return 'Beige';
  if (c.H >= 25 && c.H < 85 && c.L < 0.6 && C < 0.14) return 'Brown';
  if (c.H >= 85 && c.H < 125 && c.L < 0.72 && C < 0.13) return 'Olive';
  const A = [[0, 'Pink'], [27, 'Red'], [55, 'Orange'], [98, 'Yellow'], [142, 'Green'], [195, 'Aqua'], [255, 'Blue'], [300, 'Purple'], [350, 'Pink'], [387, 'Red']];
  let best = A[0]; for (const a of A) if (Math.abs(a[0] - c.H) < Math.abs(best[0] - c.H)) best = a;
  return best[1];
}
const css = c => Engine.lchCss(c.L, c.C, c.H);

/* ---------- storage: IndexedDB when the browser allows it, memory otherwise ---------- */
const DB = {
  db: null, mem: { albums: new Map(), photos: new Map(), views: new Map(), presets: new Map() },
  async open() {
    try {
      this.db = await new Promise((res, rej) => {
        const r = indexedDB.open('color-roll', 1);
        r.onupgradeneeded = () => { for (const s of Object.keys(this.mem)) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s, { keyPath: 'id' }); };
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); r.onblocked = () => rej(new Error('blocked'));
        setTimeout(() => rej(new Error('timeout')), 4000);
      });
    } catch (e) { this.db = null; }
    return !!this.db;
  },
  run(s, mode, fn) { return new Promise((res, rej) => { const t = this.db.transaction(s, mode), r = fn(t.objectStore(s)); t.oncomplete = () => res(r && r.result); t.onerror = t.onabort = () => rej(t.error); }); },
  async all(s) { let out = []; if (this.db) try { out = await this.run(s, 'readonly', o => o.getAll()); } catch (e) { /* fall through */ } return out.concat([...this.mem[s].values()]); },
  async get(s, id) { if (this.db) try { const v = await this.run(s, 'readonly', o => o.get(id)); if (v) return v; } catch (e) { /* fall through */ } return this.mem[s].get(id); },
  async put(s, v) { if (this.db) try { await this.run(s, 'readwrite', o => o.put(v)); return true; } catch (e) { /* quota or private mode */ } this.mem[s].set(v.id, v); return false; },
  async del(s, id) { this.mem[s].delete(id); if (this.db) try { await this.run(s, 'readwrite', o => o.delete(id)); } catch (e) { /* ignore */ } }
};

/* ---------- state ---------- */
const pick = (v, list, d) => list.includes(v) ? v : d;
const S = {
  albums: [], photos: new Map(), presets: [], albumId: null,
  color: null, sw: null, draft: { L: .72, C: .17, H: 55 },
  tol: { tH: 24, tL: .20, tC: .10 },
  bands: prefs.get('bands', [false, true, true, true]),
  order: prefs.get('order', 'best'), balance: prefs.get('balance', true),
  look: prefs.get('look', 'light') === 'dark' ? 'dark' : 'light',
  other: null, adding: false, select: null,
  albumList: pick(prefs.get('albums', prefs.get('albumView', 'cards') === 'cols' ? 'grid' : 'list'), ['list', 'grid'], 'list'),
  compact: !!prefs.get('compact', prefs.get('albumView', 'cards') === 'list'),
  base: { color: { L: .72, C: .17, H: 55 }, tol: { tH: 24, tL: .20, tC: .10 }, sw: null },
  detailId: null, dMode: 'match', dSrc: null, persisted: true, busy: false, result: null
};
const tiles = new Map();
const album = () => S.albums.find(a => a.id === S.albumId);
const albumPhotos = id => [...S.photos.values()].filter(p => p.albumId === (id || S.albumId));

/* ---------- importing ---------- */
async function decode(blob) {
  if (window.createImageBitmap) { try { return await createImageBitmap(blob); } catch (e) { /* try <img> */ } }
  return new Promise((res, rej) => { const u = URL.createObjectURL(blob), im = new Image(); im.onload = () => res(im); im.onerror = () => { URL.revokeObjectURL(u); rej(new Error('decode')); }; im.src = u; });
}
function scaled(src, w, h, max) {
  const k = Math.min(1, max / Math.max(w, h)), c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
  const x = c.getContext('2d', { willReadFrequently: max <= 128 }); x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, c.width, c.height);
  return c;
}
const toBuf = (canvas, type, q) => new Promise((res, rej) => canvas.toBlob(b => b ? b.arrayBuffer().then(res, rej) : rej(new Error('encode')), type, q));
/* Capture time and GPS position from a JPEG's EXIF block. Returns {date, lat, lon}, any of them possibly missing. */
function exif(buf) {
  const out = {};
  try {
    const v = new DataView(buf); if (v.getUint16(0) !== 0xFFD8) return out;
    let o = 2;
    while (o + 4 < v.byteLength) {
      const mk = v.getUint16(o), len = v.getUint16(o + 2);
      if ((mk & 0xFF00) !== 0xFF00 || mk === 0xFFDA) break;
      if (mk === 0xFFE1 && v.getUint32(o + 4) === 0x45786966) {
        const t = o + 10, le = v.getUint16(t) === 0x4949, u16 = x => v.getUint16(x, le), u32 = x => v.getUint32(x, le);
        const find = (ifd, tag) => { const n = u16(ifd); for (let i = 0; i < n; i++) { const e = ifd + 2 + i * 12; if (u16(e) === tag) return e; } return 0; };
        const str = e => { if (!e) return null; const n = u32(e + 4), off = t + u32(e + 8); let s = ''; for (let i = 0; i < n - 1; i++) s += String.fromCharCode(v.getUint8(off + i)); return s; };
        const ifd0 = t + u32(t + 4), ex = find(ifd0, 0x8769), gp = find(ifd0, 0x8825);
        let s = null; if (ex) { const ifd = t + u32(ex + 8); s = str(find(ifd, 0x9003)) || str(find(ifd, 0x9004)); }
        s = s || str(find(ifd0, 0x0132));
        const m = s && s.match(/^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/);
        if (m) { const d = new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime(); if (!isNaN(d)) out.date = d; }
        try {
          if (gp) {
            const g = t + u32(gp + 8), deg = e => { const off = t + u32(e + 8); let d = 0; for (let k = 0; k < 3; k++) d += (u32(off + k * 8) / (u32(off + k * 8 + 4) || 1)) / Math.pow(60, k); return d; };
            const la = find(g, 2), lo = find(g, 4), laR = find(g, 1), loR = find(g, 3);
            if (la && lo) {
              let lat = deg(la), lon = deg(lo);
              if (laR && String.fromCharCode(v.getUint8(laR + 8)) === 'S') lat = -lat;
              if (loR && String.fromCharCode(v.getUint8(loR + 8)) === 'W') lon = -lon;
              if (isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && (lat || lon)) { out.lat = lat; out.lon = lon; }
            }
          }
        } catch (e) { /* GPS block ran past what we read */ }
        return out;
      }
      o += 2 + len;
    }
  } catch (e) { /* not a readable EXIF block */ }
  return out;
}
async function photoMeta(blob) {
  let x = {};
  if (/jpe?g/i.test(blob.type || '')) { try { x = exif(await blob.slice(0, 262144).arrayBuffer()); } catch (e) { /* fall through */ } }
  return { date: x.date || blob.lastModified || Date.now(), dp: x.date ? 'time' : 'day', lat: x.lat, lon: x.lon };
}
/* items: [{blob, name, date?, dp?}] */
async function importItems(items, albumId, onStep) {
  let ok = 0, bad = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    try {
      const src = await decode(it.blob), sw = src.width || src.naturalWidth, sh = src.height || src.naturalHeight;
      if (!sw || !sh) throw new Error('empty');
      const view = scaled(src, sw, sh, 900), thumb = scaled(view, view.width, view.height, 256), tiny = scaled(thumb, thumb.width, thumb.height, 128);
      if (src.close) src.close(); else if (src.src) URL.revokeObjectURL(src.src);
      const rec = Engine.analyze(tiny.getContext('2d').getImageData(0, 0, tiny.width, tiny.height).data);
      const type = rec.alpha ? 'image/png' : 'image/jpeg';
      const [tb, vb] = await Promise.all([toBuf(thumb, type, .82), toBuf(view, type, .86)]);
      const meta = it.date ? { date: it.date, dp: it.dp || 'day' } : await photoMeta(it.blob);
      const p = { id: uid(), albumId, name: it.name || '', w: view.width, h: view.height, n: rec.n, c: rec.c, L: rec.L, a: rec.a, b: rec.b, ...meta };
      const kept = await DB.put('photos', { ...p, tb, tt: type }) && await DB.put('views', { id: p.id, buf: vb, type });
      if (!kept) S.persisted = false;
      p.url = URL.createObjectURL(new Blob([tb], { type })); S.photos.set(p.id, p); ok++;
    } catch (e) { bad++; }
    if (onStep) onStep(i + 1, items.length);
    if (i % 3 === 2) await new Promise(r => setTimeout(r));
  }
  return { ok, bad };
}
function dataBlob(u) { const i = u.indexOf(','), bin = atob(u.slice(i + 1)), a = new Uint8Array(bin.length); for (let j = 0; j < bin.length; j++) a[j] = bin.charCodeAt(j); return new Blob([a], { type: u.slice(5, u.indexOf(';')) }); }
async function seed() {
  let items = [], name = 'deck samples';
  if (typeof SAMPLES === 'string') {
    const base = SAMPLES.replace(/[^/]*$/, ''), j = await (await fetch(SAMPLES)).json(); name = j.album || 'samples';
    for (const f of j.photos) items.push({ blob: await (await fetch(base + f.file)).blob(), name: f.name || f.file, date: Date.now(), dp: 'month' });
  } else items = SAMPLES.map((s, i) => ({ blob: dataBlob(s.u), name: 'sample ' + (i + 1), date: new Date(s.d).getTime(), dp: 'month' }));
  if (!items.length) return null;
  const a = { id: uid(), name, emoji: '🍊', created: Date.now(), sample: true };
  S.albums.push(a); await DB.put('albums', a);
  await importItems(items, a.id);
  return a;
}
async function addFiles(files) {
  const items = [...files].filter(f => !f.type || f.type.startsWith('image/')).map(f => ({ blob: f, name: f.name }));
  if (!items.length || S.busy) return;
  S.busy = true; const bar = $('#progress'); bar.hidden = false;
  const r = await importItems(items, S.albumId, (i, n) => { bar.firstElementChild.style.width = (100 * i / n) + '%'; $('#count').textContent = `Adding ${i} of ${n}`; });
  S.busy = false; bar.hidden = true; bar.firstElementChild.style.width = '0';
  refresh(true);
  if (r.bad) toast(`${r.bad} ${r.bad === 1 ? 'file' : 'files'} couldn't be read. HEIC and RAW photos need converting to JPEG first.`);
  else if (!S.persisted) toast('Added, but this browser won\'t keep them after you close the page.');
}

/* ---------- matching ---------- */
const queryOf = c => Engine.query({ ...c.color, ...c.tol });
const names = () => [S.color, S.other && S.other.color].filter(Boolean).map(c => colorName(c).toLowerCase()).join(' + ');
/* With two colors a photo needs both. Its coverage is the smaller of the two, so the weaker color decides the band. */
function matchBoth(p, q, q2) {
  const m = Engine.match(p, q, S.balance); if (!q2) return m;
  const n = Engine.match(p, q2, S.balance), cov = Math.min(m.coverage, n.coverage);
  return { coverage: cov, closeness: (m.closeness + n.closeness) / 2, score: Math.sqrt(m.score * n.score), band: Engine.band(cov), a: m.coverage, b: n.coverage };
}
function compute() {
  const photos = albumPhotos();
  if (!S.color) return { active: false, total: photos.length, list: photos.map(p => ({ p, m: null })), counts: [0, 0, 0, 0] };
  const q = queryOf(S), q2 = S.other ? queryOf(S.other) : null, counts = [0, 0, 0, 0], list = [];
  for (const p of photos) { const m = matchBoth(p, q, q2); if (m.band >= 0) { counts[m.band]++; if (S.bands[m.band]) list.push({ p, m }); } }
  return { active: true, total: photos.length, list, counts, q };
}

/* ---------- album screen ---------- */
let pressT = 0, skipClick = false;
function tileFor(p) {
  let t = tiles.get(p.id);
  if (!t) {
    t = el('button', { class: 'tile', type: 'button', 'data-id': p.id, onclick: () => { if (skipClick) { skipClick = false; return; } S.select ? toggleSel(p.id) : openDetail(p.id); },
      onpointerdown: () => { clearTimeout(pressT); pressT = setTimeout(() => { if (!S.select) { skipClick = true; enterSelect(p.id); } }, 480); }, onpointerup: () => clearTimeout(pressT), onpointerleave: () => clearTimeout(pressT), onpointercancel: () => clearTimeout(pressT), oncontextmenu: e => e.preventDefault() },
      el('img', { src: p.url, alt: p.name || 'Photo', loading: 'lazy', decoding: 'async' }), el('span', { class: 'tag', hidden: true }));
    tiles.set(p.id, t);
  }
  return t;
}
function section(title, n, items) {
  return el('section', { class: 'sec' }, title ? el('h3', {}, title, el('span', { text: String(n) })) : null,
    el('div', { class: 'tiles' }, items.map(({ p, m }) => {
      const t = tileFor(p), tag = t.lastElementChild;
      const pc = v => Math.max(1, Math.round(v * 100));
      tag.hidden = !m; if (m) tag.textContent = m.a != null ? `${pc(m.a)}+${pc(m.b)}%` : pc(m.coverage) + '%';
      t.classList.toggle('sel', !!(S.select && S.select.has(p.id)));
      return t;
    })));
}
function snapshot() {
  const m = new Map(), g = $('#grid').getBoundingClientRect();
  for (const t of $('#grid').querySelectorAll('.tile')) { const r = t.getBoundingClientRect(); if (r.bottom > g.top - 300 && r.top < g.bottom + 300) m.set(t.dataset.id, r); }
  return m;
}
function play(first) {
  const all = [...$('#grid').querySelectorAll('.tile')], g = $('#grid').getBoundingClientRect(); let fresh = 0;
  for (const t of all) {
    const r = t.getBoundingClientRect(); if (r.top > g.bottom) break;
    const f = first.get(t.dataset.id);
    if (f) { const dx = f.left - r.left, dy = f.top - r.top; if (dx || dy) t.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.2,.75,.15,1)' }); }
    else t.animate([{ opacity: 0, transform: 'scale(.8)' }, { opacity: 1, transform: 'none' }], { duration: 260, delay: Math.min(fresh++ * 14, 220), easing: 'ease-out', fill: 'backwards' });
  }
}
function renderGrid(animate) {
  const R = S.result = compute(), grid = $('#grid'), a = album();
  const first = animate && !reduced() && grid.childElementCount && R.total <= 400 ? snapshot() : null;
  const out = [], name = names();
  if (!R.total) {
    out.push(el('div', { class: 'empty' }, el('b', { text: 'No photos yet' }), el('p', { text: 'Add some from your library. On a computer you can also drop them here.' }),
      el('button', { class: 'btn primary', type: 'button', text: 'Add photos', onclick: () => $('#file').click() })));
  } else if (!R.list.length) {
    const hidden = R.counts.reduce((s, n, i) => s + (S.bands[i] ? 0 : n), 0);
    out.push(el('div', { class: 'empty' }, el('b', { text: `No photos with this much ${name}` }),
      el('p', { text: hidden ? `${hidden} ${hidden === 1 ? 'photo has' : 'photos have'} it in an amount you've filtered out.` : 'Try a wider tolerance, or pick a nearby color.' }),
      hidden ? el('button', { class: 'btn', type: 'button', text: 'Show every amount', onclick: () => { S.bands = [true, true, true, true]; savePrefs(); refresh(true); } })
        : el('button', { class: 'btn', type: 'button', text: 'Open color settings', onclick: openSheet })));
  } else if (!R.active || S.order === 'date') {
    const byMonth = new Map();
    for (const it of [...R.list].sort((x, y) => y.p.date - x.p.date)) { const d = new Date(it.p.date), k = d.getFullYear() * 12 + d.getMonth(); if (!byMonth.has(k)) byMonth.set(k, []); byMonth.get(k).push(it); }
    for (const [k, items] of byMonth) out.push(section(`${MONTHS[k % 12]} ${Math.floor(k / 12)}`, items.length, items));
  } else if (S.order === 'most') {
    const sorted = [...R.list].sort((x, y) => y.m.coverage - x.m.coverage);
    for (let b = 3; b >= 0; b--) { const items = sorted.filter(it => it.m.band === b); if (items.length) out.push(section(Engine.BANDS[b].label, items.length, items)); }
  } else out.push(section('', 0, [...R.list].sort((x, y) => y.m.score - x.m.score)));
  if (animate) grid.scrollTop = 0;
  grid.replaceChildren(...out);
  if (first) play(first);
  if (!S.busy) $('#count').textContent = !R.active ? `${R.total} ${R.total === 1 ? 'photo' : 'photos'}` : `${R.list.length} of ${R.total} have ${name}`;
  if (S.adding && !S.busy) $('#count').textContent = 'Pick a second color';
  $('#countDot').hidden = !R.active; $('#order').hidden = !R.active; $('#countDot2').hidden = !S.other; if (S.other) $('#countDot2').style.background = css(S.other.color);
  grid.classList.toggle('selecting', !!S.select);
  for (const b of $('#order').children) b.setAttribute('aria-pressed', String(b.dataset.order === S.order));
  $('#albumName').replaceChildren(a && a.emoji ? el('span', { class: 'emo', text: a.emoji }) : null, a ? a.name : '');
}
/* One color button. The look of it comes from the style picked on the first page. */
function swatch(c, o = {}) {
  const btn = !!o.fn;
  return el(btn ? 'button' : 'span', { class: 'sw' + (o.on ? ' on' : '') + (o.on || o.saved || o.custom ? ' fill' : '') + (o.saved ? ' saved' : ''), type: btn ? 'button' : null,
    style: `--c:${css(c)}`, 'aria-label': btn ? o.label : null, 'aria-pressed': btn ? String(!!o.on) : null, title: btn ? o.label : null, onclick: o.fn }, el('i'));
}
function renderSwatches() {
  const kids = [], o = S.other;
  if (S.color && !S.sw) kids.push(swatch(S.color, { on: true, custom: true, label: 'Custom ' + colorName(S.color).toLowerCase() + '. Tap to clear.', fn: clearColor }));
  if (o && !o.sw) kids.push(swatch(o.color, { on: true, custom: true, label: 'Second color, custom ' + colorName(o.color).toLowerCase() + '. Tap to remove.', fn: dropOther }));
  if (kids.length) kids.push(el('span', { class: 'sep' }));
  for (const s of SWATCHES) kids.push(swatch(s, { on: S.sw === s.id || !!(o && o.sw === s.id), label: s.name, fn: () => pickSwatch(s) }));
  if (S.presets.length) kids.push(el('span', { class: 'sep' }));
  for (const p of S.presets) kids.push(swatch(p.color, { on: S.sw === p.id || !!(o && o.sw === p.id), saved: true, label: 'Saved: ' + p.name, fn: () => applyPreset(p) }));
  $('#swatches').replaceChildren(...kids);
  const add = $('#addColor'); add.hidden = !S.color || !!S.other; add.setAttribute('aria-pressed', String(S.adding));
  document.documentElement.style.setProperty('--pick', S.color ? css(S.color) : 'var(--mute)');
}
/* Two colors at most. The one the panel edits lives in S.color / S.tol / S.sw; the second one waits in S.other. */
const slot = () => ({ color: { ...S.color }, tol: { ...S.tol }, sw: S.sw, base: S.base });
function load(o) { S.color = { ...o.color }; S.draft = { ...o.color }; S.tol = { ...o.tol }; S.sw = o.sw; S.base = o.base; }
function makeRoom() { if (S.adding && S.color) S.other = slot(); S.adding = false; }
function dropOther() { S.other = null; refresh(true); }
function swapColors() { if (!S.other) return; const o = S.other; S.other = slot(); load(o); refresh(false); }
function clearColor() { S.adding = false; if (S.other) { const o = S.other; S.other = null; load(o); } else { S.color = null; S.sw = null; } refresh(true); }
function pickSwatch(s) {
  if (S.sw === s.id) return clearColor();
  if (S.other && S.other.sw === s.id) return dropOther();
  makeRoom();
  S.color = { L: s.L, C: s.C, H: s.H }; S.draft = { ...S.color }; S.tol = { tH: s.tH, tL: s.tL, tC: s.tC }; S.sw = s.id; setBase(); refresh(true);
}
function applyPreset(p) {
  if (S.sw === p.id) return clearColor();
  if (S.other && S.other.sw === p.id) return dropOther();
  makeRoom();
  S.color = { ...p.color }; S.draft = { ...p.color }; S.tol = { ...p.tol }; S.bands = [...p.bands]; S.balance = p.balance; S.sw = p.id;
  setBase(); savePrefs(); refresh(true);
}
/* Search for a color lifted from a photo. Tight tolerances, since it is an exact color and not a color name. */
function pickFromPalette(c) {
  makeRoom();
  S.color = { L: c.L, C: Math.min(c.C, CSCALE), H: c.H }; S.draft = { ...S.color }; S.sw = null; S.dMode = 'match';
  S.tol = c.C < 0.04 ? { tH: 24, tL: .12, tC: .06 } : { tH: 20, tL: .16, tC: .06 };
  setBase(); refresh(false);
}
/* What the little reset arrows go back to: the color button, saved color or photo color you started from. */
function setBase() { S.base = { color: { ...S.color }, tol: { ...S.tol }, sw: S.sw }; }
const SLIDE = { cH: v => v.H, cC: v => v.C / CSCALE * 100, cL: v => v.L * 100, tH: v => v.tH, tC: v => v.tC / CSCALE * 100, tL: v => v.tL * 100 };
function resetOne(id) {
  const k = id[1];
  if (id[0] === 'c') { S.draft = { ...(S.color || S.draft), [k]: S.base.color[k] }; if (S.color) S.color = { ...S.draft }; }
  else S.tol = { ...S.tol, ['t' + k]: S.base.tol['t' + k] };
  /* sliders move in whole steps, so "back at the start" is judged at slider resolution, then snapped exactly */
  const same = (ids, a, b) => ids.every(i => Math.round(SLIDE[i](a)) === Math.round(SLIDE[i](b)));
  const tolSame = same(['tH', 'tC', 'tL'], S.tol, S.base.tol); if (tolSame) S.tol = { ...S.base.tol };
  if (S.color && same(['cH', 'cC', 'cL'], S.color, S.base.color)) { S.color = { ...S.base.color }; S.draft = { ...S.color }; if (S.base.sw && (tolSame || SWATCHES.some(x => x.id === S.base.sw))) S.sw = S.base.sw; }
  refresh(false);
}
function savePrefs() { prefs.set('bands', S.bands); prefs.set('balance', S.balance); prefs.set('order', S.order); }
let raf = 0;
function refresh(animate) { renderSwatches(); renderGrid(animate); syncSheet(); if (S.detailId) renderDetail(); }
function refreshSoon() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; refresh(false); }); }

/* ---------- settings sheet ---------- */
function track(fn, n = 12) { const st = []; for (let i = 0; i <= n; i++) st.push(fn(i / n)); return `linear-gradient(to right, ${st.join(',')})`; }
function syncSheet() {
  const d = S.color || S.draft, fitC = Engine.fit(d.L, d.C, d.H);
  $('#sheetName').textContent = S.color ? colorName(S.color) : 'No color picked';
  const sw = $('#swapColor'); sw.hidden = !S.other; if (S.other) { sw.replaceChildren(el('i', { style: `background:${css(S.other.color)}` }), 'edit ' + colorName(S.other.color).toLowerCase()); sw.setAttribute('aria-label', `Switch the sliders to ${colorName(S.other.color).toLowerCase()}`); }
  const show = (out, pm, n, unit) => $(out).replaceChildren(...(pm ? [el('i', { text: '±' })] : []), el('i', { class: 'nm', text: String(n) }), el('i', { class: 'un', text: unit }));
  const set = (id, v, out, n, unit) => { const i = $(id); if (document.activeElement !== i) i.value = v; show(out, false, n, unit); };
  set('#cH', Math.round(d.H), '#oH', Math.round(d.H), '°');
  set('#cC', Math.round(d.C / CSCALE * 100), '#oC', Math.round(fitC / CSCALE * 100), '');
  set('#cL', Math.round(d.L * 100), '#oL', Math.round(d.L * 100), '');
  $('#cH').style.setProperty('--track', track(t => Engine.lchCss(d.L, Math.max(d.C, .08), t * 360), 18));
  $('#cC').style.setProperty('--track', track(t => Engine.lchCss(d.L, t * CSCALE, d.H)));
  $('#cL').style.setProperty('--track', track(t => Engine.lchCss(.05 + t * .93, d.C, d.H)));
  const fill = (id, v, out, text) => { const i = $(id); if (document.activeElement !== i) i.value = v; const p = (i.value - i.min) / (i.max - i.min) * 100; i.style.setProperty('--track', `linear-gradient(to right, var(--ink) ${p}%, transparent ${p}%)`); show(out, true, v, text); };
  fill('#tH', Math.round(S.tol.tH), '#otH', '°');
  fill('#tC', Math.round(S.tol.tC / CSCALE * 100), '#otC', '');
  fill('#tL', Math.round(S.tol.tL * 100), '#otL', '');
  for (const b of document.querySelectorAll('.rst')) { const id = b.dataset.reset, f = SLIDE[id]; b.disabled = Math.round(f(id[0] === 'c' ? d : S.tol)) === Math.round(f(id[0] === 'c' ? S.base.color : S.base.tol)); }
  const R = S.result || { counts: [0, 0, 0, 0], active: false };
  $('#bands').replaceChildren(...Engine.BANDS.map((b, i) => el('button', {
    class: 'chip', type: 'button', 'aria-pressed': String(S.bands[i]),
    onclick: () => { const next = [...S.bands]; next[i] = !next[i]; if (!next.some(Boolean)) return; S.bands = next; savePrefs(); refresh(true); }
  }, `${b.label} ${Math.round(b.lo * 100)}${b.hi > 1 ? '%+' : '–' + Math.round(b.hi * 100) + '%'}`, R.active ? el('small', { text: String(R.counts[i]) }) : null)));
  $('#balance').checked = S.balance;
  $('#savePreset').disabled = !S.color; $('#savePreset').style.opacity = S.color ? 1 : .45;
  $('#presets').replaceChildren(...S.presets.map(p => el('div', { class: 'preset' },
    el('span', { class: 'dot', style: `background:${css(p.color)}` }),
    el('button', { class: 'name', type: 'button', onclick: () => applyPreset(p) }, p.name, el('small', { text: `±${Math.round(p.tol.tH)}°` })),
    el('button', { class: 'icon', type: 'button', 'aria-label': 'Delete saved color ' + p.name, style: 'width:32px;height:32px', onclick: async () => { S.presets = S.presets.filter(x => x.id !== p.id); await DB.del('presets', p.id); if (S.sw === p.id) S.sw = null; refresh(false); } }, '×'))));
}
function openSheet() { closeMenu(); $('#sheet').classList.remove('closed'); $('#sheet').inert = false; syncSheet(); }
function closeSheet() { hideTip(); $('#sheet').classList.add('closed'); $('#sheet').inert = true; }
function bindSheet() {
  const colorIn = () => {
    S.draft = { H: +$('#cH').value, C: $('#cC').value / 100 * CSCALE, L: $('#cL').value / 100 };
    S.color = { ...S.draft }; S.sw = null; refreshSoon();
  };
  for (const id of ['#cH', '#cC', '#cL']) $(id).addEventListener('input', colorIn);
  const tolIn = () => { S.tol = { tH: +$('#tH').value, tC: $('#tC').value / 100 * CSCALE, tL: $('#tL').value / 100 }; if (S.sw && !SWATCHES.some(s => s.id === S.sw)) S.sw = null; refreshSoon(); };
  for (const id of ['#tH', '#tC', '#tL']) $(id).addEventListener('input', tolIn);
  for (const b of document.querySelectorAll('.rst')) b.addEventListener('click', () => resetOne(b.dataset.reset));
  $('#balance').addEventListener('change', e => { S.balance = e.target.checked; savePrefs(); refresh(true); });
  $('#sheetClose').addEventListener('click', closeSheet); $('#swapColor').addEventListener('click', swapColors);
  $('#addColor').addEventListener('click', () => { S.adding = !S.adding; refresh(false); });
  $('#fab').addEventListener('click', () => $('#sheet').classList.contains('closed') ? openSheet() : closeSheet());
  $('.sheet-body').addEventListener('scroll', hideTip, { passive: true });
  $('#savePreset').addEventListener('click', async () => {
    if (!S.color) return;
    const base = colorName(S.color), n = S.presets.filter(p => p.name.startsWith(base)).length;
    const p = { id: uid(), name: n ? `${base} ${n + 1}` : base, color: { ...S.color }, tol: { ...S.tol }, bands: [...S.bands], balance: S.balance, created: Date.now() };
    S.presets.push(p); await DB.put('presets', p); S.sw = p.id; refresh(false); toast(`Saved as ${p.name}`);
  });
}

/* ---------- info pop-ups: hover shows, click pins ---------- */
let pinned = null;
function showTip(btn) {
  const tip = $('#tip'), a = $('#app').getBoundingClientRect(), r = btn.getBoundingClientRect(), w = Math.min(250, a.width - 32);
  tip.textContent = btn.dataset.tip; tip.hidden = false; tip.style.width = w + 'px';
  tip.style.left = Math.max(16, Math.min(a.width - w - 16, r.left - a.left + r.width / 2 - w / 2)) + 'px';
  const h = tip.offsetHeight; let y = r.bottom - a.top + 8; if (y + h > a.height - 8) y = r.top - a.top - h - 8;
  tip.style.top = y + 'px'; btn.setAttribute('aria-expanded', 'true');
}
function hideTip() { $('#tip').hidden = true; pinned = null; for (const b of document.querySelectorAll('.info[aria-expanded="true"]')) b.setAttribute('aria-expanded', 'false'); }
function bindTips() {
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('.info');
    if (b) { e.preventDefault(); const again = pinned === b; hideTip(); if (!again) { showTip(b); pinned = b; } }
    else if (!$('#tip').hidden) hideTip();
  });
  const hover = window.matchMedia && matchMedia('(hover: hover)').matches;
  document.addEventListener('mouseover', e => { const b = hover && e.target.closest && e.target.closest('.info'); if (b && !pinned) showTip(b); });
  document.addEventListener('mouseout', e => { const b = hover && e.target.closest && e.target.closest('.info'); if (b && !pinned) hideTip(); });
}

/* ---------- photo page ---------- */
function when(p) {
  const d = new Date(p.date), a = S.albums.find(x => x.id === p.albumId), dp = p.dp || (a && a.sample ? 'month' : 'day');
  const m = `${MONTHS[d.getMonth()]} ${d.getFullYear()}`; if (dp === 'month') return m;
  const day = `${d.getDate()} ${m}`;
  return dp === 'time' ? `${day}, ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : day;
}
/* Place names without sending anything anywhere: an optional cities.json next to the page ([[name, country, lat, lon], ...],
   made by tools/build-cities.py). Without it, the photo page shows plain coordinates. */
let CITIES = null;
if (/^https?:$/.test(location.protocol)) fetch('cities.json').then(r => r.ok ? r.json() : null).then(j => { CITIES = j && j.cities || null; }).catch(() => {});
function nearestCity(lat, lon) {
  if (!CITIES) return null;
  const rad = Math.PI / 180, cl = Math.cos(lat * rad); let best = null, bd = 1e9;
  for (const c of CITIES) { const dy = c[2] - lat; if (dy > 1 || dy < -1) continue; let dx = Math.abs(c[3] - lon); if (dx > 180) dx = 360 - dx; const d = dy * dy + dx * cl * dx * cl; if (d < bd) { bd = d; best = c; } }
  return best && Math.sqrt(bd) * 111.2 <= 60 ? best : null; // within about 60 km
}
function place(p) {
  if (p.lat == null || p.lon == null) return null;
  const f = (v, pos, neg) => `${Math.abs(v).toFixed(4)}° ${v >= 0 ? pos : neg}`, c = nearestCity(p.lat, p.lon);
  return { text: c ? `${c[0]}, ${c[1]}` : `${f(p.lat, 'N', 'S')}, ${f(p.lon, 'E', 'W')}`, href: `https://www.google.com/maps?q=${p.lat.toFixed(6)},${p.lon.toFixed(6)}` };
}
let viewUrl = null;
async function openDetail(id) {
  const p = S.photos.get(id); if (!p) return;
  S.detailId = id; S.dSrc = null; closeMenu(); hideTip(); $('#dMark').hidden = true;
  $('#dTitle').textContent = when(p);
  const loc = place(p), a = $('#dLoc'); a.hidden = !loc; if (loc) { a.textContent = loc.text; a.href = loc.href; a.setAttribute('aria-label', `Taken at ${loc.text}. Open in maps.`); }
  const img = $('#dImg'); img.style.width = img.style.height = ''; img.removeAttribute('src'); $('#dCanvas').hidden = true;
  $('#detail').hidden = false; $('#app').classList.add('in-detail');
  const v = await DB.get('views', id); if (S.detailId !== id) return;
  if (viewUrl) URL.revokeObjectURL(viewUrl);
  viewUrl = v ? URL.createObjectURL(new Blob([v.buf], { type: v.type })) : null;
  img.onload = () => { if (S.detailId !== id) return; layoutStage(); renderDetail(); };
  img.src = viewUrl || p.url;
  renderDetail();
}
function sampleAt(e) {
  const t = e.target, p = S.photos.get(S.detailId); if (!p || !S.dSrc || (t.id !== 'dImg' && t.id !== 'dCanvas')) return;
  const r = t.getBoundingClientRect(), { w, h, data } = S.dSrc, fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
  const cx = Math.min(w - 1, Math.max(0, Math.floor(fx * w))), cy = Math.min(h - 1, Math.max(0, Math.floor(fy * h)));
  let R = 0, G = 0, B = 0, n = 0; // average a 3x3 patch so one noisy pixel doesn't decide the color
  for (let y = Math.max(0, cy - 1); y <= Math.min(h - 1, cy + 1); y++) for (let x = Math.max(0, cx - 1); x <= Math.min(w - 1, cx + 1); x++) { const i = (y * w + x) * 4; if (data[i + 3] < 128) continue; R += data[i]; G += data[i + 1]; B += data[i + 2]; n++; }
  if (!n) return;
  const s = $('#stage').getBoundingClientRect(), mk = $('#dMark'); mk.style.left = (e.clientX - s.left) + 'px'; mk.style.top = (e.clientY - s.top) + 'px'; mk.style.background = `rgb(${Math.round(R / n)} ${Math.round(G / n)} ${Math.round(B / n)})`; mk.hidden = false;
  pickFromPalette(Engine.toLch(Math.round(R / n), Math.round(G / n), Math.round(B / n), S.balance ? Engine.whiteRef(p) : null));
}
function closeDetail() { $('#dMark').hidden = true; S.detailId = null; S.dSrc = null; $('#detail').hidden = true; $('#app').classList.remove('in-detail'); hideTip(); }
function layoutStage() {
  const img = $('#dImg'), st = $('#stage'); if (!img.naturalWidth) return;
  const W = st.clientWidth - 32, H = st.clientHeight - 4, k = Math.min(W / img.naturalWidth, H / img.naturalHeight);
  const cell = 2, cw = Math.max(1, Math.floor(img.naturalWidth * k / cell)), ch = Math.max(1, Math.floor(img.naturalHeight * k / cell));
  for (const e of [img, $('#dCanvas')]) { e.style.width = cw * cell + 'px'; e.style.height = ch * cell + 'px'; }
  const off = document.createElement('canvas'); off.width = cw; off.height = ch;
  const x = off.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(img, 0, 0, cw, ch);
  S.dSrc = { w: cw, h: ch, data: x.getImageData(0, 0, cw, ch).data };
}
function renderDetail() {
  const p = S.photos.get(S.detailId); if (!p) return;
  const q = S.color ? queryOf(S) : null, q2 = q && S.other ? queryOf(S.other) : null, name = names();
  const showMatch = !!q && S.dMode === 'match', cv = $('#dCanvas');
  $('#dTop').hidden = !q; $('#dStats').hidden = !q;
  for (const b of $('#dMode').children) b.setAttribute('aria-pressed', String(b.dataset.mode === S.dMode));
  cv.hidden = !(showMatch && S.dSrc); $('#dImg').style.visibility = cv.hidden ? 'visible' : 'hidden';
  if (!cv.hidden) {
    const { w, h, data } = S.dSrc; if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const ctx = cv.getContext('2d'), out = ctx.createImageData(w, h), dark = S.look === 'dark';
    Engine.paint(data, out.data, w, h, q, S.balance ? Engine.whiteRef(p) : null, dark ? [150, 145, 135] : [220, 216, 208], dark ? [31, 29, 26] : [52, 49, 44], q2);
    ctx.putImageData(out, 0, 0);
  }
  if (q) {
    const m = matchBoth(p, q, q2), pct = m.coverage * 100, f = v => (v * 100 < 1 ? (v * 100).toFixed(1) : Math.round(v * 100));
    const rank = S.result && S.result.active ? [...S.result.list].sort((x, y) => y.m.score - x.m.score).findIndex(it => it.p.id === p.id) + 1 : 0;
    $('#dStats').replaceChildren(
      el('div', {}, el('b', { text: m.a != null ? `${f(m.a)}+${f(m.b)}%` : f(m.coverage) + '%' }), el('span', { text: m.band < 0 ? `${name}, too little to count` : `${name}, ${Engine.BANDS[m.band].label.toLowerCase()}` })),
      el('div', {}, el('b', { text: String(Math.round(m.closeness * 100)) }), el('span', { text: 'closeness' })),
      el('div', {}, el('b', { text: rank ? '#' + rank : '–' }), el('span', { text: rank ? `of ${S.result.list.length} matches` : 'filtered out' })));
  }
  $('#dPal').replaceChildren(...Engine.palette(p, 8, S.balance).map(c => el('button', { type: 'button', style: `background:${c.css};flex:${c.share}`, 'aria-label': `Search for this ${colorName(c).toLowerCase()}`, title: `Search for this ${colorName(c).toLowerCase()}`, onclick: () => { $('#dMark').hidden = true; pickFromPalette(c); } })));
}

/* ---------- first page ---------- */
function show(which) {
  closeSheet(); closeDetail(); closeMenu(); exitSelect(true); $('#toast').hidden = true;
  $('#home').hidden = which !== 'home'; $('#album').hidden = which !== 'album'; $('#fab').hidden = which !== 'album';
}
const PHOTO_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="M3 16l5-5 4 4 3-3 6 6"/><circle cx="15.5" cy="9.5" r="1.4"/></svg>';
function albumCard(a) {
  const ps = albumPhotos(a.id).sort((x, y) => y.date - x.date), n = S.albumList === 'grid' ? 4 : 5;
  const stripe = el('div', { class: 'palbar' }, Engine.palette(ps, 10, S.balance).map(c => el('i', { style: `background:${c.css};flex:${c.share}` })));
  const count = el('span', { class: 'n', 'aria-label': `${ps.length} ${ps.length === 1 ? 'photo' : 'photos'}` }); count.innerHTML = PHOTO_ICON; count.append(String(ps.length));
  const meta = el('div', { class: 'meta' }, el('b', {}, a.emoji ? el('span', { class: 'emo', text: a.emoji }) : null, a.name), count);
  const mosaic = S.compact ? null : el('div', { class: 'mosaic' }, ps.length ? ps.slice(0, n).map(p => el('img', { src: p.url, alt: '' })) : el('span', { class: 'blank', text: 'empty' }));
  return el('button', { class: 'card', type: 'button', onclick: () => openAlbum(a.id) }, mosaic, meta, stripe);
}
function renderHome() {
  const press = (sel, key, val) => { for (const b of $(sel).children) b.setAttribute('aria-pressed', String(b.dataset[key] === val)); };
  $('#albumCount').textContent = `${S.albums.length} ${S.albums.length === 1 ? 'album' : 'albums'}`;
  const list = $('#albumList'); list.className = 'albums ' + S.albumList + (S.compact ? ' compact' : '');
  list.replaceChildren(...(S.albums.length ? S.albums.map(albumCard) : [el('div', { class: 'empty' }, el('b', { text: 'No albums yet' }), el('p', { text: 'Make one, add photos, then pick a color.' }))]));
  press('#viewSeg', 'view', S.albumList); $('#compactTog').setAttribute('aria-pressed', String(!S.compact)); press('#lookSeg', 'look', S.look);
  $('#tipLink').hidden = !TIP_URL; if (TIP_URL) $('#tipLink').href = TIP_URL;
  $('#storeNote').textContent = S.persisted ? 'Photos are read and kept in this browser. Nothing is uploaded.' : 'Nothing is uploaded. This browser is blocking storage, so photos last until you close the page.';
}
function showHome() { show('home'); prefs.set('album', null); renderHome(); }
function setAppearance(key, val) {
  if (key === 'look') S.look = val; else if (key === 'albums') S.albumList = val; else if (key === 'compact') S.compact = val;
  prefs.set(key, val); document.documentElement.dataset.look = S.look;
  if (!$('#home').hidden) renderHome(); else if (S.detailId) renderDetail();
}
function openAlbum(id, keepColor) {
  S.albumId = id; if (!keepColor) { S.color = null; S.sw = null; S.other = null; S.adding = false; }
  prefs.set('album', id); show('album'); $('#grid').replaceChildren(); refresh(false);
}
function albumForm(a, then, suggest) {
  let emoji = a ? a.emoji : '🍊';
  const name = el('input', { type: 'text', id: 'albumNameInput', value: a ? a.name : (suggest || ''), placeholder: 'Album name', maxlength: 40, 'aria-label': 'Album name' });
  const row = el('div', { class: 'emos', role: 'group', 'aria-label': 'Album icon' });
  const paint = () => row.replaceChildren(...EMOJI.map(e => el('button', { type: 'button', 'aria-pressed': String(e === emoji), 'aria-label': e || 'No icon', text: e || '∅', onclick: () => { emoji = e; paint(); } })));
  paint();
  const save = () => {
    const n = name.value.trim(); if (!n) { name.focus(); return false; }
    if (a) { a.name = n; a.emoji = emoji; DB.put('albums', a); refresh(false); }
    else { const na = { id: uid(), name: n, emoji, created: Date.now() }; S.albums.push(na); DB.put('albums', na); if (then) then(na); else openAlbum(na.id); }
  };
  name.addEventListener('keydown', e => { if (e.key === 'Enter' && save() !== false) closeDialog(); });
  dialog(a ? 'Rename album' : 'New album', [name, row], [{ label: 'Cancel' }, { label: a ? 'Save' : 'Create album', primary: true, run: save }]);
}
async function deleteAlbum(a) {
  for (const p of albumPhotos(a.id)) { S.photos.delete(p.id); tiles.delete(p.id); URL.revokeObjectURL(p.url); await DB.del('photos', p.id); await DB.del('views', p.id); }
  S.albums = S.albums.filter(x => x.id !== a.id); await DB.del('albums', a.id); showHome();
}
async function deletePhoto(id) {
  const p = S.photos.get(id); if (!p) return;
  S.photos.delete(id); tiles.delete(id); URL.revokeObjectURL(p.url); await DB.del('photos', id); await DB.del('views', id);
  closeDetail(); refresh(true);
}

/* ---------- select, save as album, export ---------- */
function enterSelect(id) { closeSheet(); S.select = new Set(id ? [id] : []); syncSelect(); }
function exitSelect(quiet) { if (!S.select) return; S.select = null; if (!quiet) syncSelect(); else { $('#selbar').hidden = true; $('#app').classList.remove('selecting'); } }
function toggleSel(id) { S.select.has(id) ? S.select.delete(id) : S.select.add(id); syncSelect(); }
function syncSelect() {
  const on = !!S.select, n = on ? S.select.size : 0;
  $('#selbar').hidden = !on; $('#app').classList.toggle('selecting', on); $('#grid').classList.toggle('selecting', on);
  for (const [id, t] of tiles) t.classList.toggle('sel', on && S.select.has(id));
  $('#selCount').textContent = `${n} selected`;
  for (const b of ['#selAlbum', '#selExport', '#selRemove']) $(b).disabled = !n;
}
/* Copies, not moves: the photos stay in the album they came from. */
function saveAsAlbum(ids, suggest) {
  albumForm(null, async na => {
    for (const id of ids) {
      const rec = await DB.get('photos', id), v = await DB.get('views', id); if (!rec) continue;
      const nid = uid(), { tb, tt, ...rest } = rec;
      await DB.put('photos', { ...rec, id: nid, albumId: na.id }); if (v) await DB.put('views', { ...v, id: nid });
      S.photos.set(nid, { ...rest, id: nid, albumId: na.id, url: URL.createObjectURL(new Blob([tb], { type: tt })) });
    }
    exitSelect(true); openAlbum(na.id); toast(`Copied ${ids.length} ${ids.length === 1 ? 'photo' : 'photos'} into "${na.name}"`);
  }, suggest);
}
const dlCap = window.claude && window.claude.use ? Promise.resolve(window.claude.use('downloads')).catch(() => null) : Promise.resolve(null);
async function saveFile(blob, filename) {
  const cap = await dlCap;
  if (cap) {
    try { await cap.save({ filename, data: blob }); toast(`Saved ${filename}`); }
    catch (e) { const c = e && e.code; toast(c === 'declined' ? 'Export cancelled.' : c === 'host_unavailable' ? 'This app can\'t save files. Open Satsuma in a browser to export.' : 'Couldn\'t save the file here.'); }
    return;
  }
  try { // on a phone, the share sheet is where "Save Image" lives
    const file = new File([blob], filename, { type: blob.type });
    if (window.matchMedia && matchMedia('(pointer: coarse)').matches && navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file] }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  const u = URL.createObjectURL(blob), a = el('a', { href: u, download: filename }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 30000); toast(`Saved ${filename}`);
}
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return b => { let c = ~0; for (let i = 0; i < b.length; i++) c = t[(c ^ b[i]) & 255] ^ (c >>> 8); return (~c) >>> 0; }; })();
/* A plain zip with no compression: the photos are already JPEGs. files: [{name, data: Uint8Array}] */
function zip(files) {
  const enc = new TextEncoder(), parts = [], central = []; let off = 0;
  for (const f of files) {
    const nm = enc.encode(f.name), crc = CRC(f.data), n = f.data.length, h = new DataView(new ArrayBuffer(30)), c = new DataView(new ArrayBuffer(46));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(12, 0x21, true); h.setUint32(14, crc, true); h.setUint32(18, n, true); h.setUint32(22, n, true); h.setUint16(26, nm.length, true);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(14, 0x21, true); c.setUint32(16, crc, true); c.setUint32(20, n, true); c.setUint32(24, n, true); c.setUint16(28, nm.length, true); c.setUint32(42, off, true);
    parts.push(h.buffer, nm, f.data); central.push(c.buffer, nm); off += 30 + nm.length + n;
  }
  const size = central.reduce((s, b) => s + b.byteLength, 0), e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, size, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...central, e.buffer], { type: 'application/zip' });
}
const slug = t => (t || 'photos').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'photos';
async function exportZip(ids) {
  const files = [], used = new Set();
  for (const id of ids) {
    const p = S.photos.get(id), v = await DB.get('views', id); if (!p || !v) continue;
    const ext = v.type === 'image/png' ? 'png' : 'jpg'; let base = slug((p.name || '').replace(/\.[a-z0-9]+$/i, '')) , name = `${base}.${ext}`, k = 2;
    while (used.has(name)) name = `${base}-${k++}.${ext}`; used.add(name); files.push({ name, data: new Uint8Array(v.buf) });
  }
  if (files.length) await saveFile(zip(files), `satsuma-${slug(album() && album().name)}.zip`);
}
/* One image with every selected photo on it, and the set's color stripe along the bottom. */
async function exportSheet(ids) {
  const ps = ids.map(id => S.photos.get(id)).filter(Boolean).slice(0, 60), n = ps.length; if (!n) return;
  const cols = n <= 4 ? 2 : n <= 9 ? 3 : n <= 16 ? 4 : 5, rows = Math.ceil(n / cols), cell = 360, gap = 10, m = 36, foot = 92;
  const cv = document.createElement('canvas'); cv.width = m * 2 + cols * cell + (cols - 1) * gap; cv.height = m * 2 + rows * cell + (rows - 1) * gap + foot;
  const x = cv.getContext('2d'); x.fillStyle = '#DCD8D0'; x.fillRect(0, 0, cv.width, cv.height); x.imageSmoothingQuality = 'high';
  for (let i = 0; i < n; i++) {
    const v = await DB.get('views', ps[i].id); if (!v) continue;
    const im = await decode(new Blob([v.buf], { type: v.type })), w = im.width || im.naturalWidth, h = im.height || im.naturalHeight, s = Math.min(w, h);
    x.drawImage(im, (w - s) / 2, (h - s) / 2, s, s, m + (i % cols) * (cell + gap), m + Math.floor(i / cols) * (cell + gap), cell, cell); if (im.close) im.close();
  }
  const y = cv.height - m - foot + 26, W = cv.width - m * 2; let px = m;
  for (const c of Engine.palette(ps, 12, S.balance)) { x.fillStyle = c.css; x.fillRect(px, y, c.share * W + 1, 20); px += c.share * W; }
  x.strokeStyle = '#181715'; x.lineWidth = 2; x.strokeRect(m, y, W, 20);
  x.fillStyle = '#181715'; x.textBaseline = 'alphabetic'; x.font = 'italic 900 30px Bitter, Georgia, serif'; x.fillText(album() ? album().name : APP, m, y + 62);
  x.font = '400 22px "Source Sans 3", system-ui, sans-serif'; x.textAlign = 'right'; x.fillText(`${n} photos, ${APP}`, cv.width - m, y + 60);
  const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', .9)); if (blob) await saveFile(blob, `satsuma-${slug(album() && album().name)}.jpg`);
}
function exportDialog(ids) {
  dialog('Export', [el('p', { text: `${ids.length} ${ids.length === 1 ? 'photo' : 'photos'}. These are the 900px copies ${APP} keeps, not your full-size originals.` })],
    [{ label: 'Cancel' }, { label: 'Zip of photos', run: () => { exportZip(ids); } }, { label: 'One image', primary: true, run: () => { exportSheet(ids); } }]);
}
async function removeMany(ids) {
  for (const id of ids) { const p = S.photos.get(id); if (!p) continue; S.photos.delete(id); tiles.delete(id); URL.revokeObjectURL(p.url); await DB.del('photos', id); await DB.del('views', id); }
  exitSelect(true); refresh(true);
}

/* ---------- menu, dialog, toast ---------- */
function openMenu() {
  const a = album(), R = S.result;
  const item = (text, fn) => el('button', { type: 'button', role: 'menuitem', text, onclick: () => { closeMenu(); fn(); } });
  $('#menu').replaceChildren(
    albumPhotos().length ? item('Select photos', () => enterSelect()) : null,
    R && R.active && R.list.length ? item(`Save these ${R.list.length} as an album`, () => saveAsAlbum(R.list.map(it => it.p.id), names().replace(' + ', ' and '))) : null,
    item('Rename album', () => albumForm(a)),
    item('Delete album', () => dialog('Delete album', [el('p', { text: `Delete "${a.name}" and its ${albumPhotos().length} photos from ${APP}? Your original files aren't touched.` })], [{ label: 'Cancel' }, { label: 'Delete album', primary: true, run: () => { deleteAlbum(a); } }])));
  $('#menu').hidden = false;
}
function closeMenu() { $('#menu').hidden = true; }
function dialog(title, body, actions) {
  const d = $('#dialog');
  d.replaceChildren(el('div', { class: 'box', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    el('div', { class: 'titlebar' }, el('b', { text: title }), el('span', { class: 'stripes' })),
    el('div', { class: 'box-body' }, body),
    el('div', { class: 'box-actions' }, actions.map(a => el('button', { class: 'btn' + (a.primary ? ' primary' : ''), type: 'button', text: a.label, onclick: () => { if (!a.run || a.run() !== false) closeDialog(); } })))));
  d.hidden = false; const f = d.querySelector('input') || d.querySelector('.btn.primary'); if (f) f.focus();
}
function closeDialog() { $('#dialog').hidden = true; $('#dialog').replaceChildren(); }
let toastT = 0;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 4200); }

/* ---------- wiring ---------- */
function bind() {
  bindSheet(); bindTips();
  const seg = (sel, key, data) => $(sel).addEventListener('click', e => { const b = e.target.closest('button'); if (b) setAppearance(key, b.dataset[data]); });
  seg('#lookSeg', 'look', 'look'); seg('#viewSeg', 'albums', 'view'); $('#compactTog').addEventListener('click', () => setAppearance('compact', !S.compact));
  $('#back').addEventListener('click', showHome);
  $('#more').addEventListener('click', e => { e.stopPropagation(); $('#menu').hidden ? openMenu() : closeMenu(); });
  document.addEventListener('click', e => { if (!$('#menu').hidden && !$('#menu').contains(e.target)) closeMenu(); });
  $('#add').addEventListener('click', () => $('#file').click());
  $('#file').addEventListener('change', e => { addFiles(e.target.files); e.target.value = ''; });
  $('#newAlbum').addEventListener('click', () => albumForm(null));
  $('#order').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.order = b.dataset.order; savePrefs(); renderGrid(true); if (S.detailId) renderDetail(); });
  $('#dClose').addEventListener('click', closeDetail); $('#stage').addEventListener('click', sampleAt);
  const picked = () => [...S.select];
  $('#selDone').addEventListener('click', () => exitSelect());
  $('#selAll').addEventListener('click', () => { const all = (S.result ? S.result.list : []).map(it => it.p.id); S.select = new Set(S.select.size === all.length ? [] : all); syncSelect(); });
  $('#selAlbum').addEventListener('click', () => saveAsAlbum(picked(), S.color ? names().replace(' + ', ' and ') : ''));
  $('#selExport').addEventListener('click', () => exportDialog(picked()));
  $('#selRemove').addEventListener('click', () => { const ids = picked(); dialog('Remove photos', [el('p', { text: `Remove ${ids.length} ${ids.length === 1 ? 'photo' : 'photos'} from this album? Your original files aren't touched.` })], [{ label: 'Cancel' }, { label: 'Remove', primary: true, run: () => { removeMany(ids); } }]); });
  $('#dMode').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.dMode = b.dataset.mode; renderDetail(); });
  $('#dDel').addEventListener('click', () => dialog('Remove photo', [el('p', { text: 'Remove this photo from the album? Your original file isn\'t touched.' })], [{ label: 'Cancel' }, { label: 'Remove', primary: true, run: () => { deletePhoto(S.detailId); } }]));
  $('#dialog').addEventListener('click', e => { if (e.target === e.currentTarget) closeDialog(); });
  document.addEventListener('keydown', e => { if (e.key !== 'Escape') return; if (!$('#tip').hidden) hideTip(); else if (!$('#dialog').hidden) closeDialog(); else if (!$('#menu').hidden) closeMenu(); else if (!$('#sheet').classList.contains('closed')) closeSheet(); else if (S.detailId) closeDetail(); else if (S.select) exitSelect(); });
  const al = $('#album');
  al.addEventListener('dragover', e => { e.preventDefault(); al.classList.add('drop'); });
  al.addEventListener('dragleave', e => { if (!al.contains(e.relatedTarget)) al.classList.remove('drop'); });
  al.addEventListener('drop', e => { e.preventDefault(); al.classList.remove('drop'); if (e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });
  window.addEventListener('resize', () => { hideTip(); if (S.detailId && $('#dImg').naturalWidth) { layoutStage(); renderDetail(); } });
}
async function boot() {
  const r = document.documentElement; r.dataset.look = S.look;
  $('#sheet').inert = true; bind();
  S.persisted = await DB.open();
  const [albums, photos, presets] = await Promise.all([DB.all('albums'), DB.all('photos'), DB.all('presets')]);
  S.albums = albums.sort((a, b) => a.created - b.created); S.presets = presets.sort((a, b) => a.created - b.created);
  for (const p of photos) { p.url = URL.createObjectURL(new Blob([p.tb], { type: p.tt })); delete p.tb; S.photos.set(p.id, p); }
  let firstRun = false;
  if (!S.albums.length && SAMPLES.length && (!S.persisted || !prefs.get('seeded', false))) { try { firstRun = !!(await seed()); } catch (e) { firstRun = false; } prefs.set('seeded', true); }
  const last = S.albums.find(a => a.id === prefs.get('album', null));
  if (firstRun && S.albums.length) { const o = SWATCHES[1]; S.color = { L: o.L, C: o.C, H: o.H }; S.draft = { ...S.color }; S.tol = { tH: o.tH, tL: o.tL, tC: o.tC }; S.sw = o.id; openAlbum(S.albums[0].id, true); }
  else if (last) openAlbum(last.id); else showHome();
}
boot();
})();
