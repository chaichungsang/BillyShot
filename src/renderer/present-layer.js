'use strict';
// 演示层：鼠标光圈 / 点击波纹 / 聚光灯。窗口本身鼠标穿透，这里只负责画。
const $ = (id) => document.getElementById(id);
const halo = $('halo'), spotEl = $('spot'), dimAll = $('dimAll');
const HEX = /^#[0-9a-f]{6}$/i;
let cfg = { halo: false, clicks: false, spot: false };
let pos = { on: false, x: 0, y: 0 };
let raf = 0;
const MAX_RIPPLES = 12;

function rgba(hex, a) {
  if (!HEX.test(hex)) hex = '#ffd23f';
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function applyStyle() {
  const s = cfg.haloSize || 56, op = cfg.haloOpacity || 0.35;
  halo.style.width = halo.style.height = s + 'px';
  halo.style.background = rgba(cfg.haloColor, op);
  halo.style.boxShadow = `0 0 0 2px ${rgba(cfg.haloColor, Math.min(1, op + 0.4))}`;
  // 聚光灯：1/4 尺寸的径向渐变放大 4 倍，覆盖 2 倍屏幕，移动时只改 transform
  const W = innerWidth, H = innerHeight, r = (cfg.spotRadius || 170) / 4, dim = cfg.spotDim || 0.6;
  spotEl.style.width = (W / 2) + 'px'; spotEl.style.height = (H / 2) + 'px';
  spotEl.style.background = `radial-gradient(circle at 50% 50%, rgba(0,0,0,0) 0, rgba(0,0,0,0) ${r * 0.8}px, rgba(0,0,0,${dim}) ${r}px)`;
  dimAll.style.background = `rgba(0,0,0,${dim})`;
}

function draw() {
  raf = 0;
  const s = cfg.haloSize || 56;
  halo.style.display = cfg.halo && pos.on ? 'block' : 'none';
  if (cfg.halo && pos.on) halo.style.transform = `translate3d(${pos.x - s / 2}px, ${pos.y - s / 2}px, 0)`;
  // 聚光灯：鼠标在这块屏上时显示亮圈，否则整块屏变暗
  spotEl.style.display = cfg.spot && pos.on ? 'block' : 'none';
  dimAll.style.display = cfg.spot && !pos.on ? 'block' : 'none';
  if (cfg.spot && pos.on) spotEl.style.transform = `translate3d(${pos.x - innerWidth}px, ${pos.y - innerHeight}px, 0) scale(4)`;
}
function schedule() { if (!raf) raf = requestAnimationFrame(draw); }

api.on('present:cfg', (c) => {
  cfg = c || cfg;
  if (!cfg.clicks) { document.querySelectorAll('.rip').forEach((e) => e.remove()); water.clear(); }
  applyStyle(); schedule();
});
api.on('present:pos', (p) => { pos = p.on ? { on: true, x: p.x, y: p.y } : { ...pos, on: false }; schedule(); });
// ------------------------------------------------------------ 水波纹（1.3.3）
// 透明的水波：每次点击往外荡开一个「波包」（一道主波峰，后面拖几道越来越小的波）。按水面起伏算出每一点的斜率：
//  · 折射：主进程在点击那一刻抓下点击处周围一小块屏幕（present:patch），波纹经过的地方把这块画面按斜率错开，
//    像隔着一层清水看，画面被水折弯；没有波的地方完全透明，直接看到下面真实的画面。
//  · 反光：迎光的波峰上一道细细的亮线（带一点左键 / 右键颜色），背光处极淡的影子。
// 波纹点下去马上开始（刚开始几帧几乎看不见）；画面一到，折射在 0.12 秒内淡入，不会突然变样。
// 抓不到画面（Mac 没有屏幕录制权限、抓屏失败等）时只画反光和影子，同样是透明的。
// WebGL 第一次点击时才创建；没有波纹时画布缩成 1×1，不占显存、不画任何东西。
const WATER = { V: 150, LAMBDA: 24, SIG: 22, LIFE: 1.6, FADE_IN: 0.12 };   // 波速 px/s、波长、波包宽度、持续秒数、折射淡入秒数
const water = (() => {
  const cv = $('water');
  let gl = null, prog = null, buf = null, U = {}, failed = false, lost = false;
  const list = []; let frameReq = 0, w = 0, h = 0;
  const quad = new Float32Array(8);
  const VS = `
attribute vec2 p; uniform vec2 view; varying vec2 vp;
void main() { vp = p; gl_Position = vec4(p.x / view.x * 2.0 - 1.0, 1.0 - p.y / view.y * 2.0, 0.0, 1.0); }`;
  const FS = `
precision highp float;
varying vec2 vp;
uniform vec2 c;          // 中心（CSS px）
uniform float t;         // 已经过的秒数
uniform vec3 tc;         // 左键 / 右键颜色
uniform sampler2D img;   // 点击时抓下的那块屏幕
uniform vec4 patch;      // 那块画面在屏幕上的位置 x, y, 宽, 高（CSS px）
uniform float hasImg;     // 0–1：折射淡入
const float V = ${WATER.V.toFixed(1)}, LAMBDA = ${WATER.LAMBDA.toFixed(1)}, SIG = ${WATER.SIG.toFixed(1)}, LIFE = ${WATER.LIFE.toFixed(2)};
void main() {
  vec2 d = vp - c; float r = length(d);
  if (r < 0.5) discard;
  float x = r - (8.0 + V * t);
  float env = exp(-x * x / (SIG * SIG));
  if (env < 0.002) discard;
  float fade = 1.0 - smoothstep(0.0, LIFE, t);
  float amp = 0.8 * fade * fade / sqrt(1.0 + r / 80.0) * smoothstep(0.0, 0.08, t);
  float k = 6.2831853 / LAMBDA;
  float s = amp * (-k * sin(k * x) * env - 2.0 * x / (SIG * SIG) * env * cos(k * x));   // 高度对半径的斜率
  vec2 grad = s * d / r;
  vec3 N = normalize(vec3(-grad * 7.0, 1.0));
  vec3 L = normalize(vec3(-0.45, -0.65, 0.62));
  vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
  float diff = dot(N, L) - L.z;               // 平的地方为 0，迎光为正，背光为负
  float glint = pow(max(dot(N, H), 0.0), 140.0);
  float rim = smoothstep(0.02, 0.25, max(diff, 0.0));
  float lit = clamp(glint * 1.4 + rim * 0.35, 0.0, 0.85);
  vec3 hi = mix(vec3(1.0), tc, 0.5);
  vec3 C = vec3(0.0); float A = 0.0;
  vec2 off = -grad * 16.0;                    // 折射：画面错开多少（CSS px）
  vec2 uv = (vp + off - patch.xy) / patch.zw;
  if (hasImg > 0.0 && uv.x >= 0.0 && uv.y >= 0.0 && uv.x <= 1.0 && uv.y <= 1.0) {
    float a = clamp(length(off) * 0.8, 0.0, 1.0) * hasImg;   // 几乎没错开的地方直接透明，看下面真实的画面
    float shade = clamp(-diff * 0.45, 0.0, 0.06);
    C = texture2D(img, uv).rgb * (1.0 - shade) * a; A = a;
  } else {
    float shade = clamp(-diff * 0.45, 0.0, 0.12);   // 没有画面时：只有极淡的影子
    A = shade;
  }
  C = hi * lit + C * (1.0 - lit); A = lit + A * (1.0 - lit);   // 反光叠在最上面（预乘透明度）
  if (A < 0.004) discard;
  gl_FragColor = vec4(C, A);
}`;
  function init() {
    try {
      gl = cv.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false });
      if (!gl) { console.warn('water: WebGL unavailable, using concentric white rings'); failed = true; return false; }
      const sh = (type, src) => { const o = gl.createShader(type); gl.shaderSource(o, src); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
      prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
      gl.useProgram(prog);
      buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      const aP = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(aP); gl.vertexAttribPointer(aP, 2, gl.FLOAT, false, 0, 0);
      U = {}; for (const n of ['view', 'c', 't', 'tc', 'img', 'patch', 'hasImg']) U[n] = gl.getUniformLocation(prog, n);
      gl.uniform1i(U.img, 0);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(0, 0, 0, 0);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      lost = false;
      return true;
    } catch (e) { console.warn('water shader failed', e && e.message); failed = true; gl = null; return false; }
  }
  // 显卡驱动重置 / 睡眠唤醒会丢失 WebGL：期间退回单圈，恢复后重新初始化
  cv.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true; list.length = 0; });
  cv.addEventListener('webglcontextrestored', () => { failed = false; init(); });
  const ready = () => { if (!gl && !failed) init(); return !!gl && !lost; };
  function size() {
    const d = devicePixelRatio || 1;
    w = innerWidth; h = innerHeight;
    const cw = Math.max(1, Math.round(w * d)), ch = Math.max(1, Math.round(h * d));
    if (cv.width !== cw || cv.height !== ch) { cv.width = cw; cv.height = ch; }
    gl.viewport(0, 0, cv.width, cv.height); gl.uniform2f(U.view, w, h);
  }
  function drop(r) { if (r.tex && gl) gl.deleteTexture(r.tex); r.tex = null; }
  function frame() {
    frameReq = 0;
    if (!gl || lost) return;
    const now = performance.now() / 1000;
    for (let i = list.length - 1; i >= 0; i--) if (now - list[i].t0 > WATER.LIFE) { drop(list[i]); list.splice(i, 1); }
    gl.clear(gl.COLOR_BUFFER_BIT);
    for (const r of list) {
      const t = now - r.t0, R = 8 + WATER.V * t + 3 * WATER.SIG;
      quad.set([r.x - R, r.y - R, r.x + R, r.y - R, r.x - R, r.y + R, r.x + R, r.y + R]);
      gl.bufferData(gl.ARRAY_BUFFER, quad, gl.DYNAMIC_DRAW);
      gl.uniform2f(U.c, r.x, r.y); gl.uniform1f(U.t, t); gl.uniform3f(U.tc, r.rgb[0], r.rgb[1], r.rgb[2]);
      if (r.tex) { gl.bindTexture(gl.TEXTURE_2D, r.tex); gl.uniform4f(U.patch, r.patch.x, r.patch.y, r.patch.w, r.patch.h); gl.uniform1f(U.hasImg, Math.min(1, (now - r.texT0) / WATER.FADE_IN)); }
      else gl.uniform1f(U.hasImg, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    if (list.length) frameReq = requestAnimationFrame(frame);
    else { cv.width = 1; cv.height = 1; }   // 没有波纹：画布缩成 1×1，释放显存
  }
  const kick = () => { if (!frameReq) frameReq = requestAnimationFrame(frame); };
  return {
    ok: () => ready(),
    add(c, button, hex) {
      if (!ready()) return false;
      if (!HEX.test(hex)) hex = '#ffffff';
      const n = parseInt(hex.slice(1), 16);
      if (!list.length) size();
      while (list.length >= MAX_RIPPLES) drop(list.shift());
      list.push({ id: c.id, x: c.x, y: c.y, button, hex, rgb: [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255],
        t0: performance.now() / 1000, tex: null, texT0: 0, patch: null });
      kick();
      return true;
    },
    patch(p) {
      const r = list.find((e) => e.id === p.id);
      if (!r || !gl || lost || r.tex) return;
      if (!p.data || !(p.pw > 1) || !(p.ph > 1) || p.data.length < p.pw * p.ph * 4) return;
      try {
        const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        const data = p.data instanceof Uint8Array ? p.data : new Uint8Array(p.data);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, p.pw, p.ph, 0, gl.RGBA, gl.UNSIGNED_BYTE, data.subarray(0, p.pw * p.ph * 4));
        r.tex = tex; r.texT0 = performance.now() / 1000; r.patch = { x: p.x, y: p.y, w: p.w, h: p.h };
      } catch (e) { console.warn('water patch failed', e && e.message); }
    },
    clear() { list.forEach(drop); list.length = 0; kick(); },
    resize() { if (gl && !lost && list.length) { size(); kick(); } },
    gl: () => !!gl && !lost,
    list: () => list.map((r) => ({ style: 'water', button: r.button, x: r.x, y: r.y, color: r.hex, refract: !!r.tex, age: +(performance.now() / 1000 - r.t0).toFixed(2) })),
  };
})();

