// 果冻方块海洋 · 果冻方块本体
// createJellyGeometry: 超椭球（squircle）几何，指数越高越方。
// createJellyMaterial: 前后双壳的糖果材质——厚度做 Beer-Lambert 吸收、
//   弯折屏幕坐标做折射、菲涅尔边缘 + 双高光 + 焦散。
// JellyBody: 把双壳网格 + 一池弹簧脉冲 + 挤压/晃动的物理打包在一起。
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { BG_GLSL } from './backdrop.js';
import { getPalette } from './palettes.js';
import { clamp, lerp, rand, pick, mixHex, shadeHex, tuneHex } from './core.js';

const isCoarsePointer =
  typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(pointer: coarse)').matches
    : false;

// jelly-cube.js — the jelly material.
// A superellipsoid ("squircle") body whose vertices are displaced on the GPU by
// a small pool of spring-driven impulses, so poking / pulling deforms the
// surface without touching the CPU vertex buffer. The fragment side fakes a
// volume: analytic ray-box thickness drives Beer-Lambert absorption, the
// background is re-sampled through a bent screen coordinate for refraction,
// and fresnel rim + dual speculars + caustics sell the candy look.
// ---------------------------------------------------------------------------
const JELLY_MAX_IMPULSES = 6;


// Rounded cube: map every direction to the surface |x|^p+|y|^p+|z|^p = 1.
// p = 2 -> sphere, p -> inf -> cube.  p ~ 5.5 gives a lovely soft jelly cube.
function createJellyGeometry(segments = 44, exponent = 11.0, radius = 1.0) {
  const geo = new THREE.BoxGeometry(1, 1, 1, segments, segments, segments);
  const pos = geo.attributes.position;
  const count = pos.count;
  const outPos = new Float32Array(count * 3);
  const outNor = new Float32Array(count * 3);
  const v = new THREE.Vector3();
  const p = exponent;

  for (let i = 0; i < count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const ax = Math.abs(v.x), ay = Math.abs(v.y), az = Math.abs(v.z);
    const s = Math.pow(Math.pow(ax, p) + Math.pow(ay, p) + Math.pow(az, p), -1 / p);
    const x = v.x * s * radius, y = v.y * s * radius, z = v.z * s * radius;
    outPos[i * 3] = x; outPos[i * 3 + 1] = y; outPos[i * 3 + 2] = z;

    // analytic gradient of the superellipsoid => exact smooth normals (no seams)
    const gx = Math.sign(x) * Math.pow(Math.abs(x / radius) + 1e-6, p - 1);
    const gy = Math.sign(y) * Math.pow(Math.abs(y / radius) + 1e-6, p - 1);
    const gz = Math.sign(z) * Math.pow(Math.abs(z / radius) + 1e-6, p - 1);
    const gl = Math.hypot(gx, gy, gz) || 1;
    outNor[i * 3] = gx / gl; outNor[i * 3 + 1] = gy / gl; outNor[i * 3 + 2] = gz / gl;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(outPos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(outNor, 3));
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}

const JELLY_VERT = /* glsl */`
  uniform float uTime;
  uniform vec3  uSquash;
  uniform vec4  uImp[${JELLY_MAX_IMPULSES}];
  uniform vec3  uImpDir[${JELLY_MAX_IMPULSES}];
  uniform float uImpAmp[${JELLY_MAX_IMPULSES}];
  uniform float uImpCount;
  uniform float uRipple;

  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  varying vec3 vViewNormal;
  varying vec3 vLocalPos;

  vec3 jellyDisplace(vec3 p) {
    vec3 disp = vec3(0.0);
    for (int i = 0; i < ${JELLY_MAX_IMPULSES}; i++) {
      if (float(i) >= uImpCount) break;
      vec3 d = p - uImp[i].xyz;
      float r = max(uImp[i].w, 0.08);
      float w = exp(-dot(d, d) / (r * r));
      disp += uImpDir[i] * (uImpAmp[i] * w);
    }
    return disp;
  }

  // slow surface-tension breathing, always alive
  float jellyWave(vec3 p) {
    return sin(p.x * 2.1 + uTime * 1.05) * sin(p.y * 2.7 - uTime * 0.83)
         * sin(p.z * 2.3 + uTime * 1.21);
  }

  vec3 jellySurface(vec3 p, out float wave) {
    vec3 q = p * uSquash;
    wave = jellyWave(p);
    vec3 nrm = normalize(p + 1e-5);
    return q + jellyDisplace(p) + nrm * wave * uRipple;
  }

  void main() {
    vec3 n0 = normalize(normal);
    vec3 t1 = normalize(abs(n0.y) < 0.9 ? cross(n0, vec3(0.0, 1.0, 0.0)) : cross(n0, vec3(1.0, 0.0, 0.0)));
    vec3 t2 = cross(n0, t1);

    float wave;
    vec3 P  = jellySurface(position, wave);
    float w1, w2;
    vec3 P1 = jellySurface(position + t1 * 0.03, w1);
    vec3 P2 = jellySurface(position + t2 * 0.03, w2);

    vec3 nrm = normalize(cross(P1 - P, P2 - P));
    if (dot(nrm, n0) < 0.0) nrm = -nrm;

    vec4 world = modelMatrix * vec4(P, 1.0);
    vWorldPos = world.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * nrm);
    vViewNormal = normalize(mat3(viewMatrix) * vWorldNormal);
    vLocalPos = P;

    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const JELLY_FRAG = /* glsl */`
  precision highp float;

  uniform vec3  uColor;
  uniform vec3  uDeep;
  uniform vec3  uRim;
  uniform vec3  uAccent;
  uniform float uOpacity;
  uniform float uTime;
  uniform float uKind;       // 1 = front shell, 0 = back shell
  uniform float uRefract;
  uniform vec3  uCamLocal;
  uniform vec3  uLightA;
  uniform vec3  uLightB;
  uniform vec2  uResolution;
  uniform sampler2D uBgTex;

  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  varying vec3 vViewNormal;
  varying vec3 vLocalPos;

  float hash31(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float vnoise(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash31(i), hash31(i + vec3(1.0, 0.0, 0.0)), f.x),
          mix(hash31(i + vec3(0.0, 1.0, 0.0)), hash31(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
      mix(mix(hash31(i + vec3(0.0, 0.0, 1.0)), hash31(i + vec3(1.0, 0.0, 1.0)), f.x),
          mix(hash31(i + vec3(0.0, 1.0, 1.0)), hash31(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
  }

  // distance from an interior point to the far side of the [-1,1] cube
  float rayBoxExit(vec3 p, vec3 rd) {
    vec3 inv = 1.0 / (rd + vec3(1e-5));
    vec3 t1 = (-1.0 - p) * inv;
    vec3 t2 = ( 1.0 - p) * inv;
    vec3 tm = max(t1, t2);
    return max(min(tm.x, min(tm.y, tm.z)), 0.0);
  }

  void main() {
    vec3 N = normalize(vWorldNormal);
    vec3 V = normalize(cameraPosition - vWorldPos);
    float ndv = clamp(dot(N, V), 0.0, 1.0);
    float fres = pow(1.0 - ndv, 1.85);

    vec3 rd = normalize(vLocalPos - uCamLocal);
    float thick = clamp(rayBoxExit(vLocalPos, rd) * 0.5, 0.0, 1.0);   // 0..1

    // --- what is behind, refracted through the jelly ---------------------
    vec2 suv = gl_FragCoord.xy / uResolution;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 bend = vViewNormal.xy * uRefract * (0.35 + 0.65 * (1.0 - fres));
    vec3 behind = texture2D(uBgTex, clamp(suv + bend, vec2(0.001), vec2(0.999))).rgb;

    // --- internal body colour -------------------------------------------
    vec3 tint = mix(uColor, uDeep, smoothstep(0.0, 1.0, thick) * 0.92);
    // a soft glow pooling at the bottom of the block, like light through candy
    float floorGlow = smoothstep(0.35, -1.05, vLocalPos.y);
    tint += uAccent * floorGlow * 0.22;
    // and a cool tint creeping in from the top, like a waterline
    tint = mix(tint, mix(tint, vec3(0.86, 0.97, 1.0), 0.35), smoothstep(0.3, 1.05, vLocalPos.y) * 0.5);
    float caust = vnoise(vLocalPos * 4.2 + vec3(0.0, uTime * 0.2, uTime * 0.12));
    caust = smoothstep(0.52, 0.96, caust);
    vec3 irid = 0.5 + 0.5 * cos(6.28318 * (fres * 0.9 + vec3(0.0, 0.33, 0.67)));

    // sunlight pooling on the top face, wobbling like it's seen through water
    float topFace = smoothstep(0.55, 1.0, N.y);
    float caust2 = vnoise(vLocalPos * 3.1 + vec3(uTime * 0.16, 0.0, uTime * 0.1));
    float topLight = topFace * smoothstep(0.42, 0.92, caust2) * 0.22;

    vec3 col;
    float a;
    if (uKind > 0.5) {
      // front shell: mostly a refractive skin with a bright fresnel rim
      col = mix(tint, behind * mix(vec3(1.0), uColor, 0.55), 0.18);
      col += uAccent * caust * 0.10;
      col += uRim * topLight;
      // slow "jelly shimmer" travelling diagonally through the body
      float shimmer = sin((vLocalPos.x + vLocalPos.y * 1.6 + vLocalPos.z * 0.8) * 2.4 - uTime * 0.9);
      col += uRim * smoothstep(0.86, 1.0, shimmer) * 0.10;
      col = mix(col, uRim, fres * 0.72);
      col += irid * fres * 0.18;

      vec3 L1 = normalize(uLightA);
      float s1 = pow(max(dot(N, normalize(L1 + V)), 0.0), 150.0) * 2.4;
      float s1b = pow(max(dot(N, normalize(L1 + V)), 0.0), 14.0) * 0.16;
      vec3 L2 = normalize(uLightB);
      float s2 = pow(max(dot(N, normalize(L2 + V)), 0.0), 30.0) * 0.5;
      // a crisp travelling glint along the top edges
      float edge = smoothstep(0.86, 1.0, 1.0 - abs(dot(N, normalize(vec3(0.0, 1.0, 0.0)))));
      float glint = edge * pow(max(dot(reflect(-L1, N), V), 0.0), 26.0) * 1.3;
      col += uRim * (s1 + s1b + s2 + glint);

      a = uOpacity * (0.26 + 0.74 * fres);
      a += topLight * 0.35;
      a += s1 * 0.9 + s2 * 0.4 + glint * 0.5;
      a += caust * 0.05 * (1.0 - uOpacity);
    } else {
      // back shell: denser and darker, this is what gives the jelly volume
      col = mix(tint * 0.9, uDeep, 0.35);
      col = mix(col, behind * mix(vec3(1.0), uColor, 0.5), 0.45);
      col += uAccent * caust * 0.07;
      col = mix(col, uRim, fres * 0.35);
      a = uOpacity * (0.4 + 0.45 * (1.0 - fres));
      a *= 0.95;
    }
    a = clamp(a, 0.0, 0.97);

    gl_FragColor = vec4(col, a);
  }
`;

function createJellyMaterial(kind = 'front') {
  const makeImp = () => new THREE.Vector4(0, 0, 0, 0.5);
  const makeDir = () => new THREE.Vector3(0, 1, 0);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSquash: { value: new THREE.Vector3(1, 1, 1) },
      uImp: { value: Array.from({ length: JELLY_MAX_IMPULSES }, makeImp) },
      uImpDir: { value: Array.from({ length: JELLY_MAX_IMPULSES }, makeDir) },
      uImpAmp: { value: new Float32Array(JELLY_MAX_IMPULSES) },
      uImpCount: { value: 0 },
      uRipple: { value: 0.012 },
      uColor: { value: new THREE.Color('#8ef0d8') },
      uDeep: { value: new THREE.Color('#43b7cf') },
      uRim: { value: new THREE.Color('#ffffff') },
      uAccent: { value: new THREE.Color('#ffffff') },
      uOpacity: { value: 0.6 },
      uRefract: { value: kind === 'front' ? 0.035 : 0.06 },
      uKind: { value: kind === 'front' ? 1 : 0 },
      uCamLocal: { value: new THREE.Vector3() },
      uLightA: { value: new THREE.Vector3(0.45, 0.85, 0.55).normalize() },
      uLightB: { value: new THREE.Vector3(-0.55, -0.15, -0.75).normalize() },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uBgTex: { value: null },
    },
    vertexShader: JELLY_VERT,
    fragmentShader: JELLY_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: kind === 'front' ? THREE.FrontSide : THREE.BackSide,
  });
  return mat;
}

// jelly-cube.js — the jelly body: dual-shell mesh, spring impulses, squash,
// shake, poking and pulling. Everything the rest of the app touches goes
// through this class.
// ---------------------------------------------------------------------------
const JELLY_RADIUS = 2.05;                 // world half-size of the jelly cube
const JELLY_INNER = JELLY_RADIUS * 0.80;   // creatures stay inside this
const JELLY_SEGMENTS = isCoarsePointer ? 30 : 46;
const JELLY_EXPONENT = 11.0;               // lower = rounder, higher = boxier

class JellyBody {
  constructor(scene, opts = {}) {
    this.group = new THREE.Group();
    this.group.position.set(0, 0, 0);
    scene.add(this.group);

    this.geo = createJellyGeometry(JELLY_SEGMENTS, JELLY_EXPONENT, JELLY_RADIUS);
    this.frontMat = createJellyMaterial('front');
    this.backMat = createJellyMaterial('back');

    this.backMesh = new THREE.Mesh(this.geo, this.backMat);
    this.backMesh.renderOrder = -2;
    this.backMesh.frustumCulled = false;
    this.group.add(this.backMesh);

    this.frontMesh = new THREE.Mesh(this.geo, this.frontMat);
    this.frontMesh.renderOrder = 2;
    this.frontMesh.frustumCulled = false;
    this.group.add(this.frontMesh);

    // --- springs ---------------------------------------------------------
    this.impulses = [];
    for (let i = 0; i < JELLY_MAX_IMPULSES; i++) {
      this.impulses.push({ pos: new THREE.Vector3(0, 1, 0), dir: new THREE.Vector3(0, 1, 0), amp: 0, vel: 0, radius: 0.45 });
    }
    this.squash = new THREE.Vector3(1, 1, 1);
    this.squashVel = new THREE.Vector3(0, 0, 0);
    this.tilt = new THREE.Vector3(0, 0, 0);
    this.tiltVel = new THREE.Vector3(0, 0, 0);
    this.bob = 0;
    this.bobVel = 0;
    this.wobbleSeed = rand(0, 100);
    this.time = 0;
    this.drag = null;

    this.physics = { omega: 9.5, zeta: 0.28, radius: 0.5, ripple: 0.014, squashK: 16, squashC: 3.4 };
    this.setPhysics(
      opts.softness === undefined ? 0.55 : opts.softness,
      opts.bounce === undefined ? 0.6 : opts.bounce,
    );
    this.setPalette(opts.palette || getPalette('mint'));
    this.setClarity(opts.clarity === undefined ? 0.62 : opts.clarity);
  }

  // ---- appearance -------------------------------------------------------
  setPalette(p) {
    this.palette = p;
    // the raw palette colours are pale pastels; the jelly needs more pigment
    const pigmented = tuneHex(p.jelly, 1.75, 0.88);
    const light = pigmented;
    const deep = shadeHex(pigmented, -0.55);
    for (const m of [this.frontMat, this.backMat]) {
      m.uniforms.uColor.value.set(light);
      m.uniforms.uDeep.value.set(deep);
      m.uniforms.uAccent.value.set(p.accent);
      m.uniforms.uRim.value.set(mixHex('#ffffff', pigmented, 0.18));

    }
    // the front shell absorbs less, the back shell carries the volume colour
    this.frontMat.uniforms.uDeep.value.set(shadeHex(pigmented, -0.34));
  }

  setBackgroundTexture(tex) {
    for (const m of [this.frontMat, this.backMat]) m.uniforms.uBgTex.value = tex;
  }

  setResolution(w, h) {
    for (const m of [this.frontMat, this.backMat]) m.uniforms.uResolution.value.set(w, h);
  }

  setClarity(c) {
    this.clarity = clamp(c, 0, 1);
    this.frontMat.uniforms.uOpacity.value = lerp(1.0, 0.55, this.clarity);
    this.backMat.uniforms.uOpacity.value = lerp(1.0, 0.68, this.clarity);
  }

  setPhysics(softness, bounce) {
    const s = clamp(softness, 0, 1), b = clamp(bounce, 0, 1);
    this.physics.omega = lerp(11.5, 4.4, s);
    this.physics.zeta = lerp(0.72, 0.075, b);
    this.physics.radius = lerp(0.34, 0.78, s);
    this.physics.ripple = lerp(0.0035, 0.030, s);
    this.physics.squashK = lerp(34, 11, s);
    this.physics.squashC = lerp(9.0, 1.4, b);
    this.frontMat.uniforms.uRipple.value = this.physics.ripple;
    this.backMat.uniforms.uRipple.value = this.physics.ripple;
  }

  // ---- impulses ---------------------------------------------------------
  addImpulse(localPoint, direction, strength, radiusScale = 1) {
    let slot = this.impulses[0];
    for (const imp of this.impulses) if (Math.abs(imp.amp) < Math.abs(slot.amp)) slot = imp;
    slot.pos.copy(localPoint);
    slot.dir.copy(direction).normalize();
    slot.amp = strength;
    slot.vel = 0;
    slot.radius = this.physics.radius * radiusScale;
    return slot;
  }

  // poke: dent inward along the surface normal, then wobble back out
  poke(localPoint, worldNormal, strength = 1) {
    const dir = worldNormal.clone().applyQuaternion(this.group.quaternion.clone().invert()).normalize();
    const imp = this.addImpulse(localPoint, dir, -0.55 * strength, 1.2);
    // visible squash of the whole body along the hit axis
    const ax = dir.clone().multiplyScalar(0.12 * strength);
    this.squashVel.x -= ax.x * this.physics.squashK * 0.10;
    this.squashVel.y -= ax.y * this.physics.squashK * 0.10;
    this.squashVel.z -= ax.z * this.physics.squashK * 0.10;
    this.bobVel -= 0.45 * strength;
    this.tiltVel.x += rand(-0.35, 0.35) * strength;
    this.tiltVel.z += rand(-0.35, 0.35) * strength;
  }

  shake(strength = 1) {
    this.tiltVel.x += rand(-1.5, 1.5) * strength;
    this.tiltVel.z += rand(-1.5, 1.5) * strength;
    this.squashVel.x += rand(-0.8, 0.8) * strength;
    this.squashVel.z += rand(-0.8, 0.8) * strength;
    this.bobVel -= 0.8 * strength;
    for (let i = 0; i < 3; i++) {
      const d = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize();
      const p = d.clone().multiplyScalar(JELLY_RADIUS * 0.72);
      this.addImpulse(p, d, rand(0.05, 0.11) * strength, 1.5);
    }
  }

  // ---- dragging ---------------------------------------------------------
  beginDrag(localPoint, worldNormal) {
    const dir = worldNormal.clone().applyQuaternion(this.group.quaternion.clone().invert()).normalize();
    const imp = this.addImpulse(localPoint, dir, 0, 1.35);
    this.drag = { imp, anchor: localPoint.clone(), normal: dir };
  }

  // drag by a *world-space* offset: the surface follows the cursor like taffy
  moveDragWorld(worldDelta) {
    if (!this.drag) return;
    const { imp, anchor } = this.drag;
    const local = worldDelta.clone().applyQuaternion(this.group.quaternion.clone().invert());
    local.divide(this.group.scale);
    const len = Math.min(local.length(), 1.5);
    const dir = len > 1e-4 ? local.clone().normalize() : imp.dir.clone();
    imp.pos.copy(anchor).add(dir.clone().multiplyScalar(len * 0.45));
    imp.dir.copy(dir);
    imp.amp = len * 1.35;
    imp.vel = 0;
    imp.radius = this.physics.radius * (1.15 + len * 0.5);
  }

  moveDrag(localPoint) {
    if (!this.drag) return;
    this.moveDragWorld(localPoint.clone().sub(this.drag.anchor));
  }

  endDrag() {
    if (!this.drag) return;
    const imp = this.drag.imp;
    imp.vel = imp.amp * this.physics.omega * 0.9;
    this.drag = null;
  }

  // ---- per frame --------------------------------------------------------
  // fixed sub-steps keep the wobble identical at 30 / 60 / 144 fps
  step(h) {
    const ph = this.physics;
    for (const imp of this.impulses) {
      const acc = -ph.omega * ph.omega * imp.amp - 2 * ph.zeta * ph.omega * imp.vel;
      imp.vel += acc * h;
      imp.amp += imp.vel * h;
      if (Math.abs(imp.amp) < 1e-4 && Math.abs(imp.vel) < 1e-4) { imp.amp = 0; imp.vel = 0; }
    }
    for (const k of ['x', 'y', 'z']) {
      const acc = -ph.squashK * (this.squash[k] - 1) - ph.squashC * this.squashVel[k];
      this.squashVel[k] += acc * h;
      this.squash[k] = clamp(this.squash[k] + this.squashVel[k] * h, 0.72, 1.3);
    }
    for (const k of ['x', 'y', 'z']) {
      const acc = -26 * this.tilt[k] - 4.2 * this.tiltVel[k];
      this.tiltVel[k] += acc * h;
      this.tilt[k] += this.tiltVel[k] * h;
    }
    const bacc = -30 * this.bob - 3.4 * this.bobVel;
    this.bobVel += bacc * h;
    this.bob += this.bobVel * h;
  }

  update(dt, t) {
    this.time = t;
    const ph = this.physics;

    const steps = Math.min(6, Math.max(1, Math.ceil(dt / (1 / 120))));
    const h = dt / steps;
    for (let s = 0; s < steps; s++) this.step(h);

    const breathe = Math.sin(t * 0.9 + this.wobbleSeed) * 0.006 + Math.sin(t * 1.7 + this.wobbleSeed * 2) * 0.003;
    const gy = Math.sin(t * 0.8 + 1.3) * 0.035;

    this.group.position.y = gy + this.bob * 0.12;
    this.group.rotation.set(this.tilt.x * 0.16, this.tilt.y * 0.12, this.tilt.z * 0.16);

    const sx = this.squash.x + breathe;
    const sy = this.squash.y + breathe;
    const sz = this.squash.z + breathe;
    this.group.scale.set(sx, sy, sz);

    const imps = this.impulses.slice().sort((a, b) => Math.abs(b.amp) - Math.abs(a.amp));
    let n = 0;
    for (let i = 0; i < JELLY_MAX_IMPULSES; i++) {
      const imp = imps[i];
      if (!imp || Math.abs(imp.amp) < 1e-5) continue;
      for (const m of [this.frontMat, this.backMat]) {
        m.uniforms.uImp.value[i].set(imp.pos.x, imp.pos.y, imp.pos.z, imp.radius);
        m.uniforms.uImpDir.value[i].copy(imp.dir);
        m.uniforms.uImpAmp.value[i] = imp.amp;
      }
      n++;
    }
    for (const m of [this.frontMat, this.backMat]) {
      m.uniforms.uImpCount.value = n;
      m.uniforms.uTime.value = t;
      m.uniforms.uSquash.value.set(sx, sy, sz);
    }
  }

  updateCamera(camera) {
    this.group.updateMatrixWorld();
    const inv = new THREE.Matrix4().copy(this.group.matrixWorld).invert();
    const local = camera.position.clone().applyMatrix4(inv);
    this.frontMat.uniforms.uCamLocal.value.copy(local);
    this.backMat.uniforms.uCamLocal.value.copy(local);
  }

  // ---- picking ----------------------------------------------------------
  pick(raycaster) {
    const hits = raycaster.intersectObject(this.frontMesh, false);
    if (!hits.length) return null;
    const hit = hits[0];
    const local = this.group.worldToLocal(hit.point.clone());
    const normal = hit.face ? hit.face.normal.clone() : local.clone().normalize();
    const worldNormal = normal.applyQuaternion(this.group.quaternion).normalize();
    return { point: hit.point.clone(), local, normal, worldNormal, distance: hit.distance };
  }
}

export {
  createJellyGeometry, createJellyMaterial, JELLY_MAX_IMPULSES,
  JELLY_VERT, JELLY_FRAG, JellyBody,
  JELLY_RADIUS, JELLY_INNER, JELLY_SEGMENTS, JELLY_EXPONENT,
};
