// 果冻方块海洋 · 六只低多边形水箱生物
// CREATURE_BUILDERS[id](ctx) -> THREE.Group
//   ctx = { palette, tint, rng }   rng 是 seeded 随机，同一个种子长同一只鱼
// 坐标约定：原点居中、约 1 单位长、鼻子朝 +Z、尾巴朝 -Z。
// 完全程序化：躯体是「旋转曲面 + 半径剖面 + 逐面上色」，鳍是挤出的细轮廓，
// 眼睛是嵌进表面的球冠并沿法线朝向，嘴是贴着表面走的小管子。零贴图、零 DOM。
// userData: kind / speed / wobble / materials / animate(t, dt) / tris
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { TAU, clamp, lerp, smoothstep, mixHex, shadeHex } from './core.js';

// creatures.js — six low-poly jelly-friends (teammate: creature-artist)
// ---------------------------------------------------------------------------
// CREATURE_BUILDERS[id](ctx) -> THREE.Group, centred on the origin, ~1 unit
// long, facing +Z (nose at +Z, tail at -Z).
//
// userData: kind, speed {min,max}, wobble, materials {body, accent},
//           animate(t, dt), tris
//
// All procedural: bodies are surfaces of revolution driven by a radius
// profile and coloured per-face with vertex colours, so bellies / stripes cost
// no extra triangles and can never z-fight. Fins are thin extruded outlines.
// Eyes are spherical caps embedded in the surface and oriented along its
// normal; mouths are tiny tubes following the surface. No textures, no DOM.
// ---------------------------------------------------------------------------

const _CR_INK = '#2b2436';
const _CR_EYE = '#fffdf8';
const _CR_BLUSH = '#ff9fc4';

const _CR_GEO = {};

// --- materials / colours ---------------------------------------------------
function _crColor(v) { return v && v.isColor ? v.clone() : new THREE.Color(v); }

function _crMat(color, o) {
  o = o || {};
  const m = new THREE.MeshStandardMaterial({
    color: _crColor(color),
    roughness: o.roughness === undefined ? 0.46 : o.roughness,
    metalness: 0,
    flatShading: o.flat === undefined ? true : o.flat,
  });
  if (o.glow) {
    m.emissive = _crColor(o.glow);
    m.emissiveIntensity = o.glowIntensity === undefined ? 0.1 : o.glowIntensity;
  }
  if (o.opacity !== undefined) { m.transparent = true; m.opacity = o.opacity; }
  if (o.side) m.side = o.side;
  if (o.vertexColors) m.vertexColors = true;
  if (o.depthWrite !== undefined) m.depthWrite = o.depthWrite;
  return m;
}

// emissive colour: species colour nudged toward the jelly tint so the whole
// cast feels like it lives inside the same block of jelly.
function _crGlow(color, tint, amount) {
  const c = _crColor(color);
  if (tint) c.lerp(tint, amount === undefined ? 0.16 : amount);
  c.lerp(new THREE.Color('#ffffff'), 0.16);
  return c;
}

function _crBallGeo(w, h) {
  const k = w + 'x' + h;
  return _CR_GEO[k] || (_CR_GEO[k] = new THREE.SphereGeometry(1, w, h));
}
function _crBall(mat, sx, sy, sz, w, h) {
  const m = new THREE.Mesh(_crBallGeo(w || 10, h || 7), mat);
  m.scale.set(sx, sy, sz);
  return m;
}

// spherical cap, pole on +Y
function _crCapGeo(w, h, a) {
  const k = 'cap' + w + 'x' + h + 'x' + a.toFixed(2);
  return _CR_GEO[k] || (_CR_GEO[k] = new THREE.SphereGeometry(1, w, h, 0, TAU, 0, a));
}

// --- surfaces of revolution ------------------------------------------------
// profile = [[t, r], ...]; t = 0 at the tail, t = 1 at the nose, r = 0..1.
function _crSampleProfile(pts, t) {
  let i = 0;
  while (i < pts.length - 2 && pts[i + 1][0] < t) i++;
  const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1];
  const p3 = pts[Math.min(pts.length - 1, i + 2)];
  const span = p2[0] - p1[0];
  const u = clamp(span > 1e-6 ? (t - p1[0]) / span : 0, 0, 1);
  const v0 = p0[1], v1 = p1[1], v2 = p2[1], v3 = p3[1];
  const r = 0.5 * ((2 * v1) + (-v0 + v2) * u +
    (2 * v0 - 5 * v1 + 4 * v2 - v3) * u * u +
    (-v0 + 3 * v1 - 3 * v2 + v3) * u * u * u);
  return Math.max(0, r);
}

function _crBodyRadius(o, t) {
  return _crSampleProfile(o.profile, t) * (o.radius === undefined ? 0.34 : o.radius);
}

// ang: 0 = +X, PI/2 = +Y (up), -PI/2 = -Y (belly)
function _crBodyPoint(o, t, ang) {
  const r = _crBodyRadius(o, t);
  const wx = o.wx === undefined ? 1 : o.wx;
  const wy = o.wy === undefined ? 1 : o.wy;
  return new THREE.Vector3(Math.cos(ang) * r * wx, Math.sin(ang) * r * wy, lerp(o.z0, o.z1, t));
}

const _crV1 = new THREE.Vector3(), _crV2 = new THREE.Vector3(), _crV3 = new THREE.Vector3();
function _crFrame(o, t, ang) {
  const e = 0.012;
  const a = _crBodyPoint(o, Math.max(0, t - e), ang);
  const b = _crBodyPoint(o, Math.min(1, t + e), ang);
  const c = _crBodyPoint(o, t, ang + e);
  const d = _crBodyPoint(o, t, ang - e);
  _crV1.subVectors(b, a);
  _crV2.subVectors(c, d);
  const n = new THREE.Vector3().crossVectors(_crV1, _crV2);
  if (n.lengthSq() < 1e-10) n.set(0, 0, 1);
  n.normalize();
  const p = _crBodyPoint(o, t, ang);
  // orient outward. Testing against the radial (x, y) direction is degenerate
  // near the nose, where the normal is almost pure +Z, so test against the
  // position vector instead and fall back to +Z when that is tiny.
  _crV3.copy(p);
  if (_crV3.lengthSq() < 1e-6) _crV3.set(0, 0, 1);
  if (n.dot(_crV3) < 0) n.negate();
  return { p, n };
}

