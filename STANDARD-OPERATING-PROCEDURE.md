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

## 5. 发布流程（推送到 GitHub）

### 完整发布步骤

```bash
# 第一步：查看当前更改
git status

# 第二步：添加所有更改
git add .
git commit -m "描述本次更改"

# 第三步：打标签（可选，用于版本发布）
git tag v1.0.0

# 第四步：推送到 GitHub
# 由于网络限制，使用 ghfast.top 代理推送
# 方式 A：直接带 Token（一次性）
git remote set-url origin https://<USERNAME>:<TOKEN>@ghfast.top/https://github.com/D-ai042/vioceinput.git
git push origin master --tags

# 推送完成后，恢复普通地址
git remote set-url origin https://ghfast.top/https://github.com/D-ai042/vioceinput.git
```

### 关于 Token

推送到 GitHub 需要 **Personal Access Token (classic)**：

1. 访问 https://github.com/settings/tokens
2. 点击 **Generate new token (classic)**
3. 名称：`voiceinput-push`
4. 过期：推荐 30 天或 No expiration
5. 权限：勾选 **repo**（全部）
6. 生成后复制 Token

### 首次推送（新仓库）

如果 GitHub 上还没有 `vioceinput` 仓库：

```bash
# 方式一：用 gh CLI 创建
gh repo create vioceinput --public --source=. --remote=origin --push

# 方式二：手动创建 + 推送
# 1. 在 GitHub 上新建空仓库（不勾选 README/LICENSE/.gitignore）
# 2. 本地执行：
git remote add origin https://<TOKEN>@ghfast.top/https://github.com/D-ai042/vioceinput.git
git push -u origin master
```

---

## 6. CI/CD 自动构建

### 触发条件

打 `v*` 标签推送到 GitHub 后，可配置 GitHub Actions 自动构建。

### 示例 workflow（`.github/workflows/build.yml`）

```yaml
name: Build

on:
  push:
    tags:
      - 'v*'

jobs:
  build:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm run build
      - uses: actions/upload-artifact@v4
        with:
          name: VoiceInput.exe
          path: dist/VoiceInput.exe
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
