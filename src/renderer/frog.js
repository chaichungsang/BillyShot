/* 呱咔 / Hopsnap 吉祥物：一只平涂的小青蛙，纯 SVG，没有描边、没有渐变、没有阴影。
   用法：Frog.svg('happy', 96) 返回 SVG 字符串；Frog.mount(el, 'blink') 直接塞进元素。
   表情：idle（默认微笑）blink（眨眼）happy（眯眼笑）snap（舌头叼着一张截图）puff（鼓腮，录屏倒计时）
         sad（委屈，权限 / 出错）x（叉叉眼，严重错误）wink（单眼）
   主进程 require 也能用（生成图标资源时）。 */
(function (root) {
  const C = {
    skin: '#46CF80', belly: '#B9F1CE', ink: '#163B2A', pupil: '#1A2B22', blush: '#FFA3B8', tongue: '#FF6B81', mint: '#D9F5E3', white: '#FFFFFF',
  };
  const S = 'stroke-linecap="round" stroke-linejoin="round" fill="none"';

  // 眼睛：open（圆眼）closed（闭眼弧）happy（^ 弧）x（叉叉）
  function eye(cx, kind, lookDown) {
    const py = lookDown ? 44 : 40, px = cx < 60 ? cx + 2 : cx - 2;
    if (kind === 'closed') return `<path d="M${cx - 11} 42 Q${cx} 50 ${cx + 11} 42" stroke="${C.ink}" stroke-width="3.6" ${S}/>`;
    if (kind === 'happy') return `<path d="M${cx - 11} 41 Q${cx} 29 ${cx + 11} 41" stroke="${C.ink}" stroke-width="3.6" ${S}/>`;
    if (kind === 'x') return `<path d="M${cx - 7} 33 L${cx + 7} 47 M${cx + 7} 33 L${cx - 7} 47" stroke="${C.ink}" stroke-width="3.6" ${S}/>`;
    return `<circle cx="${cx}" cy="38" r="15" fill="${C.white}"/><circle cx="${px}" cy="${py}" r="7" fill="${C.pupil}"/><circle cx="${px - 2.6}" cy="${py - 3}" r="2.4" fill="${C.white}"/>`;
  }

  function parts(mood) {
    const m = mood || 'idle';
    const puff = m === 'puff';
    const eyes = {
      idle: ['open', 'open'], blink: ['closed', 'closed'], happy: ['happy', 'happy'], snap: ['happy', 'happy'],
      puff: ['closed', 'closed'], sad: ['open', 'open'], x: ['x', 'x'], wink: ['closed', 'open'],
    }[m] || ['open', 'open'];
    let mouth;
    if (m === 'happy') mouth = `<path d="M40 78 Q60 102 80 78 Z" fill="${C.ink}"/><clipPath id="fm"><path d="M40 78 Q60 102 80 78 Z"/></clipPath><ellipse cx="60" cy="92" rx="10" ry="7" fill="${C.tongue}" clip-path="url(#fm)"/>`;
    else if (m === 'snap') mouth = `<path d="M44 80 Q60 92 76 80" stroke="${C.ink}" stroke-width="3.6" ${S}/>`
      + `<path d="M62 84 C 72 98, 88 100, 98 92" stroke="${C.tongue}" stroke-width="7" ${S}/>`
      + `<g transform="rotate(-12 100 88)"><rect x="90" y="80" width="22" height="17" rx="4" fill="${C.white}"/><rect x="93" y="83" width="16" height="11" rx="2" fill="${C.mint}"/><circle cx="98" cy="88" r="2" fill="${C.skin}"/></g>`;
    else if (m === 'sad') mouth = `<path d="M46 88 Q60 80 74 88" stroke="${C.ink}" stroke-width="3.6" ${S}/>`
      + `<path d="M26 28 L44 22 M94 28 L76 22" stroke="${C.ink}" stroke-width="3.2" ${S}/>`;
    else if (m === 'x') mouth = `<path d="M48 88 Q60 82 72 88" stroke="${C.ink}" stroke-width="3.6" ${S}/>`;
    else if (puff) mouth = `<circle cx="60" cy="84" r="4" stroke="${C.ink}" stroke-width="3.2" fill="none"/>`;
    else mouth = `<path d="M40 80 Q60 96 80 80" stroke="${C.ink}" stroke-width="3.6" ${S}/>`;
    const cheek = puff ? 'rx="14" ry="10"' : 'rx="9" ry="5.5"';
    return `
      <clipPath id="fh"><rect x="8" y="34" width="104" height="78" rx="36"/></clipPath>
      <rect x="8" y="34" width="104" height="78" rx="36" fill="${C.skin}"/>
      <ellipse cx="60" cy="104" rx="42" ry="24" fill="${C.belly}" clip-path="url(#fh)"/>
      <circle cx="38" cy="38" r="21" fill="${C.skin}"/><circle cx="82" cy="38" r="21" fill="${C.skin}"/>
      ${eye(38, eyes[0], m === 'sad')}${eye(82, eyes[1], m === 'sad')}
      <ellipse cx="25" cy="78" ${cheek} fill="${C.blush}" opacity=".9"/><ellipse cx="95" cy="78" ${cheek} fill="${C.blush}" opacity=".9"/>
      <circle cx="54" cy="66" r="1.9" fill="${C.ink}" opacity=".7"/><circle cx="66" cy="66" r="1.9" fill="${C.ink}" opacity=".7"/>
      ${mouth}`;
  }

  // 完整吉祥物（透明底）
  function svg(mood, size, attrs) {
    const w = size || 96;
    const tr = mood === 'puff' ? ' transform="translate(60 73) scale(1.08 1) translate(-60 -73)"' : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="${w}" height="${w}" class="frog frog-${mood || 'idle'}" ${attrs || ''} aria-hidden="true"><g${tr}>${parts(mood)}</g></svg>`;
  }
  // 应用图标：薄荷绿圆角方块 + 大脸（macOS 圆角按 1024 的 22.5%）
  function icon(size) {
    const w = size || 1024;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="${w}" height="${w}"><rect width="120" height="120" rx="27" fill="${C.mint}"/>`
      + `<g transform="translate(60 66) scale(1.02) translate(-60 -66)">${parts('idle')}</g></svg>`;
  }
  // 托盘（Windows，彩色）：去掉腮红和鼻孔，眼睛更大，小尺寸更清楚
  function tray(size) {
    const w = size || 32;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="${w}" height="${w}">`
      + `<rect x="2" y="30" width="116" height="86" rx="40" fill="${C.skin}"/>`
      + `<circle cx="36" cy="36" r="26" fill="${C.skin}"/><circle cx="84" cy="36" r="26" fill="${C.skin}"/>`
      + `<circle cx="36" cy="36" r="18" fill="${C.white}"/><circle cx="84" cy="36" r="18" fill="${C.white}"/>`
      + `<circle cx="39" cy="39" r="9" fill="${C.pupil}"/><circle cx="81" cy="39" r="9" fill="${C.pupil}"/>`
      + `<path d="M38 82 Q60 102 82 82" stroke="${C.ink}" stroke-width="7" ${S}/></svg>`;
  }
  // 菜单栏模板图（macOS，单色 + 透明）：剪影，瞳孔和嘴挖空
  function mark(size, color) {
    const w = size || 18, c = color || '#000';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="${w}" height="${w}">`
      + `<mask id="mk"><rect width="120" height="120" fill="#fff"/><circle cx="40" cy="40" r="9" fill="#000"/><circle cx="80" cy="40" r="9" fill="#000"/>`
      + `<path d="M38 82 Q60 102 82 82" stroke="#000" stroke-width="8" ${S}/></mask>`
      + `<g mask="url(#mk)" fill="${c}"><rect x="2" y="30" width="116" height="86" rx="40"/><circle cx="36" cy="36" r="26"/><circle cx="84" cy="36" r="26"/></g></svg>`;
  }
  function mount(el, mood, size) { if (el) el.innerHTML = svg(mood, size); }

  const api = { svg, icon, tray, mark, mount, colors: C };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Frog = api;
})(typeof window !== 'undefined' ? window : globalThis);