function _crBodyGeo(o) {
  const rings = o.rings || 13;
  const segs = o.segs || 10;
  const z0 = o.z0, z1 = o.z1;
  const wx = o.wx === undefined ? 1 : o.wx;
  const wy = o.wy === undefined ? 1 : o.wy;

  const pos = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    // the profiles taper to 0 at both ends, so the poles close themselves
    const r = Math.max(0.002, _crBodyRadius(o, t));
    const z = lerp(z0, z1, t);
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * TAU;
      pos.push(Math.cos(a) * r * wx, Math.sin(a) * r * wy, z);
    }
  }

  const idx = [];
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      const jn = (j + 1) % segs;
      const a = i * segs + j, b = i * segs + jn;
      const c = (i + 1) * segs + j, d = (i + 1) * segs + jn;
      idx.push(a, c, b, b, c, d);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();

  if (o.paint) {
    // Faces are emitted ring-major, two triangles per quad, so the face index
    // identifies the quad exactly. Painting per quad keeps stripe / belly edges
    // crisp (matching the flat shading) without sawtoothing across a quad.
    const step = TAU / segs;
    const perRing = segs * 2;
    return _crPaintFaces(g, (col, cx, cy, cz, f) => {
      const i = Math.floor(f / perRing);
      const j = Math.floor((f % perRing) / 2);
      o.paint(col, (i + 0.5) / rings, (j + 0.5) * step);
    });
  }
  return g;
}

// per-face vertex colours (converts to non-indexed). fn(color, cx, cy, cz, faceIndex)
function _crPaintFaces(geo, fn) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i += 3) {
    const cx = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3;
    const cy = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3;
    const cz = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;
    fn(c, cx, cy, cz, i / 3);
    for (let k = 0; k < 3; k++) {
      col[(i + k) * 3] = c.r;
      col[(i + k) * 3 + 1] = c.g;
      col[(i + k) * 3 + 2] = c.b;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// soft belly mask: 1 straight under the body, 0 on the flanks / back.
// ang is the 0..TAU ring angle; the belly sits at 3PI/2, so wrap the delta.
function _crBellyMix(ang, spread) {
  const s = spread === undefined ? 1.6 : spread;
  let d = ang + Math.PI / 2;
  d = Math.abs(Math.atan2(Math.sin(d), Math.cos(d)));
  return 1 - smoothstep(s * 0.62, s * 1.15, d);
}

// --- fins ------------------------------------------------------------------
function _crFinShape(pts) {
  const clean = [];
  for (const p of pts) {
    const last = clean[clean.length - 1];
    if (last && Math.abs(last[0] - p[0]) < 1e-4 && Math.abs(last[1] - p[1]) < 1e-4) continue;
    clean.push(p);
  }
  if (clean.length > 2) {
    const a = clean[0], b = clean[clean.length - 1];
    if (Math.abs(a[0] - b[0]) < 1e-4 && Math.abs(a[1] - b[1]) < 1e-4) clean.pop();
  }
  const s = new THREE.Shape();
  s.moveTo(clean[0][0], clean[0][1]);
  for (let i = 1; i < clean.length; i++) s.lineTo(clean[i][0], clean[i][1]);
  s.closePath();
  return s;
}

function _crBez(p0, p1, p2, n) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([
      u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
      u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
    ]);
  }
  return out;
}

// thin slab from an outline; cup bends it along local Z so it catches light
function _crFinGeo(pts, thick, cup) {
  const t = thick === undefined ? 0.018 : thick;
  const g = new THREE.ExtrudeGeometry(_crFinShape(pts), {
    depth: t, bevelEnabled: false, curveSegments: 1,
  });
  g.translate(0, 0, -t * 0.5);
  if (cup) {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) + Math.abs(p.getY(i)) * cup);
    p.needsUpdate = true;
  }
  g.computeVertexNormals();
  return g;
}

// forked fish tail. local: +X = backwards, +Y = up
function _crTailOutline(len, spread, notch) {
  notch = notch === undefined ? 0.42 : notch;
  const pts = [];
  pts.push(..._crBez([0, 0], [len * 0.4, spread * 0.74], [len * 0.95, spread * 0.98], 4));
  pts.push(..._crBez([len * 0.95, spread * 0.98], [len * 0.94, spread * 0.52], [len * notch, 0], 3));
  pts.push(..._crBez([len * notch, 0], [len * 0.94, -spread * 0.52], [len * 0.95, -spread * 0.98], 3));
  pts.push(..._crBez([len * 0.95, -spread * 0.98], [len * 0.4, -spread * 0.74], [0, 0], 4));
  return pts;
}

// rounded paddle tail
function _crRoundTailOutline(len, spread) {
  const pts = [];
  pts.push(..._crBez([0, 0], [len * 0.6, spread * 0.76], [len, spread * 0.46], 3));
  pts.push(..._crBez([len, spread * 0.46], [len * 1.06, 0], [len, -spread * 0.46], 3));
  pts.push(..._crBez([len, -spread * 0.46], [len * 0.6, -spread * 0.76], [0, 0], 3));
  return pts;
}

// dorsal sail
function _crDorsalOutline(len, height) {
  const pts = [];
  pts.push(..._crBez([0, 0], [len * 0.06, height * 1.04], [len * 0.46, height], 3));
  pts.push(..._crBez([len * 0.46, height], [len * 0.9, height * 0.48], [len, 0], 3));
  return pts;
}

// rounded paddle fin. local: +X = outward, +Y = backwards
function _crPaddleOutline(len, width) {
  const pts = [];
  const n = 7;
  for (let i = 0; i <= n; i++) {
    const a = Math.PI * (i / n);
    pts.push([Math.sin(a) * len, Math.cos(a) * width * 0.5]);
  }
  pts.push([len * 0.1, 0]);
  return pts;
}

// whale fluke: two lobes, +Y = backwards
function _crFlukeOutline(len, spread) {
  const pts = [];
  pts.push(..._crBez([0, 0], [spread * 0.52, len * 0.48], [spread * 0.99, len], 3));
  pts.push(..._crBez([spread * 0.99, len], [spread * 0.3, len * 0.96], [0, len * 0.72], 3));
  pts.push(..._crBez([0, len * 0.72], [-spread * 0.3, len * 0.96], [-spread * 0.99, len], 3));
  pts.push(..._crBez([-spread * 0.99, len], [-spread * 0.52, len * 0.48], [0, 0], 3));
  return pts;
}

