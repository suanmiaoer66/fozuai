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

配置 `VITE_DEEPSEEK_API_KEY` 后，输入会直接请求 DeepSeek Chat Completions 接口。也可以配置 `VITE_DEEPSEEK_BASE_URL` 覆盖 API 地址。生产环境建议在服务端代理请求，避免把密钥暴露给浏览器。

## GitHub Pages

仓库已带有 `.github/workflows/deploy.yml`。推送到 `main` 后，GitHub Actions 会构建 `dist` 并发布到 Pages，站点路径为 `/fozuai/`。

GitHub Pages 是静态托管，GitHub Secrets 和 Variables 不会自动出现在浏览器运行时。API Key 不应直接写入公开构建产物；如果需要线上真实对话，请把 DeepSeek 请求放到一个服务端代理后，再将代理地址配置到前端。

图标来自 [Reicon](https://github.com/dqev/reicon) 的 `reicon-react` 包，品牌头像使用仓库中的 `logo.ico`。
