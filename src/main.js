const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const baiduStt = require('./baidu_stt');
const baiduStream = require('./baidu_stream');
const customStt = require('./custom_stt');
const autoType = require('./auto_type');

let mainWindow = null;
let settingsWindow = null;
let tray = null;
let isRecording = false;
let isProcessing = false;
let isPasting = false;
let currentProvider = 'baidu_stream';

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
 * 更新图标（带状态文字同步）
 */
function updateIcon(status) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('update-icon', ICONS[status] || ICONS.normal);
  const statusTexts = {
    recording: '🎤 录音中…',
    processing: '⏳ 识别中…',
    success: '✅',
    error: '❌ 识别失败',
    normal: '就绪'
  };
  mainWindow.webContents.send('update-status', statusTexts[status] || '就绪');
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

  // 如果切换到自定义 WebSocket 模式且正在录制，停止旧的流
  if (currentProvider !== 'custom' && customStt.isWsStreaming()) {
    customStt.stopWebSocket();
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 60,
    height: 80,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    focusable: false,
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
    mainWindow.show();
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
    resizable: true,
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
  if (isRecording || isProcessing || baiduStream.isStreaming() || customStt.isWsStreaming()) return;

  const config = getConfig();

  // ===== 检查对应 provider 的配置 =====
  if (currentProvider === 'baidu_normal' || currentProvider === 'baidu_stream') {
    if (!config.BAIDU_APP_ID || !config.BAIDU_API_KEY) {
      if (tray) tray.setToolTip('⚠️ VoiceInput - 请先配置百度 API Key');
      updateIcon('error');
      updateStatus('⚠️ 未配置密钥');
      setTimeout(() => finishRecording(), 2000);
      return;
    }
  } else if (currentProvider === 'custom') {
    if (!config.CUSTOM_ENDPOINT || !config.CUSTOM_API_KEY) {
      if (tray) tray.setToolTip('⚠️ VoiceInput - 请先配置自定义 API');
      updateIcon('error');
      updateStatus('⚠️ 未配置自定义 API');
      setTimeout(() => finishRecording(), 2000);
      return;
    }
  }

  // ===== 判断是流式还是非流式 =====
  const isCustomWs = currentProvider === 'custom' && customStt.isWsMode();

  if (currentProvider === 'baidu_normal' || (currentProvider === 'custom' && !isCustomWs)) {
    // ===== 非流式（标准）模式 =====
    isRecording = true;
    if (tray) tray.setToolTip('🔴 VoiceInput - 录音中 (双击停止)');
    updateTrayMenu(true);
    mainWindow.webContents.send('start-recording-ui');
    mainWindow.webContents.send('start-recording');
  } else if (isCustomWs) {
    // ===== 自定义 WebSocket 流式 =====
    startCustomStreamRecording();
  } else {
    // ===== 百度流式模式 =====
    startStreamRecording();
  }
}

async function stopRecording() {
  if (!isRecording) return;

  isRecording = false;
  isProcessing = true;

  const isCustomWs = currentProvider === 'custom' && customStt.isWsMode();

  if (currentProvider === 'baidu_normal' || (currentProvider === 'custom' && !isCustomWs)) {
    // ===== 非流式（标准）模式 =====
    updateIcon('processing');
    if (tray) tray.setToolTip('⏳ VoiceInput - 识别中...');
    updateTrayMenu(false);
    mainWindow.webContents.send('stop-recording-ui');
    mainWindow.webContents.send('stop-recording');
  } else if (isCustomWs) {
    // ===== 自定义 WebSocket 流式 =====
    updateIcon('processing');
    mainWindow.webContents.send('stop-recording-ui');
    mainWindow.webContents.send('stop-stream-recording');
    customStt.stopWebSocket();
    // 由 onFinish 回调触发 finishRecording
  } else {
    // ===== 百度流式模式 =====
    updateIcon('processing');
    mainWindow.webContents.send('stop-recording-ui');
    mainWindow.webContents.send('stop-stream-recording');
    baiduStream.stop();
    // 由 onFinish 回调触发 finishRecording
  }
}

