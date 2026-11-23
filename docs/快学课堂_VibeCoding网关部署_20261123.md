# 快学 VibeCoding 服务器部署与验收

2026-11-23。本包用于正式账号购课、双工作区、原版 VibeCoding 插件/技能和作品工程预览。工作台可读取课堂预设、打开和保存工程；运行镜像包含与服务端/界面一致的 ZCode 0.16.9、Browser Use、Node REPL、Office/PDF 工具、Chromium 和中文渲染环境。模型仍只经课程模型网关计费，浏览器使用独立出站网络。

## 主站运维安装

解开服务器交付包，先执行 `sha256sum -c SHA256SUMS`。以下操作在解包目录内由生产运维执行。准备 systemd、Python 3、Linux Docker 以及支持 `node:sqlite` 的 Node 24。服务文件默认 Node 路径为 `/usr/bin/node`，部署时按本机实际路径调整。宿主镜像针对 Linux AMD64，镜像内含 Node 运行时。

```sh
getent group kuaixue-vibe >/dev/null || groupadd --system kuaixue-vibe
id -u kuaixue-vibe >/dev/null 2>&1 || useradd --system -g kuaixue-vibe --no-create-home --shell /usr/sbin/nologin kuaixue-vibe
install -d -m 0755 /opt/kuaixue-vibe /etc/kuaixue-vibe
install -d -o root -g kuaixue-vibe -m 0750 /var/lib/kuaixue-vibe /var/lib/kuaixue-vibe/hosts
install -m 0644 gateway.cjs nginx-preview.conf /opt/kuaixue-vibe/
install -m 0755 provision-host.py /opt/kuaixue-vibe/
install -m 0644 kuaixue-vibe.service kuaixue-vibe.socket /etc/systemd/system/
docker load --input host-image-full.tar
```

在 `/etc/kuaixue-vibe/gateway.env` 写入两项。`KUAIXUE_COURSE_DB` 应复制主站现有课程服务使用的绝对路径。`KUAIXUE_RUNTIME_TICKET_DB=/var/lib/kuaixue-runtime-tickets/tickets.sqlite` 已与签票方约定。

给 `kuaixue-vibe` 账号课程数据库及 SQLite `-shm`、`-wal` 的只读权限和父目录遍历权限。票据库单独授权，账号须可读写数据库、目录及未来创建的 WAL/SHM 文件，建议通过文件 ACL 和目录默认 ACL 保留主站签票服务现有权限。可用 `runuser -u kuaixue-vibe -- /usr/bin/node -e "require('node:sqlite')"` 核对运行时。网关通过 systemd 接收监听描述符，Nginx 的 `www-data` 组可连接 `/run/kuaixue-vibe/gateway.sock`。

工程预览依赖 Nginx 把 `/kuaixue/runtime/preview/` 转发到同一网关。将包内 `nginx-preview.conf` 合入 `kuaixue-vibe.aicyld.com.cn` 的 HTTPS server 块并执行 `nginx -t && systemctl reload nginx`。预览路径与工作台同源，里面每个文件请求都会重新校验课程权益；不要把该路径改成静态目录。

工作台位于包内 `workbench/`。先发布 `assets/` 等依赖，最后替换 `index.html`。保留旧版本资源供仍在线的窗口使用。

```sh
WEB=/srv/aicyld/kuaixue-vibe/public/kuaixue/workbench
install -d -m 0755 "$WEB"
rsync -a --exclude=/index.html workbench/ "$WEB/"
install -m 0644 workbench/index.html "$WEB/.index.html.new"
mv -f "$WEB/.index.html.new" "$WEB/index.html"
systemctl daemon-reload
systemctl enable --now kuaixue-vibe.socket
```

## 为 Dnins 准备工程

请主站从已登录账户记录取得 Dnins 的稳定 `userId`。把下列 `USER_ID` 替换成该值。工程可以提前准备，进入时仍按正式已购版本核对。脚本可重复执行，学员文件持久保存在服务器的 `workspace` 目录。容器内工作路径为 `/workspace`。已有同名容器会复用。

```sh
/opt/kuaixue-vibe/provision-host.py USER_ID 0477cad8-48ff-4737-b06f-a814220ed466 c5d22c57-dcbf-4672-a632-be4037f7770c
```

学员进程以容器内普通 UID 1000 运行，独占工程与私有通信目录。只有网关读课程库和票据库。网关账号不需要 Docker 权限。定期备份 `/var/lib/kuaixue-vibe/hosts` 的学员工程目录。凭据和账户信息走私密渠道。

首次创建工程时，脚本会建立 `kuaixue-vibe-egress` Docker bridge，并关闭容器间通信。该网络允许 Browser Use 访问公网，但不发布任何入站端口。生产主机还必须在 Docker `DOCKER-USER` 链禁止容器访问内网网段、Docker socket、云元数据地址和除模型网关外的内部服务。

默认每工程限额为 2 GiB 内存、2 CPU、512 进程；可通过 `KUAIXUE_VIBE_MEMORY`、`KUAIXUE_VIBE_CPUS`、`KUAIXUE_VIBE_PIDS` 调整。容量规划必须按 Chromium 与 LibreOffice 同时运行的峰值计算，不能沿用旧版 768 MiB 限额。

## 验收与回退

1. 匿名 `GET https://kuaixue-vibe.aicyld.com.cn/kuaixue/workbench/` 应返回工作台 HTML，引用的 JS 和 CSS 均应可读。带同源 Origin 的 `POST /kuaixue/runtime/exchange` 发送空 JSON 应返回 `403`。`503` 表示仍未接通，查 `journalctl -u kuaixue-vibe.service` 以及课程库、票据库和宿主的权限。
2. 利用对应的快学 Windows 联验包，由 Dnins 使用原快学会话购课并进入两个工作区。VibeCoding 应显示该版本的预设，关闭后重开能找回原工程。未购账号访问两个模式均应得到 `403`。按原订单确认总扣分为 1。
3. 运行 `docker run --rm kuaixue-vibe-host:20261123-full node /opt/kuaixue/zcode.cjs plugins list --json`，确认 Browser Use、文档、PDF、演示、表格和 Node REPL 均启用；`skills list --json` 必须包含 `browser-use:control-browser`。
4. 使用隔离模型驱动 Browser Use，打开本地测试页，返回标题和正文并生成截图。随后从作品卡片打开一个带相对 JS/CSS 的 HTML 工程，确认网络面板只有 `/kuaixue/runtime/preview/` 请求且资源全部为 `200`。
5. 本地 Linux 验证已从 Unix socket 换票，经 WebSocket 与真实 ZCode RPC 读写工程，重新进入读回原内容，撤权使现有连接关闭。正式服务器 systemd 权限、实际桌面内界面及生产账务待现场验收。
6. 回退时先关闭本轮销售，停止 `kuaixue-vibe.socket` 和 `kuaixue-vibe.service`，将工作台切换至运维保留的前一版。按需停止该批工程容器，保留持久化工程和订单数据。
