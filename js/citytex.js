// 城市程序化纹理:五种立面风格 + 街面商铺 + 路面/人行道/草地/屋顶/石材等
// 每个立面输出 map(颜色) / emissiveMap(亮灯窗户) / normalMap(凹凸) / roughnessMap(G) + metalnessMap(B)
import * as THREE from 'three';
import {
  makeCanvas, makeTex, heightFromCanvas, normalFromHeight, mulberry32,
  paint, fbm, vnoise, smoothstep, clamp01,
} from './textures.js';

// ---------- 画布组 ----------
function layers(W, H) {
  const mk = () => { const c = makeCanvas(W, H); return [c, c.getContext('2d')]; };
  const [colC, col] = mk(), [emiC, emi] = mk(), [hC, hgt] = mk(), [oC, orm] = mk();
  emi.fillStyle = '#000'; emi.fillRect(0, 0, W, H);
  hgt.fillStyle = 'rgb(128,128,128)'; hgt.fillRect(0, 0, W, H);
  orm.fillStyle = 'rgb(0,230,0)'; orm.fillRect(0, 0, W, H);
  return { W, H, colC, emiC, hC, oC, col, emi, hgt, orm };
}
// 同时画到多层:c = {col, emi, h (0..1), rough, metal}
function rect(L, x, y, w, h, c) {
  if (c.col) { L.col.fillStyle = c.col; L.col.fillRect(x, y, w, h); }
  if (c.emi !== undefined) { L.emi.fillStyle = c.emi || '#000'; L.emi.fillRect(x, y, w, h); }
  if (c.h !== undefined) { const v = Math.round(c.h * 255); L.hgt.fillStyle = `rgb(${v},${v},${v})`; L.hgt.fillRect(x, y, w, h); }
  if (c.rough !== undefined) {
    L.orm.fillStyle = `rgb(0,${Math.round(c.rough * 255)},${Math.round((c.metal || 0) * 255)})`;
    L.orm.fillRect(x, y, w, h);
  }
}
function speckle(L, W, H, rng, n, alpha, dark = true, size = 2) {
  for (let i = 0; i < n; i++) {
    L.col.fillStyle = dark ? `rgba(0,0,0,${rng() * alpha})` : `rgba(255,255,255,${rng() * alpha})`;
    L.col.fillRect(rng() * W, rng() * H, size * (0.5 + rng()), size * (0.5 + rng()));
  }
}
function finish(L, normalStrength = 3) {
  const H = heightFromCanvas(L.hC);
  return {
    map: makeTex(L.colC),
    emissiveMap: makeTex(L.emiC),
    normalMap: makeTex(normalFromHeight(H, L.W, L.H, normalStrength), { srgb: false }),
    ormMap: makeTex(L.oC, { srgb: false }),
  };
}

// ---------- 窗户 ----------
const WARM = () => `hsl(${30 + Math.random() * 16},${70 + Math.random() * 25}%,${55 + Math.random() * 22}%)`;
const COOL = () => `hsl(${190 + Math.random() * 30},${30 + Math.random() * 30}%,${55 + Math.random() * 18}%)`;

