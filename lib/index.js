/**
 * dsh-memory-bridge —— 宿主侧。
 *
 * 提供两条通道，任一条能用就行：
 *   1. DSH 路由：/dsh-memory/api/*（同源，客户端 section 首选）
 *   2. 本机兜底：127.0.0.1:8791（万一路由没挂上，客户端会自动退过来）
 */
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const CFG_FILE = path.join(DSH_HOME, 'memory-bridge.config.json')
const DEFAULTS = { baseUrl: 'http://127.0.0.1:8790', spaceId: 0, recentTurns: 10, sessionId: '', takeover: true, enabled: false }

function readConfig() {
  let user = {}
  try {
    user = JSON.parse(fs.readFileSync(CFG_FILE, 'utf8'))
  } catch {
    /* 没配就用默认 */
  }
  return { ...DEFAULTS, ...user }
}

function writeConfig(next) {
  fs.mkdirSync(path.dirname(CFG_FILE), { recursive: true })
  fs.writeFileSync(CFG_FILE, JSON.stringify(next, null, 2) + '\n')
}

async function getJson(url, timeoutMs = 20000) {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { accept: 'application/json' } })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return await r.json()
  } finally {
    clearTimeout(t)
  }
}

async function postJson(url, body, timeoutMs = 90000) {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const r = await fetch(url, {
      method: 'POST',
      signal: ctl.signal,
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body || {}),
    })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return await r.json()
  } finally {
    clearTimeout(t)
  }
}

async function resolveBase() {
  const cfg = readConfig()
  const cands = [cfg.baseUrl, 'http://127.0.0.1:8790', 'http://127.0.0.1:8787'].filter(Boolean)
  for (const b of cands) {
    try {
      await getJson(`${b}/api/health`, 2000)
      return b
    } catch {
      /* 下一个 */
    }
  }
  throw new Error('记忆库没启动（8790 / 8787 都没响应）')
}

/** 所有接口的共用实现：传入 path（去掉 /dsh-memory/api 前缀）与 query */
async function handleApi(apiPath, query, method, bodyText) {
  if (apiPath === '/config' && method === 'GET') {
    return readConfig()
  }
  if (apiPath === '/config' && method === 'POST') {
    const patch = JSON.parse(bodyText || '{}')
    const next = { ...readConfig(), ...patch }
    if (!next.spaceId) {
      next.enabled = false
    }
    writeConfig(next)
    return next
  }
  if (apiPath === '/status') {
    return {
      hasSystemPrompt: spReady,
      enabled: readConfig().enabled,
      spaceId: readConfig().spaceId,
      cacheChars: memoryCache.text.length,
      cacheSession: memoryCache.sessionId,
    }
  }
  if (apiPath === '/spaces') {
    const base = await resolveBase()
    const data = await getJson(`${base}/api/spaces`)
    return { ...data, baseUrl: base }
  }
  if (apiPath === '/pack') {
    const cfg = readConfig()
    const base = await resolveBase()
    const sid = Number(query.get('spaceId') || cfg.spaceId || 0)
    if (!sid) throw new Error('还没选记忆体')
    return await postJson(`${base}/api/spaces/${sid}/episodes/pack`, { max: 5 })
  }
  if (apiPath === '/sessions') {
    const base = await resolveBase()
    return await getJson(`${base}/api/dsh/sessions`)
  }
  if (apiPath === '/recent') {
    const cfg = readConfig()
    const base = await resolveBase()
    const sid = Number(query.get('spaceId') || cfg.spaceId || 0)
    const n = Number(query.get('n') || cfg.recentTurns || 10)
    if (!sid) throw new Error('还没选记忆体')
    return await getJson(`${base}/api/memories?spaceId=${sid}&limit=${n}&offset=0`)
  }
  const err = new Error('not found')
  err.status = 404
  throw err
}

