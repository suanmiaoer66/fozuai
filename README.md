# 佛祖 AI

一个参考豆包工作台设计语言、接入 DeepSeek 模型的专注型 AI agent 网页。

## 本地运行

```bash
npm install
npm run dev
```

页面中的模型名称映射为：

- 高级佛祖模型：由 Worker 映射到 `DEEPSEEK_REASONING_MODEL`（未单独配置时使用 `deepseek-flash` 的深度思考模式）
- 导管佛祖模型：由 Worker 映射到 `DEEPSEEK_CHAT_MODEL`（默认 `deepseek-flash`）

线上页面只请求 Cloudflare Worker 代理，浏览器不接触 DeepSeek 或 APIMart 的 API Key。Worker 也兼容 `deepseek-reasoner` 和 `deepseek-chat` 这两个旧模型 ID。

图片生成接入 APIMart 的 GPT-Image-2：Worker 提交任务到 `/v1/images/generations`，再轮询 `/v1/tasks/{task_id}`，完成后展示返回图片。页面默认使用 `gpt-image-2`、`1:1`、`1k`。

## 线上架构

GitHub Pages 只负责发布静态前端，Cloudflare Worker 负责保存 API Key、校验网站访问口令，并代理 DeepSeek 对话和 APIMart 生图请求：

```text
浏览器 → GitHub Pages → Cloudflare Worker → DeepSeek / APIMart
```

仓库已带有两个 GitHub Actions 工作流：

- `.github/workflows/deploy.yml`：构建并发布 GitHub Pages。
- `.github/workflows/deploy-worker.yml`：可选的手动测试和自动部署流程（需要 Cloudflare 部署凭据）。

Pages 工作流会在推送到 `main` 时运行；Worker 工作流只在你主动选择 `workflow_dispatch` 时运行。

如果不想配置 Cloudflare 部署 Token，最简单的方式是直接在 Cloudflare 控制台手动创建 Worker：新建一个 Worker，复制 [worker/index.js](worker/index.js) 的代码，部署后在 Worker 的 **Settings → Variables and Secrets** 中添加三个 Secrets：`DEEPSEEK_API_KEY`、`APIMART_API_KEY`、`SITE_ACCESS_KEY`。代码里的 DeepSeek、APIMart 地址和图片默认参数已经写好，不需要再配置。复制 Worker 的 `workers.dev` 地址，填入下面两个 GitHub Variables，然后重新运行 Pages 工作流即可。

## GitHub 配置

在仓库的 **Settings → Secrets and variables → Actions** 中添加以下 **Variables**。Variables 可以被公开构建读取，因此这里只放地址和展示参数：

| Variable | 值 |
| --- | --- |
| `DEEPSEEK_API_PROXY_URL` | 部署 Worker 后得到的地址，例如 `https://fozuai-api.<账户子域>.workers.dev` |
| `APIMART_IMAGE_MODEL` | `gpt-image-2` |
| `APIMART_IMAGE_SIZE` | `1:1` |
| `APIMART_IMAGE_RESOLUTION` | `1k` |
| `IMAGE_API_PROXY_URL` | 与 `DEEPSEEK_API_PROXY_URL` 使用同一个 Worker 地址 |

仓库中已有的 `DEEPSEEK_BASE_URL`、`DEEPSEEK_VISION_MODEL` 和 `APIMART_BASE_URL` Variables 可以保留；当前 Worker 直接使用内置默认地址和模型配置。

添加以下 **Secrets**。Secrets 只在 GitHub Actions 和 Cloudflare Worker 中使用，不要放入 Variables 或前端代码：

| Secret | 用途 |
| --- | --- |
| `DEEPSEEK_API_KEY` | DeepSeek 服务密钥 |
| `APIMART_API_KEY` | APIMart 生图服务密钥 |
| `CLOUDFLARE_API_TOKEN` | Wrangler 部署 Worker 的 Cloudflare API Token |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 账户 ID |
| `SITE_ACCESS_KEY` | 页面访问口令，建议使用至少 32 位随机字符串 |

只有使用自动部署工作流时才需要 `CLOUDFLARE_API_TOKEN` 和 `CLOUDFLARE_ACCOUNT_ID`。手动部署时不需要把这两个值添加到 GitHub。部署 Worker 后，将 `workers.dev` 地址填入上表的两个代理 Variables，然后重新运行 Pages 工作流。打开网页后，在左下角“服务设置”中输入同一个 `SITE_ACCESS_KEY`；访问口令只保存在当前浏览器页面内存。

GitHub Pages 是静态托管，GitHub Secrets 和 Variables 不会自动出现在浏览器运行时。API Key 不应直接写入公开构建产物；如果只配置了 API Key 而没有部署 Worker，线上对话和生图不会工作。

## GitHub Pages

仓库已带有 `.github/workflows/deploy.yml`。推送到 `main` 后，GitHub Actions 会构建 `dist` 并发布到 Pages，站点路径为 `/fozuai/`。

图标来自 [Reicon](https://github.com/dqev/reicon) 的 `reicon-react` 包，品牌头像使用仓库中的 `logo.ico`。
