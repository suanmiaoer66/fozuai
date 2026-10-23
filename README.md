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

点击输入框的图片生成按钮，可在发送前选择自动、1:1、16:9、9:16、4:3、3:4、3:2、2:3 比例，以及 1K / 2K / 4K 分辨率。设置只影响之后提交的任务，已生成图片保留当时的参数。

生成后点击图片查看大图，支持放大、缩小、适应窗口和打开原图；点击关闭按钮、遮罩或按 Esc 返回聊天。图片卡片和预览内均有“下载图片”按钮，下载失败可重试，手机可从浏览器下载记录保存到相册。

图片下载通过 Worker 的 `GET /v1/tasks/{task_id}/image` 完成，使用任务 ID 查询原图，避免跨站图片无法直接保存。支持 PNG、JPEG、WebP、GIF、AVIF，单文件上限 32 MiB；下载接口不接受任意图片 URL，且不会向图片 CDN 发送 API Key。

## 线上架构

GitHub Pages 只负责发布静态前端，Cloudflare Worker 负责保存 API Key，并代理 DeepSeek 对话和 APIMart 生图请求。打开网页即可直接使用对话和生图，无需输入网站访问口令：

```text
浏览器 → GitHub Pages → Cloudflare Worker → DeepSeek / APIMart
```

仓库已带有两个 GitHub Actions 工作流：

- `.github/workflows/deploy.yml`：构建并发布 GitHub Pages。
- `.github/workflows/deploy-worker.yml`：可选的手动测试和自动部署流程（需要 Cloudflare 部署凭据）。

Pages 工作流会在推送到 `main` 时运行；Worker 工作流只在你主动选择 `workflow_dispatch` 时运行。

如果不想配置 Cloudflare 部署 Token，最简单的方式是直接在 Cloudflare 控制台手动创建 Worker：新建一个 Worker，复制 [worker/index.js](worker/index.js) 的代码，部署后在 Worker 的 **Settings → Variables and Secrets** 中添加两个 Secrets：`DEEPSEEK_API_KEY`、`APIMART_API_KEY`。代码里的 DeepSeek、APIMart 地址和图片默认参数已经写好，不需要再配置。复制 Worker 的 `workers.dev` 地址，填入下面两个 GitHub Variables，然后重新运行 Pages 工作流即可。

## GitHub 配置

在仓库的 **Settings → Secrets and variables → Actions** 中添加以下 **Variables**。Variables 可以被公开构建读取，因此这里只放地址和展示参数：

| Variable | 值 |
| --- | --- |
| `DEEPSEEK_API_PROXY_URL` | Worker 或下文 Pages 网关的 HTTPS 根地址，例如 `https://fozuai-api.<账户子域>.workers.dev` |
| `APIMART_IMAGE_MODEL` | `gpt-image-2` |
| `APIMART_IMAGE_SIZE` | `1:1` |
| `APIMART_IMAGE_RESOLUTION` | `1k` |
| `IMAGE_API_PROXY_URL` | 与 `DEEPSEEK_API_PROXY_URL` 使用同一个接口地址 |

仓库中已有的 `DEEPSEEK_BASE_URL`、`DEEPSEEK_VISION_MODEL` 和 `APIMART_BASE_URL` Variables 可以保留；当前 Worker 直接使用内置默认地址和模型配置。

添加以下 **Secrets**。Secrets 只在 GitHub Actions 和 Cloudflare Worker 中使用，不要放入 Variables 或前端代码：

| Secret | 用途 |
| --- | --- |
| `DEEPSEEK_API_KEY` | DeepSeek 服务密钥 |
| `APIMART_API_KEY` | APIMart 生图服务密钥 |
| `CLOUDFLARE_API_TOKEN` | Wrangler 部署 Worker 的 Cloudflare API Token |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 账户 ID |

只有使用自动部署工作流时才需要 `CLOUDFLARE_API_TOKEN` 和 `CLOUDFLARE_ACCOUNT_ID`。手动部署时不需要把这两个值添加到 GitHub。部署 Worker 后，将 `workers.dev` 地址填入上表的两个代理 Variables，然后重新运行 Pages 工作流，打开网页即可使用。

