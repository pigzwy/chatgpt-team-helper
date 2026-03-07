import express from 'express'
import { getTurnstileSettings } from '../utils/turnstile-settings.js'
import { getFeatureFlags } from '../utils/feature-flags.js'
import { getChannels } from '../utils/channels.js'
import { authenticateToken } from '../middleware/auth.js'
import { requireMenu } from '../middleware/rbac.js'

const router = express.Router()

const DEFAULT_TIMEZONE = 'Asia/Shanghai'
const DEFAULT_LOCALE = 'zh-CN'
const DEFAULT_OPEN_ACCOUNTS_MAINTENANCE_MESSAGE = '平台维护中'

const isEnabledFlag = (value, defaultValue = true) => {
  if (value === undefined || value === null || value === '') return Boolean(defaultValue)
  const raw = String(value).trim().toLowerCase()
  return raw !== '0' && raw !== 'false' && raw !== 'off'
}

const isOpenAccountsEnabled = () => isEnabledFlag(process.env.OPEN_ACCOUNTS_ENABLED, true)

const getOpenAccountsMaintenanceMessage = () => {
  const message = String(process.env.OPEN_ACCOUNTS_MAINTENANCE_MESSAGE || DEFAULT_OPEN_ACCOUNTS_MAINTENANCE_MESSAGE).trim()
  return message || DEFAULT_OPEN_ACCOUNTS_MAINTENANCE_MESSAGE
}

const normalizeMasterRedemptionCode = (value) => {
  const normalized = value == null ? '' : String(value).trim()
  if (normalized && normalized.length < 4) {
    const error = new Error('万能兑换码至少需要 4 个字符')
    error.status = 400
    throw error
  }
  return normalized
}

router.get('/master-redemption', authenticateToken, requireMenu('system_settings'), async (req, res) => {
  try {
    const { getMasterRedemptionSettings } = await import('../utils/master-redemption-settings.js')
    const settings = await getMasterRedemptionSettings()
    res.json({ code: settings.code || '' })
  } catch (error) {
    console.error('[Config] get master redemption error:', error)
    res.status(500).json({ error: '加载失败' })
  }
})

router.get('/runtime', async (req, res) => {
  try {
    const timezone = process.env.TZ || DEFAULT_TIMEZONE
    const locale = process.env.APP_LOCALE || DEFAULT_LOCALE
    const openAccountsEnabled = isOpenAccountsEnabled()
    const turnstileSettings = await getTurnstileSettings()
    const turnstileSiteKey = String(turnstileSettings.siteKey || '').trim()
    const features = await getFeatureFlags()
    const { list: channelList } = await getChannels()
    const channels = (channelList || [])
      .filter(channel => channel?.isActive)
      .map(channel => ({
        key: channel.key,
        name: channel.name,
        redeemMode: channel.redeemMode,
        allowCommonFallback: channel.allowCommonFallback,
        isActive: channel.isActive,
        isBuiltin: channel.isBuiltin,
        sortOrder: channel.sortOrder,
        createdAt: channel.createdAt,
        updatedAt: channel.updatedAt,
      }))

    res.json({
      timezone,
      locale,
      turnstileEnabled: Boolean(turnstileSettings.enabled),
      turnstileSiteKey: turnstileSiteKey || null,
      features,
      channels,
      openAccountsEnabled,
      openAccountsMaintenanceMessage: openAccountsEnabled ? null : getOpenAccountsMaintenanceMessage()
    })
  } catch (error) {
    console.error('[Config] runtime error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.patch('/master-redemption', authenticateToken, requireMenu('system_settings'), async (req, res) => {
  try {
    if (!Object.prototype.hasOwnProperty.call(req.body || {}, 'code')) {
      return res.status(400).json({ error: 'code is required' })
    }

    const normalizedCode = normalizeMasterRedemptionCode(req.body?.code)
    const { updateMasterRedemptionSettings } = await import('../utils/master-redemption-settings.js')
    await updateMasterRedemptionSettings({ code: normalizedCode })
    res.json({
      message: normalizedCode ? '万能兑换码已更新' : '万能兑换码已禁用',
      code: normalizedCode
    })
  } catch (error) {
    console.error('[Config] update master redemption error:', error)
    res.status(error.status || 500).json({ error: error.message || '更新失败' })
  }
})

export default router
