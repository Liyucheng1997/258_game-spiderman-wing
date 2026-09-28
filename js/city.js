// 程序化城市 v2:黄昏曼哈顿
// 五种建筑风格(玻璃幕墙 / 砖楼 / 装饰艺术石楼 / 现代带窗 / 商铺底商),退台、檐口、女儿墙、
// 水塔、消防梯、遮阳篷、霓虹招牌、广告牌;街道/人行道/公园/中央广场;海滨、远景天际线、悬索桥
import * as THREE from 'three';
import { BucketSet } from './geo.js';
import {
  makeCityMaterials, roadTex, makePlazaMaterial, waterNormalTex, makeNeonAtlas, makeBillboardAtlas,
} from './citytex.js';
import { mulberry32 } from './textures.js';
import { createSky, SUN_DIR } from './sky.js';
import { buildProps } from './props.js';

export const BLOCK = 46;
export const ROAD = 12;
export const STREET = 18;
export const SW_HALF = (BLOCK - ROAD) / 2;   // 17:人行道板半宽
export const LOT_HALF = 14;                  // 建筑可用半宽
export const GRID = 13;
export const CITY_HALF = (GRID * BLOCK) / 2; // 299
export const CURB = 0.18;
export const SHORE = 335;
export const WATER_Y = -1.4;

const STYLES = {
  glass: { mats: ['glassBlue', 'glassTeal', 'glassGold'], bayW: 1.5, floorH: 3.75, store: false },
  brick: { mats: ['brickRed', 'brickTan', 'brickBrown'], bayW: 3, floorH: 3.3, store: true },
  stone: { mats: ['stone'], bayW: 2.4, floorH: 3.6, store: true },
  modern: { mats: ['modern'], bayW: 3, floorH: 3.6, store: true },
};

const facadeUV = (st, uOff, vOff) => (face, a, y) => [(a / st.bayW + uOff) / 8, (y / st.floorH + vOff) / 8];
const storeUV = (uOff) => (face, a, y) => [a / 48 + uOff, Math.min(y, 4.5) / 4.5];
const worldUV = (s) => (face, a, y) => [a * s, y * s];
const snap = (v, s) => Math.max(s * 2, Math.round(v / s) * s);

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const _s = new THREE.Vector3(), _p = new THREE.Vector3();
function mat4(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _q.setFromEuler(_e.set(rx, ry, rz));
  return _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
}

// 共享几何
const G = {
  cyl8: new THREE.CylinderGeometry(1, 1, 1, 8),
  cyl16: new THREE.CylinderGeometry(1, 1, 1, 16),
  tank: new THREE.CylinderGeometry(1, 1, 1, 20, 1, true),
  cone: new THREE.ConeGeometry(1, 1, 20),
  cone4: new THREE.ConeGeometry(1, 1, 4),
  sphere: new THREE.SphereGeometry(1, 10, 8),
  box: new THREE.BoxGeometry(1, 1, 1),
  disc: new THREE.CircleGeometry(1, 20),
};

