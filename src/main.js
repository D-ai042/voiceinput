const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const baiduStt = require('./baidu_stt');
const baiduStream = require('./baidu_stream');
const autoType = require('./auto_type');

let mainWindow = null;
let settingsWindow = null;
let tray = null;
let isRecording = false;
let isProcessing = false;
let isPasting = false;
let currentProvider = 'baidu_stream';
let streamResultText = '';
let accumulatedText = '';
let pastedLength = 0; // 已流式粘贴的字符长度，避免重复

const ICONS = {
  normal: '🎤',
  recording: '🔴',
  processing: '⏳',
  success: '✅',
  error: '❌'
};

function getConfig() {
  const configPath = path.join(__dirname, 'config.js');
  delete require.cache[require.resolve(configPath)];
  return require('./config');
}

/**
 * 读取完整的用户设置
 */
function readUserSettings() {
  try {
    const userDataPath = app.getPath('userData');
    const settingsPath = path.join(userDataPath, 'settings.json');
    if (fs.existsSync(settingsPath)) {
      return JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    }
  } catch (e) { /* ignore */ }
  return {};
}

/**
 * 写入完整的用户设置
 */
function writeUserSettings(settings) {
  const userDataPath = app.getPath('userData');
  const settingsPath = path.join(userDataPath, 'settings.json');
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

  // 清除 config.js 缓存
  const configPath = path.join(__dirname, 'config.js');
  delete require.cache[require.resolve(configPath)];
  baiduStt.resetToken();

  // 更新当前 provider
  currentProvider = settings.PROVIDER || 'baidu_stream';
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 120,
    height: 200,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'window.html'));

  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  mainWindow.setPosition(width - 150, height - 230);

  mainWindow.once('ready-to-show', () => {
    // 窗口默认隐藏，后台运行
    // 用户通过 Ctrl+Shift+V 录音，文字直接到当前焦点输入框
    updateIcon('normal');
    updateStatus('就绪');
    if (tray) {
      tray.setToolTip('VoiceInput - 就绪 (Ctrl+Shift+V 录音)');
    }
  });

  // 保活：每 5 秒确保窗口可见且置顶
  setInterval(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setAlwaysOnTop(true);
    }
  }, 5000);
}

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  let trayIcon;

  if (fs.existsSync(iconPath)) {
    trayIcon = nativeImage.createFromPath(iconPath);
  } else {
    // 极简后备：16x16 蓝色方块
    const buf = Buffer.alloc(16 * 16 * 4);
    for (let i = 0; i < 16 * 16; i++) { buf[i * 4 + 3] = 255; }
    trayIcon = nativeImage.createFromBuffer(buf, { width: 16, height: 16 });
  }

  tray = new Tray(trayIcon);
  updateTrayMenu(false);

  tray.on('double-click', () => {
    if (isRecording || isProcessing) {
      stopRecording();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

/**
 * 更新托盘菜单和提示文字
 * @param {boolean} isRecordingActive - 是否正在录音
 */
function updateTrayMenu(isRecordingActive) {
  if (!tray) return;

  if (isRecordingActive) {
    tray.setToolTip('🔴 VoiceInput - 录音中... (双击托盘停止)');
    const contextMenu = Menu.buildFromTemplate([
      { label: '⏹ 停止录音', click: () => stopRecording() },
      { type: 'separator' },
      { label: '设置', click: () => showSettingsWindow() },
      { type: 'separator' },
      { label: '退出', click: () => app.quit() }
    ]);
    tray.setContextMenu(contextMenu);
  } else {
    tray.setToolTip('VoiceInput - 语音输入 (双击打开)');
    const contextMenu = Menu.buildFromTemplate([
      { label: '显示', click: () => { mainWindow.show(); mainWindow.focus(); } },
      { label: '设置', click: () => showSettingsWindow() },
      { type: 'separator' },
      { label: '退出', click: () => app.quit() }
    ]);
    tray.setContextMenu(contextMenu);
  }
}

function updateIcon(status) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-icon', ICONS[status] || ICONS.normal);
  }
}

function updateStatus(text) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-status', text);
  }
}

/**
 * 打开独立设置窗口
 */
function showSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 480,
    height: 420,
    resizable: false,
    alwaysOnTop: true,
    frame: true,
    title: 'VoiceInput 设置',
    webPreferences: {
      preload: path.join(__dirname, 'settings_preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  settingsWindow.loadFile(path.join(__dirname, 'settings.html'));

  // 居中显示
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: sw, height: sh } = primaryDisplay.workAreaSize;
  const [winW, winH] = settingsWindow.getSize();
  settingsWindow.setPosition(
    Math.round((sw - winW) / 2),
    Math.round((sh - winH) / 2)
  );

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });

  // 聚焦设置窗口
  settingsWindow.show();
  settingsWindow.focus();
}

