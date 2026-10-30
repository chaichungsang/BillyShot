// 检查新版本：问 GitHub Releases 最新的 tag，和当前版本比。只读，不下载、不自动安装、不上传任何东西。
// 仓库地址来自 package.json 的 repository（仓库改名后 GitHub 会 301 到新地址，这里跟着跳）。
const { app, net } = require('electron');

const pkg = require('../package.json');
const repoUrl = String((pkg.repository && pkg.repository.url) || pkg.repository || '').replace(/^git\+/, '').replace(/\.git$/, '');
const m = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
const REPO = m ? `${m[1]}/${m[2]}` : null;
const API = REPO ? `https://api.github.com/repos/${REPO}/releases/latest` : null;
const PAGE = REPO ? `https://github.com/${REPO}/releases/latest` : null;

function parseVer(v) { return String(v || '').replace(/^v/i, '').split(/[.+-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0); }
function newer(a, b) { const x = parseVer(a), y = parseVer(b); for (let i = 0; i < 3; i++) { if (x[i] !== y[i]) return x[i] > y[i]; } return false; }

// 返回 { ok, current, latest, hasUpdate, url, notes, error }
async function check(timeoutMs = 8000) {
  const current = app.getVersion();
  if (!API) return { ok: false, current, error: 'no-repo' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await net.fetch(API, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': `Hopsnap/${current}` }, signal: ctrl.signal });
    if (res.status === 404) return { ok: true, current, latest: current, hasUpdate: false, url: PAGE };   // 还没发过 release
    if (!res.ok) return { ok: false, current, error: `http ${res.status}` };
    const j = await res.json();
    const latest = String(j.tag_name || j.name || '').replace(/^v/i, '');
    if (!latest) return { ok: false, current, error: 'no-tag' };
    return { ok: true, current, latest, hasUpdate: newer(latest, current), url: j.html_url || PAGE, notes: String(j.body || '').slice(0, 2000) };
  } catch (e) {
    return { ok: false, current, error: e.name === 'AbortError' ? 'timeout' : (e.message || String(e)) };
  } finally { clearTimeout(timer); }
}

module.exports = { check, newer, REPO, PAGE };
