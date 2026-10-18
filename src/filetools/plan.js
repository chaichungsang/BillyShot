// 动作弧、改尺寸、GIF 15 秒、合成 PDF 排序、编码器选择。纯函数，给界面和测试共用。
const path = require('path');

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.heic', '.heif']);
const VIDEO_EXT = new Set(['.mov', '.mp4', '.m4v', '.webm', '.mkv', '.avi']);

function extOf(file) {
  return path.extname(String(file || '')).toLowerCase();
}
function kindOf(file) {
  const e = extOf(file);
  if (IMAGE_EXT.has(e)) return 'image';
  if (VIDEO_EXT.has(e)) return 'video';
  if (e === '.pdf') return 'pdf';
  return 'other';
}
function imageFormat(file) {
  const e = extOf(file);
  if (e === '.jpg' || e === '.jpeg') return 'jpg';
  if (e === '.png') return 'png';
  if (e === '.webp') return 'webp';
  if (e === '.heic' || e === '.heif') return 'heic';
  return '';
}

// 单张图 → image；单个视频 → video；多张图 / PDF / 图和 PDF 混放 → pdf。别的不弹弧。
function groupOf(files) {
  const list = files || [];
  if (!list.length) return null;
  const kinds = list.map(kindOf);
  if (kinds.every((k) => k === 'video')) return list.length === 1 ? 'video' : null;
  if (kinds.every((k) => k === 'image' || k === 'pdf')) {
    if (list.length === 1 && kinds[0] === 'image') return 'image';
    return 'pdf';
  }
  return null;
}

function naturalSort(files) {
  return [...(files || [])].sort((a, b) => path.basename(a).localeCompare(path.basename(b), undefined, { numeric: true, sensitivity: 'base' }));
}

// 预设会放大原图时变灰，不藏起来。50% 只会缩小，永远可点。
// 灰掉的宽度预设带提示「原图小于 1920，不放大」（数字跟这个预设走）。
function resizeChoices(width) {
  const w = Number(width);
  const known = Number.isFinite(w) && w > 0;
  const widthChoice = (id, value) => {
    const grey = !known || w < value;
    let reason = '';
    if (!known) reason = '不知道原图宽度，不放大';
    else if (w < value) reason = `原图小于 ${value}，不放大`;
    return { id, label: `宽 ${value}`, mode: 'width', value, grey, reason };
  };
  return [
    { id: 'p50', label: '50%', mode: 'percent', value: 50, grey: false, reason: '' },
    widthChoice('w1920', 1920),
    widthChoice('w1280', 1280),
  ];
}

// 自定义宽度锁住比例，并且不超过原图宽度。
function capWidth(requested, original) {
  const orig = Math.round(Number(original));
  const req = Math.round(Number(requested));
  if (!Number.isFinite(orig) || orig < 1) throw Object.assign(new Error('unknown width'), { code: 'ESIZE' });
  if (!Number.isFinite(req) || req < 1) throw Object.assign(new Error('bad width'), { code: 'ESIZE' });
  return Math.min(req, orig);
}

function gifPlan(duration) {
  // 超过 15 秒：键变灰但仍可点（金色虚线圈）。点下去打开剪头尾，预选前 15 秒，主按钮是「剪切并转 GIF」。
  // 不知道时长时也不直接转，避免悄悄截断；这种不算“太长”，所以不单为这个变灰。
  const trim = { start: 0, end: 15 };
  const confirm = '剪切并转 GIF';
  if (duration == null || !Number.isFinite(Number(duration))) {
    return { grey: false, dashed: false, route: 'trim', reason: '', detail: '先确认片段再转 GIF', trim, confirm };
  }
  if (Number(duration) > 15) {
    return {
      grey: true, dashed: true, route: 'trim', confirm, trim,
      reason: 'GIF 最长 15 秒，先剪一段',
      detail: '点一下打开剪头尾，已预选前 15 秒',
    };
  }
  return { grey: false, dashed: false, route: 'gif', reason: '', detail: '', confirm: '' };
}

function convertPills(file) {
  const cur = imageFormat(file);
  return [
    { format: 'png', label: 'PNG' },
    { format: 'jpg', label: 'JPG' },
    { format: 'webp', label: 'WebP' },
  ].filter((p) => p.format !== cur);
}

function ringModel({ files, duration, width } = {}) {
  const group = groupOf(files);
  if (!group) return null;
  if (group === 'pdf') {
    return { group, keys: [{ slot: 1, action: 'pdf.make', label: '合成 PDF', grey: false, reason: '' }] };
  }
  if (group === 'image') {
    return {
      group,
      keys: [
        { slot: 1, action: 'image.convert', label: '转格式', grey: false, reason: '', pills: convertPills(files[0]) },
        { slot: 2, action: 'image.compress', label: '压缩图片', grey: false, reason: '', panel: 'compress-image' },
        {
          slot: 3, action: 'image.resize', label: '改尺寸', grey: false, reason: '',
          pills: resizeChoices(width),
          custom: { id: 'custom', label: '自定义…', mode: 'custom', grey: false, reason: '', panel: 'resize' },
        },
      ],
    };
  }
  const gif = gifPlan(duration);
  const mp4 = extOf(files[0]) === '.mp4';
  return {
    group,
    keys: [
      { slot: 1, action: 'video.mp4', label: '转 MP4', grey: mp4, reason: mp4 ? '已是 MP4' : '' },
      { slot: 2, action: 'video.compress', label: '压缩视频', grey: false, reason: '', panel: 'compress-video' },
      { slot: 3, action: 'video.trim', label: '剪头尾', grey: false, reason: '', panel: 'trim' },
      {
        slot: 4, action: 'video.gif', label: '转 GIF', grey: gif.grey, dashed: !!gif.dashed,
        reason: gif.reason, detail: gif.detail || '', route: gif.route, trim: gif.trim || null,
        confirm: gif.confirm || '', clickable: true,
      },
    ],
  };
}

