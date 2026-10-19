// Shift 拖不需要辅助功能或输入监控。探测成功就不弹权限页。
// 「暂不」逻辑仍留着：万一以后探测说要权限，只问一次，跳过后不再问。
function decide(state, probe) {
  const s = state || {};
  if (s.shiftDrag === 'off' || s.shiftDrag === false || s.shiftDragDeclined) return { action: 'off' };
  if (probe && probe.ok && probe.permission === 'none') return { action: 'start', prompt: false };
  if (probe && probe.needsPermission) {
    if (s.shiftDragAsked && !s.reenable) return { action: 'off' };
    return { action: 'prompt', permission: 'accessibility', service: 'kTCCServiceAccessibility' };
  }
  if (probe && probe.ok === false) return { action: 'off' };
  return { action: 'start', prompt: false };
}

function afterPrompt(choice) {
  if (choice === 'decline') return { shiftDrag: 'off', shiftDragDeclined: true, shiftDragAsked: true };
  return { shiftDrag: 'on', shiftDragDeclined: false, shiftDragAsked: true };
}

module.exports = { decide, afterPrompt };