async function startRecording() {
  if (isRecording || isProcessing || baiduStream.isStreaming()) return;

  const config = getConfig();

  if (!config.BAIDU_APP_ID || !config.BAIDU_API_KEY) {
    // 不弹窗，只通过托盘提示
    if (tray) tray.setToolTip('⚠️ VoiceInput - 请先配置 API Key');
    showSettingsWindow();
    return;
  }

  // ===== 确保窗口隐藏，不打扰用户 =====
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
    mainWindow.hide();
  }

  if (currentProvider === 'baidu_normal') {
    // ===== 标准模式 =====
    isRecording = true;
    if (tray) tray.setToolTip('🔴 VoiceInput - 录音中 (双击停止)');
    updateTrayMenu(true);
    mainWindow.webContents.send('start-recording');
  } else {
    // ===== 流式模式 =====
    startStreamRecording();
  }
}

async function stopRecording() {
  if (!isRecording) return;

  if (currentProvider === 'baidu_normal') {
    isRecording = false;
    isProcessing = true;
    if (tray) tray.setToolTip('⏳ VoiceInput - 识别中...');
    updateTrayMenu(false);
    mainWindow.webContents.send('stop-recording');
  } else {
    stopStreamRecording();
  }
}

/**
 * 流式录音开始 — 全程静默，不弹窗，文字直达输入框
 */
function startStreamRecording() {
  isRecording = true;
  streamResultText = '';
  accumulatedText = '';
  pastedLength = 0;

  updateIcon('recording');
  updateTrayMenu(true);
  if (tray) tray.setToolTip('🔴 VoiceInput - 录音中 (Ctrl+Shift+V 停止)');

  // 启动百度流式识别
  const started = baiduStream.start(
    // onResult — 收到识别结果，直接粘贴，不经过窗口
    (text, isFinal) => {
      streamResultText = text;
      if (isFinal && text.trim()) {
        accumulatedText += text;
        // 更新托盘显示最近文字
        if (tray) {
          const short = text.length > 15 ? text.substring(0, 15) + '…' : text;
          tray.setToolTip('🔴 ' + short);
        }
        // == 关键：直接粘贴到当前焦点输入框，零延迟 ==
        doPasteImmediate(text);
      }
    },
    // onError
    (errMsg) => {
      updateIcon('error');
      isRecording = false;
      isProcessing = false;
      if (tray) tray.setToolTip('❌ VoiceInput - ' + errMsg);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('stop-stream-recording');
      }
      setTimeout(() => finishRecording(), 2000);
    },
    // onFinish
    (finalText) => {
      const remaining = accumulatedText.substring(pastedLength);
      if (remaining) {
        doPasteImmediate(remaining);
      }
      finishRecording();
    }
  );

  if (!started) {
    isRecording = false;
    return;
  }

  mainWindow.webContents.send('start-stream-recording');
}

/**
 * 流式录音停止
 */
function stopStreamRecording() {
  isRecording = false;
  isProcessing = true;
  mainWindow.webContents.send('stop-stream-recording');
  if (tray) tray.setToolTip('⏳ VoiceInput - 识别中...');
  baiduStream.stop();
}

/**
 * 即时粘贴 — 文字直接发到当前焦点输入框
 * 不做任何 UI 更新，不碰窗口，纯后台操作
 */
function doPasteImmediate(text) {
  if (isPasting) return;
  isPasting = true;
  pastedLength += text.length;

  try {
    autoType.typeText(text);
  } catch (error) {
    console.error('Paste failed:', error);
  }

  // 立即释放锁（Excel、记事本等处理粘贴需要一点时间）
  setTimeout(() => {
    isPasting = false;
  }, 50);
}

/**
 * 录音结束清理
 */
function finishRecording() {
  isRecording = false;
  isProcessing = false;
  isPasting = false;
  updateIcon('normal');
  if (tray) tray.setToolTip('VoiceInput - 就绪 (Ctrl+Shift+V 录音)');
  updateTrayMenu(false);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('reset-ui');
  }
}

/**
 * 非流式：处理录音文件识别结果
 */
async function processRecognition(audioPath) {
  if (!audioPath) {
    isProcessing = false;
    updateIcon('error');
    if (tray) tray.setToolTip('❌ VoiceInput - 录音失败');
    setTimeout(() => finishRecording(), 2000);
    return;
  }

  isProcessing = true;
  if (tray) tray.setToolTip('⏳ VoiceInput - 识别中...');

  try {
    const text = await baiduStt.recognizeSpeech(audioPath);
    cleanupTempFile(audioPath);
    doPasteImmediate(text);
    setTimeout(() => finishRecording(), 800);
  } catch (error) {
    cleanupTempFile(audioPath);
    if (tray) tray.setToolTip('❌ VoiceInput - ' + error.message);
    setTimeout(() => finishRecording(), 2000);
  }
}

function cleanupTempFile(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (e) { /* ignore */ }
}

