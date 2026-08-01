# AI Assistant（语音转写 + 智能问答）

本地 AI 助手：实时语音转写、图文问答、手机同步。支持 **Web 开发模式** 与 **Windows 桌面版（Electron）**。

默认地址：`http://localhost:3000`（桌面版由 Electron 内嵌打开）。

## 技术栈

- 后端：`Node.js`、`Express`、`ws`
- 前端：`React`、`Vite`
- 桌面：`Electron`（托盘、全局截图快捷键、Windows 系统环回音频、窗口防捕获）
- 语音转写：`Deepgram`（Nova-3，岗位词库 keyterm + 事后纠正）
- 大模型：`DeepSeek`（默认）、`Cerebras`（可选，自动 fallback）
- 图片 OCR：阿里云统一识别（中/英/日）；桌面截图会转 JPEG、限制最长边并超时重试

## 功能说明

- **会话方式**：仅文本 / 共享系统音频 / 麦克风
- **实时转写**：WebSocket → Deepgram；语言 `zh-CN` / `en` / `ja`
- **转写词汇（岗位）**：设置中切换 **前端 / 后端 / Agent·全栈**，提高专业术语识别率
- **自动发送**：静音 800ms 后发送；可设最小字数阈值
- **麦克风暂停转写**：麦克风模式下 **Ctrl+X** 暂停/恢复转写（答题时避免误触发自动发送扣次）
- **图文输入**：贴图并行预 OCR；截图快捷键（桌面版默认 Ctrl+S）截屏问 AI；桌面截图会转为 JPEG 85、最长边限制为 1920px，OCR 单次 10s 超时并对 timeout 自动重试一次；可设置**截图发送时不弹出主窗口**（手机同步不受影响）
- **参考资料上下文**：上传 `.md/.txt` 摘要；涉及经历类问题时注入；勾选后扣次 ×2
- **手机同步**：局域网扫码，手机看回答、发文字；同步弹窗默认显示手机二维码，可一键切换为手表二维码（只读、大字、轻量页面）
- **Windows 防屏幕捕获**：桌面版启动后强制开启窗口内容保护，在支持的 Windows 版本上屏幕共享/录屏/截图会排除应用窗口
- **企业微信智能机器人**（可选）：API 长连接，企微里发文字/语音问 AI；**无需 ngrok**（见 `docs/wecom-bot-setup.md`）
- **用量与充值**：新机器默认 20 次；LLM **成功**后才扣次；充值码兑换（见 `.env` 中 `RECHARGE_SECRET`）

## 目录结构

```text
.
├─ client/                      # React 前端
├─ electron/                    # 桌面壳（main / preload / 截图 / 托盘）
├─ server/                      # 服务端模块（OCR、用量、充值码、词库、会话）
│  └─ vocabulary/profiles/      # 转写岗位词库（frontend / backend / agent-fullstack）
├─ scripts/issue-recharge-code.js
├─ server.js                    # Express 入口、API、WebSocket
├─ dist/                        # 构建产物（client + server）
└─ release/win-unpacked/        # Windows 桌面打包输出
```

## 环境要求

- `Node.js >= 18`
- `DEEPGRAM_API_KEY`（转写）
- `DEEPSEEK_API_KEY` 和/或 `CEREBRAS_API_KEY`（问答）
- 图片 OCR 需配置阿里云 AccessKey（见 `.env.example`）

## 环境变量

复制 `.env.example` 为 `.env`（勿提交 Git）。桌面版首次运行会在用户目录生成 `.env`，托盘可「打开配置目录」编辑。

常用项：

```bash
DEEPGRAM_API_KEY=
DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=deepseek-v4-flash
# CEREBRAS_API_KEY=
# ALIBABA_CLOUD_ACCESS_KEY_ID=
# ALIBABA_CLOUD_ACCESS_KEY_SECRET=
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

```bash
npm run build
npm run dist:dir
```

输出：`release/win-unpacked/AI Assistant.exe`。分发时可整文件夹 zip；更新前需完全退出托盘中的旧进程。

## 常用脚本

| 脚本 | 说明 |
|------|------|
| `npm run dev` | Web 开发（nodemon + Vite） |
| `npm run start` | 生产模式启动 Node |
| `npm run build` | 构建 `dist/client` + `dist/server` |
| `npm run electron:dev` | Electron 开发调试 |
| `npm run dist:dir` | Windows 目录版打包 |
| `npm run issue-code` | 生成充值码（需 `RECHARGE_SECRET`） |

## 主要接口

- `GET /health` — 健康检查
- `GET /api/usage` — 剩余次数、本机标识
- `POST /api/usage/redeem` — 兑换充值码
- `GET /api/stt/vocab-profiles` — 转写岗位词库列表
- `POST /api/chat-text` — 文本问答
- `POST /api/ocr` — 图片 OCR
- `POST /api/resume-md` — 上传参考资料并生成摘要
- `POST /api/session` — 创建手机同步会话
- `GET /w/:sessionId` — 手表只读同步页面（大字、轻量、无底部输入）
- `WS /ws/deepgram-stt?lang=&vocab=` — 实时转写（`vocab`: frontend / backend / agent-fullstack）
- `WS /ws/session?sessionId=&role=` — 会话同步（pc / mobile / watch）

## 扣次规则（简要）

- 纯文字或 1 张图：1 次；同一消息每多 1 张图多 1 次
- 勾选「启用参考资料上下文」：上述次数 ×2
- 仅 LLM 成功响应后扣次

## 常见问题

- **端口占用**：修改 `.env` 中 `PORT`
- **系统音频失败（浏览器）**：共享弹窗需勾选系统音频；**桌面版**依赖 Windows 环回，Mac 无同等能力
- **打包失败 Access denied**：先结束所有 `AI Assistant` 进程再 `npm run dist:dir`
- **改代码后 exe 仍是旧界面**：需 `build` + `dist:dir`，不能只做 `electron:dev`
- **截图问 AI / OCR 慢或 ReadTimeout**：桌面截图会转 JPEG 85、最长边限制 1920px；OCR 单次 10s 超时，并对 timeout 自动重试一次。全屏复杂文字仍可能变慢，建议框选更小范围或减少同屏文字量
- **无回答 / 500**：检查 Deepgram、DeepSeek（或 Cerebras）Key 与网络
- **转写 400 / 1006**：多为 Deepgram keyterm 超限；默认已限制为 65 个岗位词，通用词靠事后纠正；仍失败则检查 `DEEPGRAM_API_KEY`

## 安全提示

- 勿将 `.env`、真实 API Key、`RECHARGE_SECRET` 提交 Git 或发给不可信用户
- 充值码与本地 `usage.json` 为轻量防滥用，**不能**当作强 DRM

## License

MIT
