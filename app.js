/* ==========================================================================
   Wavr: browser wave generator (Web Audio API, no dependencies)

   Sections: waveforms · drawing · audio engine · mode switching · simple ·
             advanced · math · UI motion · theme

   Naming: S state · M math result · T drawn cycle · W waveform list ·
           g canvas context · w/h canvas width/height · $/$$ query helpers
   ========================================================================== */

const $ = (s, r = document) => r.querySelector(s),
  $$ = (s, r = document) => [...r.querySelectorAll(s)];
const TAU = Math.PI * 2,
  dk = () => document.documentElement.dataset.theme === 'dark',
  accent = () => (dk() ? '#64b5f6' : '#1976d2'),
  esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const fmt = (n) =>
  n >= 1000
    ? (n / 1000).toFixed(n >= 10000 ? 1 : 2) + ' kHz'
    : (n < 10 ? n.toFixed(2) : Math.round(n)) + ' Hz';
const deb = (f, t) => {
  let h;
  return (...a) => {
    clearTimeout(h);
    h = setTimeout(() => f(...a), t);
  };
};
const paint = (e) => e.style.setProperty('--p', ((e.value - e.min) / (e.max - e.min)) * 100 + '%');
$$('input.r').forEach(paint);
document.addEventListener('input', (e) => {
  if (e.target.classList.contains('r')) paint(e.target);
});

// ---------- waveforms ----------
const tri = (p) => (p < 0.25 ? 4 * p : p < 0.75 ? 2 - 4 * p : 4 * p - 4);
const W = [
  ['sine', 'Sine', (p) => Math.sin(TAU * p)],
  ['square', 'Square', (p) => (p < 0.5 ? 1 : -1)],
  ['triangle', 'Triangle', tri],
  ['saw', 'Sawtooth', (p) => 2 * p - 1],
  ['rsaw', 'Reverse saw', (p) => 1 - 2 * p],
  ['p25', 'Pulse 25%', (p) => (p < 0.25 ? 1 : -1)],
  ['p10', 'Pulse 10%', (p) => (p < 0.1 ? 1 : -1)],
  ['half', 'Half-wave', (p) => Math.max(0, Math.sin(TAU * p))],
  ['full', 'Full-wave', (p) => Math.abs(Math.sin(TAU * p))],
  ['steps', 'Staircase', (p) => Math.floor(p * 5) / 2 - 1],
  ['trap', 'Trapezoid', (p) => Math.max(-1, Math.min(1, 1.5 * tri(p)))],
  ['parab', 'Parabolic', (p) => 1 - 8 * (p - 0.5) ** 2],
  [
    'organ',
    'Organ',
    (p) =>
      (Math.sin(TAU * p) +
        0.5 * Math.sin(2 * TAU * p) +
        0.33 * Math.sin(3 * TAU * p) +
        0.25 * Math.sin(4 * TAU * p)) /
      1.6,
  ],
  ['drive', 'Overdrive', (p) => Math.tanh(3 * Math.sin(TAU * p))],
  ['pwm', 'PWM', (p) => (p < S.pw ? 1 : -1)],
  ['noise', 'White noise', (p) => 0],
];
const tbl = (fn, N = 2048) => Float32Array.from({ length: N }, (_, i) => fn(i / N));
/* App state. mode: simple | adv | math. sf/af: frequency (Hz); sa/aa/ma: amplitude 0-1;
   wave: simple waveform key; pw: PWM duty cycle; emb: embed carrier; cyc: 'cycle at pitch'. */
const S = {
  mode: 'simple',
  playing: false,
  wave: 'sine',
  pw: 0.5,
  sf: 440,
  sa: 0.5,
  af: 220,
  aa: 0.5,
  ma: 0.5,
  emb: false,
};
/* T: one hand-drawn cycle (Advanced mode); Hm: harmonic amplitudes 1-16. */
const T = tbl(W[0][2], 512),
  Hm = Array(16).fill(0);
Hm[0] = 1;
/* Latest Math-mode result: { y: normalised samples, buf: AudioBuffer, lo/hi: range, rate, notes, err } */
let M = { notes: [] };

