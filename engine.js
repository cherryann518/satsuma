/* Color engine. No DOM. Works in the page and in node.
   Each photo is reduced once to a small OKLab histogram; every search after that is a lookup. */
const Engine = (() => {
  const LB = 20, CB = 20, HB = 48, CMAX = 0.4, NB = LB * CB * HB;
  const TAU = Math.PI * 2;
  const lin = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const c = i / 255; lin[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }

  function lab2rgb(L, a, b) {
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
    return [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
  }
  const enc = x => { x = Math.min(1, Math.max(0, x)); return Math.round(255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055)); };
  function inGamut(L, C, H) {
    const h = H * Math.PI / 180, [r, g, b] = lab2rgb(L, C * Math.cos(h), C * Math.sin(h));
    const e = 0.0005; return r > -e && r < 1 + e && g > -e && g < 1 + e && b > -e && b < 1 + e;
  }
  /* Largest chroma a screen can show at this lightness and hue. */
  function maxChroma(L, H) { let lo = 0, hi = CMAX; for (let i = 0; i < 14; i++) { const mid = (lo + hi) / 2; if (inGamut(L, mid, H)) lo = mid; else hi = mid; } return lo; }
  function fit(L, C, H) { return Math.min(C, maxChroma(L, H)); }
  function lchRgb(L, C, H) { const h = H * Math.PI / 180, c = fit(L, C, H), [r, g, b] = lab2rgb(L, c * Math.cos(h), c * Math.sin(h)); return [enc(r), enc(g), enc(b)]; }
  function lchCss(L, C, H) { const [r, g, b] = lchRgb(L, C, H); return `rgb(${r} ${g} ${b})`; }
  function labCss(L, a, b) { const [r, g, bb] = lab2rgb(L, a, b); return `rgb(${enc(r)} ${enc(g)} ${enc(bb)})`; }

  /* rgba: Uint8ClampedArray of RGBA pixels. Returns the photo's color record. */
  function analyze(rgba) {
    const cnt = new Uint32Array(NB), sL = new Float32Array(NB), sa = new Float32Array(NB), sb = new Float32Array(NB);
    let n = 0, alpha = false;
    for (let i = 0; i < rgba.length; i += 4) {
      if (rgba[i + 3] < 128) { alpha = true; continue; }
      n++;
      const R = lin[rgba[i]], G = lin[rgba[i + 1]], B = lin[rgba[i + 2]];
      const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
      const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
      const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
      const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
      const a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
      const b = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
      const C = Math.sqrt(a * a + b * b);
      const li = Math.min(LB - 1, (L * LB) | 0), ci = Math.min(CB - 1, (C / CMAX * CB) | 0);
      const hi = ci === 0 ? 0 : (((Math.atan2(b, a) / TAU + 1) % 1) * HB | 0) % HB; // greys share one hue bin
      const k = (li * CB + ci) * HB + hi;
      cnt[k]++; sL[k] += L; sa[k] += a; sb[k] += b;
    }
    let k = 0; for (let i = 0; i < NB; i++) if (cnt[i]) k++;
    const c = new Uint16Array(k), L = new Float32Array(k), a = new Float32Array(k), b = new Float32Array(k);
    for (let i = 0, j = 0; i < NB; i++) if (cnt[i]) { c[j] = cnt[i]; L[j] = sL[i] / cnt[i]; a[j] = sa[i] / cnt[i]; b[j] = sb[i] / cnt[i]; j++; }
    return { n, c, L, a, b, alpha };
  }

  /* Lighting estimate, worked out from the histogram: what the photo's brightest near-white things actually look like.
     Only a warm cast (yellow to orange, the indoor-lighting case) is corrected, so a pale blue sky is never mistaken for
     "white under blue light". Returns per-cone gains, or null when there is nothing white-ish to go on. */
  const WB = { L: 0.80, C: 0.06, min: 0.015, warm: [20, 115] };
  function whiteRef(p) {
    if (p._wb !== undefined) return p._wb;
    let wl = 0, wm = 0, ws = 0, wn = 0;
    for (let j = 0; j < p.c.length; j++) {
      const L = p.L[j], a = p.a[j], b = p.b[j];
      if (L > WB.L && a * a + b * b < WB.C * WB.C) {
        const w = p.c[j]; wn += w;
        wl += w * (L + 0.3963377774 * a + 0.2158037573 * b); wm += w * (L - 0.1055613458 * a - 0.0638541728 * b); ws += w * (L - 0.0894841775 * a - 1.2914855480 * b);
      }
    }
    let wb = null;
    if (p.n && wn >= WB.min * p.n) {
      wl /= wn; wm /= wn; ws /= wn;
      const t = 0.2104542553 * wl + 0.7936177850 * wm - 0.0040720468 * ws;
      const a = 1.9779984951 * wl - 2.4285922050 * wm + 0.4505937099 * ws, b = 0.0259040371 * wl + 0.7827717662 * wm - 0.8086757660 * ws;
      const hue = (Math.atan2(b, a) * 180 / Math.PI + 360) % 360;
      if (a * a + b * b > 0.004 * 0.004 && hue > WB.warm[0] && hue < WB.warm[1]) wb = [t / wl, t / wm, t / ws];
    }
    return (p._wb = wb);
  }

  /* Shift a color so the photo's white reads as neutral (von Kries in OKLab's cone space). */
  function balance(wb, L, a, b) {
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) * wb[0];
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) * wb[1];
    const s = (L - 0.0894841775 * a - 1.2914855480 * b) * wb[2];
    return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
  }

  /* Cached per-photo arrays in the form the matcher wants. */
  function view(p, balanced) {
    const wb = balanced ? whiteRef(p) : null, key = wb ? '_vb' : '_v';
    if (p[key]) return p[key];
    const k = p.c.length, L = new Float32Array(k), a = new Float32Array(k), b = new Float32Array(k), C = new Float32Array(k), H = new Float32Array(k);
    for (let j = 0; j < k; j++) {
      let l = p.L[j], x = p.a[j], y = p.b[j];
      if (wb) [l, x, y] = balance(wb, l, x, y);
      L[j] = l; a[j] = x; b[j] = y; C[j] = Math.sqrt(x * x + y * y); H[j] = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    }
    return (p[key] = { L, a, b, C, H });
  }

  const GREY = 0.03;       // below this chroma a pixel has no usable hue
  const NEUTRAL_T = 0.04;  // targets below this are treated as white / grey / black
  /* q: {L,C,H,tH,tL,tC}. Returns 0 for no match, else closeness in (0,1]. */
  function test(q, L, a, b, C, H) {
    const dL = L - q.L; if (dL > q.tL || -dL > q.tL) return 0;
    if (q.C < NEUTRAL_T) { if (C > Math.max(q.C, 0.02) + q.tC * 0.5) return 0; }
    else {
      if (C < GREY) return 0;
      const dC = C - q.C; if (dC > q.tC || -dC > q.tC) return 0;
      const dH = Math.abs(((H - q.H + 540) % 360) - 180); if (dH > q.tH) return 0;
    }
    const da = a - q.a, db = b - q.b, d = Math.sqrt(0.36 * dL * dL + da * da + db * db);
    return Math.max(0.02, 1 - d / 0.25);
  }
  function query(q) { const h = q.H * Math.PI / 180, C = fit(q.L, q.C, q.H); return { ...q, C, a: C * Math.cos(h), b: C * Math.sin(h) }; }

  const DOMINANT = 0.30;
  /* coverage: share of the photo inside the tolerances. closeness: how near those pixels sit to the exact color.
     score: coverage flattens out at 30%, so past "dominant" only closeness separates photos. */
  function match(p, q, balanced) {
    const v = view(p, balanced), k = p.c.length; let hit = 0, sum = 0;
    for (let j = 0; j < k; j++) { const s = test(q, v.L[j], v.a[j], v.b[j], v.C[j], v.H[j]); if (s) { hit += p.c[j]; sum += p.c[j] * s; } }
    const coverage = p.n ? hit / p.n : 0, closeness = hit ? sum / hit : 0;
    return { coverage, closeness, score: Math.sqrt(Math.min(1, coverage / DOMINANT)) * closeness, band: band(coverage) };
  }
  const BANDS = [
    { id: 'accent', label: 'Accent', lo: 0.01, hi: 0.03 },
    { id: 'noticeable', label: 'Noticeable', lo: 0.03, hi: 0.10 },
    { id: 'significant', label: 'Significant', lo: 0.10, hi: 0.30 },
    { id: 'dominant', label: 'Dominant', lo: 0.30, hi: 2 }];
  function band(c) { for (let i = 0; i < BANDS.length; i++) if (c >= BANDS[i].lo && c < BANDS[i].hi) return i; return -1; }

  /* Main colors of one photo or a whole set, biggest first: [{css, share}] */
  function palette(ps, max = 7, balanced = false) {
    const groups = new Map();
    for (const p of Array.isArray(ps) ? ps : [ps]) {
      if (!p.n) continue;
      const v = view(p, balanced);
      for (let j = 0; j < p.c.length; j++) {
        const w = p.c[j] / p.n, li = Math.min(3, (v.L[j] * 4) | 0);
        const key = v.C[j] < 0.035 ? 'g' + li : li + ':' + Math.min(2, (v.C[j] / 0.09) | 0) + ':' + ((v.H[j] / 30) | 0);
        let g = groups.get(key); if (!g) groups.set(key, g = { n: 0, L: 0, a: 0, b: 0 });
        g.n += w; g.L += v.L[j] * w; g.a += v.a[j] * w; g.b += v.b[j] * w;
      }
    }
    const top = [...groups.values()].sort((x, y) => y.n - x.n).slice(0, max), tot = top.reduce((s, g) => s + g.n, 0) || 1;
    return top.map(g => { const L = g.L / g.n, a = g.a / g.n, b = g.b / g.n; return { css: labCss(L, a, b), share: g.n / tot, L, C: Math.sqrt(a * a + b * b), H: (Math.atan2(b, a) * 180 / Math.PI + 360) % 360 }; });
  }

  /* Per-pixel version of the same test, for the match view. Writes into out (RGBA).
     Matching pixels keep their color; the rest become a 1-bit ordered dither between two tones. */
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  function paint(src, out, w, h, q, wb, light, dark, q2) {
    let hit = 0, n = 0;
    for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i += 4) {
      if (src[i + 3] < 128) { out[i + 3] = 0; continue; }
      n++;
      const R = lin[src[i]], G = lin[src[i + 1]], B = lin[src[i + 2]];
      let l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
      let m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
      let s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
      const L0 = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
      if (wb) { l *= wb[0]; m *= wb[1]; s *= wb[2]; }
      const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
      const a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
      const b = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
      const C = Math.sqrt(a * a + b * b), H = (Math.atan2(b, a) * 180 / Math.PI + 360) % 360;
      if ((q && test(q, L, a, b, C, H)) || (q2 && test(q2, L, a, b, C, H))) { hit++; out[i] = src[i]; out[i + 1] = src[i + 1]; out[i + 2] = src[i + 2]; }
      else { const t = L0 * 1.08 - 0.04 > (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16 ? light : dark; out[i] = t[0]; out[i + 1] = t[1]; out[i + 2] = t[2]; }
      out[i + 3] = 255;
    }
    return n ? hit / n : 0;
  }

  /* One screen color as {L, C, H}, with the photo's lighting correction applied when given. Used by the eyedropper. */
  function toLch(r, g, bl, wb) {
    const R = lin[r], G = lin[g], B = lin[bl];
    let l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B), m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B), s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
    if (wb) { l *= wb[0]; m *= wb[1]; s *= wb[2]; }
    const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, b = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
    return { L, C: Math.sqrt(a * a + b * b), H: (Math.atan2(b, a) * 180 / Math.PI + 360) % 360 };
  }

  return { analyze, whiteRef, toLch, match, query, palette, paint, lchCss, lchRgb, labCss, fit, maxChroma, BANDS, band, DOMINANT, WB };
})();
if (typeof module !== 'undefined') module.exports = Engine;