export function buildCity(scene, renderer) {
  const rng = mulberry32(20260928);
  const M = makeCityMaterials();
  const neon = makeNeonAtlas();
  M.neon = new THREE.MeshBasicMaterial({ map: neon.tex, color: new THREE.Color(1.6, 1.6, 1.6) });
  M.neon.userData.noShadow = true;
  const bill = makeBillboardAtlas();
  M.billboard = new THREE.MeshBasicMaterial({ map: bill.tex, color: new THREE.Color(1.15, 1.15, 1.15) });
  M.billboard.userData.noShadow = true;

  const sky = createSky(scene, renderer);
  scene.fog = new THREE.FogExp2(0x3b2440, 0.0011);

  // ---------------- 光照 ----------------
  const hemi = new THREE.HemisphereLight(0x7d86c8, 0x4a3530, 0.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffa860, 2.6);
  sun.position.copy(SUN_DIR).multiplyScalar(500);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.camera.near = 50;
  sun.shadow.camera.far = 1300;
  const S = 170;
  sun.shadow.camera.left = -S; sun.shadow.camera.right = S;
  sun.shadow.camera.top = S; sun.shadow.camera.bottom = -S;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.6;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(0x5566bb, 0.35);
  fill.position.set(-300, 200, 400);
  scene.add(fill);

  const B = new BucketSet(BLOCK * 4, CITY_HALF + 23);
  const colliders = [];
  const rooftops = [];
  const layout = { blocks: [], parks: [], plaza: null, buildings: [] };
  const mid = Math.floor(GRID / 2);
  const addCollider = (x0, y0, z0, x1, y1, z1, tag = 'building') => {
    colliders.push({ box: new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1)), tag });
  };

  // 公园街区
  const parkBlocks = new Set();
  while (parkBlocks.size < 7) {
    const gx = Math.floor(rng() * GRID), gz = Math.floor(rng() * GRID);
    if (Math.abs(gx - mid) <= 1 && Math.abs(gz - mid) <= 1) continue;
    parkBlocks.add(gx + '_' + gz);
  }

  // ================= 地面 =================
  {
    const rt = roadTex(BLOCK, SW_HALF);
    const roadMat = new THREE.MeshStandardMaterial({
      map: rt.map, normalMap: rt.normalMap, roughness: 0.88, metalness: 0,
    });
    const geo = new THREE.PlaneGeometry(SHORE * 2, SHORE * 2, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const p = geo.attributes.position, uv = geo.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) - 23) / BLOCK, -(p.getZ(i) - 23) / BLOCK);
    const road = new THREE.Mesh(geo, roadMat);
    road.receiveShadow = true;
    scene.add(road);
  }
  const swUV = worldUV(1 / 6);
  const slab = (x0, z0, x1, z1, mat = 'sidewalk') => {
    B.get(mat, (x0 + x1) / 2, (z0 + z1) / 2).box(x0, 0, z0, x1, CURB, z1, swUV, 'px nx pz nz py');
  };
  // 海滨步道 + 护岸
  {
    const E = CITY_HALF + 6;
    slab(-SHORE, -SHORE, SHORE, -E); slab(-SHORE, E, SHORE, SHORE);
    slab(-SHORE, -E, -E, E); slab(E, -E, SHORE, E);
    const wall = B.get('trimDark');
    const wUV = worldUV(1 / 4);
    wall.box(-SHORE - 1, WATER_Y - 3, -SHORE - 1, SHORE + 1, 0, -SHORE, wUV, 'nz px nx');
    wall.box(-SHORE - 1, WATER_Y - 3, SHORE, SHORE + 1, 0, SHORE + 1, wUV, 'pz px nx');
    wall.box(-SHORE - 1, WATER_Y - 3, -SHORE, -SHORE, 0, SHORE, wUV, 'nx');
    wall.box(SHORE, WATER_Y - 3, -SHORE, SHORE + 1, 0, SHORE, wUV, 'px');
    // 栏杆
    const rail = B.get('metalDark');
    const railLine = (ax, az, bx, bz) => {
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.floor(len / 2.5);
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        rail.box(ax + (bx - ax) * t - 0.05, CURB, az + (bz - az) * t - 0.05,
          ax + (bx - ax) * t + 0.05, CURB + 1.1, az + (bz - az) * t + 0.05, worldUV(1));
      }
      const x0 = Math.min(ax, bx) - 0.04, x1 = Math.max(ax, bx) + 0.04;
      const z0 = Math.min(az, bz) - 0.04, z1 = Math.max(az, bz) + 0.04;
      rail.box(x0, CURB + 1.05, z0, x1, CURB + 1.13, z1, worldUV(1));
      rail.box(x0, CURB + 0.55, z0, x1, CURB + 0.6, z1, worldUV(1));
    };
    const r = SHORE - 0.4;
    railLine(-r, -r, r, -r); railLine(-r, r, r, r); railLine(-r, -r, -r, r); railLine(r, -r, r, r);
  }

  // ================= 街区 =================
  for (let gx = 0; gx < GRID; gx++) {
    for (let gz = 0; gz < GRID; gz++) {
      const cx = (gx - mid) * BLOCK, cz = (gz - mid) * BLOCK;
      const isCenter = gx === mid && gz === mid;
      const isPark = parkBlocks.has(gx + '_' + gz);
      const info = { cx, cz, gx, gz, type: isCenter ? 'plaza' : isPark ? 'park' : 'city' };
      layout.blocks.push(info);

      if (isCenter) {
        buildPlaza(scene, B, M, cx, cz, addCollider);
        layout.plaza = info;
        continue;
      }
      if (isPark) {
        // 外圈人行道 + 草坪 + 十字小径
        slab(cx - SW_HALF, cz - SW_HALF, cx + SW_HALF, cz - 13);
        slab(cx - SW_HALF, cz + 13, cx + SW_HALF, cz + SW_HALF);
        slab(cx - SW_HALF, cz - 13, cx - 13, cz + 13);
        slab(cx + 13, cz - 13, cx + SW_HALF, cz + 13);
        const gUV = worldUV(1 / 8);
        B.get('grass', cx, cz).box(cx - 13, 0, cz - 13, cx + 13, CURB + 0.05, cz + 13, gUV, 'py');
        B.get('trim', cx, cz).box(cx - 13, 0, cz - 13, cx + 13, CURB + 0.2, cz - 12.7, worldUV(1 / 4), 'pz py');
        B.get('trim', cx, cz).box(cx - 13, 0, cz + 12.7, cx + 13, CURB + 0.2, cz + 13, worldUV(1 / 4), 'nz py');
        B.get('trim', cx, cz).box(cx - 13, 0, cz - 12.7, cx - 12.7, CURB + 0.2, cz + 12.7, worldUV(1 / 4), 'px py');
        B.get('trim', cx, cz).box(cx + 12.7, 0, cz - 12.7, cx + 13, CURB + 0.2, cz + 12.7, worldUV(1 / 4), 'nx py');
        B.get('sidewalk', cx, cz).box(cx - 1.6, 0, cz - 12.7, cx + 1.6, CURB + 0.08, cz + 12.7, swUV, 'py');
        B.get('sidewalk', cx, cz).box(cx - 12.7, 0, cz - 1.6, cx + 12.7, CURB + 0.08, cz + 1.6, swUV, 'py');
        layout.parks.push(info);
        continue;
      }

      slab(cx - SW_HALF, cz - SW_HALF, cx + SW_HALF, cz + SW_HALF);

      // 地块划分
      const dist = Math.max(Math.abs(gx - mid), Math.abs(gz - mid));
      const downtown = dist <= 2 || (gx + gz) % 5 === 0;
      const r = rng();
      const lots = [];
      const L = LOT_HALF;
      if (r < 0.34) {
        lots.push({ x: cx, z: cz, w: 2 * L - 1 - rng() * 3, d: 2 * L - 1 - rng() * 3, big: true });
      } else if (r < 0.72) {
        const alongX = rng() < 0.5;
        for (const s of [-1, 1]) {
          if (alongX) lots.push({ x: cx + s * L / 2, z: cz, w: L - 0.6, d: 2 * L - 1 - rng() * 2 });
          else lots.push({ x: cx, z: cz + s * L / 2, w: 2 * L - 1 - rng() * 2, d: L - 0.6 });
        }
      } else {
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          lots.push({ x: cx + sx * L / 2, z: cz + sz * L / 2, w: L - 0.6, d: L - 0.6, small: true });
        }
      }

      for (const lot of lots) {
        let h;
        if (lot.small) h = 16 + rng() * 26;
        else h = 26 + rng() * 50 + dist * 3;
        if (lot.big && (downtown ? rng() < 0.55 : rng() < 0.18)) h = 95 + rng() * 115;
        else if (!lot.small && rng() < 0.12) h = 80 + rng() * 50;
        h = Math.min(h, 215);

        let style;
        const r2 = rng();
        if (h > 95) style = r2 < 0.5 ? 'glass' : r2 < 0.82 ? 'stone' : 'modern';
        else if (h > 50) style = r2 < 0.25 ? 'glass' : r2 < 0.5 ? 'modern' : r2 < 0.75 ? 'stone' : 'brick';
        else style = r2 < 0.75 ? 'brick' : r2 < 0.9 ? 'modern' : 'stone';

        const b = addBuilding({ B, M, rng, addCollider, rooftops, neonCount: neon.count, billCount: bill.count },
          lot.x, lot.z, lot.w, lot.d, h, style, cx, cz);
        layout.buildings.push(b);
      }
    }
  }

  // ================= 水面 =================
  const waterNormal = waterNormalTex();
  waterNormal.repeat.set(60, 60);
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(6000, 6000),
    new THREE.MeshStandardMaterial({
      color: 0x0b1522, roughness: 0.08, metalness: 0.9, normalMap: waterNormal,
      normalScale: new THREE.Vector2(0.35, 0.35), envMapIntensity: 1.2,
    }));
  water.rotation.x = -Math.PI / 2;
  water.position.y = WATER_Y;
  water.receiveShadow = true;
  scene.add(water);

  buildSkyline(scene, rng, M);
  buildBridge(scene, B, M);

  B.addTo(scene, M);

  // 道具:路灯/红绿灯/树/车流/长椅等
  const props = buildProps(scene, { layout, BLOCK, GRID, CITY_HALF, SW_HALF, CURB, SHORE, rng, M });

  function groundHeight(x, z) {
    const ax = Math.abs(x), az = Math.abs(z);
    if (ax > SHORE || az > SHORE) return WATER_Y;
    if (ax > CITY_HALF + 6 || az > CITY_HALF + 6) return CURB;
    const lx = ((x + BLOCK / 2) % BLOCK + BLOCK) % BLOCK - BLOCK / 2;
    const lz = ((z + BLOCK / 2) % BLOCK + BLOCK) % BLOCK - BLOCK / 2;
    if (Math.abs(lx) < SW_HALF && Math.abs(lz) < SW_HALF && ax < CITY_HALF && az < CITY_HALF) return CURB;
    return 0;
  }

  return {
    colliders, rooftops, sunLight: sun, groundHeight, layout,
    update(t, dt, camera, focus) {
      sky.update(t, camera.position);
      waterNormal.offset.set(t * 0.004, t * 0.002);
      sun.position.copy(focus).addScaledVector(SUN_DIR, 600);
      sun.target.position.copy(focus);
      props.update(t, dt, camera);
    },
  };
}