// ---------- drawing ----------
/* Sizes a canvas to its CSS size at device resolution and returns [ctx, width, height]. */
function fit(c) {
  const r = devicePixelRatio || 1,
    w = c.clientWidth,
    h = c.clientHeight;
  if (c.width !== Math.round(w * r) || c.height !== Math.round(h * r)) {
    c.width = Math.round(w * r);
    c.height = Math.round(h * r);
  }
  const g = c.getContext('2d');
  g.setTransform(r, 0, 0, r, 0, 0);
  g.clearRect(0, 0, w, h);
  return [g, w, h];
}
function grid(g, w, h) {
  g.strokeStyle = dk() ? '#3a3a3a' : '#d0d0d0';
  g.lineWidth = 1;
  g.beginPath();
  for (let i = 1; i < 4; i++) {
    g.moveTo(0, (h * i) / 4);
    g.lineTo(w, (h * i) / 4);
  }
  for (let i = 1; i < 8; i++) {
    g.moveTo((w * i) / 8, 0);
    g.lineTo((w * i) / 8, h);
  }
  g.stroke();
  g.strokeStyle = dk() ? '#6b6b6b' : '#9e9e9e';
  g.beginPath();
  g.moveTo(0, h / 2);
  g.lineTo(w, h / 2);
  g.stroke();
}
/* Draws array `a` as a line across the canvas. Dense arrays are reduced to a min/max envelope per pixel. */
function plot(g, w, h, a, lo = -1, hi = 1, P = 10) {
  const n = a.length;
  if (!n) return;
  const Y = (v) => P + (h - 2 * P) * (1 - (v - lo) / (hi - lo || 1));
  g.beginPath();
  if (n <= w * 2) {
    for (let i = 0; i < n; i++) {
      const X = n > 1 ? (i / (n - 1)) * w : 0;
      i ? g.lineTo(X, Y(a[i])) : g.moveTo(X, Y(a[i]));
    }
  } else {
    const s = n / w;
    for (let X = 0; X < w; X++) {
      let mn = 1e9,
        mx = -1e9;
      for (let i = Math.floor(X * s), e = Math.floor((X + 1) * s); i < e; i++) {
        const v = a[i];
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
      X ? g.lineTo(X, Y(mn)) : g.moveTo(X, Y(mn));
      g.lineTo(X, Y(mx));
    }
  }
  g.strokeStyle = accent();
  g.lineWidth = 2;
  g.lineJoin = 'round';
  g.stroke();
}
const cur1 = () => W.find((w) => w[0] === S.wave);
function shapeArr(fn, key) {
  return key === 'noise'
    ? Float32Array.from({ length: 200 }, () => Math.random() * 2 - 1)
    : tbl(fn, 256);
}
function drawPrev() {
  const [g, w, h] = fit($('#c-prev'));
  grid(g, w, h);
  g.fillStyle = '#5b6b82';
  g.font = '11px system-ui';
  if (S.mode === 'math') {
    if (M.y) {
      plot(g, w, h, M.y);
      g.fillText(`x: ${M.x0} → ${M.x1}`, 8, h - 6);
      g.fillText('y: ' + +M.hi.toPrecision(4), 8, 12);
      g.textAlign = 'right';
      g.fillText('y: ' + +M.lo.toPrecision(4), w - 8, h - 6);
      g.textAlign = 'left';
    }
  } else {
    plot(g, w, h, S.mode === 'simple' ? shapeArr(cur1()[2], S.wave) : T);
    g.fillText('one cycle', 8, h - 6);
  }
  $('#rd').textContent =
    S.mode === 'simple'
      ? `${cur1()[1]} · ${fmt(S.sf)}`
      : S.mode === 'adv'
        ? flat(T)
          ? 'Flat line · silent'
          : `Custom · ${fmt(S.af)}`
        : M.err || !M.rate
          ? ''
          : `loops at ${fmt(M.rate)}`;
}
function drawAdv() {
  const [g, w, h] = fit($('#c-draw'));
  grid(g, w, h);
  plot(g, w, h, T);
}
function drawScope() {
  const [g, w, h] = fit($('#c-scope'));
  grid(g, w, h);
  if (!ctx || !S.playing) {
    g.strokeStyle = '#90caf9';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, h / 2);
    g.lineTo(w, h / 2);
    g.stroke();
    g.globalAlpha = 1;
    return;
  }
  ana.getFloatTimeDomainData(tb);
  let s = 0;
  for (let i = 1; i < 1024; i++)
    if (tb[i - 1] < 0 && tb[i] >= 0) {
      s = i;
      break;
    }
  plot(g, w, h, tb.subarray(s, s + 1024));
}
function drawSpec() {
  const [g, w, h] = fit($('#c-spec'));
  grid(g, w, h);
  g.fillStyle = '#5b6b82';
  g.font = '11px system-ui';
  [
    [100, '100'],
    [1000, '1k'],
    [10000, '10k'],
  ].forEach(([f, t]) => g.fillText(t, (w * Math.log(f / 20)) / Math.log(1000) + 3, h - 5));
  if (!ctx || !S.playing) return;
  ana.getByteFrequencyData(fd);
  const n = fd.length,
    nyq = ctx.sampleRate / 2;
  g.beginPath();
  g.moveTo(0, h);
  for (let X = 0; X <= w; X++) {
    const f = 20 * Math.pow(1000, X / w),
      b = Math.min(n - 1, Math.round((f / nyq) * n));
    g.lineTo(X, h - 4 - ((h - 14) * fd[b]) / 255);
  }
  g.lineTo(w, h);
  g.fillStyle = dk() ? '#1e3a5f' : '#bbdefb';
  g.fill();
  g.strokeStyle = accent();
  g.lineWidth = 1.5;
  g.stroke();
}
const drawAll = () => {
  drawPrev();
  drawAdv();
  if (window.drawIcons) drawIcons();
};
function loop() {
  drawScope();
  drawSpec();
  requestAnimationFrame(loop);
}

