# AI Assistant（语音转写 + 智能问答）

本地 AI 助手：实时语音转写、图文问答、截图问 AI、手机同步。支持 **Web 开发模式** 与 **Windows 桌面版（Electron）**。

默认地址：`http://localhost:3000`（桌面版由 Electron 内嵌打开）。

## 技术栈

- 后端：`Node.js`、`Express`、`ws`
- 前端：`React`、`Vite`
- 桌面：`Electron`（托盘、全局截图快捷键、Windows 系统环回音频、窗口防捕获）
- 截图：Windows 原生截图助手 `native-capture.exe`，失败时回退 Electron `desktopCapturer`
- 语音转写：`Deepgram`（Nova-3，岗位词库 keyterm + 事后纠正）
- 大模型：`DeepSeek`（默认）；Cerebras 代码保留但默认不再使用
- 图片识别：截图问 AI 默认使用 `qwen3-vl-flash`；独立图片 OCR 接口保留

## 功能说明

- **会话方式**：仅文本 / 共享系统音频 / 麦克风
- **实时转写**：WebSocket → Deepgram；语言 `zh-CN` / `en` / `ja`
- **转写词汇（岗位）**：设置中切换 **前端 / 后端 / Agent·全栈**，提高专业术语识别率
- **自动发送**：静音 800ms 后发送；可设最小字数阈值
- **麦克风暂停转写**：麦克风模式下 **Ctrl+X** 暂停/恢复转写，答题时避免误触发自动发送扣次
- **截图问 AI**：桌面版默认快捷键 Ctrl+S；截图会压缩为 JPEG 75、最长边 1200px
- **截图处理方式**：截图问 AI 固定使用 **Qwen 识图大模型**，能直接理解画面和文字内容
- **截图耗时日志**：截图捕获、Qwen 首字与完整回答都会写入 `screenshot-timing.log`，便于定位卡顿
- **参考资料上下文**：上传 `.md/.txt` 摘要；涉及经历类问题时注入；勾选后扣次 ×2
- **手机同步**：局域网扫码，手机看回答、发文字；同步弹窗可切换手机二维码 / 手表二维码
- **Windows 防屏幕捕获**：桌面版启动后开启窗口内容保护，在支持的 Windows 版本上屏幕共享/录屏/截图会排除应用窗口
- **企业微信智能机器人**（可选）：API 长连接，企微里发文字/语音问 AI；无需 ngrok（见 `docs/wecom-bot-setup.md`）
- **用量与充值**：新机器默认 20 次；LLM 成功后才扣次；充值码兑换（见 `.env` 中 `RECHARGE_SECRET`）
- **套餐价格**：体验包 ¥9.9 / 30 次；标准包 ¥29.9 / 150 次（主推）；高频包 ¥59.9 / 400 次（推荐）

## 目录结构

```text
.
├─ client/                      # React 前端
├─ electron/                    # 桌面壳（main / preload / 截图 / 托盘）
│  ├─ bin/native-capture.exe     # Windows 原生截图助手
│  └─ native-capture/            # 原生截图助手源码
├─ server/                      # 服务端模块（OCR、用量、充值码、词库、会话）
│  └─ vocabulary/profiles/      # 转写岗位词库（frontend / backend / agent-fullstack）
├─ scripts/issue-recharge-code.js
├─ server.js                    # Express 入口、API、WebSocket
├─ dist/                        # 构建产物（client + server）
├─ release/                     # Windows 桌面打包输出
└─ 重新打包.bat                  # 双击打包脚本
```

## 环境要求

- `Node.js >= 18`
- Windows 桌面打包需要系统自带 .NET Framework C# 编译器（脚本会自动查找）
- `DEEPGRAM_API_KEY`（转写）
- `DEEPSEEK_API_KEY`（问答）
- 图片 OCR 需配置阿里云 AccessKey（见 `.env.example`）
- Qwen 识图需配置 `DASHSCOPE_API_KEY`

## 环境变量

复制 `.env.example` 为 `.env`（勿提交 Git）。桌面版首次运行会在用户目录生成 `.env`，托盘可「打开配置目录」编辑。

常用项：

