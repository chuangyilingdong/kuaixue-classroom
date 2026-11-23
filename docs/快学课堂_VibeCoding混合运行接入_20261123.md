# 快学课堂 VibeCoding 混合运行接入

## 客户端行为

- 进入已购 VibeCoding 课程后，客户端先请求本机运行授权。
- 本机已有同一课程版本工程时，优先恢复本机工程。
- 云端已有学习进度、但本机尚无工程时，系统自动尝试恢复工程快照。
- 本机运行失败、授权不可用或运行器启动失败时，客户端自动使用现有云端工作区。
- 学员界面只显示统一工作台，不展示本机/云端、切换或手动同步。

## 主站接口

客户端已调用：

```http
POST /api/v1/course-runs/local-runtime
Cookie: kuaixue_session=...
Content-Type: application/json
Origin: kuaixue://classroom

{"id":"课程运行 ID"}
```

成功返回：

```json
{
  "data": {
    "runId": "课程运行 ID",
    "userId": "当前用户 ID",
    "presets": [
      {"title": "课程预设", "text": "本机执行提示词"}
    ],
    "modelGateway": {
      "baseUrl": "https://aicyld.com.cn/model-gateway/v1",
      "token": "短期课程模型令牌",
      "modelIds": ["glm-5.3-flash"],
      "expiresAt": 1795446000000
    }
  }
}
```

约束：

- 必须校验当前登录用户确实拥有该运行实例对应的已购版本。
- 只允许课程版本 `vibeModelIds` 中的模型。
- `token` 必须是短期、课程运行绑定、可撤销的令牌，不能下发主站长期密钥。
- `userId` 必须与当前会话用户一致。
- 未接入本机授权时返回 `503`，客户端会回退云端。

## 本机运行栈

- Electron 主进程启动本地 `course-runtime.mjs`。
- 本机只监听 `127.0.0.1` 随机端口，使用随机 RPC 令牌。
- Agent、文件读写、Skill 和 MCP 在本机执行。
- Browser Use 通过本机已安装 Chrome 或 Edge 启动 headless 浏览器。
- Excel、Word、PPT、PDF 使用 ZCode 自带官方插件，不按文件类型切换运行环境。
- 本机工程位于 `app.getPath('userData')/vibe-projects/{courseUserVersionHash}/workspace`。
- 关闭窗口时停止运行器并清理临时 profile，不删除工程文件。

## 已验证

- 本机工作台加载。
- 课程模型出现在模型选择器中。
- Agent 在本地返回一轮响应。
- `ToolSearch → DeferredToolCall → node_repl js` 链路可用。
- Browser Use 打开本机测试页、读取标题和正文并截图。
- 关闭后重新打开，恢复同一工程目录。

## 商用前剩余项

本机工程快照上传、下载恢复和换电脑续作尚未接入主站。接口建议使用独立二进制快照端点，保存整个工程目录而不是单个 `index.html`。在完成该项前，本机作品只在当前电脑持久化；云端模式继续保留作为回退。
