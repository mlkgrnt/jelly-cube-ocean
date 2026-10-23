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
