# 快学课堂 ZCode 4.0 接入与焦点修复

2026-11-24

## 上游基线

本次不再继续给旧灵动人 `0.2.27` 叠课程补丁，改用 ZCode 最新开源源码：

```text
repository: https://github.com/zai-org/ZCode
commit: a4b4445141eb7d3b3e99eada9292775383bfc44e
version: 4.0.0
```

最新上游已经包含初始工作区启动屏障、自动聚焦状态机、弹层焦点保护和新的
工作区/会话生命周期。课程客户端继续只提供课程权益、模型网关、原生目录桥和
课堂预设，不复制上游业务状态。

## 已确认根因

### React 实例分裂

课程入口位于快学仓库，原先从本仓库解析 React 18；ZCode UI 从上游源码解析 React 19。
Vite 产物因此同时包含两套 React。界面主体虽然能出现，但进入
`pptxElementReference` 子模块时，React dispatcher 为空：

```text
TypeError: Cannot read properties of null (reading 'useState')
```

错误边界随后占据聊天区域，表现为“页面能看见，但输入不可用”。

修复：

```text
resolve.dedupe = react, react-dom, react/jsx-runtime, react/jsx-dev-runtime
```

全部模块现在解析到上游同一套 React 19.2.7。

### 课程壳层重复抢焦点

旧入口在 ZCode 工作区之外自行轮询 80 次并调用 `editor.focus()`。最新 ZCode
已经由 `draftFocusVersion`、会话切换和挂载状态统一管理输入焦点；外层再聚焦会与
界面弹层、窗口激活和草稿恢复竞争。

修复：

- 删除课程入口的 `focusCourseComposer` 轮询。
- 由 ZCode 4.0 的 composer 自动聚焦状态机独占焦点。
- 保留原生目录/文件选择桥和课堂预设插入，不绕过 ZCode 的会话状态。

### 课程适配目标变化

ZCode 4.0 移除了旧版 `prepareWorkPreview` 和旧的供应商启动门禁调用。课程构建器
现已兼容 4.x：

- 关闭个人供应商登录启动门禁，课程权益和模型授权仍由快学服务校验。
- 保留原生目录选择，即使 `supportsSettings=false` 也不会退化成隐藏的临时项目。
- 课堂 HTML 预览通过 `openExternalFile` 接入受保护工程预览；远端文件仍不落到
  普通浏览器。
- 课堂提示词预设使用 4.0 的 `requestComposerTextInsert` 和
  `useComposerTextInsertApplied`，确认插入后才显示成功。

## 本机运行时

本机运行时同步改为上游 4.0：

```text
course-runtime.mjs
zcode.cjs
socket.cjs
```

新增 `@napi-rs/keyring` 的 Windows 原生依赖打包。ZCode 工作台仍只连接本机回环
WebSocket，课程素材和服务端接口继续走快学签名/鉴权。

## 验证

构建：

```text
Vite 8 production build: passed
Electron 41 x64 NSIS build: passed
installer exit code: 0
```

使用安装后的真实资源在隐藏窗口中验证：

```text
editorFound=true
5 秒后 editorActive=true
空闲焦点事件=0
输入“焦点诊断输入”成功
editorText=焦点诊断输入
```

这说明工作区不会再出现持续抢焦点或重复点击；用户切换窗口时的抢回焦点循环已移除。

全量测试：

```text
127/127 passed
```

## 制品

客户端：

```text
E:\快学课堂\release\classroom-official\Kuaixue-0.1.0-x64.exe
SHA-256: 4BF5CCABA3B8990C885B0E3C701B5865E3F5AA41C0AACE9001CB6C984FFDA80B
```

已静默安装到：

```text
E:\快学课堂vibe\kuaixue-desktop\快学课堂.exe
```

关键资源：

```text
app.asar SHA-256:
1077842D8A653406DA4393474FE77CF7E81D3DFEA9C504CF1F3576A8B7D413CB

vibe-course-web/index.html SHA-256:
FE908CC4D588CEF430646953842F0A84EA6AA29C022513B15E88D623EC16AFC1

vibe-local-runtime/course-runtime.mjs SHA-256:
11FB0C78D1B4C1113C783504349FDB178C150D6928BC52F5A6739C3BB3928A41
```

回滚备份：

```text
旧客户端安装包:
E:\快学课堂\release-artifacts\kuaixue-client-zcode-0.2.27-20261124\Kuaixue-0.1.0-x64.exe

旧 Web 资源:
E:\快学课堂\release\vibe-course-web.before-zcode4-20261124

旧本机运行时:
E:\快学课堂\release\vibe-local-runtime.before-zcode4-20261124
```

## 尚未验收

本次没有再次触发账号登录、真实 AI 对话或 42 积分视频生成。代码、安装包资源和
本地编辑器链路已通过；正式账号的真实模型请求和付费视频任务仍需在客户端中单独验收。
