// 蜘蛛侠角色 v2:骨骼蒙皮 + 肌肉雕刻放样 + 逐像素绘制战衣(凸起蛛网线法线贴图)
// 头部面罩(放射蛛网 + 立体白色镜片)、五指手套(发射蛛丝手势)、红靴
import * as THREE from 'three';
import {
  paint, normalFromHeight, makeTex, smoothstep, clamp01, vnoise, distSeg,
} from './textures.js';

const TAU = Math.PI * 2;

// ================= 放样几何(Loft) =================
function cr(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

class Loft {
  // stations: [{y, w, df, db, cx?, cz?, p?}]  y 递增
  // bumps: [{a, y, sa, sy, amp, sym?}]  a=0 前方(+z), +π/2 为 +x 侧
  constructor(stations, bumps = []) {
    this.st = stations.map((s) => ({ cx: 0, cz: 0, p: 2, ...s }));
    this.bumps = bumps;
    this.y0 = this.st[0].y;
    this.y1 = this.st[this.st.length - 1].y;
  }

  shape(y) {
    const s = this.st, n = s.length;
    let i = 0;
    while (i < n - 2 && y > s[i + 1].y) i++;
    const t = clamp01((y - s[i].y) / (s[i + 1].y - s[i].y));
    const p0 = s[Math.max(0, i - 1)], p1 = s[i], p2 = s[i + 1], p3 = s[Math.min(n - 1, i + 2)];
    const r = {};
    for (const k of ['w', 'df', 'db', 'cx', 'cz', 'p']) r[k] = cr(p0[k], p1[k], p2[k], p3[k], t);
    return r;
  }

  bump(a, y) {
    let d = 0;
    for (const b of this.bumps) {
      const one = (ba) => {
        let da = Math.abs(a - ba) % TAU;
        if (da > Math.PI) da = TAU - da;
        return b.amp * Math.exp(-((da / b.sa) ** 2) - (((y - b.y) / b.sy) ** 2));
      };
      d += one(b.a);
      if (b.sym) d += one(-b.a);
    }
    return d;
  }

  // 返回 [x, z]
  point(a, y, s = this.shape(y), withBump = true) {
    const sa = Math.sin(a), ca = Math.cos(a), e = 2 / s.p;
    let x = s.w * Math.sign(sa) * Math.pow(Math.abs(sa), e);
    let z = (ca >= 0 ? s.df : s.db) * Math.sign(ca) * Math.pow(Math.abs(ca), e);
    if (withBump) {
      const d = this.bump(a, y);
      if (d !== 0) {
        const l = Math.hypot(x, z) || 1;
        x += (x / l) * d; z += (z / l) * d;
      }
    }
    return [x + s.cx, z + s.cz];
  }

  geometry({ rings = 48, segs = 48, mirror = false, capBottom = true, capTop = true } = {}) {
    const pos = [], uv = [], idx = [];
    const row = segs + 1;
    for (let i = 0; i <= rings; i++) {
      const v = i / rings;
      const y = this.y0 + (this.y1 - this.y0) * v;
      const s = this.shape(y);
      for (let j = 0; j <= segs; j++) {
        const u = j / segs;
        const [x, z] = this.point((u - 0.5) * TAU, y, s);
        pos.push(mirror ? -x : x, y, z);
        uv.push(u, v);
      }
    }
    const tri = (a, b, c) => (mirror ? idx.push(a, c, b) : idx.push(a, b, c));
    for (let i = 0; i < rings; i++) {
      for (let j = 0; j < segs; j++) {
        const a = i * row + j, b = a + 1, c = a + row, d = c + 1;
        tri(a, b, c); tri(b, d, c);
      }
    }
    const addCap = (ringI, top) => {
      const y = ringI === 0 ? this.y0 : this.y1;
      const s = this.shape(y);
      const bulge = Math.min(s.w, (s.df + s.db) / 2) * 0.35;
      const pi = pos.length / 3;
      pos.push(mirror ? -s.cx : s.cx, y + (top ? bulge : -bulge), s.cz);
      uv.push(0.5, top ? 1 : 0);
      for (let j = 0; j < segs; j++) {
        const a = ringI * row + j, b = a + 1;
        if (top) tri(pi, a, b); else tri(pi, b, a);
      }
    };
    if (capBottom) addCap(0, false);
    if (capTop) addCap(rings, true);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    // 修正接缝法线
    const n = geo.attributes.normal;
    for (let i = 0; i <= rings; i++) {
      const a = i * row, b = a + segs;
      const x = n.getX(a) + n.getX(b), y = n.getY(a) + n.getY(b), z = n.getZ(a) + n.getZ(b);
      const l = Math.hypot(x, y, z) || 1;
      n.setXYZ(a, x / l, y / l, z / l); n.setXYZ(b, x / l, y / l, z / l);
    }
    return geo;
  }
}

// 顶点蒙皮权重: fn(x,y,z) → [[boneIndex, weight], ...] (最多 2 个)
function applySkin(geo, fn) {
  const p = geo.attributes.position;
  const si = new Uint16Array(p.count * 4), sw = new Float32Array(p.count * 4);
  for (let i = 0; i < p.count; i++) {
    const inf = fn(p.getX(i), p.getY(i), p.getZ(i));
    for (let k = 0; k < inf.length && k < 4; k++) {
      si[i * 4 + k] = inf[k][0];
      sw[i * 4 + k] = inf[k][1];
    }
  }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
}
// 在 [ya, yb] 区间内从 boneA(上) 过渡到 boneB(下)
const blend = (y, yTop, yBot, bA, bB) => {
  const t = smoothstep(yTop, yBot, y);
  return [[bA, 1 - t], [bB, t]];
};

// ================= 战衣配色 =================
const RED = [0.72, 0.05, 0.08];
const RED_D = [0.45, 0.02, 0.04];
const BLUE = [0.09, 0.17, 0.46];
const LINE = [0.05, 0.03, 0.035];
const SOLE = [0.12, 0.11, 0.12];

// 蜘蛛徽标 SDF(单位空间,中心在原点,<0 为内部)
const SPIDER_LEGS = [
  [[0.07, 0.30], [0.36, 0.64], [0.40, 1.0]],
  [[0.10, 0.18], [0.52, 0.40], [0.88, 0.50]],
  [[0.10, 0.02], [0.52, -0.08], [0.80, -0.44]],
  [[0.07, -0.10], [0.32, -0.48], [0.36, -0.95]],
];
function spiderSDF(x, y, legW) {
  x = Math.abs(x);
  let d = (Math.hypot(x / 0.12, (y - 0.30) / 0.14) - 1) * 0.12;
  d = Math.min(d, (Math.hypot(x / 0.155, (y + 0.06) / 0.40) - 1) * 0.155);
  for (const L of SPIDER_LEGS) {
    d = Math.min(d,
      distSeg(x, y, L[0][0], L[0][1], L[1][0], L[1][1]) - legW,
      distSeg(x, y, L[1][0], L[1][1], L[2][0], L[2][1]) - legW * 0.7);
  }
  return d;
}

// 六边形微纹理(蓝色面料)
function hexEdge(x, y) {
  const r3 = 1.7320508;
  const m = (v, p) => ((v % p) + p) % p;
  const ax = m(x, 1) - 0.5, ay = m(y, r3) - r3 / 2;
  const bx = m(x - 0.5, 1) - 0.5, by = m(y - r3 / 2, r3) - r3 / 2;
  const [hx, hy] = ax * ax + ay * ay < bx * bx + by * by ? [ax, ay] : [bx, by];
  return Math.max(Math.abs(hx), Math.abs(hx) * 0.5 + Math.abs(hy) * 0.866);
}

const aaLine = (dist, hw, px) => 1 - smoothstep(hw - px, hw + px, dist);

function setRGB(o, c, k = 1) { o.r = c[0] * k; o.g = c[1] * k; o.b = c[2] * k; }
function mixRGB(o, c, t) {
  o.r += (c[0] - o.r) * t; o.g += (c[1] - o.g) * t; o.b += (c[2] - o.b) * t;
}

// 基于放样的通用绘制器:region(a,y) → 0 红 1 蓝 2 鞋底;webFn 返回红区蛛网覆盖率
function paintLoft(loft, W, H, region, webFn, extra) {
  const y0 = loft.y0, y1 = loft.y1;
  const da = (TAU / W) * 2.2, dy = ((y1 - y0) / H) * 2.2;
  return paint(W, H, (u, v, o) => {
    const y = y0 + (y1 - y0) * v;
    const a = (u - 0.5) * TAU;
    const s = loft.shape(y);
    const circ = Math.PI * (s.w + (s.df + s.db) * 0.5);
    const px = circ / W;                 // 每像素米数
    const reg = region(a, y);
    const border = region(a + da, y) !== reg || region(a - da, y) !== reg ||
      region(a, y + dy) !== reg || region(a, y - dy) !== reg;
    const n = vnoise(u * W * 0.35, v * H * 0.35, W * 0.35, 1e6) * 0.06 +
      vnoise(u * 40, v * 60, 40, 1e6) * 0.05;
    if (reg === 1) {
      setRGB(o, BLUE, 0.95 + n);
      const he = hexEdge((a * circ) / TAU / 0.005, y / 0.005);
      const hl = smoothstep(0.38, 0.5, he);
      mixRGB(o, [0.05, 0.1, 0.3], hl * 0.35);
      o.h = hl * 0.18;
    } else if (reg === 2) {
      setRGB(o, SOLE, 1 + n);
      o.h = vnoise(u * 90, v * 30, 90, 1e6) * 0.3;
    } else {
      setRGB(o, RED, 0.93 + n);
      const w = webFn(a, y, s, circ, px);
      mixRGB(o, RED_D, clamp01(w * 2.5) * 0.35);
      mixRGB(o, LINE, w);
      o.h = w;
    }
    if (border) { setRGB(o, LINE); o.h = 0.75; }
    if (extra) extra(a, y, s, circ, px, o);
  });
}

// 肢体蛛网:纵向辐条 + 下垂横线
function limbWeb(spokes, step, sag, hw) {
  return (a, y, s, circ, px) => {
    const u = a / TAU + 0.5;
    const f = u * spokes;
    const fr = f - Math.floor(f);
    const dSpoke = Math.abs(fr - 0.5 < 0 ? fr : 1 - fr) * (circ / spokes);
    const ye = y + sag * Math.sin(Math.PI * fr) ** 2;
    const k = ye / step;
    const dRing = Math.abs(k - Math.round(k)) * step;
    return Math.max(aaLine(dSpoke, hw, px), aaLine(dRing, hw, px));
  };
}

function buildMaterial(painted, normalStrength, opts = {}) {
  const map = makeTex(painted.canvas);
  const normal = makeTex(normalFromHeight(painted.height, painted.w, painted.h, normalStrength),
    { srgb: false });
  return new THREE.MeshPhysicalMaterial({
    map, normalMap: normal, normalScale: new THREE.Vector2(1, 1),
    roughness: 0.58, metalness: 0.02,
    sheen: 0.6, sheenRoughness: 0.45, sheenColor: new THREE.Color(0xffffff), sheenColorMap: map,
    ...opts,
  });
}

// ================= 头部 =================
const EYE = { cx: 0.36, cy: 0.12, a: 0.30, b: 0.17, rot: 0.42 };
function eyeQ(dx, dy, dz, grow = 0) {
  if (dz < 0.05) return 99;
  const x = Math.abs(dx);
  const px = x - EYE.cx, py = dy - EYE.cy - grow * 0.15;
  const c = Math.cos(EYE.rot), s = Math.sin(EYE.rot);
  const xr = px * c + py * s, yr = -px * s + py * c;
  const a = EYE.a + grow, b0 = EYE.b + grow * 0.9;
  const b = b0 * (0.28 + 0.72 * smoothstep(-1.05, 0.25, xr / a));
  return (xr / a) ** 2 + (yr / b) ** 2;
}
const gss = (x) => Math.exp(-x * x);

function headShape(dx, dy, dz) {
  let x = dx * 0.091, y = dy * 0.118, z = dz * 0.106;
  const low = smoothstep(0.15, -0.95, dy);
  x *= 1 - 0.30 * low;
  z *= dz < 0 ? 1 - 0.2 * low : 1 - 0.04 * low;
  if (dz < 0) z *= 1 + 0.1 * smoothstep(-0.5, 0.4, dy);
  const fz = Math.max(0, dz);
  z += 0.012 * gss((dy + 0.8) / 0.2) * fz ** 3;              // 下巴
  let bump = 0;
  bump += 0.012 * gss(dx / 0.085) * gss((dy + 0.2) / 0.17) * fz ** 2;   // 鼻梁
  bump += 0.004 * gss(dx / 0.55) * gss((dy - 0.36) / 0.09) * fz;        // 眉弓
  bump += 0.004 * gss((Math.abs(dx) - 0.55) / 0.16) * gss((dy + 0.1) / 0.2) * fz; // 颧骨
  bump += 0.003 * gss(dx / 0.22) * gss((dy + 0.52) / 0.07) * fz ** 2;   // 嘴唇
  bump -= 0.004 * clamp01(1.3 - eyeQ(dx, dy, dz)) * fz;                  // 眼窝
  const l = Math.hypot(x, y, z);
  return [x + (x / l) * bump, y + (y / l) * bump, z + (z / l) * bump];
}

function sphereDir(u, v) {
  const phi = u * TAU, th = (1 - v) * Math.PI;
  return [-Math.cos(phi) * Math.sin(th), Math.cos(th), Math.sin(phi) * Math.sin(th)];
}

function paintHead() {
  const W = 1024, H = 512;
  const c = [0, -0.08, 1]; const cl = Math.hypot(...c);
  c[0] /= cl; c[1] /= cl; c[2] /= cl;
  const e2 = [0, c[2], -c[1]];
  const hwAng = 0.019, px = TAU / W;
  const N = 16;
  return paint(W, H, (u, v, o) => {
    const [dx, dy, dz] = sphereDir(u, v);
    const q = eyeQ(dx, dy, dz);
    const qf = eyeQ(dx, dy, dz, 0.07);
    const n = vnoise(u * 300, v * 150, 300, 1e6) * 0.06;
    if (q < 1) {
      const g = 0.86 + 0.1 * (1 - q);
      o.r = g; o.g = g + 0.02; o.b = g + 0.05; o.h = 0.2;
      return;
    }
    if (qf < 1) { setRGB(o, LINE); o.h = 0.7; return; }
    setRGB(o, RED, 0.93 + n);
    const cd = dx * c[0] + dy * c[1] + dz * c[2];
    const th = Math.acos(Math.max(-1, Math.min(1, cd)));
    const phi = Math.atan2(dx * e2[0] + dy * e2[1] + dz * e2[2], dx);
    const f = (phi / TAU) * N;
    const fr = f - Math.floor(f);
    const dSpoke = Math.min(fr, 1 - fr) * (TAU / N) * Math.sin(th);
    const the = th + 0.045 * Math.sin(Math.PI * fr) ** 2;
    const k = (the - 0.14) / 0.2;
    const dRing = the < 0.1 ? 1 : Math.abs(k - Math.round(k)) * 0.2;
    const w = Math.max(th < 0.09 ? 0 : aaLine(dSpoke, hwAng * smoothstep(0.09, 0.25, th), px * 1.2),
      aaLine(dRing, hwAng, px * 1.2));
    mixRGB(o, RED_D, clamp01(w * 2.5) * 0.35);
    mixRGB(o, LINE, w);
    o.h = w;
    // 眼框外侧的轻微阴影
    if (qf < 1.6) mixRGB(o, RED_D, (1.6 - qf) * 0.5);
  });
}

function buildHead(matHead, matLens) {
  const geo = new THREE.SphereGeometry(1, 96, 64);
  const p = geo.attributes.position;
  const dirs = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    let dx = p.getX(i), dy = p.getY(i), dz = p.getZ(i);
    const l = Math.hypot(dx, dy, dz) || 1;
    dx /= l; dy /= l; dz /= l;
    dirs[i * 3] = dx; dirs[i * 3 + 1] = dy; dirs[i * 3 + 2] = dz;
    const [x, y, z] = headShape(dx, dy, dz);
    p.setXYZ(i, x, y, z);
  }
  geo.computeVertexNormals();
  smoothSeams(geo);
  const head = new THREE.Mesh(geo, matHead);
  head.castShadow = true;

  // 镜片:抽取眼部三角形,沿法线凸起
  const idx = geo.index.array, nrm = geo.attributes.normal, uvA = geo.attributes.uv;
  const lp = [], ln = [], lu = [];
  for (let t = 0; t < idx.length; t += 3) {
    let near = false;
    for (let k = 0; k < 3; k++) {
      const i = idx[t + k];
      if (eyeQ(dirs[i * 3], dirs[i * 3 + 1], dirs[i * 3 + 2]) < 1.35) near = true;
    }
    if (!near) continue;
    for (let k = 0; k < 3; k++) {
      const i = idx[t + k];
      const q = eyeQ(dirs[i * 3], dirs[i * 3 + 1], dirs[i * 3 + 2]);
      const off = 0.0012 + 0.0035 * Math.sqrt(clamp01(1 - q));
      lp.push(p.getX(i) + nrm.getX(i) * off, p.getY(i) + nrm.getY(i) * off, p.getZ(i) + nrm.getZ(i) * off);
      ln.push(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
      lu.push(uvA.getX(i), uvA.getY(i));
    }
  }
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
  lg.setAttribute('normal', new THREE.Float32BufferAttribute(ln, 3));
  lg.setAttribute('uv', new THREE.Float32BufferAttribute(lu, 2));
  lg.computeVertexNormals();
  const lens = new THREE.Mesh(lg, matLens);
  head.add(lens);
  return head;
}

function paintLens() {
  return paint(1024, 512, (u, v, o) => {
    const [dx, dy, dz] = sphereDir(u, v);
    const q = eyeQ(dx, dy, dz);
    const g = 0.9 + 0.08 * clamp01(1 - q) - 0.1 * clamp01(dy - 0.1);
    o.r = g; o.g = g + 0.02; o.b = Math.min(1, g + 0.06);
    o.a = q < 1 ? 1 : 0;
  }, { height: false, alpha: true });
}

// 合并位置相同顶点的法线(消除球体 UV 接缝的光照断裂)
function smoothSeams(geo) {
  const p = geo.attributes.position, n = geo.attributes.normal;
  const map = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(5)},${p.getY(i).toFixed(5)},${p.getZ(i).toFixed(5)}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(i);
  }
  for (const ids of map.values()) {
    if (ids.length < 2) continue;
    let x = 0, y = 0, z = 0;
    for (const i of ids) { x += n.getX(i); y += n.getY(i); z += n.getZ(i); }
    const l = Math.hypot(x, y, z) || 1;
    for (const i of ids) n.setXYZ(i, x / l, y / l, z / l);
  }
}

