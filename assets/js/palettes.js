// 果冻方块海洋 · 配色与物种清单
// 8 套配色各自定义：果冻本体色、三层背景渐变色、UI 强调色、文字墨色。
// 无任何依赖，可单独在任意前端项目里当设计 token 用。
// ---------------------------------------------------------------------------
// palettes.js — the colour themes. Every theme drives the jelly tint, the
// page background and the little accent colours used by creatures + UI.
// ---------------------------------------------------------------------------
const PALETTES = [
  { id: 'mint',      name: '薄荷汽水', emoji: '🌿', jelly: '#8ef0d8', bg: ['#d6fbef', '#a9e4fb', '#ffd9ee'], accent: '#3fcbb0', ink: '#2c4a52' },
  { id: 'sakura',    name: '樱花汽水', emoji: '🌸', jelly: '#ffb3d1', bg: ['#ffdcec', '#ffc6de', '#dcd6ff'], accent: '#ff6fa4', ink: '#5a3247' },
  { id: 'blueberry', name: '蓝莓苏打', emoji: '🫐', jelly: '#9db8ff', bg: ['#dbe2ff', '#c1d4ff', '#e6d6ff'], accent: '#6d8cff', ink: '#31365e' },
  { id: 'lemon',     name: '柠檬苏打', emoji: '🍋', jelly: '#ffe08a', bg: ['#fff6c8', '#ffe298', '#c8f5e2'], accent: '#f0b72e', ink: '#5d4a1f' },
  { id: 'grape',     name: '葡萄果冻', emoji: '🍇', jelly: '#c4a4ff', bg: ['#eadcff', '#d2bfff', '#ffcfe6'], accent: '#9a72ff', ink: '#432f66' },
  { id: 'peach',     name: '蜜桃乌龙', emoji: '🍑', jelly: '#ffb894', bg: ['#ffe3d2', '#ffc7b1', '#ffe0ee'], accent: '#ff8555', ink: '#5c3a2c' },
  { id: 'aurora',    name: '极光果冻', emoji: '✨', jelly: '#8ff0c8', bg: ['#d0fbec', '#b3dcff', '#d9c4ff'], accent: '#3fd9ac', ink: '#254a49' },
  { id: 'deep',      name: '深海苏打', emoji: '🫧', jelly: '#7fd4ff', bg: ['#cfe9ff', '#a3d2ff', '#c8c2ff'], accent: '#3aa4e8', ink: '#22405e' },
];

const getPalette = id => PALETTES.find(p => p.id === id) || PALETTES[0];

const SPECIES_META = [
  { id: 'goldfish',  name: '小金鱼', emoji: '🐠' },
  { id: 'clownfish', name: '小丑鱼', emoji: '🐟' },
  { id: 'jellyfish', name: '小水母', emoji: '🪼' },
  { id: 'whale',     name: '小鲸鱼', emoji: '🐳' },
  { id: 'puffer',    name: '小河豚', emoji: '🐡' },
  { id: 'turtle',    name: '小海龟', emoji: '🐢' },
];

export { PALETTES, getPalette, SPECIES_META };
