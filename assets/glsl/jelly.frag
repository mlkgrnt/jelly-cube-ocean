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