function windowPane(L, x, y, w, h, rng, litP, opts = {}) {
  const lit = rng() < litP;
  if (lit) {
    const cool = rng() < (opts.coolBias ?? 0.3);
    const c = cool ? COOL() : WARM();
    const g = L.col.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, c); g.addColorStop(1, 'rgba(40,25,20,1)');
    L.col.fillStyle = g; L.col.fillRect(x, y, w, h);
    const ge = L.emi.createLinearGradient(0, y, 0, y + h);
    ge.addColorStop(0, c); ge.addColorStop(0.75, c); ge.addColorStop(1, '#221510');
    L.emi.fillStyle = ge; L.emi.fillRect(x, y, w, h);
    const r = rng();
    if (r < 0.3) {
      // 窗帘
      const cw = w * (0.25 + rng() * 0.35);
      const cx = rng() < 0.5 ? x : x + w - cw;
      const cc = `hsla(${rng() * 360},30%,${30 + rng() * 25}%,0.85)`;
      L.col.fillStyle = cc; L.col.fillRect(cx, y, cw, h);
      L.emi.fillStyle = 'rgba(0,0,0,0.6)'; L.emi.fillRect(cx, y, cw, h);
    } else if (r < 0.5) {
      // 百叶
      L.col.fillStyle = 'rgba(0,0,0,0.25)'; L.emi.fillStyle = 'rgba(0,0,0,0.35)';
      for (let yy = y + 1; yy < y + h; yy += 3) { L.col.fillRect(x, yy, w, 1); L.emi.fillRect(x, yy, w, 1); }
    } else if (r < 0.62) {
      // 室内剪影(家具/人)
      L.col.fillStyle = 'rgba(10,6,6,0.8)'; L.emi.fillStyle = '#000';
      const sw = w * (0.2 + rng() * 0.3), sh = h * (0.3 + rng() * 0.3);
      const sx = x + rng() * (w - sw);
      L.col.fillRect(sx, y + h - sh, sw, sh); L.emi.fillRect(sx, y + h - sh, sw, sh);
    }
    rect(L, x, y, w, h, { h: 0.2, rough: 0.35, metal: 0.1 });
  } else {
    const g = L.col.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, opts.refTop || '#39405e'); g.addColorStop(1, opts.refBot || '#0d0f1a');
    L.col.fillStyle = g; L.col.fillRect(x, y, w, h);
    rect(L, x, y, w, h, { h: 0.2, rough: 0.06, metal: 0.85 });
  }
  return lit;
}

// ---------- 1. 玻璃幕墙 ----------
function glassFacade(seed, tint) {
  const rng = mulberry32(seed);
  const bays = 8, floors = 8, bw = 48, fh = 120;
  const L = layers(bays * bw, floors * fh);
  rect(L, 0, 0, L.W, L.H, { col: '#1b2230', h: 0.5, rough: 0.5, metal: 0.6 });
  for (let f = 0; f < floors; f++) {
    const y0 = L.H - (f + 1) * fh;
    const floorLit = rng() < 0.35 ? 0.75 : 0.12;
    for (let b = 0; b < bays; b++) {
      const x0 = b * bw;
      // 层间窗槛墙
      rect(L, x0, y0 + fh - 20, bw, 20, { col: tint.spandrel, h: 0.45, rough: 0.35, metal: 0.7 });
      windowPane(L, x0 + 2, y0 + 3, bw - 4, fh - 24, rng, floorLit,
        { coolBias: 0.75, refTop: tint.top, refBot: tint.bot });
      // 横梃
      rect(L, x0, y0 + 36, bw, 2, { col: tint.mullion, h: 0.6, rough: 0.3, metal: 0.9 });
      // 竖梃
      rect(L, x0, y0, 3, fh, { col: tint.mullion, h: 0.75, rough: 0.3, metal: 0.9 });
    }
  }
  return finish(L, 2.5);
}

