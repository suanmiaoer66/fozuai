# 佛祖 AI

一个参考豆包工作台设计语言、接入 DeepSeek 模型的专注型 AI agent 网页。

## 本地运行

```bash
npm install
npm run dev
```

页面中的模型名称映射为：

- 高级佛祖模型：调用 `deepseek-reasoner`
- 导管佛祖模型：调用 `deepseek-chat`

本地配置 `VITE_DEEPSEEK_API_KEY` 后，输入会直接请求 DeepSeek Chat Completions 接口。线上建议配置 `VITE_DEEPSEEK_API_PROXY_URL`，代理需要保留 `/chat/completions` 路径并在服务端使用 `DEEPSEEK_API_KEY`。也可以配置 `VITE_DEEPSEEK_BASE_URL` 覆盖 API 地址。

图片生成接入 APIMart 的 GPT-Image-2：提交任务到 `/v1/images/generations`，再轮询 `/v1/tasks/{task_id}`，完成后展示返回图片。页面默认进入“图片生成”模式时使用 `gpt-image-2`、`1:1`、`1k`。线上建议设置 `VITE_IMAGE_API_PROXY_URL`，代理需要保留与 APIMart 相同的 `/v1` 路径；本地调试才使用 `VITE_APIMART_API_KEY`。

## GitHub Pages

仓库已带有 `.github/workflows/deploy.yml`。推送到 `main` 后，GitHub Actions 会构建 `dist` 并发布到 Pages，站点路径为 `/fozuai/`。

GitHub Pages 是静态托管，GitHub Secrets 和 Variables 不会自动出现在浏览器运行时。API Key 不应直接写入公开构建产物；如果需要线上真实对话，请把 DeepSeek 请求放到一个服务端代理后，再将代理地址配置到前端。

图标来自 [Reicon](https://github.com/dqev/reicon) 的 `reicon-react` 包，品牌头像使用仓库中的 `logo.ico`。
