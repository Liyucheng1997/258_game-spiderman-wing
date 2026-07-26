// 蜘蛛侠:暮色摆荡 —— 主游戏逻辑
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { buildCity, CITY_HALF } from './city.js';
import { SpiderMan } from './spiderman.js';
import { GameAudio } from './audio.js';

// ---------------- 基础设置 ----------------
const canvas = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.35;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 3000);
camera.position.set(0, 3, 8);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight), 0.55, 0.5, 0.82);
composer.addPass(bloom);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------- 世界 ----------------
const city = buildCity(scene);
const colliders = city.colliders;

// ---------------- 角色 ----------------
const spidey = new SpiderMan();
scene.add(spidey.root);

// ---------------- 音频 ----------------
const audio = new GameAudio();

// ---------------- 玩家状态 ----------------
const P = {
  pos: new THREE.Vector3(0, 2.2, 14),   // 骨盆位置
  vel: new THREE.Vector3(),
  onGround: false,
  onWall: false,
  jumpsLeft: 2,
  state: 'idle',            // idle run jump fall swing zip
  health: 100,
  lastHurt: -99,
  yaw: Math.PI,             // 模型朝向(初始背对镜头)
  pitch: 0,
  runPhase: 0,
  // 蛛丝
  webAttached: false,
  webAnchor: new THREE.Vector3(),
  webLen: 0,
  // 飞跃
  zipTarget: new THREE.Vector3(),
  zipTime: 0,
};
const SPAWN = P.pos.clone();
const GRAVITY = 34;
const HIP = 0.92;           // 骨盆离脚底
const HEAD = 0.85;          // 骨盆到头顶
const RADIUS = 0.45;

// ---------------- 相机控制 ----------------
const cam = { yaw: 0, pitch: -0.12, dist: 6.5, fov: 72 };
let pointerLocked = false;

// ---------------- 输入 ----------------
const keys = {};
const mouse = { left: false, right: false };
document.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'Space') e.preventDefault();
  if (e.code === 'KeyE') tryZip();
});
document.addEventListener('keyup', (e) => { keys[e.code] = false; });
document.addEventListener('mousemove', (e) => {
  if (!pointerLocked) return;
  cam.yaw -= e.movementX * 0.0023;
  cam.pitch -= e.movementY * 0.0021;
  cam.pitch = Math.max(-1.25, Math.min(0.9, cam.pitch));
});
document.addEventListener('mousedown', (e) => {
  if (!pointerLocked) return;
  if (e.button === 0) { mouse.left = true; tryAttachWeb(); }
  if (e.button === 2) { mouse.right = true; tryZip(); }
});
document.addEventListener('mouseup', (e) => {
  if (e.button === 0) { mouse.left = false; detachWeb(true); }
  if (e.button === 2) mouse.right = false;
});
document.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------------- 菜单 / 指针锁 ----------------
const menu = document.getElementById('menu');
const hud = document.getElementById('hud');
const btnStart = document.getElementById('btn-start');
let started = false;

btnStart.addEventListener('click', () => {
  audio.init(); audio.resume();
  canvas.requestPointerLock();
});
document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === canvas;
  if (pointerLocked) {
    menu.classList.add('hidden');
    hud.classList.add('active');
    started = true;
    audio.resume();
  } else {
    menu.classList.remove('hidden');
    btnStart.textContent = '继 续';
    mouse.left = false; mouse.right = false;
    detachWeb(false);
  }
});

// ---------------- 蛛丝可视化 ----------------
const webMat = new THREE.MeshBasicMaterial({ color: 0xf5f5ef });
const webGeo = new THREE.CylinderGeometry(0.028, 0.028, 1, 5, 1, true);
webGeo.translate(0, 0.5, 0);   // 原点在底端,沿 +Y 延伸
const webLine = new THREE.Mesh(webGeo, webMat);
webLine.visible = false;
scene.add(webLine);
const _handPos = new THREE.Vector3();

