// 蜘蛛侠角色:程序化精细建模(蛛网纹理战衣 + 大眼 + 胸口蜘蛛徽标)
// 关节层级 + 程序化姿态动画(待机/奔跑/跳跃/摆荡/飞跃/下落)
import * as THREE from 'three';

// ---- 蛛网纹理:红底 + 黑色放射蛛网 ----
function makeWebTexture(size = 256, base = '#c8102e') {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  // 轻微布料噪点
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(0,0,0,${Math.random() * 0.07})`;
    g.fillRect(Math.random() * size, Math.random() * size, 2, 2);
  }
  g.strokeStyle = 'rgba(10,0,0,0.85)';
  g.lineWidth = size / 110;
  const cx = size / 2, cy = size / 2;
  // 放射线
  const spokes = 18;
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2;
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(a) * size, cy + Math.sin(a) * size);
    g.stroke();
  }
  // 同心弧(略下垂的蛛网感)
  for (let r = size * 0.07; r < size * 0.78; r *= 1.32) {
    g.beginPath();
    for (let i = 0; i <= spokes; i++) {
      const a1 = (i / spokes) * Math.PI * 2;
      const a0 = ((i - 1) / spokes) * Math.PI * 2;
      const x0 = cx + Math.cos(a0) * r, y0 = cy + Math.sin(a0) * r;
      const x1 = cx + Math.cos(a1) * r, y1 = cy + Math.sin(a1) * r;
      const mx = (x0 + x1) / 2 + Math.cos((a0 + a1) / 2) * r * -0.08;
      const my = (y0 + y1) / 2 + Math.sin((a0 + a1) / 2) * r * -0.08;
      if (i === 0) g.moveTo(x1, y1);
      else g.quadraticCurveTo(mx, my, x1, y1);
    }
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// ---- 胸口蜘蛛徽标(透明贴花) ----
function makeSpiderEmblem() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 128, 128);
  g.fillStyle = '#000';
  g.strokeStyle = '#000';
  const cx = 64, cy = 60;
  // 身体
  g.beginPath(); g.ellipse(cx, cy - 10, 6, 10, 0, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.ellipse(cx, cy + 12, 8, 16, 0, 0, Math.PI * 2); g.fill();
  // 八条腿
  g.lineWidth = 4.5; g.lineCap = 'round';
  const legs = [
    [[-8, -14], [-30, -34], [-38, -18]],
    [[8, -14], [30, -34], [38, -18]],
    [[-9, -4], [-36, -10], [-46, 6]],
    [[9, -4], [36, -10], [46, 6]],
    [[-9, 8], [-34, 16], [-44, 34]],
    [[9, 8], [34, 16], [44, 34]],
    [[-8, 18], [-24, 34], [-28, 52]],
    [[8, 18], [24, 34], [28, 52]],
  ];
  for (const [p0, p1, p2] of legs) {
    g.beginPath();
    g.moveTo(cx + p0[0], cy + p0[1]);
    g.quadraticCurveTo(cx + p1[0], cy + p1[1], cx + p2[0], cy + p2[1]);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// 胶囊体辅助:原点在顶端,向 -Y 延伸(方便做肢体旋转)
function limb(radius, length, mat, rTip = null) {
  const geo = new THREE.CapsuleGeometry(radius, length, 6, 12);
  if (rTip !== null) {
    // 轻微锥形:缩放底部顶点
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y < 0) {
        const k = 1 + (rTip / radius - 1) * Math.min(1, -y / (length / 2 + radius));
        pos.setX(i, pos.getX(i) * k);
        pos.setZ(i, pos.getZ(i) * k);
      }
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
  }
  const m = new THREE.Mesh(geo, mat);
  m.position.y = -(length / 2);
  m.castShadow = true;
  const pivot = new THREE.Group();
  pivot.add(m);
  return pivot;
}

export class SpiderMan {
  constructor() {
    const webTex = makeWebTexture();
    const webTexSmall = makeWebTexture(128);
    webTexSmall.repeat.set(2, 2);

    this.matRed = new THREE.MeshStandardMaterial({
      map: webTex, roughness: 0.55, metalness: 0.05,
    });
    this.matRedLimb = new THREE.MeshStandardMaterial({
      map: webTexSmall, roughness: 0.55, metalness: 0.05,
    });
    this.matBlue = new THREE.MeshStandardMaterial({
      color: 0x1a3faa, roughness: 0.6, metalness: 0.08,
    });
    this.matBlueDark = new THREE.MeshStandardMaterial({
      color: 0x14307f, roughness: 0.65,
    });
    const matEye = new THREE.MeshStandardMaterial({
      color: 0xf2f6ff, roughness: 0.25, metalness: 0.0,
      emissive: 0x888888, emissiveIntensity: 0.35,
    });
    const matEyeRim = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.4 });

    const root = new THREE.Group();
    this.root = root;

    // ================= 躯干 =================
    // 骨盆
    this.hips = new THREE.Group();
    root.add(this.hips);
    const pelvis = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 10), this.matBlue);
    pelvis.scale.set(1.15, 0.75, 0.9);
    pelvis.castShadow = true;
    this.hips.add(pelvis);

    // 胸腔(倒锥形的宽肩身材)
    this.chest = new THREE.Group();
    this.chest.position.y = 0.14;
    this.hips.add(this.chest);
    const torsoGeo = new THREE.CapsuleGeometry(0.185, 0.3, 6, 14);
    {
      const pos = torsoGeo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        const k = 1 + Math.max(0, y + 0.05) * 1.15;   // 上宽下窄
        pos.setX(i, pos.getX(i) * k * 1.08);
        pos.setZ(i, pos.getZ(i) * k * 0.82);
      }
      pos.needsUpdate = true;
      torsoGeo.computeVertexNormals();
    }
    const torso = new THREE.Mesh(torsoGeo, this.matRed);
    torso.position.y = 0.22;
    torso.castShadow = true;
    this.chest.add(torso);

    // 胸口蜘蛛徽标
    const emblem = new THREE.Mesh(
      new THREE.PlaneGeometry(0.2, 0.2),
      new THREE.MeshBasicMaterial({ map: makeSpiderEmblem(), transparent: true })
    );
    emblem.position.set(0, 0.3, 0.185);
    emblem.rotation.x = -0.06;
    this.chest.add(emblem);

    // 侧腰蓝色(布料分色)
    for (const sx of [-1, 1]) {
      const side = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), this.matBlue);
      side.scale.set(0.7, 1.6, 0.85);
      side.position.set(sx * 0.16, 0.1, 0);
      this.chest.add(side);
    }

    // ================= 头部 =================
    this.neck = new THREE.Group();
    this.neck.position.y = 0.5;
    this.chest.add(this.neck);
    const neckM = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.075, 0.09, 10), this.matRed);
    neckM.position.y = 0.03;
    this.neck.add(neckM);

    this.head = new THREE.Group();
    this.head.position.y = 0.1;
    this.neck.add(this.head);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.125, 20, 16), this.matRed);
    skull.scale.set(0.92, 1.08, 1.0);
    skull.position.y = 0.1;
    skull.castShadow = true;
    this.head.add(skull);

    // 大眼睛(经典泪滴形:用缩放半球贴在头两侧前方)
    for (const sx of [-1, 1]) {
      const rim = new THREE.Mesh(new THREE.SphereGeometry(0.062, 14, 10), matEyeRim);
      rim.scale.set(0.75, 1.05, 0.4);
      rim.position.set(sx * 0.055, 0.115, 0.098);
      rim.rotation.y = sx * 0.5;
      rim.rotation.z = sx * -0.35;
      this.head.add(rim);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.054, 14, 10), matEye);
      eye.scale.set(0.68, 0.95, 0.36);
      eye.position.set(sx * 0.057, 0.115, 0.104);
      eye.rotation.y = sx * 0.5;
      eye.rotation.z = sx * -0.35;
      this.head.add(eye);
    }

    // ================= 手臂 =================
    const upperArmLen = 0.26, foreArmLen = 0.24;
    this.armL = this._makeArm(-1, upperArmLen, foreArmLen);
    this.armR = this._makeArm(1, upperArmLen, foreArmLen);
    this.chest.add(this.armL.shoulder, this.armR.shoulder);

    // ================= 腿 =================
    const thighLen = 0.32, shinLen = 0.3;
    this.legL = this._makeLeg(-1, thighLen, shinLen);
    this.legR = this._makeLeg(1, thighLen, shinLen);
    this.hips.add(this.legL.hip, this.legR.hip);

    // 站立时脚底到骨盆约 0.9m,总身高约 1.75m
    this.standHipHeight = 0.92;

    // 姿态插值状态
    this._pose = {};       // 当前关节角(平滑)
    this._t = 0;
  }

  _makeArm(side, upperLen, foreLen) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.235, 0.42, 0);
    // 三角肌
    const delt = new THREE.Mesh(new THREE.SphereGeometry(0.072, 12, 9), this.matRed);
    delt.scale.set(1.05, 0.9, 0.9);
    delt.castShadow = true;
    shoulder.add(delt);
    const upper = limb(0.062, upperLen, this.matRedLimb, 0.05);
    shoulder.add(upper);
    const elbow = new THREE.Group();
    elbow.position.y = -(upperLen + 0.05);
    upper.add(elbow);
    const fore = limb(0.05, foreLen, this.matRedLimb, 0.04);
    elbow.add(fore);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.052, 10, 8), this.matRed);
    hand.scale.set(0.85, 1.25, 0.6);
    hand.position.y = -(foreLen + 0.06);
    hand.castShadow = true;
    fore.add(hand);
    return { shoulder, upper, elbow, fore, hand, side };
  }

  _makeLeg(side, thighLen, shinLen) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.1, -0.06, 0);
    const thigh = limb(0.082, thighLen, this.matBlue, 0.06);
    hip.add(thigh);
    const knee = new THREE.Group();
    knee.position.y = -(thighLen + 0.06);
    thigh.add(knee);
    // 小腿:上蓝下红(经典红靴)
    const shin = limb(0.06, shinLen * 0.55, this.matBlueDark, 0.05);
    knee.add(shin);
    const boot = limb(0.052, shinLen * 0.45, this.matRedLimb, 0.045);
    boot.position.y = -(shinLen * 0.55 + 0.04);
    shin.add(boot);
    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), this.matRed);
    foot.scale.set(0.8, 0.55, 1.6);
    foot.position.set(0, -(shinLen * 0.45 + 0.05), 0.045);
    foot.castShadow = true;
    boot.add(foot);
    return { hip, thigh, knee, shin, side };
  }

  // ---------- 姿态系统 ----------
  // target: { key: [rx, ry, rz] } 平滑过渡
  _apply(dt, targets, speed = 10) {
    const k = 1 - Math.exp(-speed * dt);
    for (const key in targets) {
      const [obj, rx, ry, rz] = targets[key];
      if (!this._pose[key]) this._pose[key] = { x: rx, y: ry, z: rz };
      const p = this._pose[key];
      p.x += (rx - p.x) * k;
      p.y += (ry - p.y) * k;
      p.z += (rz - p.z) * k;
      obj.rotation.set(p.x, p.y, p.z);
    }
  }

  /**
   * @param dt 帧时间
   * @param state 'idle' | 'run' | 'jump' | 'fall' | 'swing' | 'zip'
   * @param opts { speed, runPhase, webDirLocal }  webDirLocal: 蛛丝方向(角色局部空间)
   */
  update(dt, state, opts = {}) {
    this._t += dt;
    const t = this._t;
    const L = this.legL, R = this.legR, AL = this.armL, AR = this.armR;
    const targets = {};

    if (state === 'idle') {
      const b = Math.sin(t * 2.2) * 0.03;
      targets.chest = [this.chest, 0.04 + b * 0.4, 0, 0];
      targets.head = [this.head, -0.04, 0, 0];
      targets.hipL = [L.thigh, -0.06, 0, 0.03];
      targets.hipR = [R.thigh, -0.06, 0, -0.03];
      targets.kneeL = [L.knee, 0.12, 0, 0];
      targets.kneeR = [R.knee, 0.12, 0, 0];
      targets.shL = [AL.upper, 0.06 + b, 0, 0.16];
      targets.shR = [AR.upper, 0.06 - b, 0, -0.16];
      targets.elL = [AL.elbow, -0.25, 0, 0];
      targets.elR = [AR.elbow, -0.25, 0, 0];
      this._apply(dt, targets, 6);
    } else if (state === 'run') {
      const ph = opts.runPhase || t * 9;
      const sw = Math.sin(ph), cw = Math.sin(ph + Math.PI);
      const amp = 0.85;
      targets.chest = [this.chest, 0.28, 0, Math.sin(ph * 1) * 0.04];
      targets.head = [this.head, -0.22, 0, 0];
      targets.hipL = [L.thigh, sw * amp - 0.2, 0, 0.02];
      targets.hipR = [R.thigh, cw * amp - 0.2, 0, -0.02];
      targets.kneeL = [L.knee, Math.max(0, -sw) * 1.5 + 0.25, 0, 0];
      targets.kneeR = [R.knee, Math.max(0, -cw) * 1.5 + 0.25, 0, 0];
      targets.shL = [AL.upper, cw * 0.85, 0, 0.12];
      targets.shR = [AR.upper, sw * 0.85, 0, -0.12];
      targets.elL = [AL.elbow, -0.9, 0, 0];
      targets.elR = [AR.elbow, -0.9, 0, 0];
      this._apply(dt, targets, 14);
    } else if (state === 'jump') {
      targets.chest = [this.chest, 0.15, 0, 0];
      targets.head = [this.head, -0.1, 0, 0];
      targets.hipL = [L.thigh, -1.1, 0, 0.15];
      targets.hipR = [R.thigh, -0.35, 0, -0.15];
      targets.kneeL = [L.knee, 1.7, 0, 0];
      targets.kneeR = [R.knee, 0.9, 0, 0];
      targets.shL = [AL.upper, -0.5, 0, 0.9];
      targets.shR = [AR.upper, -0.5, 0, -0.9];
      targets.elL = [AL.elbow, -1.0, 0, 0];
      targets.elR = [AR.elbow, -1.0, 0, 0];
      this._apply(dt, targets, 10);
    } else if (state === 'fall') {
      const fl = Math.sin(t * 5) * 0.1;
      targets.chest = [this.chest, 0.35, 0, 0];
      targets.head = [this.head, -0.35, 0, 0];
      targets.hipL = [L.thigh, -0.5 + fl, 0, 0.3];
      targets.hipR = [R.thigh, -0.3 - fl, 0, -0.3];
      targets.kneeL = [L.knee, 0.8, 0, 0];
      targets.kneeR = [R.knee, 0.6, 0, 0];
      targets.shL = [AL.upper, -1.3, 0, 1.5];
      targets.shR = [AR.upper, -1.3, 0, -1.5];
      targets.elL = [AL.elbow, -0.4, 0, 0];
      targets.elR = [AR.elbow, -0.4, 0, 0];
      this._apply(dt, targets, 7);
    } else if (state === 'swing') {
      // 右臂指向蛛丝方向
      const wd = opts.webDirLocal || new THREE.Vector3(0.3, 1, 0.2);
      // 计算肩部旋转:让 -Y(手臂延伸方向) 指向 webDir
      const armRot = this._aimArm(wd);
      targets.chest = [this.chest, 0.32, 0, -0.12];
      targets.head = [this.head, -0.3, 0, 0.1];
      targets.hipL = [L.thigh, 0.25, 0, 0.12];
      targets.hipR = [R.thigh, -0.15, 0, -0.12];
      targets.kneeL = [L.knee, 0.55, 0, 0];
      targets.kneeR = [R.knee, 0.9, 0, 0];
      targets.shR = [AR.upper, armRot.x, armRot.y, armRot.z];
      targets.elR = [AR.elbow, -0.12, 0, 0];
      targets.shL = [AL.upper, 0.5, 0, 0.55];
      targets.elL = [AL.elbow, -0.7, 0, 0];
      this._apply(dt, targets, 9);
    } else if (state === 'zip') {
      // 超人式双臂前伸
      targets.chest = [this.chest, 0.55, 0, 0];
      targets.head = [this.head, -0.5, 0, 0];
      targets.hipL = [L.thigh, 0.5, 0, 0.06];
      targets.hipR = [R.thigh, 0.55, 0, -0.06];
      targets.kneeL = [L.knee, 0.15, 0, 0];
      targets.kneeR = [R.knee, 0.1, 0, 0];
      targets.shL = [AL.upper, -2.6, 0, 0.25];
      targets.shR = [AR.upper, -2.6, 0, -0.25];
      targets.elL = [AL.elbow, -0.1, 0, 0];
      targets.elR = [AR.elbow, -0.1, 0, 0];
      this._apply(dt, targets, 11);
    }
  }

  // 把 -Y 轴(手臂延伸方向)对准局部方向 dir,返回欧拉角
  _aimArm(dir) {
    const d = dir.clone().normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), d);
    const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
    return new THREE.Vector3(e.x, e.y, e.z);
  }

  // 右手世界坐标(蛛丝起点)
  getHandWorldPos(out) {
    return this.armR.fore.children[1]
      ? this.armR.fore.children[1].getWorldPosition(out)
      : this.armR.fore.getWorldPosition(out);
  }
}
