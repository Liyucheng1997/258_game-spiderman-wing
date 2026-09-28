// 蜘蛛侠:暮色摆荡 v2 —— 主游戏逻辑
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildCity, CITY_HALF, SHORE, CURB, BLOCK, SW_HALF } from './city.js';
import { SpiderMan } from './spiderman.js';
import { makeDrone } from './drone.js';
import { GameAudio } from './audio.js';
import { makeCanvas } from './textures.js';

// ---------------- 渲染器 ----------------
const canvas = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 5000);
camera.position.set(0, 3, 22);

const pr = renderer.getPixelRatio();
const rt = new THREE.WebGLRenderTarget(window.innerWidth * pr, window.innerHeight * pr,
  { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.45, 0.55, 0.92);
composer.addPass(bloom);
const fxPass = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, speed: { value: 0 }, damage: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float speed; uniform float damage; varying vec2 vUv;
    void main(){
      vec2 c = vUv - 0.5; float r = length(c);
      float amt = speed * 0.05 * smoothstep(0.12, 0.7, r);
      vec3 col = vec3(0.0);
      for (int i = 0; i < 6; i++) { col += texture2D(tDiffuse, vUv - c * amt * float(i) / 5.0).rgb; }
      col /= 6.0;
      col *= mix(1.0, smoothstep(0.95, 0.3, r), 0.5);
      col = mix(col, col * vec3(1.2, 0.35, 0.35) + vec3(0.25, 0.0, 0.0), damage * smoothstep(0.25, 0.75, r));
      gl_FragColor = vec4(col, 1.0);
    }`,
});
composer.addPass(fxPass);
composer.addPass(new OutputPass());

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------- DOM ----------------
const $ = (id) => document.getElementById(id);
const menu = $('menu'), hud = $('hud'), btnStart = $('btn-start'), loadingLine = $('loading-line');
const elScore = $('score-line'), elCombo = $('combo-line'), elObjective = $('objective-line');
const elHealth = $('healthbar'), elSpeed = $('speed-num'), elState = $('state-line');
const elMsg = $('message-center'), elVignette = $('damage-vignette'), elCrosshair = $('crosshair');
const elRace = $('race-line'), elResults = $('results'), elLock = $('lock');
const mini = $('minimap'), miniCtx = mini.getContext('2d');

const audio = new GameAudio();
const clock = new THREE.Clock();

// ---------------- 全局状态 ----------------
let city, colliders, spidey;
let ready = false, started = false, pointerLocked = false;
const GRAVITY = 34, HIP = 0.92, HEAD = 0.85, RADIUS = 0.45;
const SPAWN = new THREE.Vector3(0, CURB + HIP, 16);
const P = {
  pos: SPAWN.clone(), vel: new THREE.Vector3(), onGround: false, onWall: false,
  wallN: new THREE.Vector3(), wallRunN: new THREE.Vector3(), wallLost: 0, wallCooldown: 0,
  jumpsLeft: 2, state: 'idle', health: 100, lastHurt: -99,
  yaw: Math.PI, pitch: 0, runPhase: 0,
  webAttached: false, webAnchor: new THREE.Vector3(), webLen: 0, webShootT: 0,
  zipTarget: new THREE.Vector3(), zipTime: 0, zipDrone: null,
  landT: 0, flipT: 0, impactVy: 0, airTime: 0,
};
const cam = { yaw: 0, pitch: -0.12, dist: 6.5, fov: 70, shake: 0 };
const game = {
  score: 0, combo: 0, comboTimer: 0, tokensGot: 0, dronesDown: 0, won: false, startTime: 0, tricks: 0,
};

// ---------------- 输入 ----------------
const keys = {};
document.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'Space') e.preventDefault();
  if (!ready || !pointerLocked) return;
  if (e.code === 'KeyE') tryZip();
  if (e.code === 'KeyF') shootWebBall();
  if (e.code === 'KeyR' && race.active) endRace(false);
});
document.addEventListener('keyup', (e) => { keys[e.code] = false; });
document.addEventListener('mousemove', (e) => {
  if (!pointerLocked) return;
  cam.yaw -= e.movementX * 0.0023;
  cam.pitch -= e.movementY * 0.0021;
  cam.pitch = Math.max(-1.25, Math.min(0.95, cam.pitch));
});
document.addEventListener('mousedown', (e) => {
  if (!pointerLocked) return;
  if (e.button === 0) tryAttachWeb();
  if (e.button === 2) tryZip();
  if (e.button === 1) shootWebBall();
});
document.addEventListener('mouseup', (e) => {
  if (e.button === 0) detachWeb(true);
});
document.addEventListener('contextmenu', (e) => e.preventDefault());

btnStart.addEventListener('click', () => {
  if (!ready) return;
  audio.init(); audio.resume();
  canvas.requestPointerLock();
});
document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === canvas;
  if (pointerLocked) {
    menu.classList.add('hidden');
    hud.classList.add('active');
    if (!started) {
      started = true;
      game.startTime = clock.elapsedTime;
      showMessage('按住左键发射蛛丝开始摆荡!', 3200);
    }
    audio.resume();
  } else {
    menu.classList.remove('hidden');
    btnStart.textContent = '继 续';
    detachWeb(false);
  }
});
$('btn-again').addEventListener('click', () => location.reload());

let msgTimer = null;
function showMessage(text, dur = 2200) {
  elMsg.textContent = text;
  elMsg.classList.add('show');
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => elMsg.classList.remove('show'), dur);
}

// ================================================================
//                         初始化(异步,显示进度)
// ================================================================
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
async function init() {
  loadingLine.textContent = '正在生成城市(程序化建模与纹理)…';
  await nextFrame();
  city = buildCity(scene, renderer);
  colliders = city.colliders;
  loadingLine.textContent = '正在缝制战衣…';
  await nextFrame();
  spidey = new SpiderMan();
  scene.add(spidey.root);
  loadingLine.textContent = '正在部署无人机…';
  await nextFrame();
  initWeb();
  initDrones();
  initTokens();
  initRace();
  initMinimap();
  updateObjective();
  // 预热着色器
  renderer.compile(scene, camera);
  ready = true;
  loadingLine.textContent = '';
  btnStart.disabled = false;
  btnStart.textContent = '开始摆荡';
  animate();
}

// ================================================================
//                              工具
// ================================================================
const _ray = new THREE.Ray();
const _hit = new THREE.Vector3();
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
function insideBuilding(pos, margin = 1.5) {
  for (const c of colliders) {
    const b = c.box;
    if (pos.x > b.min.x - margin && pos.x < b.max.x + margin &&
        pos.z > b.min.z - margin && pos.z < b.max.z + margin &&
        pos.y > b.min.y - margin && pos.y < b.max.y + margin) return true;
  }
  return false;
}
function freeAirPoint(minY, maxY, spread, avoid = null) {
  const p = new THREE.Vector3();
  for (let i = 0; i < 60; i++) {
    p.set((Math.random() - 0.5) * spread, minY + Math.random() * (maxY - minY), (Math.random() - 0.5) * spread);
    if (avoid && p.distanceTo(avoid) < 50) continue;
    if (!insideBuilding(p, 3)) return p.clone();
  }
  p.y = 225;
  return p.clone();
}

// ================================================================
//                              蛛丝
// ================================================================
let webLine, webSplat;
const _handPos = new THREE.Vector3();
function makeWebSplatTexture() {
  const c = makeCanvas(128, 128), g = c.getContext('2d');
  g.strokeStyle = 'rgba(245,245,240,0.95)'; g.lineWidth = 3; g.lineCap = 'round';
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + Math.random() * 0.2;
    g.beginPath(); g.moveTo(64, 64); g.lineTo(64 + Math.cos(a) * 60, 64 + Math.sin(a) * 60); g.stroke();
  }
  g.lineWidth = 2;
  for (const r of [14, 28, 44]) {
    g.beginPath();
    for (let i = 0; i <= 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const x = 64 + Math.cos(a) * r, y = 64 + Math.sin(a) * r;
      if (i === 0) g.moveTo(x, y); else g.quadraticCurveTo(64 + Math.cos(a - 0.3) * r * 0.85, 64 + Math.sin(a - 0.3) * r * 0.85, x, y);
    }
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function initWeb() {
  const geo = new THREE.CylinderGeometry(0.022, 0.022, 1, 6, 1, true);
  geo.translate(0, 0.5, 0);
  webLine = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: new THREE.Color(1.3, 1.3, 1.25) }));
  webLine.visible = false;
  webLine.frustumCulled = false;
  scene.add(webLine);
  webSplat = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeWebSplatTexture(), transparent: true, depthWrite: false }));
  webSplat.scale.set(2.4, 2.4, 1);
  webSplat.visible = false;
  scene.add(webSplat);
}
function updateWebLine(dt) {
  if (!P.webAttached) { webLine.visible = false; webSplat.visible = false; return; }
  P.webShootT = Math.min(1, P.webShootT + dt * 9);
  webLine.visible = true;
  spidey.getHandWorldPos(_handPos);
  const dir = new THREE.Vector3().subVectors(P.webAnchor, _handPos);
  const len = dir.length();
  webLine.position.copy(_handPos);
  webLine.scale.set(1, len * P.webShootT, 1);
  webLine.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  webSplat.visible = P.webShootT >= 1;
  webSplat.position.copy(P.webAnchor);
}

function tryAttachWeb() {
  if (P.webAttached || P.state === 'zip' || P.state === 'land') return;
  const camDir = new THREE.Vector3();
  camera.getWorldDirection(camDir);
  const flat = new THREE.Vector3(camDir.x, 0, camDir.z).normalize();
  const vflat = new THREE.Vector3(P.vel.x, 0, P.vel.z);
  if (vflat.length() > 8) flat.lerp(vflat.normalize(), 0.3).normalize();
  const side = new THREE.Vector3(-flat.z, 0, flat.x);
  let anchor = null, bestScore = -1;
  for (const up of [0.95, 0.7, 1.3, 0.5]) {
    for (const s of [0, 0.45, -0.45]) {
      const dir = flat.clone().addScaledVector(side, s).add(new THREE.Vector3(0, up, 0)).normalize();
      const hit = raycastBuildings(P.pos, dir, 120);
      if (!hit || hit.y < P.pos.y + 4) continue;
      const d = hit.distanceTo(P.pos);
      const score = (1 - Math.abs(s)) * 2 + Math.min(d, 60) / 30 - Math.abs(up - 0.9);
      if (score > bestScore) { bestScore = score; anchor = hit; }
    }
    if (anchor) break;
  }
  if (!anchor) {
    anchor = P.pos.clone().add(flat.multiplyScalar(24))
      .add(new THREE.Vector3(0, 34 + Math.min(20, P.vel.length() * 0.4), 0));
  }
  P.webAttached = true;
  P.webShootT = 0;
  P.webAnchor.copy(anchor);
  P.webLen = Math.max(7, P.pos.distanceTo(anchor) * 0.96);
  if (P.state === 'wallrun' || P.onGround) P.vel.y = Math.max(P.vel.y, 6);
  audio.thwip();
}

function detachWeb(withBoost) {
  if (!P.webAttached) return;
  P.webAttached = false;
  if (withBoost && P.vel.length() > 8) {
    P.vel.y += 4;
    const f = new THREE.Vector3(P.vel.x, 0, P.vel.z).normalize().multiplyScalar(3);
    P.vel.add(f);
    if (P.vel.length() > 20 && P.vel.y > 3) triggerFlip();
  }
}

function triggerFlip() {
  if (P.flipT > 0) return;
  P.flipT = 0.62;
  game.tricks++;
  addScore(50, '特技');
  audio.whoosh();
}

// 锁定:准星附近最近的无人机
function findLockTarget(maxDist = 90, minDot = 0.9) {
  const camDir = new THREE.Vector3();
  camera.getWorldDirection(camDir);
  let best = null, bestScore = -1;
  for (const d of drones) {
    if (d.dead) continue;
    const to = new THREE.Vector3().subVectors(d.pos, camera.position);
    const dist = to.length();
    if (dist > maxDist) continue;
    const dot = to.normalize().dot(camDir);
    if (dot < minDot) continue;
    const score = dot - dist / 2000;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

// ---------------- 蛛丝飞跃 ----------------
function tryZip() {
  if (!started || P.state === 'zip' || P.state === 'land') return;
  const camDir = new THREE.Vector3();
  camera.getWorldDirection(camDir);
  const targetDrone = findLockTarget();
  let target = targetDrone ? targetDrone.pos.clone() : null;
  if (!target) {
    const hit = raycastBuildings(camera.position, camDir, 100);
    if (hit) target = hit.addScaledVector(camDir, -1.2);
  }
  if (!target) return;
  detachWeb(false);
  P.state = 'zip';
  P.zipTarget.copy(target);
  P.zipDrone = targetDrone;
  P.zipTime = 0;
  P.webAttached = false;
  audio.zip();
}

// ================================================================
//                           无人机
// ================================================================
const drones = [];
const DRONE_COUNT = 12;
const bolts = [];
const webBalls = [];
let boltGeo, boltMat, cocoonGeo, cocoonMat, webBallGeo, webBallMat;

function initDrones() {
  boltGeo = new THREE.CapsuleGeometry(0.09, 1.4, 4, 8);
  boltGeo.rotateX(Math.PI / 2);
  boltMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.4, 0.2) });
  cocoonGeo = new THREE.IcosahedronGeometry(1.05, 1);
  cocoonMat = new THREE.MeshStandardMaterial({ color: 0xeeeeea, roughness: 0.9, wireframe: true });
  webBallGeo = new THREE.IcosahedronGeometry(0.28, 1);
  webBallMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.6, 1.5) });
  for (let i = 0; i < DRONE_COUNT; i++) {
    const api = makeDrone();
    const pos = freeAirPoint(22, 70, CITY_HALF * 1.6, SPAWN);
    api.group.position.copy(pos);
    const cocoon = new THREE.Mesh(cocoonGeo, cocoonMat);
    cocoon.visible = false;
    api.group.add(cocoon);
    scene.add(api.group);
    drones.push({
      api, pos: api.group.position, vel: new THREE.Vector3(), hp: 3, dead: false,
      home: pos.clone(), wander: new THREE.Vector3(), wanderT: 0, phase: Math.random() * 10,
      stun: 0, fireT: 2 + Math.random() * 2, alerted: false, sees: false, losT: Math.random() * 0.3,
      cocoon, strafe: Math.random() < 0.5 ? 1 : -1,
    });
  }
}

function lineOfSight(a, b) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const d = dir.length();
  const hit = raycastBuildings(a, dir.normalize(), d);
  return !hit;
}

const _to = new THREE.Vector3(), _des = new THREE.Vector3();
function updateDrones(dt, t) {
  for (const d of drones) {
    if (d.dead) continue;
    d.api.animate(dt, t);
    const g = d.api.group;
    _to.subVectors(P.pos, d.pos);
    const dist = _to.length();

    if (d.stun > 0) {
      d.stun -= dt;
      d.pos.y = Math.max(4, d.pos.y - dt * 2.5);
      g.rotation.z = Math.sin(t * 8) * 0.3;
      d.cocoon.visible = true;
      d.api.setAlert(0);
      if (d.stun <= 0) { d.cocoon.visible = false; g.rotation.z = 0; }
    } else {
      d.losT -= dt;
      if (d.losT <= 0) {
        d.losT = 0.3;
        d.sees = dist < 65 && lineOfSight(d.pos, P.pos);
      }
      if (d.sees && started) {
        // 保持 14~18m 距离并绕飞
        const flat = new THREE.Vector3(-_to.x, 0, -_to.z).normalize();
        const side = new THREE.Vector3(-flat.z, 0, flat.x).multiplyScalar(d.strafe);
        _des.copy(P.pos).addScaledVector(flat, 16).addScaledVector(side, 6);
        _des.y = Math.max(P.pos.y + 5, 8);
        const steer = _des.sub(d.pos);
        const sl = steer.length();
        if (sl > 0.1) d.vel.lerp(steer.multiplyScalar(Math.min(12, sl * 1.5) / sl), 1 - Math.exp(-2 * dt));
        g.lookAt(P.pos.x, P.pos.y + 0.5, P.pos.z);
        // 射击
        d.fireT -= dt;
        if (d.fireT < 0.7 && !d.alerted) { d.alerted = true; audio.beep(); }
        d.api.setAlert(d.fireT < 0.7 ? 1 : 0);
        if (d.fireT <= 0) {
          fireBolt(d);
          d.fireT = 2.2 + Math.random() * 1.6;
          d.alerted = false;
          if (Math.random() < 0.3) d.strafe *= -1;
        }
      } else {
        d.api.setAlert(0);
        d.wanderT -= dt;
        if (d.wanderT <= 0) {
          d.wanderT = 2 + Math.random() * 3;
          d.wander.set(Math.random() - 0.5, (Math.random() - 0.5) * 0.3, Math.random() - 0.5).normalize().multiplyScalar(4);
        }
        const back = new THREE.Vector3().subVectors(d.home, d.pos);
        if (back.length() > 25) d.wander.addScaledVector(back.normalize(), dt * 3);
        d.vel.lerp(d.wander, 1 - Math.exp(-1.5 * dt));
        g.rotation.y += dt * 0.3;
      }
      d.pos.addScaledVector(d.vel, dt);
      d.pos.y += Math.sin(t * 2 + d.phase) * dt * 0.6;
      if (insideBuilding(d.pos, 2.5)) { d.pos.y += dt * 12; d.vel.multiplyScalar(0.9); }
      if (d.pos.y < 5) d.pos.y = 5;
    }

    // 与玩家碰撞
    if (dist < 2.3) {
      const speed = P.vel.length();
      if (speed > 17 || P.state === 'zip' || d.stun > 0) {
        destroyDrone(d);
        P.vel.multiplyScalar(0.6);
        P.vel.y = Math.max(P.vel.y, 8);
        if (P.state === 'zip') { P.state = 'fall'; triggerFlip(); }
      } else {
        hurtPlayer(10, _to.clone().normalize());
      }
    }
  }
}

function fireBolt(d) {
  const origin = new THREE.Vector3();
  d.api.muzzle.getWorldPosition(origin);
  const lead = P.pos.clone().addScaledVector(P.vel, origin.distanceTo(P.pos) / 55 * 0.6);
  lead.y += 0.2;
  const dir = lead.sub(origin).normalize();
  dir.x += (Math.random() - 0.5) * 0.04; dir.y += (Math.random() - 0.5) * 0.04;
  dir.normalize();
  const m = new THREE.Mesh(boltGeo, boltMat);
  m.position.copy(origin);
  m.lookAt(origin.clone().add(dir));
  scene.add(m);
  bolts.push({ m, vel: dir.multiplyScalar(55), life: 3 });
  audio.laser();
}

function updateBolts(dt) {
  for (let i = bolts.length - 1; i >= 0; i--) {
    const b = bolts[i];
    b.life -= dt;
    b.m.position.addScaledVector(b.vel, dt);
    const hitPlayer = b.m.position.distanceTo(P.pos) < 1.0 ||
      b.m.position.distanceTo(_v.copy(P.pos).setY(P.pos.y + 0.6)) < 0.9;
    if (hitPlayer) {
      hurtPlayer(12, b.vel.clone().normalize());
      spawnBurst(b.m.position, 0xff4020, 10, 6, 0.4, 4);
    }
    if (hitPlayer || b.life <= 0 || b.m.position.y < 0 || insideBuilding(b.m.position, 0)) {
      if (!hitPlayer && b.life > 0) spawnBurst(b.m.position, 0xff6030, 8, 5, 0.35, 6);
      scene.remove(b.m);
      bolts.splice(i, 1);
    }
  }
}
const _v = new THREE.Vector3();

// ---------------- 蛛网弹 ----------------
let webCooldown = 0;
function shootWebBall() {
  if (webCooldown > 0 || !started) return;
  webCooldown = 0.28;
  const camDir = new THREE.Vector3();
  camera.getWorldDirection(camDir);
  const target = findLockTarget(85);
  const origin = new THREE.Vector3();
  spidey.getLeftHandWorldPos(origin);
  let dir;
  if (target) dir = new THREE.Vector3().subVectors(target.pos, origin).normalize();
  else {
    const aim = camera.position.clone().addScaledVector(camDir, 60);
    dir = aim.sub(origin).normalize();
  }
  const m = new THREE.Mesh(webBallGeo, webBallMat);
  m.position.copy(origin);
  scene.add(m);
  webBalls.push({ m, vel: dir.multiplyScalar(85), life: 1.2, target });
  audio.webShot();
}
function updateWebBalls(dt) {
  if (webCooldown > 0) webCooldown -= dt;
  for (let i = webBalls.length - 1; i >= 0; i--) {
    const w = webBalls[i];
    w.life -= dt;
    if (w.target && !w.target.dead) {
      const want = new THREE.Vector3().subVectors(w.target.pos, w.m.position).normalize().multiplyScalar(85);
      w.vel.lerp(want, 1 - Math.exp(-6 * dt));
    }
    w.m.position.addScaledVector(w.vel, dt);
    w.m.rotation.x += dt * 10;
    let done = w.life <= 0;
    for (const d of drones) {
      if (d.dead || d.pos.distanceTo(w.m.position) > 1.9) continue;
      d.hp--;
      d.stun = 2.6;
      audio.hit();
      spawnBurst(w.m.position, 0xffffff, 12, 5, 0.5, 3);
      if (d.hp <= 0) destroyDrone(d);
      else addScore(25, '命中');
      done = true;
      break;
    }
    if (!done && (insideBuilding(w.m.position, 0) || w.m.position.y < 0.2)) {
      spawnBurst(w.m.position, 0xffffff, 8, 3, 0.4, 2);
      done = true;
    }
    if (done) { scene.remove(w.m); webBalls.splice(i, 1); }
  }
}

function destroyDrone(d) {
  if (d.dead) return;
  d.dead = true;
  scene.remove(d.api.group);
  spawnExplosion(d.pos.clone());
  audio.boom();
  cam.shake = Math.max(cam.shake, 0.5);
  game.dronesDown++;
  addScore(250, '击落无人机');
  updateObjective();
  checkVictory();
}

// ================================================================
//                         收集品:蛛网令牌
// ================================================================
const tokens = [];
function makeTokenTexture() {
  const c = makeCanvas(256, 256), g = c.getContext('2d');
  const gr = g.createRadialGradient(128, 110, 10, 128, 128, 128);
  gr.addColorStop(0, '#fff2b0'); gr.addColorStop(0.6, '#f0b030'); gr.addColorStop(1, '#a86a10');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(90,50,0,0.7)'; g.lineWidth = 3;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.beginPath(); g.moveTo(128, 128); g.lineTo(128 + Math.cos(a) * 128, 128 + Math.sin(a) * 128); g.stroke();
  }
  for (const r of [30, 60, 92]) { g.beginPath(); g.arc(128, 128, r, 0, Math.PI * 2); g.stroke(); }
  // 蜘蛛
  g.fillStyle = '#3a1a00'; g.strokeStyle = '#3a1a00'; g.lineWidth = 7; g.lineCap = 'round';
  g.beginPath(); g.ellipse(128, 104, 12, 14, 0, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.ellipse(128, 146, 17, 30, 0, 0, Math.PI * 2); g.fill();
  for (const s of [-1, 1]) {
    for (const [a, b, c2] of [[[8, -30], [40, -64], [46, -86]], [[12, -18], [56, -34], [80, -30]],
      [[12, 0], [56, 8], [74, 40]], [[8, 12], [36, 44], [40, 82]]]) {
      g.beginPath(); g.moveTo(128 + s * a[0], 120 + a[1]);
      g.quadraticCurveTo(128 + s * b[0], 120 + b[1], 128 + s * c2[0], 120 + c2[1]); g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function makeGlowTexture() {
  const c = makeCanvas(128, 128), g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,220,140,1)'); gr.addColorStop(0.3, 'rgba(255,170,60,0.4)'); gr.addColorStop(1, 'rgba(255,150,40,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
function initTokens() {
  const face = new THREE.MeshStandardMaterial({
    map: makeTokenTexture(), metalness: 0.9, roughness: 0.25,
    emissive: 0xffa020, emissiveIntensity: 0.6, emissiveMap: null,
  });
  const rim = new THREE.MeshStandardMaterial({ color: 0xffc040, metalness: 1, roughness: 0.2, emissive: 0x803000, emissiveIntensity: 0.6 });
  const coinGeo = new THREE.CylinderGeometry(0.9, 0.9, 0.14, 40);
  coinGeo.rotateX(Math.PI / 2);
  const ringGeo = new THREE.TorusGeometry(1.25, 0.06, 8, 40);
  const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.6, 0.6) });
  const glowMat = new THREE.SpriteMaterial({ map: makeGlowTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  const positions = [];
  const roofs = [...city.rooftops].sort(() => Math.random() - 0.5);
  for (const r of roofs) {
    if (positions.length >= 20) break;
    const p = new THREE.Vector3(r.x, r.y + 3.2, r.z);
    if (!insideBuilding(p, 0.5)) positions.push(p);
  }
  while (positions.length < 40) positions.push(freeAirPoint(9, 34, CITY_HALF * 1.7));
  for (const pos of positions) {
    const g = new THREE.Group();
    const core = new THREE.Mesh(coinGeo, [rim, face, face]);
    const ring = new THREE.Mesh(ringGeo, ringMat);
    const glow = new THREE.Sprite(glowMat);
    glow.scale.set(5, 5, 1);
    g.add(core, ring, glow);
    g.position.copy(pos);
    scene.add(g);
    tokens.push({ mesh: g, core, ring, taken: false, phase: Math.random() * 10, base: pos.y });
  }
}
function updateTokens(dt, t) {
  for (const tk of tokens) {
    if (tk.taken) continue;
    tk.core.rotation.y = t * 2 + tk.phase;
    tk.ring.rotation.y = -t * 1.2 + tk.phase;
    tk.ring.rotation.x = Math.sin(t + tk.phase) * 0.5;
    tk.mesh.position.y = tk.base + Math.sin(t * 2.2 + tk.phase) * 0.25;
    if (P.pos.distanceToSquared(tk.mesh.position) < 3.6 * 3.6) {
      tk.taken = true;
      scene.remove(tk.mesh);
      game.tokensGot++;
      addScore(100, '令牌');
      audio.ding(game.combo);
      spawnSparkle(tk.mesh.position);
      updateObjective();
      checkVictory();
    }
  }
}

// ================================================================
//                         赛道挑战
// ================================================================
const race = { active: false, idx: 0, t: 0, countdown: 0, rings: [], marker: null, best: null };
const RACE_PATH = [
  [-23, 20, -40], [-23, 30, -125], [30, 34, -161], [115, 30, -161], [161, 38, -100], [161, 28, 0],
  [161, 36, 90], [95, 30, 115], [0, 26, 115], [-100, 34, 115], [-161, 30, 40], [-161, 36, -50],
  [-95, 26, -69], [-23, 18, -69],
];
function initRace() {
  try { race.best = parseFloat(localStorage.getItem('spidey_race_best')) || null; } catch (e) { race.best = null; }
  const ringGeo = new THREE.TorusGeometry(4.5, 0.28, 10, 48);
  const pts = RACE_PATH.map(([x, y, z]) => new THREE.Vector3(x, y, z));
  pts.forEach((p, i) => {
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 1.8, 2.6), transparent: true, opacity: 0.9 });
    const m = new THREE.Mesh(ringGeo, mat);
    m.position.copy(p);
    const next = pts[(i + 1) % pts.length], prev = i === 0 ? new THREE.Vector3(0, 10, 0) : pts[i - 1];
    const dir = new THREE.Vector3().subVectors(next, prev).setY(0).normalize();
    m.lookAt(p.clone().add(dir));
    m.visible = false;
    scene.add(m);
    race.rings.push(m);
  });
  // 起点标志:发光光柱
  const mk = new THREE.Group();
  const col = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 30, 24, 1, true),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0.1, 0.9, 1.4), transparent: true, opacity: 0.22,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  col.position.y = 15;
  const base = new THREE.Mesh(new THREE.TorusGeometry(1.8, 0.1, 8, 40),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 2, 3) }));
  base.rotation.x = Math.PI / 2; base.position.y = 0.3;
  const lab = makeCanvas(512, 128), lg = lab.getContext('2d');
  lg.font = 'bold 64px "Microsoft YaHei", sans-serif'; lg.textAlign = 'center'; lg.textBaseline = 'middle';
  lg.fillStyle = '#9ff4ff'; lg.shadowColor = '#00e0ff'; lg.shadowBlur = 16;
  lg.fillText('赛道挑战', 256, 64);
  const lt = new THREE.CanvasTexture(lab); lt.colorSpace = THREE.SRGBColorSpace;
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: lt, transparent: true, depthWrite: false }));
  label.scale.set(6, 1.5, 1); label.position.y = 4.2;
  mk.add(col, base, label);
  mk.position.set(-11, CURB, 9);
  scene.add(mk);
  race.marker = mk;
}
function startRace() {
  race.active = true; race.idx = 0; race.t = 0; race.countdown = 3.0;
  race.rings.forEach((r) => { r.visible = true; });
  race.marker.visible = false;
  showMessage('赛道挑战:穿过全部 14 个光环!(R 放弃)', 2500);
  audio.count(false);
  race._lastCount = 3;
}
function endRace(finished) {
  race.active = false;
  race.rings.forEach((r) => { r.visible = false; });
  race.marker.visible = true;
  elRace.textContent = '';
  if (finished) {
    const t = race.t;
    const isBest = !race.best || t < race.best;
    if (isBest) { race.best = t; try { localStorage.setItem('spidey_race_best', String(t)); } catch (e) { /* 忽略 */ } }
    const bonus = Math.max(200, Math.round(3000 - t * 25));
    addScore(bonus, '赛道完成');
    showMessage(`🏁 完成!用时 ${fmtTime(t)}${isBest ? ' · 新纪录!' : ''}  +${bonus}`, 4500);
    audio.victory();
  } else {
    showMessage('已放弃赛道挑战', 1500);
  }
}
const fmtTime = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${(t % 60).toFixed(2).padStart(5, '0')}`;
function updateRace(dt, t) {
  if (!race.active) {
    race.marker.rotation.y = t * 0.5;
    const dx = P.pos.x - race.marker.position.x, dz = P.pos.z - race.marker.position.z;
    if (Math.hypot(dx, dz) < 2.2 && P.pos.y < race.marker.position.y + 4) startRace();
    return;
  }
  if (race.countdown > 0) {
    race.countdown -= dt;
    const c = Math.ceil(race.countdown);
    if (c !== race._lastCount && c > 0) { race._lastCount = c; audio.count(false); }
    if (race.countdown <= 0) audio.count(true);
    elRace.textContent = race.countdown > 0 ? `准备 ${c}` : '出发!';
  } else {
    race.t += dt;
    elRace.textContent = `🏁 光环 ${race.idx}/${race.rings.length} · ${fmtTime(race.t)}` +
      (race.best ? ` · 最佳 ${fmtTime(race.best)}` : '');
  }
  race.rings.forEach((r, i) => {
    const cur = i === race.idx;
    r.material.opacity = i < race.idx ? 0 : cur ? 0.95 : 0.3;
    r.visible = i >= race.idx;
    const s = cur ? 1 + Math.sin(t * 6) * 0.06 : 1;
    r.scale.setScalar(s);
  });
  if (race.countdown <= 0) {
    const ring = race.rings[race.idx];
    if (ring && P.pos.distanceTo(ring.position) < 5.2) {
      audio.ring(race.idx);
      spawnBurst(ring.position, 0x40e0ff, 16, 8, 0.6, 1);
      race.idx++;
      if (race.idx >= race.rings.length) endRace(true);
    }
  }
}

// ================================================================
//                          粒子
// ================================================================
const particles = [];
const partGeo = new THREE.IcosahedronGeometry(0.14, 0);
function spawnBurst(pos, color, count, speed, life, gravity, glow = true) {
  const c = new THREE.Color(color).multiplyScalar(glow ? 2 : 1);
  for (let i = 0; i < count; i++) {
    const m = new THREE.Mesh(partGeo, new THREE.MeshBasicMaterial({ color: c, transparent: true }));
    m.position.copy(pos);
    const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5)
      .normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.8));
    scene.add(m);
    particles.push({ m, v, life: life * (0.6 + Math.random() * 0.6), max: life, gravity });
  }
}
const spawnExplosion = (p) => {
  spawnBurst(p, 0xff7a20, 26, 16, 1.0, 12);
  spawnBurst(p, 0xffd040, 14, 10, 0.8, 6);
  spawnBurst(p, 0x222222, 10, 6, 1.4, -1, false);
};
const spawnSparkle = (p) => spawnBurst(p, 0xffe37a, 16, 6, 0.6, 2);
const spawnDust = (p, n = 10, s = 3.5) => spawnBurst(p, 0x4a4540, n, s, 0.6, 1, false);
function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) { scene.remove(p.m); p.m.material.dispose(); particles.splice(i, 1); continue; }
    p.v.y -= p.gravity * dt;
    p.m.position.addScaledVector(p.v, dt);
    p.m.material.opacity = Math.min(1, p.life / (p.max * 0.5));
    p.m.scale.setScalar(0.5 + p.life / p.max);
  }
}

