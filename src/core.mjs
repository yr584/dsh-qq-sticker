// qq-sticker 核心逻辑（宿主半身和 MCP 服务共用，零依赖）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
export const DATA_DIR = path.join(HOME, 'qq-sticker');
export const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
export const CACHE_FILE = path.join(DATA_DIR, 'stickers.json');
export const MEMES_DB = path.join(DATA_DIR, 'memes.db');
const MAX_BYTES = 8 * 1024 * 1024;

const DEFAULTS = {
  onebot: { url: 'http://127.0.0.1:3000', token: '' },
  sync: { count: 100 },
  send: { maxPerMinute: 6, autoProbability: 0 }
};

export function loadConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    return {
      ...DEFAULTS,
      ...raw,
      onebot: { ...DEFAULTS.onebot, ...(raw.onebot || {}) },
      sync: { ...DEFAULTS.sync, ...(raw.sync || {}) },
      send: { ...DEFAULTS.send, ...(raw.send || {}) }
    };
  } catch {
    return JSON.parse(JSON.stringify(DEFAULTS));
  }
}

export function saveConfig(patch) {
  const next = { ...loadConfig(), ...patch };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2));
  return next;
}

export function loadCache() {
  try {
    const j = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    return Array.isArray(j.entries) ? j.entries : [];
  } catch {
    return [];
  }
}

function saveCache(entries) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify({ updatedAt: Date.now(), entries }, null, 2));
}

export async function onebot(action, params) {
  const cfg = loadConfig();
  const url = String(cfg.onebot.url || '').replace(/\/+$/, '');
  if (!url) throw new Error(`还没配置 OneBot 地址：请写 ${CONFIG_FILE}`);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cfg.onebot.token ? { authorization: `Bearer ${cfg.onebot.token}` } : {})
    },
    body: JSON.stringify({ action, params: params || {} }),
    signal: AbortSignal.timeout(20000)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || (data.status && data.status !== 'ok') || (data.retcode !== undefined && data.retcode !== 0)) {
    throw new Error(`OneBot ${action} 失败：${data.wording || data.message || data.retcode || res.status}`);
  }
  return data.data ?? data;
}

export function cdnCandidates(emojiId) {
  const id = String(emojiId || '').trim();
  if (!/^[0-9a-f]{16,64}$/i.test(id)) return [];
  return [`https://gxh.vip.qq.com/club/item/parcel/item/${id.slice(0, 2)}/${id}/raw300.gif`];
}

export function looksLikeImage(buf) {
  if (!buf || buf.length < 8) return false;
  const png = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  const jpg = buf[0] === 0xff && buf[1] === 0xd8;
  const gif = buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46;
  const webp = buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf[8] === 0x57;
  return png || jpg || gif || webp;
}

export async function downloadImage(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000), redirect: 'follow' });
  if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error(`图片太大（${buf.length} 字节）`);
  if (!looksLikeImage(buf)) throw new Error('下载到的不是图片');
  return buf;
}

function normalizeEntry(raw) {
  return {
    id: String(raw.emoji_id ?? raw.emojiId ?? raw.id ?? '').trim(),
    url: String(raw.url ?? raw.emoji_url ?? '').trim(),
    desc: String(raw.desc ?? raw.summary ?? raw.emoji_desc ?? '').trim(),
    md5: String(raw.md5 ?? raw.emoji_md5 ?? '').trim()
  };
}

export async function syncStickers() {
  const cfg = loadConfig();
  const count = Math.max(1, Math.min(500, Number(cfg.sync.count) || 100));
  const data = await onebot('fetch_custom_face_detail', { count });
  if (!Array.isArray(data)) throw new Error('网关返回的收藏表情不是数组（可能不支持 fetch_custom_face_detail）');
  const fetched = data.map(normalizeEntry).filter((e) => e.id || e.url);
  const merged = new Map();
  for (const e of loadCache()) if (e.id) merged.set(e.id, e);
  for (const e of fetched) if (e.id) merged.set(e.id, { ...merged.get(e.id), ...e, syncedAt: Date.now() });
  const entries = [...merged.values()];
  saveCache(entries);
  return { fetched: fetched.length, total: entries.length };
}

