const path = require('path');
const fs = require('fs');

// 优先从用户数据目录读取已保存的配置
let savedSettings = {};
try {
  const { app } = require('electron');
  const userDataPath = app.getPath('userData');
  const settingsPath = path.join(userDataPath, 'settings.json');
  if (fs.existsSync(settingsPath)) {
    savedSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
  }
} catch (e) {
  // electron 不可用时忽略
}

module.exports = {
  // 识别引擎: "baidu_normal" (百度非流式) / "baidu_stream" (百度流式)
  PROVIDER: savedSettings.PROVIDER || "baidu_normal",

  // 百度语音配置
  BAIDU_APP_ID: savedSettings.BAIDU_APP_ID || "",
  BAIDU_API_KEY: savedSettings.BAIDU_API_KEY || "",
  BAIDU_SECRET_KEY: savedSettings.BAIDU_SECRET_KEY || "",

  AUDIO_FORMAT: "wav",
  AUDIO_CHANNELS: 1,
  AUDIO_SAMPLE_RATE: 16000,
  MAX_RECORD_DURATION: 60
};
