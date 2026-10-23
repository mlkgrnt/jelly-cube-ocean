#!/usr/bin/env python3
"""
从单文件版 jelly-cube-ocean.html 里切出可复用的美术资产。

单文件版本是按编号分节写的（00-boot / 05-palette / 20-shaders / 30-jelly /
40-creatures / 50-world / 55-bubble / 60-interaction / 70-ui / 80-main），
每一节之间用 `// NNN-name.js ---` 横幅隔开。本脚本按这些横幅把内容原样搬进
assets/ 下的独立模块，只补 import / export 与少量调用签名，不改动任何美术逻辑。

用法：  python tools/extract_assets.py
幂等：  可以重复跑，覆盖 assets/ 下的生成物。
"""

from __future__ import annotations

import base64
import json
import re
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "jelly-cube-ocean.html"
ASSETS = ROOT / "assets"

HTML = SRC.read_text(encoding="utf-8")
LINES = HTML.splitlines()


# --- 1. 定位 <style> / three-src / module 三段 ---------------------------------
def find(lineno: int, needle: str) -> int:
    for i in range(lineno, len(LINES)):
        if needle in LINES[i]:
            return i
    raise SystemExit(f"找不到 {needle!r}")


style_open = find(0, "<style>")
style_close = find(style_open, "</style>")
three_open = find(style_close, 'id="three-src"')
three_close = find(three_open, "</script>")
app_open = find(three_close, '<script type="module">')
app_close = find(app_open, "</script>")


def rows(a: int, b: int) -> str:
    """按 1-based 行号取闭区间（a、b 都是 1-based）。"""
    return "\n".join(LINES[a - 1:b])


CSS = rows(style_open + 2, style_close)
THREE_SRC = rows(three_open + 2, three_close)
APP = rows(app_open + 1, app_close)  # 含 <script type="module"> 那行，序号与源码一致


def slice_app(a: int, b: int) -> str:
    return "\n".join(APP.splitlines()[a - 1:b])


def banner(text: str, module: str) -> str:
    """把原分节横幅里的旧文件名换成新模块名，描述原样保留。"""
    return re.sub(r"^// \d\d-[a-z]+\.js", "// " + module, text, count=1, flags=re.M)


# --- 2. 写入 vendor / css / svg ------------------------------------------------
(ROOT / "vendor").mkdir(exist_ok=True)
(ROOT / "vendor" / "three.module.js").write_text(THREE_SRC + "\n", encoding="utf-8")

(ASSETS / "css").mkdir(exist_ok=True)
(ASSETS / "css" / "jelly-ui.css").write_text(
    "/* 果冻方块海洋 · UI 外壳\n"
    " * 桌面端：右上浮动玻璃卡；移动端：底部抽屉 + 胶囊。\n"
    " * 所有选择器都收敛在 .ju-root / #jelly-ui 下，可以直接丢进任意页面。\n"
    " */\n"
    + CSS.strip()
    + "\n",
    encoding="utf-8",
)

icon = re.search(r'href="data:image/svg\+xml,([^"]+)"', HTML)
if icon:
    svg = urllib.parse.unquote(icon.group(1))
    (ASSETS / "svg").mkdir(exist_ok=True)
    (ASSETS / "svg" / "jelly-cube.svg").write_text(svg + "\n", encoding="utf-8")

# --- 3. palettes.js -----------------------------------------------------------
palette_src = banner(slice_app(81, 104), "palettes.js")
(ASSETS / "js" / "palettes.js").write_text(
    "// 果冻方块海洋 · 配色与物种清单\n"
    "// 8 套配色各自定义：果冻本体色、三层背景渐变色、UI 强调色、文字墨色。\n"
    "// 无任何依赖，可单独在任意前端项目里当设计 token 用。\n"
    "// ---------------------------------------------------------------------------\n"
    + palette_src
    + "\n\nexport { PALETTES, getPalette, SPECIES_META };\n",
    encoding="utf-8",
)