export function listStickers({ query = '', limit = 20 } = {}) {
  const entries = loadCache();
  const q = String(query || '').trim().toLowerCase();
  const hit = entries.filter((e) => (q ? `${e.desc} ${e.id}`.toLowerCase().includes(q) : true));
  const n = Math.max(1, Math.min(100, Number(limit) || 20));
  return {
    total: entries.length,
    matched: hit.length,
    items: hit.slice(0, n).map((e) => ({
      id: e.id,
      desc: e.desc || '(无备注)',
      url: e.url || '',
      hasUrl: Boolean(e.url),
      // 梗库命中过的表情带上"这梗怎么用"，模型挑表情时能顺带接梗
      ...(e.wiki?.usage ? { wikiUsage: String(e.wiki.usage).replace(/\s+/g, ' ').slice(0, 140) } : {})
    }))
  };
}

export async function sendSticker({ targetType, targetId, stickerId, text } = {}) {
  const type = String(targetType || '').toLowerCase();
  if (type !== 'group' && type !== 'private') throw new Error('targetType 必须是 group 或 private');
  const id = String(targetId || '').trim();
  if (!/^\d+$/.test(id)) throw new Error('targetId 必须是数字');
  const key = String(stickerId || '').trim();
  const entry = loadCache().find((e) => e.id === key || e.md5 === key || (e.desc && e.desc === key));
  if (!entry) throw new Error(`没有这个表情：${key}（先同步/刷新一下）`);

  const urls = [entry.url, ...cdnCandidates(entry.id)].filter(Boolean);
  let buf = null;
  let lastErr = null;
  for (const u of urls) {
    try { buf = await downloadImage(u); break; } catch (e) { lastErr = e; }
  }
  if (!buf) throw new Error(`表情图片下载失败：${lastErr?.message ?? '地址无效'}`);

  const message = [];
  if (text) message.push({ type: 'text', data: { text: String(text) } });
  message.push({ type: 'image', data: { file: 'base64://' + buf.toString('base64') } });

  const action = type === 'group' ? 'send_group_msg' : 'send_private_msg';
  const params = type === 'group' ? { group_id: Number(id), message } : { user_id: Number(id), message };
  const sent = await onebot(action, params);
  return { sent: true, messageId: sent?.message_id ?? null, bytes: buf.length };
}

// 把一张图加进 QQ 收藏表情（add_custom_face），可顺带写备注。
// 入参三选一：imageBase64（dataURL/纯 base64）、url（宿主下载）、localPath（宿主读本机文件）。
// filename 可选：本地图片模式下浏览器只给得到文件名，用它参与"自动备注"的第一步。
export async function addSticker({ imageBase64, url, localPath, filename, desc } = {}) {
  let buf = null;
  if (imageBase64) {
    const b64 = String(imageBase64).replace(/^data:[^;]+;base64,/, '');
    buf = Buffer.from(b64, 'base64');
  } else if (url) {
    buf = await downloadImage(String(url));
  } else if (localPath) {
    const p = String(localPath).trim().replace(/^"|"$/g, '');
    if (!fs.existsSync(p)) throw new Error(`本机文件不存在：${p}`);
    const stat = fs.statSync(p);
    if (stat.size > MAX_BYTES) throw new Error(`文件太大（${Math.round(stat.size / 1024)} KB，上限 ${Math.round(MAX_BYTES / 1024)} KB）`);
    buf = fs.readFileSync(p);
  } else {
    throw new Error('需要提供 imageBase64 / url / localPath');
  }
  if (!buf || !buf.length) throw new Error('图片内容为空');
  if (buf.length > MAX_BYTES) throw new Error(`图片太大（${buf.length} 字节，上限 ${MAX_BYTES}）`);
  if (!looksLikeImage(buf)) throw new Error('不是有效图片（只支持 PNG / JPEG / GIF / WebP）');

  const added = await onebot('add_custom_face', { file: 'base64://' + buf.toString('base64') });
  const emojiId = String(added?.emoji_id ?? added?.emojiId ?? '').trim();

  // 没写备注时自动补一条：先看文件名，再试视觉模型，最后兜底编号
  let clean = String(desc || '').trim().slice(0, 20);
  let descSource = clean ? 'manual' : '';
  let wiki = null;
  let auto = '';   // 视觉模型的原始描述，后面拼备选名要用（必须提到外层作用域）
  if (!clean) {
    // 本地图片模式拿不到路径，但浏览器会给文件名，这里一起参与猜测
    const fromName = guessNameFromPath(localPath || url || filename);
    if (fromName) { clean = fromName; descSource = 'filename'; }
  }
  if (!clean) {
    auto = await autoDescribe(buf).catch(() => '');
    if (auto) {
      // 视觉模型给的词先去梗库里对一下：能对上就用词库的规范说法，并记下它的用法
      const hit = await matchMemeName(auto).catch(() => null);
      if (hit) {
        clean = String(hit.title).slice(0, 20);
        descSource = 'meme-wiki';
        wiki = { title: hit.title, usage: hit.usage || '', origin: hit.origin || '' };
      } else {
        clean = auto.slice(0, 20);
        descSource = 'vision';
      }
    }
  }
  if (!clean) { clean = `表情-${(emojiId || Date.now().toString(36)).slice(-6)}`; descSource = 'fallback'; }

  if (emojiId) {
    try { await onebot('modify_custom_face', { emoji_id: emojiId, desc: clean }); } catch { /* 备注失败不影响收藏 */ }
  }
  const synced = await syncStickers().catch(() => null);
  if (emojiId && wiki) {
    // 把词库解释挂到缓存条目上，模型挑表情时能顺带知道这个梗怎么接
    try {
      const list = loadCache();
      const i = list.findIndex((e) => e.id === emojiId);
      if (i >= 0) { list[i] = { ...list[i], wiki }; saveCache(list); }
    } catch { /* 缓存写失败不影响收藏 */ }
  }
  // 给界面几个备选名字：自动名不一定贴合实际用法，让人一眼能换掉
  const candidates = await suggestCandidates({ primary: clean, auto, filename: localPath || url || filename }).catch(() => []);
  return {
    added: true,
    emojiId,
    desc: clean,
    descSource,
    wiki: wiki ? wiki.title : null,
    candidates,
    total: synced?.total ?? null
  };
}