function updateWebLine() {
  if (!P.webAttached) { webLine.visible = false; return; }
  webLine.visible = true;
  spidey.getHandWorldPos(_handPos);
  const dir = new THREE.Vector3().subVectors(P.webAnchor, _handPos);
  const len = dir.length();
  webLine.position.copy(_handPos);
  webLine.scale.set(1, len, 1);
  webLine.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
}

// ---------------- 蛛丝物理 ----------------
const _ray = new THREE.Ray();
const _hit = new THREE.Vector3();

// 沿方向找建筑命中点
function raycastBuildings(origin, dir, maxDist) {
  _ray.set(origin, dir);
  let best = null, bestD = maxDist;
  for (const c of colliders) {
    const p = _ray.intersectBox(c.box, _hit);
    if (p) {
      const d = p.distanceTo(origin);
      if (d < bestD) { bestD = d; best = p.clone(); }
    }
  }
  return best;
}

function tryAttachWeb() {
  if (P.webAttached || P.state === 'zip') return;
  // 从相机朝向、抬高一定角度找锚点
  const camDir = new THREE.Vector3();
  camera.getWorldDirection(camDir);
  const flat = new THREE.Vector3(camDir.x, 0, camDir.z).normalize();
  let anchor = null;
  // 依次尝试几个仰角
  for (const up of [0.9, 0.65, 1.3, 0.4]) {
    const dir = flat.clone().multiplyScalar(1).add(new THREE.Vector3(0, up, 0)).normalize();
    const hit = raycastBuildings(P.pos, dir, 110);
    if (hit && hit.y > P.pos.y + 3) { anchor = hit; break; }
  }
  if (!anchor) {
    // 天钩:保证在开阔地也能荡起来
    anchor = P.pos.clone()
      .add(flat.multiplyScalar(24))
      .add(new THREE.Vector3(0, 34 + Math.min(20, P.vel.length() * 0.4), 0));
  }
  P.webAttached = true;
  P.webAnchor.copy(anchor);
  P.webLen = Math.max(7, P.pos.distanceTo(anchor) * 0.96);
  audio.thwip();
}

function detachWeb(withBoost) {
  if (!P.webAttached) return;
  P.webAttached = false;
  if (withBoost && P.vel.length() > 8) {
    // 脱手时给一点向上+前向加成,飞跃感
    P.vel.y += 3.5;
    const f = new THREE.Vector3(P.vel.x, 0, P.vel.z).normalize().multiplyScalar(2.5);
    P.vel.add(f);
  }
}

// ---------------- 蛛丝飞跃(zip) ----------------
function tryZip() {
  if (!started || P.state === 'zip') return;
  const camDir = new THREE.Vector3();
  camera.getWorldDirection(camDir);
  // 优先瞄准无人机
  let target = null;
  let bestDot = 0.94;
  for (const d of drones) {
    if (d.dead) continue;
    const to = new THREE.Vector3().subVectors(d.mesh.position, camera.position);
    const dist = to.length();
    if (dist > 90) continue;
    to.normalize();
    const dot = to.dot(camDir);
    if (dot > bestDot) { bestDot = dot; target = d.mesh.position.clone(); }
  }
  if (!target) {
    const hit = raycastBuildings(camera.position, camDir, 95);
    if (hit) target = hit;
  }
  if (!target) return;
  detachWeb(false);
  P.state = 'zip';
  P.zipTarget.copy(target);
  P.zipTime = 0;
  audio.zip();
}

// 判断点是否在建筑内(含外扩边距)
function insideBuilding(pos, margin = 1.5) {
  for (const c of colliders) {
    const b = c.box;
    if (pos.x > b.min.x - margin && pos.x < b.max.x + margin &&
        pos.z > b.min.z - margin && pos.z < b.max.z + margin &&
        pos.y > b.min.y - margin && pos.y < b.max.y + margin) return true;
  }
  return false;
}

// 生成一个不在建筑内的随机空中点
function freeAirPoint(minY, maxY, spread) {
  const p = new THREE.Vector3();
  for (let i = 0; i < 30; i++) {
    p.set((Math.random() - 0.5) * spread, minY + Math.random() * (maxY - minY),
          (Math.random() - 0.5) * spread);
    if (!insideBuilding(p, 2)) return p.clone();
  }
  p.y = 220;   // 兜底:放到所有楼之上
  return p.clone();
}

