// qq-sticker 宿主半身：给设置界面提供 HTTP 路由（挂在自己的前缀下）。
// 客户端半身（设置页）通过同源请求访问这些路由，不需要额外鉴权——
// 它们只操作本机的表情缓存和已配置的 OneBot 网关。
import { loadConfig, saveConfig, syncStickers, listStickers, sendSticker, addSticker, renameSticker, deleteSticker, downloadImage, cdnCandidates, loadCache } from '../src/core.mjs';

export const name = 'qq-sticker';
export const inject = ['webServer'];

function json(res, code, data) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  try { return JSON.parse(body || '{}'); } catch { return {}; }
}

export function apply(ctx) {
  const webServer = ctx.get('webServer');
  if (!webServer) {
    console.error('[qq-sticker] 没有 webServer，设置页接口不可用');
    return;
  }

  const disposer = webServer.register({
    kind: 'prefix',
    path: '/api/qq-sticker',
    handler: async (req, res) => {
      const url = new URL(req.url, 'http://localhost');
      const route = url.pathname.replace(/^\/api\/qq-sticker/, '') || '/';

      try {
        // 列表
        if (req.method === 'GET' && route === '/list') {
          const data = listStickers({
            query: url.searchParams.get('query') || '',
            limit: url.searchParams.get('limit') || 60
          });
          json(res, 200, { ok: true, ...data });
          return;
        }
        // 缩略图：把图片代理出来，避免浏览器直连 QQ CDN 的跨域/防盗链
        if (req.method === 'GET' && route === '/image') {
          const id = url.searchParams.get('id') || '';
          const entry = loadCache().find((e) => e.id === id);
          if (!entry) { json(res, 404, { ok: false, error: '没有这个表情' }); return; }
          const urls = [entry.url, ...cdnCandidates(entry.id)].filter(Boolean);
          for (const u of urls) {
            try {
              const buf = await downloadImage(u);
              res.writeHead(200, { 'content-type': 'image/gif', 'cache-control': 'public, max-age=3600' });
              res.end(buf);
              return;
            } catch { /* 试下一个 */ }
          }
          json(res, 502, { ok: false, error: '表情图片取不到' });
          return;
        }
        // 同步
        if (req.method === 'POST' && route === '/sync') {
          const r = await syncStickers();
          json(res, 200, { ok: true, ...r });
          return;
        }
        // 添加一张新表情到 QQ 收藏（可带备注）
        if (req.method === 'POST' && route === '/add') {
          const body = await readJson(req);
          const r = await addSticker({ imageBase64: body.imageBase64, url: body.url, localPath: body.localPath, filename: body.filename, desc: body.desc });
          json(res, 200, { ok: true, ...r });
          return;
        }
        // 改备注（自动名不对时一键换掉）
        if (req.method === 'POST' && route === '/rename') {
          const body = await readJson(req);
          const r = await renameSticker({ emojiId: body.emojiId, desc: body.desc });
          json(res, 200, { ok: true, ...r });
          return;
        }
        // 删除一张收藏表情
        if (req.method === 'POST' && route === '/delete') {
          const body = await readJson(req);
          const r = await deleteSticker({ emojiId: body.emojiId });
          json(res, 200, { ok: true, ...r });
          return;
        }
        // 发送
        if (req.method === 'POST' && route === '/send') {
          const body = await readJson(req);
          const r = await sendSticker(body);
          json(res, 200, { ok: true, ...r });
          return;
        }
        // 读设置
        if (req.method === 'GET' && route === '/settings') {
          json(res, 200, { ok: true, settings: loadConfig() });
          return;
        }
        // 改设置
        if (req.method === 'POST' && route === '/settings') {
          const body = await readJson(req);
          const patch = {};
          if (body.onebot) patch.onebot = { ...loadConfig().onebot, ...body.onebot };
          if (body.send) patch.send = { ...loadConfig().send, ...body.send };
          if (body.sync) patch.sync = { ...loadConfig().sync, ...body.sync };
          json(res, 200, { ok: true, settings: saveConfig(patch) });
          return;
        }
        json(res, 404, { ok: false, error: `未知路由 ${route}` });
      } catch (error) {
        json(res, 500, { ok: false, error: String(error?.message ?? error) });
      }
    }
  });

  ctx.on('dispose', () => { try { disposer?.(); } catch {} });
}

export const __test = { loadConfig, saveConfig };
