'use strict';
// 把 MediaRecorder 录出来的「分段 MP4」(fMP4：moov 里没有时长和样本表，数据分在一段段 moof+mdat 里)
// 整理成普通 MP4：在文件末尾追加一个完整的 moov（时长、样本表都写好），
// 再把原来的 moov / moof 改名成 free（只改 4 个字节）。画面和声音数据一个字节都不动、不复制，
// 所以几 GB 的文件也是一瞬间完成。整理以后资源管理器能显示时长和缩略图，播放器能正常拖进度条，剪辑软件也能直接导入。
//
// 失败时（文件结构不认识等）原文件保持原样，调用方照常使用。
const fs = require('fs');

const u32 = (b, o) => b.readUInt32BE(o);
const u64 = (b, o) => Number(b.readBigUInt64BE(o));

function readAt(fd, pos, len) {
  const b = Buffer.alloc(len);
  let got = 0;
  while (got < len) {
    const n = fs.readSync(fd, b, got, len - got, pos + got);
    if (!n) break;
    got += n;
  }
  return got === len ? b : b.subarray(0, got);
}

// 顶层 box 列表；size 越界（录到一半断电 / 进程被杀）时标记 truncated
function topBoxes(fd, fileSize) {
  const out = [];
  let off = 0;
  while (off + 8 <= fileSize) {
    const h = readAt(fd, off, 16);
    if (h.length < 8) break;
    let size = u32(h, 0), hdr = 8;
    const type = h.toString('latin1', 4, 8);
    if (size === 1) { if (h.length < 16) break; size = u64(h, 8); hdr = 16; }
    else if (size === 0) size = fileSize - off;
    if (size < hdr) break;
    const truncated = off + size > fileSize;
    out.push({ type, off, size, hdr, truncated });
    if (truncated) break;
    off += size;
  }
  return out;
}

// 内存里的 box 子节点
function children(buf, start, end) {
  const out = [];
  let off = start;
  while (off + 8 <= end) {
    let size = u32(buf, off), hdr = 8;
    const type = buf.toString('latin1', off + 4, off + 8);
    if (size === 1) { size = u64(buf, off + 8); hdr = 16; } else if (size === 0) size = end - off;
    if (size < hdr || off + size > end) break;
    out.push({ type, off, size, hdr, body: off + hdr, end: off + size });
    off += size;
  }
  return out;
}
const find = (list, type) => list.find((b) => b.type === type);

// ---------------------------------------------------------------- 写 box
function box(type, ...parts) {
  const body = Buffer.concat(parts.map((p) => (Buffer.isBuffer(p) ? p : Buffer.from(p))));
  const h = Buffer.alloc(8); h.writeUInt32BE(8 + body.length, 0); h.write(type, 4, 'latin1');
  return Buffer.concat([h, body]);
}
function fullBox(type, version, flags, ...parts) {
  const vf = Buffer.alloc(4); vf.writeUInt32BE(((version & 0xff) << 24) | (flags & 0xffffff), 0);
  return box(type, vf, ...parts);
}
function u32buf(arr) { const b = Buffer.alloc(arr.length * 4); arr.forEach((v, i) => b.writeUInt32BE(v >>> 0, i * 4)); return b; }
function i32buf(arr) { const b = Buffer.alloc(arr.length * 4); arr.forEach((v, i) => b.writeInt32BE(v | 0, i * 4)); return b; }
function u64be(v) { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(Math.max(0, Math.round(v)))); return b; }

