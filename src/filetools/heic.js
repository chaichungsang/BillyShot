// HEIC：Mac 用 sips（ImageIO）。Windows 试 WIC，没有 HEIF 扩展就明确报错，不静默失败。
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { HEIC_MESSAGE } = require('./plan');

function isHeic(file) {
  const e = path.extname(file).toLowerCase();
  return e === '.heic' || e === '.heif';
}

function heicError() {
  return Object.assign(new Error(HEIC_MESSAGE), { code: 'HEIC_UNSUPPORTED' });
}

function sipsArgs(input, output, format) {
  return ['-s', 'format', format, input, '--out', output];
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (b) => { err += b.toString(); });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(Object.assign(new Error(err.trim() || `${cmd} exit ${code}`), { code: 'EHEIC' }))));
  });
}

async function decodeHeic(input, destPng, platform = process.platform) {
  if (platform === 'darwin') {
    await run('sips', sipsArgs(input, destPng, 'png'));
    if (!fs.existsSync(destPng) || !fs.statSync(destPng).size) throw heicError();
    return destPng;
  }
  if (platform === 'win32') {
    const script = path.join(__dirname, '..', '..', 'native', 'win', 'heic.ps1');
    try {
      await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, input, destPng]);
    } catch {
      throw heicError();
    }
    if (!fs.existsSync(destPng) || !fs.statSync(destPng).size) throw heicError();
    return destPng;
  }
  throw heicError();
}

module.exports = { isHeic, heicError, sipsArgs, decodeHeic, HEIC_MESSAGE };
