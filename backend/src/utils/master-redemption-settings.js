import { getDatabase, saveDatabase } from '../database/init.js'

/**
 * 获取万能兑换码配置
 * @returns {Promise<{code: string}>}
 */
export async function getMasterRedemptionSettings() {
  const db = await getDatabase()
  const result = db.exec(`
    SELECT config_key, config_value
    FROM system_config
    WHERE config_key = 'master_redemption_code'
  `)

  let code = ''
  if (result.length > 0 && result[0].values.length > 0) {
    code = String(result[0].values[0][1] || '').trim()
  }

  // 回退到环境变量
  if (!code) {
    code = String(process.env.MASTER_REDEMPTION_CODE || '').trim()
  }

  return { code }
}

/**
 * 更新万能兑换码配置
 * @param {Object} options
 * @param {string} [options.code]
 * @returns {Promise<{created: boolean, updated: boolean}>}
 */
export async function updateMasterRedemptionSettings({ code } = {}) {
  const db = await getDatabase()

  if (code !== undefined && code !== null) {
    const normalizedCode = String(code).trim()
    const existing = db.exec(
      'SELECT id FROM system_config WHERE config_key = ? LIMIT 1',
      ['master_redemption_code']
    )

    if (existing[0]?.values?.length > 0) {
      db.run(
        `UPDATE system_config SET config_value = ?, updated_at = DATETIME('now', 'localtime') WHERE config_key = ?`,
        [normalizedCode, 'master_redemption_code']
      )
      saveDatabase()
      return { created: false, updated: true }
    }

    db.run(
      `INSERT INTO system_config (config_key, config_value, updated_at) VALUES (?, ?, DATETIME('now', 'localtime'))`,
      ['master_redemption_code', normalizedCode]
    )
    saveDatabase()
    return { created: true, updated: false }
  }

  return { created: false, updated: false }
}