/**
 * 流式录音开始 — 全程静默，不弹窗，文字直达输入框
 */
function startStreamRecording() {
  isRecording = true;

  updateIcon('recording');
  mainWindow.webContents.send('start-recording-ui');
  updateTrayMenu(true);
  if (tray) tray.setToolTip('🔴 VoiceInput - 录音中 (Ctrl+Shift+V 停止)');

  // 启动百度流式识别
  const started = baiduStream.start(
    // onResult — 收到识别结果，实时显示在弹窗
    (text, isFinal) => {
      // 实时显示百度返回的文字到弹窗状态栏
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('stream-interim', text);
      }
      if (isFinal && text.trim()) {
        // 每句最终结果直接剪贴板粘贴（完美支持中文）
        autoType.typeText(text);
      }
    },
    // onError
    (errMsg) => {
      updateIcon('error');
      isProcessing = false;
      if (tray) tray.setToolTip('❌ VoiceInput - ' + errMsg);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('stop-stream-recording');
      }
      finishRecording();
    },
    // onFinish
    (finalText) => {
      // 确保 processing 状态至少显示 500ms 才切为 success
      setTimeout(() => finishRecording(), 500);
    }
  );

  if (!started) {
    isRecording = false;
    isProcessing = false;
    return;
  }

  mainWindow.webContents.send('start-stream-recording');
}

/**
 * 自定义 WebSocket 流式录音开始
 */
function startCustomStreamRecording() {
  isRecording = true;

  updateIcon('recording');
  mainWindow.webContents.send('start-recording-ui');
  updateTrayMenu(true);
  if (tray) tray.setToolTip('🔴 VoiceInput - 录音中 (Ctrl+Shift+V 停止)');

  // 启动自定义 WebSocket 流式识别
  const started = customStt.startWebSocket(
    // onResult
    (text, isFinal) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('stream-interim', text);
      }
      if (isFinal && text.trim()) {
        autoType.typeText(text);
      }
    },
    // onError
    (errMsg) => {
      updateIcon('error');
      isProcessing = false;
      if (tray) tray.setToolTip('❌ VoiceInput - ' + errMsg);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('stop-stream-recording');
      }
      finishRecording();
    },
    // onFinish
    (finalText) => {
      setTimeout(() => finishRecording(), 500);
    }
  );

  if (!started) {
    isRecording = false;
    isProcessing = false;
    return;
  }

  mainWindow.webContents.send('start-stream-recording');
}

/**
 * 即时粘贴 — 文字直接发到当前焦点输入框
 */
function doPasteImmediate(text) {
  if (isPasting || !text) return;
  isPasting = true;

  try {
    autoType.typeText(text, () => {
      setTimeout(() => { isPasting = false; }, 30);
    });
  } catch (error) {
    console.error('Paste failed:', error);
    setTimeout(() => { isPasting = false; }, 30);
  }
}

/**
 * 录音结束清理 — 打勾 → 恢复就绪
 */
