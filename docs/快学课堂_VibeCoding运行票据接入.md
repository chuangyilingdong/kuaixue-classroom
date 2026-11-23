# 快学课堂 VibeCoding 运行票据接入

2026-11-23 · 供创易灵动主站课程服务和灵动 VibeCoding 运行方对接

正式桌面端在快学课堂的整个创作区域加载灵动 VibeCoding 工作台。前端来自灵动客户端使用的 ZCode，工程由课程运行服务启动和保存。Electron 的本机工程服务用于离线演示。正式接入复用主站现有的课程会话和已购版本权益。

| 谁调用 | 地址或接口 | 交付状态 |
| --- | --- | --- |
| 桌面 → 主站课程服务 | `POST https://aicyld.com.cn/api/v1/course-runs/open` | 正式入口，已购版本的 VibeCoding 签票已上线 |
| 主站课程服务 → 签发器 | 服务端 `issueRuntimeTicket({userId,courseId,versionId,runId,mode})` | 随包交付，单机部署时直接函数调用，无公网签票地址 |
| 桌面 → 灵动工作台 | `GET <R>/kuaixue/workbench/#run=<runId>&ticket=<launchTicket>` | 独立 HTTPS 站点与静态路由已上线，待交付工作台文件 |
| 工作台 → 同源运行网关 | `POST <R>/kuaixue/runtime/exchange` | Nginx 代理已配置，待接入正式换票服务 |
| 工作台 → 同源运行网关 | `wss://<R的主机及端口>/kuaixue/runtime/ws/<socketId>` | Nginx 已配置 WebSocket 升级，待接入运行网关与学员专属 RPC 宿主 |

2026-11-23 快学侧已生成 Linux 网关、离线工程宿主镜像和工作台，运行账号为 `kuaixue-vibe`。工作台与换票路径在本轮交付前的公网复核均返回 `503`。安装与验收见[网关部署说明](./快学课堂_VibeCoding网关部署_20261123.md)。

### 域名与网关

- 快学工作区域名为 `kuaixue-vibe.aicyld.com.cn`。2026-11-23 16:36（北京时间），权威 DNS `dns21.hichina.com` 与联调机都返回 A 记录 `8.134.120.22`，权威记录 TTL 为 600 秒。
- 正式运行源 `R` 为 `https://kuaixue-vibe.aicyld.com.cn`。2026-11-23 公网实测独立站点的证书链和域名校验通过。证书有效至 2027-02-21，Certbot 自动续签演练通过，HTTP 请求以 `308` 转到同域 HTTPS。
- 工作台发布目录为生产服务器的 `/srv/aicyld/kuaixue-vibe/public/kuaixue/workbench/`。快学交付以 `/kuaixue/workbench/` 为资源基址的正式构建。发布时将 `index.html` 与构建输出的资源目录放在该目录内。站点允许桌面来源 `kuaixue://classroom` 嵌入工作台。
- Nginx 将 `POST /kuaixue/runtime/exchange` 和 `GET /kuaixue/runtime/ws/<socketId>` 的 WebSocket 升级请求按原路径转发。目前预留的同机监听地址为 Unix socket `/run/kuaixue-vibe/gateway.sock`。快学与灵动运行侧交付网关服务及其运行账号，双方配置 socket 目录的遍历权限和 `www-data` 的连接权限。若交付的服务使用其他监听地址，主站可相应调整上游。
- 本次公网核对中，工作台入口、换票 POST 和 WSS 升级均返回 `503`。工作台文件与网关交付后，联合验收以已购学员看到课程工程、能保存并重开为准。
- 创易灵动主站的模型计费网关基址为 `https://aicyld.com.cn/api/lingdong-code/v1`。本次匿名只读访问 `GET /api/lingdong-code/v1/models` 返回 HTTP 401。该网关负责调用模型与结算积分。
- 原灵动客户端的学院接口契约还列有 `https://aicyld.com/api/gateway/v1`，实际模型地址由登录后的 `client-context.gateway.baseUrl` 下发。它用于原课堂的模型请求。快学学员打开课程工程时使用上表的工作区运行源 `R`。

### 主站现在可以接什么

交付包采用**单机部署**。主站课程服务与可信的换票网关可以是同机的两个进程，共用一份本地 SQLite 票据文件。学员工程及其执行进程需要隔离在各自的宿主。若课程服务与换票网关必须跨主机，把部署拓扑告诉快学，由快学补交服务间适配；本包的 SQLite WAL 方式仅适用于同机本地磁盘。

1. 从压缩包将 `integrations/vibecoding/main-site-tickets.mjs` 和 `runtime-broker.mjs` 放在正式服务根目录的 `integrations/vibecoding/`。继续使用主站自己部署的课程、账号和钱包模块。
2. 在主站 `formal-server.cjs` 的 `main()` 中，将原来创建 `platform` 的一行替换为以下代码。`root`、`path`、`pathToFileURL`、`dbPath`、`provider` 和 `openCoursePlatform` 都是现有变量。现有停止服务流程调用 `platform.close()` 时会同步释放票据库。

