# ChatGPT Team Helper - GPT 上游接口对接清单

## 概览

本文档整理项目当前与 ChatGPT/OpenAI 的上游接口对接情况，覆盖账号校验、成员管理、邀请管理和 Token 刷新流程。

## 统计结果

- 上游域名共 2 个：
  - `chatgpt.com`
  - `auth.openai.com`
- `chatgpt.com/backend-api/accounts/...` 路径模板共 4 个：
  - `/accounts/check/v4-2023-04-27`
  - `/accounts/{chatgptAccountId}/users`
  - `/accounts/{chatgptAccountId}/users/{userId}`
  - `/accounts/{chatgptAccountId}/invites`
- 核心业务动作共 7 类：
  - 校验 Token/拉账号
  - 拉成员
  - 踢成员
  - 拉邀请列表
  - 发邀请
  - 撤回邀请
  - 刷新 Token

## 对接矩阵（本地 -> 上游）

| 业务动作 | 本地入口 | 上游接口 | 代码位置 |
| --- | --- | --- | --- |
| 校验 Token + 获取 Team 账号列表 | `POST /api/gpt-accounts/check-token` | `GET https://chatgpt.com/backend-api/accounts/check/v4-2023-04-27` | `backend/src/routes/gpt-accounts.js:425` / `backend/src/services/account-sync.js:293` |
| 拉成员列表 | `POST /api/gpt-accounts/:id/sync-user-count`（内部也会调用） | `GET https://chatgpt.com/backend-api/accounts/{chatgptAccountId}/users?offset=&limit=&query=` | `backend/src/routes/gpt-accounts.js:1106` / `backend/src/services/account-sync.js:546` |
| 踢成员 | `DELETE /api/gpt-accounts/:id/users/:userId` | `DELETE https://chatgpt.com/backend-api/accounts/{chatgptAccountId}/users/{userId}` | `backend/src/routes/gpt-accounts.js:1132` / `backend/src/services/account-sync.js:761` |
| 拉邀请列表 | `GET /api/gpt-accounts/:id/invites` | `GET https://chatgpt.com/backend-api/accounts/{chatgptAccountId}/invites?offset=&limit=&query=` | `backend/src/routes/gpt-accounts.js:1185` / `backend/src/services/account-sync.js:429` |
| 发邀请（管理后台） | `POST /api/gpt-accounts/:id/invite-user` | `POST https://chatgpt.com/backend-api/accounts/{chatgptAccountId}/invites` | `backend/src/routes/gpt-accounts.js:1152` / `backend/src/services/account-sync.js:837` |
| 发邀请（兑换/自动上车流程） | 兑换码、候车室等业务流程内部调用 | `POST https://chatgpt.com/backend-api/accounts/{chatgptAccountId}/invites` | `backend/src/services/chatgpt-invite.js:126` |
| 撤回邀请 | `DELETE /api/gpt-accounts/:id/invites` | `DELETE https://chatgpt.com/backend-api/accounts/{chatgptAccountId}/invites`（Body: `email_address`） | `backend/src/routes/gpt-accounts.js:1203` / `backend/src/services/account-sync.js:498` |
| 刷新 Access Token | `POST /api/gpt-accounts/:id/refresh-token`；批量检查状态时也会自动尝试 | `POST https://auth.openai.com/oauth/token` | `backend/src/routes/gpt-accounts.js:1224` / `backend/src/routes/gpt-accounts.js:169` |

## OAuth 相关（后台辅助能力）

管理后台“获取 Refresh Token”功能会额外使用 OpenAI OAuth：

- 生成授权链接：`GET {OPENAI_BASE_URL}/oauth/authorize?...`
- 交换授权码：`POST {OPENAI_BASE_URL}/oauth/token`

代码位置：`backend/src/routes/openai-accounts.js:105`、`backend/src/routes/openai-accounts.js:193`。

默认 `OPENAI_BASE_URL` 为 `https://auth.openai.com`。

## 关键请求特征

- ChatGPT Backend API 调用统一使用 Bearer Token（账号 access token）。
- 成员与邀请接口依赖 `chatgptAccountId`，无该字段无法执行拉人/踢人/邀请管理。
- 邀请接口请求体使用：
  - `email_addresses: [email]`
  - `role: "standard-user"`
  - `resend_emails: true`
- 撤回邀请接口请求体使用：
  - `email_address: email`

## 状态联动说明

当上游返回 `account_deactivated` 时，系统会自动将本地账号标记为封号并关闭开放状态：

- `is_banned = 1`
- `is_open = 0`
- `ban_processed = 0`

代码位置：`backend/src/services/account-sync.js:376`。