// flat tapered ribbon along a polyline; dir is the preferred width axis
function _crRibbonGeo(pts, w0, w1, dir) {
  const pos = [];
  const n = pts.length;
  const t = new THREE.Vector3();
  const s = new THREE.Vector3();
  const pref = dir ? new THREE.Vector3(dir[0], dir[1], dir[2]).normalize() : new THREE.Vector3(1, 0, 0);
  for (let i = 0; i < n - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    t.subVectors(b, a).normalize();
    s.copy(pref).addScaledVector(t, -pref.dot(t));
    if (s.lengthSq() < 1e-8) s.set(0, 1, 0);
    s.normalize();
    const wa = lerp(w0, w1, i / (n - 1)) * 0.5;
    const wb = lerp(w0, w1, (i + 1) / (n - 1)) * 0.5;
    const a1 = [a.x + s.x * wa, a.y + s.y * wa, a.z + s.z * wa];
    const a2 = [a.x - s.x * wa, a.y - s.y * wa, a.z - s.z * wa];
    const b1 = [b.x + s.x * wb, b.y + s.y * wb, b.z + s.z * wb];
    const b2 = [b.x - s.x * wb, b.y - s.y * wb, b.z - s.z * wb];
    pos.push(...a1, ...b1, ...b2, ...a1, ...b2, ...a2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// small round tube through a list of points (mouths)
function _crTubeGeo(pts, radius, segs) {
  const curve = new THREE.CatmullRomCurve3(pts);
  return new THREE.TubeGeometry(curve, segs || 6, radius, 3, false);
}

// --- face bits -------------------------------------------------------------
function _crFaceMats() {
  return {
    white: _crMat(_CR_EYE, { roughness: 0.24, flat: false, glow: '#ffffff', glowIntensity: 0.05 }),
    ink: _crMat(_CR_INK, { roughness: 0.16, flat: false }),
    hi: new THREE.MeshBasicMaterial({ color: 0xffffff }),
  };
}

// eyeball + pupil cap + two highlights. +Z is the gaze direction.
function _crEye(mats, r) {
  const g = new THREE.Group();
  // slightly flattened eyeball, front at z = +0.82 r
  const white = new THREE.Mesh(_crBallGeo(7, 5), mats.white);
  white.scale.set(r, r * 1.02, r * 0.84);
  g.add(white);

  // pupil: a flattened ball riding on the front of the eye. It breaks the white
  // surface so the eye reads as a black dot inside a white ring from any angle,
  // while staying small enough that plenty of sclera stays visible.
  const pupil = new THREE.Mesh(_crBallGeo(5, 4), mats.ink);
  pupil.scale.set(r * 0.5, r * 0.52, r * 0.46);
  // centre far enough forward that the pupil clearly breaks the white surface
  pupil.position.z = r * 0.6;
  g.add(pupil);

  const hi = new THREE.Mesh(_crBallGeo(3, 2), mats.hi);
  hi.scale.setScalar(r * 0.19);
  hi.position.set(-r * 0.2, r * 0.24, r * 0.72);
  g.add(hi);

  const hi2 = new THREE.Mesh(_crBallGeo(3, 2), mats.hi);
  hi2.scale.setScalar(r * 0.09);
  hi2.position.set(r * 0.19, -r * 0.16, r * 0.72);
  g.add(hi2);
  return g;
}

// seat an eye in the surface at p with normal n (about half the ball shows).
// gaze biases the pupil away from the raw normal toward +Z, so both eyes look
// forward instead of staring off to the sides.
function _crEyeAt(mats, r, p, n, gaze) {
  const g = _crEye(mats, r);
  const dir = n.clone().normalize();
  const look = dir.clone().lerp(new THREE.Vector3(0, 0, 1), gaze === undefined ? 0.45 : gaze);
  // the surface normal can tip backwards near the tail; force the gaze forward
  // so the pupil (which rides on the eye's local +Z) always faces the camera
  if (look.z < 0.25) look.z = 0.25;
  look.normalize();
  g.position.copy(p).addScaledVector(dir, r * 0.34);
  g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), look);
  return g;
}

function _crEyesAt(mats, r, o, t, ang, gaze) {
  const g = new THREE.Group();
  for (let s = -1; s <= 1; s += 2) {
    const f = _crFrame(o, t, s > 0 ? ang : Math.PI - ang);
    g.add(_crEyeAt(mats, r, f.p, f.n, gaze));
  }
  return g;
}

// translucent blush cap hugging the surface
function _crBlushAt(p, n, r, color, opacity) {
  const mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(color || _CR_BLUSH),
    transparent: true, opacity: opacity === undefined ? 0.55 : opacity,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const m = new THREE.Mesh(_crCapGeo(6, 1, 0.62), mat);
  m.scale.set(r, r, r);
  const dir = n.clone().normalize();
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  m.position.copy(p).addScaledVector(dir, r * 0.02);
  return m;
}

function _crBlushPair(o, t, ang, r, color, opacity) {
  const g = new THREE.Group();
  for (let s = -1; s <= 1; s += 2) {
    const f = _crFrame(o, t, s > 0 ? ang : Math.PI - ang);
    g.add(_crBlushAt(f.p, f.n, r, color, opacity));
  }
  return g;
}

// z of the front-facing surface for a given lateral/vertical offset (x, y).
// The body is a surface of revolution, so a cross-section radius fixes t.
function _crSurfaceZ(o, x, y) {
  const wx = o.wx === undefined ? 1 : o.wx;
  const wy = o.wy === undefined ? 1 : o.wy;
  const rho = Math.hypot(x / wx, y / wy);
  let best = 1;
  // walk from the nose back until the profile is at least rho wide
  for (let i = 100; i >= 0; i--) {
    const t = i / 100;
    if (_crBodyRadius(o, t) >= rho) { best = t; break; }
  }
  return lerp(o.z0, o.z1, best);
}

// smile drawn on the nose: a filled crescent that hugs the front surface, so it
// reads clearly even when the creature is only a few dozen pixels tall.
// cx/cy = centre offset, halfW = half width, drop = how far the middle dips.
function _crMouthOnNose(o, cx, cy, halfW, drop, color, thickness) {
  const t = thickness === undefined ? 0.012 : thickness;
  const pos = [];
  const N = 8;
  const top = [], bot = [];
  for (let i = 0; i <= N; i++) {
    const s = (i / N) * 2 - 1;
    const x = cx + s * halfW;
    const y = cy - (1 - s * s) * drop;
    const taper = 1 - Math.pow(Math.abs(s), 2.2) * 0.75;
    const z = _crSurfaceZ(o, x, y) + 0.005;
    top.push(new THREE.Vector3(x, y + t * 0.5 * taper, z));
    bot.push(new THREE.Vector3(x, y - t * 0.5 * taper, z));
  }
  for (let i = 0; i < N; i++) {
    const a = top[i], b = top[i + 1], c = bot[i + 1], d = bot[i];
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    pos.push(a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return new THREE.Mesh(
    g,
    new THREE.MeshBasicMaterial({ color: new THREE.Color(color || '#c26b83'), side: THREE.DoubleSide })
  );
}

// small open mouth dot on the nose (puffer / o-mouth)
function _crOohMouth(o, cx, cy, r, color) {
  const z = _crSurfaceZ(o, cx, cy);
  const m = new THREE.Mesh(
    _crBallGeo(6, 4),
    _crMat(color || '#8a6a4a', { roughness: 0.4, flat: false })
  );
  m.scale.set(r, r * 0.9, r * 0.42);
  // sit on the surface: half of the bead pokes out of the skin
  m.position.set(cx, cy, z + r * 0.34);
  return m;
}

// normalise the outer size: scale so the longest axis is exactly 'target',
// then re-centre on the origin (the fins can push the box off-centre).
function _crFit(root, target) {
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  box.getSize(size);
  const longest = Math.max(size.x, size.y, size.z);
  if (longest > 1e-6) {
    const k = target / longest;
    if (Math.abs(k - 1) > 0.02) root.scale.multiplyScalar(k);
  }
  const box2 = new THREE.Box3().setFromObject(root);
  const c = new THREE.Vector3();
  box2.getCenter(c);
  root.position.sub(c);
  return root;
}

function _crCountTris(root) {
  let n = 0;
  root.traverse(o => {
    if (o.isMesh && o.geometry) {
      const g = o.geometry;
      n += g.index ? g.index.count / 3 : g.attributes.position.count / 3;
    }
  });
  return n;
}

function _crFinish(group, kind, mats, animate, speed, wobble) {
  group.userData.kind = kind;
  group.userData.materials = mats;
  group.userData.speed = speed || { min: 0.25, max: 0.5 };
  group.userData.wobble = wobble === undefined ? 0.5 : wobble;
  if (animate) group.userData.animate = animate;
  group.userData.tris = _crCountTris(group);
  return group;
}

// vertical tail fin on a pivot (so it can wag)
function _crTailFin(geo, mat, z, y) {
  const pivot = new THREE.Group();
  pivot.position.set(0, y || 0, z);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.y = Math.PI / 2;
  pivot.add(mesh);
  return { pivot, mesh };
}

// pectoral fin on a pivot; local +X points away from the body
function _crPectoral(geo, mat, x, y, z, flip) {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, z);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  if (flip) mesh.rotation.z = Math.PI;
  pivot.add(mesh);
  return { pivot, mesh };
}


// ---------------------------------------------------------------------------
// 1. 小金鱼 — round orange body, big forked tail, cream belly
// ---------------------------------------------------------------------------
function _crBuildGoldfish(ctx) {
  const palette = ctx.palette, tint = ctx.tint, rng = ctx.rng;
  const g = new THREE.Group();
  const inner = new THREE.Group();
  g.add(inner);

  const bodyCol = mixHex('#ff9a3c', palette.jelly, 0.03);
  const finCol = mixHex('#ffb457', palette.jelly, 0.05);
  const bellyCol = '#ffeecb';

  const body = {
    profile: [[0, 0], [0.06, 0.32], [0.14, 0.56], [0.24, 0.77], [0.36, 0.92],
      [0.48, 0.99], [0.6, 1.0], [0.71, 0.97], [0.81, 0.89], [0.89, 0.75],
      [0.92, 0.62], [0.96, 0.44], [0.99, 0.24], [1, 0]],
    radius: 0.33, z0: -0.36, z1: 0.42, wx: 0.9, wy: 1.0,
  };
  const cBase = new THREE.Color(bodyCol);
  const cBelly = new THREE.Color(bellyCol);

  const matBody = _crMat('#ffffff', {
    roughness: 0.42, vertexColors: true,
    glow: _crGlow(bodyCol, tint), glowIntensity: 0.09,
  });
  inner.add(new THREE.Mesh(_crBodyGeo({
    ...body, rings: 18, segs: 12,
    paint: (c, t, ang) => c.copy(cBase).lerp(cBelly, _crBellyMix(ang, 1.62)),
  }), matBody));

  const matFin = _crMat(finCol, {
    roughness: 0.42, side: THREE.DoubleSide,
    glow: _crGlow(finCol, tint), glowIntensity: 0.14,
  });

  const tail = _crTailFin(_crFinGeo(_crTailOutline(0.3, 0.29, 0.42), 0.018, 0.16), matFin, -0.35, 0);
  inner.add(tail.pivot);

  const dorsal = new THREE.Mesh(_crFinGeo(_crDorsalOutline(0.28, 0.15), 0.016, 0.1), matFin);
  dorsal.rotation.y = Math.PI / 2;
  dorsal.position.set(0, 0.29, -0.06);
  inner.add(dorsal);

  const pL = _crPectoral(_crFinGeo(_crPaddleOutline(0.19, 0.14), 0.014, 0.12), matFin, -0.315, -0.1, 0.1, true);
  const pR = _crPectoral(_crFinGeo(_crPaddleOutline(0.19, 0.14), 0.014, 0.12), matFin, 0.315, -0.1, 0.1, false);
  inner.add(pL.pivot, pR.pivot);

  const eyeMats = _crFaceMats();
  inner.add(_crEyesAt(eyeMats, 0.086, body, 0.8, 0.6, 0.5));
  inner.add(_crBlushPair(body, 0.72, -0.22, 0.062, '#ff92b8', 0.42));
  inner.add(_crMouthOnNose(body, 0, 0.005, 0.052, 0.03, '#b9647c', 0.015));

  const phase = rng() * TAU;
  _crFit(g, 1.02);
  _crFinish(g, 'goldfish', { body: matBody, accent: matFin }, (t) => {
    const s = Math.sin(t * 3.4 + phase);
    tail.pivot.rotation.y = s * 0.4;
    tail.pivot.rotation.z = Math.sin(t * 1.7 + phase) * 0.1;
    inner.rotation.z = Math.sin(t * 1.5 + phase) * 0.05;
    inner.position.y = Math.sin(t * 1.25 + phase) * 0.014;
    pL.pivot.rotation.z = 0.16 + s * 0.3;
    pR.pivot.rotation.z = -0.16 - s * 0.3;
  }, { min: 0.26, max: 0.54 }, 0.55);

  return g;
}

// ---------------------------------------------------------------------------
// 2. 小丑鱼 — slim orange body, three cream bands, round tail
// ---------------------------------------------------------------------------
function _crBuildClownfish(ctx) {
  const palette = ctx.palette, tint = ctx.tint, rng = ctx.rng;
  const g = new THREE.Group();
  const inner = new THREE.Group();
  g.add(inner);

  const bodyCol = mixHex('#ff7d38', palette.jelly, 0.02);
  const creamCol = '#fff6e8';

  const body = {
    profile: [[0, 0], [0.07, 0.3], [0.16, 0.53], [0.26, 0.73], [0.37, 0.88],
      [0.48, 0.96], [0.59, 1.0], [0.69, 0.99], [0.78, 0.93], [0.86, 0.82],
      [0.9, 0.68], [0.95, 0.5], [0.98, 0.3], [1, 0]],
    radius: 0.3, z0: -0.4, z1: 0.46, wx: 0.82, wy: 1.0,
  };
  const cBase = new THREE.Color(bodyCol);
  const cCream = new THREE.Color(creamCol);
  // 24 rings: band edges land exactly on ring vertices, so each stripe keeps a
  // crisp edge while the vertex interpolation stays smooth
  const RINGS = 24;
  const bands = [[2 / RINGS, 5 / RINGS], [9 / RINGS, 14 / RINGS], [18 / RINGS, 22 / RINGS]];

  const matBody = _crMat('#ffffff', {
    roughness: 0.42, vertexColors: true,
    glow: _crGlow(bodyCol, tint), glowIntensity: 0.09,
  });
  inner.add(new THREE.Mesh(_crBodyGeo({
    ...body, rings: RINGS, segs: 12,
    paint: (c, t, ang) => {
      let inBand = false;
      for (let i = 0; i < bands.length; i++) if (t >= bands[i][0] - 1e-6 && t <= bands[i][1] + 1e-6) inBand = true;
      c.copy(inBand ? cCream : cBase);
      // a whisper of cream underneath so the body still feels rounded
      c.lerp(cCream, _crBellyMix(ang, 1.1) * (inBand ? 0 : 0.12));
    },
  }), matBody));

  const finCol = mixHex('#ffa163', palette.jelly, 0.05);
  const matFin = _crMat(finCol, {
    roughness: 0.42, side: THREE.DoubleSide,
    glow: _crGlow(finCol, tint), glowIntensity: 0.14,
  });

  const tail = _crTailFin(_crFinGeo(_crRoundTailOutline(0.23, 0.21), 0.016, 0.1), matFin, -0.38, 0);
  inner.add(tail.pivot);

  const dorsal = new THREE.Mesh(_crFinGeo(_crDorsalOutline(0.32, 0.13), 0.014, 0.08), matFin);
  dorsal.rotation.y = Math.PI / 2;
  dorsal.position.set(0, 0.25, -0.07);
  inner.add(dorsal);

  const pL = _crPectoral(_crFinGeo(_crPaddleOutline(0.17, 0.12), 0.012, 0.1), matFin, -0.265, -0.09, 0.08, true);
  const pR = _crPectoral(_crFinGeo(_crPaddleOutline(0.17, 0.12), 0.012, 0.1), matFin, 0.265, -0.09, 0.08, false);
  inner.add(pL.pivot, pR.pivot);

  const eyeMats = _crFaceMats();
  inner.add(_crEyesAt(eyeMats, 0.08, body, 0.79, 0.62, 0.5));
  inner.add(_crBlushPair(body, 0.7, -0.2, 0.058, '#ff8fb0', 0.42));
  inner.add(_crMouthOnNose(body, 0, 0.025, 0.046, 0.026, '#b45f77', 0.013));

  const phase = rng() * TAU;
  _crFit(g, 1.06);
  _crFinish(g, 'clownfish', { body: matBody, accent: matFin }, (t) => {
    const s = Math.sin(t * 4.1 + phase);
    tail.pivot.rotation.y = s * 0.46;
    inner.rotation.z = Math.sin(t * 1.9 + phase) * 0.045;
    inner.position.y = Math.sin(t * 1.6 + phase) * 0.014;
    pL.pivot.rotation.z = 0.18 + s * 0.34;
    pR.pivot.rotation.z = -0.18 - s * 0.34;
  }, { min: 0.32, max: 0.62 }, 0.5);

  return g;
}

// ---------------------------------------------------------------------------
// 3. 小水母 — translucent lathe bell, glowing pearl, wavy tentacles
// ---------------------------------------------------------------------------
function _crBuildJellyfish(ctx) {
  const palette = ctx.palette, tint = ctx.tint, rng = ctx.rng;
  const g = new THREE.Group();
  const inner = new THREE.Group();
  g.add(inner);

  const bellCol = mixHex('#ffbcdd', palette.jelly, 0.08);
  const rimCol = mixHex('#ff8fc4', palette.jelly, 0.03);
  const armCol = mixHex('#ffa8d2', palette.jelly, 0.05);

  const matBell = new THREE.MeshPhysicalMaterial({
    color: _crColor(bellCol),
    roughness: 0.1, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.12,
    transparent: true, opacity: 0.6, side: THREE.DoubleSide,
    flatShading: true, depthWrite: false,
    emissive: _crGlow(bellCol, tint, 0.06), emissiveIntensity: 0.16,
  });
  const matRim = _crMat(rimCol, {
    roughness: 0.3, glow: _crGlow(rimCol, tint), glowIntensity: 0.2,
    opacity: 0.92, flat: false,
  });
  const matArm = _crMat(armCol, {
    roughness: 0.34, side: THREE.DoubleSide, opacity: 0.8,
    glow: _crGlow(armCol, tint), glowIntensity: 0.2,
  });
  const matPearl = _crMat('#fff0f8', { roughness: 0.18, glow: '#ffd0ea', glowIntensity: 0.9 });

  const bellPivot = new THREE.Group();
  bellPivot.position.y = 0.0;
  inner.add(bellPivot);

  // dome: lathe profile [radius, y], top pole -> shoulder -> rim lip.
  // radius at height y is interpolated for placing the face exactly on it.
  // wide + flat mushroom cap: the height is roughly half the diameter, which
  // reads as a jellyfish rather than a balloon
  const DOME = [
    [0.0, 0.3], [0.12, 0.292], [0.23, 0.272], [0.33, 0.238], [0.41, 0.19],
    [0.465, 0.13], [0.5, 0.062], [0.515, 0.0], [0.512, -0.045], [0.478, -0.07],
  ];
  const domePts = [];
  for (const d of DOME) domePts.push(new THREE.Vector2(d[0], d[1]));
  const bell = new THREE.Mesh(new THREE.LatheGeometry(domePts, 12), matBell);
  bellPivot.add(bell);

  // radius of the dome at height y (linear scan over the profile)
  const domeR = (y) => {
    for (let i = 0; i < DOME.length - 1; i++) {
      const a = DOME[i], b = DOME[i + 1];
      if (y <= a[1] && y >= b[1]) {
        const f = (a[1] - y) / Math.max(1e-6, a[1] - b[1]);
        return lerp(a[0], b[0], f);
      }
    }
    return 0;
  };

  const pearl = new THREE.Mesh(_crBallGeo(6, 4), matPearl);
  pearl.scale.setScalar(0.07);
  pearl.position.y = 0.1;
  bellPivot.add(pearl);

  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.508, 0.019, 3, 16), matRim);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = -0.05;
  bellPivot.add(rim);

  const beadMat = new THREE.MeshBasicMaterial({ color: 0xfff6fc });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + 0.3;
    const bead = new THREE.Mesh(_crBallGeo(4, 2), beadMat);
    bead.scale.setScalar(0.017);
    bead.position.set(Math.cos(a) * 0.508, -0.05, Math.sin(a) * 0.508);
    bellPivot.add(bead);
  }

  // oral arms (thick) + thin tentacles, hanging from the rim
  const arms = [];
  const hang = (i, N, thick, len, r0, phase0) => {
    const a = (i / N) * TAU + phase0;
    const pivot = new THREE.Group();
    pivot.position.set(Math.cos(a) * r0, -0.06, Math.sin(a) * r0);
    const pts = [];
    const segs = 6;
    for (let k = 0; k <= segs; k++) {
      const f = k / segs;
      // S-shaped drift so the strands look like they trail through water
      const sway = Math.sin(f * 4.2 + i * 1.7) * 0.085 * f;
      const curl = Math.sin(f * 2.1 + i * 0.9) * 0.03 * f;
      pts.push(new THREE.Vector3(
        Math.cos(a) * (sway + curl) - Math.cos(a) * f * 0.03,
        -f * len,
        Math.sin(a) * (sway + curl) - Math.sin(a) * f * 0.03
      ));
    }
    const m = new THREE.Mesh(_crRibbonGeo(pts, thick, thick * 0.25, [-Math.sin(a), 0, Math.cos(a)]), matArm);
    pivot.add(m);
    inner.add(pivot);
    arms.push({ pivot, phase: i * 0.85 });
  };
  // 4 soft oral arms + 10 thin trailing strands
  for (let i = 0; i < 4; i++) hang(i, 4, 0.07, 0.34, 0.2, 0.4);
  for (let i = 0; i < 10; i++) hang(i, 10, 0.026, 0.62, 0.42, 0.15);

  // --- face, placed directly on the dome surface ---
  const eyeMats = _crFaceMats();
  const EYE_Y = 0.075, EYE_X = 0.155;
  for (let s = -1; s <= 1; s += 2) {
    const rAt = domeR(EYE_Y);
    const zz = Math.sqrt(Math.max(0.0001, rAt * rAt - EYE_X * EYE_X));
    const p = new THREE.Vector3(s * EYE_X, EYE_Y, zz);
    const n = new THREE.Vector3(s * EYE_X * 0.9, 0.05, zz).normalize();
    inner.add(_crEyeAt(eyeMats, 0.082, p, n));
  }

  // blush sits just below the eyes, on the cheek area of the dome
  const CHEEK_Y = 0.03, CHEEK_X = 0.33;
  for (let s = -1; s <= 1; s += 2) {
    const rAt = domeR(CHEEK_Y);
    const zz = Math.sqrt(Math.max(0.0001, rAt * rAt - CHEEK_X * CHEEK_X));
    const p = new THREE.Vector3(s * CHEEK_X, CHEEK_Y, zz);
    const n = new THREE.Vector3(s * 0.85, 0.05, zz / Math.max(0.05, rAt)).normalize();
    inner.add(_crBlushAt(p, n, 0.058, '#ff7fb6', 0.52));
  }

  // U mouth, projected onto the dome just under the eyes
  const mouthPts = [];
  for (let i = 0; i <= 6; i++) {
    const f = i / 6;
    const s = (f - 0.5) * 2;
    const ax = s * 0.068;
    const ay = 0.028 - (1 - s * s) * 0.022;
    const rAt = domeR(ay);
    const zz = Math.sqrt(Math.max(0.0001, rAt * rAt - ax * ax));
    mouthPts.push(new THREE.Vector3(ax, ay, zz + 0.006));
  }
  inner.add(new THREE.Mesh(
    _crTubeGeo(mouthPts, 0.0085, 6),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#c4668f') })
  ));

  const phase = rng() * TAU;
  _crFit(g, 0.95);
  _crFinish(g, 'jellyfish', { body: matBell, accent: matArm }, (t) => {
    const p = Math.sin(t * 1.7 + phase);
    bellPivot.scale.set(1 + p * 0.08, 1 - p * 0.1, 1 + p * 0.08);
    bellPivot.position.y = p * 0.03;
    inner.position.y = Math.sin(t * 1.1 + phase) * 0.022;
    for (let i = 0; i < arms.length; i++) {
      const a = arms[i];
      a.pivot.rotation.z = Math.sin(t * 1.6 + a.phase) * 0.13;
      a.pivot.rotation.x = Math.cos(t * 1.35 + a.phase) * 0.11;
    }
    pearl.position.y = 0.1 + Math.sin(t * 2.2 + phase) * 0.018;
  }, { min: 0.1, max: 0.24 }, 0.85);

  return g;
}

