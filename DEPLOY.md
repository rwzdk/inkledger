# 墨账 InkLedger 部署指南

墨账是**纯静态应用**：`pnpm build` 产物在 `dist/`，放到任何静态托管即可运行，无需服务器、无需环境变量。

> 先构建：
> ```bash
> pnpm install
> pnpm build     # 产物在 dist/
> ```
> 注意 `vite.config.js` 中 `base: './'` 为相对路径，天然支持任意子路径部署。

---

## 方式一：Qoder Sites

1. 在 Qoder 中打开本项目（或任意目录）
2. 本地执行 `pnpm build`，得到 `dist/` 目录
3. 进入 Qoder 的 Sites（免费静态托管）面板，新建站点
4. 选择**上传静态文件 / 拖拽目录**，把 `dist/` 内**全部内容**（不是 dist 文件夹本身）上传
5. 站点发布后即可通过分配的 URL 访问

要点：
- 入口文件为 `index.html`，确保它位于站点根目录
- 无需配置重写规则（应用不依赖服务端路由）
- PWA 安装与「添加到主屏幕」要求 HTTPS，Qoder Sites 默认提供

## 方式二：Cloudflare Pages

1. Fork 本仓库
2. [pages.cloudflare.com](https://pages.cloudflare.com) → Create a project → Connect to Git → 选择 fork 的仓库
3. 构建配置：
   - Framework preset：**Vue** / 或 None
   - Build command：`pnpm build`
   - Build output directory：`dist`
4. 保存后自动构建发布，后续 push 自动更新

## 方式三：Vercel

[![Deploy with Vercel](https://img.shields.io/badge/Vercel-一键部署-black?style=flat-square&logo=vercel)](https://vercel.com/new/clone?repository-url=https://github.com/rwzdk/inkledger)

或手动：Vercel → Add New Project → 导入仓库 → Framework Preset 选 **Vite** → Output 保持默认（`dist`）→ Deploy。

## 方式四：Netlify

1. Netlify → Add new site → Import an existing project
2. Build command：`pnpm build`；Publish directory：`dist`
3. Deploy

## 方式五：GitHub Pages

本仓库自带工作流（`.github/workflows/deploy-pages.yml`），push 到 `main` 会自动构建并发布：

1. 打开仓库 **Settings → Pages**
2. Build and deployment → Source 选择 **GitHub Actions**
3. 保存后触发一次 push（或 Actions 页面手动 Run workflow）即可

产物地址：`https://<用户名>.github.io/inkledger/`

## 部署后检查清单

- [ ] 打开站点能看到「墨账」首页
- [ ] 「记一笔」可以保存（刷新后仍在——localStorage 生效）
- [ ] 设置页能粘贴 GitHub Token 并校验通过（需要浏览器能访问 api.github.com）
- [ ] 手机浏览器访问 → 添加到主屏幕 → 图标与名称正常（PWA manifest 生效）

## 常见问题

**Q：换浏览器 / 换设备数据还在吗？**
A：数据在浏览器 localStorage 与你的 GitHub 私有仓库。新设备上登录同一 GitHub 账号并点击「立即同步」即可拉取。

**Q：Token 安全吗？**
A：Token 仅保存在你自己浏览器的 localStorage，仅用于直连 GitHub 官方 API。建议使用 Fine-grained Token 并设置有效期，不用时随时在 GitHub 撤销。

**Q：可以部署到内网 / 离线环境吗？**
A：可以记账与看统计（本地运行），但 GitHub 同步与获取 Token 页面需要能访问 github.com。