// 备选名：自动名 + 文件名 + 梗库模糊匹配里的其它标题（去重、去空、限 4 个）
async function suggestCandidates({ primary, auto, filename }) {
  const out = [];
  const push = (v) => {
    const s = String(v || '').trim().slice(0, 20);
    if (s && !out.includes(s)) out.push(s);
  };
  push(primary);
  const fromName = guessNameFromPath(filename);
  push(fromName);
  const db = await openMemes();
  if (db) {
    const seeds = [auto, primary, fromName].filter(Boolean);
    for (const seed of seeds) {
      for (let size = 4; size >= 2; size -= 1) {
        for (let i = 0; i + size <= seed.length; i += 1) {
          const g = seed.slice(i, i + size);
          const rows = db.prepare('select title from memes where title like ? order by length(title) asc limit 2').all(`%${g}%`);
          for (const r of rows) {
            if (r.title.length <= 10) push(r.title);
            if (out.length >= 4) return out;
          }
        }
      }
    }
  }
  return out.slice(0, 4);
}

// 改名：把备注写回 QQ 收藏表情，并同步本地缓存
export async function renameSticker({ emojiId, desc } = {}) {
  const id = String(emojiId || '').trim();
  const clean = String(desc || '').trim().slice(0, 20);
  if (!id) throw new Error('缺少 emojiId');
  if (!clean) throw new Error('备注不能为空');
  await onebot('modify_custom_face', { emoji_id: id, desc: clean });
  try {
    const list = loadCache();
    const i = list.findIndex((e) => e.id === id);
    if (i >= 0) { list[i] = { ...list[i], desc: clean }; saveCache(list); }
  } catch { /* 缓存写失败不影响改名 */ }
  return { renamed: true, emojiId: id, desc: clean };
}

// 从 QQ 收藏里删掉一张表情（delete_custom_face），同步清本地缓存。
export async function deleteSticker({ emojiId } = {}) {
  const id = String(emojiId || '').trim();
  if (!id) throw new Error('缺少 emojiId');
  await onebot('delete_custom_face', { emoji_id: id });
  let total = null;
  try {
    const list = loadCache().filter((e) => e.id !== id);
    saveCache(list);
    total = list.length;
  } catch { /* 缓存写失败不影响删除 */ }
  return { deleted: true, emojiId: id, total };
}

// 把视觉模型给的描述丢进梗库对一下：先精确，再把描述拆成 2~4 字片段做标题模糊匹配。
async function matchMemeName(text) {
  const key = String(text || '').trim();
  if (!key) return null;
  const db = await openMemes();
  if (!db) return null;
  try {
    const exact = db.prepare('select title,usage,origin from memes where title = ? or slug = ? limit 1').get(key, key);
    if (exact) return exact;
    const grams = [];
    for (let size = 4; size >= 2; size -= 1) {
      for (let i = 0; i + size <= key.length; i += 1) grams.push(key.slice(i, i + size));
    }
    for (const g of grams) {
      const row = db
        .prepare('select title,usage,origin from memes where title = ? or title like ? order by length(title) asc limit 1')
        .get(g, `%${g}%`);
      if (row && row.title.length >= 2 && row.title.length <= 10) return row;
    }
  } catch { /* 词库异常就当没匹配 */ }
  return null;
}