# --- 4. backdrop.js -----------------------------------------------------------
bg_glsl = slice_app(120, 156)
bg_shaders = banner(slice_app(1803, 1822), "backdrop.js")
(ASSETS / "js" / "backdrop.js").write_text(
    "// 果冻方块海洋 · 程序化背景\n"
    "// 全屏 fbm 渐变天空。同一份 BG_GLSL 既给天空用，也塞进果冻材质里，\n"
    "// 这样果冻折射的就是它正站在里面的那片渐变。\n"
    "// ---------------------------------------------------------------------------\n"
    "import * as THREE from 'three';\n\n"
    + bg_glsl
    + "\n\n"
    + bg_shaders
    + """

/** 直接可用的全屏背景材质（贴在一个 PlaneGeometry(2,2) 上即可）。 */
function createBackdropMaterial({ a = '#e7fdf6', b = '#c6f0ff', c = '#ffe9f4' } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uA: { value: new THREE.Color(a) },
      uB: { value: new THREE.Color(b) },
      uC: { value: new THREE.Color(c) },
      uRes: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
    },
    vertexShader: BG_VERT,
    fragmentShader: BG_FRAG,
    depthTest: false,
    depthWrite: false,
  });
}

export { BG_GLSL, BG_VERT, BG_FRAG, createBackdropMaterial };
""",
    encoding="utf-8",
)

# --- 5. jelly-cube.js（几何 + 双壳材质 + 弹簧体） ------------------------------
jelly_mat = banner(slice_app(108, 405), "jelly-cube.js")
# BG_GLSL 已搬去 backdrop.js，这里删掉本地副本，改为 import
jelly_mat = re.sub(
    r"// Shared procedural background.*?`;\n", "", jelly_mat, flags=re.S
).replace("20-shaders.js — ", "")
jelly_body = banner(slice_app(409, 657), "jelly-cube.js")
jelly_body = jelly_body.replace(
    "  constructor(scene) {",
    "  constructor(scene, opts = {}) {",
).replace(
    "    this.setPhysics(STATE.softness, STATE.bounce);\n"
    "    this.setPalette(getPalette(STATE.paletteId));\n"
    "    this.setClarity(STATE.clarity);",
    "    this.setPhysics(\n"
    "      opts.softness === undefined ? 0.55 : opts.softness,\n"
    "      opts.bounce === undefined ? 0.6 : opts.bounce,\n"
    "    );\n"
    "    this.setPalette(opts.palette || getPalette('mint'));\n"
    "    this.setClarity(opts.clarity === undefined ? 0.62 : opts.clarity);",
)
(ASSETS / "js" / "jelly-cube.js").write_text(
    "// 果冻方块海洋 · 果冻方块本体\n"
    "// createJellyGeometry: 超椭球（squircle）几何，指数越高越方。\n"
    "// createJellyMaterial: 前后双壳的糖果材质——厚度做 Beer-Lambert 吸收、\n"
    "//   弯折屏幕坐标做折射、菲涅尔边缘 + 双高光 + 焦散。\n"
    "// JellyBody: 把双壳网格 + 一池弹簧脉冲 + 挤压/晃动的物理打包在一起。\n"
    "// ---------------------------------------------------------------------------\n"
    "import * as THREE from 'three';\n"
    "import { BG_GLSL } from './backdrop.js';\n"
    "import { getPalette } from './palettes.js';\n"
    "import { clamp, lerp, rand, pick, mixHex, shadeHex, tuneHex } from './core.js';\n\n"
    "const isCoarsePointer =\n"
    "  typeof window !== 'undefined' && window.matchMedia\n"
    "    ? window.matchMedia('(pointer: coarse)').matches\n"
    "    : false;\n\n"
    + jelly_mat.strip()
    + "\n\n"
    + jelly_body.strip()
    + "\n\n"
    "export {\n"
    "  createJellyGeometry, createJellyMaterial, JELLY_MAX_IMPULSES,\n"
    "  JELLY_VERT, JELLY_FRAG, JellyBody,\n"
    "  JELLY_RADIUS, JELLY_INNER, JELLY_SEGMENTS, JELLY_EXPONENT,\n"
    "};\n",
    encoding="utf-8",
)

