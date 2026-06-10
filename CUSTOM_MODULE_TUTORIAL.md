# 自定义语音识别模块 · 配置教程

在设置中选择 **🌟 自定义模块**，根据你的平台选择接口类型填写即可。

---

## 快速上手

1. 右键托盘 → **设置**，或点击悬浮窗 ⚙
2. **识别服务** → 选择 **🌟 自定义模块**
3. 其他字段根据下表填写
4. 保存，立即生效

---

## 配置字段速查

| 字段 | 说明 | 必填 |
|------|------|:----:|
| 服务名称 | 随便起个名，仅用于自己看 | 否 |
| **接口类型** | OpenAI 兼容 / 自定义 HTTP / WebSocket 流式 | **是** |
| **API 地址** | 你平台的接口完整 URL | **是** |
| **API Key** | 你平台的密钥 / Token | **是** |
| 模型名称 | 选 OpenAI 兼容时需填 | 按需 |
| 请求体模板 | 选自定义 HTTP 时定义 JSON 格式，支持 `{{AUDIO_BASE64}}` | 按需 |
| 额外请求头 | 补充的自定义 Header，JSON 格式 | 否 |

> 音频固定为 **16kHz 16bit 单声道 WAV**，无需配置。

---

## 常见平台·直接抄作业

### 1️⃣ OpenAI 官方 / OneAPI / 硅基流动 等聚合平台

| 字段 | 值 |
|------|-----|
| 接口类型 | OpenAI Whisper 兼容 |
| API 地址 | `https://api.openai.com/v1/audio/transcriptions`（换成你平台的实际地址） |
| API Key | `sk-xxxxx` |
| 模型名称 | `whisper-1` |

> 常见平台地址：Groq → `https://api.groq.com/openai/v1/audio/transcriptions`，硅基流动 → `https://api.siliconflow.cn/v1/audio/transcriptions`

### 2️⃣ 自定义 HTTP API（非 OpenAI 格式的云平台）

| 字段 | 值 |
|------|-----|
| 接口类型 | 自定义 HTTP API |
| API 地址 | 平台给你的接口地址 |
| 请求体模板 | `{"audio": "{{AUDIO_BASE64}}", "format": "wav"}` |
| 额外请求头 | 如果有额外鉴权字段就填，没有就 `{}` |

> 请求体里的 `{{AUDIO_BASE64}}` 程序会自动替换成录音文件的 Base64 编码。

---

## 识别不了？先这样检查

1. **API 地址对不对** — 复制到浏览器/Postman 试试
2. **API Key 有没有填** — 填完要点保存
3. **切回百度** — 把识别服务改回百度就行，百度配置不受影响

---

> 配置文件位置：`%APPDATA%\VoiceInput\settings.json`，可以直接用记事本编辑备份。