// ---------------- 无人机 ----------------
function makeDroneMesh() {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x30343e, roughness: 0.4, metalness: 0.7 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.7, 14, 10), bodyMat);
  body.scale.y = 0.65;
  body.castShadow = true;
  g.add(body);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.1, 8, 24), bodyMat);
  ring.rotation.x = Math.PI / 2;
  g.add(ring);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xff2020 }));
  eye.position.set(0, 0, 0.62);
  g.add(eye);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const rotor = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.05, 10),
      new THREE.MeshStandardMaterial({ color: 0x666c7a, roughness: 0.3, metalness: 0.8,
        transparent: true, opacity: 0.7 }));
    rotor.position.set(Math.cos(a) * 1.05, 0.12, Math.sin(a) * 1.05);
    g.add(rotor);
  }
  return g;
}

const DRONE_COUNT = 12;
const drones = [];
{
  for (let i = 0; i < DRONE_COUNT; i++) {
    const mesh = makeDroneMesh();
    const pos = freeAirPoint(18, 60, CITY_HALF * 1.5);
    if (Math.hypot(pos.x, pos.z) < 30) { pos.x += 60; }
    mesh.position.copy(pos);
    scene.add(mesh);
    drones.push({
      mesh, dead: false, home: pos.clone(),
      wander: new THREE.Vector3(), wanderT: 0, phase: Math.random() * 10,
    });
  }
}

function updateDrones(dt, t) {
  for (const d of drones) {
    if (d.dead) continue;
    const m = d.mesh;
    const toPlayer = new THREE.Vector3().subVectors(P.pos, m.position);
    const dist = toPlayer.length();
    if (dist < 45) {
      // 追击
      toPlayer.normalize();
      m.position.addScaledVector(toPlayer, dt * 9);
      m.lookAt(P.pos);
    } else {
      // 徘徊
      d.wanderT -= dt;
      if (d.wanderT <= 0) {
        d.wanderT = 2 + Math.random() * 3;
        d.wander.set((Math.random() - 0.5), (Math.random() - 0.5) * 0.4, (Math.random() - 0.5))
          .normalize().multiplyScalar(4);
      }
      m.position.addScaledVector(d.wander, dt);
      const back = new THREE.Vector3().subVectors(d.home, m.position);
      if (back.length() > 25) m.position.addScaledVector(back.normalize(), dt * 3);
    }
    m.position.y += Math.sin(t * 2 + d.phase) * dt * 1.2;
    if (m.position.y < 6) m.position.y = 6;

    // 碰撞判定
    if (dist < 2.0) {
      const speed = P.vel.length();
      if (speed > 17 || P.state === 'zip') {
        destroyDrone(d);
        addScore(250, m.position);
        P.vel.multiplyScalar(0.75);
        P.vel.y += 4;
      } else {
        hurtPlayer(12, toPlayer);
      }
    }
  }
}

function destroyDrone(d) {
  d.dead = true;
  scene.remove(d.mesh);
  spawnExplosion(d.mesh.position);
  audio.boom();
  game.dronesDown++;
  updateObjective();
  checkVictory();
}

// ---------------- 收集品:蛛网令牌 ----------------
const tokens = [];
{
  const tokenGeo = new THREE.OctahedronGeometry(0.85, 0);
  const tokenMat = new THREE.MeshStandardMaterial({
    color: 0xffc23c, emissive: 0xff9a00, emissiveIntensity: 0.9,
    roughness: 0.3, metalness: 0.6,
  });
  const ringGeo = new THREE.TorusGeometry(1.25, 0.07, 8, 26);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8 });
  const positions = [];
  // 一半放屋顶上空
  const roofs = [...city.rooftops].sort(() => Math.random() - 0.5).slice(0, 20);
  for (const r of roofs) positions.push(new THREE.Vector3(r.x, r.y + 4.5, r.z));
  // 一半放街道上空弧线(适合摆荡穿过)
  for (let i = 0; i < 20; i++) {
    positions.push(freeAirPoint(9, 31, CITY_HALF * 1.6));
  }
  for (const pos of positions) {
    const g = new THREE.Group();
    const core = new THREE.Mesh(tokenGeo, tokenMat);
    const ring = new THREE.Mesh(ringGeo, ringMat);
    g.add(core, ring);
    g.position.copy(pos);
    scene.add(g);
    tokens.push({ mesh: g, core, ring, taken: false, phase: Math.random() * 10 });
  }
}