旧的 `SITE_ACCESS_KEY` 已不再使用，现有 Secret 可以保留，无需删除。取消网站访问口令不影响 API 密钥的保存方式：`DEEPSEEK_API_KEY` 和 `APIMART_API_KEY` 仍作为 Worker Secrets 保存，不会发送给浏览器。Worker 的 `/health` 通过 `configured.chat` 和 `configured.image` 标示两项服务密钥是否已配置。

GitHub Pages 是静态托管，GitHub Secrets 和 Variables 不会自动出现在浏览器运行时。API Key 不应直接写入公开构建产物；如果只配置了 API Key 而没有部署 Worker，线上对话和生图不会工作。

## GitHub Pages

仓库已带有 `.github/workflows/deploy.yml`。推送到 `main` 后，GitHub Actions 会构建 `dist` 并发布到 Pages。Vite 使用相对资源路径 `base: './'`，同一构建支持原 GitHub 地址的 `/fozuai/` 路径及自定义子域名的根路径。

图标来自 [Reicon](https://github.com/dqev/reicon) 的 `reicon-react` 包，品牌头像使用仓库中的 `logo.ico`。

## 使用外部 DNS 的自定义子域名

DNS 可以继续由现有服务商管理。静态前端仍部署在 GitHub Pages，接口通过已创建的 Cloudflare Pages 项目 `fozuai-gateway` 转发给原 Worker。已确认网页域名为 `fozu.zoreai.cn`，接口域名为 `fozu-api.zoreai.cn`；以下是目标配置及部署步骤，不代表 DNS、证书和上线验证已完成。

```text
网页：fozu.zoreai.cn → GitHub Pages
接口：fozu-api.zoreai.cn → fozuai-gateway.pages.dev → FOZU_API → fozuai-api
```

1. 在仓库根目录部署网关：

   ```bash
   npx wrangler pages deploy --cwd gateway --project-name fozuai-gateway --branch main
   ```

   [gateway/wrangler.jsonc](gateway/wrangler.jsonc) 已配置 Service Binding `FOZU_API` → `fozuai-api`。网关在 Cloudflare 内部调用 Worker，原 `DEEPSEEK_API_KEY`、`APIMART_API_KEY` Secrets 继续保存在 Worker，无需复制到网关或前端。

2. **先关联域名，再添加 DNS CNAME。** 在 Cloudflare 的 `fozuai-gateway` 项目 **Custom domains** 中添加 `fozu-api.zoreai.cn`，随后在现有 DNS 服务商处为 `zoreai.cn` 添加 `fozu-api` CNAME，目标为 `fozuai-gateway.pages.dev`。仅添加 DNS 记录不能完成 Pages 域名关联。[Cloudflare 自定义域名说明](https://developers.cloudflare.com/pages/configuration/custom-domains/)

3. 在 GitHub 仓库 **Settings → Pages → Custom domain** 中添加 `fozu.zoreai.cn`，随后在 `zoreai.cn` 的 DNS 中添加 `fozu` CNAME，目标为 `suanmiaoer66.github.io`，不含协议或 `/fozuai/`。待证书就绪后启用 HTTPS。当前使用自定义 Actions 部署，不需要仓库内的 `CNAME` 文件。[GitHub 自定义域名说明](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site)

4. 配置 GitHub Actions **Variables**：

   | Variable | 值 |
   | --- | --- |
   | `ALLOWED_ORIGINS` | `https://suanmiaoer66.github.io,https://fozu.zoreai.cn` |
   | `DEEPSEEK_API_PROXY_URL` | `https://fozu-api.zoreai.cn` |
   | `IMAGE_API_PROXY_URL` | `https://fozu-api.zoreai.cn` |

   `ALLOWED_ORIGINS` 是允许访问接口的**网页 Origin**，包含协议，不含路径；多个值用逗号分隔，迁移期间同时保留旧 GitHub Origin。该列表优先于旧的 `ALLOWED_ORIGIN`；未配置列表时回退到旧变量，再回退到默认 GitHub Origin。先运行 **Deploy Cloudflare Worker** 应用 CORS 配置，再运行 **Deploy to GitHub Pages** 更新前端接口地址。HTTPS 就绪后检查新接口的 `/health` 及新旧网页入口；`/health` 不会调用付费模型。
