/**
 * custom_stt.js — 自定义语音识别模块（自动识别模式）
 * 
 * 只需提供 API 地址 + API Key + 模型名称，自动适配请求格式。
 * 
 * 内置模型知识库 (MODEL_REGISTRY)，根据模型名自动选择:
 *   - openai_whisper → multipart/form-data 上传音频 (绝大多数平台)
 *   - chat_asr       → chat/completions 接口传 Base64 音频 (小米 MiMo 等)
 *   - websocket      → WebSocket 流式 (wss://)
 *   - http_api       → 自定义 JSON + Base64 (未匹配时的通用后备)
 * 
 * 如果模型名不在知识库中，根据 URL 智能猜测:
 *   wss:// → WebSocket
 *   /audio/transcriptions → OpenAI Whisper
 *   /chat/completions     → Chat ASR (通用格式)
 *   其他                  → OpenAI Whisper (最通用)
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const WebSocket = require('ws');
const crypto = require('crypto');

// ===================== 模型知识库 =====================
// 根据模型名称自动匹配请求格式。不在此表中的模型会通过 URL 智能猜测。
const MODEL_REGISTRY = [
    // --- OpenAI Whisper 系列 (multipart/form-data 文件上传) ---
    { match: /^whisper-/i, type: 'openai_whisper' },
    { match: /^base$/i, type: 'openai_whisper' },
    { match: /^small$/i, type: 'openai_whisper' },
    { match: /^medium$/i, type: 'openai_whisper' },
    { match: /^large(\-v\d+)?$/i, type: 'openai_whisper' },
    { match: /^nemo/i, type: 'openai_whisper' },
    { match: /^sensevoice/i, type: 'openai_whisper' },
    { match: /^paraformer/i, type: 'openai_whisper' },

    // --- Chat ASR 系列 (chat/completions + Base64 音频) ---
    { match: /^mimo.*asr/i, type: 'chat_asr', bodyTemplate: '{"model":"MODEL_NAME","messages":[{"role":"user","content":[{"type":"input_audio","input_audio":{"data":"data:audio/wav;base64,AUDIO_BASE64"}}]}],"asr_options":{"language":"zh"}}' },
    { match: /^gpt-4o.*audio/i, type: 'chat_asr', bodyTemplate: '{"model":"MODEL_NAME","messages":[{"role":"user","content":[{"type":"input_audio","input_audio":{"data":"data:audio/wav;base64,AUDIO_BASE64"}}]}]}' },
];

// ===================== WebSocket 流式状态 =====================
let wsClient = null;
let wsFinishCallback = null;
let wsErrorCallback = null;
let wsResultCallback = null;
let wsIsActive = false;
let wsAudioBuffer = [];
let wsSn = '';
let wsConfig = null;

function generateSn() {
    return crypto.randomUUID();
}

// ===================== 内部工具 =====================

function getConfig() {
    const configPath = path.join(__dirname, 'config.js');
    delete require.cache[require.resolve(configPath)];
    return require('./config');
}

/**
 * 解析 JSON 字符串，失败返回默认值
 */
function parseJSON(str, defaultVal = {}) {
    if (!str) return defaultVal;
    try {
        return JSON.parse(str);
    } catch (e) {
        return defaultVal;
    }
}

/**
 * 从模型知识库查找匹配的配置
 */
function lookupModel(modelName) {
    if (!modelName) return null;
    for (const entry of MODEL_REGISTRY) {
        if (entry.match.test(modelName)) {
            return entry;
        }
    }
    return null;
}

/**
 * 智能检测模式 — 根据 URL + 模型名自动判断
 * 返回: { type, bodyTemplate, method }
 */
function detectMode(config) {
    const url = (config.CUSTOM_ENDPOINT || '').trim();
    const model = (config.CUSTOM_MODEL || '').trim();

    // 1. WebSocket
    if (url.startsWith('wss://') || url.startsWith('ws://')) {
        return { type: 'websocket' };
    }

    // 2. 查模型知识库
    const entry = lookupModel(model);
    if (entry) {
        if (entry.type === 'openai_whisper') {
            return { type: 'openai_whisper' };
        }
        if (entry.type === 'chat_asr') {
            return { type: 'http_api', bodyTemplate: entry.bodyTemplate, method: 'POST' };
        }
    }

    // 3. 根据 URL 路径猜测
    const pathMatch = url.replace(/\/+$/, '');
    if (/\/audio\/transcriptions$/.test(pathMatch)) {
        return { type: 'openai_whisper' };
    }
    if (/\/chat\/completions$/.test(pathMatch)) {
        // chat/completions → 尝试用 chat ASR 通用格式
        return {
            type: 'http_api',
            bodyTemplate: '{"model":"MODEL_NAME","messages":[{"role":"user","content":[{"type":"input_audio","input_audio":{"data":"data:audio/wav;base64,AUDIO_BASE64"}}]}]}',
            method: 'POST'
        };
    }

    // 4. 默认：OpenAI Whisper 兼容（最通用）
    return { type: 'openai_whisper' };
}

