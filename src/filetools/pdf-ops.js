// 合成 PDF：图片和 PDF 可以混在一起。按文件名自然排序。每张图一页，PDF 原样插入。
const fs = require('fs');
const { PDFDocument } = require('pdf-lib');
const { naturalSort, kindOf } = require('./plan');
const { rasterForPdf } = require('./image-ops');

const ENCRYPTED = '这个 PDF 加了密码，打不开。文件没有被修改。';

function friendlyPdfError(err) {
  const msg = String((err && err.message) || err || '');
  if (/encrypt|password/i.test(msg)) return Object.assign(new Error(ENCRYPTED), { code: 'EPDF_ENCRYPTED' });
  return err;
}

function tight(bytes) {
  // Buffer.slice 不复制，pdf-lib 会从整块池的开头读，JPEG 的 SOI 就不在 0。
  const u8 = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  return Uint8Array.prototype.slice.call(u8);
}

async function loadPdf(bytes) {
  try { return await PDFDocument.load(bytes); }
  catch (err) { throw friendlyPdfError(err); }
}

async function makePdf(inputs, dest) {
  const ordered = naturalSort(inputs);
  const doc = await PDFDocument.create();
  for (const file of ordered) {
    const kind = kindOf(file);
    if (kind === 'pdf') {
      const src = await loadPdf(fs.readFileSync(file));
      const pages = await doc.copyPages(src, src.getPageIndices());
      pages.forEach((p) => doc.addPage(p));
    } else if (kind === 'image') {
      const raster = await rasterForPdf(file);
      const bytes = tight(raster.bytes);
      const img = raster.kind === 'jpg' ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
      const page = doc.addPage([img.width, img.height]);
      page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    } else {
      throw Object.assign(new Error('合成 PDF 只接受图片和 PDF'), { code: 'ETYPE' });
    }
  }
  if (!doc.getPageCount()) throw Object.assign(new Error('没有可以合成的页面'), { code: 'EEMPTY' });
  fs.writeFileSync(dest, await doc.save());
  return { pages: doc.getPageCount(), order: ordered.map((f) => require('path').basename(f)) };
}

module.exports = { makePdf, loadPdf, friendlyPdfError, ENCRYPTED };
