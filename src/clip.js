// 剪贴板兼容层：Electron 44+ 为异步 ClipboardItem API，旧版为 writeImage/readImage
const electron = require('electron');
const { clipboard, nativeImage } = electron;

async function writeImagePng(png) {
  if (typeof clipboard.writeImage === 'function') { clipboard.writeImage(nativeImage.createFromBuffer(png)); return; }
  const item = new electron.ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) });
  await clipboard.write([item]);
}

async function readImagePng() {
  if (typeof clipboard.readImage === 'function') {
    const img = clipboard.readImage();
    return img.isEmpty() ? null : img.toPNG();
  }
  try {
    const items = await clipboard.read();
    for (const it of items) {
      const t = it.types.find((x) => /^image\/(png|jpeg|bmp|gif|webp)$/.test(x));
      if (!t) continue;
      const blob = await it.getType(t);
      const buf = Buffer.from(await blob.arrayBuffer());
      if (t === 'image/png') return buf;
      const img = nativeImage.createFromBuffer(buf);
      return img.isEmpty() ? null : img.toPNG();
    }
  } catch (e) { console.error('clipboard read failed', e.message); }
  return null;
}

async function writeText(text) {
  const r = clipboard.writeText(String(text));
  if (r && typeof r.then === 'function') await r;
}

module.exports = { writeImagePng, readImagePng, writeText };
