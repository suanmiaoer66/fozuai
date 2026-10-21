# 佛祖 AI

一个参考豆包工作台设计语言、接入 DeepSeek 模型的专注型 AI agent 网页。

## 本地运行

```bash
npm install
npm run dev
```

页面默认使用演示回复。配置 `VITE_DEEPSEEK_API_KEY` 后，输入会直接请求 DeepSeek Chat Completions 接口。生产环境建议在服务端代理请求，避免把密钥暴露给浏览器。

## GitHub Pages

仓库已带有 `.github/workflows/deploy.yml`。推送到 `main` 后，GitHub Actions 会构建 `dist` 并发布到 Pages，站点路径为 `/fozuai/`。

图标来自 [Reicon](https://github.com/dqev/reicon) 的 `reicon-react` 包。