// ---------- audio ----------
let ctx,
  amp,
  ana,
  mst,
  cur = null,
  tb,
  fd;
function init() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  amp = ctx.createGain();
  amp.gain.value = ampV();
  const lim = ctx.createDynamicsCompressor();
  lim.threshold.value = -6;
  lim.knee.value = 0;
  lim.ratio.value = 20;
  lim.attack.value = 0.003;
  lim.release.value = 0.1;
  mst = ctx.createGain();
  ana = ctx.createAnalyser();
  ana.fftSize = 4096;
  ana.smoothingTimeConstant = 0.6;
  amp.connect(lim);
  lim.connect(mst);
  mst.connect(ana);
  ana.connect(ctx.destination);
  tb = new Float32Array(ana.fftSize);
  fd = new Uint8Array(ana.frequencyBinCount);
  vol();
}
const vol = () => {
  if (mst) mst.gain.value = Math.pow($('#vol').value / 100, 2);
};
const ampV = () => (S.mode === 'simple' ? S.sa : S.mode === 'adv' ? S.aa : S.ma),
  freqV = () => (S.mode === 'simple' ? S.sf : S.af);
const flat = (t) => {
  let mu = 0;
  for (const v of t) mu += v / t.length;
  let pk = 0;
  for (const v of t) pk = Math.max(pk, Math.abs(v - mu));
  return pk < 0.02;
};
/* Builds a PeriodicWave from one cycle `t` (DFT, up to 512 harmonics). With `norm` the peak is scaled
   to 1; without it the drawn amplitude is kept, so a flat line stays silent. */
function pw(t, norm) {
  const N = t.length,
    H = Math.min(512, N >> 1),
    re = new Float32Array(H + 1),
    im = new Float32Array(H + 1),
    cs = new Float32Array(N),
    sn = new Float32Array(N);
  let mu = 0;
  for (let i = 0; i < N; i++) mu += t[i] / N;
  let pk = 0;
  for (let i = 0; i < N; i++) pk = Math.max(pk, Math.abs(t[i] - mu));
  const sc = norm && pk > 1e-6 ? 1 / pk : 1;
  for (let i = 0; i < N; i++) {
    cs[i] = Math.cos((TAU * i) / N);
    sn[i] = Math.sin((TAU * i) / N);
  }
  for (let k = 1; k <= H; k++) {
    let a = 0,
      b = 0;
    for (let n = 0; n < N; n++) {
      const j = (k * n) % N;
      a += t[n] * cs[j];
      b += t[n] * sn[j];
    }
    re[k] = (2 * a * sc) / N;
    im[k] = (2 * b * sc) / N;
  }
  return ctx.createPeriodicWave(re, im, { disableNormalization: true });
}
function stop() {
  if (cur) {
    cur.g.gain.setTargetAtTime(0, ctx.currentTime, 0.015);
    const n = cur.n;
    setTimeout(() => {
      try {
        n.stop();
      } catch {}
    }, 200);
    cur = null;
  }
}
/* Applies amplitude and frequency changes without restarting the source. */
function live() {
  if (!ctx) return;
  amp.gain.setTargetAtTime(ampV(), ctx.currentTime, 0.02);
  if (cur && cur.osc) cur.n.frequency.setTargetAtTime(freqV(), ctx.currentTime, 0.02);
}
/* (Re)creates the sound source for the current mode and cross-fades from the old one. */
function rebuild() {
  if (!S.playing) return;
  stop();
  let n,
    osc = false;
  if (S.mode === 'adv' && flat(T)) return;
  if (S.mode === 'math') {
    if (!M.buf) return;
    n = ctx.createBufferSource();
    n.buffer = M.buf;
    n.loop = true;
    n.playbackRate.value = M.pb;
  } else if (S.mode === 'simple' && S.wave === 'noise') {
    const b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate),
      d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    n = ctx.createBufferSource();
    n.buffer = b;
    n.loop = true;
  } else {
    n = ctx.createOscillator();
    n.setPeriodicWave(S.mode === 'simple' ? pw(tbl(cur1()[2]), true) : pw(T));
    osc = true;
    n.frequency.value = freqV();
  }
  const g = ctx.createGain();
  g.gain.value = 0;
  n.connect(g);
  g.connect(amp);
  n.start();
  g.gain.setTargetAtTime(1, ctx.currentTime, 0.015);
  cur = { n, g, osc };
  live();
}
const rebuildD = deb(rebuild, 120);
$('#play').onclick = () => {
  init();
  ctx.resume();
  S.playing = !S.playing;
  $('#play').classList.toggle('on', S.playing);
  $('#play').innerHTML = S.playing ? '<span class="eq"><i></i><i></i><i></i></span>Stop' : '▶ Play';
  S.playing ? rebuild() : stop();
};
$('#vol').oninput = vol;

