# 快学课堂 RunningHub 模型键路由契约

2026-11-24

## 结论

执行键和计费键必须分开，不能统一成同一个值。

```text
executionKey = 渠道模型 ID
             用于 RunningHub 标准 OpenAPI 执行

billingKey  = providerModelKey
             用于主站报价、预扣、结算和积分规则
```

最典型的例子：

```text
模型：MiniMax-H3 多模态参考生视频
执行键：rh-minimax-h3-multi
计费键：minimax/hailuo-h3/multimodal-to-video
```

如果执行接口错误地使用：

```text
https://www.runninghub.cn/openapi/v2/minimax/hailuo-h3/multimodal-to-video
```

RunningHub 不会返回标准异步任务 `data.taskId`，客户端最终表现为：

```text
RunningHub 未返回 taskId
```

正确调用：

```text
POST https://www.runninghub.cn/openapi/v2/rh-minimax-h3-multi
```

## 三类路由

### 1. RunningHub 标准模型：图片、视频、音频、音乐

```text
执行路径：
POST /openapi/v2/{executionKey}

轮询路径：
POST /openapi/v2/query
```

执行请求只能使用 `executionKey`。计费请求只使用 `billingKey`：

```json
{
  "facts": {
    "modelKey": "minimax/hailuo-h3/multimodal-to-video",
    "providerModelKey": "minimax/hailuo-h3/multimodal-to-video"
  }
}
```

### 2. 文本模型

文本模型不是 RunningHub 异步任务，不能调用 `/openapi/v2/{model}`。

```text
POST /v1/chat/completions
```

国内或全球站点按渠道决定，模型字段使用文本模型 ID：

```json
{
  "model": "deepseek/deepseek-v4.1-flash",
  "messages": [
    {"role": "user", "content": "写一句标题"}
  ]
}
```

### 3. 主站工作流内部节点

主站工作流内部需要 provider/工作流配置时使用 `providerModelKey`。这不改变 RunningHub
标准 OpenAPI 的规则：

```text
主站工作流内部配置：provider key
RunningHub OpenAPI 执行：渠道模型 ID
```

两个调用面的键不能互相替代。

## 站点与密钥选择

```text
aicyld-runninghub-ai-media
aicyld-runninghub-llm-global
  → RunningHub AI 站点和 RUNNINGHUB_AI_API_KEY

aicyld-runninghub-llm-cn
  → RunningHub LLM 国内站点和 RUNNINGHUB_API_KEY

其它 RunningHub 渠道
  → RunningHub CN 站点和 RUNNINGHUB_API_KEY
```

标准 OpenAPI：

```env
KUAIXUE_RUNNINGHUB_BASE_URL=https://www.runninghub.cn/openapi/v2
KUAIXUE_RUNNINGHUB_AI_BASE_URL=https://www.runninghub.ai/openapi/v2
```

文本 OpenAI 兼容接口：

```env
KUAIXUE_RUNNINGHUB_LLM_BASE_URL=https://llm.runninghub.cn/v1
KUAIXUE_RUNNINGHUB_LLM_AI_BASE_URL=https://llm.runninghub.ai/v1
```

## 路由优先级

1. 从课程已发布模型绑定读取渠道模型 ID。
2. 去掉渠道前缀，只保留最后一个 `::` 后的模型 ID。
3. 先解析 `executionKey`。
4. 再解析 `billingKey = canvasBillingAliases[executionKey]`。
5. 没有别名时，`billingKey` 使用该模型在主站计费规则中的正式 key。
6. `modelLabel` 只用于显示，不能当作执行键或计费键。
7. 报价、预扣、结算和释放只传 `billingKey`。
8. RunningHub 标准模型请求只传 `executionKey`。

当前源码：

```text
apps/api/canvas-generation.mjs
  canvasBillingAliases
  canvasModelRoute
```

回归测试：

```text
tests/canvasGeneration.test.js
```

## 执行键到计费键映射

以下 52 项是当前需要改名的渠道模型。文本模型通常执行键与计费键相同，不在该表中。

### 图片

