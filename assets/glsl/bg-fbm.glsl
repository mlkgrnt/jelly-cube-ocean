float bgHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float bgNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(bgHash(i), bgHash(i + vec2(1.0, 0.0)), f.x),
               mix(bgHash(i + vec2(0.0, 1.0)), bgHash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float bgFbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * bgNoise(p); p *= 2.03; a *= 0.5; }
    return v;
  }
  vec3 bgColor(vec2 uv, float aspect, float t, vec3 cA, vec3 cB, vec3 cC) {
    vec2 pa = vec2(uv.x * aspect, uv.y);
    float n1 = bgFbm(pa * 0.85 + vec2(t, -t * 0.6));
    float n2 = bgFbm(pa * 1.6 - vec2(t * 0.5, t * 0.35) + 5.0);
    vec3 col = mix(cB, cA, smoothstep(-0.15, 1.05, uv.y));
    col = mix(col, cC, smoothstep(0.35, 1.0, (1.0 - uv.y) * 0.85 + n2 * 0.25) * 0.5);
    col = mix(col, cA, smoothstep(0.45, 1.0, n1) * 0.3);
    vec2 c1 = vec2(0.28 + sin(t * 1.7) * 0.04, 0.84 + cos(t * 1.3) * 0.03);
    float g1 = exp(-dot(pa - c1, pa - c1) * 5.0);
    col += cA * g1 * 0.14;

    // soft bokeh blobs — they get beautifully bent when seen through the jelly
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      vec2 bc = vec2(0.30 + 0.36 * sin(t * 0.7 + fi * 2.1), 0.34 + 0.42 * cos(t * 0.55 + fi * 1.7));
      float br = 0.13 + 0.05 * sin(t * 0.9 + fi);
      float blob = smoothstep(br, br * 0.08, length(pa - bc));
      col = mix(col, mix(cA, vec3(1.0), 0.72), blob * 0.34);
    }
    float vig = smoothstep(1.32, 0.3, length((uv - 0.5) * vec2(aspect * 0.85, 1.0)));
    col *= mix(0.9, 1.0, vig);
    return col;
  }