// ---------- 2. 砖墙 ----------
function brickFacade(seed, base, mortar) {
  const rng = mulberry32(seed);
  const bays = 8, floors = 8, bw = 64, fh = 70;
  const L = layers(bays * bw, floors * fh);
  rect(L, 0, 0, L.W, L.H, { col: base, h: 0.55, rough: 0.92, metal: 0 });
  // 砖缝
  for (let y = 0; y < L.H; y += 3) {
    L.col.fillStyle = mortar; L.col.globalAlpha = 0.35; L.col.fillRect(0, y, L.W, 1);
    L.hgt.fillStyle = 'rgb(110,110,110)'; L.hgt.fillRect(0, y, L.W, 1);
    const off = (y / 3) % 2 ? 0 : 3;
    for (let x = off; x < L.W; x += 6) { L.col.fillRect(x, y, 1, 3); }
  }
  L.col.globalAlpha = 1;
  // 砖块色差
  for (let i = 0; i < 5000; i++) {
    L.col.fillStyle = `rgba(${rng() < 0.5 ? '0,0,0' : '255,220,200'},${rng() * 0.12})`;
    L.col.fillRect(Math.floor(rng() * L.W / 6) * 6, Math.floor(rng() * L.H / 3) * 3, 5, 2);
  }
  speckle(L, L.W, L.H, rng, 1500, 0.15);
  for (let f = 0; f < floors; f++) {
    const y0 = L.H - (f + 1) * fh;
    for (let b = 0; b < bays; b++) {
      const x0 = b * bw;
      const ww = 24, wh = 40, wx = x0 + (bw - ww) / 2, wy = y0 + 14;
      // 过梁与窗台
      rect(L, wx - 3, wy - 5, ww + 6, 5, { col: '#c9bda6', h: 0.85, rough: 0.8 });
      rect(L, wx - 2, wy + wh, ww + 4, 3, { col: '#c2b59c', h: 0.85, rough: 0.8 });
      rect(L, wx - 1, wy - 1, ww + 2, wh + 2, { col: '#e8e2d6', h: 0.45, rough: 0.6 });
      windowPane(L, wx + 1, wy + 1, ww - 2, wh - 2, rng, 0.3);
      // 双悬窗中梃
      rect(L, wx, wy + wh / 2 - 1, ww, 2, { col: '#ddd6ca', h: 0.5, rough: 0.6 });
      // 空调外机(偶尔)
      if (rng() < 0.08) rect(L, wx + 4, wy + wh / 2 + 2, 16, 10, { col: '#9a9a96', h: 0.95, rough: 0.6, metal: 0.4 });
    }
    // 层间砖带
    if (f % 4 === 0) rect(L, 0, y0 + fh - 3, L.W, 3, { col: '#b5a68c', h: 0.8, rough: 0.85 });
  }
  return finish(L, 3);
}

// ---------- 3. 装饰艺术石材 ----------
function stoneFacade(seed) {
  const rng = mulberry32(seed);
  const bays = 8, floors = 8, bw = 48, fh = 72;
  const L = layers(bays * bw, floors * fh);
  rect(L, 0, 0, L.W, L.H, { col: '#b3a58c', h: 0.7, rough: 0.85 });
  speckle(L, L.W, L.H, rng, 4000, 0.1);
  speckle(L, L.W, L.H, rng, 1500, 0.08, false);
  for (let f = 0; f < floors; f++) {
    const y0 = L.H - (f + 1) * fh;
    for (let b = 0; b < bays; b++) {
      const x0 = b * bw;
      // 凹进的窗槽 + 装饰窗槛板
      rect(L, x0 + 10, y0, bw - 20, fh, { col: '#6d6452', h: 0.35, rough: 0.8 });
      windowPane(L, x0 + 12, y0 + 6, bw - 24, fh - 24, rng, 0.33);
      rect(L, x0 + 10, y0 + fh - 16, bw - 20, 16, { col: '#4a4336', h: 0.4, rough: 0.5, metal: 0.5 });
      // 人字纹
      L.col.strokeStyle = '#8c7a55'; L.col.lineWidth = 1.5;
      L.col.beginPath();
      for (let k = 0; k < 3; k++) {
        const yy = y0 + fh - 13 + k * 4;
        L.col.moveTo(x0 + 12, yy + 3); L.col.lineTo(x0 + bw / 2, yy); L.col.lineTo(x0 + bw - 12, yy + 3);
      }
      L.col.stroke();
      // 竖向壁柱高光
      rect(L, x0, y0, 10, fh, { col: '#c2b59b', h: 0.9, rough: 0.8 });
      rect(L, x0 + bw - 10, y0, 10, fh, { col: '#a99b81', h: 0.85, rough: 0.8 });
    }
  }
  return finish(L, 3.5);
}

// ---------- 4. 现代横向带窗 ----------
function modernFacade(seed) {
  const rng = mulberry32(seed);
  const bays = 8, floors = 8, bw = 64, fh = 72;
  const L = layers(bays * bw, floors * fh);
  rect(L, 0, 0, L.W, L.H, { col: '#8d9096', h: 0.8, rough: 0.7 });
  speckle(L, L.W, L.H, rng, 2500, 0.08);
  for (let f = 0; f < floors; f++) {
    const y0 = L.H - (f + 1) * fh;
    const litP = rng() < 0.3 ? 0.7 : 0.15;
    rect(L, 0, y0, L.W, 44, { col: '#101521', h: 0.3, rough: 0.1, metal: 0.8 });
    for (let x = 0; x < L.W; x += 32) {
      windowPane(L, x + 2, y0 + 2, 28, 40, rng, litP, { coolBias: 0.6, refTop: '#4a5470', refBot: '#141a2a' });
      rect(L, x, y0, 2, 44, { col: '#2b2f38', h: 0.45, rough: 0.35, metal: 0.8 });
    }
    rect(L, 0, y0 + 44, L.W, 2, { col: '#5d6068', h: 0.6, rough: 0.5 });
  }
  return finish(L, 2.5);
}