// ---------- mode switching ----------
$$('#seg button').forEach(
  (b) =>
    (b.onclick = () => {
      S.mode = b.dataset.m;
      $$('#seg button').forEach((x) => x.classList.toggle('on', x === b));
      $$('.pane').forEach((p) => p.classList.toggle('on', p.id === 'p-' + S.mode));
      rebuild();
      drawAll();
    }),
);

// ---------- simple ----------
const f2s = (f) => Math.round((1000 * Math.log(f / 20)) / Math.log(1000)),
  s2f = (v) => Math.round(20 * Math.pow(1000, v / 1000) * 100) / 100;
W.forEach(([k, l, fn]) => {
  const b = document.createElement('button');
  b.className = 'wv' + (k === 'sine' ? ' on' : '');
  b.dataset.k = k;
  b.innerHTML = `<canvas></canvas>${l}`;
  $('#waves').appendChild(b);
  b.onclick = () => {
    S.wave = k;
    $$('.wv').forEach((x) => x.classList.toggle('on', x === b));
    rebuild();
    drawPrev();
  };
});
$$('.wv').forEach((b, i) => {
  const [g, w, h] = fit($('canvas', b));
  plot(g, w, h, shapeArr(W[i][2], W[i][0]), -1, 1, 3);
});
function freqPair(sl, nu, key) {
  $(sl).oninput = (e) => {
    S[key] = s2f(+e.target.value);
    $(nu).value = S[key];
    live();
    drawPrev();
  };
  $(nu).oninput = (e) => {
    const v = +e.target.value;
    if (v >= 20 && v <= 20000) {
      S[key] = v;
      $(sl).value = f2s(v);
      paint($(sl));
      live();
      drawPrev();
    }
  };
}
freqPair('#sfs', '#sf', 'sf');
freqPair('#afs', '#af', 'af');
[
  ['#sa', 'sa', '#sav'],
  ['#aa', 'aa', '#aav'],
  ['#ma', 'ma', '#mav'],
].forEach(
  ([i, k, v]) =>
    ($(i).oninput = (e) => {
      S[k] = e.target.value / 100;
      $(v).textContent = e.target.value + '%';
      live();
    }),
);

