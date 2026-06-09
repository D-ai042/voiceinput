const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');

const BAIDU_TOKEN_URL = 'https://aip.baidubce.com/oauth/2.0/token';
const BAIDU_ASR_URL = 'https://vop.baidu.com/server_api';

let accessToken = null;
let tokenExpiresAt = 0;

// 动态读取配置（避免 require 缓存，打包后从 userData 读取）
function getConfig() {
  const configPath = path.join(__dirname, 'config.js');
  delete require.cache[require.resolve(configPath)];
  return require('./config');
}

async function getAccessToken() {
  const config = getConfig();
  if (accessToken && Date.now() < tokenExpiresAt - 300000) {
    return accessToken;
  }

  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: config.BAIDU_API_KEY,
    client_secret: config.BAIDU_SECRET_KEY
  });

  const response = await axios.post(BAIDU_TOKEN_URL, params.toString());
  const result = response.data;

  if (result.access_token) {
    accessToken = result.access_token;
    tokenExpiresAt = Date.now() + (result.expires_in || 3600) * 1000;
    return accessToken;
  } else {
    throw new Error(`Failed to get access token: ${JSON.stringify(result)}`);
  }
}

async function recognizeSpeech(audioPath) {
  const config = getConfig();
  if (!config.BAIDU_APP_ID || !config.BAIDU_API_KEY || !config.BAIDU_SECRET_KEY) {
    throw new Error('Baidu API credentials not configured. Please set BAIDU_APP_ID, BAIDU_API_KEY, and BAIDU_SECRET_KEY in config.js');
  }

  const token = await getAccessToken();
  const audioData = fs.readFileSync(audioPath);
  const audioBase64 = audioData.toString('base64');

  // 使用更唯一的 cuid：机器名+时间戳+随机数
  const hostname = os.hostname();
  const timestamp = Date.now();
  const randomNum = Math.floor(Math.random() * 1000000);
  const cuid = `${hostname}_${timestamp}_${randomNum}`.substring(0, 60);

  const data = {
    format: 'wav',
    rate: 16000,
    channel: 1,
    cuid: cuid,
    token: token,
    dev_pid: 1537,
    speech: audioBase64,
    len: audioData.length
  };

  const headers = { 'Content-Type': 'application/json' };
  const response = await axios.post(BAIDU_ASR_URL, data, { headers });
  const result = response.data;

  if (result.err_no === 0) {
    return result.result[0];
  } else {
    throw new Error(`Recognition failed: ${result.err_msg || 'Unknown error'}`);
  }
}

function resetToken() {
  accessToken = null;
  tokenExpiresAt = 0;
}

module.exports = { recognizeSpeech, resetToken };