// ================= 建筑 =================
function addBuilding(ctx, cx, cz, w, d, H, styleName, blockX, blockZ) {
  const { B, rng, addCollider, rooftops } = ctx;
  const st = STYLES[styleName];
  const matName = st.mats[Math.floor(rng() * st.mats.length)];
  w = snap(w, st.bayW); d = snap(d, st.bayW);
  w = Math.min(w, 2 * LOT_HALF - 0.4); d = Math.min(d, 2 * LOT_HALF - 0.4);
  H = Math.max(st.floorH * 4, Math.round(H / st.floorH) * st.floorH);

  // 退台
  const tiers = [];
  if (styleName === 'stone' && H > 70) {
    const fr = H > 140 ? [0.55, 0.74, 0.88, 1.0] : [0.62, 0.84, 1.0];
    fr.forEach((f, i) => {
      const inset = i * st.bayW * (H > 140 ? 1 : 1.5);
      tiers.push({ w: Math.max(6, w - inset * 2), d: Math.max(6, d - inset * 2), top: Math.round(H * f / st.floorH) * st.floorH });
    });
  } else if ((styleName === 'glass' && H > 100 && rng() < 0.55) || (styleName === 'modern' && rng() < 0.35)) {
    const inset = st.bayW * (styleName === 'glass' ? 2 : 1);
    tiers.push({ w, d, top: Math.round(H * 0.62 / st.floorH) * st.floorH });
    tiers.push({ w: w - inset * 2, d: d - inset * 2, top: H });
  } else {
    tiers.push({ w, d, top: H });
  }

  const uOff = Math.floor(rng() * 8), vOff = Math.floor(rng() * 8);
  const fUV = facadeUV(st, uOff, vOff);
  const tUV = worldUV(1 / 4);
  const rUV = worldUV(1 / 8);
  const bucket = (m) => B.get(m, cx, cz);
  let prevTop = 0;
  let topTier = null;

  tiers.forEach((t, i) => {
    const x0 = cx - t.w / 2, x1 = cx + t.w / 2, z0 = cz - t.d / 2, z1 = cz + t.d / 2;
    const storeH = st.store && i === 0 ? 4.5 : 0;
    if (storeH) {
      bucket('store').box(x0, 0, z0, x1, storeH, z1, storeUV(rng()), 'px nx pz nz');
      bucket('trimDark').box(x0 - 0.3, storeH - 0.1, z0 - 0.3, x1 + 0.3, storeH + 0.5, z1 + 0.3, tUV, 'px nx pz nz py ny');
    }
    bucket(matName).box(x0, Math.max(prevTop, storeH), z0, x1, t.top, z1, fUV, 'px nx pz nz');
    bucket('roof').box(x0, t.top, z0, x1, t.top, z1, rUV, 'py');
    addCollider(x0, 0, z0, x1, t.top, z1);

    // 檐口 / 腰线
    if (styleName === 'brick') {
      bucket('trim').box(x0 - 0.55, t.top - 1.1, z0 - 0.55, x1 + 0.55, t.top - 0.2, z1 + 0.55, tUV, 'px nx pz nz py ny');
      bucket('trim').box(x0 - 0.3, t.top - 1.5, z0 - 0.3, x1 + 0.3, t.top - 1.1, z1 + 0.3, tUV, 'px nx pz nz ny');
    } else if (styleName === 'stone') {
      bucket('trim').box(x0 - 0.35, t.top - 0.7, z0 - 0.35, x1 + 0.35, t.top - 0.1, z1 + 0.35, tUV, 'px nx pz nz py ny');
      for (let y = prevTop + st.floorH * 6; y < t.top - 8; y += st.floorH * 6) {
        bucket('trim').box(x0 - 0.15, y - 0.3, z0 - 0.15, x1 + 0.15, y, z1 + 0.15, tUV, 'px nx pz nz py ny');
      }
    } else if (styleName === 'glass') {
      // 转角竖向金属边
      for (const [ax, az] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) {
        bucket('metalDark').box(ax - 0.18, prevTop, az - 0.18, ax + 0.18, t.top + 1.4, az + 0.18, tUV);
      }
    }
    // 女儿墙
    const pm = styleName === 'glass' ? matName : styleName === 'modern' ? 'metalDark' : 'trim';
    const pUV = styleName === 'glass' ? fUV : tUV;
    const ph = styleName === 'glass' ? 1.4 : 1.0, pt = 0.3;
    bucket(pm).box(x0, t.top, z0, x1, t.top + ph, z0 + pt, pUV);
    bucket(pm).box(x0, t.top, z1 - pt, x1, t.top + ph, z1, pUV);
    bucket(pm).box(x0, t.top, z0 + pt, x0 + pt, t.top + ph, z1 - pt, pUV);
    bucket(pm).box(x1 - pt, t.top, z0 + pt, x1, t.top + ph, z1 - pt, pUV);
    if (styleName === 'glass' || styleName === 'stone') {
      bucket('trimDark').box(x0 + pt, t.top + ph - 0.1, z0, x1 - pt, t.top + ph, z0 + pt, tUV, 'py');
    }
    prevTop = t.top;
    topTier = { x0, x1, z0, z1, top: t.top, w: t.w, d: t.d };
  });

  const T = topTier;
  rooftops.push(new THREE.Vector3(cx, T.top, cz));

  // ---------- 屋顶细节 ----------
  const spots = [];   // 已占用位置,避免重叠(中心 3.5m 留给收集品)
  const free = (x, z, r) => {
    if (Math.hypot(x - cx, z - cz) < 3.5 + r) return false;
    if (x - r < T.x0 + 0.5 || x + r > T.x1 - 0.5 || z - r < T.z0 + 0.5 || z + r > T.z1 - 0.5) return false;
    for (const s of spots) if (Math.hypot(s[0] - x, s[1] - z) < s[2] + r + 0.5) return false;
    return true;
  };
  const place = (r) => {
    for (let i = 0; i < 20; i++) {
      const x = T.x0 + r + 0.6 + rng() * (T.w - 2 * r - 1.2);
      const z = T.z0 + r + 0.6 + rng() * (T.d - 2 * r - 1.2);
      if (free(x, z, r)) { spots.push([x, z, r]); return [x, z]; }
    }
    return null;
  };

  // 楼梯间
  if (T.w > 9 && T.d > 9) {
    const p = place(2.4);
    if (p) {
      const [x, z] = p;
      bucket(styleName === 'brick' ? matName === 'brickRed' ? 'trimDark' : 'trim' : 'trimDark')
        .box(x - 1.8, T.top, z - 2, x + 1.8, T.top + 3.2, z + 2, tUV);
      bucket('roof').box(x - 1.9, T.top + 3.2, z - 2.1, x + 1.9, T.top + 3.35, z + 2.1, rUV);
      bucket('metalDark').box(x - 0.5, T.top, z + 2, x + 0.5, T.top + 2.2, z + 2.06, tUV, 'pz');
      bucket('lightWarm').box(x - 0.12, T.top + 2.35, z + 2.0, x + 0.12, T.top + 2.5, z + 2.15, tUV);
      addCollider(x - 1.8, 0, z - 2, x + 1.8, T.top + 3.35, z + 2, 'roofprop');
    }
  }
  // 空调外机
  const nAC = 1 + Math.floor(rng() * 3);
  for (let i = 0; i < nAC; i++) {
    const p = place(1.5);
    if (!p) break;
    const [x, z] = p;
    const big = rng() < 0.4;
    const sx = big ? 2.6 : 1.4, sz = big ? 1.8 : 1.2, sy = big ? 1.5 : 0.9;
    bucket('metal').box(x - sx / 2, T.top, z - sz / 2, x + sx / 2, T.top + sy, z + sz / 2, worldUV(1 / 3));
    const fans = big ? 2 : 1;
    for (let f = 0; f < fans; f++) {
      const fx = x + (fans === 2 ? (f - 0.5) * 1.2 : 0);
      bucket('metalDark').geometry(G.cyl16, mat4(fx, T.top + sy + 0.05, z, 0, 0, 0, 0.5, 0.1, 0.5));
    }
  }
  // 水塔
  if (styleName !== 'glass' && T.top < 130 && rng() < 0.6 && T.w > 9) {
    const p = place(2.8);
    if (p) addWaterTower(B, cx, cz, p[0], T.top, p[1], rng, addCollider);
  }
  // 天线 / 尖顶
  if (styleName === 'stone' && T.top > 80) {
    const sh = 14 + rng() * 22;
    bucket('trim').box(cx - T.w * 0.28, T.top, cz - T.d * 0.28, cx + T.w * 0.28, T.top + 3, cz + T.d * 0.28, tUV);
    bucket('trim').box(cx - T.w * 0.16, T.top + 3, cz - T.d * 0.16, cx + T.w * 0.16, T.top + 6, cz + T.d * 0.16, tUV);
    bucket('crown').box(cx - T.w * 0.16 - 0.05, T.top + 5.2, cz - T.d * 0.16 - 0.05, cx + T.w * 0.16 + 0.05, T.top + 5.5, cz + T.d * 0.16 + 0.05, tUV, 'px nx pz nz');
    bucket('steel').geometry(G.cone4, mat4(cx, T.top + 6 + sh / 2, cz, 0, Math.PI / 4, 0, 1.6, sh, 1.6));
    bucket('beacon').geometry(G.sphere, mat4(cx, T.top + 6 + sh + 0.3, cz, 0, 0, 0, 0.35, 0.35, 0.35));
    addCollider(cx - T.w * 0.28, 0, cz - T.d * 0.28, cx + T.w * 0.28, T.top + 6, cz + T.d * 0.28, 'roofprop');
  } else if (T.top > 100) {
    const mh = 10 + rng() * 18;
    bucket('metalDark').box(cx - 2.5, T.top, cz - 2.5, cx + 2.5, T.top + 4, cz + 2.5, tUV);
    bucket('steel').geometry(G.cyl8, mat4(cx, T.top + 4 + mh / 2, cz, 0, 0, 0, 0.35, mh, 0.35));
    bucket('steel').geometry(G.cyl8, mat4(cx, T.top + 4 + mh * 0.6, cz, 0, 0, 0, 1.4, 0.15, 1.4));
    bucket('beacon').geometry(G.sphere, mat4(cx, T.top + 4 + mh + 0.4, cz, 0, 0, 0, 0.5, 0.5, 0.5));
    if (styleName === 'glass') {
      bucket('crown').box(T.x0 - 0.02, T.top + 1.0, T.z0 - 0.02, T.x1 + 0.02, T.top + 1.25, T.z1 + 0.02, tUV, 'px nx pz nz');
    }
    addCollider(cx - 2.5, 0, cz - 2.5, cx + 2.5, T.top + 4, cz + 2.5, 'roofprop');
  }
  // 屋顶广告牌
  if ((styleName === 'brick' || styleName === 'modern') && T.top < 60 && rng() < 0.22) {
    const along = rng() < 0.5;
    const len = Math.min(12, (along ? T.w : T.d) - 2);
    const bx = along ? cx : T.x0 + 1.2, bz = along ? T.z0 + 1.2 : cz;
    const slot = Math.floor(rng() * ctx.billCount);
    const v0 = 1 - (slot + 1) / ctx.billCount, v1 = 1 - slot / ctx.billCount;
    const by0 = T.top + 2.2, by1 = by0 + len * 0.45;
    const bUV = (face, a, y, fw) => [a / fw, v0 + (v1 - v0) * (y - by0) / (by1 - by0)];
    if (along) {
      bucket('billboard').box(bx - len / 2, by0, bz - 0.1, bx + len / 2, by1, bz + 0.1, bUV, 'nz');
      bucket('metalDark').box(bx - len / 2 - 0.2, by0 - 0.2, bz + 0.1, bx + len / 2 + 0.2, by1 + 0.2, bz + 0.3, tUV);
      for (let k = -1; k <= 1; k++) bucket('metalDark').box(bx + k * len * 0.4 - 0.12, T.top, bz + 0.3, bx + k * len * 0.4 + 0.12, by0, bz + 0.55, tUV);
    } else {
      bucket('billboard').box(bx - 0.1, by0, bz - len / 2, bx + 0.1, by1, bz + len / 2, bUV, 'nx');
      bucket('metalDark').box(bx + 0.1, by0 - 0.2, bz - len / 2 - 0.2, bx + 0.3, by1 + 0.2, bz + len / 2 + 0.2, tUV);
      for (let k = -1; k <= 1; k++) bucket('metalDark').box(bx + 0.3, T.top, bz + k * len * 0.4 - 0.12, bx + 0.55, by0, bz + k * len * 0.4 + 0.12, tUV);
    }
    for (let k = -2; k <= 2; k++) {
      const lx = along ? bx + k * len * 0.22 : bx - 0.9, lz = along ? bz - 0.9 : bz + k * len * 0.22;
      bucket('lightWarm').box(lx - 0.15, by0 - 0.3, lz - 0.15, lx + 0.15, by0 - 0.15, lz + 0.15, tUV);
    }
  }

  // ---------- 立面附属:消防梯 / 雨篷 / 霓虹 ----------
  const base = tiers[0];
  const bx0 = cx - base.w / 2, bx1 = cx + base.w / 2, bz0 = cz - base.d / 2, bz1 = cz + base.d / 2;
  // 朝向街道的面(远离街区中心)
  const faces = [];
  if (cx - blockX < 0.5) faces.push('nx');
  if (cx - blockX > -0.5) faces.push('px');
  if (cz - blockZ < 0.5) faces.push('nz');
  if (cz - blockZ > -0.5) faces.push('pz');
  const frame = (face) => {
    // 面的局部坐标:s 沿面(从左到右), t 向外, 返回转换函数
    if (face === 'pz') return { o: [bx0, bz1], sd: [1, 0], td: [0, 1], len: base.w };
    if (face === 'nz') return { o: [bx1, bz0], sd: [-1, 0], td: [0, -1], len: base.w };
    if (face === 'px') return { o: [bx1, bz1], sd: [0, -1], td: [1, 0], len: base.d };
    return { o: [bx0, bz0], sd: [0, 1], td: [-1, 0], len: base.d };
  };
  const lbox = (F, bk, s0, s1, t0, t1, y0, y1, uvf = tUV) => {
    const xa = F.o[0] + F.sd[0] * s0 + F.td[0] * t0, xb = F.o[0] + F.sd[0] * s1 + F.td[0] * t1;
    const za = F.o[1] + F.sd[1] * s0 + F.td[1] * t0, zb = F.o[1] + F.sd[1] * s1 + F.td[1] * t1;
    bk.box(Math.min(xa, xb), y0, Math.min(za, zb), Math.max(xa, xb), y1, Math.max(za, zb), uvf);
  };

  if (styleName === 'brick' && H < 80 && rng() < 0.75 && faces.length) {
    const F = frame(faces[Math.floor(rng() * faces.length)]);
    const W = 4.8, s0 = F.len / 2 - W / 2, s1 = s0 + W, out = 1.3;
    const mb = bucket('metalDark');
    const floorsN = Math.floor((base.top - 5) / st.floorH);
    for (let f = 1; f < floorsN; f++) {
      const y = f * st.floorH + 0.9;
      lbox(F, mb, s0, s1, 0, out, y, y + 0.07);
      lbox(F, mb, s0, s1, out - 0.05, out, y + 1.0, y + 1.06);
      lbox(F, mb, s0, s1, out - 0.05, out, y + 0.5, y + 0.54);
      lbox(F, mb, s0, s0 + 0.05, 0, out, y + 1.0, y + 1.06);
      lbox(F, mb, s1 - 0.05, s1, 0, out, y + 1.0, y + 1.06);
      for (let k = 0; k <= 4; k++) {
        const s = s0 + (W - 0.05) * k / 4;
        lbox(F, mb, s, s + 0.05, out - 0.05, out, y, y + 1.06);
      }
      // 斜梯(连到上一层)
      if (f < floorsN - 1) {
        const dir = f % 2 ? 1 : -1;
        const sa = dir > 0 ? s0 + 0.6 : s1 - 0.6, sb = dir > 0 ? s1 - 1.0 : s0 + 1.0;
        const ya = y, yb = y + st.floorH;
        const sm = (sa + sb) / 2, ym = (ya + yb) / 2, tm = out * 0.55;
        const len = Math.hypot(sb - sa, yb - ya);
        const ang = Math.atan2(yb - ya, sb - sa);
        const wx = F.o[0] + F.sd[0] * sm + F.td[0] * tm, wz = F.o[1] + F.sd[1] * sm + F.td[1] * tm;
        const ry = Math.atan2(-F.sd[1], F.sd[0]);
        _q.setFromEuler(_e.set(0, ry, ang, 'YXZ'));
        _m.compose(_p.set(wx, ym, wz), _q, _s.set(len, 0.06, 0.65));
        mb.geometry(G.box, _m);
      }
    }
  }
  if (st.store) {
    for (const fc of faces) {
      const F = frame(fc);
      const n = Math.floor(F.len / 6);
      for (let i = 0; i < n; i++) {
        if (rng() > 0.45) continue;
        const s = (i + 0.5) * (F.len / n);
        const hue = rng();
        const col = new THREE.Color().setHSL(hue, 0.55, 0.32);
        const ry = Math.atan2(-F.sd[1], F.sd[0]);
        const wx = F.o[0] + F.sd[0] * s + F.td[0] * 0.75, wz = F.o[1] + F.sd[1] * s + F.td[1] * 0.75;
        // 雨篷:沿面方向为 x,向外为 z,倾斜
        _q.setFromEuler(_e.set(0.38, ry, 0, 'YXZ'));
        // 向外方向 = td,倾斜后外沿更低
        const g = new THREE.BoxGeometry(Math.min(5, F.len / n - 0.6), 0.08, 1.6);
        const tilt = new THREE.Matrix4().makeRotationX(0.38);
        const face = new THREE.Matrix4().makeRotationY(Math.atan2(F.td[0], F.td[1]));
        const m = new THREE.Matrix4().makeTranslation(wx, 3.6, wz).multiply(face).multiply(tilt);
        bucket('awning').geometry(g, m, [col.r, col.g, col.b]);
      }
      // 霓虹竖招牌
      if (rng() < 0.3 && (styleName === 'brick' || styleName === 'stone')) {
        const slot = Math.floor(rng() * ctx.neonCount);
        const nUV = (face, a, y, fw, fh) => {
          if (fw < 0.5) return [(slot + 0.02) / ctx.neonCount, 0.01];
          return [(slot + a / fw) / ctx.neonCount, (y - 5.5) / 3.4];
        };
        const s = rng() < 0.5 ? 1.2 : F.len - 1.2;
        const xa = F.o[0] + F.sd[0] * s, za = F.o[1] + F.sd[1] * s;
        const xo = F.td[0], zo = F.td[1];
        const x0 = Math.min(xa - 0.12 * Math.abs(F.sd[0]), xa + xo * 1.2), x1 = Math.max(xa + 0.12 * Math.abs(F.sd[0]), xa + xo * 1.2);
        const z0 = Math.min(za - 0.12 * Math.abs(F.sd[1]), za + zo * 1.2), z1 = Math.max(za + 0.12 * Math.abs(F.sd[1]), za + zo * 1.2);
        bucket('neon').box(x0, 5.5, z0, x1, 8.9, z1, nUV, 'px nx pz nz');
      }
    }
  }

  return { cx, cz, w: base.w, d: base.d, h: H, style: styleName, top: T.top };
}