function updateTokens(dt, t) {
  for (const tk of tokens) {
    if (tk.taken) continue;
    tk.core.rotation.y = t * 2 + tk.phase;
    tk.ring.rotation.y = -t * 1.2 + tk.phase;
    tk.ring.rotation.x = Math.sin(t + tk.phase) * 0.4;
    tk.mesh.position.y += Math.sin(t * 2.2 + tk.phase) * dt * 0.5;
    if (P.pos.distanceToSquared(tk.mesh.position) < 3.6 * 3.6) {
      tk.taken = true;
      scene.remove(tk.mesh);
      game.tokensGot++;
      addScore(100, tk.mesh.position);
      audio.ding(game.combo);
      spawnSparkle(tk.mesh.position);
      updateObjective();
      checkVictory();
    }
  }
}

// ---------------- 粒子(爆炸 / 收集闪光 / 落地灰尘) ----------------
const particles = [];
const partGeo = new THREE.SphereGeometry(0.14, 6, 5);
function spawnBurst(pos, color, count, speed, life, gravity) {
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true });
  for (let i = 0; i < count; i++) {
    const m = new THREE.Mesh(partGeo, mat.clone());
    m.position.copy(pos);
    const v = new THREE.Vector3(
      Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5)
      .normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.8));
    scene.add(m);
    particles.push({ m, v, life: life * (0.6 + Math.random() * 0.6), max: life, gravity });
  }
}
const spawnExplosion = (p) => {
  spawnBurst(p, 0xff7a20, 22, 14, 0.9, 12);
  spawnBurst(p, 0xffd040, 12, 9, 0.7, 6);
};
const spawnSparkle = (p) => spawnBurst(p, 0xffe37a, 14, 6, 0.6, 2);
const spawnDust = (p) => spawnBurst(p, 0x8a8f99, 10, 3.5, 0.5, 1);

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) { scene.remove(p.m); particles.splice(i, 1); continue; }
    p.v.y -= p.gravity * dt;
    p.m.position.addScaledVector(p.v, dt);
    p.m.material.opacity = Math.min(1, p.life / (p.max * 0.5));
    const s = 0.5 + p.life / p.max;
    p.m.scale.setScalar(s);
  }
}

// ---------------- 计分 / HUD ----------------
const game = {
  score: 0, combo: 0, comboTimer: 0, tokensGot: 0, dronesDown: 0, won: false,
};
const elScore = document.getElementById('score-line');
const elCombo = document.getElementById('combo-line');
const elObjective = document.getElementById('objective-line');
const elHealth = document.getElementById('healthbar');
const elSpeed = document.getElementById('speed-num');
const elState = document.getElementById('state-line');
const elMsg = document.getElementById('message-center');
const elVignette = document.getElementById('damage-vignette');
const elCrosshair = document.getElementById('crosshair');

let msgTimer = null;
function showMessage(text, dur = 2200) {
  elMsg.textContent = text;
  elMsg.classList.add('show');
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => elMsg.classList.remove('show'), dur);
}

function addScore(base, _pos) {
  game.combo++;
  game.comboTimer = 5;
  const mult = 1 + Math.min(game.combo - 1, 8) * 0.25;
  const pts = Math.round(base * mult);
  game.score += pts;
  elScore.textContent = `分数 ${game.score}`;
  elCombo.textContent = game.combo > 1 ? `连击 x${game.combo}  (+${pts})` : `+${pts}`;
}

