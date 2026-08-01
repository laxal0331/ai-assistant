# 企业微信智能机器人接入指南（API 长连接）

用 **工作台 → 智能机器人 → API 模式 → 长连接** 接入本项目，**不需要 ngrok、不需要公网域名、不需要域名主体校验**。

---

## 第一步：在企微里创建机器人

1. 打开 **企业微信客户端**（手机或 PC 均可）。
2. 进入 **工作台** → **智能机器人** → **创建机器人**。
3. 选择 **手动创建**（若进入 AI 自动生成页，点左下角「手动创建」）。
4. 填写 **机器人名称**（如 `AI Assistant`）和 **可见范围**（先选自己或测试小组）。
5. 在页面底部点 **「API 模式创建」**。
6. 在 **API 配置** 里：
   - 连接方式选 **「使用长连接」**（不要选「设置接收消息回调地址」）。
   - 复制页面上显示的 **Bot ID**。
   - 点击 **「点击获取」** 生成 **Secret**，**立刻保存**（只显示一次）。
7. 保存机器人配置。

> 注意：API 模式只能二选一（长连接 **或** 回调 URL）。选长连接后，旧的 Token/AESKey 回调方式不再适用。

---

## 第二步：填写项目 `.env`

在项目根目录 `.env`（桌面版则在 `%AppData%\ai-assistant\.env`）加入：

```env
WECOM_BOT_ENABLED=1
WECOM_BOT_ID=你的BotID
WECOM_BOT_SECRET=你的Secret
```

可选：

```env
# WECOM_BOT_WS_URL=wss://openws.work.weixin.qq.com
```

保存后 **不要** 把 Secret 提交到 Git 或发给他人。若泄露，到企微后台重新获取 Secret。

---

## 第三步：启动本项目的 Node 服务

长连接由 **你的电脑/服务器主动连企微**，服务必须保持运行。

**Web 开发：**

```bash
npm run dev
```

**或生产模式：**

```bash
npm run start
```

**或桌面版 exe：**

直接运行 `release/win-unpacked/AI Assistant.exe`（需先 `npm run build && npm run dist:dir` 打包含最新代码的版本）。

启动成功后，终端应出现类似日志：

```text
[wecom-bot] starting long-connection client…
[wecom-bot] connected, subscribing…
Express server running on port 3000
```

若看到 `disabled` 或 `missing WECOM_BOT_ID`，检查 `.env` 是否写对、是否重启了进程。

---

## 第四步：在企微里测试

1. 在企业微信 **通讯录** → **企业创建的** 分组里找到刚创建的机器人。
2. 点 **发消息**，进入单聊。
3. 发送：`你好` 或任意问题。
4. 应先看到「正在思考…」，随后返回 AI 回答。

**群聊测试：** 把机器人拉进群，发送 `@机器人名 你的问题`（需 @ 才会触发）。

---

## 第五步：确认连接正常（排错）

| 现象 | 处理 |
|------|------|
| 机器人无回复 | 确认 Node/exe 在跑；看终端有无 `[wecom-bot] connected` |
| 一直「正在思考…」 | 检查 `DEEPSEEK_API_KEY` / `CEREBRAS_API_KEY` 和网络 |
| 连接后立即断开 | Bot ID 或 Secret 错误；或同一机器人在别处又建了一条长连接（会互踢） |
| 改 `.env` 不生效 | 完全退出进程后重启（桌面版需退出托盘） |
| 端口 3000 被占用 | 改 `PORT=3001` 等，或先停掉 `npm run dev` |

**重要：** 每个智能机器人 **同时只能有 1 条有效长连接**。本机 dev + 云服务器各连一次会互相踢掉。

---

## 与上次失败方案的区别

| | 上次（回调 URL + ngrok） | 本次（智能机器人长连接） |
|--|--------------------------|---------------------------|
| 公网域名 | 需要 | **不需要** |
| 域名主体校验 | 需要 | **不需要** |
| 凭证 | CorpID + Token + AESKey | **Bot ID + Secret** |
| 收消息 | 企微 POST 到你 | **你连 `wss://openws.work.weixin.qq.com`** |

---

## 当前 MVP 能力范围

- ✅ 单聊文字问答（走项目现有 LLM）
- ✅ 单聊语音（企微转文字后问答）
- ✅ 群聊 @ 机器人文字问答
- ✅ 首次进入单聊欢迎语
- ❌ 图片 OCR 问答（后续可加）
- ❌ 按企微 userid 独立扣次（当前不扣本地用量，仅作通道测试）

---

## 官方文档

- [智能机器人长连接](https://developer.work.weixin.qq.com/document/path/101463)
- [API 模式机器人文档使用说明](https://developer.work.weixin.qq.com/document/path/101464)