// ---------- advanced ----------
const hb = $('#harm');
for (let k = 0; k < 16; k++) {
  const d = document.createElement('div');
  d.innerHTML = `<input type="range" min="0" max="100" value="${k ? 0 : 100}">${k + 1}`;
  hb.appendChild(d);
  $('input', d).oninput = (e) => {
    Hm[k] = e.target.value / 100;
    const N = T.length;
    let mx = 0;
    for (let i = 0; i < N; i++) {
      let v = 0;
      for (let j = 0; j < 16; j++) if (Hm[j]) v += Hm[j] * Math.sin((TAU * (j + 1) * i) / N);
      T[i] = v;
      mx = Math.max(mx, Math.abs(v));
    }
    if (mx > 0) for (let i = 0; i < N; i++) T[i] /= mx;
    drawAdv();
    drawPrev();
    rebuildD();
  };
}
const setT = (fn) => {
  for (let i = 0; i < T.length; i++) T[i] = fn(i / T.length);
  drawAdv();
  drawPrev();
  rebuildD();
};
function smooth() {
  const N = T.length,
    c = Float32Array.from(T);
  for (let p = 0; p < 4; p++)
    for (let i = 0; i < N; i++) {
      let s = 0;
      for (let j = -3; j <= 3; j++) s += c[(i + j + N) % N];
      T[i] = s / 7;
    }
  for (let i = 0; i < N; i++) c[i] = T[i];
  drawAdv();
  drawPrev();
  rebuildD();
}
$('#smooth').onclick = smooth;
$$('[data-p]').forEach(
  (b) =>
    (b.onclick = () => {
      const p = b.dataset.p;
      $$('#harm input').forEach((i, k) => (i.value = p === 'sine' && k === 0 ? 100 : 0));
      Hm.fill(0);
      if (p === 'sine') Hm[0] = 1;
      if (p === 'rand') {
        for (let i = 0; i < T.length; i++) T[i] = Math.random() * 2 - 1;
        smooth();
        return;
      }
      setT(p === 'sine' ? W[0][2] : p === 'square' ? W[1][2] : p === 'tri' ? tri : W[3][2]);
    }),
);
(() => {
  const c = $('#c-draw');
  let last = null,
    dn = false;
  const pos = (e) => {
    const r = c.getBoundingClientRect(),
      N = T.length;
    return [
      Math.max(0, Math.min(N - 1, Math.round(((e.clientX - r.left) / r.width) * (N - 1)))),
      Math.max(-1, Math.min(1, 1 - 2 * ((e.clientY - r.top - 10) / (r.height - 20)))),
    ];
  };
  c.onpointerdown = (e) => {
    dn = true;
    c.setPointerCapture(e.pointerId);
    last = pos(e);
    T[last[0]] = last[1];
    upd();
  };
  c.onpointermove = (e) => {
    if (!dn) return;
    const [i, v] = pos(e),
      [j, u] = last,
      s = i > j ? 1 : -1;
    for (let k = j; k !== i + s; k += s) T[k] = u + (v - u) * (i === j ? 1 : (k - j) / (i - j));
    last = [i, v];
    upd();
  };
  c.onpointerup = c.onpointercancel = () => {
    dn = false;
  };
  const upd = () => {
    drawAdv();
    drawPrev();
    rebuildD();
  };
})();

// ---------- math ----------
const FN = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  atan2: Math.atan2,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  abs: Math.abs,
  sqrt: Math.sqrt,
  exp: Math.exp,
  ln: Math.log,
  log: Math.log,
  log10: Math.log10,
  log2: Math.log2,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  sign: Math.sign,
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
  mod: (a, b) => ((a % b) + b) % b,
  fract: (a) => a - Math.floor(a),
};
const C = { pi: Math.PI, e: Math.E, tau: TAU };
/* Safe equation parser: turns text like "sin(2*pi*x)^2" into a function of x.
   Supports + - * / % ^, implicit multiplication (2x), the functions in FN and the constants in C. */