// ================================================================
//                        计分 / HUD
// ================================================================
function addScore(base, label = '') {
  game.combo++;
  game.comboTimer = 5;
  const mult = 1 + Math.min(game.combo - 1, 8) * 0.25;
  const pts = Math.round(base * mult);
  game.score += pts;
  elScore.textContent = `分数 ${game.score}`;
  elCombo.textContent = (game.combo > 1 ? `连击 x${game.combo}  ` : '') + `${label} +${pts}`;
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
    audio.victory();
    const t = clock.elapsedTime - game.startTime;
    $('res-score').textContent = game.score;
    $('res-time').textContent = fmtTime(t);
    $('res-tricks').textContent = game.tricks;
    $('res-race').textContent = race.best ? fmtTime(race.best) : '—';
    setTimeout(() => { elResults.classList.add('show'); document.exitPointerLock(); }, 1500);
  } else if (game.dronesDown >= DRONE_COUNT && game.dronesDown === DRONE_COUNT) {
    showMessage('全部无人机已击落!继续收集令牌', 2500);
  }
}
function hurtPlayer(dmg, fromDir) {
  const t = clock.elapsedTime;
  if (t - P.lastHurt < 0.8) return;
  P.lastHurt = t;
  P.health -= dmg;
  game.combo = 0; game.comboTimer = 0; elCombo.textContent = '';
  audio.hurt();
  cam.shake = Math.max(cam.shake, 0.35);
  elVignette.style.opacity = '1';
  setTimeout(() => { elVignette.style.opacity = '0'; }, 350);
  P.vel.addScaledVector(fromDir, 9);
  P.vel.y += 4;
  if (P.health <= 0) {
    P.health = 100;
    P.pos.copy(SPAWN);
    P.vel.set(0, 0, 0);
    detachWeb(false);
    P.state = 'fall';
    game.score = Math.max(0, game.score - 200);
    elScore.textContent = `分数 ${game.score}`;
    if (race.active) endRace(false);
    showMessage('💥 被击倒了…… 回到广场重新出发', 3000);
  }
}

