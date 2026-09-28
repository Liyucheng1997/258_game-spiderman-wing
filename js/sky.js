// 黄昏天空:渐变 + 太阳光晕 + 星星 + fbm 程序化云层;并生成 PMREM 环境贴图供 PBR 反射
import * as THREE from 'three';

export const SUN_DIR = new THREE.Vector3(0.42, 0.10, -0.9).normalize();

const vert = `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const frag = `
uniform vec3 sunDir;
uniform float time;
uniform float cloudAmt;
varying vec3 vDir;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return s;
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  float sd = dot(d, sunDir);
  float sunSide = smoothstep(-0.4, 1.0, sd);

  vec3 zenith = vec3(0.025, 0.045, 0.14);
  vec3 mid    = vec3(0.16, 0.10, 0.26);
  vec3 horA   = vec3(0.55, 0.22, 0.30);   // 背阳侧地平线:粉紫
  vec3 horB   = vec3(1.25, 0.48, 0.16);   // 向阳侧地平线:橙金
  vec3 hor = mix(horA, horB, sunSide * sunSide);

  vec3 col = mix(hor, mid, smoothstep(0.0, 0.22, h));
  col = mix(col, zenith, smoothstep(0.18, 0.75, h));
  // 地平线以下:城市雾霾
  col = mix(col, vec3(0.12, 0.07, 0.12), smoothstep(0.0, -0.12, h));

  // 太阳
  float disk = smoothstep(0.9993, 0.9997, sd);
  col += vec3(4.0, 2.6, 1.4) * disk;
  col += vec3(1.2, 0.55, 0.2) * pow(max(sd, 0.0), 12.0) * 0.8;
  col += vec3(0.9, 0.35, 0.12) * pow(max(sd, 0.0), 3.0) * 0.25 * (1.0 - smoothstep(0.0, 0.5, h));

  // 星星
  if (h > 0.15) {
    vec2 sp = d.xz / (d.y + 0.3) * 180.0;
    vec2 cell = floor(sp);
    float r = hash(cell);
    if (r > 0.985) {
      vec2 c = cell + vec2(hash(cell + 3.1), hash(cell + 7.7));
      float st = smoothstep(0.35, 0.0, length(sp - c)) * (0.5 + 0.5 * sin(time * 2.0 + r * 60.0));
      col += vec3(0.9, 0.9, 1.0) * st * smoothstep(0.15, 0.6, h) * 0.8;
    }
  }

  // 云层
  if (h > 0.0) {
    vec2 cp = d.xz / (d.y + 0.12) * 1.4 + vec2(time * 0.004, time * 0.0015);
    float n = fbm(cp * 1.3);
    float dens = smoothstep(0.52 - cloudAmt * 0.1, 0.78, n) * smoothstep(0.0, 0.08, h);
    float thick = fbm(cp * 2.6 + 5.0);
    vec3 lit = mix(vec3(0.55, 0.25, 0.35), vec3(1.5, 0.62, 0.28), sunSide);
    vec3 shade = vec3(0.12, 0.08, 0.16);
    vec3 cc = mix(lit, shade, smoothstep(0.3, 0.8, thick) * 0.7);
    cc += vec3(1.4, 0.7, 0.3) * pow(max(sd, 0.0), 8.0) * 1.2;
    col = mix(col, cc, dens * 0.85);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

export function createSky(scene, renderer) {
  const uniforms = {
    sunDir: { value: SUN_DIR.clone() },
    time: { value: 0 },
    cloudAmt: { value: 1.0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, vertexShader: vert, fragmentShader: frag,
    side: THREE.BackSide, depthWrite: false, fog: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(2500, 48, 24), mat);
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  scene.add(sky);

  // 环境贴图:单独场景渲染天空
  const envScene = new THREE.Scene();
  const envSky = new THREE.Mesh(new THREE.SphereGeometry(100, 48, 24), mat.clone());
  envSky.material.uniforms = {
    sunDir: uniforms.sunDir, time: { value: 0 }, cloudAmt: { value: 0.6 },
  };
  envScene.add(envSky);
  // 地面反射:暗色城市光
  const ground = new THREE.Mesh(new THREE.CircleGeometry(90, 32),
    new THREE.MeshBasicMaterial({ color: 0x1a1420 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -12;
  envScene.add(ground);
  const pm = new THREE.PMREMGenerator(renderer);
  const env = pm.fromScene(envScene, 0.02).texture;
  scene.environment = env;
  pm.dispose();

  return {
    mesh: sky,
    update(t, camPos) {
      uniforms.time.value = t;
      sky.position.copy(camPos);
    },
  };
}
