const WebSocket = require('ws');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const BAIDU_WS_URL = 'wss://vop.baidu.com/realtime_asr';

let wsClient = null;
let finishCallback = null;
let errorCallback = null;
let resultCallback = null;
let isActive = false;
let sn = '';
let audioBuffer = []; // WebSocket 未就绪时缓存音频

/**
 * 生成唯一 sn
 */
function generateSn() {
    return crypto.randomUUID();
}

/**
 * 获取动态配置
 */
function getConfig() {
    const configPath = path.join(__dirname, 'config.js');
    delete require.cache[require.resolve(configPath)];
    return require('./config');
}

/**
 * 开始流式识别
 * @param {Function} onResult - 中间结果回调 (text, isFinal)
 * @param {Function} onError - 错误回调 (errMsg)
 * @param {Function} onFinish - 完成回调 (finalText)
 * @returns {boolean} 是否成功启动
 */
function start(onResult, onError, onFinish) {
    const config = getConfig();

    if (!config.BAIDU_APP_ID || !config.BAIDU_API_KEY) {
        if (onError) onError('请先在设置中配置百度 AppID 和 API Key');
        return false;
    }

    if (isActive) {
        if (onError) onError('已有进行中的识别');
        return false;
    }

    resultCallback = onResult;
    errorCallback = onError;
    finishCallback = onFinish;
    isActive = true;
    sn = generateSn();

    try {
        const url = `${BAIDU_WS_URL}?sn=${sn}`;
        wsClient = new WebSocket(url);

        wsClient.on('open', () => {
            // 发送 START 帧
            const startFrame = {
                type: 'START',
                data: {
                    appid: parseInt(config.BAIDU_APP_ID, 10) || config.BAIDU_APP_ID,
                    appkey: config.BAIDU_API_KEY,
                    dev_pid: 15372,
                    cuid: `voiceinput_${sn}`,
                    format: 'pcm',
                    sample: 16000
                }
            };
            wsClient.send(JSON.stringify(startFrame));

            // 发送 START 后立即刷新缓冲的音频数据
            flushAudioBuffer();
        });

        wsClient.on('message', (data) => {
            try {
                const msg = JSON.parse(data.toString());

                if (msg.type === 'MID_TEXT') {
                    // 临时识别结果
                    if (resultCallback && msg.result) {
                        resultCallback(msg.result, false);
                    }
                } else if (msg.type === 'FIN_TEXT') {
                    // 一句话的最终结果
                    if (msg.err_no === 0) {
                        if (resultCallback && msg.result) {
                            resultCallback(msg.result, true);
                        }
                    } else {
                        if (errorCallback) {
                            errorCallback(`识别错误: ${msg.err_msg} (${msg.err_no})`);
                        }
                    }
                } else if (msg.type === 'HEARTBEAT') {
                    // 服务端心跳，忽略
                } else if (msg.err_no && msg.err_no !== 0) {
                    if (errorCallback) {
                        errorCallback(`服务端错误: ${msg.err_msg} (${msg.err_no})`);
                    }
                }
            } catch (e) {
                // 解析错误忽略
            }
        });

        wsClient.on('error', (err) => {
            isActive = false;
            if (errorCallback) {
                errorCallback(`连接错误: ${err.message}`);
            }
            cleanup();
        });

        wsClient.on('close', () => {
            isActive = false;
            if (finishCallback) {
                finishCallback(null);
            }
            cleanup();
        });

        return true;
    } catch (err) {
        isActive = false;
        if (errorCallback) {
            errorCallback(`启动失败: ${err.message}`);
        }
        cleanup();
        return false;
    }
}

/**
 * 刷新音频缓冲 — 将等待中的音频数据发送到 WebSocket
 */
function flushAudioBuffer() {
    while (audioBuffer.length > 0) {
        const buf = audioBuffer.shift();
        try {
            if (wsClient && wsClient.readyState === WebSocket.OPEN) {
                wsClient.send(buf);
            }
        } catch (e) { /* 忽略 */ }
    }
}

/**
 * 发送音频数据 (PCM 16bit 16kHz 单声道)
 * 如果 WebSocket 未就绪，自动缓冲，连接后自动发送
 * @param {Buffer} pcmBuffer - PCM 音频数据块
 */
function sendAudio(pcmBuffer) {
    if (!wsClient || !isActive) return;

    // WebSocket 未就绪 → 缓冲
    if (wsClient.readyState !== WebSocket.OPEN) {
        audioBuffer.push(pcmBuffer);
        return;
    }

    try {
        wsClient.send(pcmBuffer);
    } catch (e) {
        // 发送失败忽略
    }
}

/**
 * 停止流式识别
 */
function stop() {
    if (!wsClient || !isActive) {
        cleanup();
        return;
    }
    isActive = false; // 立即标记为非活跃，允许新识别快速启动

    try {
        // 发送 FINISH 帧
        const finishFrame = { type: 'FINISH' };
        wsClient.send(JSON.stringify(finishFrame));
    } catch (e) {
        // 忽略
    }

    // 延迟关闭连接，等待服务端返回最后结果
    setTimeout(() => {
        try {
            if (wsClient) {
                wsClient.close();
            }
        } catch (e) {
            // 忽略
        }
        cleanup();
    }, 2000);
}

/**
 * 立即取消识别
 */
function cancel() {
    if (wsClient && isActive) {
        try {
            const cancelFrame = { type: 'CANCEL' };
            wsClient.send(JSON.stringify(cancelFrame));
            wsClient.close();
        } catch (e) {
            // 忽略
        }
    }
    isActive = false;
    cleanup();
}

function cleanup() {
    wsClient = null;
    audioBuffer = [];
    // 不清理回调，防止先调用后赋值
}

function isStreaming() {
    return isActive;
}

module.exports = {
    start,
    sendAudio,
    stop,
    cancel,
    isStreaming
};