```js
const { openTicketedCoursePlatform } = await import(
  pathToFileURL(path.join(root, 'integrations/vibecoding/main-site-tickets.mjs')).href
);
const platform = openTicketedCoursePlatform(
  openCoursePlatform, dbPath, provider, process.env.KUAIXUE_RUNTIME_TICKET_DB
);
```

3. 运行方交付网关后，两边将 `KUAIXUE_RUNTIME_TICKET_DB` 指向**同一份独立票据库**的本机绝对路径。目录应只允许两个受信服务读写，包含 SQLite 的 WAL/SHM 文件，学员工程进程不可访问。此变量为空时沿用现有提供方，未配置签发器的已购 VibeCoding 请求返回 `503`。购课放行仍由主站独立控制。

### 一次工作区启动如何流转

桌面携快学会话调用课程服务。以正式课程《测试一下》为例，请求体如下。

```json
{"courseId":"0477cad8-48ff-4737-b06f-a814220ed466","versionId":"c5d22c57-dcbf-4672-a632-be4037f7770c","mode":"VIBECODING"}
```

主站从会话取得学员 ID，核对已确认订单和发布版本允许的模式，再取该学员、该版本的 `runId`。`issueRuntimeTicket` 按用户、课程、版本、运行编号及模式绑定一个随机字符串，启动票据 60 秒内只能兑换一次。保留现有 `{data: run}` 响应及课程快照，只在 VibeCoding 的 `run` 中增加 `runtimeTicket`。桌面从 `data.id` 取运行编号、从 `data.runtimeTicket` 取票。未登录返回 `401`，未购、退款撤权或版本未开放此工作区返回 `403`。画布用相同的 open 接口，模式为 `CANVAS`。

桌面构建将 `VITE_KUAIXUE_VIBE_ORIGIN` 设为运行方交付并验证的 `R`，仅填源。启动参数放入 URL 的 `#` 之后。工作台清除地址栏片段并向同源网关发送 JSON，`Origin` 是 `R`，请求省略 Cookie。

```http
POST /kuaixue/runtime/exchange
Content-Type: application/json

{"runId":"<runId>","ticket":"<launchTicket>"}
```

兑换成功返回 HTTP 200 和下列顶层 JSON。`workspaceIdentity` 可选。`presets` 取自已购版本的 `classroomConfig.vibeCoding.presetPrompts`。兑换时网关复查权益，课程工程目录由宿主决定。

```json
{"runId":"<runId>","workspacePath":"/course/project","presets":[],"socketId":"<oneTimeSocketId>"}
```

网关拒绝来源不匹配、已撤权、错运行、过期或重复兑换的票据，返回 `403`。`socketId` 仅可于 30 秒内使用一次。WebSocket 升级时再次验权，连接中每 5 秒复查。断开或过期后，桌面重新调用 `course-runs/open` 取得新票；同一学员、同一版本沿用原工程。代理和日志应屏蔽启动票、换票正文和 WS 路径中的 `socketId`。

### 快学与灵动运行侧待交付

- 提供实际可达的 `R`、证书、工作台静态资源、换票及 WSS 代理。允许 `kuaixue://classroom` 在主内容区展示工作台。正式桌面包按此运行源构建。
- 在网关挂载 `mountRuntimeRoutes`，注入同一票据库的 broker、`checkAccess`、`openWorkspace` 与 `acceptScopedSocket`。权益以正式课程服务的 `hasRuntimeAccess(context)` 为准。`resolveHost` 必须返回该学员本次运行专属的 RPC 宿主。工程需持久化，运行时需要获得该版本允许的模型目录，才能显示完整 ZCode 工作台。核验预设时只插入草稿。
- 运行方回传实际域名、可用的桌面构建及完整工作台连接结果。目前能交付主站侧的签票代码，正式运行源和隔离宿主尚待交付。

### 验证与放行

本次只读核对正式课程详情，返回 HTTP 200，标题《测试一下》，售价 1 积分，版本允许 `CANVAS` 和 `VIBECODING`。在临时数据库上，分别用快学仓库和主站本机发布包的课程与 API 模块验证了已购签票、另一连接兑换、两类票据限用一次、未购拒绝、重开复用运行编号和撤权后旧票失效。测试使用临时工程响应，生产宿主和正式扣分还需联合验收。

正式运行源与桌面构建验通后，双方用指定学员验收《测试一下》的一次 1 积分购课。按同版本重试核对同一订单、原交易及合计只扣 1 分。打开学院画布和 VibeCoding，分别核对该版本的画布编排和预设提示词，关闭后重新进入原工程。未购账号进入两个入口均应返回 `403`。以 VibeCoding 工作台实际显示课程工程并能使用为通过条件。该轮只验购课与工作区，付费模型调用次数应为零。