// ---------------------------------------------------------------------------
// 4. 小鲸鱼 — round blue body, cream belly, tiny spout
// ---------------------------------------------------------------------------
function _crBuildWhale(ctx) {
  const palette = ctx.palette, tint = ctx.tint, rng = ctx.rng;
  const g = new THREE.Group();
  const inner = new THREE.Group();
  g.add(inner);

  const bodyCol = mixHex('#5ea4e8', palette.jelly, 0.04);
  const finCol = mixHex('#79b3ee', palette.jelly, 0.04);
  const bellyCol = '#fff2dc';

  const body = {
    profile: [[0, 0], [0.07, 0.38], [0.16, 0.6], [0.27, 0.79], [0.39, 0.92],
      [0.51, 0.99], [0.63, 1.0], [0.74, 0.97], [0.83, 0.9], [0.9, 0.78],
      [0.92, 0.64], [0.96, 0.46], [0.99, 0.26], [1, 0]],
    radius: 0.37, z0: -0.42, z1: 0.44, wx: 0.9, wy: 0.98,
  };
  const cBase = new THREE.Color(bodyCol);
  const cBelly = new THREE.Color(bellyCol);

  const matBody = _crMat('#ffffff', {
    roughness: 0.42, vertexColors: true,
    glow: _crGlow(bodyCol, tint), glowIntensity: 0.09,
  });
  inner.add(new THREE.Mesh(_crBodyGeo({
    ...body, rings: 18, segs: 12,
    paint: (c, t, ang) => c.copy(cBase).lerp(cBelly, _crBellyMix(ang, 1.55)),
  }), matBody));

  const matFin = _crMat(finCol, {
    roughness: 0.42, side: THREE.DoubleSide,
    glow: _crGlow(finCol, tint), glowIntensity: 0.14,
  });

  const tailPivot = new THREE.Group();
  tailPivot.position.set(0, -0.01, -0.4);
  const fluke = new THREE.Mesh(_crFinGeo(_crFlukeOutline(0.28, 0.27), 0.018, 0.12), matFin);
  fluke.rotation.x = -Math.PI / 2;
  tailPivot.add(fluke);
  inner.add(tailPivot);

  const dorsal = new THREE.Mesh(_crFinGeo(_crDorsalOutline(0.2, 0.12), 0.016, 0.07), matFin);
  dorsal.rotation.y = Math.PI / 2;
  dorsal.position.set(0, 0.33, -0.12);
  inner.add(dorsal);

  const pL = _crPectoral(_crFinGeo(_crPaddleOutline(0.26, 0.16), 0.016, 0.14), matFin, -0.35, -0.16, 0.06, true);
  const pR = _crPectoral(_crFinGeo(_crPaddleOutline(0.26, 0.16), 0.016, 0.14), matFin, 0.35, -0.16, 0.06, false);
  inner.add(pL.pivot, pR.pivot);

  // blowhole + spout
  const hole = new THREE.Mesh(_crBallGeo(4, 3), _crMat('#3f6b9e', { roughness: 0.4 }));
  hole.scale.set(0.028, 0.012, 0.045);
  hole.position.set(0, 0.362, 0.07);
  inner.add(hole);

  const spout = new THREE.Group();
  spout.position.set(0, 0.36, 0.07);
  const dropMat = _crMat('#eaf7ff', { roughness: 0.16, glow: '#ffffff', glowIntensity: 0.5 });
  for (const d of [[0, 0.075, 0, 0.04], [-0.058, 0.15, 0.012, 0.029],
    [0.064, 0.145, -0.01, 0.031], [0.004, 0.215, 0.016, 0.023]]) {
    const m = new THREE.Mesh(_crBallGeo(5, 3), dropMat);
    m.scale.setScalar(d[3]);
    m.position.set(d[0], d[1], d[2]);
    spout.add(m);
  }
  inner.add(spout);

  const eyeMats = _crFaceMats();
  inner.add(_crEyesAt(eyeMats, 0.082, body, 0.84, 0.58, 0.5));
  inner.add(_crBlushPair(body, 0.74, -0.2, 0.056, '#ff9ec6', 0.42));
  inner.add(_crMouthOnNose(body, 0, 0.02, 0.052, 0.028, '#3f74a8', 0.014));

  const phase = rng() * TAU;
  _crFit(g, 1.16);
  _crFinish(g, 'whale', { body: matBody, accent: matFin }, (t) => {
    const s = Math.sin(t * 2.1 + phase);
    tailPivot.rotation.x = s * 0.3;
    inner.rotation.z = Math.sin(t * 1.1 + phase) * 0.035;
    inner.position.y = Math.sin(t * 1.05 + phase) * 0.018;
    pL.pivot.rotation.z = 0.14 + s * 0.2;
    pR.pivot.rotation.z = -0.14 - s * 0.2;
    spout.scale.setScalar(0.94 + Math.sin(t * 2.6 + phase) * 0.07);
  }, { min: 0.18, max: 0.4 }, 0.35);

  return g;
}