const FORBIDDEN_ENCODERS = ['libx264', 'libx265', 'libxvid', 'libx264rgb'];
const LEVELS = {
  high: { maxWidth: 0, bitrate: '8M', qv: '65' },
  medium: { maxWidth: 1280, bitrate: '3M', qv: '50' },
  small: { maxWidth: 854, bitrate: '1M', qv: '35' },
};

function encodePlan(platform, available) {
  const have = new Set(available || []);
  const plan = [];
  const hw = platform === 'darwin' ? 'h264_videotoolbox' : platform === 'win32' ? 'h264_mf' : null;
  if (hw && have.has(hw)) plan.push(hw);
  if (have.has('mpeg4')) plan.push('mpeg4');
  return plan.filter((name) => !FORBIDDEN_ENCODERS.includes(name));
}

function codecArgs(encoder, { arch, bitrate, qv } = {}) {
  if (FORBIDDEN_ENCODERS.includes(encoder)) throw Object.assign(new Error('refusing GPL encoder'), { code: 'EGPL' });
  if (encoder === 'h264_videotoolbox') {
    const args = ['-c:v', 'h264_videotoolbox', '-allow_sw', '1', '-pix_fmt', 'yuv420p'];
    if (arch === 'arm64') args.push('-q:v', String(qv || '65'));
    else args.push('-b:v', bitrate || '8M');
    return args;
  }
  if (encoder === 'h264_mf') return ['-c:v', 'h264_mf', '-rate_control', 'cbr', '-b:v', bitrate || '3M', '-pix_fmt', 'yuv420p'];
  if (encoder === 'mpeg4') return ['-c:v', 'mpeg4', '-b:v', bitrate || '3M', '-pix_fmt', 'yuv420p'];
  throw Object.assign(new Error('no H.264 encoder'), { code: 'ENOENC' });
}

function scaleFilter(maxWidth) {
  const w = Number(maxWidth) || 0;
  if (!w) return '';
  return `scale='min(${w},iw)':-2`;
}

function bitrateBits(token) {
  const m = String(token || '').trim().match(/^([\d.]+)\s*([kKmM])?$/);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const u = (m[2] || '').toLowerCase();
  if (u === 'm') return n * 1e6;
  if (u === 'k') return n * 1e3;
  return n;
}

// 目标码率 × 时长。算不出来就返回 null，界面不写假数字。
function estimateVideoBytes(bitrate, durationSec, withAudio = true) {
  const dur = Number(durationSec);
  const bits = bitrateBits(bitrate);
  if (!Number.isFinite(dur) || dur <= 0 || !bits) return null;
  const audio = withAudio ? 128000 : 0;
  return Math.round((bits + audio) * dur / 8);
}

function parseProgress(chunk, durationSec) {
  const text = String(chunk || '');
  let outUs = null;
  let speed = null;
  let end = false;
  for (const line of text.split(/\r?\n/)) {
    const [k, v] = line.split('=');
    if (!k || v == null) continue;
    if (k === 'out_time_us') outUs = Number(v);
    else if (k === 'out_time_ms' && outUs == null) outUs = Number(v); // 有的构建把微秒写在这个字段
    else if (k === 'speed') {
      const m = String(v).match(/([\d.]+)/);
      speed = m ? Number(m[1]) : null;
    } else if (k === 'progress' && v.trim() === 'end') end = true;
  }
  const dur = Number(durationSec);
  const known = Number.isFinite(dur) && dur > 0 && outUs != null && Number.isFinite(outUs);
  const ratio = known ? Math.max(0, Math.min(1, (outUs / 1e6) / dur)) : null;
  let remain = null;
  if (known && speed && speed > 0) remain = Math.max(0, (dur - outUs / 1e6) / speed);
  return { ratio, remain, speed, end, indeterminate: !known };
}

const HEIC_MESSAGE = '这台电脑读不了 HEIC：没有安装「HEIF 图像扩展」。请到 Microsoft Store 安装后再试。文件没有被修改。';

function outputSpec(action, options, file) {
  const fmt = imageFormat(file);
  if (action === 'image.convert') return { suffix: '', ext: options.format === 'jpeg' ? 'jpg' : options.format };
  if (action === 'image.compress') return { suffix: 'compressed', ext: fmt === 'heic' ? 'jpg' : (fmt || 'jpg') };
  if (action === 'image.resize') return { suffix: 'resized', ext: fmt === 'heic' ? 'jpg' : (fmt || 'png') };
  if (action === 'video.mp4') return { suffix: '', ext: 'mp4' };
  if (action === 'video.compress') return { suffix: 'compressed', ext: 'mp4' };
  if (action === 'video.trim') return { suffix: 'trimmed', ext: 'mp4' };
  if (action === 'video.gif') return { suffix: '', ext: 'gif' };
  if (action === 'pdf.make') return { suffix: filesSuffix(options), ext: 'pdf' };
  return { suffix: 'out', ext: 'bin' };
}

function filesSuffix(options) {
  return options && options.merged ? 'merged' : '';
}

module.exports = {
  IMAGE_EXT, VIDEO_EXT, kindOf, groupOf, imageFormat, naturalSort, resizeChoices, capWidth, gifPlan,
  convertPills, ringModel, FORBIDDEN_ENCODERS, LEVELS, encodePlan, codecArgs, scaleFilter,
  estimateVideoBytes, parseProgress, HEIC_MESSAGE, outputSpec,
};
