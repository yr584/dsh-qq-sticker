// dsh-qq-sticker — 客户端半身：设置页「表情包」。
// 图库（缩略图/备注/搜索）+ 点选发送 + 两个调节项（每分钟上限、主动使用概率）。
// 宿主接口：/api/qq-sticker/{list,image,sync,send,settings}
window.__ModuleLoader__.load({
  id: 'dsh-qq-sticker',
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    const react = require('react');
    const h = react.createElement;
    const inject = ['slots'];
    const API = '/api/qq-sticker';

    const S = {
      wrap: { display: 'flex', flexDirection: 'column', gap: 14, padding: '4px 2px 24px' },
      row: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
      input: {
        background: 'var(--dsh-input-bg, rgba(127,127,127,.12))',
        border: '1px solid var(--dsh-border, rgba(127,127,127,.25))',
        borderRadius: 8, padding: '6px 10px', color: 'inherit', fontSize: 13, outline: 'none'
      },
      btn: {
        border: '1px solid var(--dsh-border, rgba(127,127,127,.3))',
        background: 'var(--dsh-input-bg, rgba(127,127,127,.12))',
        borderRadius: 8, padding: '6px 12px', color: 'inherit', cursor: 'pointer', fontSize: 13
      },
      grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 10 },
      cell: {
        border: '1px solid var(--dsh-border, rgba(127,127,127,.18))',
        borderRadius: 10, padding: 6, cursor: 'pointer', textAlign: 'center',
        background: 'var(--dsh-panel-bg, rgba(127,127,127,.06))'
      },
      img: { width: '100%', height: 76, objectFit: 'contain', borderRadius: 6, display: 'block' },
      cap: { fontSize: 11, opacity: 0.72, marginTop: 4, minHeight: 26, lineHeight: '13px', wordBreak: 'break-all' },
      label: { fontSize: 13, opacity: 0.85, minWidth: 96 },
      hint: { fontSize: 12, opacity: 0.6, lineHeight: '18px' },
      ok: { fontSize: 12, color: 'var(--dsh-success, #3fa96a)' },
      err: { fontSize: 12, color: 'var(--dsh-danger, #d9534f)' }
    };

    async function api(path, init) {
      const res = await fetch(API + path, init);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
      return data;
    }

    function Slider({ label, min, max, step, value, suffix, onChange }) {
      return h('div', { style: { ...S.row, gap: 10 } },
        h('span', { style: S.label }, label),
        h('input', {
          type: 'range', min, max, step, value,
          style: { flex: '1 1 180px', accentColor: 'var(--dsh-accent, #4f8cff)' },
          onChange: (e) => onChange(Number(e.target.value))
        }),
        h('span', { style: { fontSize: 12, minWidth: 52, textAlign: 'right', opacity: 0.8 } }, value + (suffix || ''))
      );
    }

    function StickerPage() {
      const [items, setItems] = react.useState([]);
      const [total, setTotal] = react.useState(0);
      const [query, setQuery] = react.useState('');
      const [settings, setSettings] = react.useState(null);
      const [targetType, setTargetType] = react.useState('group');
      const [targetId, setTargetId] = react.useState('');
      const [picked, setPicked] = react.useState(null);
      const [busy, setBusy] = react.useState('');
      const [msg, setMsg] = react.useState(null);
      // 添加表情：本地上传 / 网络地址
      const [addOpen, setAddOpen] = react.useState(false);
      const [addMode, setAddMode] = react.useState('url');
      const [addUrl, setAddUrl] = react.useState('');
      const [addDesc, setAddDesc] = react.useState('');
      const [addFile, setAddFile] = react.useState('');
      const [addName, setAddName] = react.useState('');
      const [addPath, setAddPath] = react.useState('');
      const [lastAdded, setLastAdded] = react.useState(null);

      const load = react.useCallback(async (q) => {
        try {
          const d = await api(`/list?query=${encodeURIComponent(q || '')}&limit=120`);
          setItems(d.items || []);
          setTotal(d.total || 0);
        } catch (e) { setMsg({ kind: 'err', text: `读取表情库失败：${e.message}` }); }
      }, []);

      react.useEffect(() => { load(''); }, [load]);
      react.useEffect(() => {
        api('/settings').then((d) => setSettings(d.settings)).catch(() => {});
      }, []);

      const doSync = async () => {
        setBusy('sync'); setMsg(null);
        try {
          const r = await api('/sync', { method: 'POST' });
          setMsg({ kind: 'ok', text: `已同步：新增/更新 ${r.fetched} 个，本地共 ${r.total} 个` });
          await load(query);
        } catch (e) { setMsg({ kind: 'err', text: `同步失败：${e.message}` }); }
        setBusy('');
      };

      const doSend = async () => {
        if (!picked) return;
        if (!/^\d+$/.test(targetId.trim())) { setMsg({ kind: 'err', text: '群号 / QQ 号必须填数字' }); return; }
        setBusy('send'); setMsg(null);
        try {
          const r = await api('/send', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ targetType, targetId: targetId.trim(), stickerId: picked.id })
          });
          setMsg({ kind: 'ok', text: `已发送（messageId ${r.messageId ?? '-'}，${Math.round((r.bytes || 0) / 1024)} KB）` });
        } catch (e) { setMsg({ kind: 'err', text: `发送失败：${e.message}` }); }
        setBusy('');
      };

      const pickFile = (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) { setMsg({ kind: 'err', text: '本地图请小于 5 MB，更大的用「网络地址」方式' }); return; }
        const reader = new FileReader();
        reader.onload = () => { setAddFile(String(reader.result || '')); setAddName(file.name); };
        reader.readAsDataURL(file);
      };

      const doAdd = async () => {
        const payload = { desc: addDesc.trim() };
        if (addMode === 'file') {
          if (!addFile) { setMsg({ kind: 'err', text: '先选一张本地图片' }); return; }
          payload.imageBase64 = addFile;
          if (addName) payload.filename = addName;   // 让自动备注能用上文件名
        } else if (addMode === 'path') {
          if (!addPath.trim()) { setMsg({ kind: 'err', text: '先填本机图片路径' }); return; }
          payload.localPath = addPath.trim();
        } else {
          if (!/^https?:\/\//i.test(addUrl.trim())) { setMsg({ kind: 'err', text: '网络地址必须以 http(s):// 开头' }); return; }
          payload.url = addUrl.trim();
        }
        setBusy('add'); setMsg(null);
        try {
          const r = await api('/add', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload)
          });
          const how = r.descSource === 'meme-wiki' ? '（梗库命中）'
            : r.descSource === 'vision' ? '（自动描述）'
            : r.descSource === 'filename' ? '（取自文件名）' : '';
          setLastAdded({ emojiId: r.emojiId, desc: r.desc, candidates: Array.isArray(r.candidates) ? r.candidates : [] });
          setMsg({ kind: 'ok', text: `已添加${r.desc ? `「${r.desc}」${how}` : ''}，本地共 ${r.total ?? '?'} 张` });
          setAddFile(''); setAddName(''); setAddUrl(''); setAddDesc(''); setAddPath('');
          await load(query);
        } catch (e) { setMsg({ kind: 'err', text: `添加失败：${e.message}` }); }
        setBusy('');
      };

      const doRename = async (name) => {
        if (!lastAdded?.emojiId || !name) return;
        setBusy('rename'); setMsg(null);
        try {
          await api('/rename', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ emojiId: lastAdded.emojiId, desc: name })
          });
          setLastAdded({ ...lastAdded, desc: name, candidates: lastAdded.candidates.filter((c) => c !== name) });
          setMsg({ kind: 'ok', text: `已改名为「${name}」` });
          await load(query);
        } catch (e) { setMsg({ kind: 'err', text: `改名失败：${e.message}` }); }
        setBusy('');
      };

      const doDelete = async () => {
        if (!picked) return;
        const label = picked.desc || '这张表情';
        if (!window.confirm(`从 QQ 收藏里删除「${label}」？删了不能用「刷新收藏」找回来。`)) return;
        setBusy('del'); setMsg(null);
        try {
          const r = await api('/delete', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ emojiId: picked.id })
          });
          setMsg({ kind: 'ok', text: `已删除「${label}」，本地还剩 ${r.total ?? '?'} 张` });
          setPicked(null);
          if (lastAdded?.emojiId === picked.id) setLastAdded(null);
          await load(query);
        } catch (e) { setMsg({ kind: 'err', text: `删除失败：${e.message}` }); }
        setBusy('');
      };

      const saveSend = async (patch) => {
        setSettings((s) => ({ ...s, send: { ...s.send, ...patch } }));
        try {
          const d = await api('/settings', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ send: patch })
          });
          setSettings(d.settings);
        } catch (e) { setMsg({ kind: 'err', text: `保存设置失败：${e.message}` }); }
      };

      const send = settings?.send || { maxPerMinute: 6, autoProbability: 0 };

      return h('div', { style: S.wrap },
        h('div', { style: { fontSize: 15, fontWeight: 600 } }, '表情包'),
        h('div', { style: S.hint },
          `本地库 ${total} 张。缩略图来自 QQ 收藏表情；点一张选中，再点「发送」发给指定群或好友。`),

        h('div', { style: S.row },
          h('input', {
            style: { ...S.input, flex: '1 1 200px' }, placeholder: '搜索备注，如 无语 / 笑 / 可爱',
            value: query,
            onChange: (e) => { setQuery(e.target.value); load(e.target.value); }
          }),
          h('button', { style: S.btn, disabled: busy === 'sync', onClick: doSync },
            busy === 'sync' ? '同步中…' : '刷新收藏')
        ),

        h('div', { style: S.row },
          h('span', { style: S.label }, '发送到'),
          h('select', {
            style: S.input, value: targetType,
            onChange: (e) => setTargetType(e.target.value)
          },
            h('option', { value: 'group' }, '群'),
            h('option', { value: 'private' }, '好友')
          ),
          h('input', {
            style: { ...S.input, flex: '1 1 140px' }, placeholder: '群号 / QQ 号',
            value: targetId, onChange: (e) => setTargetId(e.target.value)
          }),
          h('button', {
            style: { ...S.btn, opacity: picked ? 1 : 0.5 }, disabled: !picked || busy === 'send', onClick: doSend
          }, busy === 'send' ? '发送中…' : (picked ? `发送「${picked.desc}」` : '先选一张表情')),
          h('button', {
            style: { ...S.btn, opacity: picked ? 1 : 0.4, color: 'var(--dsh-danger, #d9534f)' },
            disabled: !picked || busy === 'del', onClick: doDelete
          }, busy === 'del' ? '删除中…' : '删除这张')
        ),

        msg ? h('div', { style: msg.kind === 'ok' ? S.ok : S.err }, msg.text) : null,

        lastAdded && lastAdded.candidates.length > 1
          ? h('div', { style: { ...S.row, gap: 6 } },
              h('span', { style: S.hint }, `「${lastAdded.desc}」不太准？换一个：`),
              lastAdded.candidates.filter((c) => c !== lastAdded.desc).map((c) =>
                h('button', {
                  key: c, style: { ...S.btn, padding: '3px 8px', fontSize: 12 },
                  disabled: busy === 'rename', onClick: () => doRename(c)
                }, c)
              )
            )
          : null,

        h('div', { style: S.grid },
          items.map((it) => h('div', {
            key: it.id,
            style: { ...S.cell, outline: picked?.id === it.id ? '2px solid var(--dsh-accent, #4f8cff)' : 'none' },
            title: it.desc,
            onClick: () => setPicked(it)
          },
            h('img', { style: S.img, src: `${API}/image?id=${encodeURIComponent(it.id)}`, alt: it.desc, loading: 'lazy' }),
            h('div', { style: S.cap }, it.desc)
          ))
        ),
        items.length ? null : h('div', { style: S.hint }, '还没有表情，点「刷新收藏」从 QQ 拉一次。'),

        h('div', { style: { height: 1, background: 'var(--dsh-border, rgba(127,127,127,.2))', margin: '6px 0' } }),
        h('div', { style: S.row },
          h('span', { style: { fontSize: 14, fontWeight: 600 } }, '添加表情'),
          h('button', { style: S.btn, onClick: () => setAddOpen((v) => !v) }, addOpen ? '收起' : '展开')
        ),
        addOpen ? h('div', { style: { ...S.wrap, gap: 8 } },
          h('div', { style: S.row },
            h('select', {
              style: S.input, value: addMode, onChange: (e) => setAddMode(e.target.value)
            },
              h('option', { value: 'url' }, '网络地址'),
              h('option', { value: 'file' }, '本地图片'),
              h('option', { value: 'path' }, '本机路径')
            ),
            addMode === 'url'
              ? h('input', {
                  style: { ...S.input, flex: '1 1 260px' }, placeholder: 'https://... 图片直链',
                  value: addUrl, onChange: (e) => setAddUrl(e.target.value)
                })
              : addMode === 'path'
                ? h('input', {
                    style: { ...S.input, flex: '1 1 260px' }, placeholder: 'C:\\Users\\you\\Pictures\\a.gif（宿主直接读，不受 5MB 上传限制）',
                    value: addPath, onChange: (e) => setAddPath(e.target.value)
                  })
                : h('input', { type: 'file', accept: 'image/*', onChange: pickFile, style: { fontSize: 12 } }),
            addMode === 'file' && addName ? h('span', { style: S.hint }, addName) : null
          ),
          h('div', { style: S.row },
            h('input', {
              style: { ...S.input, flex: '1 1 200px' }, placeholder: '备注（≤20 字，例如"无语 翻白眼"）',
              value: addDesc, maxLength: 20, onChange: (e) => setAddDesc(e.target.value)
            }),
            h('button', { style: S.btn, disabled: busy === 'add', onClick: doAdd }, busy === 'add' ? '添加中…' : '添加到 QQ 收藏')
          ),
          h('div', { style: S.hint },
            '添加成功后这张图会进你 QQ 账号的收藏表情（手机 QQ 也能用），并自动刷新本地库。本地图上限 5 MB，大图建议用直链。')
        ) : null,

        h('div', { style: { height: 1, background: 'var(--dsh-border, rgba(127,127,127,.2))', margin: '6px 0' } }),
        h('div', { style: { fontSize: 14, fontWeight: 600 } }, '使用节奏'),
        h(Slider, {
          label: '每分钟上限', min: 1, max: 20, step: 1, value: send.maxPerMinute, suffix: ' 张',
          onChange: (v) => saveSend({ maxPerMinute: v })
        }),
        h(Slider, {
          label: '主动使用概率', min: 0, max: 100, step: 5, value: send.autoProbability, suffix: '%',
          onChange: (v) => saveSend({ autoProbability: v })
        }),
        h('div', { style: S.hint },
          '「主动使用概率」是闲聊时她自发甩表情的概率；0 表示只在被要求时发。频控目前只写进配置，运行时限制还在做。')
      );
    }

    function apply(ctx) {
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'qq-sticker',
        order: 36,
        label: () => '表情包',
        locale: 'zh-CN'
      }, () => h(StickerPage)));
    }

    exports.name = 'qq-sticker';
    exports.inject = inject;
    exports.apply = apply;
    exports.__test = { StickerPage };
    return module.exports;
  }
});
