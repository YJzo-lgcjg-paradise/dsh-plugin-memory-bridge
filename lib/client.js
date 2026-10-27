/**
 * dsh-memory-bridge —— 客户端：DSH「设置」里的「记忆桥」section。
 *
 * 数据流：section ⇄ /dsh-memory/api/* （同源 fetch）⇄ ~/.dsh/memory-bridge.config.json
 */
window.__ModuleLoader__.load({
  id: 'dsh-memory-bridge',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback } = React

    const API = '/dsh-memory/api'
    const NS = 'memory-bridge'

    // 先走 DSH 同源路由；404 说明宿主路由没挂上，退到 8791 兜底服务
    const FALLBACK = 'http://127.0.0.1:8791/api'
    async function api(path, opt) {
      const init = { headers: { accept: 'application/json' }, ...opt }
      let r = await fetch(API + path, init)
      // 宿主路由没挂上 / 方法不对 / 500，都退到本机兜底服务
      if (!r.ok) {
        const alt = await fetch(FALLBACK + path, init).catch(() => null)
        if (alt && alt.ok) {
          r = alt
        }
      }
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`)
      return data
    }

    const box = {
      border: '1px solid rgba(255,255,255,.08)',
      borderRadius: 12,
      padding: '14px 16px',
      marginBottom: 14,
    }
    const label = { display: 'block', fontSize: 12, opacity: 0.7, marginBottom: 6 }
    const input = {
      width: '100%',
      padding: '8px 10px',
      borderRadius: 8,
      border: '1px solid rgba(255,255,255,.12)',
      background: 'rgba(0,0,0,.3)',
      color: 'inherit',
      fontSize: 13,
    }
    const btn = {
      padding: '7px 14px',
      borderRadius: 8,
      border: '1px solid rgba(198,167,106,.45)',
      background: 'rgba(198,167,106,.08)',
      color: '#c6a76a',
      fontSize: 13,
      cursor: 'pointer',
      marginRight: 8,
    }
    const hint = { fontSize: 12, opacity: 0.6, marginTop: 8 }

    function MemoryBridgeSection() {
      const [cfg, setCfg] = useState({ baseUrl: 'http://127.0.0.1:8790', spaceId: 0, recentTurns: 10 })
      const [spaces, setSpaces] = useState([])
      const [msg, setMsg] = useState('')
      const [err, setErr] = useState('')
      const [busy, setBusy] = useState('')
      const [pack, setPack] = useState('')
      const [baseUrl, setBaseUrl] = useState('http://127.0.0.1:8790')
      const [sessions, setSessions] = useState([])
      const [sessionId, setSessionId] = useState('')

      const loadConfig = useCallback(async () => {
        try {
          const c = await api('/config')
          setCfg(c)
          setBaseUrl(c.baseUrl || 'http://127.0.0.1:8790')
          setSessionId(c.sessionId || '')
        } catch (e) {
          setErr(String(e.message || e))
        }
      }, [])

      const loadSpaces = useCallback(async () => {
        setBusy('spaces')
        setErr('')
        try {
          const data = await api('/spaces')
          setSpaces(data.spaces || [])
          setMsg(`已连接 ${data.baseUrl || ''}，找到 ${(data.spaces || []).length} 个记忆体`)
        } catch (e) {
          setErr(`连接失败：${e.message || e}`)
        } finally {
          setBusy('')
        }
      }, [])

      const loadSessions = useCallback(async () => {
        try {
          const data = await api('/sessions')
          setSessions(data.sessions || [])
        } catch {
          setSessions([])
        }
      }, [])

      useEffect(() => {
        loadConfig().then(() => {
          loadSpaces()
          loadSessions()
        })
      }, [loadConfig, loadSpaces, loadSessions])

      async function save() {
        if (!cfg.spaceId) {
          setErr('先在下面选一个记忆体，再保存')
          return
        }
        try {
          const next = await api('/config', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              baseUrl,
              spaceId: Number(cfg.spaceId || 0),
              recentTurns: Number(cfg.recentTurns || 10),
              sessionId,
              sessionTitle: (sessions.find((s) => s.id === sessionId) || {}).title || '',
              takeover: !!cfg.takeover,
              enabled: true,
            }),
          })
          setCfg(next)
          setSessionId(next.sessionId || '')
          setMsg('已保存')
        } catch (e) {
          setErr(`保存失败：${e.message || e}`)
        }
      }

      async function disable() {
        try {
          const next = await api('/config', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ enabled: false }),
          })
          setCfg(next)
          setMsg('已停用：这个窗口不再使用记忆库')
        } catch (e) {
          setErr(`停用失败：${e.message || e}`)
        }
      }

      async function makePack() {
        setBusy('pack')
        setErr('')
        try {
          const data = await api(`/pack?spaceId=${cfg.spaceId || 0}`)
          setPack(data.text || '（这个记忆体还没有整理好的事件）')
        } catch (e) {
          setErr(`生成失败：${e.message || e}`)
        } finally {
          setBusy('')
        }
      }

      async function copy() {
        try {
          await navigator.clipboard.writeText(pack || '')
          setMsg('已复制到剪贴板')
        } catch {
          setErr('复制失败，手动选中文本吧')
        }
      }

      return h(
        'div',
        { style: { maxWidth: 760 } },
        h('p', { style: hint }, '把一个对话窗口绑到某个记忆体：只带这个记忆体最近的事件和对话，不受原上下文牵制。'),

        h(
          'div',
          { style: box },
          h('div', { style: { fontSize: 13, fontWeight: 500, marginBottom: 10 } }, '记忆库连接'),
          h('label', { style: label }, '地址'),
          h('input', {
            style: input,
            value: baseUrl,
            onChange: (e) => setBaseUrl(e.target.value),
            placeholder: 'http://127.0.0.1:8790',
          }),
          h(
            'div',
            { style: { marginTop: 10 } },
            h('button', { style: btn, onClick: loadSpaces, disabled: busy === 'spaces' }, busy === 'spaces' ? '连接中…' : '刷新记忆体'),
          ),
        ),

        h(
          'div',
          { style: box },
          h('label', { style: label }, '绑定的对话窗口（本地 Harness 会话）'),
          h(
            'select',
            {
              style: input,
              value: sessionId || '',
              onChange: (e) => setSessionId(e.target.value),
            },
            h('option', { value: '' }, '（当前窗口）'),
            ...sessions.map((s) =>
              h('option', { key: s.id, value: s.id }, `${s.title || '未命名会话'} · ${s.userTurns || 0} 轮`),
            ),
          ),
          h(
            'div',
            { style: { marginTop: 8 } },
            h('button', { style: btn, onClick: loadSessions }, '刷新窗口列表'),
            h('span', { style: hint }, '选一个会话，之后这个会话就用下面选的记忆体'),
          ),
          h('label', { style: { ...label, marginTop: 14 } }, '这个窗口使用的记忆体'),
          h(
            'select',
            {
              style: input,
              value: String(cfg.spaceId || 0),
              onChange: (e) => setCfg({ ...cfg, spaceId: Number(e.target.value) }),
            },
            h('option', { value: '0' }, '（未选择）'),
            ...spaces.map((s) => h('option', { key: s.id, value: String(s.id) }, `${s.name || '记忆体 ' + s.id} · ${s.total} 条对话`)),
          ),
          h('label', { style: { ...label, marginTop: 12 } }, '带最近多少条对话'),
          h('input', {
            style: input,
            type: 'number',
            min: 1,
            max: 50,
            value: cfg.recentTurns || 10,
            onChange: (e) => setCfg({ ...cfg, recentTurns: Number(e.target.value) }),
          }),
          h(
            'label',
            { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, fontSize: 13, cursor: 'pointer' } },
            h('input', {
              type: 'checkbox',
              checked: !!cfg.takeover,
              onChange: (e) => setCfg({ ...cfg, takeover: e.target.checked }),
            }),
            '接管上下文（只带记忆骨架 + 最近十条，丢掉本窗口旧历史）',
          ),
          h(
            'div',
            { style: { marginTop: 12 } },
            h('button', { style: btn, onClick: save }, cfg.enabled ? '保存并启用' : '保存并启用'),
            h('button', { style: { ...btn, borderColor: 'rgba(255,255,255,.18)', color: 'rgba(255,255,255,.6)' }, onClick: disable }, '停用'),
            h('button', { style: btn, onClick: makePack, disabled: busy === 'pack' }, busy === 'pack' ? '生成中…' : '生成记忆骨架'),
            h('button', { style: btn, onClick: copy }, '复制'),
          ),
        ),

        h(
          'div',
          { style: { fontSize: 12, marginBottom: 8, color: cfg.enabled ? '#7ec699' : 'rgba(255,255,255,.45)' } },
          cfg.enabled
            ? `● 已启用${cfg.sessionId ? '' : '（所有窗口）'}`
            : '○ 已停用（点「保存并启用」才生效）',
        ),
        msg ? h('div', { style: { fontSize: 12, color: '#c6a76a', marginBottom: 8 } }, msg) : null,
        err ? h('div', { style: { fontSize: 12, color: '#d98a80', marginBottom: 8 } }, err) : null,

        h(
          'pre',
          {
            style: {
              border: '1px solid rgba(255,255,255,.08)',
              borderRadius: 10,
              padding: 12,
              fontSize: 12.5,
              whiteSpace: 'pre-wrap',
              maxHeight: 320,
              overflow: 'auto',
              background: 'rgba(0,0,0,.25)',
            },
          },
          pack || '还没有生成。',
        ),
      )
    }

    const inject = ['slots']

    function apply(ctx) {
      ctx.effect(
        () =>
          ctx.slots.inject('settings.section', () =>
            ctx.slots.register({ name: 'settings.section', id: NS, order: 7, label: () => '记忆桥' }, MemoryBridgeSection),
            'memory-bridge: settings section',
          ),
        'memory-bridge: settings section',
      )
    }

    exports.apply = apply
    exports.inject = inject
    exports.MemoryBridgeSection = MemoryBridgeSection
    return module.exports
  },
})