// ==============================
// 主窗口 IPC
// ==============================

ipcMain.on('recording-started', (event, success) => {
  if (!success) {
    isRecording = false;
    if (tray) tray.setToolTip('❌ 麦克风启动失败');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('stop-recording-ui');
    }
    setTimeout(() => finishRecording(), 2000);
  }
});

ipcMain.on('toggle-recording', () => {
  toggleRecording();
});

ipcMain.on('recording-complete', (event, audioPath) => {
  processRecognition(audioPath);
});

ipcMain.on('open-settings', () => {
  showSettingsWindow();
});

ipcMain.on('quit-app', () => {
  if (baiduStream.isStreaming()) {
    baiduStream.cancel();
  }
  app.quit();
});

ipcMain.on('window-drag', (event, { dx, dy }) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const [x, y] = mainWindow.getPosition();
  mainWindow.setPosition(x + dx, y + dy);
});

ipcMain.on('force-show', () => {
  // 录音中不弹窗打扰用户
  if (mainWindow && !mainWindow.isDestroyed() && !isRecording && !isProcessing) {
    mainWindow.show();
    mainWindow.focus();
  }
});

ipcMain.on('open-settings', () => {
  showSettingsWindow();
});

ipcMain.on('quit-app', () => {
  if (baiduStream.isStreaming()) {
    baiduStream.cancel();
  }
  app.quit();
});

ipcMain.on('window-drag', (event, { dx, dy }) => {
  const [x, y] = mainWindow.getPosition();
  mainWindow.setPosition(x + dx, y + dy);
});

ipcMain.on('force-show', () => {
  forceWindowVisible();
});

// 保存音频文件（非流式）
ipcMain.handle('save-audio', async (event, wavBufferArray) => {
  const tempDir = os.tmpdir();
  const filePath = path.join(tempDir, 'voice_input_temp.wav');
  fs.writeFileSync(filePath, Buffer.from(wavBufferArray));
  return filePath;
});

// ==============================
// 流式音频 IPC
// ==============================

// 获取当前模式
ipcMain.handle('get-mode', () => {
  return currentProvider;
});

// 设置模式
ipcMain.handle('set-mode', (event, mode) => {
  currentProvider = mode;
  // 保存到设置文件
  const settings = readUserSettings();
  settings.PROVIDER = mode;
  writeUserSettings(settings);
  return true;
});

// 渲染进程发送 PCM 音频块（流式）
ipcMain.on('stream-audio-chunk', (event, pcmBuffer) => {
  if (baiduStream.isStreaming()) {
    baiduStream.sendAudio(Buffer.from(pcmBuffer));
  }
});

// 流式录音停止（渲染进程主动停止）
ipcMain.on('stream-recording-stopped', () => {
  // 已在 stopStreamRecording 中处理
});

// ==============================
// 设置窗口 IPC
// ==============================

// 加载设置
ipcMain.handle('load-settings', () => {
  const settings = readUserSettings();
  return {
    PROVIDER: settings.PROVIDER || 'baidu_stream',
    BAIDU_APP_ID: settings.BAIDU_APP_ID || '',
    BAIDU_API_KEY: settings.BAIDU_API_KEY || '',
    BAIDU_SECRET_KEY: settings.BAIDU_SECRET_KEY || ''
  };
});

// 保存设置（从设置窗口）
ipcMain.handle('save-settings', async (event, settings) => {
  try {
    const existing = readUserSettings();
    const newSettings = {
      ...existing,
      PROVIDER: settings.PROVIDER || existing.PROVIDER || 'baidu_stream',
      BAIDU_APP_ID: settings.BAIDU_APP_ID || existing.BAIDU_APP_ID || '',
      BAIDU_API_KEY: settings.BAIDU_API_KEY || existing.BAIDU_API_KEY || '',
      BAIDU_SECRET_KEY: settings.BAIDU_SECRET_KEY || existing.BAIDU_SECRET_KEY || ''
    };
    writeUserSettings(newSettings);

    // 通知主窗口
    updateStatus('✅ 设置已保存');
    mainWindow.webContents.send('notify', '设置已保存！');

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

app.whenReady().then(() => {
  // 初始化 provider
  const saved = readUserSettings();
  currentProvider = saved.PROVIDER || 'baidu_stream';

  createWindow();
  createTray();

  // ========== 注册全局快捷键 ==========
  globalShortcut.register('Ctrl+Shift+V', () => {
    toggleRecording();
  });

  // 按 Ctrl+Shift+V 时如果窗口隐藏了，也显示一下状态
  globalShortcut.register('Ctrl+Shift+S', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('will-quit', () => {
  // 注销所有全局快捷键
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  tray && tray.destroy();
});

function toggleRecording() {
  if (isPasting) return;
  if (isRecording) {
    stopRecording();
  } else {
    startRecording();
  }
}