function startFallbackServer() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    res.setHeader('access-control-allow-origin', '*')
    res.setHeader('access-control-allow-headers', 'content-type')
    res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS')
    res.setHeader('cache-control', 'no-store')

    if (req.method === 'OPTIONS') {
      res.statusCode = 204
      return res.end()
    }

    const send = (code, data) => {
      res.statusCode = code
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.end(JSON.stringify(data))
    }

    if (url.pathname === '/health') {
      return send(200, { ok: true })
    }
    if (!url.pathname.startsWith('/api/')) {
      return send(404, { error: 'not found' })
    }
    const chunks = []
    for await (const c of req) chunks.push(c)
    try {
      const data = await handleApi(url.pathname.slice(4), url.searchParams, req.method, Buffer.concat(chunks).toString('utf8'))
      send(200, data)
    } catch (e) {
      send(e.status || 500, { error: String(e && e.message ? e.message : e) })
    }
  })

  const tryListen = (p, left) => {
    server.once('error', (err) => {
      if (err && err.code === 'EADDRINUSE' && left > 0) {
        tryListen(p + 1, left - 1)
      }
    })
    server.listen(p, '127.0.0.1', () => {
      console.log(`[memory-bridge] 兜底接口 http://127.0.0.1:${p}/api/`)
    })
  }
  tryListen(8791, 4)
}

export default {
  name: 'dsh-memory-bridge',
  inject: ['webServer', 'connection', 'systemPrompt'],
  apply(ctx) {
    // 兜底通道：不依赖任何服务，先开
    try {
      startFallbackServer()
    } catch (e) {
      console.warn('[memory-bridge] 兜底服务启动失败', e && e.message)
    }

    // 上下文：注册到系统提示词（聊天记录里不可见）
    let hasSystemPrompt = false
    try {
      hasSystemPrompt = mountSystemPrompt(ctx)
    } catch (e) {
      console.warn('[memory-bridge] systemPrompt 挂载异常', e && e.message)
    }

    // 上下文接管：绑定并开启后，每轮请求前刷新记忆，并（可选）丢掉旧历史
    try {
      mountTakeover(ctx, hasSystemPrompt)
    } catch (e) {
      console.warn('[memory-bridge] 接管钩子挂载失败', e && e.message)
    }

    const web = ctx.webServer || (ctx.get && ctx.get('webServer'))
    if (!web || typeof web.register !== 'function') {
      console.warn('[memory-bridge] 没有 webServer，只走 8791 兜底')
      return
    }

    const json = (res, code, data) => {
      res.statusCode = code
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.setHeader('cache-control', 'no-store')
      res.end(JSON.stringify(data))
    }

    const route = (methods, apiPath) => {
      const allowed = Array.isArray(methods) ? methods : [methods]
      try {
        web.register({
          kind: 'exact',
          path: '/dsh-memory/api' + apiPath,
          handler: async (req, res) => {
            if (!allowed.includes(req.method)) {
              return json(res, 405, { error: 'method not allowed' })
            }
            const url = new URL(req.url || '/', 'http://127.0.0.1')
            const chunks = []
            for await (const c of req) chunks.push(c)
            try {
              const data = await handleApi(apiPath, url.searchParams, req.method, Buffer.concat(chunks).toString('utf8'))
              json(res, 200, data)
            } catch (e) {
              json(res, e.status || 500, { error: String(e && e.message ? e.message : e) })
            }
          },
        })
        console.log('[memory-bridge] route', allowed.join('|'), '/dsh-memory/api' + apiPath)
      } catch (e) {
        console.error('[memory-bridge] 注册失败', apiPath, e && e.message)
      }
    }

    route(['GET', 'POST'], '/config')
    route('GET', '/status')
    route('GET', '/spaces')
    route('GET', '/sessions')
    route('GET', '/pack')
    route('GET', '/recent')
  },
}

/**
 * 监听 agent/pre-step（waterfall）：可以改写这一轮要发给模型的消息。
 * 文档：app.asar 里 cordis-plugin-development/references/practices.md
 *   「改写 agent/pre-step 决策时要展开 { ...decision, messages }」
 */
let memoryCache = { sessionId: '', text: '' }
let spReady = false

/** 注册到系统提示词里：模型能看到，聊天记录里看不到 */
function mountSystemPrompt(ctx) {
  const sp = ctx.systemPrompt || (ctx.get && ctx.get('systemPrompt'))
  if (!sp || typeof sp.context !== 'function') {
    console.warn('[memory-bridge] systemPrompt 不可用')
    return false
  }
  try {
    sp.context({
      name: 'memory-bridge',
      order: 900,
      text: () => {
        const cfg = readConfig()
        return cfg.enabled ? memoryCache.text : ''
      },
    })
    spReady = true
    console.log('[memory-bridge] 已注册系统提示词段')
    return true
  } catch (e) {
    console.warn('[memory-bridge] 注册系统提示词失败', e && e.message)
    return false
  }
}