// ---------- 5. 街面商铺 ----------
const SHOPS = ['PIZZA', 'DELI', 'CAFE', 'BAR', 'BOOKS', 'PHARMACY', 'SUSHI', 'HOTEL',
  'BAGELS', '24H', 'COFFEE', 'NOODLES', 'BANK', 'FLOWERS', 'DINER', 'GYM'];
function storeFacade(seed) {
  const rng = mulberry32(seed);
  const n = 8, bw = 128, fh = 96;
  const L = layers(n * bw, fh);
  rect(L, 0, 0, L.W, fh, { col: '#3b3533', h: 0.7, rough: 0.8 });
  for (let i = 0; i < n; i++) {
    const x0 = i * bw;
    const hue = Math.floor(rng() * 360);
    const name = SHOPS[Math.floor(rng() * SHOPS.length)];
    // 招牌
    rect(L, x0 + 6, 6, bw - 12, 20, { col: `hsl(${hue},55%,22%)`, h: 0.85, rough: 0.5 });
    const neon = rng() < 0.6;
    L.col.font = 'bold 15px Arial'; L.col.textAlign = 'center'; L.col.textBaseline = 'middle';
    L.emi.font = L.col.font; L.emi.textAlign = 'center'; L.emi.textBaseline = 'middle';
    const tc = neon ? `hsl(${(hue + 180) % 360},100%,70%)` : '#f2e6c8';
    L.col.fillStyle = tc; L.col.fillText(name, x0 + bw / 2, 16.5);
    L.emi.fillStyle = neon ? tc : '#6a624e'; L.emi.fillText(name, x0 + bw / 2, 16.5);
    // 橱窗
    const wx = x0 + 8, wy = 32, ww = bw - 46, wh = 58;
    const warm = `hsl(${30 + rng() * 20},80%,${55 + rng() * 15}%)`;
    const g = L.col.createLinearGradient(0, wy, 0, wy + wh);
    g.addColorStop(0, warm); g.addColorStop(1, '#3a2a1c');
    L.col.fillStyle = g; L.col.fillRect(wx, wy, ww, wh);
    L.emi.fillStyle = g; L.emi.fillRect(wx, wy, ww, wh);
    // 货架与商品剪影
    for (let s = 0; s < 3; s++) {
      const sy = wy + 16 + s * 14;
      L.col.fillStyle = 'rgba(30,18,12,0.8)'; L.col.fillRect(wx + 4, sy, ww - 8, 2);
      L.emi.fillStyle = 'rgba(0,0,0,0.7)'; L.emi.fillRect(wx + 4, sy, ww - 8, 2);
      for (let k = 0; k < 8; k++) {
        const c = `hsl(${rng() * 360},60%,45%)`;
        L.col.fillStyle = c; L.col.fillRect(wx + 6 + k * (ww - 12) / 8, sy - 6, 5, 6);
      }
    }
    rect(L, wx, wy, ww, wh, { h: 0.3, rough: 0.1, metal: 0.3 });
    rect(L, wx - 2, wy - 2, ww + 4, 3, { col: '#1a1a1a', h: 0.5, rough: 0.4, metal: 0.6 });
    rect(L, wx + ww / 2 - 1, wy, 2, wh, { col: '#1a1a1a', h: 0.5, rough: 0.4, metal: 0.6 });
    // 门
    const dx = x0 + bw - 34;
    rect(L, dx, 34, 24, 62, { col: '#20242a', h: 0.25, rough: 0.2, metal: 0.5 });
    rect(L, dx + 4, 38, 16, 36, { col: warm, emi: warm, h: 0.2 });
    // 壁柱
    rect(L, x0, 0, 5, fh, { col: '#5a514b', h: 0.9, rough: 0.8 });
  }
  return finish(L, 2);
}