// ===================== OpenAI Whisper 模式 =====================

/**
 * OpenAI Whisper API 兼容识别
 * POST multipart/form-data → { text: "..." }
 */
async function recognizeWhisper(audioPath) {
    const config = getConfig();
    const endpoint = config.CUSTOM_ENDPOINT || 'https://api.openai.com/v1/audio/transcriptions';
    const apiKey = config.CUSTOM_API_KEY || '';
    const model = config.CUSTOM_MODEL || 'whisper-1';

    if (!apiKey) {
        throw new Error('自定义模块未配置 API Key');
    }

    const form = new FormData();
    form.append('model', model);
    form.append('file', fs.createReadStream(audioPath), {
        filename: 'audio.wav',
        contentType: 'audio/wav'
    });
    form.append('language', 'zh');
    form.append('response_format', 'json');

    // 根据鉴权方式选择认证头
    const authType = config.CUSTOM_AUTH_TYPE || 'bearer';
    const authHeader = authType === 'api-key'
        ? { 'api-key': apiKey }
        : { 'Authorization': `Bearer ${apiKey}` };

    const headers = {
        ...authHeader,
        ...form.getHeaders()
    };

    const response = await axios.post(endpoint, form, { headers });
    const result = response.data;

    if (result.text) {
        return result.text;
    }
    throw new Error(`识别失败: ${JSON.stringify(result)}`);
}

// ===================== 自定义 HTTP API 模式 =====================

/**
 * 自定义 HTTP API 识别
 * 支持模板变量: {{AUDIO_BASE64}}, {{AUDIO_PATH}}
 */
async function recognizeHttpAPI(audioPath, bodyTemplate) {
    const config = getConfig();
    const endpoint = config.CUSTOM_ENDPOINT;
    const apiKey = config.CUSTOM_API_KEY || '';
    const method = (config.CUSTOM_METHOD || 'POST').toUpperCase();

    if (!endpoint) {
        throw new Error('自定义模块未配置 API 地址');
    }

    // 读取音频为 Base64
    const audioData = fs.readFileSync(audioPath);
    const audioBase64 = audioData.toString('base64');

    // 构建请求体 — 支持 {{AUDIO_BASE64}}, {{AUDIO_PATH}}, MODEL_NAME
    let tmpl = bodyTemplate || config.CUSTOM_BODY_TEMPLATE || '{}';
    let bodyStr = tmpl
        .replace(/\{\{AUDIO_BASE64\}\}/g, audioBase64)
        .replace(/\{\{AUDIO_PATH\}\}/g, audioPath.replace(/\\/g, '/'))
        .replace(/MODEL_NAME/g, config.CUSTOM_MODEL || 'whisper-1');

    let body;
    try {
        body = JSON.parse(bodyStr);
    } catch (e) {
        body = bodyStr;
    }

    // 构建请求头
    const authType = config.CUSTOM_AUTH_TYPE || 'bearer';
    const authHeader = authType === 'api-key'
        ? { 'api-key': apiKey }
        : { 'Authorization': `Bearer ${apiKey}` };

    const headers = {
        'Content-Type': 'application/json',
        ...authHeader
    };

    const response = await axios({
        method,
        url: endpoint,
        headers,
        data: body,
        timeout: 30000
    });

    const result = response.data;

    // 从常见返回格式中提取文本
    if (typeof result === 'string') return result;
    if (result.text) return result.text;
    if (result.result) return (Array.isArray(result.result) ? result.result[0] : result.result);
    if (result.data && result.data.text) return result.data.text;
    // OpenAI 聊天补全格式: choices[0].message.content
    if (result.choices && result.choices[0]) {
        if (result.choices[0].message && result.choices[0].message.content) return result.choices[0].message.content;
        if (result.choices[0].text) return result.choices[0].text;
    }

    return JSON.stringify(result);
}

// ===================== WebSocket 流式模式 =====================

/**
 * 开始 WebSocket 流式识别
 * @param {Function} onResult  - (text, isFinal) 回调
 * @param {Function} onError   - (errMsg) 回调
 * @param {Function} onFinish  - (finalText) 回调
 * @returns {boolean} 是否成功启动
 */