| executionKey | billingKey |
| --- | --- |
| `rh-seedream-v5-pro-t2i` | `seedream-v5-pro/text-to-image` |
| `rh-seedream-v5-pro-i2i` | `seedream-v5-pro/image-to-image` |
| `rh-seedream-v5.5-t2i` | `seedream-v5.5/text-to-image` |
| `rh-seedream-v5.5-i2i` | `seedream-v5.5/image-to-image` |
| `rh-seedream-v5.5-layer` | `seedream-v5.5/layer-decomposition` |
| `rh-minimax-h3-image-t2i` | `minimax/h3-image/text-to-image` |
| `rh-minimax-h3-image-edit` | `minimax/h3-image/image-edit` |
| `rh-midjourney-v8.1-t2i` | `youchuan/text-to-image-v81` |
| `rh-midjourney-v8.2-fast-t2i` | `youchuan/text-to-image-v8.2-fast` |
| `rh-midjourney-v8.2-turbo-t2i` | `youchuan/text-to-image-v8.2-turbo` |
| `rh-gpt-image-2.6-sunburst-i2i` | `rhart-image-g-2.6-official-token/sunburst/edit` |
| `rh-gpt-image-2.6-flare-i2i` | `rhart-image-g-2.6-official-token/flare/edit` |
| `rh-gpt-image-2.6-sunburst-t2i` | `rhart-image-g-2.6-official-token/sunburst/text-to-image` |
| `rh-gpt-image-2.6-flare-t2i` | `rhart-image-g-2.6-official-token/flare/text-to-image` |
| `rh-gpt-image-2.5-sunburst-i2i` | `rhart-image-g-2.5-official-token/sunburst/edit` |
| `rh-gpt-image-2.5-flare-i2i` | `rhart-image-g-2.5-official-token/flare/edit` |
| `rh-gpt-image-2.5-sunburst-t2i` | `rhart-image-g-2.5-official-token/sunburst/text-to-image` |
| `rh-gpt-image-2.5-flare-t2i` | `rhart-image-g-2.5-official-token/flare/text-to-image` |
| `rh-nano-banana-2.1-i2i` | `rhart-image-n-nb21-official/image-to-image` |
| `rh-nano-banana-2.1-t2i` | `rhart-image-n-nb21-official/text-to-image` |

### 视频

| executionKey | billingKey |
| --- | --- |
| `rh-seedance-2.5-multi` | `bytedance/seedance-2.5-token/multimodal-video` |
| `rh-seedance-2.5-t2v` | `bytedance/seedance-2.5-token/text-to-video` |
| `rh-seedance-2.5-i2v` | `bytedance/seedance-2.5-token/image-to-video` |
| `rh-seedance-2.5-flash-multi` | `bytedance/seedance-2.5-flash-token/multimodal-video` |
| `rh-seedance-2.5-flash-t2v` | `bytedance/seedance-2.5-flash-token/text-to-video` |
| `rh-seedance-2.5-flash-i2v` | `bytedance/seedance-2.5-flash-token/image-to-video` |
| `rh-seedance-2.0-multi` | `rhart-video/sparkvideo-2.0/multimodal-video` |
| `rh-seedance-2.0-t2v` | `rhart-video/sparkvideo-2.0/text-to-video` |
| `rh-seedance-2.0-i2v` | `rhart-video/sparkvideo-2.0/image-to-video` |
| `rh-seedance-2.0-fast-multi` | `rhart-video/sparkvideo-2.0-fast/multimodal-video` |
| `rh-seedance-2.0-fast-t2v` | `rhart-video/sparkvideo-2.0-fast/text-to-video` |
| `rh-seedance-2.0-fast-i2v` | `rhart-video/sparkvideo-2.0-fast/image-to-video` |
| `rh-seedance-2.0-mini-multi` | `rhart-video/sparkvideo-2.0-mini/multimodal-video` |
| `rh-seedance-2.0-mini-i2v` | `rhart-video/sparkvideo-2.0-mini/image-to-video` |
| `rh-minimax-h3-multi` | `minimax/hailuo-h3/multimodal-to-video` |
| `rh-minimax-h3-i2v` | `minimax/hailuo-h3/image-to-video` |
| `rh-kling-4-omni` | `kling-v4/omni-video` |
| `rh-kling-4-i2v` | `kling-v4/image-to-video` |
| `rh-kling-4-t2v` | `kling-v4/text-to-video` |
| `rh-kling-lipsync-video` | `kling-lip-sync/lip-sync-video` |
| `rh-kling-motion-v3-pro` | `kling-v3.0-pro/motion-control` |
| `rh-kling-v2-avatar-standard` | `kling-v2-ai-avatar-standard/image-audio-to-video` |
| `rh-wan-3-ref` | `alibaba/wan-3.0/reference-to-video` |
| `rh-wan-3-i2v` | `alibaba/wan-3.0/image-to-video` |
| `rh-wan-3-t2v` | `alibaba/wan-3.0/text-to-video` |
| `rh-video-upscale` | `rhart-video/video-upscaler` |
| `rh-muse-video-economy` | `meta/muse-video/economy` |

