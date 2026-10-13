// 设置存储：JSON 文件保存在 userData 目录
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const isMac = process.platform === 'darwin';

function defaults() {
  const pics = safePath('pictures');
  const vids = safePath('videos');
  return {
    version: 1,
    hotkeys: {
      // 每个动作：keyboard（键盘组合）+ mouse（鼠标组合，如 "Ctrl+Mouse4"）
      capture: { keyboard: isMac ? 'Control+Command+A' : 'Alt+A', mouse: '' },
      captureFull: { keyboard: isMac ? 'Control+Command+Shift+A' : 'Alt+Shift+A', mouse: '' },
      recordRegion: { keyboard: isMac ? 'Control+Command+R' : 'Alt+R', mouse: '' },
      recordFull: { keyboard: isMac ? 'Control+Command+Shift+R' : 'Alt+Shift+R', mouse: '' },
      pinClipboard: { keyboard: isMac ? 'Control+Command+P' : 'Alt+P', mouse: '' },
      // 演示模式 / 聚光灯默认不占用快捷键（不影响没用这个功能的人），需要的话在 设置 → 快捷键 里设置
      presentMode: { keyboard: '', mouse: '' },
      spotlight: { keyboard: '', mouse: '' },
    },
    // 演示录屏（1.3.0）：鼠标光圈 / 点击波纹 / 聚光灯 / 摄像头圆窗，默认全部关闭
    present: {
      halo: false,            // 鼠标光圈
      haloColor: '#ffd23f',
      haloSize: 56,           // 直径（px）
      haloOpacity: 0.35,
      clicks: false,          // 点击波纹
      clickLeft: '#ff4d6d',
      clickRight: '#3d8bff',
      rippleStyle: 'water',   // water 水波纹。存过的 single 由演示层画成同心白圈，设置里不再提供单圈
      withRecord: true,       // 录屏时自动显示已开启的光圈 / 波纹
      spotRadius: 170,        // 聚光灯亮圈半径（px）
      spotDim: 0.6,           // 聚光灯变暗程度 0–1
      camera: false,          // 录屏时显示摄像头
      cameraDeviceId: '',
      cameraShape: 'circle',  // circle | rounded
      cameraSize: 'm',        // s | m | l
      cameraMirror: true,
      cameraPos: null,        // { cx, cy } 圆窗中心在屏幕上的相对位置（0–1）
    },
    capture: {
      windowDetect: true,      // 鼠标悬停自动识别窗口
      magnifier: true,         // 放大镜 + 取色
      autoSave: false,         // 完成截图时同时自动保存到文件夹
      imageFormat: 'png',      // png | jpg
      jpgQuality: 92,
      saveDir: path.join(pics, 'BillyShot'),
      historyMax: 30,
    },
    record: {
      quality: '1080',        // source | 2160 | 1440 | 1080 | 720
      fps: 30,                // 24 | 30 | 60
      format: 'mp4',          // mp4 | gif（默认格式，全屏录屏用）
      regionFormat: '',       // 区域录屏上次选的格式（空 = 跟默认格式）
      systemAudio: false,
      mic: false,
      micDeviceId: '',
      countdown: 3,
      hideBarFull: false,     // 全屏录制时隐藏控制条
      demoCaptureBar: false, // 演示时截图包含录制条（默认关；不进入正常录屏画面）
      bitrate: 0,             // Mbps，0 = 自动
      gifFps: 12,
      gifMaxWidth: 960,
      saveDir: path.join(vids, 'BillyShot'),
    },
    sound: {
      volume: 70,             // 0-100
      capture: 'shutter',     // shutter | soft | done | off
      record: true,           // 录屏开始/结束提示音
      countdown: true,        // 倒计时滴答声
      notify: true,           // 系统通知提示音
    },
    general: {
      language: 'auto',       // auto（跟随系统）| zh | en
      launchAtLogin: false,
      firstRun: true,
      logo: 'portrait',       // 应用图标：portrait（头像版）| purple（紫色玻璃版）
      logoMacOk: false,       // macOS：访达里的 .app 图标已成功换成自定义图标（升级后据此补回）
      theme: 'auto',          // 主题配色：auto（跟随图标）| midnight | gold | graphite | ocean | forest | rose | paper | glass | matrix
      appearance: 'system',   // 深浅色：system（跟随系统）| light | dark
      axAskedVer: '',         // macOS：这个版本已经弹过一次「辅助功能」系统授权框（每个版本最多一次）
      macMoveAsk: true,       // macOS：不在「应用程序」文件夹运行时，启动时建议移过去
    },
  };
}

function safePath(name) {
  try { return app.getPath(name); } catch { return app.getPath('home'); }
}

function deepMerge(base, over) {
  if (!over || typeof over !== 'object') return base;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const k of Object.keys(over)) {
    if (base && typeof base[k] === 'object' && base[k] !== null && !Array.isArray(base[k])) {
      out[k] = deepMerge(base[k], over[k]);
    } else {
      out[k] = over[k];
    }
  }
  return out;
}

class Settings {
  constructor() {
    this.file = path.join(app.getPath('userData'), 'settings.json');
    this.data = defaults();
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data = deepMerge(defaults(), raw);
    } catch { /* 首次运行 */ }
  }
  get() { return this.data; }
  set(patch) {
    this.data = deepMerge(this.data, patch);
    this.save();
    return this.data;
  }
  reset() {
    const g = this.data.general || {};
    this.data = defaults(); this.data.general.firstRun = false;
    // 「恢复默认」不重新弹 Mac 的授权框 / 移动提示
    this.data.general.axAskedVer = g.axAskedVer || ''; this.data.general.macMoveAsk = g.macMoveAsk !== false;
    this.save(); return this.data;
  }
  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      try { fs.renameSync(tmp, this.file); } catch { fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2)); try { fs.unlinkSync(tmp); } catch {} }
    } catch (e) { console.error('save settings failed', e); }
  }
}

module.exports = { Settings, defaults };