// ================= 角色类 =================
export class SpiderMan {
  constructor() {
    this.root = new THREE.Group();
    this.bones = [];
    this.standHipHeight = 0.92;
    this._t = 0;
    this._buildSkeleton();
    this._buildBody();
    this._fingerCurl = { L: [0.3, 0.35, 0.45, 0.5, 0.55], R: [0.3, 0.35, 0.45, 0.5, 0.55] };
    this._qAim = new THREE.Quaternion();
    this._aimInit = false;
    this.flipAngle = 0;
  }

  _bone(name, parent, x, y, z) {
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(x, y, z);
    (parent || this.root).add(b);
    b.userData.index = this.bones.length;
    this.bones.push(b);
    this[name] = b;
    return b;
  }

  _buildSkeleton() {
    const B = this._bone.bind(this);
    B('hips', null, 0, 0, 0);
    B('spine', this.hips, 0, 0.12, 0);
    B('chest', this.spine, 0, 0.14, 0);
    B('neck', this.chest, 0, 0.30, 0);
    B('headB', this.neck, 0, 0.07, 0.012);
    for (const [s, n] of [[1, 'R'], [-1, 'L']]) {
      B('clav' + n, this.chest, s * 0.035, 0.195, 0);
      B('sh' + n, this['clav' + n], s * 0.15, 0.005, 0);
      B('el' + n, this['sh' + n], 0, -0.285, 0);
      B('wr' + n, this['el' + n], 0, -0.255, 0);
      B('th' + n, this.hips, s * 0.095, -0.06, 0);
      B('kn' + n, this['th' + n], 0, -0.42, 0);
      B('an' + n, this['kn' + n], 0, -0.37, 0);
    }
    // 兼容旧接口
    this.head = this.headB;
  }