function startWebSocket(onResult, onError, onFinish) {
    const config = getConfig();
    const wsUrl = config.CUSTOM_ENDPOINT;
    const apiKey = config.CUSTOM_API_KEY || '';
    const protocol = config.CUSTOM_WS_PROTOCOL || '';

    if (!wsUrl) {
        if (onError) onError('WebSocket 流式模式未配置地址');
        return false;
    }

    if (wsIsActive) {
        if (onError) onError('已有进行中的 WebSocket 识别');
        return false;
    }

    wsResultCallback = onResult;
    wsErrorCallback = onError;
    wsFinishCallback = onFinish;
    wsIsActive = true;
    wsSn = generateSn();
    wsConfig = config;
    wsAudioBuffer = [];

    try {
        const options = {};

        // 添加认证头
        if (apiKey) {
            options.headers = {
                'Authorization': `Bearer ${apiKey}`
            };
        }

        // 添加协议
        if (protocol) {
            options.protocols = protocol;
        }

        wsClient = new WebSocket(wsUrl, options);

        wsClient.on('open', () => {
            // 发送 START 帧 (如果配置了协议)
            const extraHeaders = parseJSON(config.CUSTOM_HEADERS);
            if (extraHeaders.startFrame) {
                wsClient.send(JSON.stringify(
                    typeof extraHeaders.startFrame === 'string'
                        ? parseJSON(extraHeaders.startFrame)
                        : extraHeaders.startFrame
                ));
            }
            flushWsAudioBuffer();
        });

        wsClient.on('message', (data) => {
            try {
                const msg = JSON.parse(data.toString());

                // 尝试从各种格式中提取文本
                let text = null;
                let isFinal = false;

                if (msg.type === 'MID_TEXT' || msg.type === 'middle' || msg.type === 'interim') {
                    text = msg.result || msg.text || msg.data || '';
                    isFinal = false;
                } else if (msg.type === 'FIN_TEXT' || msg.type === 'final' || msg.type === 'end') {
                    text = msg.result || msg.text || msg.data || '';
                    isFinal = true;
                } else if (msg.type === 'HEARTBEAT' || msg.type === 'ping') {
                    // 心跳，忽略
                } else if (msg.text) {
                    text = msg.text;
                    isFinal = true;
                } else if (msg.result) {
                    text = Array.isArray(msg.result) ? msg.result[0] : msg.result;
                    isFinal = true;
                }

                if (text && wsResultCallback) {
                    wsResultCallback(text, isFinal);
                }
            } catch (e) {
                // 可能是二进制数据，忽略
            }
        });

        wsClient.on('error', (err) => {
            wsIsActive = false;
            if (wsErrorCallback) wsErrorCallback(`连接错误: ${err.message}`);
            wsCleanup();
        });

        wsClient.on('close', () => {
            wsIsActive = false;
            if (wsFinishCallback) wsFinishCallback(null);
            wsCleanup();
        });

        return true;
    } catch (err) {
        wsIsActive = false;
        if (wsErrorCallback) wsErrorCallback(`启动失败: ${err.message}`);
        wsCleanup();
        return false;
    }
}

function flushWsAudioBuffer() {
    while (wsAudioBuffer.length > 0) {
        const buf = wsAudioBuffer.shift();
        try {
            if (wsClient && wsClient.readyState === WebSocket.OPEN) {
                wsClient.send(buf);
            }
        } catch (e) { /* ignore */ }
    }
}

/**
 * 发送 PCM 音频数据到 WebSocket
 * @param {Buffer} pcmBuffer
 */
function sendWsAudio(pcmBuffer) {
    if (!wsClient || !wsIsActive) return;
    if (wsClient.readyState !== WebSocket.OPEN) {
        wsAudioBuffer.push(pcmBuffer);
        return;
    }
    try {
        wsClient.send(pcmBuffer);
    } catch (e) { /* ignore */ }
}

/**
 * 停止 WebSocket 流式识别
 */
function stopWebSocket() {
    if (!wsClient || !wsIsActive) {
        wsCleanup();
        return;
    }
    wsIsActive = false;

    try {
        const finishFrame = { type: 'FINISH' };
        wsClient.send(JSON.stringify(finishFrame));
    } catch (e) { /* ignore */ }

    setTimeout(() => {
        try {
            if (wsClient) wsClient.close();
        } catch (e) { /* ignore */ }
        wsCleanup();
    }, 2000);
}

function wsCleanup() {
    wsClient = null;
    wsAudioBuffer = [];
}

function isWsStreaming() {
    return wsIsActive;
}

// ===================== 统一入口 =====================

/**
 * 自定义 STT 识别入口 (非流式)
 * 智能检测模式，自动路由
 * @param {string} audioPath - WAV 音频文件路径
 * @returns {Promise<string>} 识别文本
 */
async function recognizeSpeech(audioPath) {
    const config = getConfig();
    const mode = detectMode(config);

    switch (mode.type) {
        case 'http_api':
            return recognizeHttpAPI(audioPath, mode.bodyTemplate);
        case 'openai_whisper':
        default:
            return recognizeWhisper(audioPath);
    }
}

/**
 * 判断当前是否为 WebSocket 流式模式
 */
function isWsMode() {
    const config = getConfig();
    return detectMode(config).type === 'websocket';
}

module.exports = {
    recognizeSpeech,
    startWebSocket,
    sendWsAudio,
    stopWebSocket,
    isWsStreaming,
    isWsMode
};
