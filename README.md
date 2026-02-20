# 墨韵AI | Ink-Aesthetics AI

前端（Vite + React）+ 后端（FastAPI + SQLAlchemy Async）一体项目。  
当前已支持：
- 手机号验证码注册（含账户名）
- 账号密码登录 / 短信登录 / QQ微信快捷登录（演示）
- JWT + Refresh Token 持久化会话
- MySQL 持久化用户、短信码、刷新会话、账单等数据

## 1) MySQL 准备

先在 MySQL 中建库（示例）：

```sql
CREATE DATABASE IF NOT EXISTS inkai DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

或直接执行初始化脚本（先改密码）：

```bash
mysql -uroot -p < scripts/mysql-init.sql
```

## 2) 配置 `.env`

参考 `.env.example`，关键项如下：

```env
DATABASE_URL=mysql+aiomysql://你的用户名:你的密码@127.0.0.1:3306/inkai?charset=utf8mb4
JWT_SECRET_KEY=请改成随机长字符串
ROOT_USERNAME=root
ROOT_PASSWORD=Yangfan724@
```

其他 DeepSeek / LiblibAI 配置也写在 `.env` 中，不需要每次手动 `set $env`。

## 3) 安装后端依赖

```bash
python -m pip install fastapi uvicorn sqlalchemy aiomysql aiosqlite python-dotenv httpx pyjwt
```

说明：虽然当前主库建议 MySQL，安装 `aiosqlite` 可保留本地快速调试能力。

## 4) 启动后端

```bash
python -m uvicorn main:app --host 127.0.0.1 --port 8787 --reload
```

启动时会自动建表，并自动确保默认管理员账号存在：
- 用户名：`root`
- 密码：`Yangfan724@`

## 5) 启动前端

```bash
npm install
npm run dev
```

前端默认通过 `.env` 的后端地址访问接口。
    
