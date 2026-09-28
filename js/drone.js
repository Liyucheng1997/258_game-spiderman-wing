// 敌方无人机:车削机身 + 装甲环 + 四个涵道旋翼 + 红色传感器眼 + 双管激光炮 + 航行灯
import * as THREE from 'three';

let shared = null;
function getShared() {
  if (shared) return shared;
  const hullProf = [
    [0, 0.34], [0.3, 0.32], [0.55, 0.22], [0.72, 0.08], [0.74, -0.04], [0.62, -0.2],
    [0.42, -0.32], [0.2, -0.4], [0, -0.42],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const armShape = new THREE.Shape();
  armShape.moveTo(0, -0.09); armShape.lineTo(1.0, -0.06); armShape.lineTo(1.0, 0.06); armShape.lineTo(0, 0.1);
  armShape.closePath();
  shared = {
    hull: new THREE.LatheGeometry(hullProf, 32),
    dome: new THREE.SphereGeometry(0.4, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    band: new THREE.TorusGeometry(0.735, 0.05, 8, 40),
    strip: new THREE.TorusGeometry(0.76, 0.018, 6, 40),
    arm: new THREE.ExtrudeGeometry(armShape, { depth: 0.16, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 2 }),
    duct: new THREE.TorusGeometry(0.44, 0.07, 8, 28),
    ductInner: new THREE.CylinderGeometry(0.44, 0.44, 0.14, 28, 1, true),
    motor: new THREE.CylinderGeometry(0.1, 0.12, 0.16, 12),
    blade: new THREE.BoxGeometry(0.8, 0.012, 0.07),
    strut: new THREE.BoxGeometry(0.44, 0.03, 0.03),
    sensorHousing: new THREE.CylinderGeometry(0.2, 0.24, 0.22, 20),
    lens: new THREE.SphereGeometry(0.15, 20, 12),
    lensRing: new THREE.TorusGeometry(0.18, 0.025, 6, 24),
    barrel: new THREE.CylinderGeometry(0.035, 0.045, 0.5, 10),
    gunBody: new THREE.BoxGeometry(0.34, 0.14, 0.3),
    antenna: new THREE.CylinderGeometry(0.01, 0.015, 0.4, 5),
    navLight: new THREE.SphereGeometry(0.045, 8, 6),
    vent: new THREE.BoxGeometry(0.28, 0.02, 0.05),
    mats: {
      hull: new THREE.MeshStandardMaterial({ color: 0x2a2e36, roughness: 0.35, metalness: 0.85 }),
      armor: new THREE.MeshStandardMaterial({ color: 0x4a4f5a, roughness: 0.45, metalness: 0.7 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x121418, roughness: 0.5, metalness: 0.6 }),
      dome: new THREE.MeshPhysicalMaterial({ color: 0x0c0e14, roughness: 0.08, metalness: 0.3, clearcoat: 1 }),
      blade: new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6, transparent: true, opacity: 0.85 }),
      accent: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.5, 0.35, 0.1) }),
      navG: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 3, 0.6) }),
      navR: new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.2, 0.15) }),
      ring: new THREE.MeshStandardMaterial({ color: 0x8a8f99, roughness: 0.25, metalness: 1 }),
    },
  };
  return shared;
}

export function makeDrone() {
  const S = getShared(), M = S.mats;
  const g = new THREE.Group();
  const body = new THREE.Group();
  g.add(body);
  const add = (geo, mat, parent = body) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    parent.add(m);
    return m;
  };
  add(S.hull, M.hull);
  const dome = add(S.dome, M.dome); dome.scale.y = 0.55; dome.position.y = 0.28;
  const band = add(S.band, M.armor); band.rotation.x = Math.PI / 2;
  const strip = add(S.strip, M.accent); strip.rotation.x = Math.PI / 2; strip.position.y = -0.07;
  // 天线
  const ant = add(S.antenna, M.dark); ant.position.set(-0.18, 0.5, -0.2); ant.rotation.z = 0.2;
  const antTip = add(S.navLight, M.navR); antTip.position.set(-0.22, 0.7, -0.2); antTip.scale.setScalar(0.6);

  // 传感器眼(每架独立材质用于闪烁)
  const eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.15, 0.08) });
  const housing = add(S.sensorHousing, M.dark);
  housing.rotation.x = Math.PI / 2; housing.position.set(0, -0.02, 0.66);
  const lens = add(S.lens, eyeMat); lens.position.set(0, -0.02, 0.76); lens.scale.z = 0.6;
  const lr = add(S.lensRing, M.ring); lr.position.set(0, -0.02, 0.78);

  // 激光炮
  const gun = add(S.gunBody, M.armor); gun.position.set(0, -0.42, 0.25);
  for (const x of [-0.09, 0.09]) {
    const b = add(S.barrel, M.dark);
    b.rotation.x = Math.PI / 2; b.position.set(x, -0.44, 0.58);
  }
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, -0.44, 0.85);
  body.add(muzzle);

  // 旋翼臂
  const rotors = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const arm = new THREE.Group();
    arm.rotation.y = -a;
    body.add(arm);
    const am = add(S.arm, M.armor, arm);
    am.rotation.x = Math.PI / 2; am.position.set(0.5, 0.08, 0);
    const pod = new THREE.Group();
    pod.position.set(1.62, 0.1, 0);
    arm.add(pod);
    const duct = add(S.duct, M.hull, pod); duct.rotation.x = Math.PI / 2;
    const inner = add(S.ductInner, M.dark, pod); inner.material = M.dark;
    add(S.motor, M.ring, pod);
    for (let k = 0; k < 3; k++) {
      const st = add(S.strut, M.dark, pod);
      st.rotation.y = (k / 3) * Math.PI * 2; st.position.y = -0.04;
      st.position.x = Math.cos(st.rotation.y) * 0.22; st.position.z = -Math.sin(st.rotation.y) * 0.22;
    }
    const rotor = new THREE.Group();
    rotor.position.y = 0.06;
    pod.add(rotor);
    for (let k = 0; k < 2; k++) {
      const bl = add(S.blade, M.blade, rotor);
      bl.rotation.y = k * Math.PI / 2; bl.rotation.x = 0.12;
    }
    const nav = add(S.navLight, i < 2 ? M.navG : M.navR, pod);
    nav.position.set(0.5, 0, 0);
    rotors.push(rotor);
  }

  let alert = 0;
  return {
    group: g, body, muzzle, eyeMat, rotors,
    setAlert(v) { alert = v; },
    animate(dt, t) {
      for (let i = 0; i < rotors.length; i++) rotors[i].rotation.y += dt * (i % 2 ? 48 : -48);
      body.rotation.z = Math.sin(t * 1.3) * 0.05;
      const pulse = alert > 0 ? 0.5 + 0.5 * Math.sin(t * 30) : 0.7 + 0.3 * Math.sin(t * 3);
      const k = 1 + alert * 2;
      eyeMat.color.setRGB(3 * pulse * k, 0.15 * pulse, 0.08);
    },
  };
}