// ---------------------------------------------------------------------------
// 5. 小河豚 — lime ball, little spikes, puffed cheeks
// ---------------------------------------------------------------------------
function _crBuildPuffer(ctx) {
  const palette = ctx.palette, tint = ctx.tint, rng = ctx.rng;
  const g = new THREE.Group();
  const inner = new THREE.Group();
  g.add(inner);

  const bodyCol = mixHex('#c8e05e', palette.jelly, 0.03);
  const finCol = mixHex('#e2ea8c', palette.jelly, 0.05);
  const bellyCol = '#fdfbdf';

  const body = {
    profile: [[0, 0], [0.07, 0.5], [0.16, 0.73], [0.28, 0.9], [0.4, 0.98],
      [0.52, 1.0], [0.64, 1.0], [0.75, 0.97], [0.85, 0.88], [0.92, 0.72],
      [0.94, 0.56], [0.98, 0.32], [1, 0]],
    radius: 0.43, z0: -0.38, z1: 0.4, wx: 1.0, wy: 0.96,
  };
  const cBase = new THREE.Color(bodyCol);
  const cBelly = new THREE.Color(bellyCol);

  const matBody = _crMat('#ffffff', {
    roughness: 0.42, vertexColors: true,
    glow: _crGlow(bodyCol, tint), glowIntensity: 0.09,
  });
  inner.add(new THREE.Mesh(_crBodyGeo({
    ...body, rings: 18, segs: 12,
    paint: (c, t, ang) => c.copy(cBase).lerp(cBelly, _crBellyMix(ang, 1.5)),
  }), matBody));

  const matFin = _crMat(finCol, {
    roughness: 0.42, side: THREE.DoubleSide,
    glow: _crGlow(finCol, tint), glowIntensity: 0.14,
  });
  const matSpike = _crMat(mixHex('#a3c44a', palette.jelly, 0.02), {
    roughness: 0.44, glow: _crGlow('#a3c44a', tint), glowIntensity: 0.07,
  });

  // spikes: fibonacci sphere, skipping the face + tail
  const spikePivot = new THREE.Group();
  inner.add(spikePivot);
  const up = new THREE.Vector3(0, 1, 0);
  const N = 28;
  const spikeGeo = _CR_GEO.spike || (_CR_GEO.spike = new THREE.ConeGeometry(0.042, 0.115, 4, 1, false));
  for (let i = 0; i < N; i++) {
    const y = 1 - (i + 0.5) * 2 / N;
    const rr = Math.sqrt(Math.max(0, 1 - y * y));
    const th = i * 2.399963;
    const d = new THREE.Vector3(Math.cos(th) * rr, y, Math.sin(th) * rr);
    if (d.z > 0.3) continue;
    if (d.z < -0.66 && Math.abs(d.y) < 0.55) continue;
    const spike = new THREE.Mesh(spikeGeo, matSpike);
    spike.position.set(d.x * 0.405, d.y * 0.39, d.z * 0.405);
    spike.quaternion.setFromUnitVectors(up, d);
    spikePivot.add(spike);
  }

  const tail = _crTailFin(_crFinGeo(_crRoundTailOutline(0.15, 0.16), 0.014, 0.08), matFin, -0.36, 0);
  inner.add(tail.pivot);

  const pL = _crPectoral(_crFinGeo(_crPaddleOutline(0.15, 0.11), 0.012, 0.08), matFin, -0.415, -0.07, 0.06, true);
  const pR = _crPectoral(_crFinGeo(_crPaddleOutline(0.15, 0.11), 0.012, 0.08), matFin, 0.415, -0.07, 0.06, false);
  inner.add(pL.pivot, pR.pivot);

  const eyeMats = _crFaceMats();
  inner.add(_crEyesAt(eyeMats, 0.09, body, 0.81, 0.62, 0.5));
  inner.add(_crBlushPair(body, 0.73, -0.2, 0.062, '#ff9ec0', 0.46));
  // small puckered mouth sitting on the nose
  inner.add(_crOohMouth(body, 0, 0.115, 0.028, '#8a6a4a'));

  const phase = rng() * TAU;
  _crFit(g, 1.1);
  _crFinish(g, 'puffer', { body: matBody, accent: matFin }, (t) => {
    const s = Math.sin(t * 1.9 + phase);
    const puff = 1 + s * 0.05;
    inner.scale.set(puff, 1 + s * 0.032, puff);
    spikePivot.scale.setScalar(1 + Math.max(0, s) * 0.12);
    inner.rotation.z = Math.sin(t * 1.2 + phase) * 0.04;
    inner.position.y = Math.sin(t * 1.5 + phase) * 0.016;
    tail.pivot.rotation.y = Math.sin(t * 4.2 + phase) * 0.38;
    pL.pivot.rotation.z = 0.18 + s * 0.26;
    pR.pivot.rotation.z = -0.18 - s * 0.26;
  }, { min: 0.14, max: 0.32 }, 0.75);

  return g;
}

