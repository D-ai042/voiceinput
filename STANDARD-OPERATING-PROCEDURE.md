# VoiceInput（语音输入小助手）标准操作流程

> **项目简介**：桌面语音输入工具，点击说话，自动转文字填入任意文本框
> **技术栈**：Electron + Node.js + 百度语音 API / 自定义模块
> **仓库地址**：`https://github.com/D-ai042/vioceinput`
> **最新版本**：v1.0.0

---

## 目录

1. [开发环境搭建](#1-开发环境搭建)
2. [目录结构](#2-目录结构)
3. [本地开发](#3-本地开发)
4. [构建 EXE 安装包](#4-构建-exe-安装包)
5. [发布流程（推送到 GitHub）](#5-发布流程推送到-github)
6. [CI/CD 自动构建](#6-cicd-自动构建)
7. [常见问题](#7-常见问题)

---

## 1. 开发环境搭建

### 前置依赖

| 工具 | 版本要求 | 用途 |
|------|---------|------|
| Node.js | ≥ 18 | 运行时 |
| npm | ≥ 9 | 包管理 |

### 初始化步骤

```bash
# 1. 克隆仓库
git clone https://github.com/D-ai042/vioceinput.git
cd vioceinput

# 2. 安装依赖
npm install

# 3. 启动开发模式
npm start
```

---

## 2. 目录结构

```
F:\Projects\node-voice-input/
├── src/                          # 源码
│   ├── main.js                   # Electron 主进程
│   ├── preload.js                # 预加载脚本（窗口 UI 桥接）
│   ├── window.html               # 主窗口（60×80 悬浮麦克风）
│   ├── settings.html             # 设置页面
│   ├── settings_preload.js       # 设置页桥接
│   ├── config.js                 # 配置文件
│   ├── baidu_stt.js              # 百度标准语音识别（REST API）
│   ├── baidu_stream.js           # 百度流式语音识别（WebSocket）
│   ├── custom_stt.js             # 自定义模块（通用适配层）
│   ├── auto_type.js              # 自动粘贴文字到焦点输入框
│   └── recorder.js               # 录音工具
├── assets/                       # 图标资源
├── package.json                  # 项目配置
├── CUSTOM_MODULE_TUTORIAL.md     # 自定义模块配置教程
└── STANDARD-OPERATING-PROCEDURE.md  # 本文档
```

---

## 3. 本地开发

### 启动应用

```bash
npm start
```

### 识别模式切换

打开设置窗口（托盘右键 → 设置，或点击悬浮窗 ⚙），选择：

| 模式 | 说明 |
|------|------|
| 百度语音 - 流式模式 | 边录边识，速度快（需百度 API Key） |
| 百度语音 - 标准模式 | 录完再识别（需百度 API Key） |
| 🌟 自定义模块 | 通用适配层，填 API 地址 + Key + 模型名即可 |

### 自定义模块支持

只需填写 3 个字段即可适配绝大多数语音 API：

| 字段 | 示例 |
|:-----|:-----|
| API 地址 | `https://api.openai.com/v1/audio/transcriptions` |
| API Key | `sk-xxx` 或 `tp-xxx` |
| 模型名称 | `whisper-1` / `mimo-v2.5-asr` |

程序内置模型知识库，自动匹配请求格式（文件上传 / Chat ASR Base64 / WebSocket 流式）。

---

## 4. 构建安装包

### 构建命令

```bash
# Windows（绿色单文件）
npm run build

# macOS（需在 macOS 上执行）
npm run build
```

### 产物位置

| 平台 | 格式 | 路径 |
|------|------|------|
| Windows | 绿色单文件 EXE | `dist/VoiceInput.exe` |
| macOS | DMG 安装包 | `dist/VoiceInput-<version>-mac.dmg` |
| macOS | ZIP 压缩包 | `dist/VoiceInput-<version>-mac.zip` |

双击 `VoiceInput.exe` 即可运行，无需安装。

---

## 5. 发布流程（标准操作）

### 一句话流程

```bash
git add . && git commit -m "描述更改"
git tag v1.0.1
git push origin master --tags
```

> 推送后 GitHub Actions **自动构建** Windows + macOS 版本，**自动发布** Release。

### 完整步骤

```bash
# 1. 提交代码
git add .
git commit -m "feat: xxx功能"

# 2. 打版本标签（触发 CI 自动构建）
git tag v1.0.1

# 3. 推送到 GitHub（自动触发 Actions 构建 Win + Mac）
# 使用代理推送
git remote set-url origin https://<USERNAME>:<TOKEN>@ghfast.top/https://github.com/D-ai042/voiceinput.git
git push origin master --tags

# 4. 推送完成后，切回代理地址
git remote set-url origin https://ghfast.top/https://github.com/D-ai042/voiceinput.git
```

### 自动构建流程

```
git push --tags
      ↓
GitHub Actions 触发
      ↓
 ┌──────────────┐   ┌──────────────┐
 │ windows-latest│   │ macos-latest │
 │ 构建 EXE      │   │ 构建 DMG+ZIP │
 └──────┬───────┘   └──────┬───────┘
        ↓                  ↓
 ┌──────────────┐   ┌──────────────┐
 │ VoiceInput   │   │ VoiceInput   │
 │ .exe         │   │ .dmg / .zip  │
 └──────────────┘   └──────────────┘
        ↓                  ↓
 ┌──────────────────────────────┐
 │   自动创建 GitHub Release    │
 │   附带 Win + Mac 安装包      │
 └──────────────────────────────┘
```

### 发布产物

构建完成后自动出现在 Release 页面：

```
https://github.com/D-ai042/voiceinput/releases/tag/v1.0.1
```

| 平台 | 文件 |
|------|------|
| Windows | `VoiceInput.exe` |
| macOS | `VoiceInput-1.0.1-mac.dmg` + `.zip` |

---

## 6. CI/CD 自动构建

### 触发条件

打 `v*` 标签推送到 GitHub 后，自动触发 `.github/workflows/build.yml`。

### 构建矩阵

| 操作系统 | 运行环境 | 产物格式 |
|---------|---------|---------|
| Windows | GitHub Actions (windows-latest) | 绿色单文件 `VoiceInput.exe` |
| macOS | GitHub Actions (macos-latest) | DMG 安装包 + ZIP 压缩包 |

### 构建流程

1. 推送 `v*` 标签 → 自动触发 Workflow
2. Windows 和 macOS 并行构建
3. 构建完成后自动创建 GitHub Release
4. Release 页面可直接下载对应平台的安装包

### 手动触发

在 GitHub 仓库的 **Actions** 标签页中，选择 **Build** Workflow，点击 **Run workflow** 即可手动触发。

### 产物发布

构建完成后自动上传到对应版本的 GitHub Release 页面：

```
https://github.com/D-ai042/voiceinput/releases/tag/v1.0.0
```

---

## 7. 常见问题

### Q: 应用启动后只看到托盘图标，窗口在哪？

右下角任务栏找到 🎤 图标，双击打开悬浮窗。

### Q: 如何修改快捷键？

当前全局快捷键为 `Ctrl+Shift+V`（录音开关），在 `src/main.js` 中修改 `globalShortcut.register`。

### Q: 自定义模块识别失败？

1. 检查 API 地址和 Key 是否正确填写并保存
2. 检查模型名称是否匹配内置知识库
3. 展开"高级设置"，添加额外请求头或自定义请求体模板

### Q: 百度语音识别报错？

- 检查 App ID / API Key / Secret Key 是否正确
- 检查百度云账户余额
- 检查网络是否能访问 `aip.baidubce.com`

### Q: 如何备份配置？

配置文件位置：`%APPDATA%\VoiceInput\settings.json`，直接复制保存即可。

### Q: 构建时 `electron-builder` 报错？

```bash
# 清除缓存后重试
npx electron-builder --win portable --config.extraMetadata.main=src/main.js
```

---

> **最后更新**：2026-06-10
> **维护者**：@D-ai042
