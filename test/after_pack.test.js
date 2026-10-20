'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { strip } = require('../scripts/after-pack-mac-ffmpeg.js');

function tree(base, rels) {
  for (const rel of rels) {
    const p = path.join(base, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, 'x');
  }
}
const FFMPEG = ['darwin-arm64/ffmpeg', 'darwin-x64/ffmpeg', 'linux-x64/ffmpeg', 'win32-x64/ffmpeg.exe', 'COPYING.LGPLv2.1'];

test('Windows package keeps only win32-x64 ffmpeg and no Mac helper', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-win-'));
  const root = path.join(out, 'resources', 'app.asar.unpacked');
  tree(path.join(root, 'vendor', 'ffmpeg'), FFMPEG);
  tree(path.join(root, 'native'), ['mac/ShiftDrag', 'mac/ShiftDrag.swift', 'win/heic.ps1']);
  strip({ electronPlatformName: 'win32', arch: 1, appOutDir: out });
  assert.deepStrictEqual(fs.readdirSync(path.join(root, 'vendor', 'ffmpeg')).sort(), ['COPYING.LGPLv2.1', 'win32-x64']);
  assert.deepStrictEqual(fs.readdirSync(path.join(root, 'native')).sort(), ['win']);
});

test('Mac package keeps only its arch ffmpeg and no Windows helper', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-mac-'));
  const root = path.join(out, 'BillyShot.app', 'Contents', 'Resources', 'app.asar.unpacked');
  tree(path.join(root, 'vendor', 'ffmpeg'), FFMPEG);
  tree(path.join(root, 'native'), ['mac/ShiftDrag', 'win/heic.ps1']);
  strip({ electronPlatformName: 'darwin', arch: 3, appOutDir: out });
  assert.deepStrictEqual(fs.readdirSync(path.join(root, 'vendor', 'ffmpeg')).sort(), ['COPYING.LGPLv2.1', 'darwin-arm64']);
  assert.deepStrictEqual(fs.readdirSync(path.join(root, 'native')).sort(), ['mac']);
});

test('Linux and missing trees are left alone; a missing keep tree fails', () => {
  assert.strictEqual(strip({ electronPlatformName: 'linux', arch: 1, appOutDir: '/nonexistent' }), null);
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-bad-'));
  tree(path.join(out, 'resources', 'app.asar.unpacked', 'vendor', 'ffmpeg'), ['darwin-x64/ffmpeg']);
  assert.throws(() => strip({ electronPlatformName: 'win32', arch: 1, appOutDir: out }), /missing win32-x64/);
});