// ---------------------------------------------------------------------------
// 6. 小海龟 — domed shell, big head, four flippers
// ---------------------------------------------------------------------------
function _crBuildTurtle(ctx) {
  const palette = ctx.palette, tint = ctx.tint, rng = ctx.rng;
  const g = new THREE.Group();
  const inner = new THREE.Group();
  g.add(inner);

  const shellCol = mixHex('#7fc47a', palette.jelly, 0.04);
  const shellDark = mixHex('#4f9a63', palette.jelly, 0.02);
  const skinCol = mixHex('#b6e29e', palette.jelly, 0.06);
  const bellyCol = '#fff2cf';

  const matSkin = _crMat(skinCol, { roughness: 0.44, glow: _crGlow(skinCol, tint), glowIntensity: 0.08 });
  const matBelly = _crMat(bellyCol, { roughness: 0.5, glow: _crGlow(bellyCol, tint), glowIntensity: 0.08 });
  const matRim = _crMat(shellDark, { roughness: 0.44, glow: _crGlow(shellDark, tint), glowIntensity: 0.1 });

  // --- shell: a wide squashed dome painted with a scute checkerboard ---
  const SEG = 12, ROW = 4;
  const shellGeo = new THREE.SphereGeometry(1, SEG, ROW, 0, TAU, 0, Math.PI * 0.5);
  const cBase = new THREE.Color(shellCol);
  const cDark = new THREE.Color(shellDark);
  const shellPainted = _crPaintFaces(shellGeo, (c, x, y, z, f) => {
    const ix = Math.floor((f % (SEG * 2)) / 2);
    const iy = Math.floor(f / (SEG * 2));
    const checker = (ix + iy) % 2;
    const edge = iy >= ROW - 1 ? 0.2 : 0;
    c.copy(cBase).lerp(cDark, 0.08 + checker * 0.4 + edge);
  });
  const matShell = _crMat('#ffffff', {
    roughness: 0.4, vertexColors: true,
    glow: _crGlow(shellCol, tint), glowIntensity: 0.1,
  });
  const shell = new THREE.Mesh(shellPainted, matShell);
  shell.scale.set(0.43, 0.29, 0.47);
  shell.position.y = 0.03;
  inner.add(shell);

  // rim ring + belly plate
  const rim = new THREE.Mesh(new THREE.TorusGeometry(1, 0.075, 3, 16), matRim);
  rim.rotation.x = Math.PI / 2;
  rim.scale.set(0.42, 0.46, 1);
  rim.position.y = 0.022;
  inner.add(rim);

  const plastron = new THREE.Mesh(new THREE.CircleGeometry(1, 12), matBelly);
  plastron.rotation.x = Math.PI / 2;
  plastron.scale.set(0.42, 0.46, 1);
  plastron.position.y = 0.016;
  inner.add(plastron);

  // --- head: big, round, clearly in front of the shell ---
  const headPivot = new THREE.Group();
  headPivot.position.set(0, 0.1, 0.47);
  inner.add(headPivot);
  headPivot.add(_crBall(matSkin, 0.185, 0.175, 0.215, 10, 7));

  const eyeMats = _crFaceMats();
  const headBody = { radius: 0.2, z0: -0.205, z1: 0.205, wx: 0.9, wy: 0.85, profile: [[0, 0.5], [0.5, 1], [1, 0.5]] };
  headPivot.add(_crEyesAt(eyeMats, 0.058, headBody, 0.8, 0.46, 0.55));
  headPivot.add(_crBlushPair(headBody, 0.72, -0.16, 0.046, '#ff9ec0', 0.5));
  headPivot.add(_crMouthOnNose(headBody, 0, -0.01, 0.034, 0.018, '#5f8a56', 0.011));

  // --- flippers ---
  const flippers = [];
  const flipDef = [
    [-0.395, 0.03, 0.13, 0.32, 0.21, 1],
    [0.395, 0.03, 0.13, 0.32, 0.21, -1],
    [-0.37, 0.03, -0.21, 0.24, 0.15, 1],
    [0.37, 0.03, -0.21, 0.24, 0.15, -1],
  ];
  for (const f of flipDef) {
    const pivot = new THREE.Group();
    pivot.position.set(f[0], f[1], f[2]);
    const mesh = new THREE.Mesh(_crFinGeo(_crPaddleOutline(f[3], f[4]), 0.016, 0.1), matSkin);
    mesh.rotation.x = -Math.PI / 2;
    if (f[5] < 0) mesh.rotation.z = Math.PI;
    mesh.rotation.z += f[5] * 0.16;
    pivot.add(mesh);
    inner.add(pivot);
    flippers.push({ pivot, side: f[5] });
  }

  // little tail nub
  const tail = new THREE.Mesh(_crFinGeo(_crRoundTailOutline(0.12, 0.1), 0.014), matSkin);
  tail.rotation.y = Math.PI / 2;
  tail.position.set(0, 0.035, -0.46);
  inner.add(tail);

  const phase = rng() * TAU;
  _crFit(g, 1.2);
  _crFinish(g, 'turtle', { body: matSkin, accent: matRim }, (t) => {
    inner.position.y = Math.sin(t * 1.5 + phase) * 0.016;
    inner.rotation.z = Math.sin(t * 1.1 + phase) * 0.05;
    headPivot.rotation.x = Math.sin(t * 1.7 + phase) * 0.09;
    headPivot.rotation.y = Math.sin(t * 0.9 + phase) * 0.14;
    for (let i = 0; i < flippers.length; i++) {
      const fl = flippers[i];
      const front = i < 2 ? 1 : 0.6;
      fl.pivot.rotation.z = fl.side * Math.sin(t * 2.6 + phase + i * 0.6) * 0.3 * front;
    }
  }, { min: 0.16, max: 0.34 }, 0.4);

  return g;
}

