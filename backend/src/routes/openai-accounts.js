import express from 'express'
import crypto from 'crypto'
import axios from 'axios'
import { apiKeyAuth } from '../middleware/api-key-auth.js'
import { setOAuthSession, getOAuthSession, deleteOAuthSession } from '../services/oauth-session-store.js'

const router = express.Router()

const OPENAI_CONFIG = {
  BASE_URL: process.env.OPENAI_BASE_URL || 'https://auth.openai.com',
  CLIENT_ID: process.env.OPENAI_CLIENT_ID || 'app_EMoamEEZ73f0CkXaXp7hrann',
  REDIRECT_URI: 'http://localhost:1455/auth/callback',
  SCOPE: 'openid email profile offline_access',
  PROMPT: 'login'
}

function parseProxyConfig(proxyUrl) {
  if (!proxyUrl) return null

  try {
    const parsed = new URL(proxyUrl)
    if (!parsed.hostname) {
      return null
    }

    const port = parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80

    const auth = parsed.username
      ? {
          username: decodeURIComponent(parsed.username),
          password: decodeURIComponent(parsed.password || '')
        }
      : undefined

    return {
      protocol: parsed.protocol?.replace(':', '') || 'http',
      host: parsed.hostname,
      port,
      auth
    }
  } catch (error) {
    console.warn('Invalid proxy url provided for OpenAI OAuth:', error.message)
    return null
  }
}

function decodeJwtPayload(token) {
  const parts = token.split('.')
  if (parts.length !== 3) {
    throw new Error('Invalid ID token format')
  }

  const payloadSegment = parts[1].replace(/-/g, '+').replace(/_/g, '/')
  const paddedPayload = payloadSegment.padEnd(Math.ceil(payloadSegment.length / 4) * 4, '=')
  const decoded = Buffer.from(paddedPayload, 'base64').toString('utf-8')
  return JSON.parse(decoded)
}

function generateOpenAIPKCE() {
  const codeVerifier = crypto.randomBytes(64).toString('hex')
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url')

  return { codeVerifier, codeChallenge }
}

function resolveOpenAIOAuthErrorDetail(error) {
  if (!error?.response) {
    return error?.message || '未知错误'
  }

  const responseData = error.response.data
  if (typeof responseData === 'string' && responseData.trim()) {
    return responseData.trim()
  }

  return (
    responseData?.error?.message ||
    responseData?.error_description ||
    responseData?.error ||
    error.message ||
    '未知错误'
  )
}

function buildOpenAIOAuthExchangeErrorMessage(error) {
  const detail = resolveOpenAIOAuthErrorDetail(error)
  const normalized = String(detail).toLowerCase()

  if (normalized.includes('redirect_uri')) {
    return `交换授权码失败：redirect_uri 不匹配，请确认 OpenAI 应用配置、生成授权链接和换码请求都使用 ${OPENAI_CONFIG.REDIRECT_URI}`
  }

  if (
    normalized.includes('invalid_grant') ||
    normalized.includes('authorization code') ||
    normalized.includes('code verifier') ||
    normalized.includes('code_verifier')
  ) {
    return '交换授权码失败：授权码无效、已过期，或授权链接与当前会话不一致，请重新生成授权链接后再试'
  }

  return `交换授权码失败：${detail}`
}

router.post('/generate-auth-url', apiKeyAuth, async (req, res) => {
  try {
    const { proxy } = req.body || {}

    const pkce = generateOpenAIPKCE()
    const state = crypto.randomBytes(32).toString('hex')
    const sessionId = crypto.randomUUID()

    const createdAt = new Date()
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000)

    setOAuthSession(sessionId, {
      codeVerifier: pkce.codeVerifier,
      codeChallenge: pkce.codeChallenge,
      state,
      proxy: proxy || null,
      platform: 'openai',
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString()
    })

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: OPENAI_CONFIG.CLIENT_ID,
      redirect_uri: OPENAI_CONFIG.REDIRECT_URI,
      scope: OPENAI_CONFIG.SCOPE,
      code_challenge: pkce.codeChallenge,
      code_challenge_method: 'S256',
      state,
      prompt: OPENAI_CONFIG.PROMPT,
      id_token_add_organizations: 'true',
      codex_cli_simplified_flow: 'true'
    })

    const authUrl = `${OPENAI_CONFIG.BASE_URL}/oauth/authorize?${params.toString()}`

    console.log('🔗 Generated OpenAI OAuth authorization URL', {
      sessionId,
      redirectUri: OPENAI_CONFIG.REDIRECT_URI,
      scope: OPENAI_CONFIG.SCOPE,
      prompt: OPENAI_CONFIG.PROMPT,
      hasProxy: !!proxy
    })

    return res.json({
      success: true,
      data: {
        authUrl,
        sessionId,
        instructions: [
          '1. 复制上面的链接到浏览器中打开',
          '2. 登录您的 OpenAI 账户',
          '3. 同意应用权限',
          '4. 复制浏览器地址栏中的完整 URL（包含 code 参数）',
          '5. 在添加账户表单中粘贴完整的回调 URL'
        ]
      }
    })
  } catch (error) {
    console.error('生成 OpenAI OAuth URL 失败:', error)
    return res.status(500).json({
      success: false,
      message: '生成授权链接失败',
      error: error.message
    })
  }
})

