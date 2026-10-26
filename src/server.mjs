#!/usr/bin/env node
// qq-sticker MCP server（stdio，零依赖，手写 JSON-RPC 2.0）。
// 业务逻辑全在 src/core.mjs，这里只做协议适配。
import readline from 'node:readline';
import { syncStickers, listStickers, sendSticker, deleteSticker, lookupMeme, CONFIG_FILE } from './core.mjs';

const TOOLS = [
  {
    name: 'sticker_sync',
    description: '把这个 QQ 账号的收藏表情同步到本地库（走网关 fetch_custom_face_detail）。第一次用或收藏有新增时调用。',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'sticker_list',
    description: '列出/搜索本地表情库。query 按备注和 id 模糊匹配（比如"无语""笑"），limit 默认 20。发送前先用它挑 id。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索词，可空' },
        limit: { type: 'number', description: '最多返回几条，默认 20' }
      }
    }
  },
  {
    name: 'sticker_send',
    description: '把一张收藏表情作为图片消息发到群或好友。表情是单独一条气泡，不能和文字合并；需要同时说话请另发文字。',
    inputSchema: {
      type: 'object',
      properties: {
        targetType: { type: 'string', enum: ['group', 'private'], description: '发到群还是私聊' },
        targetId: { type: 'string', description: '群号或 QQ 号' },
        stickerId: { type: 'string', description: 'sticker_list 返回的 id' },
        text: { type: 'string', description: '可选：同时附一句文字（作为同一消息的第一段）' }
      },
      required: ['targetType', 'targetId', 'stickerId']
    }
  },
  {
    name: 'meme_lookup',
    description: '查网络梗/黑话是什么意思、怎么用（本地 6668 条词库优先，没收录才联网查 cnmeme.wiki）。群里有人说你不懂的梗时用；返回里 usage 是"怎么接"，origin 是来历。',
    inputSchema: {
      type: 'object',
      properties: {
        term: { type: 'string', description: '要查的词，比如"典中典""急了""杂鱼杂鱼"' }
      },
      required: ['term']
    }
  },
  {
    name: 'sticker_delete',
    description: '从 QQ 收藏里删掉一张表情（不可撤销）。用户明确说要删哪张时才用，删之前先确认备注名对得上。',
    inputSchema: {
      type: 'object',
      properties: {
        stickerId: { type: 'string', description: 'sticker_list 返回的 id' }
      },
      required: ['stickerId']
    }
  }
];

async function callTool(name, args) {
  switch (name) {
    case 'sticker_sync': return syncStickers();
    case 'sticker_list': return listStickers(args);
    case 'sticker_send': return sendSticker(args);
    case 'sticker_delete': return deleteSticker({ emojiId: args?.stickerId });
    case 'meme_lookup': return lookupMeme(args?.term);
    default: throw new Error(`未知工具：${name}`);
  }
}

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', async (line) => {
  const text = line.trim();
  if (!text) return;
  let req;
  try { req = JSON.parse(text); } catch { return; }
  const { id, method, params } = req;
  if (method === 'notifications/initialized' || method === 'initialized') return;
  try {
    if (method === 'initialize') {
      send({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'qq-sticker', version: '0.2.0' }
        }
      });
      return;
    }
    if (method === 'ping') { send({ jsonrpc: '2.0', id, result: {} }); return; }
    if (method === 'tools/list') { send({ jsonrpc: '2.0', id, result: { tools: TOOLS } }); return; }
    if (method === 'tools/call') {
      try {
        const result = await callTool(params?.name, params?.arguments || {});
        send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(result) }] } });
      } catch (error) {
        send({
          jsonrpc: '2.0',
          id,
          result: { content: [{ type: 'text', text: `执行失败：${error?.message ?? error}` }], isError: true }
        });
      }
      return;
    }
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: `不支持的 method: ${method}` } });
  } catch (error) {
    send({ jsonrpc: '2.0', id, error: { code: -32603, message: String(error?.message ?? error) } });
  }
});

process.stderr.write(`[qq-sticker] ready, config: ${CONFIG_FILE}\n`);
