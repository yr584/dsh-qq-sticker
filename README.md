# dsh-qq-sticker

给 DeepSeek Harness 接入的 QQ 机器人加**表情包能力**：同步账号收藏表情、按情绪检索、以图片消息发出去，附带一个可视化设置页。
适用于任何 OneBot v11 网关（SnowLuma / NapCat / LLOneBot 等），**不依赖 qq-bridge**。

## 它解决什么

OneBot 没有"发收藏表情"的标准 action，但收藏表情本质就是一张图——发 `image` 段就是发表情包。
难点在另外三件事：**拿到收藏列表**、**把表情 id 变成可下载的图**、**让模型知道什么时候该发哪个**。

这个插件把这三件事做成工具交给模型，并给了一个管理界面。

## 安装

```bash
dsh plugin --profile desktop add dsh-qq-sticker
# 或本地开发：pnpm add link:/path/to/dsh-qq-sticker
```

装完**重启一次 DSH**（宿主半身和 MCP 行只在启动时挂载）。

> MCP 的启动路径由插件内置的 `-e` 启动器**在运行时解析**（依次尝试 cwd、`$DSH_HOME/profiles/desktop`、
> `$DSH_HOME/profiles/web`），所以**不需要任何 postinstall**，也不受 pnpm 11 忽略 build script 的影响。

## 配置

首次使用前创建 `~/.dsh/qq-sticker/config.json`：

```json
{
  "onebot": { "url": "http://127.0.0.1:3000", "token": "你的 access token" },
  "sync": { "count": 100 },
  "send": { "maxPerMinute": 6, "autoProbability": 0 },
  "autoDesc": {
    "enabled": true,
    "baseUrl": "https://api.siliconflow.cn/v1",
    "apiKey": "sk-...",
    "model": "Qwen/Qwen3-VL-8B-Instruct"
  }
}
```

- `onebot.url` / `onebot.token`：网关地址与 access token
- `autoDesc`：可选。配了才会用视觉模型自动起名（不配就用文件名/编号兜底）
- 表情缓存：`~/.dsh/qq-sticker/stickers.json`

## 工具（给模型用）

| 工具 | 作用 |
| --- | --- |
| `sticker_sync` | 拉取账号收藏表情，合并进本地库 |
| `sticker_list` | 按备注/id 搜索，返回 id + 备注（命中梗库的还带用法） |
| `sticker_send` | 发到群或好友；表情是单独气泡，不能和文字合并 |
| `sticker_delete` | 从 QQ 收藏里删除一张 |
| `meme_lookup` | 查梗：本地 6668 条词库优先，没收录才联网 |

## 设置页

**设置 → 表情包**：

- 图库九宫格（缩略图走宿主代理，不会踩 QQ CDN 防盗链）
- 点一张 → 发送到指定群/好友，或删除
- 添加表情：网络地址 / 本地图片（≤5 MB）/ 本机路径（宿主直读）
- 不填备注时自动起名：文件名 → 视觉模型 → 梗库比对，并给备选名一键更换
- 两个滑块：每分钟上限、主动使用概率（目前只写配置，运行时限流待实现）

## 已知限制

- 网关必须支持 `fetch_custom_face_detail`，否则 `sticker_sync` 会报"返回不是数组"
- 没有 url 的表情会按 `emoji_id` 推导 QQ CDN 地址（`gxh.vip.qq.com`），个别表情仍可能 404
- 连发表情会触发 QQ 风控，建议自制频率上限
- 梗库（6668 条，MIT）来自 [astrbot_plugin_memewiki](https://github.com/in1t1a1/astrbot_plugin_memewiki)，随仓库分发时请一并保留其许可

## License

MIT