// ================================================================
//                        物理与移动
// ================================================================
const _inputDir = new THREE.Vector3();
function getInputDir() {
  _inputDir.set(0, 0, 0);
  const f = new THREE.Vector3(-Math.sin(cam.yaw), 0, -Math.cos(cam.yaw));
  const r = new THREE.Vector3(-f.z, 0, f.x);
  if (keys.KeyW) _inputDir.add(f);
  if (keys.KeyS) _inputDir.sub(f);
  if (keys.KeyD) _inputDir.add(r);
  if (keys.KeyA) _inputDir.sub(r);
  if (_inputDir.lengthSq() > 0) _inputDir.normalize();
  return _inputDir;
}

function physicsStep(dt, t) {
  const input = getInputDir();
  const sprint = keys.ShiftLeft || keys.ShiftRight;
  if (P.wallCooldown > 0) P.wallCooldown -= dt;
  if (P.flipT > 0) P.flipT -= dt;
  if (!P.onGround) P.airTime += dt; else P.airTime = 0;

  // 竞速倒计时期间冻结
  if (race.active && race.countdown > 0) {
    P.vel.set(0, Math.min(P.vel.y, 0), 0);
  }

  // ---- 跳跃 ----
  if (keys.Space && !P._spaceHeld) {
    P._spaceHeld = true;
    if (P.state === 'wallrun') {
      P.vel.copy(P.wallRunN).multiplyScalar(13).add(new THREE.Vector3(0, 10, 0));
      P.state = 'jump';
      P.wallCooldown = 0.4;
      P.jumpsLeft = 1;
      triggerFlip();
    } else if (P.onGround && P.state !== 'land') {
      P.vel.y = 14.5;
      P.onGround = false;
      P.jumpsLeft = 1;
      P.state = 'jump';
    } else if (P.jumpsLeft > 0 && !P.webAttached && P.state !== 'zip') {
      P.jumpsLeft--;
      P.vel.y = 13;
      P.state = 'jump';
      spawnDust(P.pos.clone().add(new THREE.Vector3(0, -0.8, 0)), 6, 2);
    }
  }
  if (!keys.Space) P._spaceHeld = false;

  // ---- 墙跑判定 ----
  if (P.state !== 'wallrun' && P.onWall && keys.KeyW && !P.webAttached && P.state !== 'zip' &&
      P.state !== 'land' && P.wallCooldown <= 0 && input.dot(_v.copy(P.wallN).negate()) > 0.35) {
    P.state = 'wallrun';
    P.wallRunN.copy(P.wallN);
    P.wallLost = 0;
    P.jumpsLeft = 1;
  }

  if (P.state === 'land') {
    P.landT -= dt;
    P.vel.x *= Math.exp(-10 * dt); P.vel.z *= Math.exp(-10 * dt);
    P.vel.y -= GRAVITY * dt;
    P.pos.addScaledVector(P.vel, dt);
    if (P.landT <= 0) P.state = 'idle';
  } else if (P.state === 'zip') {
    P.zipTime += dt;
    const to = new THREE.Vector3().subVectors(P.zipDrone && !P.zipDrone.dead ? P.zipDrone.pos : P.zipTarget, P.pos);
    const d = to.length();
    if (d < 2.2 || P.zipTime > 2.2) {
      P.state = 'fall';
      P.vel.multiplyScalar(0.5);
      P.vel.y += 7;
      if (!P.zipDrone) triggerFlip();
    } else {
      const speed = Math.min(55, 28 + P.zipTime * 60);
      P.vel.copy(to.normalize().multiplyScalar(speed));
    }
    P.pos.addScaledVector(P.vel, dt);
  } else if (P.state === 'wallrun') {
    const N = P.wallRunN;
    const tangent = new THREE.Vector3(-N.z, 0, N.x);
    const lateral = input.dot(tangent);
    P.vel.set(0, 12.5, 0).addScaledVector(N, -3).addScaledVector(tangent, lateral * 5);
    P.pos.addScaledVector(P.vel, dt);
    P.runPhase += dt * 14;
    if (!keys.KeyW) { P.state = 'fall'; P.vel.addScaledVector(N, 4); P.wallCooldown = 0.3; }
  } else if (P.webAttached) {
    P.vel.y -= GRAVITY * dt;
    if (input.lengthSq() > 0) P.vel.addScaledVector(input, 26 * dt);
    P.vel.multiplyScalar(1 - 0.06 * dt);
    P.pos.addScaledVector(P.vel, dt);
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
    P.vel.y -= GRAVITY * dt;
    if (P.onGround) {
      const targetSpeed = sprint ? 19 : 11.5;
      const k = 1 - Math.exp(-12 * dt);
      P.vel.x += (input.x * targetSpeed - P.vel.x) * k;
      P.vel.z += (input.z * targetSpeed - P.vel.z) * k;
      P.state = input.lengthSq() > 0 ? 'run' : 'idle';
      P.runPhase += dt * Math.max(6, Math.hypot(P.vel.x, P.vel.z) * 0.85);
    } else {
      P.vel.x += input.x * 16 * dt;
      P.vel.z += input.z * 16 * dt;
      P.vel.x *= 1 - 0.04 * dt;
      P.vel.z *= 1 - 0.04 * dt;
      if (P.state === 'swing' || P.state === 'idle' || P.state === 'run') P.state = 'fall';
      if (P.state === 'jump' && P.vel.y < -4) P.state = 'fall';
    }
    P.pos.addScaledVector(P.vel, dt);
  }

  const sp = P.vel.length();
  if (sp > 60) P.vel.multiplyScalar(60 / sp);

  const preVy = P.vel.y;
  resolveCollisions();

  // 墙跑:失去墙面接触 = 到达楼顶,翻越
  if (P.state === 'wallrun') {
    if (!P.onWall) P.wallLost += dt; else P.wallLost = 0;
    if (P.wallLost > 0.06) {
      P.state = 'jump';
      P.vel.copy(P.wallRunN).multiplyScalar(-6);
      P.vel.y = 9;
      P.wallCooldown = 0.5;
      triggerFlip();
    } else if (P.onGround) {
      P.state = 'idle';
    }
  }

  // 边界(海岸线)
  const LIM = SHORE - 6;
  if (Math.abs(P.pos.x) > LIM) { P.vel.x -= Math.sign(P.pos.x) * 60 * dt; if (Math.abs(P.pos.x) > SHORE - 1) P.pos.x = Math.sign(P.pos.x) * (SHORE - 1); }
  if (Math.abs(P.pos.z) > LIM) { P.vel.z -= Math.sign(P.pos.z) * 60 * dt; if (Math.abs(P.pos.z) > SHORE - 1) P.pos.z = Math.sign(P.pos.z) * (SHORE - 1); }
  if (P.pos.y < -20) { P.pos.copy(SPAWN); P.vel.set(0, 0, 0); }

  if (t - P.lastHurt > 5 && P.health < 100) P.health = Math.min(100, P.health + 6 * dt);
  if (game.comboTimer > 0) {
    game.comboTimer -= dt;
    if (game.comboTimer <= 0) { game.combo = 0; elCombo.textContent = ''; }
  }
  return preVy;
}

