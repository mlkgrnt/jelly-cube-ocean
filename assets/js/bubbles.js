// 果冻方块海洋 · 肥皂泡材质
// 轻薄薄膜：只有菲涅尔边缘 + 两颗高光 + 一点点虹彩，几乎不遮挡身后。
// 果冻里飘的小气泡、以及外面掉下来的果冻滴，都用它。
// ---------------------------------------------------------------------------
import * as THREE from 'three';

const BUBBLE_VERT = /* glsl */`
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vPos;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vPos = wp.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    vV = normalize(cameraPosition - wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const BUBBLE_FRAG = /* glsl */`
  precision highp float;
  uniform vec3 uTint;
  uniform vec3 uRim;
  uniform float uOpacity;
  uniform float uTime;
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vPos;

  void main() {
    vec3 N = normalize(vN);
    vec3 V = normalize(vV);
    float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.0);

    vec3 L = normalize(vec3(0.45, 0.85, 0.55));
    vec3 H = normalize(L + V);
    float spec = pow(max(dot(N, H), 0.0), 90.0);
    vec3 L2 = normalize(vec3(-0.6, -0.2, -0.7));
    float spec2 = pow(max(dot(N, normalize(L2 + V)), 0.0), 22.0) * 0.35;

    // tiny iridescent film
    vec3 irid = 0.5 + 0.5 * cos(6.28318 * (fres * 1.3 + vec3(0.0, 0.33, 0.67)));
    vec3 col = mix(uTint, uRim, fres * 0.9) + irid * fres * 0.2;
    col += vec3(spec * 0.9 + spec2 * 0.5);

    // a bubble is a thin film: only the rim and the two glints are visible
    float a = uOpacity * (0.02 + fres * 0.55) + spec * 0.55 + spec2 * 0.22;
    gl_FragColor = vec4(col, clamp(a, 0.0, 0.72));
  }
`;

function createBubbleMaterial(tintHex, rimHex, opacity = 0.8) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTint: { value: new THREE.Color(tintHex) },
      uRim: { value: new THREE.Color(rimHex) },
      uOpacity: { value: opacity },
      uTime: { value: 0 },
    },
    vertexShader: BUBBLE_VERT,
    fragmentShader: BUBBLE_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

export { createBubbleMaterial, BUBBLE_VERT, BUBBLE_FRAG };
