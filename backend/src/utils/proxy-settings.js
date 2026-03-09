import { getDatabase, saveDatabase } from '../database/init.js'
import axios from 'axios'
import { SocksProxyAgent } from 'socks-proxy-agent'
import { HttpsProxyAgent } from 'https-proxy-agent'

/**
 * 解析代理配置文本
 * @param {string} text - 代理配置文本，支持换行分隔
 * @returns {string[]} 解析后的代理数组
 */
export function parseProxyText(text) {
  if (!text) return []
  return String(text)
    .split(/[\r\n]+/)
    .map(line => line.trim())
    .filter(Boolean)
}

/**
 * 格式化代理数组为文本
 * @param {string[]} proxies - 代理数组
 * @returns {string} 格式化后的文本
 */
export function formatProxyText(proxies) {
  if (!Array.isArray(proxies)) return ''
  return proxies.filter(Boolean).join('\n')
}

/**
 * 获取代理配置
 * @returns {Promise<{proxies: string[], mode: 'single' | 'pool'}>}
 */
export async function getProxySettings() {
  const db = await getDatabase()
  const result = db.exec(`
    SELECT config_key, config_value
    FROM system_config
    WHERE config_key IN ('proxy_list', 'proxy_mode')
  `)

  const config = {}
  if (result.length > 0) {
    for (const [key, value] of result[0].values) {
      config[key] = value
    }
  }

  const proxyList = config.proxy_list || ''
  const proxies = parseProxyText(proxyList)
  const mode = config.proxy_mode || 'single'

  return { proxies, mode }
}

/**
 * 更新代理配置
 * @param {Object} options
 * @param {string[]} [options.proxies] - 代理数组
 * @param {'single' | 'pool'} [options.mode] - 代理模式
 * @returns {Promise<{created: boolean, updated: boolean}>}
 */
export async function updateProxySettings({ proxies, mode } = {}) {
  const db = await getDatabase()

  let created = false
  let updated = false

  // 更新代理列表
  if (proxies !== undefined && proxies !== null) {
    const proxyText = formatProxyText(proxies)
    const existing = db.exec(
      'SELECT id FROM system_config WHERE config_key = ? LIMIT 1',
      ['proxy_list']
    )

    if (existing[0]?.values?.length > 0) {
      db.run(
        `UPDATE system_config SET config_value = ?, updated_at = DATETIME('now', 'localtime') WHERE config_key = ?`,
        [proxyText, 'proxy_list']
      )
      updated = true
    } else {
      db.run(
        `INSERT INTO system_config (config_key, config_value, updated_at) VALUES (?, ?, DATETIME('now', 'localtime'))`,
        ['proxy_list', proxyText]
      )
      created = true
    }
  }

  // 更新代理模式
  if (mode !== undefined && mode !== null) {
    const existing = db.exec(
      'SELECT id FROM system_config WHERE config_key = ? LIMIT 1',
      ['proxy_mode']
    )

    if (existing[0]?.values?.length > 0) {
      db.run(
        `UPDATE system_config SET config_value = ?, updated_at = DATETIME('now', 'localtime') WHERE config_key = ?`,
        [mode, 'proxy_mode']
      )
      updated = true
    } else {
      db.run(
        `INSERT INTO system_config (config_key, config_value, updated_at) VALUES (?, ?, DATETIME('now', 'localtime'))`,
        ['proxy_mode', mode]
      )
      created = true
    }
  }

  saveDatabase()
  return { created, updated }
}

/**
 * 验证代理地址格式
 * @param {string} proxy - 代理地址
 * @returns {boolean}
 */
export function isValidProxyUrl(proxy) {
  if (!proxy) return false

  // 支持 http://, https://, socks://, socks5://
  const proxyRegex = /^(https?|socks[45]?):\/\/[^:]+:\d+$/
  return proxyRegex.test(proxy)
}

/**
 * 根据代理 URL 创建对应的 agent
 * @param {string} proxy - 代理地址
 * @returns {SocksProxyAgent | HttpsProxyAgent}
 */
function createProxyAgent(proxy) {
  const protocol = proxy.split('://')[0]?.toLowerCase()

  if (protocol.startsWith('socks')) {
    return new SocksProxyAgent(proxy)
  } else {
    // http 或 https
    return new HttpsProxyAgent(proxy)
  }
}

/**
 * 测试单个代理
 * @param {string} proxy - 代理地址
 * @param {string} [testUrl] - 测试目标 URL，默认为 ChatGPT API
 * @param {number} [timeout] - 超时时间（毫秒）
 * @returns {Promise<{success: boolean, latency?: number, error?: string}>}
 */
export async function testSingleProxy(proxy, testUrl = 'https://api.openai.com/v1/models', timeout = 10000) {
  if (!isValidProxyUrl(proxy)) {
    return { success: false, error: '代理地址格式无效' }
  }

  const startTime = Date.now()

  try {
    const agent = createProxyAgent(proxy)

    const response = await axios.get(testUrl, {
      httpsAgent: agent,
      httpAgent: agent,
      timeout,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      validateStatus: () => true // 接受所有状态码
    })

    const latency = Date.now() - startTime

    // ChatGPT API 返回 401 是正常的（需要认证），只要能连通就说明代理可用
    if (response.status === 401 || response.status === 200 || response.status === 404) {
      return { success: true, latency }
    }

    return {
      success: false,
      error: `HTTP ${response.status}`,
      latency
    }
  } catch (error) {
    const latency = Date.now() - startTime
    return {
      success: false,
      error: error.message || '连接失败',
      latency
    }
  }
}

/**
 * 测试多个代理
 * @param {string[]} proxies - 代理数组
 * @param {string} [testUrl] - 测试目标 URL
 * @returns {Promise<Array<{proxy: string, success: boolean, latency?: number, error?: string}>>}
 */
export async function testMultipleProxies(proxies, testUrl) {
  if (!Array.isArray(proxies) || proxies.length === 0) {
    return []
  }

  // 并发测试所有代理
  const results = await Promise.all(
    proxies.map(async (proxy) => {
      const result = await testSingleProxy(proxy, testUrl)
      return { proxy, ...result }
    })
  )

  return results
}
