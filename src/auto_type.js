const { clipboard } = require('electron');
const { exec } = require('child_process');

/**
 * 执行 Ctrl+V 粘贴（当前剪贴板内容）
 */
function sendPaste(callback) {
  exec(
    'powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait(\'^v\')"',
    (err) => {
      if (err) {
        exec(
          'powershell -NoProfile -Command "$wshell=New-Object -ComObject wscript.shell; $wshell.SendKeys(\'^v\')"',
          (err2) => { if (err2) console.error('Paste failed:', err2.message); if (callback) callback(); }
        );
      } else {
        if (callback) callback();
      }
    }
  );
}

/**
 * 粘贴文本 — 写剪贴板 + Ctrl+V（完美支持中文）
 */
function typeText(text, callback) {
  if (!text) return typeof callback === 'function' && callback();
  clipboard.writeText(text);
  sendPaste(callback);
}

module.exports = { typeText };