function updateObjective() {
  elObjective.textContent =
    `收集蛛网令牌 ${game.tokensGot}/${tokens.length} · 击落无人机 ${game.dronesDown}/${DRONE_COUNT}`;
}

function checkVictory() {
  if (game.won) return;
  if (game.tokensGot >= tokens.length && game.dronesDown >= DRONE_COUNT) {
    game.won = true;
    game.score += 5000;
    elScore.textContent = `分数 ${game.score}`;
    showMessage('🕸️ 城市英雄!全部目标完成 +5000', 6000);
    audio.victory();
  }
}

function hurtPlayer(dmg, fromDir) {
  const t = clock.elapsedTime;
  if (t - P.lastHurt < 1.0) return;
  P.lastHurt = t;
  P.health -= dmg;
  game.combo = 0; game.comboTimer = 0; elCombo.textContent = '';
  audio.hurt();
  elVignette.style.opacity = '1';
  setTimeout(() => { elVignette.style.opacity = '0'; }, 350);
  // 击退
  P.vel.addScaledVector(fromDir, 10);
  P.vel.y += 5;
  if (P.health <= 0) {
    P.health = 100;
    P.pos.copy(SPAWN);
    P.vel.set(0, 0, 0);
    detachWeb(false);
    P.state = 'fall';
    game.score = Math.max(0, game.score - 200);
    elScore.textContent = `分数 ${game.score}`;
    showMessage('💥 被击倒了…… 回到广场重新出发', 3000);
  }
}

// ---------------- 物理与移动 ----------------
const _camDir = new THREE.Vector3();
const _inputDir = new THREE.Vector3();

function getInputDir() {
  // 相对相机朝向的输入方向(水平)
  _inputDir.set(0, 0, 0);
  const f = new THREE.Vector3(-Math.sin(cam.yaw), 0, -Math.cos(cam.yaw));
  const r = new THREE.Vector3(-f.z, 0, f.x);
  if (keys['KeyW']) _inputDir.add(f);
  if (keys['KeyS']) _inputDir.sub(f);
  if (keys['KeyD']) _inputDir.add(r);
  if (keys['KeyA']) _inputDir.sub(r);
  if (_inputDir.lengthSq() > 0) _inputDir.normalize();
  return _inputDir;
}