function addWaterTower(B, bcx, bcz, x, y, z, rng, addCollider) {
  const R = 2.2, legH = 3.2, tankH = 4.4;
  const mb = B.get('metalDark', bcx, bcz);
  for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    mb.geometry(G.cyl8, mat4(x + lx * 1.5, y + legH / 2, z + lz * 1.5, 0, 0, 0, 0.13, legH, 0.13));
  }
  // 交叉支撑
  for (const [ax, az, ry] of [[0, -1.5, 0], [0, 1.5, 0], [-1.5, 0, Math.PI / 2], [1.5, 0, Math.PI / 2]]) {
    for (const s of [-1, 1]) {
      mb.geometry(G.box, mat4(x + ax, y + legH / 2, z + az, 0, ry, s * 0.82, 3.9, 0.07, 0.07));
    }
  }
  mb.geometry(G.cyl16, mat4(x, y + legH, z, 0, 0, 0, R + 0.35, 0.18, R + 0.35));
  B.get('wood', bcx, bcz).geometry(G.tank, mat4(x, y + legH + tankH / 2, z, 0, rng() * 6, 0, R, tankH, R));
  B.get('metal', bcx, bcz).geometry(G.cone, mat4(x, y + legH + tankH + 0.7, z, 0, 0, 0, R + 0.2, 1.4, R + 0.2));
  mb.geometry(G.sphere, mat4(x, y + legH + tankH + 1.5, z, 0, 0, 0, 0.18, 0.25, 0.18));
  // 梯子
  mb.box(x + R - 0.05, y, z - 0.25, x + R + 0.05, y + legH + tankH, z - 0.2, worldUV(1));
  mb.box(x + R - 0.05, y, z + 0.2, x + R + 0.05, y + legH + tankH, z + 0.25, worldUV(1));
  addCollider(x - R, 0, z - R, x + R, y + legH + tankH + 1.2, z + R, 'roofprop');
}