// ---------------------------------------------------------------- 解析 moov（只取我们需要的）
function parseMoov(buf) {
  const top = children(buf, 8, buf.length);
  const mvhd = find(top, 'mvhd');
  if (!mvhd) throw new Error('no mvhd');
  const v = buf[mvhd.body];
  const movieTimescale = v === 1 ? u32(buf, mvhd.body + 20) : u32(buf, mvhd.body + 12);
  const mvhdTail = buf.subarray(mvhd.body + (v === 1 ? 32 : 20), mvhd.end); // rate…next_track_ID
  const tracks = new Map();
  for (const trak of top.filter((b) => b.type === 'trak')) {
    const tc = children(buf, trak.body, trak.end);
    const tkhd = find(tc, 'tkhd'), mdia = find(tc, 'mdia');
    if (!tkhd || !mdia) continue;
    const tv = buf[tkhd.body];
    const tkFlags = u32(buf, tkhd.body) & 0xffffff;
    const trackId = u32(buf, tkhd.body + (tv === 1 ? 20 : 12));
    const tkhdTail = buf.subarray(tkhd.body + (tv === 1 ? 36 : 24), tkhd.end); // reserved(8)…height
    const mc = children(buf, mdia.body, mdia.end);
    const mdhd = find(mc, 'mdhd'), hdlr = find(mc, 'hdlr'), minf = find(mc, 'minf');
    if (!mdhd || !hdlr || !minf) continue;
    const mv = buf[mdhd.body];
    const timescale = mv === 1 ? u32(buf, mdhd.body + 20) : u32(buf, mdhd.body + 12);
    const mdhdTail = buf.subarray(mdhd.body + (mv === 1 ? 32 : 20), mdhd.end); // language + pre_defined
    const handler = buf.toString('latin1', hdlr.body + 8, hdlr.body + 12);
    const ic = children(buf, minf.body, minf.end);
    const stbl = find(ic, 'stbl');
    if (!stbl) continue;
    const stsd = find(children(buf, stbl.body, stbl.end), 'stsd');
    if (!stsd) continue;
    tracks.set(trackId, {
      trackId, tkFlags, tkhdTail: Buffer.from(tkhdTail), timescale, mdhdTail: Buffer.from(mdhdTail), handler,
      hdlr: Buffer.from(buf.subarray(hdlr.off, hdlr.end)),
      minfOther: ic.filter((b) => b.type !== 'stbl').map((b) => Buffer.from(buf.subarray(b.off, b.end))),
      stsd: Buffer.from(buf.subarray(stsd.off, stsd.end)),
      // trex 默认值
      defDur: 0, defSize: 0, defFlags: 0,
      samples: [], // [dts, dur, size, offset, flags, cto]
      chunks: [], // [firstSampleIndex, count, offset]
    });
  }
  const mvex = find(top, 'mvex');
  if (mvex) {
    for (const t of children(buf, mvex.body, mvex.end).filter((b) => b.type === 'trex')) {
      const tr = tracks.get(u32(buf, t.body + 4));
      if (tr) { tr.defDur = u32(buf, t.body + 12); tr.defSize = u32(buf, t.body + 16); tr.defFlags = u32(buf, t.body + 20); }
    }
  }
  const other = top.filter((b) => !['mvhd', 'trak', 'mvex'].includes(b.type)).map((b) => Buffer.from(buf.subarray(b.off, b.end)));
  return { movieTimescale, mvhdTail: Buffer.from(mvhdTail), tracks, other, fragmented: !!mvex };
}

// mdats 按位置排好序：二分查找样本所在的 mdat
function inMdat(mdats, pos, size) {
  let lo = 0, hi = mdats.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1, m = mdats[mid];
    if (pos < m.start) hi = mid - 1; else if (pos >= m.end) lo = mid + 1; else return pos + size <= m.end;
  }
  return false;
}

// ---------------------------------------------------------------- 解析一个 moof
function parseMoof(buf, moofOff, tracks, fileSize, mdats) {
  const top = children(buf, 8, buf.length);
  let prevEnd = moofOff; // 没有 base 标志时：第一个 traf 以 moof 开头为基准，之后接着上一个 traf 的数据末尾
  for (const traf of top.filter((b) => b.type === 'traf')) {
    const tc = children(buf, traf.body, traf.end);
    const tfhd = find(tc, 'tfhd');
    if (!tfhd) continue;
    const fl = u32(buf, tfhd.body) & 0xffffff;
    const tr = tracks.get(u32(buf, tfhd.body + 4));
    if (!tr) continue;
    let p = tfhd.body + 8;
    let base = (fl & 0x20000) ? moofOff : prevEnd;
    if (fl & 0x1) { base = u64(buf, p); p += 8; }
    if (fl & 0x2) p += 4;
    let defDur = tr.defDur, defSize = tr.defSize, defFlags = tr.defFlags;
    if (fl & 0x8) { defDur = u32(buf, p); p += 4; }
    if (fl & 0x10) { defSize = u32(buf, p); p += 4; }
    if (fl & 0x20) { defFlags = u32(buf, p); p += 4; }
    const tfdt = find(tc, 'tfdt');
    let dts;
    const lastS = tr.samples[tr.samples.length - 1];
    if (tfdt) {
      dts = buf[tfdt.body] === 1 ? u64(buf, tfdt.body + 4) : u32(buf, tfdt.body + 4);
      // 普通 MP4 的时间只能靠时长一个接一个累加：上一段的时长加起来和这一段的起点（tfdt）对不上时，
      // 把差值记到上一段最后一个样本上，保证每一帧的时间和原文件完全一致
      if (lastS && dts - lastS[0] >= 1) lastS[1] = dts - lastS[0];
    } else dts = lastS ? lastS[0] + lastS[1] : 0;
    let dataPos = base;
    for (const trun of tc.filter((b) => b.type === 'trun')) {
      const vf = u32(buf, trun.body), ver = vf >>> 24, rf = vf & 0xffffff;
      const n = u32(buf, trun.body + 4);
      let q = trun.body + 8;
      if (rf & 0x1) { dataPos = base + buf.readInt32BE(q); q += 4; }
      let firstFlags = null;
      if (rf & 0x4) { firstFlags = u32(buf, q); q += 4; }
      const chunkStart = dataPos, firstIdx = tr.samples.length;
      for (let i = 0; i < n; i++) {
        const dur = (rf & 0x100) ? u32(buf, q) : defDur; if (rf & 0x100) q += 4;
        const size = (rf & 0x200) ? u32(buf, q) : defSize; if (rf & 0x200) q += 4;
        let flags = (rf & 0x400) ? u32(buf, q) : defFlags; if (rf & 0x400) q += 4;
        if (i === 0 && firstFlags !== null && !(rf & 0x400)) flags = firstFlags;
        let cto = 0;
        if (rf & 0x800) { cto = ver === 0 ? u32(buf, q) : buf.readInt32BE(q); q += 4; }
        if (q > trun.end) throw new Error('trun overflow');
        // 数据要完整地落在某个 mdat 里，否则就是录到一半被截断的部分：丢掉
        if (dataPos + size > fileSize || !inMdat(mdats, dataPos, size)) return false;
        tr.samples.push([dts, dur, size, dataPos, flags, cto]);
        dts += dur; dataPos += size;
      }
      if (tr.samples.length > firstIdx) tr.chunks.push([firstIdx, tr.samples.length - firstIdx, chunkStart]);
    }
    prevEnd = dataPos;
  }
  return true;
}

