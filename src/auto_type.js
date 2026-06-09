const { clipboard } = require('electron');
const { exec } = require('child_process');

/**
 * 粘贴文本到当前焦点窗口 — 零延迟
 * 写入剪贴板后立即执行 Ctrl+V
 */
function typeText(text) {
  clipboard.writeText(text);

  // 方法1: SendKeys via Windows.Forms (最快最可靠)
  exec(
    'powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait(\'^v\')"',
    (err) => {
      if (err) {
        // 方法2: wscript.shell COM (兼容旧系统)
        exec(
          'powershell -NoProfile -Command "$wshell=New-Object -ComObject wscript.shell; $wshell.SendKeys(\'^v\')"',
          (err2) => {
            if (err2) console.error('SendKeys failed:', err2.message);
          }
        );
      }
    }
  );
}

module.exports = { typeText };