// ================= 中央广场:喷泉 + 钢制地球仪 =================
function buildPlaza(scene, B, M, cx, cz, addCollider) {
  const size = SW_HALF * 2;
  const plazaMat = makePlazaMaterial(size);
  const geo = new THREE.BoxGeometry(size, CURB, size);
  const plaza = new THREE.Mesh(geo, [M.sidewalk, M.sidewalk, plazaMat, M.sidewalk, M.sidewalk, M.sidewalk]);
  plaza.position.set(cx, CURB / 2, cz);
  plaza.receiveShadow = true;
  scene.add(plaza);

  // 喷泉池(车削)
  const prof = [
    [0, 0.2], [6.2, 0.2], [6.2, 0.75], [6.7, 0.8], [7.1, 0.75], [7.1, 0.18],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const basin = new THREE.Mesh(new THREE.LatheGeometry(prof, 64), M.trim);
  basin.position.set(cx, CURB - 0.02, cz);
  basin.castShadow = basin.receiveShadow = true;
  scene.add(basin);
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x1f3a4a, roughness: 0.05, metalness: 0.8, transparent: true, opacity: 0.9,
  });
  const w = new THREE.Mesh(new THREE.CircleGeometry(6.2, 48), waterMat);
  w.rotation.x = -Math.PI / 2;
  w.position.set(cx, CURB + 0.6, cz);
  scene.add(w);
  // 基座
  const ped = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.6, 3.4, 24), M.trim);
  ped.position.set(cx, CURB + 1.9, cz);
  ped.castShadow = true;
  scene.add(ped);
  // 地球仪
  const globe = new THREE.Group();
  const ringGeo = new THREE.TorusGeometry(3.4, 0.07, 6, 64);
  for (let i = 0; i < 8; i++) {
    const r = new THREE.Mesh(ringGeo, M.steel);
    r.rotation.y = (i / 8) * Math.PI;
    globe.add(r);
  }
  for (const lat of [-0.6, -0.3, 0, 0.3, 0.6]) {
    const rr = Math.cos(lat) * 3.4;
    const r = new THREE.Mesh(new THREE.TorusGeometry(rr, 0.06, 6, 64), M.steel);
    r.rotation.x = Math.PI / 2;
    r.position.y = Math.sin(lat) * 3.4;
    globe.add(r);
  }
  // 大陆板块(弯曲面片)
  const contMat = new THREE.MeshStandardMaterial({ color: 0x9aa4ad, roughness: 0.35, metalness: 0.9, side: THREE.DoubleSide });
  for (const [phi, th, dp, dt] of [[0.3, 0.9, 0.9, 0.7], [2.2, 1.2, 0.8, 0.9], [3.8, 0.8, 1.2, 0.6], [4.9, 1.6, 0.6, 0.8]]) {
    const g = new THREE.SphereGeometry(3.36, 12, 8, phi, dp, th, dt);
    globe.add(new THREE.Mesh(g, contMat));
  }
  globe.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  globe.position.set(cx, CURB + 3.6 + 3.4, cz);
  globe.rotation.z = 0.4;
  scene.add(globe);
  addCollider(cx - 7.1, 0, cz - 7.1, cx + 7.1, CURB + 0.78, cz + 7.1, 'fountain');
  addCollider(cx - 1.4, 0, cz - 1.4, cx + 1.4, CURB + 3.6, cz + 1.4, 'fountain');
}

