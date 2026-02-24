# ink-aesthetics-ai

`ink-aesthetics-ai` 是一个「AI 绘图 + 社区 + 论坛 + 管理后台」一体化全栈项目。  
前端基于 React 19 + TypeScript + Vite，后端基于 FastAPI + SQLAlchemy Async + MySQL（aiomysql）。

## 1. 项目定位

- 面向中国水墨风格的 AI 创作与社区协作平台
- 包含工作台、画廊、论坛、个人中心、超级管理后台
- 覆盖认证、积分计费、审核风控、运营监控、导出能力
- 不包含任何商业化变现能力（模型市场、订阅、开放计费 API 等）

## 2. 技术栈

- 前端：React 19、TypeScript、Vite、Tailwind、Radix、Wouter
- 后端：FastAPI、Pydantic、SQLAlchemy Async、JWT（可选 SuperTokens）
- 数据库：MySQL 8.0+（aiomysql）
- 缓存与队列：Redis（异步客户端）
- 调度：APScheduler（可选）

## 3. 已实现功能总览

### 3.1 前端

- 门户页、登录注册、权限路由守卫
- AI 工作台：
  - DeepSeek 提示词优化
  - 批量出图
  - Prompt 版本管理（本地 + 云端）
  - 绘图参数模板预设（本地 + 云端）
  - 任务进度展示与暂停/继续/取消
- 画廊社区：
  - 发布/取消发布/删除
  - 点赞、评论、举报、转发
  - 关注作者与关注流
  - 图片懒加载、WebP/CDN 适配
- 论坛：
  - 提问、回答、点赞、结帖
  - 搜索、标签筛选、排序（热度/最新/待回答）
  - 邀请回答
- 个人中心：
  - 资料编辑、改密
  - 积分与规则展示
  - 作品与社区统计
  - 反馈工单与回复已读
- 超级管理后台：
  - 运营概览、阈值配置
  - 告警、反馈、数据导出
  - API 权限与计费规则调整
- 全局能力：
  - 多语言（zh-CN/zh-TW/en-US）
  - 主题切换
  - 全局 AI 助手浮窗
  - 页面埋点与心跳

### 3.2 后端

- 健康检查、认证用户、社区论坛、积分计费、管理后台等业务路由（含 51+ 路由）
- DeepSeek 与 liblibai 代理调用
- Redis 生命周期管理与依赖注入
- 热点缓存（社区列表/论坛列表/用户会话/系统阈值）
- Redis Stream 绘图任务队列（入队、消费、重试、DLQ）
- WebSocket 绘图进度推送
- Redis 高频计数 + 定时回写
- 主从读写路由（`DATABASE_URL` + `DATABASE_READ_URL`）
- 用户级/IP 级限流 + 成本熔断
- 操作审计日志、告警与反馈闭环能力

## 4. 目录结构（关键）

- 前端入口：`src/main.tsx`、`src/App.tsx`
- 业务页面：`src/pages/Workspace.tsx`、`src/pages/Gallery.tsx`、`src/pages/Forum.tsx`、`src/pages/Profile.tsx`、`src/pages/SuperAdmin.tsx`
- 多语言上下文：`src/contexts/LocaleContext.tsx`
- 后端入口：`main.py`
- 数据库层：`db.py`、`models.py`
- 配置模板：`.env.example`
- SQL 脚本：`scripts/mysql-init.sql`、`scripts/ddl_20260223_backend_extensions.sql`、`scripts/ddl_20260224_time_partitions.sql`

## 5. 快速开始

### 5.1 准备 MySQL

```sql
CREATE DATABASE IF NOT EXISTS inkai
DEFAULT CHARACTER SET utf8mb4
COLLATE utf8mb4_unicode_ci;
```

可选：执行初始化脚本

```bash
mysql -uroot -p < scripts/mysql-init.sql
```

### 5.2 准备环境变量

```bash
cp .env.example .env
```

至少确认以下字段：

- `DATABASE_URL`
- `DATABASE_READ_URL`（可与主库相同）
- `DEEPSEEK_API_KEY`
- `LIBLIBAI_ACCESS_KEY` / `LIBLIBAI_SECRET_KEY`
- `JWT_SECRET_KEY`

### 5.3 安装依赖

```bash
# backend
python -m pip install fastapi uvicorn sqlalchemy aiomysql aiosqlite python-dotenv httpx pyjwt redis apscheduler

# frontend
npm install
```

### 5.4 启动项目

```bash
# backend
python -m uvicorn main:app --host 127.0.0.1 --port 8787 --reload

# frontend
npm run dev
```

- 前端地址：`http://127.0.0.1:5173`
- 后端健康检查：`http://127.0.0.1:8787/health`

## 6. 构建与检查

```bash
python -m py_compile main.py db.py models.py
npm run build
```

## 7. 配置说明（新增重点）

### 7.1 主从与连接池

- `DATABASE_URL`
- `DATABASE_READ_URL`
- `DB_POOL_SIZE`
- `DB_MAX_OVERFLOW`
- `DB_POOL_RECYCLE_SECONDS`

### 7.2 Redis / 队列

