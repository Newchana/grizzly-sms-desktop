# Grizzly SMS Desktop

Windows 桌面客户端，用于管理 Grizzly SMS 余额、租用号码、自动接收验证码和保存本地激活历史。

## 功能

- API Key 连接验证
- Windows `safeStorage` 加密保存 API Key
- 查看余额
- 按服务、国家和价格上限租用号码
- 官网活动记录同步与本地历史归档
- 限流轮询、失败退避与 `getStatusV2` 短信解析
- 完成或取消激活
- 损坏数据自动从本地备份恢复
- 可配置轮询间隔

## 开发

```powershell
npm install
npm run dev
```

## 构建

```powershell
npm run dist
```

安装包输出到 `release/`。

## 测试

```powershell
npm test
```

## 安全说明

- 渲染进程没有 Node.js 权限。
- API Key 仅在 Electron 主进程使用。
- API Key 通过 Electron `safeStorage` 加密后写入本机用户数据目录。
- 客户端不会记录包含 API Key 的请求 URL。
- API 地址锁定为 `https://api.grizzlysms.com`，避免密钥被发送到非官方主机。

## 历史记录范围

Grizzly SMS 官方客户端 API 仅提供当前活动激活记录。客户端会同步这些记录，并将已结束记录作为本机归档继续保存。

## 使用范围

请仅将虚拟号码用于你有权操作的账户和符合目标服务条款的验证流程。
