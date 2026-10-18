// 打包前把别的平台的预编译原生包装进 node_modules。npmRebuild 是 false，不会在打包机上重编。
// 所以 Windows / Mac 的 sharp 必须是官方的预编译包，不能是这台 Linux 机器编出来的。
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const nm = path.join(__dirname, '..', 'node_modules');

function fetchPkg(name, version) {
  const dest = name.startsWith('@')
    ? path.join(nm, ...name.split('/'))
    : path.join(nm, name);
  if (fs.existsSync(path.join(dest, 'package.json'))) { console.log('ok', name); return dest; }
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'native-'));
  const file = execSync(`npm pack ${name}@${version} --silent`, { cwd: tmp }).toString().trim().split('\n').pop();
  fs.mkdirSync(dest, { recursive: true });
  execSync(`tar -xzf ${path.join(tmp, file)} -C ${dest} --strip-components=1`);
  console.log('fetched', name);
  return dest;
}

const shotVer = require('../node_modules/node-screenshots/package.json').version;
for (const p of ['node-screenshots-win32-x64-msvc', 'node-screenshots-darwin-x64', 'node-screenshots-darwin-arm64']) {
  fetchPkg(p, shotVer);
}

const sharpOpt = require('../node_modules/sharp/package.json').optionalDependencies;
for (const p of [
  '@img/sharp-win32-x64',
  '@img/sharp-darwin-x64', '@img/sharp-libvips-darwin-x64',
  '@img/sharp-darwin-arm64', '@img/sharp-libvips-darwin-arm64',
]) {
  fetchPkg(p, sharpOpt[p]);
}
