// 托盘图标外圈的进度环。菜单行不动，只换图标上的这一圈。
const sharp = require('sharp');

function ringRaw(size, ratio, indeterminate) {
  const s = Math.max(1, size | 0);
  const data = Buffer.alloc(s * s * 4);
  const cx = (s - 1) / 2;
  const cy = cx;
  const r0 = s * 0.34;
  const r1 = s * 0.48;
  const span = indeterminate ? 0.28 : Math.max(0.04, Math.min(1, Number(ratio) || 0));
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d < r0 || d > r1) continue;
      let ang = Math.atan2(y - cy, x - cx) + Math.PI / 2;
      if (ang < 0) ang += Math.PI * 2;
      const t = ang / (Math.PI * 2);
      const on = t <= span;
      const o = (y * s + x) * 4;
      if (on) { data[o] = 232; data[o + 1] = 201; data[o + 2] = 122; data[o + 3] = 255; }
      else { data[o] = 212; data[o + 1] = 168; data[o + 2] = 75; data[o + 3] = 60; }
    }
  }
  return data;
}

async function ringPng(size, ratio, indeterminate) {
  const s = Math.max(1, size | 0);
  return sharp(ringRaw(s, ratio, indeterminate), { raw: { width: s, height: s, channels: 4 } }).png().toBuffer();
}

// 把进度环叠到托盘图标上。环的像素尺寸取自图标 PNG 本身（不是 DIP 尺寸），
// 所以永远不会比底图大：Windows 托盘图标 16 DIP，以前环固定至少 18 px，sharp 报
// "Image to composite must have same dimensions or smaller"。
async function composeRing(basePng, ratio, indeterminate) {
  const meta = await sharp(basePng).metadata();
  const s = Math.max(1, Math.min(meta.width | 0, meta.height | 0));
  const ring = ringRaw(s, ratio, indeterminate);
  return sharp(basePng)
    .composite([{ input: ring, raw: { width: s, height: s, channels: 4 }, gravity: 'centre' }])
    .png().toBuffer();
}

module.exports = { ringRaw, ringPng, composeRing };