function mountTakeover(ctx, hasSystemPrompt) {
  if (!ctx || typeof ctx.on !== 'function') {
    console.warn('[memory-bridge] ctx.on 不可用，跳过接管')
    return
  }
  ctx.on(
    'agent/pre-step',
    async (payload, next) => {
      const decision = await next()
      try {
        const cfg = readConfig()
        if (!decision || decision.kind === 'reject') return decision
        if (!cfg.enabled || !cfg.spaceId) return decision
        if (payload && payload.signal && payload.signal.aborted) return decision
        const sid = payload && payload.agent && payload.agent.session ? payload.agent.session.id : ''
        if (cfg.sessionId && sid && cfg.sessionId !== sid) return decision
        if (!Array.isArray(decision.messages) || decision.messages.length === 0) return decision

        const last = decision.messages[decision.messages.length - 1]
        if (!last) return decision
        const queryText = textOfMessage(last)

        const text = await buildContext(cfg, queryText)
        if (!text) return decision
        memoryCache = { sessionId: sid || '', text }

        if (hasSystemPrompt) {
          // 记忆已在系统提示词里，这里只需要决定留多少历史
          if (cfg.takeover) {
            console.log('[memory-bridge] 接管：旧历史不发送，记忆走系统提示词')
            return { ...decision, messages: [last] }
          }
          return decision
        }

        // 没有 systemPrompt 服务时的退路：拼进当前消息
        const merged = mergeIntoMessage(last, text)
        if (!merged) return decision
        return { ...decision, messages: cfg.takeover ? [merged] : [...decision.messages.slice(0, -1), merged] }
      } catch (e) {
        console.warn('[memory-bridge] pre-step 改写失败，按原样放行', e && e.message)
        return decision
      }
    },
    { prepend: true },
  )
  console.log('[memory-bridge] 已挂载 agent/pre-step')
}

/** 从消息里取出纯文本 */
function textOfMessage(msg) {
  if (!msg) return ''
  if (typeof msg.content === 'string') return msg.content
  if (Array.isArray(msg.content)) {
    return msg.content.map((p) => (p && p.type === 'text' ? p.text || '' : '')).join('\n')
  }
  return ''
}

/** 把一段文字拼到消息正文最前面，兼容 string / parts 两种形状 */
function mergeIntoMessage(msg, text) {
  if (!msg) return null
  const content = msg.content
  if (typeof content === 'string') {
    return { ...msg, content: text + '\n\n' + content }
  }
  if (Array.isArray(content)) {
    const idx = content.findIndex((p) => p && p.type === 'text')
    if (idx >= 0) {
      const parts = content.slice()
      parts[idx] = { ...parts[idx], text: text + '\n\n' + (parts[idx].text || '') }
      return { ...msg, content: parts }
    }
    return { ...msg, content: [{ type: 'text', text }, ...content] }
  }
  return { ...msg, content: [{ type: 'text', text }] }
}

/** 拼上下文：事件骨架 + 最近 N 条原文 */
async function buildContext(cfg, query) {
  const base = await resolveBase()
  // 先骨架，再按这句话去记忆体里找相关的原文
  const pack = await postJson(`${base}/api/spaces/${cfg.spaceId}/episodes/pack`, { max: 5 })
  const recent = await getJson(`${base}/api/memories?spaceId=${cfg.spaceId}&limit=${cfg.recentTurns || 10}&offset=0`)
  const recentItems = recent.items || []
  const recentIds = new Set(recentItems.map((m) => m.id))

  let hits = []
  if (query && query.trim().length > 1) {
    try {
      const r = await postJson(`${base}/api/recall`, { spaceId: cfg.spaceId, query, deep: false, limit: 6 })
      hits = (r.items || []).filter((m) => !recentIds.has(m.id)).slice(0, 4)
    } catch {
      hits = []
    }
  }

  const items = recentItems.slice().reverse()
  const lines = ['【你们的记忆骨架，只当背景，不要复述】']
  if (pack.text) lines.push(pack.text.trim())
  if (hits.length) {
    lines.push('\n【这段可能和当前这句有关（记忆库检索到的原文）】')
    for (const m of hits) {
      lines.push('他：' + (m.question || '').trim())
      lines.push('我：' + (m.answer || '').trim())
    }
  }
  if (items.length) {
    lines.push('\n【最近聊过的原话】')
    for (const m of items) {
      lines.push('他：' + (m.question || '').trim())
      lines.push('我：' + (m.answer || '').trim())
    }
  }
  lines.push('\n[以上是背景资料，不是用户的新问题。接下来那句才是他说的，直接接住，不要复述，不要解释你记得什么。]')
  return lines.join('\n')
}