// ---------- 世界尺度材质纹理 ----------
function sidewalkTex() {
  const W = 512;
  const p = paint(W, W, (u, v, o) => {
    const x = u * 4, y = v * 4;     // 4 块板
    const fx = x - Math.floor(x), fy = y - Math.floor(y);
    const joint = Math.min(fx, 1 - fx, fy, 1 - fy);
    const tint = vnoise(Math.floor(x) * 7.3, Math.floor(y) * 3.1) * 0.08;
    const n = fbm(u * 40, v * 40, 4, 40, 40) * 0.18 + vnoise(u * 300, v * 300, 300, 300) * 0.08;
    let g = 0.47 + tint + n - 0.1;
    const stain = smoothstep(0.62, 0.75, fbm(u * 6 + 3, v * 6, 3, 6, 6));
    g -= stain * 0.12;
    let hh = 0.6;
    if (joint < 0.012) { g *= 0.45; hh = 0.2; }
    // 口香糖斑点
    if (vnoise(u * 180, v * 180, 180, 180) > 0.93) g *= 0.8;
    o.r = g * 1.02; o.g = g; o.b = g * 0.97; o.h = hh + n * 0.3;
  });
  return { map: makeTex(p.canvas), normalMap: makeTex(normalFromHeight(p.height, W, W, 2), { srgb: false }) };
}

export function roadTex(BLOCK, SW_HALF) {
  const W = 1024, S = BLOCK;
  const p = paint(W, W, (u, v, o) => {
    const mx = u * S, mz = v * S;
    const dx = Math.abs(mx - S / 2), dz = Math.abs(mz - S / 2);
    const ex = S / 2 - dx, ez = S / 2 - dz;  // 到路中心线的距离
    const n = fbm(u * 60, v * 60, 4, 60, 60);
    let g = 0.15 + n * 0.08 + vnoise(u * 500, v * 500, 500, 500) * 0.05;
    const patch = smoothstep(0.55, 0.6, fbm(u * 8 + 11, v * 8, 3, 8, 8));
    g += patch * 0.03;
    const crack = Math.abs(fbm(u * 20, v * 20, 4, 20, 20) - 0.5);
    if (crack < 0.006) g *= 0.6;
    let r = g, gg = g, b = g * 1.05, h = 0.5 + n * 0.3;
    const paintC = (c, a = 1) => { r += (c[0] - r) * a; gg += (c[1] - gg) * a; b += (c[2] - b) * a; h = 0.62; };
    const worn = 0.75 + 0.25 * vnoise(u * 200, v * 200, 200, 200);
    const inX = dz > SW_HALF && dx <= SW_HALF;   // 东西向路段
    const inZ = dx > SW_HALF && dz <= SW_HALF;   // 南北向路段
    const yellow = [0.75, 0.6, 0.15], white = [0.85, 0.85, 0.82];
    if (inX || inZ) {
      const along = inX ? mx : mz, across = inX ? ez : ex, alongD = inX ? dx : dz;
      if (across > 0.08 && across < 0.22 && alongD < SW_HALF - 4) paintC(yellow, worn);
      if (across > 2.95 && across < 3.1 && alongD < SW_HALF - 4 && (along / 6) % 1 < 0.5) paintC(white, worn);
      // 人行横道
      if (alongD > SW_HALF - 3.2 && alongD < SW_HALF - 0.4) {
        const acrossRaw = inX ? mz : mx;
        if ((acrossRaw / 0.9) % 1 < 0.5 && across > 0.3) paintC(white, worn * 0.95);
      }
      // 停止线
      if (alongD > SW_HALF - 4 && alongD < SW_HALF - 3.6 && across > 0.3) paintC(white, worn);
      // 井盖
      const mhd = Math.hypot(alongD - 8, across - 4.5);
      if (mhd < 0.4) { r = g = gg = 0.1; b = 0.1; h = 0.4 + (mhd > 0.35 ? 0.2 : 0) + ((mhd * 30) % 1 < 0.5 ? 0.05 : 0); }
    }
    o.r = r; o.g = gg; o.b = b; o.h = h;
  });
  const map = makeTex(p.canvas); map.anisotropy = 16;
  return { map, normalMap: makeTex(normalFromHeight(p.height, W, W, 1.5), { srgb: false }) };
}