```bash
DEEPGRAM_API_KEY=
DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=deepseek-v4-flash
# ALIBABA_CLOUD_ACCESS_KEY_ID=
# ALIBABA_CLOUD_ACCESS_KEY_SECRET=
# DASHSCOPE_API_KEY=
# QWEN_BASE_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1
# QWEN_VL_MODEL=qwen3-vl-flash
# QWEN_VL_MAX_TOKENS=400
# USAGE_QUOTA_ENABLED=1
# USAGE_DEFAULT_CREDITS=20
# RECHARGE_SECRET=          # 充值码签名，仅管理员持有
# STT_VOCAB_PROFILE=backend # 服务端默认岗位词库；设置页选择存 localStorage
```

完整说明见项目根目录 `.env.example`。

## 安装与启动

### Web 开发

```bash
npm install
npm run dev
```

浏览器打开 `http://localhost:3000`。

### 桌面开发（热更新，不更新 exe）

```bash
npm run electron:dev
```

### 桌面打包（给用户）

双击项目根目录的 `重新打包.bat` 即可。脚本会先结束正在运行的 `AI Assistant` 进程，编译 Windows 原生截图助手，再生成便携版 exe。

也可以手动执行：

```bash
npm run build
npm run dist
```

输出：`release/AI Assistant 1.0.1.exe`，目录版输出在 `release/win-unpacked/AI Assistant.exe`。

## 常用脚本

| 脚本 | 说明 |
|------|------|
| `npm run dev` | Web 开发（nodemon + Vite） |
| `npm run start` | 生产模式启动 Node |
| `npm run build` | 构建 `dist/client` + `dist/server` |
| `npm run electron:dev` | Electron 开发调试 |
| `npm run dist:dir` | Windows 目录版打包 |
| `npm run dist` | Windows 便携版打包 |
| `npm run issue-code` | 生成充值码（需 `RECHARGE_SECRET`） |

## 主要接口

- `GET /health` — 健康检查
- `GET /api/usage` — 剩余次数、本机标识
- `POST /api/usage/redeem` — 兑换充值码
- `GET /api/stt/vocab-profiles` — 转写岗位词库列表
- `POST /api/chat-text` — 文本问答
- `POST /api/ocr` — 图片 OCR
- `POST /api/vision-chat` — 截图直接交给 Qwen 识图模型回答
- `POST /api/resume-md` — 上传参考资料并生成摘要
- `POST /api/session` — 创建手机同步会话
- `GET /w/:sessionId` — 手表只读同步页面（大字、轻量、无底部输入）
- `WS /ws/deepgram-stt?lang=&vocab=` — 实时转写（`vocab`: frontend / backend / agent-fullstack）
- `WS /ws/session?sessionId=&role=` — 会话同步（pc / mobile / watch）

## 扣次规则（简要）

- 纯文字：1 次
- 截图问 AI 或 1 张图片：2 次；同一消息每多 1 张图片多 2 次
- 勾选「启用参考资料上下文」：上述次数 ×2
- 仅 LLM 成功响应后扣次

## 常见问题

- **端口占用**：修改 `.env` 中 `PORT`
- **系统音频失败（浏览器）**：共享弹窗需勾选系统音频；桌面版依赖 Windows 环回，Mac 无同等能力
- **打包失败 Access denied**：先结束所有 `AI Assistant` 进程，或直接双击 `重新打包.bat`
- **改代码后 exe 仍是旧界面**：需重新打包，不能只做 `electron:dev`
- **截图问 AI 慢或超时**：桌面截图会转 JPEG 75、最长边限制 1200px；截图捕获优先使用 Windows 原生截图助手，失败时才回退 Electron `desktopCapturer`。全屏复杂内容仍可能让视觉模型变慢，可查看 `screenshot-timing.log`
- **无回答 / 500**：检查 Deepgram、DeepSeek、DashScope、阿里云 OCR Key 与网络
- **转写 400 / 1006**：多为 Deepgram keyterm 超限；默认已限制为 65 个岗位词，通用词靠事后纠正；仍失败则检查 `DEEPGRAM_API_KEY`

## 安全提示

- 勿将 `.env`、真实 API Key、`RECHARGE_SECRET` 提交 Git 或发给不可信用户
- 充值码与本地 `usage.json` 为轻量防滥用，不能当作强 DRM

## License

MIT