function physicsStep(dt, t) {
  const input = getInputDir();
  const sprint = keys['ShiftLeft'] || keys['ShiftRight'];

  // ---- 跳跃 ----
  if (keys['Space'] && !P._spaceHeld) {
    P._spaceHeld = true;
    if (P.onGround) {
      P.vel.y = 14.5;
      P.onGround = false;
      P.jumpsLeft = 1;
      P.state = 'jump';
    } else if (P.jumpsLeft > 0 && !P.webAttached && P.state !== 'zip') {
      P.jumpsLeft--;
      P.vel.y = 13;
      P.state = 'jump';
      spawnDust(P.pos.clone().add(new THREE.Vector3(0, -0.8, 0)));
    }
  }
  if (!keys['Space']) P._spaceHeld = false;

  if (P.state === 'zip') {
    // ---- 蛛丝飞跃:直线冲向目标 ----
    P.zipTime += dt;
    const to = new THREE.Vector3().subVectors(P.zipTarget, P.pos);
    const d = to.length();
    if (d < 2.5 || P.zipTime > 2.2) {
      P.state = 'fall';
      P.vel.multiplyScalar(0.55);
      P.vel.y += 6;   // 到达后向上甩出,方便接摆荡
    } else {
      const speed = Math.min(52, 26 + P.zipTime * 60);
      P.vel.copy(to.normalize().multiplyScalar(speed));
    }
    P.pos.addScaledVector(P.vel, dt);
  } else if (P.webAttached) {
    // ---- 摆荡:钟摆约束 ----
    P.vel.y -= GRAVITY * dt;
    // 泵力:按 W 沿摆荡切线加速
    if (input.lengthSq() > 0) {
      P.vel.addScaledVector(input, 26 * dt);
    }
    // 空气阻力(轻微)
    P.vel.multiplyScalar(1 - 0.06 * dt);
    P.pos.addScaledVector(P.vel, dt);
    // 绳收短(自动收 + 提升摆荡节奏)
    P.webLen = Math.max(7, P.webLen - dt * 2.2);
    const toAnchor = new THREE.Vector3().subVectors(P.pos, P.webAnchor);
    const d = toAnchor.length();
    if (d > P.webLen) {
      toAnchor.normalize();
      P.pos.copy(P.webAnchor).addScaledVector(toAnchor, P.webLen);
      const radial = toAnchor.dot(P.vel);
      if (radial > 0) P.vel.addScaledVector(toAnchor, -radial);
    }
    P.state = 'swing';
    P.onGround = false;
  } else {
    // ---- 常规:地面/空中 ----
    P.vel.y -= GRAVITY * dt;
    if (P.onGround) {
      const targetSpeed = sprint ? 19 : 11.5;
      const desired = input.clone().multiplyScalar(targetSpeed);
      const k = 1 - Math.exp(-12 * dt);
      P.vel.x += (desired.x - P.vel.x) * k;
      P.vel.z += (desired.z - P.vel.z) * k;
      P.state = input.lengthSq() > 0 ? 'run' : 'idle';
      P.runPhase += dt * Math.max(6, Math.hypot(P.vel.x, P.vel.z) * 0.85);
    } else {
      // 空中操控
      P.vel.x += input.x * 16 * dt;
      P.vel.z += input.z * 16 * dt;
      // 水平阻力小
      P.vel.x *= 1 - 0.04 * dt;
      P.vel.z *= 1 - 0.04 * dt;
      if (P.state !== 'jump' || P.vel.y < 0) P.state = P.vel.y < -4 ? 'fall' : P.state;
      if (P.state === 'idle' || P.state === 'run') P.state = 'fall';
    }
    P.pos.addScaledVector(P.vel, dt);
  }

  // 限速
  const sp = P.vel.length();
  if (sp > 58) P.vel.multiplyScalar(58 / sp);

  resolveCollisions(dt);

  // 城市边界(软性推回)
  const LIM = CITY_HALF + 60;
  if (Math.abs(P.pos.x) > LIM) P.vel.x -= Math.sign(P.pos.x) * 40 * dt;
  if (Math.abs(P.pos.z) > LIM) P.vel.z -= Math.sign(P.pos.z) * 40 * dt;

  // 掉出世界保护
  if (P.pos.y < -30) { P.pos.copy(SPAWN); P.vel.set(0, 0, 0); }

  // 生命回复
  if (t - P.lastHurt > 5 && P.health < 100) {
    P.health = Math.min(100, P.health + 5 * dt);
  }

  // 连击窗口
  if (game.comboTimer > 0) {
    game.comboTimer -= dt;
    if (game.comboTimer <= 0) { game.combo = 0; elCombo.textContent = ''; }
  }
}

