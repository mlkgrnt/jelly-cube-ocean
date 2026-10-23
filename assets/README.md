# 资产清单 · Asset Manifest

从 `jelly-cube-ocean.html` 里拆出来的可复用部分。全部 ES module，唯一的裸依赖是 `three`（demo 里用 import map 指向 `vendor/three.module.js`）。

## JS 模块

### `creatures.js` — 六只小生物

```js
import { CREATURE_BUILDERS, fallbackCreatureBuilder } from './creatures.js';

const fish = CREATURE_BUILDERS.goldfish({ palette, tint, rng });
scene.add(fish);
// 每帧
fish.userData.animate?.(t, dt);
```

`CREATURE_BUILDERS` 的键：`goldfish` `clownfish` `jellyfish` `whale` `puffer` `turtle`。

| 参数 | 说明 |
| --- | --- |
| `palette` | `palettes.js` 里的对象，取 `jelly` / `accent` 影响配色 |
| `tint` | `THREE.Color`，把生物的自发光往果冻色上拉，让整缸看着是同一块果冻里的 |
| `rng` | `mulberry32(seed)` 之类的函数，决定随机细节；同种子 → 同一只鱼 |

返回 `THREE.Group`，原点居中、约 1 单位长、鼻子朝 +Z；`userData` 带 `kind` `speed` `wobble` `materials` `animate(t, dt)` `tris`。

### `jelly-cube.js` — 果冻本体

```js
import { JellyBody, createJellyGeometry, createJellyMaterial } from './jelly-cube.js';

const jelly = new JellyBody(scene, { palette, softness: 0.55, bounce: 0.6, clarity: 0.62 });
jelly.setBackgroundTexture(bgRT.texture);   // 折射采样源，见下
jelly.setResolution(w, h);                  // 物理像素尺寸
jelly.update(dt, t);
jelly.updateCamera(camera);                 // 每帧把相机位置喂进 shader
```

想戳它：

```js
const hit = jelly.pick(raycaster);            // 打到前壳就返回 { point, local, normal, worldNormal }
if (hit) jelly.poke(hit.local, hit.worldNormal, 1);
jelly.shake(1);                               // 整体晃一下
jelly.beginDrag(local) / moveDrag(local) / endDrag();   // 捏着拉
```

单独要网格也行：

```js
const geo = createJellyGeometry(46, 11.0, 2.05);   // segments, 指数(越大越方), 半径
const front = createJellyMaterial('front');
const back = createJellyMaterial('back');          // 双壳才能出体积
```

`createJellyMaterial` 的 uniform 里，必须由外部驱动的：`uBgTex`（背景纹理）、`uResolution`、`uCamLocal`（`updateCamera` 代劳）、`uTime`/`uSquash`/`uImp*`（`JellyBody.update` 代劳）。

### `bubbles.js` — 肥皂泡

```js
import { createBubbleMaterial } from './bubbles.js';
const mat = createBubbleMaterial('#ffffff', '#ffffff', 0.8);  // 色调, 边缘色, 不透明度
```

薄膜材质：只有菲涅尔边缘 + 两颗高光 + 微微虹彩，`DoubleSide`、`depthWrite: false`。

### `backdrop.js` — 程序化背景

```js
import { createBackdropMaterial, BG_GLSL } from './backdrop.js';
const sky = createBackdropMaterial({ a: '#e7fdf6', b: '#c6f0ff', c: '#ffe9f4' });
// 贴到 PlaneGeometry(2, 2) 上，frustumCulled = false，renderOrder = -100
```

`BG_GLSL` 是同一段 fbm 噪声，果冻材质里也内联了一份 —— 这样果冻折射的是它自己站着的那片渐变。

### `palettes.js` — 配色 / 物种

```js
import { PALETTES, getPalette, SPECIES_META } from './palettes.js';
```

每套配色：`{ id, name, emoji, jelly, bg: [上层, 中层, 下层], accent, ink }`。
`SPECIES_META` 是 `{ id, name, emoji }` 六条。

### `core.js` — 小工具（零依赖）

`TAU` `clamp` `lerp` `invLerp` `smoothstep` `easeOutCubic` `easeOutBack` `damp`
`rand` `randInt` `pick` `mulberry32`
`hexToRgb` `rgbToHex` `hslToHex` `mixHex` `shadeHex` `tuneHex`

其中 `shadeHex(hex, ±amount)` 往白或往深紫走（不是纯黑，糖果色压黑会脏），`tuneHex(hex, satMul, lightMul)` 只在 HSL 里推饱和/明度、不动色相。

## GLSL

| 文件 | 用途 |
| --- | --- |
| `glsl/bg-fbm.glsl` | `bgHash` / `bgNoise` / `bgFbm` / `bgColor`，背景与果冻共用的噪声函数 |
| `glsl/bg.vert` `bg.frag` | 全屏背景 |
| `glsl/jelly.vert` `jelly.frag` | 果冻双壳材质（`jelly.frag` 已把 fbm 内联，可直接独立编译） |
| `glsl/bubble.vert` `bubble.frag` | 气泡 |

`.frag` 是 GLSL ES 1.0 写法（`gl_FragColor`、`texture2D`），按 three.js `ShaderMaterial` 约定，`modelMatrix` / `viewMatrix` / `cameraPosition` 等由 three 注入。

## 其他

| 文件 | 内容 |
| --- | --- |
| `css/jelly-ui.css` | 玻璃拟态面板外壳，选择器都收在 `.ju-root` / `#jelly-ui` 下，可直接引入 |
| `svg/jelly-cube.svg` | 果冻方块图标（原 favicon，64×64） |
| `json/palettes.json` | 同一份配色的 JSON，给非 JS 侧（Figma / 其他引擎）用 |

## 注意

- 果冻的折射靠 `uBgTex` 采样**背景渲染出的纹理**。不喂它的话折射会采到空纹理，果冻会变浑浊。`demo/index.html` 里用一张 256×256 的 `WebGLRenderTarget` 烘背景，每帧一次。
- `createJellyGeometry` 用 `BoxGeometry(1,1,1,segments,segments,segments)` 起手再重投影到超椭球面，所以 `segments` 是六面的细分：46 大概 3 万面，移动端用 30。
