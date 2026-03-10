import fs from 'fs'
import { getDatabase } from '../database/init.js'

function splitList(value) {
  const raw = String(value || '').trim()
  if (!raw) return []

  if (raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        return parsed.map(item => String(item || '').trim()).filter(Boolean)
      }
    } catch {
      // fallthrough to delimiter parsing
    }
  }

  return raw
    .split(/[\n,;]+/g)
    .map(item => String(item || '').trim())
    .filter(Boolean)
}

export function parseProxyConfig(proxyUrl) {
  if (!proxyUrl) return null

  try {
    const parsed = new URL(String(proxyUrl))
    const protocol = String(parsed.protocol || '').replace(':', '').toLowerCase()
    if (!protocol || !['http', 'https', 'socks', 'socks4', 'socks4a', 'socks5', 'socks5h'].includes(protocol)) {
      return null
    }

    if (!parsed.hostname) return null

    const defaultPort = protocol.startsWith('socks') ? 1080 : (protocol === 'https' ? 443 : 80)
    const port = parsed.port ? Number(parsed.port) : defaultPort
    if (!Number.isFinite(port) || port <= 0) return null

    const auth = parsed.username
      ? {
        username: decodeURIComponent(parsed.username),
        password: decodeURIComponent(parsed.password || '')
      }
      : undefined

    return {
      protocol,
      host: parsed.hostname,
      port,
      ...(auth ? { auth } : {})
    }
  } catch {
    return null
  }
}

export function formatProxyForLog(proxyUrl) {
  if (!proxyUrl) return ''
  try {
    const parsed = new URL(String(proxyUrl))
    const protocol = String(parsed.protocol || '').replace(':', '')
    const host = parsed.hostname || ''
    const port = parsed.port ? `:${parsed.port}` : ''
    return `${protocol}://${host}${port}`
  } catch {
    return String(proxyUrl)
  }
}

export function loadProxyList({ urlsEnvKey, fileEnvKey } = {}) {
  const urlsKey = urlsEnvKey || 'OPEN_ACCOUNTS_SWEEPER_PROXY_URLS'
  const fileKey = fileEnvKey || 'OPEN_ACCOUNTS_SWEEPER_PROXY_FILE'

  const rawUrls = process.env[urlsKey]
  const rawFile = process.env[fileKey]

  const urls = []

  if (rawFile) {
    const path = String(rawFile).trim()
    if (path) {
      try {
        const fileText = fs.readFileSync(path, 'utf8')
        for (const line of String(fileText).split('\n')) {
          const trimmed = String(line || '').trim()
          if (!trimmed || trimmed.startsWith('#')) continue
          urls.push(trimmed)
        }
      } catch (error) {
        console.warn('[ProxyList] failed to read proxy file', { path, message: error?.message || String(error) })
      }
    }
  }

  urls.push(...splitList(rawUrls))

  const seen = new Set()
  const proxies = []
  for (const url of urls) {
    const normalized = String(url || '').trim()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    const config = parseProxyConfig(normalized)
    if (!config) {
      console.warn('[ProxyList] invalid proxy url ignored', { proxy: formatProxyForLog(normalized) })
      continue
    }
    proxies.push({ url: normalized, config })
  }

  return proxies
}

const fnv1a32 = (value) => {
  const input = String(value ?? '')
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

export function pickProxyByHash(proxies = [], key, { attempt = 1 } = {}) {
  const list = Array.isArray(proxies) ? proxies : []
  if (list.length === 0) return null

  const normalizedKey = String(key ?? '').trim()
  const attemptOffset = Math.max(0, Number(attempt || 1) - 1)

  if (!normalizedKey) {
    return list[attemptOffset % list.length] || null
  }

  const base = fnv1a32(normalizedKey)
  const index = (base + attemptOffset) % list.length
  return list[index] || null
}

/**
 * 异步加载代理列表：合并 env + DB 来源，去重
 * @param {Object} [options]
 * @param {string} [options.urlsEnvKey]
 * @param {string} [options.fileEnvKey]
 * @returns {Promise<Array<{url: string, config: object}>>}
 */
export async function loadProxyListAsync(options = {}) {
  // 1. 先从 env 加载（原有逻辑）
  const envProxies = loadProxyList(options)
  const seen = new Set(envProxies.map(p => p.url))

  // 2. 再从 DB 加载页面配置的代理
  try {
    const db = await getDatabase()
    const result = db.exec(
      "SELECT config_value FROM system_config WHERE config_key = 'proxy_list' LIMIT 1"
    )
    const raw = result[0]?.values?.[0]?.[0] || ''
    if (raw) {
      const lines = String(raw)
        .split(/[\r\n]+/)
        .map(line => line.trim())
        .filter(Boolean)

      for (const line of lines) {
        if (seen.has(line)) continue
        seen.add(line)
        const config = parseProxyConfig(line)
        if (!config) {
          console.warn('[ProxyList] invalid DB proxy url ignored', { proxy: formatProxyForLog(line) })
          continue
        }
        envProxies.push({ url: line, config })
      }
    }
  } catch (error) {
    console.warn('[ProxyList] failed to load DB proxy settings', { message: error?.message || String(error) })
  }

  return envProxies
}

/**
 * 从 DB 读取代理模式
 * @returns {Promise<'single' | 'pool'>}
 */
export async function getProxyMode() {
  try {
    const db = await getDatabase()
    const result = db.exec(
      "SELECT config_value FROM system_config WHERE config_key = 'proxy_mode' LIMIT 1"
    )
    const mode = result[0]?.values?.[0]?.[0] || 'single'
    return mode === 'pool' ? 'pool' : 'single'
  } catch {
    return 'single'
  }
}