function grassTex() {
  const W = 512;
  const p = paint(W, W, (u, v, o) => {
    const n = fbm(u * 12, v * 12, 5, 12, 12);
    const b = vnoise(u * 400, v * 400, 400, 400);
    const dry = smoothstep(0.55, 0.7, fbm(u * 4 + 5, v * 4, 3, 4, 4));
    o.r = 0.12 + n * 0.1 + dry * 0.12 + b * 0.04;
    o.g = 0.26 + n * 0.14 + b * 0.08 + dry * 0.05;
    o.b = 0.08 + n * 0.05;
    o.h = b * 0.6 + n * 0.4;
  });
  return { map: makeTex(p.canvas), normalMap: makeTex(normalFromHeight(p.height, W, W, 3), { srgb: false }) };
}

function roofTex() {
  const W = 256;
  const p = paint(W, W, (u, v, o) => {
    const n = fbm(u * 16, v * 16, 4, 16, 16);
    const s = vnoise(u * 180, v * 180, 180, 180);
    const tar = smoothstep(0.5, 0.56, fbm(u * 5, v * 5 + 3, 3, 5, 5));
    const g = 0.2 + n * 0.12 + s * 0.1 - tar * 0.08;
    o.r = g; o.g = g * 0.98; o.b = g * 1.02; o.h = s * 0.7 + n * 0.3;
  });
  return { map: makeTex(p.canvas), normalMap: makeTex(normalFromHeight(p.height, W, W, 2.5), { srgb: false }) };
}

function trimTex() {
  const W = 256;
  const p = paint(W, W, (u, v, o) => {
    const n = fbm(u * 10, v * 10, 4, 10, 10);
    const s = vnoise(u * 200, v * 200, 200, 200);
    const fy = (v * 4) % 1, fx = (u * 2 + (Math.floor(v * 4) % 2) * 0.5) % 1;
    const joint = Math.min(fy, 1 - fy, fx, 1 - fx) < 0.015;
    const dirt = smoothstep(0.4, 0.9, 1 - v) * 0.1;
    let g = 0.62 + n * 0.12 + s * 0.05 - dirt;
    if (joint) g *= 0.7;
    o.r = g; o.g = g * 0.96; o.b = g * 0.88; o.h = joint ? 0.2 : 0.6 + s * 0.2;
  });
  return { map: makeTex(p.canvas), normalMap: makeTex(normalFromHeight(p.height, W, W, 2), { srgb: false }) };
}

function plazaTex(size) {
  const W = 1024;
  const p = paint(W, W, (u, v, o) => {
    const x = (u - 0.5) * size, z = (v - 0.5) * size;
    const r = Math.hypot(x, z), a = Math.atan2(z, x);
    let g, h = 0.6, rr, gg, bb;
    const n = vnoise(u * 400, v * 400) * 0.06 + fbm(u * 30, v * 30, 3) * 0.08;
    if (r < 14.5) {
      const ring = r / 1.2, fr = ring % 1;
      const seg = (a / (Math.PI * 2)) * Math.max(6, Math.floor(r * 5));
      const fs = seg - Math.floor(seg);
      const alt = (Math.floor(ring) + Math.floor(seg)) % 2;
      g = (alt ? 0.55 : 0.48) + n;
      rr = g * 1.05; gg = g; bb = g * 0.92;
      if (fr < 0.05 || fs < 0.03) { rr *= 0.6; gg *= 0.6; bb *= 0.6; h = 0.3; }
      if (Math.abs(r - 14) < 0.35) { rr = 0.3; gg = 0.28; bb = 0.3; }
    } else {
      const fx = (x / 1.5) % 1, fz = (z / 1.5) % 1;
      g = 0.42 + n + vnoise(Math.floor(x / 1.5) * 3.3, Math.floor(z / 1.5) * 2.1) * 0.06;
      rr = g; gg = g * 0.98; bb = g * 0.96;
      if (Math.abs(fx) < 0.03 || Math.abs(fz) < 0.03) { rr *= 0.6; gg *= 0.6; bb *= 0.6; h = 0.3; }
    }
    o.r = rr; o.g = gg; o.b = bb; o.h = h;
  });
  return { map: makeTex(p.canvas, { repeat: false }), normalMap: makeTex(normalFromHeight(p.height, W, W, 2, false), { srgb: false, repeat: false }) };
}