function resolveCollisions(dt) {
  const wasGround = P.onGround;
  P.onGround = false;
  P.onWall = false;
  const feet = () => P.pos.y - HIP;

  // 地面
  if (feet() <= 0) {
    if (P.vel.y < -16) { audio.thud(-P.vel.y / 25); spawnDust(new THREE.Vector3(P.pos.x, 0.3, P.pos.z)); }
    P.pos.y = HIP;
    if (P.vel.y < 0) P.vel.y = 0;
    P.onGround = true;
  }
  // 出生广场台面
  if (Math.abs(P.pos.x) < 9.5 && Math.abs(P.pos.z) < 9.5 && feet() <= 1.25 && P.vel.y <= 0 && P.pos.y > 1.0) {
    P.pos.y = 1.2 + HIP;
    P.vel.y = 0;
    P.onGround = true;
  }

  for (const c of colliders) {
    const b = c.box;
    // 垂直重叠检查(身体跨度)
    const bodyMin = P.pos.y - HIP + 0.25;   // 留步高
    const bodyMax = P.pos.y + HEAD;
    const inX = P.pos.x > b.min.x - RADIUS && P.pos.x < b.max.x + RADIUS;
    const inZ = P.pos.z > b.min.z - RADIUS && P.pos.z < b.max.z + RADIUS;
    if (!inX || !inZ) continue;

    const inFootprint = P.pos.x > b.min.x && P.pos.x < b.max.x &&
                        P.pos.z > b.min.z && P.pos.z < b.max.z;

    // 楼顶着陆
    if (inFootprint && P.vel.y <= 0 && feet() <= b.max.y && feet() > b.max.y - Math.max(1.4, -P.vel.y * dt + 0.6)) {
      if (P.vel.y < -16) { audio.thud(-P.vel.y / 25); spawnDust(new THREE.Vector3(P.pos.x, b.max.y + 0.3, P.pos.z)); }
      P.pos.y = b.max.y + HIP;
      P.vel.y = 0;
      P.onGround = true;
      continue;
    }
    // 天花板(在楼底下,罕见)
    if (inFootprint && P.vel.y > 0 && bodyMax > b.min.y && bodyMax < b.min.y + 2) {
      P.pos.y = b.min.y - HEAD - 0.02;
      P.vel.y = 0;
      continue;
    }

    // 侧墙推出
    if (bodyMax > b.min.y + 0.1 && bodyMin < b.max.y - 0.1) {
      const pushXPos = b.max.x + RADIUS - P.pos.x;   // 向 +x 推出量
      const pushXNeg = P.pos.x - (b.min.x - RADIUS);
      const pushZPos = b.max.z + RADIUS - P.pos.z;
      const pushZNeg = P.pos.z - (b.min.z - RADIUS);
      const minX = Math.min(pushXPos, pushXNeg);
      const minZ = Math.min(pushZPos, pushZNeg);
      if (minX > 0 && minZ > 0) {
        P.onWall = true;
        P.jumpsLeft = Math.max(P.jumpsLeft, 1);
        if (minX < minZ) {
          P.pos.x += (pushXPos < pushXNeg ? minX : -minX);
          P.vel.x *= -0.1;
        } else {
          P.pos.z += (pushZPos < pushZNeg ? minZ : -minZ);
          P.vel.z *= -0.1;
        }
      }
    }
  }

  if (P.onGround) {
    P.jumpsLeft = 2;
    if (!wasGround && P.state !== 'swing') {
      if (P.state === 'fall' || P.state === 'jump') audio.thud(0.5);
      P.state = 'idle';
    }
  }
}

// ---------------- 角色模型同步 ----------------
const _modelQuat = new THREE.Quaternion();
const _targetQuat = new THREE.Quaternion();
const _euler = new THREE.Euler();