function onLanded(vy) {
  if (vy < -24 && P.state !== 'wallrun') {
    P.state = 'land';
    P.landT = 0.55;
    cam.shake = Math.max(cam.shake, Math.min(0.9, -vy / 45));
    audio.thud(1.4);
    spawnDust(new THREE.Vector3(P.pos.x, P.pos.y - HIP + 0.2, P.pos.z), 22, 7);
    P.vel.x *= 0.2; P.vel.z *= 0.2;
  } else if (vy < -10) {
    audio.thud(-vy / 25);
    if (vy < -16) spawnDust(new THREE.Vector3(P.pos.x, P.pos.y - HIP + 0.2, P.pos.z));
    if (P.state !== 'land') P.state = 'idle';
  } else if (P.state === 'fall' || P.state === 'jump') {
    P.state = 'idle';
  }
}

function resolveCollisions() {
  const wasGround = P.onGround;
  const vy = P.vel.y;
  P.onGround = false;
  P.onWall = false;
  const gh = city.groundHeight(P.pos.x, P.pos.z);
  if (P.pos.y - HIP <= gh) {
    P.pos.y = gh + HIP;
    if (P.vel.y < 0) P.vel.y = 0;
    P.onGround = true;
  }
  for (const c of colliders) {
    const b = c.box;
    const feet = P.pos.y - HIP;
    const bodyMin = feet + 0.3, bodyMax = P.pos.y + HEAD;
    if (P.pos.x < b.min.x - RADIUS || P.pos.x > b.max.x + RADIUS ||
        P.pos.z < b.min.z - RADIUS || P.pos.z > b.max.z + RADIUS) continue;
    const inFoot = P.pos.x > b.min.x && P.pos.x < b.max.x && P.pos.z > b.min.z && P.pos.z < b.max.z;
    const fallStep = Math.max(1.4, -P.vel.y * (1 / 45) + 0.8);
    if (inFoot && P.vel.y <= 0.5 && feet <= b.max.y + 0.05 && feet > b.max.y - fallStep) {
      P.pos.y = b.max.y + HIP;
      if (P.vel.y < 0) P.vel.y = 0;
      P.onGround = true;
      continue;
    }
    if (inFoot && P.vel.y > 0 && bodyMax > b.min.y && bodyMax < b.min.y + 2) {
      P.pos.y = b.min.y - HEAD - 0.02;
      P.vel.y = 0;
      continue;
    }
    if (bodyMax > b.min.y + 0.1 && bodyMin < b.max.y - 0.05) {
      const pxp = b.max.x + RADIUS - P.pos.x, pxn = P.pos.x - (b.min.x - RADIUS);
      const pzp = b.max.z + RADIUS - P.pos.z, pzn = P.pos.z - (b.min.z - RADIUS);
      const mx = Math.min(pxp, pxn), mz = Math.min(pzp, pzn);
      if (mx > 0 && mz > 0) {
        if (c.tag === 'building' || c.tag === 'roofprop') P.onWall = true;
        P.jumpsLeft = Math.max(P.jumpsLeft, 1);
        if (mx < mz) {
          const s = pxp < pxn ? 1 : -1;
          P.pos.x += s * mx;
          if (P.vel.x * s < 0) P.vel.x *= -0.05;
          P.wallN.set(s, 0, 0);
        } else {
          const s = pzp < pzn ? 1 : -1;
          P.pos.z += s * mz;
          if (P.vel.z * s < 0) P.vel.z *= -0.05;
          P.wallN.set(0, 0, s);
        }
      }
    }
  }
  if (P.onGround) {
    P.jumpsLeft = 2;
    if (!wasGround && P.state !== 'swing') onLanded(vy);
  }
}