function woodTex() {
  const W = 256;
  const p = paint(W, W, (u, v, o) => {
    const stave = (u * 24) % 1;
    const n = fbm(u * 24, v * 3, 4, 24, 3);
    const grain = vnoise(u * 24 * 4, v * 60, 96, 60);
    const band = Math.abs(((v * 6) % 1) - 0.5) > 0.47;
    let g = 0.3 + n * 0.15 + grain * 0.06;
    let r = g * 1.15, gg = g * 0.85, b = g * 0.6;
    const weather = smoothstep(0.3, 0.8, fbm(u * 3, v * 2, 3, 3, 2));
    r = r * (1 - weather * 0.4) + 0.2 * weather; gg = gg * (1 - weather * 0.4) + 0.2 * weather; b = b * (1 - weather * 0.4) + 0.2 * weather;
    let h = 0.6 + grain * 0.2;
    if (stave < 0.06) { r *= 0.5; gg *= 0.5; b *= 0.5; h = 0.2; }
    if (band) { r = 0.18; gg = 0.16; b = 0.15; h = 0.95; }
    o.r = r; o.g = gg; o.b = b; o.h = h;
  });
  return { map: makeTex(p.canvas), normalMap: makeTex(normalFromHeight(p.height, W, W, 3), { srgb: false }) };
}

function metalTex() {
  const W = 256;
  const p = paint(W, W, (u, v, o) => {
    const n = fbm(u * 8, v * 8, 4, 8, 8);
    const rust = smoothstep(0.6, 0.75, fbm(u * 5 + 2, v * 5, 4, 5, 5));
    const g = 0.28 + n * 0.1;
    o.r = g + rust * 0.15; o.g = g + rust * 0.03; o.b = g * 1.05 - rust * 0.05; o.h = n;
  });
  return { map: makeTex(p.canvas), normalMap: makeTex(normalFromHeight(p.height, W, W, 1), { srgb: false }) };
}

export function waterNormalTex() {
  const W = 256;
  const p = paint(W, W, (u, v, o) => {
    o.r = o.g = o.b = 0;
    o.h = fbm(u * 8, v * 8, 5, 8, 8) * 0.7 + vnoise(u * 32, v * 32, 32, 32) * 0.3;
  });
  return makeTex(normalFromHeight(p.height, W, W, 6), { srgb: false });
}

// ---------- 材质工厂 ----------
function facadeMat(t, emissiveIntensity = 1.3) {
  return new THREE.MeshStandardMaterial({
    map: t.map, emissiveMap: t.emissiveMap, emissive: 0xffffff, emissiveIntensity,
    normalMap: t.normalMap, roughnessMap: t.ormMap, metalnessMap: t.ormMap,
    roughness: 1, metalness: 1, envMapIntensity: 1.0,
  });
}
function worldMat(t, opts = {}) {
  return new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughness: 0.9, metalness: 0, ...opts });
}