function compile(src) {
  const t =
    src.toLowerCase().match(/\d*\.\d+(?:e[+-]?\d+)?|\d+(?:\.\d*)?(?:e[+-]?\d+)?|[a-z_]\w*|\S/g) ||
    [];
  let i = 0;
  const pk = () => t[i],
    nx = () => t[i++];
  const ex = (c) => {
    if (nx() !== c) throw Error(`Expected "${c}"`);
  };
  function add() {
    let a = mul();
    while (pk() === '+' || pk() === '-') {
      const o = nx(),
        b = mul(),
        l = a;
      a = o === '+' ? (x) => l(x) + b(x) : (x) => l(x) - b(x);
    }
    return a;
  }
  function mul() {
    let a = un();
    for (;;) {
      const p = pk();
      let o = '*';
      if (p === '*' || p === '/' || p === '%') o = nx();
      else if (!(p && /^[a-z_(\d.]/.test(p))) break;
      const b = un(),
        l = a;
      a = o === '*' ? (x) => l(x) * b(x) : o === '/' ? (x) => l(x) / b(x) : (x) => l(x) % b(x);
    }
    return a;
  }
  function un() {
    if (pk() === '-') {
      nx();
      const a = un();
      return (x) => -a(x);
    }
    if (pk() === '+') {
      nx();
      return un();
    }
    const a = at();
    if (pk() === '^') {
      nx();
      const b = un();
      return (x) => Math.pow(a(x), b(x));
    }
    return a;
  }
  function at() {
    const k = nx();
    if (k === undefined) throw Error('Equation ends too early');
    if (/^[\d.]/.test(k)) {
      const v = parseFloat(k);
      if (isNaN(v)) throw Error('Bad number ' + k);
      return () => v;
    }
    if (k === '(') {
      const a = add();
      ex(')');
      return a;
    }
    if (/^[a-z_]/.test(k)) {
      if (pk() === '(') {
        nx();
        if (!Object.hasOwn(FN, k)) throw Error(`Unknown function "${k}"`);
        const f = FN[k],
          as = [];
        if (pk() !== ')') {
          as.push(add());
          while (pk() === ',') {
            nx();
            as.push(add());
          }
        }
        ex(')');
        return as.length === 1
          ? (
              (a) => (x) =>
                f(a(x))
            )(as[0])
          : (x) => f(...as.map((q) => q(x)));
      }
      if (k === 'x') return (x) => x;
      if (Object.hasOwn(C, k)) {
        const v = C[k];
        return () => v;
      }
      throw Error(`Unknown name "${k}"`);
    }
    throw Error(`Unexpected "${k}"`);
  }
  const r = add();
  if (i < t.length) throw Error(`Unexpected "${t[i]}"`);
  return r;
}
const cfv = () => +$('#cf').value || 440;
function eqView() {
  const s = $('#eq').value.trim() || '…';
  $('#eqv').innerHTML =
    'y(x) = ' +
    (S.emb && !S.cyc ? '(' + esc(s) + ')' : esc(s)) +
    (S.emb && !S.cyc ? ` <span class="box">* sin(2*pi*${cfv()}*x)</span>` : '');
}
/* Evaluates the equation over the domain into one looping AudioBuffer, scales it to the y range,
   and reports periodicity / audibility notes. */
function buildMath() {
  const src = $('#eq').value.trim(),
    x0 = +$('#x0').value,
    x1 = +$('#x1').value,
    notes = [];
  try {
    if (!src) throw Error('Type an equation in x');
    if (!(isFinite(x0) && isFinite(x1) && x1 > x0))
      throw Error('Domain: x max must be larger than x min');
    const f = compile(S.emb && !S.cyc ? `(${src})*sin(2*pi*${cfv()}*x)` : src),
      D = S.cyc ? x1 - x0 : Math.min(x1 - x0, 10),
      dur = S.cyc ? 1 / pf() : D,
      N = Math.max(512, Math.round(dur * 44100)),
      raw = new Float32Array(N);
    let bad = 0,
      lo = Infinity,
      hi = -Infinity,
      sum = 0;
    for (let i = 0; i < N; i++) {
      let v = f(x0 + (D * i) / N);
      if (!isFinite(v)) {
        bad++;
        v = 0;
      }
      raw[i] = v;
      sum += v;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if ($('#auto').checked) {
      $('#y0').value = +lo.toPrecision(5);
      $('#y1').value = +hi.toPrecision(5);
    } else {
      lo = +$('#y0').value;
      hi = +$('#y1').value;
    }
    if (!(hi > lo))
      throw Error(
        hi === lo ? 'Range is flat: y min equals y max' : 'Range: y max must be larger than y min',
      );
    const mid = (lo + hi) / 2,
      hf = (hi - lo) / 2,
      y = new Float32Array(N);
    let clip = 0;
    for (let i = 0; i < N; i++) {
      let v = (raw[i] - mid) / hf;
      if (v > 1 || v < -1) {
        clip++;
        v = v > 0 ? 1 : -1;
      }
      y[i] = v;
    }
    const mean = sum / N;
    let zc = 0;
    for (let i = 1; i < N; i++) if ((raw[i - 1] - mean) * (raw[i] - mean) < 0) zc++;
    const pitch = zc / (2 * dur),
      rate = 1 / dur;
    const a = f(x0),
      b = f(x0 + D),
      jump = Math.abs(b - a) / (hi - lo || 1);
    if (jump > 0.02)
      notes.push([
        'warn',
        'Not periodic on this domain: f(x max) differs from f(x min), so every loop jumps and may click or buzz. You can still play it.',
      ]);
    else notes.push(['ok', 'The ends meet, so the loop is seamless.']);
    if (pitch < 20)
      notes.push([
        'warn',
        `Not hearable: dominant pitch ≈ ${pitch < 1 ? '0' : fmt(pitch)}, below the ~20 Hz limit of hearing. Playback is allowed, but it will sound silent or like faint clicks. Try “Cycle at pitch” to hear its shape, or “B · Embed in carrier”.`,
      ]);
    else if (pitch > 20000)
      notes.push(['warn', `Dominant pitch ≈ ${fmt(pitch)}, above the range of hearing.`]);
    else notes.push(['ok', `Dominant pitch ≈ ${fmt(pitch)}, loops at ${fmt(rate)}.`]);
    if (bad)
      notes.push([
        'warn',
        `${bad} undefined values (like 1/0 or sqrt of a negative) were set to 0.`,
      ]);
    if (clip / N > 0.005)
      notes.push([
        'warn',
        `${((100 * clip) / N).toFixed(1)}% of the wave is clipped by your y range.`,
      ]);
    if (!S.cyc && x1 - x0 > 10)
      notes.push(['warn', 'Only the first 10 seconds of the domain are played.']);
    const buf = new AudioBuffer({ length: N, sampleRate: 44100 });
    buf.copyToChannel(y, 0);
    M = { y, buf, lo, hi, rate, notes, x0, x1, pb: N / 44100 / dur };
    $('#err').textContent = '';
  } catch (e) {
    M = { err: e.message, notes: [] };
    $('#err').textContent = e.message;
  }
  $('#notes').innerHTML = M.notes
    .map(([c, t]) => `<div class="pill ${c}">${esc(t)}</div>`)
    .join('');
  drawPrev();
  rebuild();
}
const buildD = deb(buildMath, 180);
const onMath = () => {
  eqView();
  sug();
  buildD();
};
$('#eq').oninput = onMath;
['#x0', '#x1', '#y0', '#y1', '#cf'].forEach(
  (s) =>
    ($(s).oninput = () => {
      eqView();
      buildD();
    }),
);
$('#auto').onchange = (e) => {
  $('#y0').disabled = $('#y1').disabled = e.target.checked;
  buildMath();
};
$$('[data-e]').forEach(
  (b) =>
    (b.onclick = () => {
      S.emb = b.dataset.e === '1';
      $$('[data-e]').forEach((x) => x.classList.toggle('on', x === b));
      $('#cr').style.display = S.emb ? 'flex' : 'none';
      eqView();
      buildMath();
    }),
);
[
  ['sin(2*pi*3*x)', 0, 1, '3 Hz sine'],
  ['x^2', -1, 1, 'Parabola'],
  ['sin(x)*x', 0, 20, 'sin(x)·x'],
  ['exp(-6*x)*sin(2*pi*220*x)', 0, 1, 'Pluck 220 Hz'],
  ['sin(2*pi*110*x)+sin(2*pi*165*x)', 0, 1, 'Fifth'],
].forEach(([q, a, b, l]) => {
  const e = document.createElement('button');
  e.className = 'chip';
  e.textContent = l;
  e.onclick = () => {
    $('#eq').value = q;
    $('#x0').value = a;
    $('#x1').value = b;
    eqView();
    buildMath();
  };
  $('#ex').appendChild(e);
});

// gentle autocomplete: chips under the field, Tab accepts, Esc dismisses, nothing overlays the input
const NAMES = [...Object.keys(FN).map((n) => [n, 1]), ['pi', 0], ['tau', 0]];
const word = () => {
  const el = $('#eq');
  return /[a-z_][a-z0-9_]*$/i.exec(el.value.slice(0, el.selectionStart));
};
function sug() {
  const m = word(),
    box = $('#sug');
  let L = [];
  if (m && m[0].length >= 2 && document.activeElement === $('#eq')) {
    const q = m[0].toLowerCase();
    if (!NAMES.some(([n]) => n === q)) L = NAMES.filter(([n]) => n.startsWith(q)).slice(0, 5);
  }
  box.innerHTML = L.map(
    ([n, f], i) =>
      `<button type="button" data-n="${n}" data-f="${f}">${n}${f ? '()' : ''}${i ? '' : '<kbd>Tab</kbd>'}</button>`,
  ).join('');
  box.classList.toggle('on', !!L.length);
}
function acc(n, f) {
  const el = $('#eq'),
    m = word();
  if (!m) return;
  const c = el.selectionStart,
    s = c - m[0].length,
    ins = f ? n + '()' : n;
  el.value = el.value.slice(0, s) + ins + el.value.slice(c);
  const p = s + ins.length - (f ? 1 : 0);
  el.focus();
  el.setSelectionRange(p, p);
  onMath();
}
$('#sug').onmousedown = (e) => {
  e.preventDefault();
  const b = e.target.closest('button');
  if (b) acc(b.dataset.n, b.dataset.f === '1');
};
$('#eq').onkeydown = (e) => {
  const b = $('#sug button');
  if (e.key === 'Tab' && b && $('#sug').classList.contains('on') && !e.shiftKey) {
    e.preventDefault();
    acc(b.dataset.n, b.dataset.f === '1');
  } else if (e.key === 'Escape') $('#sug').classList.remove('on');
};
$('#eq').onkeyup = (e) => {
  if (e.key.startsWith('Arrow') || e.key === 'Backspace') sug();
};
$('#eq').onblur = () => $('#sug').classList.remove('on');

addEventListener(
  'resize',
  deb(() => {
    drawAll();
    $$('.wv').forEach((b, i) => {
      const [g, w, h] = fit($('canvas', b));
      plot(g, w, h, shapeArr(W[i][2], W[i][0]), -1, 1, 3);
    });
  }, 100),
);
// sliding lens for segmented controls (stretches while moving, follows a drag)
const segs = $$('.seg').map((sg) => {
  const L = document.createElement('span');
  L.className = 'lens';
  sg.prepend(L);
  sg.addEventListener('click', (e) => {
    if (e.target.closest('button')) {
      L.style.transform = 'scale(1.06,.96)';
      setTimeout(() => (L.style.transform = ''), 230);
    }
  });
  sg.addEventListener('pointerdown', () => {
    sg.classList.add('press');
    sg._p = 1;
  });
  return { sg, L };
});
const placeAll = () =>
  segs.forEach(({ sg, L }) => {
    const b = $('button.on', sg);
    if (b && b.offsetWidth) {
      L.style.left = b.offsetLeft + 'px';
      L.style.width = b.offsetWidth + 'px';
    }
  });
addEventListener('pointermove', (e) =>
  segs.forEach(({ sg }) => {
    if (!sg._p) return;
    const b = document.elementFromPoint(e.clientX, e.clientY)?.closest('.seg button');
    if (b && sg.contains(b) && !b.classList.contains('on')) b.click();
  }),
);
addEventListener('pointerup', () =>
  segs.forEach(({ sg }) => {
    sg._p = 0;
    sg.classList.remove('press');
  }),
);
addEventListener('pointercancel', () =>
  segs.forEach(({ sg }) => {
    sg._p = 0;
    sg.classList.remove('press');
  }),
);
document.addEventListener('click', () => requestAnimationFrame(placeAll));
addEventListener('resize', placeAll);
// slider lens stretches in the direction of travel
$$('input.r').forEach((el) => {
  let last = +el.value,
    t;
  el.addEventListener('input', () => {
    const v = +el.value,
      d = Math.abs(v - last) / (el.max - el.min);
    last = v;
    el.style.setProperty('--st', Math.min(0.7, d * 45));
    clearTimeout(t);
    t = setTimeout(() => el.style.setProperty('--st', 0), 90);
  });
});
window.drawIcons = () =>
  $$('.wv').forEach((b, i) => {
    const [g, w, h] = fit($('canvas', b));
    plot(g, w, h, shapeArr(W[i][2], W[i][0]), -1, 1, 5);
  });
$('#pw').oninput = (e) => {
  S.pw = e.target.value / 100;
  $('#pwv').textContent = e.target.value + '%';
  drawIcons();
  drawPrev();
  rebuildD();
};
document.addEventListener('click', () => {
  $('#pwr').style.display = S.wave === 'pwm' ? 'flex' : 'none';
});
const root = document.documentElement,
  thb = $('#theme');
const setTheme = (t) => {
  root.dataset.theme = t;
  thb.textContent = t === 'dark' ? '☀ Light' : '☾ Dark';
  try {
    localStorage.setItem('ws-theme', t);
  } catch {}
  drawAll();
};
thb.onclick = () => setTheme(root.dataset.theme === 'dark' ? 'light' : 'dark');
let saved;
try {
  saved = localStorage.getItem('ws-theme');
} catch {}
const pf = () => Math.max(1, +$('#pf').value || 220);
$('#pf').oninput = buildD;
$$('#tm button').forEach(
  (b) =>
    (b.onclick = () => {
      S.cyc = b.dataset.t === '1';
      $$('#tm button').forEach((x) => x.classList.toggle('on', x === b));
      $('#ab').style.display = S.cyc ? 'none' : '';
      $('#cr').style.display = !S.cyc && S.emb ? 'flex' : 'none';
      $('#pr').style.display = S.cyc ? 'flex' : 'none';
      eqView();
      buildMath();
    }),
);
eqView();
buildMath();
drawAll();
loop();
placeAll();
setTimeout(placeAll, 200);
setTheme(saved || (matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light'));
