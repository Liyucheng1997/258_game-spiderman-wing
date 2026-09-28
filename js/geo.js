// 几何批处理:把大量盒子/任意几何合并进少量 BufferGeometry(按材质+分块)
import * as THREE from 'three';

const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _nm = new THREE.Matrix3();

export class Bucket {
  constructor() {
    this.pos = []; this.nrm = []; this.uv = []; this.col = []; this.idx = [];
  }
  get count() { return this.pos.length / 3; }

  // 四边形:p0 左下 p1 右下 p2 右上 p3 左上(从外侧看逆时针)
  quad(p0, p1, p2, p3, n, uvs, color = null) {
    const base = this.count;
    for (const p of [p0, p1, p2, p3]) this.pos.push(p[0], p[1], p[2]);
    for (let i = 0; i < 4; i++) {
      this.nrm.push(n[0], n[1], n[2]);
      this.uv.push(uvs[i][0], uvs[i][1]);
      if (color) this.col.push(color[0], color[1], color[2]);
      else this.col.push(1, 1, 1);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /**
   * 轴对齐盒子
   * uvFn(face, a, y, faceW, h) → [u, v];  face: px nx pz nz py ny
   *   侧面: a 为沿面水平距离(从外看从左到右), y 为世界高度
   *   顶/底: a = x, y = z
   * faces: 字符串包含要生成的面, 默认 'pxnxpznzpy'
   */
  box(x0, y0, z0, x1, y1, z1, uvFn, faces = 'px nx pz nz py', color = null) {
    const w = x1 - x0, d = z1 - z0;
    const side = (face, pts, n, fw) => {
      const uvs = [
        uvFn(face, 0, y0, fw, y1 - y0), uvFn(face, fw, y0, fw, y1 - y0),
        uvFn(face, fw, y1, fw, y1 - y0), uvFn(face, 0, y1, fw, y1 - y0),
      ];
      this.quad(pts[0], pts[1], pts[2], pts[3], n, uvs, color);
    };
    if (faces.includes('pz')) side('pz', [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], w);
    if (faces.includes('nz')) side('nz', [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1], w);
    if (faces.includes('px')) side('px', [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0], d);
    if (faces.includes('nx')) side('nx', [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0], d);
    if (faces.includes('py')) {
      this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0],
        [uvFn('py', x0, z1), uvFn('py', x1, z1), uvFn('py', x1, z0), uvFn('py', x0, z0)], color);
    }
    if (faces.includes('ny')) {
      this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0],
        [uvFn('ny', x0, z0), uvFn('ny', x1, z0), uvFn('ny', x1, z1), uvFn('ny', x0, z1)], color);
    }
  }

  // 追加任意几何(应用矩阵);uvScale 可缩放 uv
  geometry(geo, matrix, color = null, uvScale = 1) {
    const g = geo.index ? geo : geo;
    const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
    const c = g.attributes.color;
    _nm.getNormalMatrix(matrix);
    const base = this.count;
    for (let i = 0; i < p.count; i++) {
      _v.fromBufferAttribute(p, i).applyMatrix4(matrix);
      this.pos.push(_v.x, _v.y, _v.z);
      if (n) { _n.fromBufferAttribute(n, i).applyMatrix3(_nm).normalize(); this.nrm.push(_n.x, _n.y, _n.z); }
      else this.nrm.push(0, 1, 0);
      if (uv) this.uv.push(uv.getX(i) * uvScale, uv.getY(i) * uvScale); else this.uv.push(0, 0);
      if (color) this.col.push(color[0], color[1], color[2]);
      else if (c) this.col.push(c.getX(i), c.getY(i), c.getZ(i));
      else this.col.push(1, 1, 1);
    }
    if (g.index) {
      const ia = g.index.array;
      for (let i = 0; i < ia.length; i++) this.idx.push(base + ia[i]);
    } else {
      for (let i = 0; i < p.count; i++) this.idx.push(base + i);
    }
  }

  build() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    geo.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1)
      : new THREE.Uint16BufferAttribute(this.idx, 1));
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    return geo;
  }
}

// 按 (材质名, 分块) 管理多个 Bucket
export class BucketSet {
  constructor(chunkSize = 0, offset = 0) {
    this.map = new Map();
    this.chunkSize = chunkSize;
    this.offset = offset;
  }
  get(mat, x = 0, z = 0) {
    let key = mat;
    if (this.chunkSize > 0) {
      const cx = Math.floor((x + this.offset) / this.chunkSize);
      const cz = Math.floor((z + this.offset) / this.chunkSize);
      key += `:${cx}_${cz}`;
    }
    let b = this.map.get(key);
    if (!b) { b = new Bucket(); b.mat = mat; this.map.set(key, b); }
    return b;
  }
  // materials: { name: Material }
  addTo(parent, materials, { cast = true, receive = true } = {}) {
    for (const b of this.map.values()) {
      if (b.count === 0) continue;
      const m = new THREE.Mesh(b.build(), materials[b.mat]);
      m.castShadow = cast && !materials[b.mat].userData.noShadow;
      m.receiveShadow = receive;
      parent.add(m);
    }
  }
}

// 常用 uv 函数:世界尺度
export const uvWorld = (s = 1) => (face, a, y) => (face === 'py' || face === 'ny' ? [a * s, y * s] : [a * s, y * s]);