export function makeCityMaterials() {
  const M = {};
  M.glassBlue = facadeMat(glassFacade(11, { spandrel: '#1f2a3a', mullion: '#8f99a6', top: '#6b86b8', bot: '#141c30' }), 0.95);
  M.glassTeal = facadeMat(glassFacade(12, { spandrel: '#1a2f33', mullion: '#a0a8a8', top: '#5fa0a8', bot: '#0e2226' }), 0.95);
  M.glassGold = facadeMat(glassFacade(13, { spandrel: '#3a2e1c', mullion: '#c8a870', top: '#c09060', bot: '#2a1c10' }), 0.95);
  M.brickRed = facadeMat(brickFacade(21, '#6e3528', '#c9b8a0'));
  M.brickTan = facadeMat(brickFacade(22, '#9a7f62', '#d8ccb8'));
  M.brickBrown = facadeMat(brickFacade(23, '#4a3530', '#a89a88'));
  M.stone = facadeMat(stoneFacade(31));
  M.modern = facadeMat(modernFacade(41));
  M.store = facadeMat(storeFacade(51), 1.6);
  M.store.userData.noShadow = false;

  const sw = sidewalkTex();
  M.sidewalk = worldMat(sw, { roughness: 0.85 });
  M.grass = worldMat(grassTex(), { roughness: 1 });
  M.roof = worldMat(roofTex(), { roughness: 0.95 });
  M.trim = worldMat(trimTex(), { roughness: 0.8 });
  M.trimDark = worldMat(trimTex(), { roughness: 0.7, color: 0x6a6258 });
  M.wood = worldMat(woodTex(), { roughness: 0.85 });
  M.metal = worldMat(metalTex(), { roughness: 0.55, metalness: 0.7 });
  M.metalDark = new THREE.MeshStandardMaterial({ color: 0x23262c, roughness: 0.5, metalness: 0.8 });
  M.steel = new THREE.MeshStandardMaterial({ color: 0x8a9098, roughness: 0.3, metalness: 0.95 });
  M.awning = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
  M.beacon = new THREE.MeshBasicMaterial({ color: 0xff2a2a });
  M.beacon.userData.noShadow = true;
  M.lightWarm = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.7, 1.1) });
  M.lightWarm.userData.noShadow = true;
  M.crown = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.3, 0.9) });
  M.crown.userData.noShadow = true;
  return M;
}

export function makePlazaMaterial(size) {
  const t = plazaTex(size);
  return new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughness: 0.75 });
}

// 霓虹招牌图集(竖排)
export function makeNeonAtlas() {
  const words = ['HOTEL', 'BAR', 'OPEN', 'JAZZ', 'LIVE', 'PIZZA', 'CAFE', 'DINER'];
  const W = 64 * words.length, H = 256;
  const c = makeCanvas(W, H), g = c.getContext('2d');
  g.fillStyle = '#0a0808'; g.fillRect(0, 0, W, H);
  words.forEach((w, i) => {
    const hue = (i * 47 + 320) % 360;
    const x = i * 64;
    g.strokeStyle = `hsl(${hue},100%,65%)`; g.lineWidth = 3;
    g.strokeRect(x + 5, 5, 54, H - 10);
    g.font = 'bold 36px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = `hsl(${hue},100%,60%)`; g.shadowBlur = 10;
    g.fillStyle = `hsl(${hue},100%,78%)`;
    const letters = w.split('');
    const step = (H - 30) / Math.max(letters.length, 4);
    letters.forEach((ch, k) => g.fillText(ch, x + 32, 20 + step * (k + 0.5)));
    g.shadowBlur = 0;
  });
  const tex = makeTex(c, { repeat: false });
  return { tex, count: words.length };
}

// 屋顶广告牌
export function makeBillboardAtlas() {
  const ads = [
    ['DAILY BUGLE', 'NEW YORK\'S FINEST', '#f4f1e8', '#b01818'],
    ['OSCORP', 'BUILDING TOMORROW', '#0f3d2a', '#9df0c0'],
    ['ROXXON', 'ENERGY FOR ALL', '#101a38', '#f0c040'],
    ['STARK EXPO', 'THE FUTURE IS NOW', '#200c0c', '#ff7040'],
  ];
  const W = 512, H = 256 * ads.length;
  const c = makeCanvas(W, H), g = c.getContext('2d');
  ads.forEach(([t1, t2, bg, fg], i) => {
    const y = i * 256;
    const gr = g.createLinearGradient(0, y, W, y + 256);
    gr.addColorStop(0, bg); gr.addColorStop(1, '#000');
    g.fillStyle = gr; g.fillRect(0, y, W, 256);
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = 'bold 78px Georgia'; g.fillText(t1, W / 2, y + 105);
    g.font = '32px Arial'; g.fillText(t2, W / 2, y + 180);
    g.strokeStyle = fg; g.lineWidth = 6; g.strokeRect(12, y + 12, W - 24, 232);
  });
  return { tex: makeTex(c, { repeat: false }), count: ads.length };
}

export { clamp01 };
