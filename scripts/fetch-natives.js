// 打包前确保各平台的 node-screenshots 原生包都在 node_modules 里（npm 默认只装当前平台）
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const ver = require('../node_modules/node-screenshots/package.json').version;
const pkgs = ['node-screenshots-win32-x64-msvc', 'node-screenshots-darwin-x64', 'node-screenshots-darwin-arm64'];
const nm = path.join(__dirname, '..', 'node_modules');
for (const p of pkgs) {
  const dest = path.join(nm, p);
  if (fs.existsSync(path.join(dest, 'package.json'))) { console.log('ok', p); continue; }
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ns-'));
  const file = execSync(`npm pack ${p}@${ver} --silent`, { cwd: tmp }).toString().trim().split('\n').pop();
  fs.mkdirSync(dest, { recursive: true });
  execSync(`tar xzf ${path.join(tmp, file)} -C ${dest} --strip-components=1`);
  console.log('fetched', p);
}