function updateCharacter(dt) {
  spidey.root.position.copy(P.pos);   // root 原点即骨盆

  const hSpeed = Math.hypot(P.vel.x, P.vel.z);
  // 朝向:速度方向或相机方向
  let targetYaw = P.yaw;
  if (hSpeed > 1.2) targetYaw = Math.atan2(P.vel.x, P.vel.z);
  else if (P.state === 'idle') targetYaw = P.yaw;

  // 身体俯仰:空中时顺着速度
  let targetPitch = 0;
  if (P.state === 'swing' || P.state === 'zip' || P.state === 'fall' || P.state === 'jump') {
    targetPitch = Math.atan2(-P.vel.y, Math.max(hSpeed, 4)) * (P.state === 'zip' ? 0.9 : 0.55);
    targetPitch = Math.max(-1.1, Math.min(1.1, targetPitch));
  }

  // 平滑
  const dy = ((targetYaw - P.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  P.yaw += dy * Math.min(1, 10 * dt);
  P.pitch += (targetPitch - P.pitch) * Math.min(1, 8 * dt);

  _euler.set(P.pitch, P.yaw, 0, 'YXZ');
  _targetQuat.setFromEuler(_euler);
  spidey.root.quaternion.copy(_targetQuat);

  // 蛛丝方向(角色局部空间)供手臂瞄准
  let webDirLocal = null;
  if (P.webAttached) {
    const worldDir = new THREE.Vector3().subVectors(P.webAnchor, P.pos).normalize();
    webDirLocal = worldDir.applyQuaternion(spidey.root.quaternion.clone().invert());
  }

  spidey.update(dt, P.state, {
    runPhase: P.runPhase,
    webDirLocal,
  });
}

// ---------------- 相机 ----------------
const _camTarget = new THREE.Vector3();
const _camPos = new THREE.Vector3();

function updateCamera(dt) {
  const speed = P.vel.length();
  const targetDist = 6.2 + Math.min(speed * 0.07, 3.2);
  cam.dist += (targetDist - cam.dist) * Math.min(1, 4 * dt);

  const cp = Math.cos(cam.pitch), spn = Math.sin(cam.pitch);
  const dir = new THREE.Vector3(
    Math.sin(cam.yaw) * cp, -spn, Math.cos(cam.yaw) * cp);
  _camPos.copy(P.pos).add(new THREE.Vector3(0, 1.6, 0)).addScaledVector(dir, cam.dist);
  // 简单防穿地
  if (_camPos.y < 0.6) _camPos.y = 0.6;
  camera.position.lerp(_camPos, Math.min(1, 14 * dt));

  _camTarget.copy(P.pos)
    .add(new THREE.Vector3(0, 1.1, 0))
    .addScaledVector(P.vel, 0.06);
  camera.lookAt(_camTarget);

  // 速度感 FOV
  const targetFov = 72 + Math.min(speed * 0.42, 26);
  cam.fov += (targetFov - cam.fov) * Math.min(1, 5 * dt);
  camera.fov = cam.fov;
  camera.updateProjectionMatrix();

  // 阴影相机跟随
  city.sunLight.position.set(P.pos.x + 220, 300, P.pos.z - 420);
  city.sunLight.target.position.set(P.pos.x, 0, P.pos.z);
}

// ---------------- HUD 刷新 ----------------
function updateHUD() {
  const kmh = Math.round(P.vel.length() * 3.6);
  elSpeed.textContent = kmh;
  elHealth.style.width = Math.max(0, P.health) + '%';
  const stateNames = {
    idle: '', run: '奔跑', jump: '跳跃', fall: '下落',
    swing: '🕸️ 摆荡中', zip: '⚡ 蛛丝飞跃',
  };
  elState.textContent = stateNames[P.state] || '';

  // 准星:瞄到无人机变红
  const camDir = new THREE.Vector3();
  camera.getWorldDirection(camDir);
  let onTarget = false;
  for (const d of drones) {
    if (d.dead) continue;
    const to = new THREE.Vector3().subVectors(d.mesh.position, camera.position);
    if (to.length() < 90 && to.normalize().dot(camDir) > 0.96) { onTarget = true; break; }
  }
  elCrosshair.classList.toggle('target', onTarget);
}

// ---------------- 主循环 ----------------
const clock = new THREE.Clock();
updateObjective();
showMessage('欢迎来到暮色之城!', 1);
elMsg.classList.remove('show');

let firstFrames = 0;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  if (started && pointerLocked) {
    physicsStep(dt, t);
    updateDrones(dt, t);
    updateTokens(dt, t);
  }
  updateCharacter(dt);
  updateCamera(dt);
  updateWebLine();
  updateParticles(dt);
  updateHUD();
  audio.setWind(Math.min(1, P.vel.length() / 45));

  // 云缓慢漂移
  city.clouds.position.x = (t * 1.5) % 400;

  composer.render();

  // 首次进入的提示
  if (started && firstFrames < 2) {
    firstFrames++;
    if (firstFrames === 2) showMessage('按住左键发射蛛丝开始摆荡!', 3200);
  }
}
animate();

// 调试句柄(供开发自检)
window.__game = {
  renderOnce() {
    updateCharacter(1 / 60);
    updateCamera(1 / 60);
    composer.render();
  },
  P, camera, scene, drones, tokens, spidey, cam, physicsStep,
};