- `REDIS_CACHE_ENABLED`
- `REDIS_URL` / `REDIS_PASSWORD` / `REDIS_DB` / `REDIS_TIMEOUT_SEC`
- `GENERATION_QUEUE_ENABLED`
- `GENERATION_QUEUE_MAX_RETRY`
- `REDIS_STREAM_GEN_KEY` / `REDIS_STREAM_GEN_DLQ_KEY` / `REDIS_STREAM_GROUP`

### 7.3 限流 / 计数回写

- `RATE_LIMIT_ENABLED`
- `RATE_LIMIT_IP_LIMIT` / `RATE_LIMIT_IP_WINDOW_SEC`
- `RATE_LIMIT_USER_LIMIT` / `RATE_LIMIT_USER_WINDOW_SEC`
- `COUNTER_SYNC_ENABLED`
- `COUNTER_SYNC_HOURLY_CRON_MINUTE`
- `COUNTER_SYNC_DAILY_CRON_HOUR` / `COUNTER_SYNC_DAILY_CRON_MINUTE`

### 7.4 内容安全

- `CONTENT_SAFETY_PROVIDER`（`off` / `aliyun` / `tencent`）
- `CONTENT_SAFETY_ENDPOINT`
- `CONTENT_SAFETY_ACCESS_KEY`
- `CONTENT_SAFETY_SECRET_KEY`

## 8. SQL 脚本说明

- `scripts/ddl_20260223_backend_extensions.sql`
  - 新增表（审计日志、关注关系、Prompt 版本/模板、计数快照等）
  - 论坛增强字段（标签、邀请回答）
  - 高频查询联合索引补充
- `scripts/ddl_20260224_time_partitions.sql`
  - `api_call_logs` / `website_visit_logs` 月分区方案
  - 分区维护存储过程与事件

## 9. DeepSeek 代理说明

- 登录态下：`/api/deepseek/chat`、`/api/prompt/optimize`
- 非登录态下：前端会自动 fallback 到
  - `/api/public/deepseek/chat`
  - `/api/public/prompt/optimize`
- 避免出现 `Missing bearer token` 导致前端无法得到有效回复

## 10. 许可证与约束

- 本项目当前为内部研发/原型工程
- 严格禁止在当前代码分支中引入商业化变现功能

## 11. Admin Dashboard / Moderation / Export (2026-02)

### 11.1 New environment variables

Add the following keys to `.env` (already included in `.env.example`):

- `ADMIN_STATS_CACHE_TTL_SEC`
- `EXPORT_QUEUE_ENABLED`
- `EXPORT_QUEUE_WAIT_TIMEOUT_SEC`
- `REDIS_STREAM_EXPORT_KEY`
- `REDIS_STREAM_EXPORT_DLQ_KEY`
- `REDIS_STREAM_EXPORT_GROUP`
- `REDIS_STREAM_EXPORT_CONSUMER_PREFIX`
- `ADMIN_EXPORT_DIR`
- `ADMIN_EXPORT_RETENTION_HOURS`

### 11.2 New admin APIs

- `GET /api/admin/stats/realtime`
- `GET /api/admin/stats/trends`
- `GET /api/admin/stats/api-latency`
- `GET /api/admin/stats/all`

- `GET /api/admin/moderation/tickets`
- `GET /api/admin/moderation/tickets/{ticket_id}`
- `POST /api/admin/moderation/tickets/{ticket_id}/claim`
- `POST /api/admin/moderation/tickets/{ticket_id}/decision`
- `POST /api/admin/moderation/tickets/{ticket_id}/final-judgment`
- `POST /api/moderation/tickets/{ticket_id}/appeal`

- `POST /api/admin/export/tasks`
- `GET /api/admin/export/tasks`
- `GET /api/admin/export/status/{task_id}`
- `GET /api/admin/export/download/{task_id}`

### 11.3 SuperAdmin frontend routes

- `/super-admin` (ops)
- `/super-admin/dashboard`
- `/super-admin/moderation`
- `/super-admin/export`


## 12. Redis Export Fallback + Notifications (2026-02-24)

### 12.1 Redis config compatibility

Backend supports both URL-style and host/port-style Redis config:

- `REDIS_ENABLED`
- `REDIS_HOST`
- `REDIS_PORT`
- `REDIS_DB`
- `REDIS_PASSWORD`
- `REDIS_URL` (optional, has priority when provided)

When Redis is unavailable, service degrades gracefully:

- hot cache/counters use in-memory fallback
- export task dispatch falls back to local async worker (no 503)

### 12.2 Export APIs

- `POST /api/admin/export/tasks`
- `GET /api/admin/export/tasks`
- `GET /api/admin/export/tasks/{task_id}`
- `GET /api/admin/export/status/{task_id}`
- `GET /api/admin/export/download/{task_id}`

Export status flow:

- `pending -> processing -> completed|failed`

### 12.3 Notification APIs

- `GET /api/notifications`
- `GET /api/notifications/unread-count`
- `PUT /api/notifications/{id}/read`
- `PUT /api/notifications/read-all`

Triggered notification types:

- `EXPORT_SUCCESS`
- `EXPORT_FAILED`
- `MODERATION_TICKET_ASSIGNED`
- `MODERATION_APPEAL_SUBMITTED`

### 12.4 New SQL script

- `scripts/ddl_20260225_notifications.sql`

### 12.5 Backend dependencies

A `requirements.txt` file is included. Key Redis-related deps:

- `redis>=4.2.0`
- `aioredis>=2.0.1`