// ================================================================
//                         角色同步 / 相机
// ================================================================
const _euler = new THREE.Euler();
function updateCharacter(dt) {
  spidey.root.position.copy(P.pos);
  const hSpeed = Math.hypot(P.vel.x, P.vel.z);
  let targetYaw = P.yaw, targetPitch = 0;
  if (P.state === 'wallrun') {
    targetYaw = Math.atan2(-P.wallRunN.x, -P.wallRunN.z);
    targetPitch = -0.28;
    spidey.root.position.addScaledVector(P.wallRunN, 0.05);
  } else {
    if (hSpeed > 1.2 && P.state !== 'land') targetYaw = Math.atan2(P.vel.x, P.vel.z);
    else if (P.state === 'idle' && started) {
      // 静止时逐渐转向相机方向
      targetYaw = cam.yaw + Math.PI;
      if (Math.abs(((targetYaw - P.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 1.6) targetYaw = P.yaw;
    }
    if (['swing', 'zip', 'fall', 'jump'].includes(P.state)) {
      targetPitch = Math.atan2(-P.vel.y, Math.max(hSpeed, 4)) * (P.state === 'zip' ? 0.9 : 0.55);
      if (P.state === 'fall' && P.vel.y < -24) targetPitch = Math.atan2(-P.vel.y, Math.max(hSpeed, 4)) * 0.9;
      targetPitch = Math.max(-1.2, Math.min(1.25, targetPitch));
    }
  }
  const dy = ((targetYaw - P.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  P.yaw += dy * Math.min(1, 10 * dt);
  P.pitch += (targetPitch - P.pitch) * Math.min(1, (P.state === 'wallrun' ? 14 : 8) * dt);

  let flip = 0, animState = P.state;
  if (P.flipT > 0 && P.state !== 'wallrun' && P.state !== 'land' && !P.onGround) {
    const k = 1 - P.flipT / 0.62;
    flip = k * Math.PI * 2;
    animState = 'flip';
  }
  _euler.set(P.pitch + flip, P.yaw, 0, 'YXZ');
  spidey.root.quaternion.setFromEuler(_euler);

  let webDirLocal = null;
  if (P.webAttached) {
    const worldDir = new THREE.Vector3().subVectors(P.webAnchor, P.pos).normalize();
    webDirLocal = worldDir.applyQuaternion(spidey.root.quaternion.clone().invert());
  }
  spidey.update(dt, animState, {
    runPhase: P.runPhase, webDirLocal, speed: hSpeed, vy: P.vel.y,
  });
}

const _camTarget = new THREE.Vector3(), _camPos = new THREE.Vector3();
function updateCamera(dt) {
  const speed = P.vel.length();
  const targetDist = 6.2 + Math.min(speed * 0.07, 3.4);
  cam.dist += (targetDist - cam.dist) * Math.min(1, 4 * dt);
  const cp = Math.cos(cam.pitch), spn = Math.sin(cam.pitch);
  const dir = new THREE.Vector3(Math.sin(cam.yaw) * cp, -spn, Math.cos(cam.yaw) * cp);
  _camTarget.copy(P.pos).add(new THREE.Vector3(0, 1.3, 0));
  // 相机防穿墙
  let dist = cam.dist;
  const hit = raycastBuildings(_camTarget, dir, cam.dist + 0.5);
  if (hit) dist = Math.max(1.2, hit.distanceTo(_camTarget) - 0.6);
  _camPos.copy(_camTarget).addScaledVector(dir, dist);
  _camPos.y += 0.3;
  const gh = city.groundHeight(_camPos.x, _camPos.z);
  if (_camPos.y < gh + 0.5) _camPos.y = gh + 0.5;
  camera.position.lerp(_camPos, Math.min(1, (hit ? 25 : 14) * dt));
  if (cam.shake > 0) {
    camera.position.x += (Math.random() - 0.5) * cam.shake * 0.6;
    camera.position.y += (Math.random() - 0.5) * cam.shake * 0.6;
    cam.shake = Math.max(0, cam.shake - dt * 1.8);
  }
  const look = P.pos.clone().add(new THREE.Vector3(0, 1.1, 0)).addScaledVector(P.vel, 0.05);
  camera.lookAt(look);
  const targetFov = 70 + Math.min(speed * 0.42, 26);
  cam.fov += (targetFov - cam.fov) * Math.min(1, 5 * dt);
  camera.fov = cam.fov;
  camera.updateProjectionMatrix();
  fxPass.uniforms.speed.value = Math.max(0, (speed - 18) / 40);
  const hurtK = Math.max(0, 1 - (clock.elapsedTime - P.lastHurt) / 0.6);
  fxPass.uniforms.damage.value = Math.max(hurtK, P.health < 35 ? 0.35 : 0);
}

// ================================================================
//                            小地图
// ================================================================
let miniStatic;
const MAP_W = 700, MAP_OFF = 350;
function initMinimap() {
  miniStatic = makeCanvas(MAP_W, MAP_W);
  const g = miniStatic.getContext('2d');
  g.fillStyle = '#0c1826'; g.fillRect(0, 0, MAP_W, MAP_W);
  g.fillStyle = '#23252c'; g.fillRect(MAP_OFF - SHORE, MAP_OFF - SHORE, SHORE * 2, SHORE * 2);
  for (const b of city.layout.blocks) {
    g.fillStyle = b.type === 'park' ? '#1f4a2a' : b.type === 'plaza' ? '#5a5a66' : '#3a3d48';
    g.fillRect(MAP_OFF + b.cx - SW_HALF, MAP_OFF + b.cz - SW_HALF, SW_HALF * 2, SW_HALF * 2);
  }
  for (const b of city.layout.buildings) {
    const l = 45 + Math.min(40, b.h / 5);
    g.fillStyle = `hsl(220,10%,${l}%)`;
    g.fillRect(MAP_OFF + b.cx - b.w / 2, MAP_OFF + b.cz - b.d / 2, b.w, b.d);
  }
}
function drawMinimap() {
  const W = mini.width, S = 0.62;
  const c = miniCtx;
  c.clearRect(0, 0, W, W);
  c.save();
  c.beginPath(); c.arc(W / 2, W / 2, W / 2 - 2, 0, Math.PI * 2); c.clip();
  c.translate(W / 2, W / 2);
  c.rotate(cam.yaw);
  c.scale(S, S);
  c.translate(-P.pos.x - MAP_OFF, -P.pos.z - MAP_OFF);
  c.drawImage(miniStatic, 0, 0);
  c.translate(MAP_OFF, MAP_OFF);
  const dot = (x, z, r, col) => { c.fillStyle = col; c.beginPath(); c.arc(x, z, r / S, 0, Math.PI * 2); c.fill(); };
  for (const tk of tokens) if (!tk.taken) dot(tk.mesh.position.x, tk.mesh.position.z, 3, '#ffd24a');
  for (const d of drones) if (!d.dead) dot(d.pos.x, d.pos.z, 4, d.sees ? '#ff3030' : '#c04040');
  if (race.active) {
    const r = race.rings[race.idx];
    if (r) dot(r.position.x, r.position.z, 6, '#40e8ff');
  } else {
    dot(race.marker.position.x, race.marker.position.z, 4, '#40e8ff');
  }
  // 玩家箭头
  c.translate(P.pos.x, P.pos.z);
  c.rotate(Math.PI - P.yaw);
  c.scale(1 / S, 1 / S);
  c.fillStyle = '#ff3b3b'; c.strokeStyle = '#fff'; c.lineWidth = 1.5;
  c.beginPath(); c.moveTo(0, -9); c.lineTo(6, 7); c.lineTo(0, 3); c.lineTo(-6, 7); c.closePath();
  c.fill(); c.stroke();
  c.restore();
  c.strokeStyle = 'rgba(255,90,90,0.6)'; c.lineWidth = 2;
  c.beginPath(); c.arc(W / 2, W / 2, W / 2 - 2, 0, Math.PI * 2); c.stroke();
  c.fillStyle = '#ddd'; c.font = 'bold 12px sans-serif'; c.textAlign = 'center';
  // 北方指示
  const nx = W / 2 + Math.sin(-cam.yaw) * (W / 2 - 12) * -1, ny = W / 2 - Math.cos(cam.yaw) * (W / 2 - 12);
  c.fillText('N', nx, ny + 4);
}

// ================================================================
//                           HUD
// ================================================================
const STATE_NAMES = {
  idle: '', run: '奔跑', jump: '跳跃', fall: '下落', swing: '🕸️ 摆荡中', zip: '⚡ 蛛丝飞跃',
  wallrun: '🧱 墙跑', land: '💥 着陆',
};
function updateHUD() {
  elSpeed.textContent = Math.round(P.vel.length() * 3.6);
  elHealth.style.width = Math.max(0, P.health) + '%';
  elState.textContent = P.flipT > 0 && !P.onGround ? '🌀 特技' : STATE_NAMES[P.state] || '';
  const lock = findLockTarget();
  elCrosshair.classList.toggle('target', !!lock);
  if (lock) {
    const v = lock.pos.clone().project(camera);
    elLock.style.display = 'block';
    elLock.style.left = ((v.x * 0.5 + 0.5) * window.innerWidth) + 'px';
    elLock.style.top = ((-v.y * 0.5 + 0.5) * window.innerHeight) + 'px';
  } else elLock.style.display = 'none';
  drawMinimap();
}

// ================================================================
//                          主循环
// ================================================================
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  const playing = started && pointerLocked && !game.won;

  if (playing) {
    const sub = dt > 0.025 ? 2 : 1;
    for (let i = 0; i < sub; i++) physicsStep(dt / sub, t);
    updateDrones(dt, t);
    updateBolts(dt);
    updateWebBalls(dt);
    updateTokens(dt, t);
    updateRace(dt, t);
  } else if (!started) {
    // 菜单背景:缓慢环绕镜头
    cam.yaw = t * 0.05;
    cam.pitch = -0.35;
  }
  for (const d of drones) if (!d.dead && !playing) d.api.animate(dt, t);
  updateCharacter(dt);
  updateCamera(dt);
  updateWebLine(dt);
  updateParticles(dt);
  city.update(t, dt, camera, P.pos);
  if (started) updateHUD();
  audio.setWind(Math.min(1, P.vel.length() / 45));
  composer.render();
}

// 调试句柄
window.__game = {
  P, camera, scene, drones, tokens, cam, race, game, keys,
  get spidey() { return spidey; }, get city() { return city; },
  physicsStep, renderer,
  // 自动化测试用:跳过指针锁直接开始
  forceStart() {
    audio.init();
    pointerLocked = true; started = true; game.startTime = clock.elapsedTime;
    menu.classList.add('hidden'); hud.classList.add('active');
  },
  tryAttachWeb: () => tryAttachWeb(), detachWeb: (b) => detachWeb(b), tryZip: () => tryZip(),
  shootWebBall: () => shootWebBall(),
};

init();
