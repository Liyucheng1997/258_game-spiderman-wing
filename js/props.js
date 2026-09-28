// 街道道具(全部 InstancedMesh):路灯 + 地面光斑、红绿灯(随相位切换)、行道树/公园树、长椅、消防栓
// 车辆:轿车 / 出租车 / SUV / 公交车,带红绿灯与跟车逻辑的车流模拟
import * as THREE from 'three';
import { Bucket } from './geo.js';
import { makeCanvas, makeTex, mulberry32, vnoise } from './textures.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
function mat(x, y, z, ry = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ'));
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), _q, new THREE.Vector3(sx, sy, sz));
}
const hex = (h) => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };

// ---------------- 路灯 ----------------
function lampGeometries() {
  const metal = new Bucket(), glow = new Bucket();
  const add = (b, g, m, c) => b.geometry(g, m, c);
  add(metal, new THREE.CylinderGeometry(0.28, 0.34, 0.9, 10), mat(0, 0.45, 0));
  add(metal, new THREE.CylinderGeometry(0.2, 0.26, 0.15, 10), mat(0, 0.95, 0));
  add(metal, new THREE.CylinderGeometry(0.09, 0.14, 7.2, 8), mat(0, 4.4, 0));
  add(metal, new THREE.TorusGeometry(0.12, 0.03, 6, 12), mat(0, 2.2, 0, 0, Math.PI / 2));
  const curve = new THREE.CubicBezierCurve3(
    new THREE.Vector3(0, 7.6, 0), new THREE.Vector3(0, 8.6, 0),
    new THREE.Vector3(0.6, 8.9, 0), new THREE.Vector3(2.0, 8.7, 0));
  add(metal, new THREE.TubeGeometry(curve, 16, 0.07, 6), new THREE.Matrix4());
  const head = new THREE.SphereGeometry(0.5, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  add(metal, head, mat(2.25, 8.62, 0, 0, 0, 0, 1.1, 0.45, 0.6));
  add(glow, new THREE.CircleGeometry(0.42, 16), mat(2.25, 8.6, 0, 0, Math.PI / 2, 0, 1.1, 1, 0.6));
  return { metal: metal.build(), glow: glow.build() };
}

// ---------------- 红绿灯 ----------------
function signalGeometries() {
  const metal = new Bucket();
  metal.geometry(new THREE.CylinderGeometry(0.16, 0.2, 6.2, 10), mat(0, 3.1, 0));
  metal.geometry(new THREE.CylinderGeometry(0.08, 0.1, 5.2, 8), mat(2.6, 5.9, 0, 0, 0, Math.PI / 2));
  // 两个信号灯箱(灯面朝 +z)
  for (const x of [2.4, 4.6]) {
    metal.geometry(new THREE.BoxGeometry(0.4, 1.25, 0.38), mat(x, 5.2, 0));
    for (let k = 0; k < 3; k++) {
      metal.geometry(new THREE.CylinderGeometry(0.15, 0.15, 0.2, 10, 1, true),
        mat(x, 5.6 - k * 0.38, 0.27, 0, Math.PI / 2, 0));
    }
  }
  // 行人信号
  metal.geometry(new THREE.BoxGeometry(0.3, 0.4, 0.3), mat(0.25, 3.0, 0));
  return metal.build();
}

// ---------------- 树 ----------------
function treeGeometry(seed, kind) {
  const rng = mulberry32(seed);
  const b = new Bucket();
  const bark = hex(0x3d2b20);
  const th = kind === 'park' ? 4.5 + rng() * 2 : 3.2 + rng() * 1.2;
  const trunk = new THREE.CylinderGeometry(0.16, 0.28, th, 7);
  b.geometry(trunk, mat(0, th / 2, 0), bark);
  // 分枝
  for (let i = 0; i < 4; i++) {
    const a = rng() * Math.PI * 2;
    const br = new THREE.CylinderGeometry(0.05, 0.11, 2.2, 5);
    b.geometry(br, mat(Math.cos(a) * 0.5, th + 0.5, Math.sin(a) * 0.5, -a, 0, 0.7), bark);
  }
  // 树冠:多团噪声扰动的二十面体
  const clumps = kind === 'park' ? 9 : 6;
  const base = kind === 'park' ? 2.3 : 1.7;
  for (let i = 0; i < clumps; i++) {
    const g = new THREE.IcosahedronGeometry(1, 2);
    const p = g.attributes.position;
    const cols = [];
    const hue = 0.24 + rng() * 0.08, sat = 0.45 + rng() * 0.2;
    for (let k = 0; k < p.count; k++) {
      const x = p.getX(k), y = p.getY(k), z = p.getZ(k);
      const n = 0.8 + 0.45 * vnoise(x * 2.3 + i * 7, y * 2.3 + z * 1.7 + seed);
      p.setXYZ(k, x * n, y * n * 0.85, z * n);
      const c = new THREE.Color().setHSL(hue, sat, 0.12 + 0.12 * (y * 0.5 + 0.5) + rng() * 0.03);
      cols.push(c.r, c.g, c.b);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    g.computeVertexNormals();
    const a = (i / clumps) * Math.PI * 2 + rng();
    const r = i === 0 ? 0 : base * (0.55 + rng() * 0.35);
    const s = base * (0.65 + rng() * 0.45);
    b.geometry(g, mat(Math.cos(a) * r, th + base * 0.6 + rng() * base * 0.8, Math.sin(a) * r, rng() * 6, 0, 0, s, s, s));
  }
  return b.build();
}

// ---------------- 长椅 / 消防栓 ----------------
function benchGeometry() {
  const b = new Bucket();
  const wood = hex(0x6b4a30), iron = hex(0x1e2226);
  for (let i = 0; i < 3; i++) b.geometry(new THREE.BoxGeometry(1.8, 0.05, 0.12), mat(0, 0.45, -0.18 + i * 0.15), wood);
  for (let i = 0; i < 2; i++) b.geometry(new THREE.BoxGeometry(1.8, 0.1, 0.04), mat(0, 0.65 + i * 0.16, -0.28, 0, -0.2), wood);
  for (const x of [-0.8, 0.8]) {
    b.geometry(new THREE.BoxGeometry(0.06, 0.45, 0.5), mat(x, 0.22, -0.05), iron);
    b.geometry(new THREE.BoxGeometry(0.06, 0.5, 0.06), mat(x, 0.7, -0.3, 0, -0.2), iron);
  }
  return b.build();
}
function hydrantGeometry() {
  const b = new Bucket();
  const red = hex(0xb81f18), cap = hex(0xd8d0b0);
  b.geometry(new THREE.CylinderGeometry(0.2, 0.22, 0.1, 12), mat(0, 0.05, 0), red);
  b.geometry(new THREE.CylinderGeometry(0.14, 0.16, 0.6, 12), mat(0, 0.4, 0), red);
  b.geometry(new THREE.SphereGeometry(0.15, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat(0, 0.7, 0), red);
  b.geometry(new THREE.CylinderGeometry(0.04, 0.04, 0.08, 6), mat(0, 0.86, 0), cap);
  b.geometry(new THREE.CylinderGeometry(0.06, 0.06, 0.36, 8), mat(0, 0.48, 0, 0, 0, Math.PI / 2), red);
  b.geometry(new THREE.CylinderGeometry(0.07, 0.07, 0.12, 8), mat(0, 0.48, 0.13, 0, Math.PI / 2), cap);
  return b.build();
}

// ---------------- 车辆 ----------------
function extrudeProfile(pts, depth, bevel = 0) {
  const s = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(s, {
    depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 4,
  });
  g.translate(0, 0, -depth / 2);
  return g;
}

function carGeometries(type) {
  const paint = new Bucket(), detail = new Bucket(), light = new Bucket();
  const glass = hex(0x10141c), tire = hex(0x121212), rim = hex(0x9aa0a8), trimC = hex(0x1a1a1c), chrome = hex(0xc8ccd0);
  const HEAD = [3.0, 2.9, 2.5], TAIL = [2.4, 0.15, 0.1];
  let L = 4.6, W = 1.8, wheelR = 0.34, wheelX = 1.45, lightY = 0.72;

  if (type === 'bus') {
    L = 11.5; W = 2.5; wheelR = 0.5; wheelX = 3.9;
    paint.geometry(new THREE.BoxGeometry(L, 2.6, W), mat(0, 1.75, 0));
    paint.geometry(new THREE.BoxGeometry(L - 0.4, 0.25, W - 0.3), mat(0, 3.15, 0));
    detail.geometry(new THREE.BoxGeometry(L - 1.4, 1.0, W + 0.02), mat(-0.3, 2.35, 0), glass);
    detail.geometry(new THREE.BoxGeometry(0.05, 1.5, W - 0.3), mat(L / 2 + 0.01, 2.1, 0), glass);
    detail.geometry(new THREE.BoxGeometry(L + 0.05, 0.3, W + 0.05), mat(0, 0.55, 0), trimC);
    light.geometry(new THREE.BoxGeometry(0.06, 0.3, 1.3), mat(L / 2 + 0.03, 2.95, 0), [2.2, 1.4, 0.2]);
    lightY = 0.9;
  } else {
    const suv = type === 'suv';
    const sy = suv ? 1.18 : 1;
    if (suv) { L = 4.8; W = 1.9; wheelR = 0.38; wheelX = 1.5; lightY = 0.85; }
    const d = W - 0.16;
    const body = extrudeProfile([
      [-L / 2, 0.32], [L / 2 - 0.05, 0.32], [L / 2 + 0.05, 0.55], [L / 2, 0.82 * sy],
      [L / 2 - 0.3, 0.95 * sy], [1.0, 1.02 * sy], [-L / 2 + 0.6, 1.04 * sy], [-L / 2 + 0.05, 0.98 * sy], [-L / 2 - 0.05, 0.7],
    ], d, 0.08);
    paint.geometry(body, new THREE.Matrix4());
    const cab = suv
      ? [[0.95, 1.0 * sy], [0.35, 1.5 * sy], [-L / 2 + 0.25, 1.5 * sy], [-L / 2 + 0.15, 1.02 * sy]]
      : [[0.95, 1.0], [0.25, 1.42], [-1.05, 1.42], [-1.75, 1.02]];
    detail.geometry(extrudeProfile(cab, W - 0.22), new THREE.Matrix4(), glass);
    const roofX0 = cab[2][0], roofX1 = cab[1][0], roofY = cab[1][1];
    paint.geometry(new THREE.BoxGeometry(roofX1 - roofX0 + 0.1, 0.06, W - 0.18), mat((roofX0 + roofX1) / 2, roofY + 0.02, 0));
    // B 柱
    for (const z of [-1, 1]) {
      paint.geometry(new THREE.BoxGeometry(0.1, (roofY - 1.0 * sy), 0.02), mat(-0.3, (roofY + 1.0 * sy) / 2, z * (W / 2 - 0.1)));
    }
    // 保险杠、格栅、后视镜、门把
    detail.geometry(new THREE.BoxGeometry(0.12, 0.2, W - 0.05), mat(L / 2 + 0.04, 0.42, 0), trimC);
    detail.geometry(new THREE.BoxGeometry(0.12, 0.2, W - 0.05), mat(-L / 2 - 0.04, 0.42, 0), trimC);
    detail.geometry(new THREE.BoxGeometry(0.04, 0.16, 0.8), mat(L / 2 + 0.06, 0.66 * sy, 0), trimC);
    for (const z of [-1, 1]) {
      detail.geometry(new THREE.BoxGeometry(0.16, 0.1, 0.16), mat(0.85, 1.08 * sy, z * (W / 2 + 0.06)), trimC);
      detail.geometry(new THREE.BoxGeometry(0.2, 0.03, 0.02), mat(0.1, 0.9 * sy, z * (W / 2 + 0.01)), chrome);
      detail.geometry(new THREE.BoxGeometry(0.2, 0.03, 0.02), mat(-0.9, 0.9 * sy, z * (W / 2 + 0.01)), chrome);
    }
    if (type === 'taxi') {
      detail.geometry(new THREE.BoxGeometry(0.5, 0.2, 0.9), mat(-0.4, roofY + 0.15, 0), hex(0xe8e0c0));
      light.geometry(new THREE.BoxGeometry(0.52, 0.12, 0.7), mat(-0.4, roofY + 0.17, 0), [1.8, 1.6, 0.8]);
    }
  }
  // 车轮
  for (const x of [-wheelX, wheelX]) {
    for (const z of [-1, 1]) {
      const tw = type === 'bus' ? 0.35 : 0.24;
      detail.geometry(new THREE.CylinderGeometry(wheelR, wheelR, tw, 16), mat(x, wheelR, z * (W / 2 - tw / 2 + 0.02), 0, Math.PI / 2), tire);
      detail.geometry(new THREE.CylinderGeometry(wheelR * 0.62, wheelR * 0.62, tw + 0.02, 10), mat(x, wheelR, z * (W / 2 - tw / 2 + 0.03), 0, Math.PI / 2), rim);
    }
  }
  // 车灯
  for (const z of [-1, 1]) {
    light.geometry(new THREE.BoxGeometry(0.06, 0.13, 0.34), mat(L / 2 + 0.03, lightY, z * (W / 2 - 0.3)), HEAD);
    light.geometry(new THREE.BoxGeometry(0.06, 0.12, 0.38), mat(-L / 2 - 0.03, lightY + 0.05, z * (W / 2 - 0.28)), TAIL);
  }
  return { paint: paint.build(), detail: detail.build(), light: light.build(), L };
}

// 地面光斑纹理
function poolTex() {
  const c = makeCanvas(128, 128), g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.4, 'rgba(255,255,255,0.45)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return makeTex(c, { repeat: false });
}

const CAR_COLORS = [0x1c1c1e, 0xe8e8ea, 0x8a1418, 0x1d3a6e, 0x6a6e74, 0x2e4a38, 0xb8b8bc, 0x3a2418, 0x0f2a44];

export function buildProps(scene, opts) {
  const { layout, BLOCK, GRID, CITY_HALF, SW_HALF, CURB, rng, M } = opts;
  const group = new THREE.Group();
  scene.add(group);
  const inst = (geo, material, list, cast = true) => {
    const im = new THREE.InstancedMesh(geo, material, list.length);
    list.forEach((m, i) => im.setMatrixAt(i, m));
    im.castShadow = cast; im.receiveShadow = true;
    im.computeBoundingSphere();
    group.add(im);
    return im;
  };
  const vcMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 });
  const lampMetal = new THREE.MeshStandardMaterial({ color: 0x1d2a24, roughness: 0.45, metalness: 0.7 });
  const lampGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 2.4, 1.4) });

  // ---------- 路灯 ----------
  const lamps = [], pools = [];
  const addLamp = (x, z, ry) => {
    lamps.push(mat(x, CURB, z, ry));
    const lx = x + Math.cos(ry) * 2.25, lz = z - Math.sin(ry) * 2.25;
    pools.push(mat(lx, 0.22, lz, 0, -Math.PI / 2, 0, 14, 14, 1));
  };
  for (const b of layout.blocks) {
    const e = SW_HALF - 0.6;
    for (const s of [-10.5, 10.5]) {
      addLamp(b.cx + s, b.cz + e, -Math.PI / 2);   // 臂指向 +z
      addLamp(b.cx + s, b.cz - e, Math.PI / 2);
      addLamp(b.cx + e, b.cz + s, 0);
      addLamp(b.cx - e, b.cz + s, Math.PI);
    }
  }
  const lg = lampGeometries();
  inst(lg.metal, lampMetal, lamps);
  inst(lg.glow, lampGlow, lamps, false);
  const poolMat = new THREE.MeshBasicMaterial({
    map: poolTex(), color: new THREE.Color(0.5, 0.36, 0.2), transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const poolGeo = new THREE.PlaneGeometry(1, 1);
  inst(poolGeo, poolMat, pools, false).receiveShadow = false;

  // ---------- 红绿灯 ----------
  const mid = Math.floor(GRID / 2);
  const signals = [], sigLampsA = [], sigLampsB = [];
  const lampOffsets = (list, x, z, ry) => {
    // 两个灯箱 × 三色,记录世界矩阵
    for (const bx of [2.4, 4.6]) {
      for (let k = 0; k < 3; k++) {
        const ly = 5.6 - k * 0.38, lz = 0.3;
        const wx = x + Math.cos(ry) * bx + Math.sin(ry) * lz, wz = z - Math.sin(ry) * bx + Math.cos(ry) * lz;
        list.push({ m: mat(wx, CURB + ly, wz, ry), k });
      }
    }
  };
  for (let i = 0; i <= GRID; i++) {
    for (let j = 0; j <= GRID; j++) {
      const ix = (i - mid) * BLOCK - BLOCK / 2, iz = (j - mid) * BLOCK - BLOCK / 2;
      if ((i + j) % 2) continue;
      const c = 6.8;
      // A 组:控制东西向车流,杆在东南角,臂伸向 -z(覆盖东西向道路)
      signals.push(mat(ix + c, CURB, iz + c, Math.PI / 2));
      lampOffsets(sigLampsA, ix + c, iz + c, Math.PI / 2);
      signals.push(mat(ix - c, CURB, iz - c, 0));
      lampOffsets(sigLampsB, ix - c, iz - c, 0);
    }
  }
  inst(signalGeometries(), lampMetal, signals);
  const sigGeo = new THREE.CircleGeometry(0.13, 12);
  const sigMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const sigA = inst(sigGeo, sigMat, sigLampsA.map((o) => o.m), false);
  const sigB = inst(sigGeo, sigMat, sigLampsB.map((o) => o.m), false);
  const SIG_ON = [new THREE.Color(3, 0.15, 0.1), new THREE.Color(3, 1.8, 0.1), new THREE.Color(0.2, 3, 0.9)];
  const SIG_OFF = [new THREE.Color(0.15, 0.02, 0.02), new THREE.Color(0.15, 0.1, 0.02), new THREE.Color(0.02, 0.12, 0.05)];
  const setSignals = (im, list, state) => {   // state: 0 红 1 黄 2 绿
    list.forEach((o, i) => im.setColorAt(i, o.k === state ? SIG_ON[o.k] : SIG_OFF[o.k]));
    im.instanceColor.needsUpdate = true;
  };

  // ---------- 树 ----------
  const treeGeos = [treeGeometry(1, 'street'), treeGeometry(2, 'street'), treeGeometry(3, 'park'), treeGeometry(4, 'park')];
  const treeLists = [[], [], [], []];
  const benches = [], hydrants = [];
  for (const b of layout.blocks) {
    if (b.type === 'city') {
      const e = SW_HALF - 1.4;
      const sides = [[0, e, 1], [0, -e, 1], [e, 0, 0], [-e, 0, 0]];
      for (const [ox, oz, alongX] of sides) {
        if (rng() < 0.45) continue;
        for (const s of [-5.2, 0, 5.2]) {
          const x = b.cx + ox + (alongX ? s : 0), z = b.cz + oz + (alongX ? 0 : s);
          const k = Math.floor(rng() * 2);
          const sc = 0.85 + rng() * 0.3;
          treeLists[k].push(mat(x, CURB, z, rng() * 6, 0, 0, sc, sc, sc));
        }
      }
      if (rng() < 0.5) {
        const e2 = SW_HALF - 0.7;
        hydrants.push(mat(b.cx + (rng() < 0.5 ? -e2 : e2), CURB, b.cz + (rng() - 0.5) * 20, rng() * 6));
      }
    } else if (b.type === 'park') {
      for (let t = 0; t < 22; t++) {
        const x = (rng() - 0.5) * 23, z = (rng() - 0.5) * 23;
        if (Math.abs(x) < 3 || Math.abs(z) < 3) continue;
        const k = 2 + Math.floor(rng() * 2);
        const sc = 0.8 + rng() * 0.5;
        treeLists[k].push(mat(b.cx + x, CURB, b.cz + z, rng() * 6, 0, 0, sc, sc, sc));
      }
      for (const s of [-8, 8]) {
        benches.push(mat(b.cx + s, CURB + 0.08, b.cz + 2.3, Math.PI));
        benches.push(mat(b.cx + s, CURB + 0.08, b.cz - 2.3, 0));
        benches.push(mat(b.cx + 2.3, CURB + 0.08, b.cz + s, -Math.PI / 2));
        benches.push(mat(b.cx - 2.3, CURB + 0.08, b.cz + s, Math.PI / 2));
      }
    } else if (b.type === 'plaza') {
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        treeLists[2 + (i % 2)].push(mat(b.cx + Math.cos(a) * 12.5, CURB, b.cz + Math.sin(a) * 12.5, a, 0, 0, 0.9, 0.9, 0.9));
        benches.push(mat(b.cx + Math.cos(a + 0.26) * 9.5, CURB, b.cz + Math.sin(a + 0.26) * 9.5, -a - 0.26 - Math.PI / 2));
      }
    }
  }
  treeLists.forEach((l, i) => { if (l.length) inst(treeGeos[i], vcMat, l); });
  inst(benchGeometry(), vcMat, benches);
  inst(hydrantGeometry(), vcMat, hydrants);

  // ---------- 车流 ----------
  const types = ['sedan', 'sedan', 'taxi', 'suv', 'bus'];
  const typeGeo = {};
  for (const t of new Set(types)) typeGeo[t] = carGeometries(t);
  const paintMat = new THREE.MeshPhysicalMaterial({ roughness: 0.3, metalness: 0.55, clearcoat: 0.8, clearcoatRoughness: 0.15 });
  const detailMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.5 });
  const lightMat = new THREE.MeshBasicMaterial({ vertexColors: true });

  const LIMIT = CITY_HALF + 8;
  const lanes = [];
  const roads = [];
  for (let k = 0; k <= GRID; k++) roads.push((k - mid) * BLOCK - BLOCK / 2);
  for (const r of roads) {
    for (const dir of [1, -1]) {
      for (const off of [1.6, 4.4]) {
        // 沿 x 的道路:行驶方向 dir,右侧为 +z*dir
        lanes.push({ axis: 'x', dir, fixed: r + dir * off, cars: [] });
        // 沿 z 的道路:行驶方向 dir,右侧为 -x*dir
        lanes.push({ axis: 'z', dir, fixed: r - dir * off, cars: [] });
      }
    }
  }
  const cars = [];
  for (const lane of lanes) {
    const n = rng() < 0.3 ? 1 : 2 + Math.floor(rng() * 2);
    for (let i = 0; i < n; i++) {
      const type = lane.fixed % 2 === 0 && rng() < 0.3 ? 'bus' : types[Math.floor(rng() * 4)];
      const car = {
        lane, type, s: -LIMIT + (i + rng() * 0.6) * (2 * LIMIT / n),
        v: 8 + rng() * 5, vmax: type === 'bus' ? 9 : 11 + rng() * 5, len: typeGeo[type].L,
      };
      lane.cars.push(car);
      cars.push(car);
    }
  }
  const byType = {};
  for (const c of cars) (byType[c.type] = byType[c.type] || []).push(c);
  const carMeshes = [];
  for (const t in byType) {
    const list = byType[t], g = typeGeo[t];
    const mk = (geo, material) => {
      const im = new THREE.InstancedMesh(geo, material, list.length);
      im.castShadow = true; im.receiveShadow = true;
      im.frustumCulled = false;
      group.add(im);
      return im;
    };
    const pm = mk(g.paint, paintMat), dm = mk(g.detail, detailMat), lm = mk(g.light, lightMat);
    lm.castShadow = false;
    list.forEach((c, i) => {
      const col = t === 'taxi' ? 0xf2b705 : t === 'bus' ? (rng() < 0.5 ? 0x2a5caa : 0xe8e4dc)
        : CAR_COLORS[Math.floor(rng() * CAR_COLORS.length)];
      pm.setColorAt(i, new THREE.Color(col));
    });
    carMeshes.push({ list, pm, dm, lm });
  }

  // 红绿灯相位:0-7 东西绿,7-9 东西黄,9-16 南北绿,16-18 南北黄
  const CYCLE = 18;
  const phaseOf = (t, axis) => {
    const p = t % CYCLE;
    if (axis === 'x') return p < 7 ? 2 : p < 9 ? 1 : 0;
    return p < 9 ? 0 : p < 16 ? 2 : p < 18 ? 1 : 0;
  };
  let lastA = -1, lastB = -1;

  function stepTraffic(t, dt) {
    for (const lane of lanes) {
      const cs = lane.cars;
      cs.sort((a, b) => a.s * lane.dir - b.s * lane.dir);
      const light = phaseOf(t, lane.axis);
      for (let i = 0; i < cs.length; i++) {
        const c = cs[i];
        let target = c.vmax;
        // 前车
        const ahead = cs[(i + 1) % cs.length];
        if (ahead !== c) {
          let gap = (ahead.s - c.s) * lane.dir;
          if (gap < 0) gap += 2 * LIMIT;
          gap -= (ahead.len + c.len) / 2;
          target = Math.min(target, Math.max(0, (gap - 3) * 0.9));
        }
        // 红灯
        if (light !== 2) {
          const pos = c.s * lane.dir;
          // 下一个路口(沿行驶方向)
          const rel = pos + CITY_HALF;
          const next = Math.ceil((rel + c.len / 2 + 9.5) / BLOCK) * BLOCK - CITY_HALF;
          const stopAt = next - 9.5 - c.len / 2;
          const dist = stopAt - pos;
          if (dist > -0.5 && dist < 30 && !(light === 1 && dist < 5)) {
            target = Math.min(target, Math.max(0, dist * 0.7));
          }
        }
        c.v += Math.max(-9 * dt, Math.min(3.5 * dt, target - c.v));
        c.s += c.v * dt * lane.dir;
        if (c.s > LIMIT) c.s -= 2 * LIMIT;
        if (c.s < -LIMIT) c.s += 2 * LIMIT;
      }
    }
  }
  const _mat = new THREE.Matrix4();
  function syncCars() {
    for (const cm of carMeshes) {
      cm.list.forEach((c, i) => {
        const L = c.lane;
        const x = L.axis === 'x' ? c.s : L.fixed, z = L.axis === 'x' ? L.fixed : c.s;
        const ry = L.axis === 'x' ? (L.dir > 0 ? 0 : Math.PI) : (L.dir > 0 ? -Math.PI / 2 : Math.PI / 2);
        _q.setFromAxisAngle(_up, ry);
        _mat.compose(_p.set(x, 0.02, z), _q, _s);
        cm.pm.setMatrixAt(i, _mat); cm.dm.setMatrixAt(i, _mat); cm.lm.setMatrixAt(i, _mat);
      });
      cm.pm.instanceMatrix.needsUpdate = cm.dm.instanceMatrix.needsUpdate = cm.lm.instanceMatrix.needsUpdate = true;
    }
  }
  syncCars();
  setSignals(sigA, sigLampsA, 2); setSignals(sigB, sigLampsB, 0);

  return {
    cars,
    update(t, dt) {
      stepTraffic(t, Math.min(dt, 0.05));
      syncCars();
      const a = phaseOf(t, 'x'), b = phaseOf(t, 'z');
      if (a !== lastA) { setSignals(sigA, sigLampsA, a); lastA = a; }
      if (b !== lastB) { setSignals(sigB, sigLampsB, b); lastB = b; }
    },
    carPositions(out) {
      out.length = 0;
      for (const c of cars) {
        const L = c.lane;
        out.push(L.axis === 'x' ? c.s : L.fixed, L.axis === 'x' ? L.fixed : c.s);
      }
      return out;
    },
  };
}
const _up = new THREE.Vector3(0, 1, 0);

