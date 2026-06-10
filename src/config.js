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
  // 识别引擎: "baidu_normal" / "baidu_stream" / "custom"
  PROVIDER: savedSettings.PROVIDER || "baidu_normal",

  // 百度语音配置
  BAIDU_APP_ID: savedSettings.BAIDU_APP_ID || "",
  BAIDU_API_KEY: savedSettings.BAIDU_API_KEY || "",
  BAIDU_SECRET_KEY: savedSettings.BAIDU_SECRET_KEY || "",

  // ===== 自定义模块配置 =====
  // 根据 URL + 模型名自动识别模式: wss:// → WebSocket, 
  //   whisper-* → OpenAI Whisper 文件上传, mimo/asr → Chat ASR Base64 等
  // API 地址 (必填)
  CUSTOM_ENDPOINT: savedSettings.CUSTOM_ENDPOINT || "",

  // API Key / Bearer Token (必填)
  CUSTOM_API_KEY: savedSettings.CUSTOM_API_KEY || "",

  // 模型名称 (影响自动识别模式)
  CUSTOM_MODEL: savedSettings.CUSTOM_MODEL || "whisper-1",

  // 鉴权方式: "bearer" (Authorization: Bearer) | "api-key" (api-key 头)
  CUSTOM_AUTH_TYPE: savedSettings.CUSTOM_AUTH_TYPE || "bearer",

  // HTTP 方法 (HTTP API 模式)
  CUSTOM_METHOD: savedSettings.CUSTOM_METHOD || "POST",

  // 额外请求头 (JSON 字符串)
  CUSTOM_HEADERS: savedSettings.CUSTOM_HEADERS || "{}",

  // 请求体模板 (HTTP API 模式，支持 {{AUDIO_BASE64}} / {{AUDIO_PATH}})
  CUSTOM_BODY_TEMPLATE: savedSettings.CUSTOM_BODY_TEMPLATE || '{"audio": "{{AUDIO_BASE64}}"}',

  // WebSocket 协议 (websocket 模式)
  CUSTOM_WS_PROTOCOL: savedSettings.CUSTOM_WS_PROTOCOL || "",

  AUDIO_FORMAT: "wav",
  AUDIO_CHANNELS: 1,
  AUDIO_SAMPLE_RATE: 16000,
  MAX_RECORD_DURATION: 60
};
