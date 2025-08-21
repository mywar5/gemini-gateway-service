# Gemini 智能网关：生产级 Gemini API 代理服务

[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![Docker](https://img.shields.io/badge/Docker-Ready-blue.svg)](https://www.docker.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**一个高性能、生产级的代理服务，旨在将任何兼容 OpenAI API 的应用程序无缝对接到 Google 的 Gemini API。**

本服务通过智能管理一个由多个 Gemini 账户组成的资源池，提供一个统一、稳定且标准的 OpenAI API v1 端点。它利用先进的 **汤普森采样 (Thompson Sampling)** 算法实现智能负载均衡和自动故障转移，确保服务的高可用性和最佳性能。

---

## ✨ 核心特性

- **无缝兼容 OpenAI**: 无需修改任何代码，即可将您现有的 OpenAI 应用（如 NextChat, LobeChat）即时切换到 Gemini。
- **智能多账户负载均衡**:
    - **汤普森采样算法**: 超越简单的轮询机制，采用复杂的贝叶斯方法。它基于对各账户历史成功率和失败率的统计分析，动态地将流量路由到表现最佳的账户。
    - **探索与利用的平衡**: 完美平衡了“利用”已知最佳账户和“探索”其他账户的潜力，确保长期稳定性和高吞吐量。
- **自动故障转移与恢复**:
    - **透明重试**: 当某个账户的请求失败时（例如，由于速率限制或API错误），服务会立即“冻结”该账户，并使用资源池中次优的账户进行透明重试。
    - **指数退避与抖动**: 对失败的账户实施指数退避策略，逐步增加其冷却时间，以避免对有问题的端点造成持续冲击。
- **静默的令牌刷新**: 在后台自动处理 Gemini OAuth 令牌的刷新和持久化，无需任何手动维护。
- **零配置与简化设置**:
    - **固定的凭证路径**: 所有账户凭证都存储在项目根目录的 `/accounts` 文件夹中，无需配置路径。
    - **交互式设置向导**: 只需一个简单的 `npm run setup` 命令，即可通过半自动化的问答流程，引导您获取并配置所有必需的凭证。
- **生产就绪**:
    - **一键式 Docker 部署**: 提供优化的多阶段 `Dockerfile` 和 `docker-compose.yml`，可实现轻量、安全且可扩展的容器化部署。
    - **高性能 HTTP/2 代理**: 利用 `hpagent` 管理一个持久化的 HTTP/2 连接池，确保 API 请求的低延迟和高吞吐量。

## 🚀 快速开始

本指南将引导您使用推荐的 **交互式设置向导** 来部署和运行服务。

### 步骤 1: 准备 Google Cloud 项目

您需要为希望使用的每个 Google 账户准备一个对应的、并已启用所需 API 的 Google Cloud 项目。

1.  **创建 Google Cloud 项目**:
    - 前往 [Google Cloud Console](https://console.cloud.google.com/)。
    - 创建一个新项目（例如, `gemini-proxy-01`）并记下 **项目 ID (Project ID)**。
2.  **启用 API**:
    - 在您的新项目中，导航至 “APIs & Services” > “Library”。
    - 搜索并启用以下 API:
        - `Gemini for Google Cloud`

**为您希望添加到池中的每个 Google 账户重复以上步骤。**

### 步骤 2: 运行交互式设置向导

此脚本将自动处理 OAuth 流程和凭证生成。

**先决条件**: 在您的本地机器或服务器上安装 [Node.js](https://nodejs.org/en) (v18+)。

1.  **克隆并安装**:

    ```bash
    git clone https://github.com/mywar5/gemini-gateway-service.git
    cd gemini-gateway-service
    npm install
    ```

2.  **启动向导**:

    ```bash
    npm run setup
    ```

3.  **跟随提示操作**:

    - 选择 `Add a new Gemini account`。
    - 输入您在步骤 1 中准备的 **项目 ID**。
    - 脚本将生成一个授权 URL。在浏览器中打开它。
    - 使用对应的 Google 账户登录并授予权限。
    - 成功后，脚本会自动将凭证文件（例如, `gemini-proxy-01.json`）保存到 `./accounts` 目录中。

4.  **添加更多账户**:
    - 为您所有的 Google 账户重复此过程。
    - 完成后选择 `Exit`。

### 步骤 3: 使用 Docker 部署

一旦 `accounts` 目录填充了您的凭证文件，您就可以启动服务了。

**先决条件**: 在您的服务器上安装 [Docker](https://www.docker.com/) 和 [Docker Compose](https://docs.docker.com/compose/install/)。

1.  **(可选) 配置环境**:

    - 在项目根目录创建一个 `.env` 文件来自定义端口或设置 HTTP 代理。
        ```env
        # .env (可选)
        PORT=8080
        # PROXY=http://127.0.0.1:7890
        ```

2.  **启动服务**:
    - 在项目根目录运行:
        ```bash
        docker-compose up -d
        ```

### 步骤 4: 使用 API

您的 Gemini 网关现在已上线！

- **API 端点**: `http://<YOUR_SERVER_IP>:3000/v1/chat/completions` (或您的自定义端口)
- **API 密钥**: 不需要。您可以使用任何字符串。

**`curl` 示例:**

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-anything" \
  -d '{
    "model": "gemini-1.0-pro",
    "messages": [
      {
        "role": "user",
        "content": "你好，介绍一下你自己。"
      }
    ],
    "stream": false
  }'
```

## 📦 服务器迁移与手动部署

如果您已经在本地生成了 `accounts` 目录，您可以简单地将整个项目文件夹（包括 `accounts` 目录）复制到您的生产服务器，然后运行 `docker-compose up -d`。无需重新授权。

## ⚙️ 配置

服务通过环境变量进行配置。

| 环境变量              | 描述                                             | `setup` 脚本是否需要 | 默认值    |
| --------------------- | ------------------------------------------------ | -------------------- | --------- |
| `PORT`                | 服务器监听的端口。                               | 否                   | `3000`    |
| `HOST`                | 绑定的主机地址。`0.0.0.0` 监听所有网络接口。     | 否                   | `0.0.0.0` |
| `PROXY`               | （可选）用于所有出站请求的 HTTP/HTTPS 代理 URL。 | 否                   | `null`    |
| `OAUTH_CLIENT_ID`     | 您的 Google OAuth 客户端 ID。                    | **是**               | `null`    |
| `OAUTH_CLIENT_SECRET` | 您的 Google OAuth 客户端密钥。                   | **是**               | `null`    |

## ❓ 常见问题

**问: 我可以在没有图形用户界面的服务器上部署吗？**
答: 可以。首先在您的 **本地机器** 上运行 `npm run setup` 向导来生成 `accounts` 目录。然后，将整个项目文件夹（包含已填充的 `accounts` 目录）上传到您的服务器，并使用 `docker-compose up -d` 启动它。

**问: 为什么我在日志中看到 "Account frozen"？**
答: 这是自动故障转移机制在工作。当一个账户遇到错误（如速率限制）时，它会被暂时置于冷却期，服务会无缝地使用下一个最佳账户重试，以确保服务不中断。