// ================= 远景天际线 =================
function buildSkyline(scene, rng, M) {
  const n = 420;
  const mat = new THREE.MeshStandardMaterial({
    map: M.modern.map.clone(), emissiveMap: M.brickTan.emissiveMap.clone(),
    emissive: 0xffffff, emissiveIntensity: 1.1, color: 0x6a6878, roughness: 0.9,
  });
  mat.map.repeat.set(2, 5); mat.emissiveMap.repeat.set(3, 6);
  mat.map.needsUpdate = mat.emissiveMap.needsUpdate = true;
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const im = new THREE.InstancedMesh(geo, mat, n);
  const m = new THREE.Matrix4();
  let k = 0;
  for (let i = 0; i < n * 3 && k < n; i++) {
    const a = rng() * Math.PI * 2;
    const r = 620 + rng() * 900;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    // 桥梁通道留空
    if (x > 300 && Math.abs(z + 207) < 60) continue;
    const cluster = Math.pow(0.5 + 0.5 * Math.sin(a * 3 + 1), 2);
    const h = 20 + rng() * 60 + cluster * rng() * 200;
    const wd = 18 + rng() * 34;
    m.compose(new THREE.Vector3(x, WATER_Y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rng() * Math.PI, 0)),
      new THREE.Vector3(wd, h, 18 + rng() * 34));
    im.setMatrixAt(k++, m);
  }
  im.count = k;
  scene.add(im);
}

