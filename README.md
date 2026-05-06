# 中文AI助手（语音转写 + 智能问答）

这是一个基于 `Express + React + Vite` 的本地应用，支持：

- 语音输入（麦克风或系统音频）实时转写
- 文本/转写内容发送给大模型生成回答
- 上传参考资料（`.md/.txt`）并在相关问题中作为上下文使用
- 中文/英文/日语转写切换

应用默认运行在 `http://localhost:3000`。

## 技术栈

- 后端：`Node.js`、`Express`、`ws`
- 前端：`React`、`Vite`
- 语音转写：`Deepgram`
- 大模型回答：`Cerebras`

## 功能说明

- **三种会话启动方式**
  - 开始（仅文本）
  - 共享桌面（系统音频）
  - 麦克风输入
- **实时转写**
  - 通过 WebSocket 将音频流发送到 Deepgram
  - 支持 `zh-CN`、`en`、`ja` 三种语言
- **自动发送**
  - 静音 `800ms` 后自动将转写发送给模型
  - 可设置最小发送字数阈值
- **参考资料上下文**
  - 上传 `.md/.txt` 后自动提取摘要
  - 对“经历/项目/背景”类问题优先参考摘要

## 目录结构

```text
.
├─ client/                 # React 前端
├─ server.js               # Express 服务与 API
├─ package.json
└─ README.md
```

## 环境要求

- `Node.js >= 18`
- 可用的 `Deepgram` 与 `Cerebras` API Key

## 环境变量配置

在项目根目录创建 `.env` 文件（不要提交到仓库）：

```bash
DEEPGRAM_API_KEY=your_deepgram_key
CEREBRAS_API_KEY=your_cerebras_key

# 可选
PORT=3000
CEREBRAS_MODEL=llama3.1-8b
SYSTEM_PROMPT=你是中文面试助手。先给结论，再给要点，语言简洁。
```

## 安装与启动

```bash
npm install
npm run dev
```

启动成功后访问：`http://localhost:3000`

## 常用脚本

- `npm run dev`：开发模式（`nodemon server.js --dev`）
- `npm run start`：生产模式启动
- `npm run build`：构建前后端产物
- `npm run lint`：执行 ESLint 并自动修复

## 主要接口

- `GET /health`
  - 健康检查
- `POST /api/chat-text`
  - 文本问答
  - 请求体：`{ text, useResumeContext, resumeSummary }`
- `POST /api/resume-md`
  - 上传参考资料文本并生成摘要
  - 请求体：`{ content }`
- `POST /api/transcribe-and-answer`
  - 上传音频并返回转写 + 回答
- `WS /ws/deepgram-stt?lang=zh-CN|en|ja`
  - 实时语音转写通道

## 使用流程（推荐）

1. 启动项目并打开页面
2. 选择会话方式（文本 / 系统音频 / 麦克风）
3. （可选）上传 `.md/.txt` 作为参考资料
4. 观察实时转写，自动或手动发送问题
5. 在聊天区查看模型回答

## 常见问题

- **启动后端口被占用**
  - 修改 `.env` 中 `PORT`，或关闭占用 `3000` 的进程
- **系统音频捕获失败**
  - 在浏览器授权弹窗中启用系统音频分享
- **没有回答或报 500**
  - 检查 `.env` 是否正确配置 `DEEPGRAM_API_KEY` 与 `CEREBRAS_API_KEY`
- **转写效果不理想**
  - 先确认输入源音量与采样质量，再调整语言模式

## 安全提示

- 请勿将真实 API Key 提交到 Git 仓库
- 若 API Key 已泄露，请立即在对应平台重置

## License

MIT
