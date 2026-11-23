# 快学课堂 RunningHub 部署与登录复核

2026-11-24 00:45（北京时间）

## 视频路由

生产课程服务已从未显式执行键的 `00:27` 版本切换到用户提供的
`kuaixue-service-runninghub-key-contract-20261124-0029` 候选包。

```text
候选包 SHA-256:
ea3c6b6935991650f8366a9680ec34e42604f1ad5f21fae5efc9454a38d16cee

生产 release:
/srv/aicyld/releases/kuaixue-service-runninghub-key-contract-20261124-0029/release
```

生产代码已包含：

```text
canvasExecutionAliases['rh-minimax-h3-multi'] = 'rh-minimax-h3-multi'
canvasBillingAliases['rh-minimax-h3-multi'] = 'minimax/hailuo-h3/multimodal-to-video'
```

健康检查返回 `200`，主进程 `NRestarts=0`。

旧 release 保留在：

```text
/srv/aicyld/releases/kuaixue-service-runninghub-key-contract-20261124-0029/release.before-current
```

## RunningHub egress

部署复核发现 `www.runninghub.cn` 新增解析地址 `175.12.122.167`。
课程服务原有 systemd egress 白名单未包含该地址，在相同网络限制下实测超时。
现已加入：

```text
IPAddressAllow=175.12.122.167/32
```

当前 5 个 RunningHub CN 地址在同样 egress 限制下均返回 `200`。

配置变更前文件保留在：

```text
/srv/aicyld/releases/kuaixue-service-runninghub-key-contract-20261124-0029/rollback/70-runninghub-egress.conf.before-cdn-20261124
```

## 截图中的旧视频任务

生产数据库中的失败截图对应任务仍记录旧执行键：

```text
quotePoints = 42
executionModelKey = minimax/hailuo-h3/multimodal-to-video
status = submitted
```

该任务发生在 `00:27` 新服务部署之前。本次没有再次触发 42 积分生成，
因此视频生成、结算和作品显示仍需账号本人使用正式账号复测一次。

主站计费库已核对同一任务：

```text
status = refunded
reservedPoints = 42
settledPoints = 0
refundedPoints = 42
reason = RunningHub 未返回任务编号
```

旧预扣已完整退回，没有残留 42 积分占用。

## VibeCoding 二次登录

Nginx 日志显示客户端在 `00:32` 至 `00:34` 多次加载
`/kuaixue/sign-in/`，因此该页面是快学客户端的桌面账号授权页，
不是 Vibe 自带的模型供应商登录页。

客户端原先没有单实例锁。重复双击桌面快捷方式会启动第二套客户端，
第二套实例进入未登录状态后再次打开 `/kuaixue/sign-in/`，表现类似
“进入工作区后又弹出另一个登录窗口”。本版新增单实例锁：第二次启动只恢复、
显示并聚焦已有窗口。

复测结果：

```text
第一次启动：1 个客户端主进程
第二次启动：启动进程自动退出
第二次启动后：仍为 1 个客户端主进程
```

新客户端已安装并启动：

```text
E:\快学课堂\release\classroom-official\Kuaixue-0.1.0-x64.exe
SHA-256:
5B21D73903498458695F2BD960342625D8A85514A80E355C54D2407E574542E2
```

若已完成单实例复测后仍出现二次登录，需要继续定位：

1. 首次进入工作区前，`/api/v1/me` 或课程运行接口是否返回 `401`。
2. 桌面换票成功后，`kuaixue_session` 是否写入默认 Electron session。
3. Vibe 工作区是否在会话失效时退回主站登录视图。