function addConcentricRings(c) {
  const all = document.querySelectorAll('.rip');
  if (all.length >= MAX_RIPPLES) all[0].remove();
  const d = document.createElement('div');
  d.className = 'rip';
  d.style.left = c.x + 'px'; d.style.top = c.y + 'px';
  d.addEventListener('animationend', () => d.remove());
  document.body.appendChild(d);
}
api.on('present:click', (c) => {
  if (!cfg.clicks) return;
  // Stored "single", or no WebGL: concentric translucent white rings. Not clickLeft, not one pink ring.
  if (cfg.rippleStyle !== 'single') {
    const color = c.button === 'left' ? cfg.clickLeft : cfg.clickRight;
    if (water.add(c, c.button === 'left' ? 'left' : 'right', color)) return;
  }
  addConcentricRings(c);
});
api.on('present:patch', (p) => water.patch(p));
window.addEventListener('resize', () => { applyStyle(); schedule(); water.resize(); });
// 给自动化测试读状态
window.__present = () => ({ cfg, pos, halo: halo.style.display !== 'none' ? halo.style.transform : null, spot: spotEl.style.display !== 'none', dimAll: dimAll.style.display !== 'none', ripples: [...document.querySelectorAll('.rip')].map((e) => e.className),
  waterGL: water.gl(), water: water.list() });