// ================= 悬索桥 =================
function buildBridge(scene, B, M) {
  const z = -207, deckY = 32, x0 = SHORE, x1 = 1500;
  const tUV = worldUV(1 / 6);
  const g = new BucketSet();
  const deck = g.get('trimDark');
  deck.box(x0, deckY - 2.5, z - 11, x1, deckY, z + 11, tUV);
  const rail = g.get('metalDark');
  rail.box(x0, deckY, z - 11, x1, deckY + 1.2, z - 10.6, tUV);
  rail.box(x0, deckY, z + 10.6, x1, deckY + 1.2, z + 11, tUV);
  // 引桥斜坡
  const ramp = g.get('trimDark');
  _q.setFromEuler(_e.set(0, 0, Math.atan2(deckY, 120)));
  _m.compose(_p.set(x0 - 60 + 2, deckY / 2 - 1.2, z), _q, _s.set(Math.hypot(120, deckY), 2.4, 20));
  ramp.geometry(G.box, _m);
  const towers = [620, 1080];
  const TH = 125;
  for (const tx of towers) {
    const tb = g.get('trim');
    const U = worldUV(1 / 5);
    for (const pz of [-13, 0, 13]) tb.box(tx - 7, WATER_Y - 2, z + pz - 3.5, tx + 7, TH - 22, z + pz + 3.5, U);
    tb.box(tx - 7.5, TH - 22, z - 17, tx + 7.5, TH, z + 17, U);
    tb.box(tx - 8, TH, z - 17.5, tx + 8, TH + 2, z + 17.5, U);
    tb.box(tx - 8.5, WATER_Y - 2, z - 18, tx + 8.5, 6, z + 18, U);
    // 尖拱顶部
    for (const pz of [-6.5, 6.5]) {
      _q.setFromEuler(_e.set(Math.PI / 4, 0, 0));
      _m.compose(_p.set(tx, TH - 22, z + pz), _q, _s.set(14, 4.6, 4.6));
      tb.geometry(G.box, _m);
    }
    for (const pz of [-13, 13]) g.get('lightWarm').box(tx - 0.4, deckY + 4, z + pz - 3.6, tx + 0.4, deckY + 4.6, z + pz - 3.5, tUV);
  }
  // 桥面灯
  const lights = g.get('lightWarm');
  for (let x = x0 + 6; x < x1; x += 14) {
    lights.box(x - 0.25, deckY + 1.2, z - 10.9, x + 0.25, deckY + 1.6, z - 10.5, tUV);
    lights.box(x - 0.25, deckY + 1.2, z + 10.5, x + 0.25, deckY + 1.6, z + 10.9, tUV);
  }
  g.addTo(scene, M);

  // 主缆(悬链线)+ 吊索
  const cableMat = new THREE.MeshStandardMaterial({ color: 0x8a8f99, roughness: 0.4, metalness: 0.8 });
  const segPts = [];
  const catenary = (xa, ya, xb, yb, sag) => {
    const pts = [];
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      pts.push([xa + (xb - xa) * t, ya + (yb - ya) * t - sag * 4 * t * (1 - t)]);
    }
    return pts;
  };
  const spans = [
    catenary(x0 + 10, deckY + 2, towers[0], TH + 1, 18),
    catenary(towers[0], TH + 1, towers[1], TH + 1, 82),
    catenary(towers[1], TH + 1, x1, deckY + 30, 30),
  ];
  const lineVerts = [];
  for (const pz of [-13, 13]) {
    for (const sp of spans) {
      const curve = new THREE.CatmullRomCurve3(sp.map(([x, y]) => new THREE.Vector3(x, y, z + pz)));
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 60, 0.55, 6), cableMat);
      scene.add(tube);
      for (let i = 1; i < sp.length - 1; i++) {
        const [x, y] = sp[i];
        if (y - deckY > 2) lineVerts.push(x, y, z + pz, x, deckY, z + pz);
      }
      segPts.push(sp);
    }
  }
  // 斜拉索(布鲁克林桥风格)
  for (const tx of towers) {
    for (const pz of [-13, 13]) {
      for (let k = 1; k <= 12; k++) {
        for (const s of [-1, 1]) lineVerts.push(tx, TH - 25, z + pz, tx + s * k * 9, deckY, z + pz);
      }
    }
  }
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(lineVerts, 3));
  scene.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x9aa0aa, transparent: true, opacity: 0.55 })));
}