function finishRecording() {
  isRecording = false;
  isProcessing = false;
  isPasting = false;
  if (tray) tray.setToolTip('VoiceInput - 就绪 (Ctrl+Shift+V 录音)');
  updateTrayMenu(false);
  // 先显示 ✅ 打勾动画，800ms 后恢复 normal
  updateIcon('success');
  setTimeout(() => {
    updateIcon('normal');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('reset-ui');
    }
  }, 800);
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

  // 识别中状态（已在 stopRecording 中设置）
  if (tray) tray.setToolTip('⏳ VoiceInput - 识别中...');

  try {
    let text;
    if (currentProvider === 'custom') {
      // 使用自定义模块识别
      text = await customStt.recognizeSpeech(audioPath);
    } else {
      // 使用百度识别
      text = await baiduStt.recognizeSpeech(audioPath);
    }
    cleanupTempFile(audioPath);
    doPasteImmediate(text);
    finishRecording();
  } catch (error) {
    cleanupTempFile(audioPath);
    updateIcon('error');
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

// 按下按钮：立即启动录音
ipcMain.on('start-recording-press', () => {
  if (isRecording || isProcessing || baiduStream.isStreaming() || customStt.isWsStreaming()) return;
  mainWindow.webContents.send('start-recording-ui');
  startRecording();
});

// 松开按钮：停止录音
ipcMain.on('stop-recording-press', () => {
  if (isRecording) {
    stopRecording();
  }
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
  if (customStt.isWsStreaming()) {
    customStt.stopWebSocket();
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
  const isCustomWs = currentProvider === 'custom' && customStt.isWsMode();

  if (isCustomWs) {
    customStt.sendWsAudio(Buffer.from(pcmBuffer));
  } else {
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
    // 百度
    BAIDU_APP_ID: settings.BAIDU_APP_ID || '',
    BAIDU_API_KEY: settings.BAIDU_API_KEY || '',
    BAIDU_SECRET_KEY: settings.BAIDU_SECRET_KEY || '',
    // 自定义模块
    CUSTOM_ENDPOINT: settings.CUSTOM_ENDPOINT || '',
    CUSTOM_API_KEY: settings.CUSTOM_API_KEY || '',
    CUSTOM_MODEL: settings.CUSTOM_MODEL || 'whisper-1',
    CUSTOM_AUTH_TYPE: settings.CUSTOM_AUTH_TYPE || 'bearer',
    CUSTOM_METHOD: settings.CUSTOM_METHOD || 'POST',
    CUSTOM_HEADERS: settings.CUSTOM_HEADERS || '{}',
    CUSTOM_BODY_TEMPLATE: settings.CUSTOM_BODY_TEMPLATE || '{"audio": "{{AUDIO_BASE64}}"}',
    CUSTOM_WS_PROTOCOL: settings.CUSTOM_WS_PROTOCOL || ''
  };
});

// 保存设置（从设置窗口）
ipcMain.handle('save-settings', async (event, settings) => {
  try {
    const existing = readUserSettings();
    const newSettings = {
      ...existing,
      // Provider
      PROVIDER: settings.PROVIDER || existing.PROVIDER || 'baidu_stream',
      // 百度
      BAIDU_APP_ID: settings.BAIDU_APP_ID || existing.BAIDU_APP_ID || '',
      BAIDU_API_KEY: settings.BAIDU_API_KEY || existing.BAIDU_API_KEY || '',
      BAIDU_SECRET_KEY: settings.BAIDU_SECRET_KEY || existing.BAIDU_SECRET_KEY || '',
      // 自定义模块
      CUSTOM_ENDPOINT: settings.CUSTOM_ENDPOINT || existing.CUSTOM_ENDPOINT || '',
      CUSTOM_API_KEY: settings.CUSTOM_API_KEY || existing.CUSTOM_API_KEY || '',
      CUSTOM_MODEL: settings.CUSTOM_MODEL || existing.CUSTOM_MODEL || 'whisper-1',
      CUSTOM_AUTH_TYPE: settings.CUSTOM_AUTH_TYPE || existing.CUSTOM_AUTH_TYPE || 'bearer',
      CUSTOM_METHOD: settings.CUSTOM_METHOD || existing.CUSTOM_METHOD || 'POST',
      CUSTOM_HEADERS: settings.CUSTOM_HEADERS || existing.CUSTOM_HEADERS || '{}',
      CUSTOM_BODY_TEMPLATE: settings.CUSTOM_BODY_TEMPLATE || existing.CUSTOM_BODY_TEMPLATE || '{"audio": "{{AUDIO_BASE64}}"}',
      CUSTOM_WS_PROTOCOL: settings.CUSTOM_WS_PROTOCOL || existing.CUSTOM_WS_PROTOCOL || ''
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
  if (isRecording || baiduStream.isStreaming() || customStt.isWsStreaming()) {
    stopRecording();
  } else {
    startRecording();
  }
}