// 从文件名/网址尾部猜一个好读的备注（去扩展名、下划线和常见噪声前缀）
function guessNameFromPath(p) {
  if (!p) return '';
  const tail = String(p).split(/[\\/]/).pop() || '';
  const base = tail.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_+]+/g, ' ').trim();
  if (!base || /^[0-9a-f]{16,}$/i.test(base) || base.length > 20) return '';
  return base.slice(0, 20);
}

// 用视觉模型给表情起个短备注（SiliconFlow OpenAI 兼容接口）。
// 目标不是"描述画面"，而是"它在群聊里是什么意思"——所以提示词要求写成梗/情绪词。
async function autoDescribe(buffer) {
  const cfg = loadConfig();
  const ai = cfg.autoDesc || {};
  if (ai.enabled === false || !ai.apiKey) return '';
  const mime = buffer[0] === 0x89 ? 'png' : buffer[0] === 0xff ? 'jpeg' : buffer[0] === 0x47 ? 'gif' : 'webp';
  const style = ai.style === 'visual'
    ? '用不超过8个汉字描述画面主体和情绪，不要标点，不要解释。'
    : '这张表情包在群聊里通常用来表达什么？用不超过8个汉字，写成具体的情绪或反应（例如：被夸到不好意思、懒得解释、看破不说破）。只输出这8个字以内的话，不要标点。';
  const res = await fetch(String(ai.baseUrl || 'https://api.siliconflow.cn/v1').replace(/\/+$/, '') + '/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${ai.apiKey}` },
    body: JSON.stringify({
      model: ai.model || 'Qwen/Qwen3-VL-8B-Instruct',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: style },
          { type: 'image_url', image_url: { url: `data:image/${mime};base64,${buffer.toString('base64')}` } }
        ]
      }],
      max_tokens: 32,
      temperature: 0.4
    }),
    signal: AbortSignal.timeout(25000)
  });
  if (!res.ok) return '';
  const data = await res.json().catch(() => ({}));
  const raw = String(data?.choices?.[0]?.message?.content || '').trim();
  // 只留中文、字母和数字，去掉 .jpg 这类后缀和标点
  const cleaned = raw.replace(/\.[a-z0-9]{2,5}\b/gi, '').replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '');
  return cleaned.slice(0, 20);
}

// ── 梗百科（词库来自 astrbot_plugin_memewiki，MIT；本地 SQLite 优先，未收录再走 cnmeme.wiki）──
let memesDb = null;
async function openMemes() {
  if (memesDb) return memesDb;
  try {
    if (!fs.existsSync(MEMES_DB)) return null;
    const { DatabaseSync } = await import('node:sqlite');
    memesDb = new DatabaseSync(MEMES_DB, { readOnly: true });
    return memesDb;
  } catch {
    return null;
  }
}

export async function lookupMeme(term) {
  const q = String(term || '').trim();
  if (!q) throw new Error('需要提供词条名');

  const db = await openMemes();
  if (db) {
    try {
      const exact = db
        .prepare('select title,slug,tags,usage,origin,summary from memes where title = ? or slug = ? limit 1')
        .get(q, q);
      if (exact) return { source: 'local', item: exact };
      const like = db
        .prepare('select title,slug,tags,usage from memes where title like ? or tags like ? order by length(title) asc limit 3')
        .all(`%${q}%`, `%${q}%`);
      if (like.length) return { source: 'local-fuzzy', matches: like };
    } catch { /* 词库异常就继续走在线 */ }
  }

  try {
    const url = `https://cnmeme.wiki/api/v1/public/memes?q=${encodeURIComponent(q)}&limit=8`;
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const j = await r.json().catch(() => null);
    const items = Array.isArray(j?.items) ? j.items : [];
    // 只保留真的和查询词相关的：标题或标签里要出现这个词，否则宁可说"没查到"，
    // 也别把"三级张飞不开大"这种不相关词条塞给模型（模型会照着乱解释）。
    const relevant = items.filter((it) => {
      const hay = `${it.title || ''} ${Array.isArray(it.tags) ? it.tags.join(' ') : it.tags || ''}`;
      return hay.includes(q);
    });
    if (relevant.length) {
      return {
        source: 'online',
        matches: relevant.slice(0, 3).map((it) => ({
          title: it.title,
          slug: it.slug,
          tags: it.tags,
          summary: it.summary
        }))
      };
    }
  } catch { /* 在线也不可用 */ }

  return { source: 'none', term: q, hint: '本地词库和 cnmeme.wiki 都没查到，可能太新或太小众' };
}
