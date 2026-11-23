# Kuaixue Desktop

Standalone desktop client for Kuaixue AI courses.

## Current scope

- Independent Electron + React application and Git repository.
- Local catalog API PoC and desktop UI share a single demo course seed. The client also supports a clearly labeled demo fallback when no API origin is configured.
- The default package uses a local demo learner. A separate service mode implements course publishing, version purchases, progress, and scoped workspace access through platform adapters. Production identity, wallet and runtime integration require staging verification.
- Existing project plan documents are retained as planning references.

## Requirements

- Node.js 22 or newer
- pnpm 11.25 or newer

## Development

```powershell
pnpm install
pnpm dev
```

## Build

```powershell
pnpm build
pnpm start
```

## Windows package

```powershell
pnpm package:win
```

The NSIS installer is written to `release/`. The current App ID (`com.kuaixue.classroom`) is a provisional, product-specific packaging identity for internal testing. Confirm the official reverse-domain identifier, signing certificate, icon, and update channel before any external distribution. The default package supports offline demo purchases. Enable service mode at build time for staging.

## Catalog integration

`pnpm dev` starts the local API on `http://127.0.0.1:4175` alongside Vite and Electron. The API reads `data/course-catalog.demo.json`, which is sample content, not a production catalog. The client reads `GET /api/v1/catalog/courses`; see `docs/快学课堂_主站正式接口交付清单.md` for the integration contract. If a service origin is set but the request fails or returns an incompatible response, the client shows an error instead of silently showing demo courses. The development port is set to `4175` to avoid an unrelated local service already using `4174`.

To run the API by itself, use `pnpm dev:api`. `GET /healthz` is a local health check. `KUAIXUE_API_PORT` and `KUAIXUE_ALLOWED_ORIGINS` can override the local server defaults.

Run the focused adapter tests with `pnpm test`.

## P1 integration gates

1. Confirm the desktop authentication/token-exchange contract with the Chuangyi Lingdong main site.
2. Define course catalog, immutable course version, purchase, refund, and entitlement APIs in the Kuaixue service.
3. Confirm the Canvas embedding approach and course-template handoff.
4. Define VibeCoding course-run context and short-lived runtime credentials without classroom-session authorization.
5. Define local workspace backup, cloud sync, and recovery scope.
6. Assign a unique app ID, product name, data directory, deep-link scheme, and update channel before packaging.

Do not use production accounts, payment endpoints, or generation billing until these contracts are reviewed and configured.

## 桌面课程配图

在 Windows 项目目录运行 `pnpm course:images`，选择课程和图片用途，使用文件选择器导入 PNG、JPEG 或 WebP。封面每次替换一张，预览图和介绍图支持多选，按传入顺序追加。该工具维护本地平台演示目录，图片随桌面构建分发。运行 `pnpm dev` 时请在导入后重启本地目录 API，发布预览版时重新构建。

首页优先展示 `bannerUrl`，缺省时使用卡片封面 `thumbnailUrl`。配图工具支持独立替换横幅、设置卡片裁切焦点 `coverFocus`（x、y 为 0 到 100）以及将一张作品图置于详情轮播首位。详情支持有序的 `galleryImages` 和 `introImages`，每项包含 `url` 和 `alt`。远端素材请提供可访问的完整 HTTPS 地址。购买次数取自 `purchaseCount`，缺失时显示「暂无统计」。收藏保存在当前设备，积分结算和账号授权仍待平台接入。

## 快学课堂课程流程

运营在创易灵动主站后台发布课程版本，编排画布素材组与框体、设置 VibeCoding 预设提示词及积分价，选择本课工作区。学员在快学客户端购课后按所购版本进入一个或两个工作区。画布与 VibeCoding 各自铺满主内容区，保存各自作品，不共用步骤清单。

`docs/本机课程验收.md` 给出桌面包体验路径。对创易灵动主站只交付 `docs/快学课堂_主站正式接口交付清单.md`。`integrations/main-site-admin/` 是主站后台挂载组件。运行 `node scripts/build-vibe-workbench.mjs <灵动客户端源码根目录>` 可使用灵动项目自身的依赖和构建配置生成课程工作台，输出到 `release/vibe-course-web/`。

默认 Windows 验收包把学院画布和灵动原版工作台放在快学窗口内。VibeCoding 的本机演示工程可编辑、预览和恢复，正式 AI 生成使用主站授权的模型网关。重新打包前，先从同一份灵动源码生成前端和本机运行服务。

```powershell
node scripts/build-vibe-workbench.mjs 'E:/灵动ai客户端'
node scripts/build-vibe-local.mjs 'E:/灵动ai客户端'
pnpm package:win:dir
```
