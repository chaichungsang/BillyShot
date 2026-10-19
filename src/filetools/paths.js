// 新文件写在原文件旁边。绝不返回原路径。重名时加 -1、-2…
const fs = require('fs');
const path = require('path');

function samePath(a, b) {
  if (!a || !b) return false;
  return path.resolve(a) === path.resolve(b);
}

function nextTo(original, { suffix = '', ext } = {}, existsFn) {
  const exists = existsFn || ((p) => {
    try { return fs.existsSync(p) || fs.existsSync(p + '.part'); } catch { return false; }
  });
  const dir = path.dirname(path.resolve(original));
  const base = path.basename(original, path.extname(original));
  const cleanSuffix = String(suffix || '').replace(/[^\w.\-]+/g, '');
  const stem = cleanSuffix ? `${base}-${cleanSuffix}` : base;
  const extension = String(ext || path.extname(original).slice(1) || 'bin').replace(/^\./, '').replace(/[^\w]+/g, '') || 'bin';
  const candidate = (n) => path.join(dir, n ? `${stem}-${n}.${extension}` : `${stem}.${extension}`);
  let n = 0;
  let file = candidate(0);
  while (samePath(file, original) || exists(file)) {
    n += 1;
    file = candidate(n);
    if (n > 9999) throw Object.assign(new Error('too many output names'), { code: 'ENAME' });
  }
  if (samePath(file, original)) throw Object.assign(new Error('refusing to overwrite original'), { code: 'EOVERWRITE' });
  return file;
}

function partialFor(finalPath) {
  return finalPath + '.part';
}

function discardPartial(partial) {
  if (!partial) return;
  try { fs.unlinkSync(partial); } catch {}
}

module.exports = { nextTo, partialFor, discardPartial, samePath };
