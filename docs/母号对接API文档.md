# ChatGPT Team Helper - 母号对接 API 文档

## 概述

本文档说明如何通过 API 向系统添加 ChatGPT Team 母号。

**母号**：拥有 Token 的 Team 账号（管理员账号），用于邀请用户加入 Team 空间。

---

## 接口信息

| 项目 | 值 |
|------|-----|
| 接口地址 | `POST /api/auto-boarding` |
| 认证方式 | API Key |
| Content-Type | `application/json` |

---

## 认证配置

### 1. 设置 API Key

在 `backend/.env` 中配置：

```env
AUTO_BOARDING_API_KEY=your-secret-api-key-here
```

### 2. 请求时携带 API Key

```
x-api-key: your-secret-api-key-here
```

---

## 请求参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| email | string | ✅ | 母号邮箱 |
| token | string | ✅ | Access Token（JWT 格式） |
| refreshToken | string | ❌ | Refresh Token |
| chatgptAccountId | string | ❌ | 账号 ID，格式如 `acct_xxx` |
| oaiDeviceId | string | ❌ | 设备 ID |
| expireAt | string | ❌ | 过期时间，格式 `YYYY/MM/DD HH:mm` |
| isDemoted | boolean | ❌ | 是否降级账号（true/false 或 1/0） |

### 参数说明

- **token**：从 ChatGPT 获取的 Access Token，系统会自动解析其中的过期时间
- **expireAt**：如果不传，系统会自动从 token 中解析过期时间
- **isDemoted**：降级账号无法退出空间但更稳定，默认 false

---

## 响应格式

### 新增账号成功（201）

```json
{
  "success": true,
  "message": "自动上车成功！账号已添加到系统",
  "action": "created",
  "account": {
    "id": 1,
    "email": "example@gmail.com",
    "token": "eyJhbGci...",
    "refreshToken": null,
    "userCount": 1,
    "chatgptAccountId": "acct_xxx",
    "oaiDeviceId": null,
    "expireAt": "2026/03/01 12:00",
    "isDemoted": false,
    "createdAt": "2026-02-05 16:00:00",
    "updatedAt": "2026-02-05 16:00:00"
  },
  "generatedCodes": [
    "XXXX-XXXX-XXXX",
    "YYYY-YYYY-YYYY",
    "ZZZZ-ZZZZ-ZZZZ",
    "WWWW-WWWW-WWWW"
  ],
  "codesMessage": "已自动生成4个兑换码",
  "syncResult": {
    "syncedUserCount": 1,
    "users": {...}
  }
}
```

### 更新已有账号成功（200）

```json
{
  "success": true,
  "message": "账号信息已更新",
  "action": "updated",
  "account": {...},
  "syncResult": {...}
}
```

### 错误响应

```json
{
  "error": "Email and token are required",
  "message": "邮箱和Token是必填项"
}
```

| 状态码 | 说明 |
|--------|------|
| 400 | 参数错误（缺少必填项或格式错误） |
| 401 | API Key 无效 |
| 500 | 服务器错误 |

---

## 调用示例

### cURL

```bash
curl -X POST http://your-server:29527/api/auto-boarding \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-secret-api-key-here" \
  -d '{
    "email": "example@gmail.com",
    "token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "v1.xxx",
    "chatgptAccountId": "acct_123456",
    "isDemoted": false
  }'
```

### Python

```python
import requests

url = "http://your-server:29527/api/auto-boarding"
headers = {
    "Content-Type": "application/json",
    "x-api-key": "your-secret-api-key-here"
}
data = {
    "email": "example@gmail.com",
    "token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "v1.xxx",
    "chatgptAccountId": "acct_123456",
    "isDemoted": False
}

response = requests.post(url, json=data, headers=headers)
result = response.json()

if result.get("success"):
    print(f"操作: {result['action']}")
    print(f"账号ID: {result['account']['id']}")
    if result.get("generatedCodes"):
        print(f"生成的兑换码: {result['generatedCodes']}")
else:
    print(f"错误: {result.get('error')}")
```

### Node.js

```javascript
const response = await fetch('http://your-server:29527/api/auto-boarding', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': 'your-secret-api-key-here'
  },
  body: JSON.stringify({
    email: 'example@gmail.com',
    token: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...',
    refreshToken: 'v1.xxx',
    chatgptAccountId: 'acct_123456',
    isDemoted: false
  })
})

const result = await response.json()
console.log(result)
```

---

## 业务逻辑说明

### 账号匹配规则

系统按以下顺序判断账号是否已存在：

1. 先按 `chatgptAccountId` 匹配
2. 若未匹配到，再按 `email` 匹配（不区分大小写）

### 新增账号时

- 自动生成 **4 个兑换码**（Team 空间默认 5 人，扣除管理员后可邀请 4 人）
- 自动同步账号当前用户数
- 默认 `userCount = 1`（管理员自己）

### 更新账号时

- 仅更新 token、refreshToken、chatgptAccountId 等字段
- 不会重新生成兑换码
- 会重新同步用户数

---

## 统计接口（可选）

### 获取账号统计

```
GET /api/auto-boarding/stats
x-api-key: your-secret-api-key-here
```

响应：

```json
{
  "success": true,
  "stats": {
    "totalAccounts": 10,
    "recentAccounts": 2
  }
}
```

| 字段 | 说明 |
|------|------|
| totalAccounts | 总账号数 |
| recentAccounts | 最近 24 小时新增账号数 |

---

## 常见问题

### Q: 如何获取 Token？

A: 通过 OpenAI OAuth 授权流程获取，或使用系统内置的 OAuth 登录功能。

### Q: 账号已存在会怎样？

A: 系统会更新该账号的 token 等信息，返回 `action: "updated"`。

### Q: 兑换码会重复生成吗？

A: 不会。只有新增账号时才生成兑换码，更新时不会生成。

### Q: isDemoted 有什么作用？

A: 降级账号更稳定（不易被封），但成员无法主动退出空间。根据业务需求设置。
