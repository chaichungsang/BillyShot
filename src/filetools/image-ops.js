// 图片走 sharp。HEIC 先用系统解码。压缩保留原格式；HEIC 压成 JPG；PNG 用调色板有损量化。不放大。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { capWidth, imageFormat } = require('./plan');
const { isHeic, decodeHeic } = require('./heic');

let sharpLib;
function sharp() {
  if (!sharpLib) {
    sharpLib = require('sharp');
    sharpLib.cache(false);
    sharpLib.concurrency(1);
  }
  return sharpLib;
}

async function readable(input, tmp) {
  if (!isHeic(input)) return { file: input, temp: false };
  const dest = path.join(tmp, `heic-${process.pid}-${Date.now()}.png`);
  await decodeHeic(input, dest);
  return { file: dest, temp: true };
}

function pipeline(file) {
  // rotate 先把方向烤进像素，withMetadata 留下其余信息（ICC 等）。
  return sharp()(file).rotate().withMetadata();
}

async function writeImage(img, dest, format, quality) {
  const q = Math.max(1, Math.min(100, Number(quality) || 82));
  if (format === 'jpg' || format === 'jpeg') await img.jpeg({ quality: q, mozjpeg: true }).toFile(dest);
  else if (format === 'webp') await img.webp({ quality: q }).toFile(dest);
  else if (format === 'png') await img.png({ palette: q < 100, quality: q, effort: 7, compressionLevel: 9 }).toFile(dest);
  else throw Object.assign(new Error('unsupported format'), { code: 'EFORMAT' });
}

async function convert(input, dest, { format, quality }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bsft-'));
  try {
    const src = await readable(input, tmp);
    await writeImage(pipeline(src.file), dest, format, quality || (format === 'jpg' ? 90 : 86));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

async function compress(input, dest, { quality }) {
  const fmt = imageFormat(input);
  const outFmt = fmt === 'heic' ? 'jpg' : fmt;
  if (!outFmt) throw Object.assign(new Error('unsupported format'), { code: 'EFORMAT' });
  const q = Math.max(1, Math.min(100, Number(quality) || 72));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bsft-'));
  try {
    const src = await readable(input, tmp);
    await writeImage(pipeline(src.file), dest, outFmt === 'png' ? 'png' : outFmt, q);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

async function resize(input, dest, options) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bsft-'));
  try {
    const src = await readable(input, tmp);
    const meta = await sharp()(src.file).metadata();
    const ow = meta.width || 0;
    if (!ow) throw Object.assign(new Error('unknown width'), { code: 'ESIZE' });
    let width;
    if (options.mode === 'percent') width = Math.max(1, Math.round(ow * (Number(options.value) || 100) / 100));
    else width = capWidth(options.value, ow);
    width = Math.min(width, ow);
    const fmt = imageFormat(input) === 'heic' ? 'jpg' : (imageFormat(input) || 'png');
    await writeImage(pipeline(src.file).resize({ width, withoutEnlargement: true }), dest, fmt, options.quality || 90);
    return { width, capped: width < Math.round(Number(options.value) || width) && options.mode !== 'percent' };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

async function estimateCompress(input, quality) {
  const fmt = imageFormat(input);
  const outFmt = fmt === 'heic' ? 'jpg' : fmt;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bsft-'));
  try {
    const src = await readable(input, tmp);
    const q = Math.max(1, Math.min(100, Number(quality) || 72));
    let img = pipeline(src.file);
    let buf;
    if (outFmt === 'jpg') buf = await img.jpeg({ quality: q, mozjpeg: true }).toBuffer();
    else if (outFmt === 'webp') buf = await img.webp({ quality: q }).toBuffer();
    else buf = await img.png({ palette: q < 100, quality: q, effort: 7, compressionLevel: 9 }).toBuffer();
    return buf.length;
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

async function pngBuffer(input) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bsft-'));
  try {
    const src = await readable(input, tmp);
    return pipeline(src.file).png().toBuffer();
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

async function meta(input) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bsft-'));
  try {
    const src = await readable(input, tmp);
    const m = await sharp()(src.file).metadata();
    return { width: m.width || 0, height: m.height || 0 };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

module.exports = { convert, compress, resize, estimateCompress, pngBuffer, meta };