### 音频与音乐

| executionKey | billingKey |
| --- | --- |
| `rh-kling-lipsync-tts` | `kling-lip-sync/tts` |
| `rh-speech-2.8-hd` | `rhart-audio/text-to-audio/speech-2.8-hd` |
| `rh-speech-2.8-turbo` | `rhart-audio/text-to-audio/speech-2.8-turbo` |
| `rh-mureka-v9-bgm` | `mureka-ai/mureka-v9/generate-bgm` |
| `rh-mureka-v9-song` | `mureka-ai/mureka-v9/generate-song` |

## MiniMax-H3 请求示例

执行：

```http
POST https://www.runninghub.cn/openapi/v2/rh-minimax-h3-multi
Authorization: Bearer <RUNNINGHUB_API_KEY>
Content-Type: application/json
```

执行请求体必须按主站生产预览中的 H3 schema 构造。课程内部参数
`aspectRatio / durationSeconds / audio` 不能原样发送给 RunningHub：

| 课程内部字段 | H3 执行字段 |
| --- | --- |
| `aspectRatio` | `ratio` |
| `durationSeconds` | `duration`，字符串 |
| `audio` | `generateAudio`，布尔值 |

以下字段不得发送给 H3：

```text
aspectRatio
durationSeconds
audio
audioRole
inputMode
title
```

正确请求体：

```json
{
  "prompt": "猴子跳起来",
  "ratio": "adaptive",
  "resolution": "768P",
  "duration": "5",
  "generateAudio": false,
  "imageUrls": [
    "https://aicyld.com.cn/api/v1/course-assets/<asset-id>?expires=<unix>&signature=<sig>"
  ],
  "clientId": "<jobId>"
}
```

`imageUrls`、`videoUrls`、`audioUrls` 按参考素材类型分组。
课程私有素材必须先转换为短期公网签名 URL。

期望响应：

```json
{
  "code": 0,
  "data": {
    "taskId": "<runninghub-task-id>",
    "status": "QUEUED"
  }
}
```

报价与预扣仍使用课程内部参数，不跟随执行字段改名：

```json
{
  "userId": "<userId>",
  "facts": {
    "modelKey": "minimax/hailuo-h3/multimodal-to-video",
    "providerModelKey": "minimax/hailuo-h3/multimodal-to-video",
    "category": "video",
    "aspectRatio": "adaptive",
    "resolution": "768P",
    "durationSeconds": 5,
    "generateAudio": false,
    "outputCount": 1,
    "batchCount": 1
  }
}
```

## 验收用例

1. H3 报价请求中的 `modelKey` 是 provider key，不是 `rh-minimax-h3-multi`。
2. H3 执行 HTTP 路径包含 `rh-minimax-h3-multi`，不包含
   `minimax/hailuo-h3/multimodal-to-video`。
3. 执行响应必须取得 `data.taskId` 后才进入 query 轮询。
4. query 使用同一站点和同一组 RunningHub API Key。
5. 任务成功后结算使用预扣 `holdId`，不修改执行模型键。
6. 任务失败或执行异常必须释放原预扣。
7. 文本模型不能进入 `/openapi/v2`。
8. 图片、视频、音频、音乐和文本五类路由均需有自动测试。

## 禁止事项

- 不得用中文显示名调用 RunningHub。
- 不得用 `providerModelKey` 拼接 RunningHub 标准 OpenAPI 路径。
- 不得把 `executionKey` 写入积分规则。
- 不得把 `billingKey` 写进 RunningHub 执行路径。
- 不得根据失败响应猜测并自动重复执行，避免重复扣费。
