// 合成 PDF：图片和 PDF 可以混在一起。按文件名自然排序。每张图一页，PDF 原样插入。
const fs = require('fs');
const { PDFDocument } = require('pdf-lib');
const { naturalSort, kindOf } = require('./plan');
const { pngBuffer } = require('./image-ops');

async function makePdf(inputs, dest) {
  const ordered = naturalSort(inputs);
  const doc = await PDFDocument.create();
  for (const file of ordered) {
    const kind = kindOf(file);
    if (kind === 'pdf') {
      const src = await PDFDocument.load(fs.readFileSync(file));
      const pages = await doc.copyPages(src, src.getPageIndices());
      pages.forEach((p) => doc.addPage(p));
    } else if (kind === 'image') {
      const png = await pngBuffer(file);
      const img = await doc.embedPng(png);
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

module.exports = { makePdf };