# --- 6. creatures.js ----------------------------------------------------------
creatures = banner(slice_app(661, 1796), "creatures.js")
# 兜底生物原本住在 50-world 里，但它也是生物资产，一起搬过来
fallback = slice_app(2330, 2352)
(ASSETS / "js" / "creatures.js").write_text(
    "// 果冻方块海洋 · 六只低多边形水箱生物\n"
    "// CREATURE_BUILDERS[id](ctx) -> THREE.Group\n"
    "//   ctx = { palette, tint, rng }   rng 是 seeded 随机，同一个种子长同一只鱼\n"
    "// 坐标约定：原点居中、约 1 单位长、鼻子朝 +Z、尾巴朝 -Z。\n"
    "// 完全程序化：躯体是「旋转曲面 + 半径剖面 + 逐面上色」，鳍是挤出的细轮廓，\n"
    "// 眼睛是嵌进表面的球冠并沿法线朝向，嘴是贴着表面走的小管子。零贴图、零 DOM。\n"
    "// userData: kind / speed / wobble / materials / animate(t, dt) / tris\n"
    "// ---------------------------------------------------------------------------\n"
    "import * as THREE from 'three';\n"
    "import { TAU, clamp, lerp, smoothstep, mixHex, shadeHex } from './core.js';\n\n"
    + creatures.strip()
    + "\n\n// --- 兜底生物：某个 id 没有对应实现时用它，保证场景不会空 ---\n"
    + fallback.strip()
    + "\n\nexport { CREATURE_BUILDERS, fallbackCreatureBuilder };\n",
    encoding="utf-8",
)

# --- 7. bubbles.js ------------------------------------------------------------
bubbles = banner(slice_app(2377, 2436), "bubbles.js")
(ASSETS / "js" / "bubbles.js").write_text(
    "// 果冻方块海洋 · 肥皂泡材质\n"
    "// 轻薄薄膜：只有菲涅尔边缘 + 两颗高光 + 一点点虹彩，几乎不遮挡身后。\n"
    "// 果冻里飘的小气泡、以及外面掉下来的果冻滴，都用它。\n"
    "// ---------------------------------------------------------------------------\n"
    "import * as THREE from 'three';\n\n"
    + bubbles.strip()
    + "\n\nexport { createBubbleMaterial, BUBBLE_VERT, BUBBLE_FRAG };\n",
    encoding="utf-8",
)

# --- 8. glsl 单文件（方便直接贴进 shadertoy / 其他引擎） ----------------------
(ASSETS / "glsl").mkdir(exist_ok=True)


def dump_glsl(path: str, body: str) -> None:
    (ASSETS / "glsl" / path).write_text(body.strip() + "\n", encoding="utf-8")


bg_all = slice_app(120, 156).split("`")
dump_glsl("bg-fbm.glsl", bg_all[1])
bg_js = slice_app(1803, 1822)
parts = bg_js.split("`")
dump_glsl("bg.vert", parts[1])
dump_glsl("bg.frag", parts[3].replace("${BG_GLSL}", bg_all[1].strip()))

jelly_js = slice_app(190, 405)
parts = jelly_js.split("`")
dump_glsl("jelly.vert", parts[1])
# 单文件版靠模板字符串把 BG_GLSL 拼进来；导出的 .glsl 必须是能独立编译的，所以直接内联
dump_glsl("jelly.frag", parts[3].replace("${BG_GLSL}", bg_all[1].strip()))

bubble_js = slice_app(2377, 2436)
parts = bubble_js.split("`")
dump_glsl("bubble.vert", parts[1])
dump_glsl("bubble.frag", parts[3])

# --- 9. palettes.json ---------------------------------------------------------
def grab(name: str) -> str:
    m = re.search(rf"const {name} = (\[.*?\n\]);", palette_src, re.S)
    if not m:
        raise SystemExit(f"没找到 {name}")
    return m.group(1)


def as_json(js_literal: str):
    """把只有字符串/数组/对象的 JS 字面量转成 JSON（键加引号、单引号换双引号）。"""
    quoted_keys = re.sub(r"([{,]\s*)([A-Za-z_$][\w$]*)\s*:", r'\1"\2":', js_literal)
    no_trailing = re.sub(r",(\s*[\]}])", r"\1", quoted_keys)
    return json.loads(no_trailing.replace("'", '"'))


palettes = as_json(grab("PALETTES"))
species = as_json(grab("SPECIES_META"))
(ASSETS / "json").mkdir(exist_ok=True)
(ASSETS / "json" / "palettes.json").write_text(
    json.dumps(
        {
            "$comment": "果冻方块海洋 · 设计 token。palettes 里的 bg 是三段背景渐变，"
            "jelly 是本体色，accent 是强调色，ink 是文字墨色。",
            "palettes": palettes,
            "species": species,
        },
        ensure_ascii=False,
        indent=2,
    )
    + "\n",
    encoding="utf-8",
)

print("生成完毕：")
for p in sorted(ASSETS.rglob("*")):
    if p.is_file():
        print(f"  {p.relative_to(ROOT)}  ({p.stat().st_size:,} B)")
