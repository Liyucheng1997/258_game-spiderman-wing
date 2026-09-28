// 程序化纹理工具:逐像素绘制 + 高度图转法线贴图 + 噪声
import * as THREE from 'three';

export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export function smoothstep(a, b, x) {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}
export const mix = (a, b, t) => a + (b - a) * t;

// ---------- 噪声 ----------
export function hash2(x, y) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
// 可平铺值噪声(周期 px,py)
export function vnoise(x, y, px = 1 << 20, py = 1 << 20) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const x0 = ((xi % px) + px) % px, x1 = (x0 + 1) % px;
  const y0 = ((yi % py) + py) % py, y1 = (y0 + 1) % py;
  const a = hash2(x0, y0), b = hash2(x1, y0), c = hash2(x0, y1), d = hash2(x1, y1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x, y, oct = 4, px = 1 << 20, py = 1 << 20) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * vnoise(x * f, y * f, px * f, py * f);
    n += a; f *= 2; a *= 0.5;
  }
  return s / n;
}

// ---------- 逐像素绘制 ----------
// fn(u, v, out): 写入 out.r/g/b (0..1, sRGB), out.h (高度 0..1), out.a
export function paint(w, h, fn, { height = true, alpha = false } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const H = height ? new Float32Array(w * h) : null;
  const out = { r: 0, g: 0, b: 0, h: 0, a: 1 };
  for (let y = 0; y < h; y++) {
    const v = 1 - (y + 0.5) / h;
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w;
      out.h = 0; out.a = 1;
      fn(u, v, out);
      const i = y * w + x, j = i * 4;
      d[j] = out.r * 255; d[j + 1] = out.g * 255; d[j + 2] = out.b * 255;
      d[j + 3] = alpha ? out.a * 255 : 255;
      if (H) H[i] = out.h;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { canvas, height: H, w, h };
}

// 高度图 → 切线空间法线贴图 canvas
export function normalFromHeight(H, w, h, strength = 2, wrap = true) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const at = (x, y) => {
    if (wrap) { x = (x + w) % w; y = (y + h) % h; }
    else { x = Math.max(0, Math.min(w - 1, x)); y = Math.max(0, Math.min(h - 1, y)); }
    return H[y * w + x];
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * 0.5 * strength;
      const dy = (at(x, y - 1) - at(x, y + 1)) * 0.5 * strength; // canvas 行向下 = v 减小
      let nx = -dx, ny = -dy, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      const j = (y * w + x) * 4;
      d[j] = (nx * 0.5 + 0.5) * 255;
      d[j + 1] = (ny * 0.5 + 0.5) * 255;
      d[j + 2] = (nz * 0.5 + 0.5) * 255;
      d[j + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// 从 2D canvas 的灰度读取高度
export function heightFromCanvas(canvas) {
  const ctx = canvas.getContext('2d');
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const H = new Float32Array(canvas.width * canvas.height);
  for (let i = 0; i < H.length; i++) H[i] = data[i * 4] / 255;
  return H;
}

export function makeTex(canvas, { srgb = true, repeat = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// 可复现随机数
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 点到线段距离(2D)
export function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = clamp01(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1));
  return Math.hypot(px - ax - dx * t, py - ay - dy * t);
}