// ---------------------------------------------------------------- 生成新 moov
function buildMoov(m) {
  const tracks = [...m.tracks.values()].filter((t) => t.samples.length);
  if (!tracks.length) throw new Error('no samples');
  const toMovie = (v, ts) => Math.round((v * m.movieTimescale) / ts);
  const big = tracks.some((t) => t.samples.some((s) => s[3] + s[2] > 0xffffffff));
  let movieDur = 0;
  const traks = tracks.map((t) => {
    const S = t.samples;
    const first = S[0][0];
    const mediaDur = S[S.length - 1][0] + S[S.length - 1][1] - first;
    const minCts = Math.min(...S.map((s) => s[0] + s[5]));
    // 轨道开始时间（例如声音比画面晚开始）用编辑列表补上，保证音画同步
    const startMovie = toMovie(first, t.timescale);
    const segMovie = toMovie(mediaDur, t.timescale);
    movieDur = Math.max(movieDur, startMovie + segMovie);
    // stts（行程编码）
    const stts = [];
    for (const s of S) { const last = stts[stts.length - 1]; if (last && last[1] === s[1]) last[0]++; else stts.push([1, s[1]]); }
    // ctts
    const hasCto = S.some((s) => s[5] !== 0), negCto = S.some((s) => s[5] < 0);
    const ctts = [];
    if (hasCto) for (const s of S) { const last = ctts[ctts.length - 1]; if (last && last[1] === s[5]) last[0]++; else ctts.push([1, s[5]]); }
    // 关键帧：sample_is_non_sync_sample 位（0x10000）为 0
    const sync = []; S.forEach((s, i) => { if (!(s[4] & 0x10000)) sync.push(i + 1); });
    // stsc：每个 trun 是一个 chunk
    const stsc = [];
    t.chunks.forEach((c, i) => { const last = stsc[stsc.length - 1]; if (!last || last[1] !== c[1]) stsc.push([i + 1, c[1], 1]); });
    const stbl = box('stbl',
      t.stsd,
      fullBox('stts', 0, 0, u32buf([stts.length]), u32buf(stts.flat())),
      ...(hasCto ? [fullBox('ctts', negCto ? 1 : 0, 0, u32buf([ctts.length]), negCto ? Buffer.concat(ctts.map(([c, o]) => Buffer.concat([u32buf([c]), i32buf([o])]))) : u32buf(ctts.flat()))] : []),
      ...(sync.length < S.length ? [fullBox('stss', 0, 0, u32buf([sync.length]), u32buf(sync))] : []),
      fullBox('stsc', 0, 0, u32buf([stsc.length]), u32buf(stsc.flat())),
      fullBox('stsz', 0, 0, u32buf([0, S.length]), u32buf(S.map((s) => s[2]))),
      big ? fullBox('co64', 0, 0, u32buf([t.chunks.length]), Buffer.concat(t.chunks.map((c) => u64be(c[2]))))
        : fullBox('stco', 0, 0, u32buf([t.chunks.length]), u32buf(t.chunks.map((c) => c[2]))),
    );
    const minf = box('minf', ...t.minfOther, stbl);
    const mdhd = fullBox('mdhd', 1, 0, u64be(0), u64be(0), u32buf([t.timescale]), u64be(mediaDur), t.mdhdTail);
    const mdia = box('mdia', mdhd, t.hdlr, minf);
    const tkhd = fullBox('tkhd', 1, t.tkFlags || 3, u64be(0), u64be(0), u32buf([t.trackId, 0]), u64be(startMovie + segMovie), t.tkhdTail);
    const edits = [];
    if (startMovie > 0) edits.push(Buffer.concat([u64be(startMovie), Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]), u32buf([0x10000])]));
    if (startMovie > 0 || minCts !== first) edits.push(Buffer.concat([u64be(segMovie), u64be(minCts - first), u32buf([0x10000])])); // 新样本表从 0 开始计时
    const edts = edits.length ? [box('edts', fullBox('elst', 1, 0, u32buf([edits.length]), ...edits))] : [];
    return box('trak', tkhd, ...edts, mdia);
  });
  const mvhd = fullBox('mvhd', 1, 0, u64be(0), u64be(0), u32buf([m.movieTimescale]), u64be(movieDur), m.mvhdTail);
  return { moov: box('moov', mvhd, ...traks, ...m.other), durationSec: movieDur / m.movieTimescale };
}