router.post('/exchange-code', apiKeyAuth, async (req, res) => {
  try {
    const { code, sessionId } = req.body || {}

    if (!code || !sessionId) {
      return res.status(400).json({
        success: false,
        message: '缺少必要参数'
      })
    }

    const sessionData = getOAuthSession(sessionId)
    if (!sessionData) {
      return res.status(400).json({
        success: false,
        message: '会话已过期或无效'
      })
    }

    if (!sessionData.codeVerifier) {
      return res.status(400).json({
        success: false,
        message: '会话缺少验证信息，请重新生成授权链接'
      })
    }

    const tokenPayload = new URLSearchParams({
      grant_type: 'authorization_code',
      code: String(code).trim(),
      redirect_uri: OPENAI_CONFIG.REDIRECT_URI,
      client_id: OPENAI_CONFIG.CLIENT_ID,
      code_verifier: sessionData.codeVerifier
    }).toString()

    const axiosConfig = {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      timeout: 60000
    }

    const proxyConfig = parseProxyConfig(sessionData.proxy)
    if (proxyConfig) {
      axiosConfig.proxy = proxyConfig
    }

    console.log('Exchanging OpenAI authorization code', {
      sessionId,
      hasProxy: !!proxyConfig,
      codeLength: String(code).length,
      redirectUri: OPENAI_CONFIG.REDIRECT_URI
    })

    const tokenResponse = await axios.post(
      `${OPENAI_CONFIG.BASE_URL}/oauth/token`,
      tokenPayload,
      axiosConfig
    )

    const { id_token: idToken, access_token: accessToken, refresh_token: refreshToken, expires_in: expiresIn } = tokenResponse.data || {}

    if (!idToken || !accessToken) {
      throw new Error('未返回有效的授权令牌')
    }

    if (!refreshToken) {
      console.warn('OpenAI OAuth token exchange returned no refresh token', {
        sessionId,
        scope: OPENAI_CONFIG.SCOPE,
        prompt: OPENAI_CONFIG.PROMPT
      })
    }

    const payload = decodeJwtPayload(idToken)
    const authClaims = payload['https://api.openai.com/auth'] || {}
    const organizations = authClaims.organizations || []
    const defaultOrg = organizations.find(org => org.is_default) || organizations[0] || {}

    deleteOAuthSession(sessionId)

    console.log('✅ OpenAI OAuth token exchange successful', {
      sessionId,
      accountId: authClaims.chatgpt_account_id
    })

    return res.json({
      success: true,
      data: {
        tokens: {
          idToken,
          accessToken,
          refreshToken,
          expiresIn: expiresIn || 0
        },
        accountInfo: {
          accountId: authClaims.chatgpt_account_id || '',
          chatgptUserId: authClaims.chatgpt_user_id || authClaims.user_id || '',
          organizationId: defaultOrg.id || '',
          organizationRole: defaultOrg.role || '',
          organizationTitle: defaultOrg.title || '',
          planType: authClaims.chatgpt_plan_type || '',
          email: payload.email || '',
          name: payload.name || '',
          emailVerified: payload.email_verified || false,
          organizations
        }
      }
    })
  } catch (error) {
    console.error('OpenAI OAuth token exchange failed:', {
      message: error.message,
      detail: resolveOpenAIOAuthErrorDetail(error),
      status: error.response?.status,
      data: error.response?.data
    })
    return res.status(500).json({
      success: false,
      message: buildOpenAIOAuthExchangeErrorMessage(error),
      error: resolveOpenAIOAuthErrorDetail(error)
    })
  }
})

export default router