// ---------------------------------------------------------------------------
// public registry
// ---------------------------------------------------------------------------
const CREATURE_BUILDERS = {
  goldfish: _crBuildGoldfish,
  clownfish: _crBuildClownfish,
  jellyfish: _crBuildJellyfish,
  whale: _crBuildWhale,
  puffer: _crBuildPuffer,
  turtle: _crBuildTurtle,
};

// --- 兜底生物：某个 id 没有对应实现时用它，保证场景不会空 ---
function fallbackCreatureBuilder(ctx) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(0.34, 16, 12),
    new THREE.MeshStandardMaterial({ color: ctx.palette.accent, roughness: 0.4, flatShading: true })
  );
  body.scale.set(1, 0.85, 1.25);
  g.add(body);
  const tail = new THREE.Mesh(
    new THREE.ConeGeometry(0.16, 0.3, 5),
    new THREE.MeshStandardMaterial({ color: shadeHex(ctx.palette.accent, -0.15), roughness: 0.5, flatShading: true })
  );
  tail.position.z = -0.42; tail.rotation.x = Math.PI / 2;
  g.add(tail);
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), new THREE.MeshBasicMaterial({ color: 0x2b2436 }));
    eye.position.set(0.13 * s, 0.1, 0.3);
    g.add(eye);
  }
  g.userData.materials = { body: body.material, accent: tail.material };
  g.userData.animate = (t) => { tail.rotation.y = Math.sin(t * 6) * 0.5; };
  return g;
}

export { CREATURE_BUILDERS, fallbackCreatureBuilder };