// ---------- 查看器预览 ----------
export function makeCarPreview() {
  const g = new THREE.Group();
  const paintMat = new THREE.MeshPhysicalMaterial({ roughness: 0.3, metalness: 0.55, clearcoat: 0.8 });
  const detailMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.5 });
  const lightMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  ['sedan', 'taxi', 'suv', 'bus'].forEach((t, i) => {
    const c = carGeometries(t);
    const pm = paintMat.clone();
    pm.color.set([0x8a1418, 0xf2b705, 0x1d3a6e, 0x2a5caa][i]);
    for (const [geo, m] of [[c.paint, pm], [c.detail, detailMat], [c.light, lightMat]]) {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(0, 0, (i - 1.5) * 3.4);
      mesh.castShadow = true;
      g.add(mesh);
    }
  });
  return g;
}
export function makePropsPreview() {
  const g = new THREE.Group();
  const vc = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 });
  const lm = new THREE.MeshStandardMaterial({ color: 0x1d2a24, roughness: 0.45, metalness: 0.7 });
  const l = lampGeometries();
  g.add(new THREE.Mesh(l.metal, lm), new THREE.Mesh(l.glow, new THREE.MeshBasicMaterial({ color: 0xffe0b0 })));
  const s = new THREE.Mesh(signalGeometries(), lm); s.position.x = -4; g.add(s);
  for (let i = 0; i < 4; i++) {
    const t = new THREE.Mesh(treeGeometry(i + 1, i < 2 ? 'street' : 'park'), vc);
    t.position.set(4 + i * 5, 0, -4); g.add(t);
  }
  const b = new THREE.Mesh(benchGeometry(), vc); b.position.set(2, 0, 2); g.add(b);
  const h = new THREE.Mesh(hydrantGeometry(), vc); h.position.set(3.5, 0, 2); g.add(h);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}