/**
 * 整理一个 MP4 文件（原地）。onProgress(0..1) 可选。
 * 返回 { changed, durationSec, reason }
 */
async function finalizeMp4(file, onProgress) {
  const fd = fs.openSync(file, 'r+');
  try {
    let fileSize = fs.fstatSync(fd).size;
    let boxes = topBoxes(fd, fileSize);
    // 上次整理到一半（新 moov 已追加、旧 box 还没改名）：去掉末尾那个 moov 重新来
    const firstFrag = boxes.findIndex((b) => b.type === 'moof');
    if (firstFrag >= 0) {
      const lateMoov = boxes.findIndex((b, i) => i > firstFrag && b.type === 'moov');
      if (lateMoov >= 0) { fs.ftruncateSync(fd, boxes[lateMoov].off); fileSize = boxes[lateMoov].off; boxes = topBoxes(fd, fileSize); }
    }
    const moovBox = boxes.find((b) => b.type === 'moov' && !b.truncated);
    if (!moovBox) return { changed: false, reason: 'no moov' };
    if (!boxes.some((b) => b.type === 'moof')) return { changed: false, reason: 'not fragmented' };
    const m = parseMoov(readAt(fd, moovBox.off, moovBox.size));
    if (!m.fragmented) return { changed: false, reason: 'not fragmented' };
    const mdats = boxes.filter((b) => b.type === 'mdat').map((b) => ({ start: b.off + b.hdr, end: Math.min(b.off + b.size, fileSize) }));
    // 逐个 moof 读样本表（moof 只有几 KB，读得很快）
    const moofs = [];
    let validEnd = moovBox.off + moovBox.size;
    let lastTick = Date.now();
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.truncated) break;
      if (b.type === 'moof') {
        const next = boxes[i + 1];
        if (!next || next.type !== 'mdat' || next.truncated) break; // 最后一段没写完整：不要
        const snapshot = [...m.tracks.values()].map((t) => [t.samples.length, t.chunks.length]);
        const ok = parseMoof(readAt(fd, b.off, b.size), b.off, m.tracks, fileSize, mdats);
        if (!ok) { [...m.tracks.values()].forEach((t, k) => { t.samples.length = snapshot[k][0]; t.chunks.length = snapshot[k][1]; }); break; }
        moofs.push(b.off);
        validEnd = next.off + next.size;
        i++;
      } else if (b.off >= validEnd) validEnd = b.off + b.size;
      if (onProgress && Date.now() - lastTick > 100) { lastTick = Date.now(); onProgress(Math.min(0.95, b.off / fileSize)); await new Promise((r) => setImmediate(r)); }
    }
    if (!moofs.length) return { changed: false, reason: 'no complete fragment' };
    const { moov, durationSec } = buildMoov(m);
    // 1) 截掉末尾不完整的部分，追加新 moov
    if (validEnd < fileSize) fs.ftruncateSync(fd, validEnd);
    fs.writeSync(fd, moov, 0, moov.length, validEnd);
    fs.fsyncSync(fd);
    // 2) 旧 moov / moof 改成 free（只改类型的 4 个字节）
    const FREE = Buffer.from('free', 'latin1');
    fs.writeSync(fd, FREE, 0, 4, moovBox.off + 4);
    for (const off of moofs) fs.writeSync(fd, FREE, 0, 4, off + 4);
    fs.fsyncSync(fd);
    if (onProgress) onProgress(1);
    return { changed: true, durationSec, truncated: validEnd < fileSize };
  } finally {
    fs.closeSync(fd);
  }
}

module.exports = { finalizeMp4 };