  _buildBody() {
    const ix = (name) => this[name].userData.index;
    this.root.updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton(this.bones);
    this.skeleton = skeleton;
    const addSkinned = (geo, mat) => {
      const m = new THREE.SkinnedMesh(geo, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      this.root.add(m);
      m.bind(skeleton, m.matrixWorld);
      return m;
    };

    // ---------------- 躯干 ----------------
    const torso = new Loft([
      { y: -0.14, w: 0.085, df: 0.07, db: 0.075 },
      { y: -0.09, w: 0.150, df: 0.095, db: 0.115 },
      { y: -0.03, w: 0.166, df: 0.100, db: 0.120 },
      { y: 0.05, w: 0.158, df: 0.098, db: 0.104 },
      { y: 0.13, w: 0.145, df: 0.096, db: 0.090 },
      { y: 0.22, w: 0.155, df: 0.104, db: 0.092 },
      { y: 0.31, w: 0.178, df: 0.118, db: 0.100 },
      { y: 0.39, w: 0.198, df: 0.126, db: 0.104 },
      { y: 0.45, w: 0.200, df: 0.116, db: 0.102 },
      { y: 0.50, w: 0.182, df: 0.096, db: 0.094 },
      { y: 0.535, w: 0.150, df: 0.080, db: 0.084 },
      { y: 0.585, w: 0.074, df: 0.062, db: 0.064, cz: 0.004 },
      { y: 0.63, w: 0.057, df: 0.056, db: 0.056, cz: 0.008 },
      { y: 0.70, w: 0.053, df: 0.052, db: 0.052, cz: 0.012 },
    ].map((s) => ({ p: 2.25, ...s })), [
      { a: 0.45, y: 0.37, sa: 0.42, sy: 0.055, amp: 0.017, sym: true },   // 胸肌
      { a: 0.13, y: 0.075, sa: 0.12, sy: 0.028, amp: 0.006, sym: true },  // 腹肌
      { a: 0.13, y: 0.145, sa: 0.12, sy: 0.028, amp: 0.006, sym: true },
      { a: 0.13, y: 0.215, sa: 0.12, sy: 0.028, amp: 0.006, sym: true },
      { a: 0.0, y: 0.15, sa: 0.05, sy: 0.12, amp: -0.004 },               // 腹白线
      { a: 1.9, y: 0.33, sa: 0.4, sy: 0.08, amp: 0.012, sym: true },      // 背阔肌
      { a: 2.55, y: 0.41, sa: 0.3, sy: 0.05, amp: 0.009, sym: true },     // 肩胛
      { a: Math.PI, y: 0.25, sa: 0.12, sy: 0.25, amp: -0.008 },          // 脊柱沟
      { a: 2.6, y: -0.06, sa: 0.5, sy: 0.055, amp: 0.018, sym: true },    // 臀
      { a: 1.35, y: 0.53, sa: 0.5, sy: 0.03, amp: 0.012, sym: true },     // 斜方肌
      { a: 1.05, y: 0.02, sa: 0.3, sy: 0.07, amp: 0.006, sym: true },     // 腹外斜肌
    ]);
    const torsoGeo = torso.geometry({ rings: 70, segs: 72 });
    applySkin(torsoGeo, (x, y) => {
      if (y < 0.04) return [[ix('hips'), 1]];
      if (y < 0.16) return blend(y, 0.04, 0.16, ix('hips'), ix('spine'));
      if (y < 0.28) return blend(y, 0.16, 0.28, ix('spine'), ix('chest'));
      if (y < 0.56) return [[ix('chest'), 1]];
      return blend(y, 0.56, 0.64, ix('chest'), ix('neck'));
    });

    const BELT = 0.085, BH = 0.026;
    const torsoRegion = (a, y) => {
      const aa = Math.abs(a);
      if (y < BELT - BH) {
        const t = clamp01((y + 0.14) / (BELT - BH + 0.14));
        const vt = clamp01((y - (BELT - BH - 0.075)) / 0.075);
        return aa < 0.34 * vt ? 0 : 1;
      }
      if (y < BELT + BH) return 0;
      const hw = 0.40 * smoothstep(0.475, 0.36, y) * (1 + 0.15 * smoothstep(0.3, 0.12, y));
      return Math.abs(aa - 1.62) < hw ? 1 : 0;
    };
    const radial = (X, Y, px) => {
      const r = Math.hypot(X, Y);
      const N = 18;
      const phi = Math.atan2(Y, X);
      const f = (phi / TAU) * N, fr = f - Math.floor(f);
      const dSpoke = Math.min(fr, 1 - fr) * (TAU / N) * r;
      const rn = r / (1 - 0.08 * Math.sin(Math.PI * fr) ** 2);
      const kf = Math.log(Math.max(rn, 1e-4) / 0.03) / Math.log(1.33);
      const k = Math.round(kf);
      const rk = 0.03 * Math.pow(1.33, k);
      const dRing = kf < -0.5 ? 1 : Math.abs(kf - k) * rk * 0.33;
      return Math.max(aaLine(dSpoke, 0.0021, px), aaLine(dRing, 0.0021, px));
    };
    const torsoWeb = (a, y, s, circ, px) => {
      const front = Math.abs(a) < Math.PI / 2;
      if (front) {
        const X = a * (s.w + s.df) * 0.5, Y = y - 0.36;
        if (spiderSDF(X / 0.07, (y - 0.345) / 0.07, 0.05) * 0.07 < 0.004) return 0;
        return radial(X, Y, px);
      }
      const ab = a - Math.sign(a) * Math.PI;
      const X = ab * (s.w + s.db) * 0.5, Y = y - 0.38;
      if (spiderSDF(X / 0.13, (y - 0.33) / 0.13, 0.06) * 0.13 < 0.006) return 0;
      return radial(X, Y, px);
    };
    const torsoExtra = (a, y, s, circ, px, o) => {
      if (torsoRegion(a, y) !== 0) return;
      // 腰带棱线
      const eb = Math.min(Math.abs(y - (BELT + BH)), Math.abs(y - (BELT - BH)));
      if (y > BELT - BH - 0.003 && y < BELT + BH + 0.003) {
        const l = aaLine(eb, 0.0018, px);
        mixRGB(o, LINE, l); o.h = Math.max(o.h, 0.45 + l * 0.4);
      }
      if (Math.abs(a) < Math.PI / 2) {
        const X = a * (s.w + s.df) * 0.5;
        const d = spiderSDF(X / 0.07, (y - 0.345) / 0.07, 0.05) * 0.07;
        const c = 1 - smoothstep(-px, px, d);
        if (c > 0) { mixRGB(o, LINE, c); o.h = Math.max(o.h, c * 0.85); }
      } else {
        const ab = a - Math.sign(a) * Math.PI;
        const X = ab * (s.w + s.db) * 0.5;
        const d = spiderSDF(X / 0.13, (y - 0.33) / 0.13, 0.06) * 0.13;
        const outline = aaLine(Math.abs(d), 0.004, px);
        if (d < 0) o.h = Math.max(o.h, 0.35);
        if (outline > 0) { mixRGB(o, LINE, outline); o.h = Math.max(o.h, 0.35 + outline * 0.5); }
      }
    };
    this.matTorso = buildMaterial(
      paintLoft(torso, 1024, 1024, torsoRegion, torsoWeb, torsoExtra), 3.0);
    addSkinned(torsoGeo, this.matTorso);

    // ---------------- 手臂 ----------------
    const arm = new Loft([
      { y: -0.555, w: 0.028, df: 0.022, db: 0.022 },
      { y: -0.53, w: 0.030, df: 0.024, db: 0.025 },
      { y: -0.47, w: 0.034, df: 0.031, db: 0.030 },
      { y: -0.40, w: 0.042, df: 0.041, db: 0.038 },
      { y: -0.33, w: 0.047, df: 0.049, db: 0.045 },
      { y: -0.285, w: 0.043, df: 0.043, db: 0.046 },
      { y: -0.25, w: 0.046, df: 0.047, db: 0.049 },
      { y: -0.19, w: 0.052, df: 0.057, db: 0.057 },
      { y: -0.12, w: 0.057, df: 0.058, db: 0.061 },
      { y: -0.06, w: 0.064, df: 0.059, db: 0.064 },
      { y: -0.01, w: 0.068, df: 0.064, db: 0.066 },
      { y: 0.03, w: 0.058, df: 0.056, db: 0.058 },
      { y: 0.06, w: 0.036, df: 0.040, db: 0.040 },
    ], [
      { a: 0.0, y: -0.16, sa: 0.6, sy: 0.05, amp: 0.009 },        // 二头肌
      { a: Math.PI, y: -0.13, sa: 0.7, sy: 0.07, amp: 0.007 },   // 三头肌
      { a: Math.PI / 2, y: -0.01, sa: 0.9, sy: 0.05, amp: 0.006 }, // 三角肌
      { a: 0.6, y: -0.35, sa: 0.6, sy: 0.05, amp: 0.005 },        // 前臂肌
    ]);
    const armRegion = (a, y) => {
      const c = -1.95;
      const hw = 0.95 * Math.pow(clamp01((y + 0.25) / 0.22), 0.7) * smoothstep(0.075, 0.0, y);
      let d = Math.abs(a - c) % TAU;
      if (d > Math.PI) d = TAU - d;
      return d < hw ? 1 : 0;
    };
    this.matArm = buildMaterial(
      paintLoft(arm, 512, 1024, armRegion, limbWeb(10, 0.04, 0.010, 0.0018)), 2.5);

    // ---------------- 腿 ----------------
    const leg = new Loft([
      { y: -0.82, w: 0.030, df: 0.030, db: 0.030 },
      { y: -0.79, w: 0.033, df: 0.035, db: 0.033 },
      { y: -0.72, w: 0.036, df: 0.036, db: 0.037 },
      { y: -0.64, w: 0.046, df: 0.042, db: 0.050 },
      { y: -0.55, w: 0.056, df: 0.050, db: 0.066 },
      { y: -0.48, w: 0.058, df: 0.054, db: 0.064 },
      { y: -0.42, w: 0.058, df: 0.058, db: 0.056 },
      { y: -0.36, w: 0.064, df: 0.066, db: 0.060 },
      { y: -0.26, w: 0.078, df: 0.082, db: 0.072 },
      { y: -0.15, w: 0.088, df: 0.090, db: 0.084 },
      { y: -0.05, w: 0.094, df: 0.092, db: 0.096 },
      { y: 0.03, w: 0.092, df: 0.090, db: 0.098 },
      { y: 0.10, w: 0.070, df: 0.075, db: 0.080 },
    ], [
      { a: 0.0, y: -0.42, sa: 0.5, sy: 0.03, amp: 0.006 },           // 膝盖
      { a: 0.35, y: -0.24, sa: 0.5, sy: 0.08, amp: 0.007 },          // 股四头肌
      { a: -0.5, y: -0.33, sa: 0.4, sy: 0.04, amp: 0.006 },          // 股内侧肌
      { a: Math.PI - 0.35, y: -0.54, sa: 0.45, sy: 0.06, amp: 0.010, sym: true }, // 小腿肚
    ]);
    const legRegion = (a, y) => {
      const top = -0.47 - 0.075 * Math.pow(Math.abs(a) / Math.PI, 0.8);
      return y < top ? 0 : 1;
    };
    this.matLeg = buildMaterial(
      paintLoft(leg, 512, 1024, legRegion, limbWeb(14, 0.045, 0.012, 0.0019)), 2.5);

    for (const [s, n] of [[1, 'R'], [-1, 'L']]) {
      const ag = arm.geometry({ rings: 64, segs: 36, mirror: s < 0 });
      ag.translate(s * 0.185, 0.46, 0);
      applySkin(ag, (x, y) => {
        const ly = y - 0.46;
        if (ly > -0.24) return [[ix('sh' + n), 1]];
        if (ly > -0.33) return blend(ly, -0.24, -0.33, ix('sh' + n), ix('el' + n));
        if (ly > -0.50) return [[ix('el' + n), 1]];
        return blend(ly, -0.50, -0.545, ix('el' + n), ix('wr' + n));
      });
      addSkinned(ag, this.matArm);

      const lg = leg.geometry({ rings: 80, segs: 40, mirror: s < 0 });
      lg.translate(s * 0.095, -0.06, 0);
      applySkin(lg, (x, y) => {
        const ly = y + 0.06;
        if (ly > 0.0) {
          const t = smoothstep(0.08, -0.04, ly);
          return [[ix('hips'), 1 - t], [ix('th' + n), t]];
        }
        if (ly > -0.37) return [[ix('th' + n), 1]];
        if (ly > -0.47) return blend(ly, -0.37, -0.47, ix('th' + n), ix('kn' + n));
        if (ly > -0.76) return [[ix('kn' + n), 1]];
        return blend(ly, -0.76, -0.81, ix('kn' + n), ix('an' + n));
      });
      addSkinned(lg, this.matLeg);
    }

    // ---------------- 头 ----------------
    const headPaint = paintHead();
    this.matHead = buildMaterial(headPaint, 3.0);
    const lensMat = new THREE.MeshPhysicalMaterial({
      map: makeTex(paintLens().canvas), alphaTest: 0.5,
      roughness: 0.12, metalness: 0.25, clearcoat: 1, clearcoatRoughness: 0.08,
      emissive: 0xb8c8e0, emissiveIntensity: 0.35,
    });
    const head = buildHead(this.matHead, lensMat);
    head.scale.setScalar(1.12);
    head.position.set(0, 0.085, 0.018);
    this.headB.add(head);

    // ---------------- 脚(红靴 + 鞋底) ----------------
    const foot = new Loft([
      { y: -0.075, w: 0.030, df: 0.034, db: 0.030, cz: 0.034, p: 2.4 },
      { y: -0.05, w: 0.038, df: 0.044, db: 0.045, cz: 0.032, p: 2.6 },
      { y: 0.0, w: 0.040, df: 0.050, db: 0.056, cz: 0.018, p: 2.6 },
      { y: 0.06, w: 0.044, df: 0.048, db: 0.030, cz: 0.028, p: 2.8 },
      { y: 0.12, w: 0.046, df: 0.034, db: 0.021, cz: 0.040, p: 2.8 },
      { y: 0.17, w: 0.041, df: 0.024, db: 0.016, cz: 0.046, p: 2.6 },
      { y: 0.20, w: 0.028, df: 0.016, db: 0.011, cz: 0.050, p: 2.2 },
    ]);
    const footRegion = (a) => (Math.abs(a) < 0.95 ? 2 : 0);
    this.matFoot = buildMaterial(
      paintLoft(foot, 256, 256, footRegion, limbWeb(12, 0.03, 0.006, 0.0014)), 2.0);
    for (const [s, n] of [[1, 'R'], [-1, 'L']]) {
      const fg = foot.geometry({ rings: 30, segs: 32, mirror: s < 0 });
      fg.rotateX(Math.PI / 2);
      const fm = new THREE.Mesh(fg, this.matFoot);
      fm.castShadow = true;
      this['an' + n].add(fm);
    }

    // ---------------- 手 ----------------
    this.matGlove = new THREE.MeshPhysicalMaterial({
      color: 0xb3111a, roughness: 0.55, sheen: 0.6, sheenRoughness: 0.4,
      sheenColor: new THREE.Color(0xff6060),
    });
    this.handR = this._makeHand(1, this.wrR);
    this.handL = this._makeHand(-1, this.wrL);
  }

  _makeHand(side, wrist) {
    const palmLoft = new Loft([
      { y: -0.10, w: 0.013, df: 0.038, db: 0.038, p: 3 },
      { y: -0.085, w: 0.017, df: 0.043, db: 0.043, p: 3 },
      { y: -0.05, w: 0.020, df: 0.044, db: 0.041, p: 3 },
      { y: -0.015, w: 0.019, df: 0.038, db: 0.034, p: 2.6 },
      { y: 0.01, w: 0.018, df: 0.030, db: 0.029, p: 2.2 },
    ], [
      { a: Math.PI / 2, y: -0.088, sa: 0.5, sy: 0.012, amp: 0.004 },  // 指节
      { a: -1.1, y: -0.04, sa: 0.5, sy: 0.025, amp: 0.006 },          // 拇指根
    ]);
    const pg = palmLoft.geometry({ rings: 14, segs: 24, mirror: side < 0 });
    const palm = new THREE.Mesh(pg, this.matGlove);
    palm.castShadow = true;
    wrist.add(palm);

    const fingers = [];
    const defs = [
      // z 偏移, 三节长度
      [0.030, [0.044, 0.027, 0.021]],
      [0.010, [0.049, 0.031, 0.023]],
      [-0.010, [0.046, 0.029, 0.022]],
      [-0.029, [0.036, 0.022, 0.019]],
    ];
    const capsule = (r, len) => {
      const g = new THREE.CapsuleGeometry(r, len, 4, 10);
      g.translate(0, -len / 2, 0);
      return g;
    };
    for (const [z, lens] of defs) {
      let parent = wrist;
      const segs = [];
      let y = -0.093, r = 0.0098;
      lens.forEach((len, k) => {
        const g = new THREE.Group();
        g.position.set(k === 0 ? side * 0.001 : 0, k === 0 ? y : -lens[k - 1], k === 0 ? z : 0);
        const m = new THREE.Mesh(capsule(r, len), this.matGlove);
        m.castShadow = true;
        g.add(m);
        parent.add(g);
        segs.push(g);
        parent = g;
        r *= 0.88;
      });
      fingers.push(segs);
    }
    // 拇指
    const t0 = new THREE.Group();
    t0.position.set(-side * 0.012, -0.022, 0.036);
    t0.rotation.set(-0.7, 0, -side * 0.35);
    const tm0 = new THREE.Mesh(capsule(0.0115, 0.036), this.matGlove);
    t0.add(tm0);
    wrist.add(t0);
    const t1 = new THREE.Group();
    t1.position.y = -0.036;
    t1.add(new THREE.Mesh(capsule(0.0098, 0.028), this.matGlove));
    t0.add(t1);
    fingers.unshift([t0, t1]);

    const anchor = new THREE.Object3D();
    anchor.position.set(0, -0.08, 0);
    wrist.add(anchor);
    return { side, fingers, anchor, thumbBase: t0.rotation.clone() };
  }

  _updateHand(hand, curls, k) {
    const cur = hand.side > 0 ? this._fingerCurl.R : this._fingerCurl.L;
    for (let i = 0; i < 5; i++) cur[i] += (curls[i] - cur[i]) * k;
    const s = hand.side;
    // 拇指
    const th = hand.fingers[0];
    th[0].rotation.x = hand.thumbBase.x - cur[0] * 0.2;
    th[0].rotation.z = hand.thumbBase.z - s * cur[0] * 0.7;
    th[1].rotation.z = -s * cur[0] * 0.9;
    const maxA = [1.45, 1.65, 1.1];
    for (let f = 1; f < 5; f++) {
      const segs = hand.fingers[f];
      for (let j = 0; j < segs.length; j++) segs[j].rotation.z = -s * cur[f] * maxA[j];
    }
  }

  // ---------- 姿态 ----------
  // 目标表:{ boneName: [x, y, z] },左右对称肢体用辅助函数
  _arm(T, n, flex, abd, elbow, twist = 0, wrist = 0) {
    const s = n === 'R' ? 1 : -1;
    T['sh' + n] = [flex, s * twist, s * abd];
    T['el' + n] = [-elbow, 0, 0];
    T['wr' + n] = [wrist, 0, 0];
  }
  _leg(T, n, flex, abd, knee, ankle = null) {
    const s = n === 'R' ? 1 : -1;
    T['th' + n] = [flex, 0, s * abd];
    T['kn' + n] = [knee, 0, 0];
    T['an' + n] = [ankle === null ? -(flex + knee) * 0.9 : ankle, 0, 0];
  }

  /**
   * @param state idle | run | jump | fall | swing | zip | wallrun | land | flip
   * @param opts { speed, runPhase, webDirLocal, vy }
   */
  update(dt, state, opts = {}) {
    this._t += dt;
    const t = this._t;
    const T = {};
    let rate = 10, hipY = 0;
    let handR = [0.3, 0.35, 0.45, 0.5, 0.55], handL = handR;
    const FIST = [0.95, 1, 1, 1, 1], OPEN = [0.1, 0.05, 0.08, 0.1, 0.12];
    const THWIP = [0.15, 0.0, 1.0, 1.0, 0.0];
    let aimR = null;
    const speed = opts.speed || 0;

    if (state === 'idle') {
      const b = Math.sin(t * 1.7);
      T.spine = [0.03, 0, 0]; T.chest = [0.02 + b * 0.012, 0, 0];
      T.neck = [0, 0, 0]; T.headB = [-0.04, Math.sin(t * 0.35) * 0.25, 0];
      T.clavR = [0, 0, 0]; T.clavL = [0, 0, 0];
      this._arm(T, 'R', 0.06 + b * 0.02, 0.13, 0.28);
      this._arm(T, 'L', 0.06 - b * 0.02, 0.13, 0.28);
      this._leg(T, 'R', -0.05, 0.05, 0.1);
      this._leg(T, 'L', -0.02, 0.07, 0.06);
      hipY = -0.012 - b * 0.004;
      rate = 6;
    } else if (state === 'run' || state === 'wallrun') {
      const ph = opts.runPhase || t * 9;
      const sw = Math.sin(ph), cw = Math.cos(ph);
      const amp = Math.min(1.25, Math.max(0.55, speed / 12));
      const lean = state === 'wallrun' ? 0.25 : Math.min(0.5, 0.08 + speed * 0.02);
      T.spine = [lean * 0.6, 0, 0];
      T.chest = [lean * 0.4, 0.22 * sw * amp, 0];
      T.neck = [-lean * 0.4, 0, 0]; T.headB = [-lean * 0.6, -0.15 * sw * amp, 0];
      T.clavR = [0, 0, 0]; T.clavL = [0, 0, 0];
      const legC = (x, c) => [
        -0.2 - 0.85 * x * amp,
        0.3 + 1.55 * amp * Math.pow(Math.max(0, c), 1.3) + 0.15 * Math.max(0, -c),
      ];
      const [fR, kR] = legC(sw, cw), [fL, kL] = legC(-sw, -cw);
      if (state === 'wallrun') {
        // 向上冲刺攀爬:膝盖高抬抵墙,双手交替上够
        this._leg(T, 'R', -1.0 - 0.55 * sw, 0.12, 1.2 + 0.6 * Math.max(0, cw), 0.5);
        this._leg(T, 'L', -1.0 + 0.55 * sw, 0.12, 1.2 + 0.6 * Math.max(0, -cw), 0.5);
        this._arm(T, 'R', -2.5 + 0.7 * sw, 0.3, 0.6 - 0.4 * sw);
        this._arm(T, 'L', -2.5 - 0.7 * sw, 0.3, 0.6 + 0.4 * sw);
        T.headB = [-0.5, 0, 0];
        handR = handL = OPEN;
      } else {
        this._leg(T, 'R', fR, 0.03, kR, 0.25 * sw - 0.1);
        this._leg(T, 'L', fL, 0.03, kL, -0.25 * sw - 0.1);
        this._arm(T, 'R', 0.8 * sw * amp, 0.14, 1.35 - 0.35 * sw);
        this._arm(T, 'L', -0.8 * sw * amp, 0.14, 1.35 + 0.35 * sw);
        handR = handL = FIST;
      }
      hipY = -0.03 + 0.045 * Math.abs(cw) * amp;
      T.hips = [0, 0, 0.05 * sw];
      rate = 16;
    } else if (state === 'jump') {
      T.spine = [0.1, 0, 0]; T.chest = [0.06, 0, 0];
      T.neck = [0, 0, 0]; T.headB = [-0.15, 0, 0];
      this._arm(T, 'R', -0.9, 0.85, 0.8);
      this._arm(T, 'L', -0.6, 1.0, 0.6);
      this._leg(T, 'R', -1.25, 0.1, 2.0, 0.3);
      this._leg(T, 'L', -0.25, 0.08, 0.7, 0.4);
      handR = handL = OPEN;
      rate = 11;
    } else if (state === 'fall') {
      const fl = Math.sin(t * 6) * 0.12;
      const vy = opts.vy || 0;
      if (vy < -24) {
        // 高速俯冲:四肢收拢
        T.spine = [-0.1, 0, 0]; T.chest = [-0.1, 0, 0];
        T.neck = [-0.3, 0, 0]; T.headB = [-0.4, 0, 0];
        this._arm(T, 'R', 0.35, 0.3, 0.2);
        this._arm(T, 'L', 0.35, 0.3, 0.2);
        this._leg(T, 'R', 0.08, 0.05, 0.15, 0.5);
        this._leg(T, 'L', 0.02, 0.05, 0.35, 0.5);
        handR = handL = OPEN;
      } else {
        T.spine = [0.15, 0, 0]; T.chest = [0.08, 0, 0];
        T.neck = [-0.1, 0, 0]; T.headB = [-0.3, 0, 0];
        this._arm(T, 'R', -0.5 + fl, 1.35, 0.5);
        this._arm(T, 'L', -0.5 - fl, 1.35, 0.5);
        this._leg(T, 'R', -0.55 + fl, 0.28, 0.95, 0.3);
        this._leg(T, 'L', -0.25 - fl, 0.28, 0.6, 0.3);
        handR = handL = OPEN;
      }
      rate = 7;
    } else if (state === 'swing') {
      const vy = opts.vy || 0;
      const k = smoothstep(-8, 8, vy);        // 1 = 上摆
      T.spine = [0.2 - 0.35 * k, 0, 0]; T.chest = [0.1 - 0.15 * k, 0, -0.1];
      T.neck = [-0.1, 0, 0]; T.headB = [-0.3, 0, 0.1];
      T.clavR = [0, 0, 0.15]; T.clavL = [0, 0, 0];
      aimR = opts.webDirLocal;
      this._arm(T, 'R', 0, 0, 0.05);
      this._arm(T, 'L', -0.4 - 0.4 * k, 0.9 - 0.3 * k, 0.7);
      this._leg(T, 'R', 0.15 - 1.0 * k, 0.1, 1.5 - 1.0 * k, 0.4);
      this._leg(T, 'L', 0.05 - 0.6 * k, 0.1, 1.2 - 0.9 * k, 0.4);
      handR = FIST; handL = OPEN;
      rate = 8;
    } else if (state === 'zip') {
      T.spine = [0.25, 0, 0]; T.chest = [0.15, 0, 0];
      T.neck = [-0.3, 0, 0]; T.headB = [-0.45, 0, 0];
      this._arm(T, 'R', -2.7, 0.12, 0.25);
      this._arm(T, 'L', -2.6, 0.12, 0.3);
      this._leg(T, 'R', 0.35, 0.05, 0.3, 0.6);
      this._leg(T, 'L', 0.2, 0.05, 0.6, 0.6);
      handR = handL = FIST;
      rate = 12;
    } else if (state === 'land') {
      // 超级英雄落地:单膝跪地、一拳撑地
      T.spine = [0.55, 0, 0]; T.chest = [0.3, -0.1, 0];
      T.neck = [-0.3, 0, 0]; T.headB = [-0.55, 0.1, 0];
      this._arm(T, 'R', -0.35, 0.05, 0.05);
      this._arm(T, 'L', 0.55, 1.1, 0.35);
      this._leg(T, 'R', 0.05, 0.12, 1.55, 0.7);
      this._leg(T, 'L', -1.45, 0.22, 1.9, null);
      hipY = -0.44;
      handR = FIST; handL = OPEN;
      rate = 22;
    } else if (state === 'flip') {
      T.spine = [0.6, 0, 0]; T.chest = [0.3, 0, 0];
      T.neck = [0.1, 0, 0]; T.headB = [0.1, 0, 0];
      this._arm(T, 'R', -0.9, 0.3, 1.9);
      this._arm(T, 'L', -0.9, 0.3, 1.9);
      this._leg(T, 'R', -2.0, 0.12, 2.3, 0.5);
      this._leg(T, 'L', -2.0, 0.12, 2.3, 0.5);
      handR = handL = FIST;
      rate = 16;
    }

    // 默认补全
    for (const nm of ['hips', 'spine', 'chest', 'neck', 'headB', 'clavR', 'clavL']) {
      if (!T[nm]) T[nm] = [0, 0, 0];
    }

    const k = 1 - Math.exp(-rate * dt);
    for (const nm in T) {
      if (nm === 'shR' && aimR) continue;
      const b = this[nm];
      const [x, y, z] = T[nm];
      b.rotation.x += (x - b.rotation.x) * k;
      b.rotation.y += (y - b.rotation.y) * k;
      b.rotation.z += (z - b.rotation.z) * k;
    }
    this.hips.position.y += (hipY - this.hips.position.y) * k;

    // 右臂瞄准蛛丝方向(四元数插值,避免欧拉翻转)
    if (aimR) {
      this.root.updateMatrixWorld(true);
      const qRoot = this.root.getWorldQuaternion(_q1);
      const qClav = this.clavR.getWorldQuaternion(_q2);
      const local = _v1.copy(aimR).applyQuaternion(qRoot).applyQuaternion(qClav.invert()).normalize();
      _q3.setFromUnitVectors(_down, local);
      this.shR.quaternion.slerp(_q3, 1 - Math.exp(-14 * dt));
    }

    this._updateHand(this.handR, handR, 1 - Math.exp(-14 * dt));
    this._updateHand(this.handL, handL, 1 - Math.exp(-14 * dt));
  }

  getHandWorldPos(out) {
    return this.handR.anchor.getWorldPosition(out);
  }
  getLeftHandWorldPos(out) {
    return this.handL.anchor.getWorldPosition(out);
  }
}

const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _v1 = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);
