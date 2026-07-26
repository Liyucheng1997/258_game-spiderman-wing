// 程序化城市:黄昏曼哈顿风格。楼群 + 霓虹窗光 + 街道 + 公园 + 天空 + 云
import * as THREE from 'three';

export const BLOCK = 46;        // 一个街区(含街道)的间距
export const STREET = 18;       // 街道宽度
export const GRID = 13;         // 街区数(奇数,中心为出生广场)
export const CITY_HALF = (GRID * BLOCK) / 2;

// ---------- 天空:大球体 + 渐变着色器 ----------
function createSky(scene) {
  const geo = new THREE.SphereGeometry(1600, 32, 20);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color(0x0b1a3d) },
      midColor: { value: new THREE.Color(0x5a3a7a) },
      lowColor: { value: new THREE.Color(0xff7a3c) },
      sunDir: { value: new THREE.Vector3(0.35, 0.18, -0.9).normalize() },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 topColor; uniform vec3 midColor; uniform vec3 lowColor;
      uniform vec3 sunDir;
      varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y, -0.1, 1.0);
        vec3 col = mix(lowColor, midColor, smoothstep(0.0, 0.22, h));
        col = mix(col, topColor, smoothstep(0.18, 0.65, h));
        float sunAmt = pow(max(dot(normalize(vDir), sunDir), 0.0), 48.0);
        col += vec3(1.0, 0.75, 0.45) * sunAmt * 1.4;
        float glow = pow(max(dot(normalize(vDir), sunDir), 0.0), 6.0);
        col += vec3(0.9, 0.4, 0.15) * glow * 0.35;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(geo, mat);
  scene.add(sky);

  // 太阳本体(泛光后会发亮)
  const sunGeo = new THREE.SphereGeometry(38, 24, 16);
  const sunMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
  const sun = new THREE.Mesh(sunGeo, sunMat);
  sun.position.set(490, 260, -1260);
  scene.add(sun);
  return sky;
}

// ---------- 建筑窗户纹理(canvas 生成,几种变体共享) ----------
function makeBuildingTexture(hueShift, litRatio) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const g = c.getContext('2d');
  // 墙体底色
  const wall = `hsl(${222 + hueShift}, 18%, ${10 + Math.random() * 5}%)`;
  g.fillStyle = wall;
  g.fillRect(0, 0, 128, 256);
  // 窗户网格 8 列 x 20 行
  const cols = 8, rows = 20;
  const cw = 128 / cols, ch = 256 / rows;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const lit = Math.random() < litRatio;
      if (lit) {
        const warm = Math.random() < 0.75;
        const l = 55 + Math.random() * 30;
        g.fillStyle = warm
          ? `hsl(${38 + Math.random() * 14}, 90%, ${l}%)`
          : `hsl(${195 + Math.random() * 25}, 85%, ${l}%)`;
      } else {
        g.fillStyle = `hsl(220, 25%, ${5 + Math.random() * 7}%)`;
      }
      g.fillRect(x * cw + 1.5, y * ch + 2, cw - 3, ch - 4);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

// 发光贴图:窗户区域亮,墙体黑
function makeEmissiveTexture(baseTex) {
  const src = baseTex.image;
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const g = c.getContext('2d');
  g.drawImage(src, 0, 0);
  const img = g.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const lum = d[i] * 0.3 + d[i + 1] * 0.6 + d[i + 2] * 0.1;
    if (lum < 90) { d[i] = d[i + 1] = d[i + 2] = 0; }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// ---------- 地面纹理:一个街区瓦片(中间地块 + 四周半条街道) ----------
function makeGroundTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const g = c.getContext('2d');
  const road = STREET / BLOCK * 512;      // 街道占的像素
  const half = road / 2;
  // 人行道底
  g.fillStyle = '#4d525e';
  g.fillRect(0, 0, 512, 512);
  // 地块中心(人行道 + 内部浅色)
  g.fillStyle = '#5c6272';
  g.fillRect(half, half, 512 - road, 512 - road);
  g.fillStyle = '#525866';
  g.fillRect(half + 14, half + 14, 512 - road - 28, 512 - road - 28);
  // 街道(边缘十字)
  g.fillStyle = '#31343e';
  g.fillRect(0, 0, 512, half); g.fillRect(0, 512 - half, 512, half);
  g.fillRect(0, 0, half, 512); g.fillRect(512 - half, 0, half, 512);
  // 车道虚线
  g.strokeStyle = '#c8b23c';
  g.lineWidth = 3;
  g.setLineDash([18, 14]);
  g.beginPath();
  g.moveTo(0, 0); g.lineTo(512, 0);
  g.moveTo(0, 512); g.lineTo(512, 512);
  g.moveTo(0, 0); g.lineTo(0, 512);
  g.moveTo(512, 0); g.lineTo(512, 512);
  g.stroke();
  // 斑马线
  g.setLineDash([]);
  g.fillStyle = 'rgba(220,220,220,0.5)';
  for (let i = 0; i < 5; i++) {
    g.fillRect(half + 6 + i * 14, 2, 8, half - 4);
    g.fillRect(half + 6 + i * 14, 512 - half + 2, 8, half - 4);
    g.fillRect(2, half + 6 + i * 14, half - 4, 8);
    g.fillRect(512 - half + 2, half + 6 + i * 14, half - 4, 8);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(GRID, GRID);
  tex.anisotropy = 8;
  return tex;
}

// ---------- 主入口 ----------
export function buildCity(scene) {
  const colliders = [];   // { box: THREE.Box3 }  用于物理与蛛丝射线
  const rng = mulberry32(20260726);

  createSky(scene);

  // 雾:与地平线颜色呼应
  scene.fog = new THREE.Fog(0x3a2545, 120, 900);

  // ---- 光照 ----
  const hemi = new THREE.HemisphereLight(0x8fa3ff, 0x6b5240, 1.25);
  scene.add(hemi);
  const amb = new THREE.AmbientLight(0x3a3550, 0.6);
  scene.add(amb);
  const sun = new THREE.DirectionalLight(0xffb070, 2.4);
  sun.position.set(220, 300, -420);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 50;
  sun.shadow.camera.far = 1200;
  const s = 220;
  sun.shadow.camera.left = -s; sun.shadow.camera.right = s;
  sun.shadow.camera.top = s; sun.shadow.camera.bottom = -s;
  sun.shadow.bias = -0.0006;
  scene.add(sun);
  scene.add(sun.target);
  const fill = new THREE.DirectionalLight(0x4a5aa8, 0.35);
  fill.position.set(-200, 180, 300);
  scene.add(fill);

  // ---- 地面 ----
  const groundSize = GRID * BLOCK + 400;
  const groundMat = new THREE.MeshStandardMaterial({
    map: makeGroundTexture(), roughness: 0.95, metalness: 0.0,
  });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(GRID * BLOCK, GRID * BLOCK), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  // 城市外围的暗色大地
  const outerMat = new THREE.MeshStandardMaterial({ color: 0x1c1f28, roughness: 1 });
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(groundSize * 4, groundSize * 4), outerMat);
  outer.rotation.x = -Math.PI / 2;
  outer.position.y = -0.05;
  scene.add(outer);

  // ---- 建筑材质变体 ----
  const buildingMats = [];
  for (let i = 0; i < 6; i++) {
    const tex = makeBuildingTexture((i - 3) * 10, 0.16 + rng() * 0.22);
    const emis = makeEmissiveTexture(tex);
    buildingMats.push(new THREE.MeshStandardMaterial({
      map: tex, emissiveMap: emis, emissive: new THREE.Color(0xffc890),
      emissiveIntensity: 0.9, roughness: 0.85, metalness: 0.15,
    }));
  }
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x2a2d36, roughness: 0.95 });
  const detailMat = new THREE.MeshStandardMaterial({ color: 0x3d4250, roughness: 0.9 });
  const antennaLightMat = new THREE.MeshBasicMaterial({ color: 0xff3b3b });

  const buildings = new THREE.Group();
  scene.add(buildings);

  const parkBlocks = new Set();
  // 随机挑 6 个公园街区(避开中心)
  while (parkBlocks.size < 6) {
    const gx = Math.floor(rng() * GRID), gz = Math.floor(rng() * GRID);
    const mid = Math.floor(GRID / 2);
    if (Math.abs(gx - mid) <= 1 && Math.abs(gz - mid) <= 1) continue;
    parkBlocks.add(gx + '_' + gz);
  }

  const treeTrunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3226, roughness: 1 });
  const treeLeafMat = new THREE.MeshStandardMaterial({ color: 0x2e5c33, roughness: 0.9 });
  const grassMat = new THREE.MeshStandardMaterial({ color: 0x2c4a2e, roughness: 1 });

  const mid = Math.floor(GRID / 2);
  const rooftops = [];   // 屋顶中心点,用于放置收集品

  for (let gx = 0; gx < GRID; gx++) {
    for (let gz = 0; gz < GRID; gz++) {
      const cx = (gx - mid) * BLOCK;
      const cz = (gz - mid) * BLOCK;
      const isCenter = gx === mid && gz === mid;
      const lot = BLOCK - STREET;   // 地块可用宽度

      if (isCenter) continue;   // 出生广场

      if (parkBlocks.has(gx + '_' + gz)) {
        // 公园:草地 + 树
        const grass = new THREE.Mesh(new THREE.BoxGeometry(lot - 4, 0.35, lot - 4), grassMat);
        grass.position.set(cx, 0.17, cz);
        grass.receiveShadow = true;
        buildings.add(grass);
        const nTrees = 5 + Math.floor(rng() * 4);
        for (let t = 0; t < nTrees; t++) {
          const tx = cx + (rng() - 0.5) * (lot - 12);
          const tz = cz + (rng() - 0.5) * (lot - 12);
          const th = 4 + rng() * 3;
          const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, th, 6), treeTrunkMat);
          trunk.position.set(tx, th / 2, tz);
          trunk.castShadow = true;
          const crown = new THREE.Mesh(new THREE.SphereGeometry(2.2 + rng() * 1.4, 8, 6), treeLeafMat);
          crown.position.set(tx, th + 1.2, tz);
          crown.scale.y = 1.15;
          crown.castShadow = true;
          buildings.add(trunk, crown);
        }
        continue;
      }

      // 距中心越远,楼越有机会更高;混入少量超高楼
      const distFromCenter = Math.max(Math.abs(gx - mid), Math.abs(gz - mid));
      let h = 26 + rng() * 55 + distFromCenter * 6;
      if (rng() < 0.14) h += 60 + rng() * 70;
      h = Math.min(h, 210);

      // 每街区 1-2 栋楼
      const twin = rng() < 0.35;
      const lots = twin
        ? [ { x: cx - lot / 4, z: cz, w: lot / 2 - 3, d: lot - 4 } ,
            { x: cx + lot / 4, z: cz, w: lot / 2 - 3, d: lot - 4 } ]
        : [ { x: cx, z: cz, w: lot - 4 - rng() * 6, d: lot - 4 - rng() * 6 } ];

      for (const L of lots) {
        const bh = twin ? h * (0.75 + rng() * 0.5) : h;
        const mat = buildingMats[Math.floor(rng() * buildingMats.length)].clone();
        mat.map = mat.map.clone();
        mat.emissiveMap = mat.emissiveMap.clone();
        const repX = Math.max(1, Math.round(L.w / 6));
        const repY = Math.max(1, Math.round(bh / 15));
        mat.map.repeat.set(repX, repY);
        mat.emissiveMap.repeat.set(repX, repY);
        mat.map.needsUpdate = true; mat.emissiveMap.needsUpdate = true;

        const geo = new THREE.BoxGeometry(L.w, bh, L.d);
        const b = new THREE.Mesh(geo, [mat, mat, roofMat, roofMat, mat, mat]);
        b.position.set(L.x, bh / 2, L.z);
        b.castShadow = true;
        b.receiveShadow = true;
        buildings.add(b);

        const box = new THREE.Box3(
          new THREE.Vector3(L.x - L.w / 2, 0, L.z - L.d / 2),
          new THREE.Vector3(L.x + L.w / 2, bh, L.z + L.d / 2)
        );
        colliders.push({ box });
        rooftops.push(new THREE.Vector3(L.x, bh, L.z));

        // 楼顶细节:水塔 / 空调箱 / 天线
        if (rng() < 0.4 && L.w > 12) {
          const wt = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.9, 3.4, 10), detailMat);
          wt.position.set(L.x + (rng() - 0.5) * L.w * 0.4, bh + 2.4, L.z + (rng() - 0.5) * L.d * 0.4);
          wt.castShadow = true;
          const legs = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 1.4, 8), roofMat);
          legs.position.copy(wt.position); legs.position.y = bh + 0.7;
          buildings.add(wt, legs);
        }
        if (rng() < 0.6) {
          const ac = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.4, 2.0), detailMat);
          ac.position.set(L.x + (rng() - 0.5) * L.w * 0.5, bh + 0.7, L.z + (rng() - 0.5) * L.d * 0.5);
          ac.castShadow = true;
          buildings.add(ac);
        }
        if (bh > 100) {
          const mastH = 10 + rng() * 8;
          const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.45, mastH, 6), detailMat);
          mast.position.set(L.x, bh + mastH / 2, L.z);
          buildings.add(mast);
          const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 6), antennaLightMat);
          beacon.position.set(L.x, bh + mastH + 0.5, L.z);
          buildings.add(beacon);
        }
      }
    }
  }

  // ---- 出生广场:中央雕塑 + 灯 ----
  const plazaMat = new THREE.MeshStandardMaterial({ color: 0x565c6c, roughness: 0.8 });
  const plaza = new THREE.Mesh(new THREE.CylinderGeometry(9, 10, 1.2, 24), plazaMat);
  plaza.position.set(0, 0.6, 0);
  plaza.receiveShadow = true; plaza.castShadow = true;
  scene.add(plaza);
  const obelisk = new THREE.Mesh(new THREE.ConeGeometry(1.6, 12, 4), plazaMat);
  obelisk.position.set(0, 7, 0);
  obelisk.castShadow = true;
  scene.add(obelisk);
  colliders.push({ box: new THREE.Box3(new THREE.Vector3(-9, 0, -9), new THREE.Vector3(9, 1.2, 9)) });

  // ---- 街灯(发光小球,泛光好看)----
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffd9a8 });
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x222630, roughness: 0.8 });
  const lampGeo = new THREE.SphereGeometry(0.32, 8, 6);
  const poleGeo = new THREE.CylinderGeometry(0.12, 0.16, 7, 6);
  const lamps = new THREE.Group();
  for (let gx = 0; gx <= GRID; gx += 2) {
    for (let gz = 0; gz <= GRID; gz += 2) {
      const x = (gx - mid) * BLOCK - BLOCK / 2 + STREET / 2 - 1.2;
      const z = (gz - mid) * BLOCK - BLOCK / 2 + STREET / 2 - 1.2;
      if (Math.abs(x) > CITY_HALF || Math.abs(z) > CITY_HALF) continue;
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.set(x, 3.5, z);
      const lamp = new THREE.Mesh(lampGeo, lampMat);
      lamp.position.set(x, 7.1, z);
      lamps.add(pole, lamp);
    }
  }
  scene.add(lamps);

  // ---- 云(半透明面片)----
  const cloudTex = makeCloudTexture();
  const cloudMat = new THREE.SpriteMaterial({
    map: cloudTex, transparent: true, opacity: 0.55,
    color: 0xffc8b0, depthWrite: false,
  });
  const clouds = new THREE.Group();
  for (let i = 0; i < 22; i++) {
    const sp = new THREE.Sprite(cloudMat);
    const scale = 120 + rng() * 220;
    sp.scale.set(scale, scale * 0.38, 1);
    sp.position.set((rng() - 0.5) * 2200, 200 + rng() * 220, (rng() - 0.5) * 2200);
    clouds.add(sp);
  }
  scene.add(clouds);

  return { colliders, rooftops, sunLight: sun, clouds };
}

function makeCloudTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const g = c.getContext('2d');
  for (let i = 0; i < 26; i++) {
    const x = 20 + Math.random() * 88;
    const y = 18 + Math.random() * 28;
    const r = 8 + Math.random() * 15;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  return new THREE.CanvasTexture(c);
}

// 可复现随机数
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
