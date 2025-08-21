# Gemini Gateway Service - 高性能 Gemini Pro API 代理

[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![Docker](https://img.shields.io/badge/Docker-Ready-blue.svg)](https://www.docker.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**一个高性能、生产级的代理服务，旨在无缝桥接任何兼容 OpenAI API 的前端应用与 Google 的 Gemini API。**

它通过智能地管理一个包含多个 Gemini 账户的池，对外提供一个统一、稳定且标准的 OpenAI API v1 端点，同时采用先进的 **Thompson 采样算法** 实现智能负载均衡和自动故障转移。

---

## ✨ 项目亮点 (Core Features)

- **OpenAI API 完全兼容**: 无需修改任何现有代码，即可将您的 OpenAI 应用（如 NextChat, LobeChat 等）无缝切换到 Gemini Pro。
- **智能多账户负载均衡**:
    - **Thompson 采样算法**: 采用比简单轮询更先进的 Thompson 采样算法，根据每个账户的历史成功率和失败率进行自适应学习，动态地将流量引向当前表现最佳的账户。
    - **探索与利用**: 完美平衡了“利用”已知最佳账户和“探索”其他账户潜力的过程，确保长期稳定性和高可用性。
- **自动故障转移与恢复**:
    - **无缝重试**: 如果一个账户请求失败（如遇到速率限制、API 错误），服务会立即将其短暂“冻结”，并自动使用池中下一个最佳账户重试，对用户完全透明。
    - **指数退避**: 对失败的账户采用指数退避策略，延长其冻结时间，避免对有问题的 API 端点造成冲击。
- **静默令牌刷新**: 在后台自动处理 Gemini OAuth 令牌的刷新和持久化逻辑，免除手动维护烦恼。
- **零配置 & 极其简化的设置**:
    - **固定路径**: 所有账户凭证都存放在项目根目录下的 `/accounts` 文件夹中，无需任何路径配置。
    - **交互式设置向导**: 提供 `npm run setup` 命令，通过简单的问答形式，引导您半自动地完成所有账户凭证的获取和配置，并自动存入 `/accounts` 目录。
- **生产就绪**:
    - **Docker 一键部署**: 提供优化的多阶段 `Dockerfile` 和 `docker-compose.yml`，实现轻量、安全的容器化部署。

## 🚀 完整入门教程 (Getting Started)

本教程将引导您通过最简单、最推荐的方式——**交互式设置向导**，来完成服务的部署和运行。

### 第 1 步：准备 Google Cloud 项目

对于每一个您想使用的 Google 账户，您都需要一个关联的 Google Cloud 项目并开启相关服务。

1.  **访问 Google Cloud Console**:

    - 打开 [Google Cloud Console](https://console.cloud.google.com/)。
    - 在页面顶部的项目选择器中，点击 **“创建项目”** (Create Project)。
    - 为您的项目命名（例如 `gemini-proxy-01`），记录下这个 **项目 ID**，稍后会用到。然后点击 **“创建”**。

2.  **启用所需 API**:

    - 确保您的新项目已被选中。
    - 在左侧导航菜单中，找到 **“API 和服务”** > **“库”**。
    - 搜索并启用以下两个 API：
        - `Google Generative Language API`
        - `Vertex AI API`

3.  **配置 OAuth 同意屏幕**:
    - 在左侧导航菜单中，找到 **“API 和服务”** > **“OAuth 同意屏幕”**。
    - 选择 **“外部”** (External) 用户类型，然后点击 **“创建”**。
    - 填写最基本的信息：
        - **应用名称**: `Gemini Gateway`
        - **用户支持电子邮件**: 选择您的电子邮件地址。
        - **开发者联系信息**: 再次输入您的电子邮件地址。
    - 点击 **“保存并继续”**，直接跳过所有后续步骤，直到返回信息中心。

**如果您有多个 Google 账户，请为每个账户重复以上步骤，确保每个账户都有一个已启用 API 的独立项目。**

### 第 2 步：运行交互式设置向导

现在，我们将使用本项目的核心功能 `setup` 脚本来自动获取凭证。

**先决条件**: 您的电脑上已安装 [Node.js](https://nodejs.org/en) (v18+)。

1.  **克隆仓库并安装依赖**:

    ```bash
    git clone https://github.com/your-repo/gemini-gateway-service.git
    cd gemini-gateway-service
    npm install
    ```

2.  **启动设置向导**:

    ```bash
    npm run setup
    ```

3.  **按照向导提示操作**:

    - **确认目录**: 向导会确认将凭证保存在固定的 `./accounts` 目录中。
    - **选择操作**: 选择 `Add a new Gemini account`。
    - **输入项目 ID**: 输入您在 **第 1 步** 中创建并记录的 Google Cloud 项目 ID。
    - **浏览器授权**:
        - 脚本会自动生成一个授权 URL 并打印在终端。
        - 复制此 URL，在您的浏览器中打开。
        - 登录对应的 Google 账户，并授予权限。
        - 授权成功后，浏览器会显示“Authentication successful! You can close this window.”。
    - **完成**: 脚本会自动完成后续所有操作，并将生成的凭证文件（如 `gemini-proxy-01.json`）保存在根目录下的 `accounts` 文件夹中。

4.  **添加更多账户**:
    - 向导会再次询问您想做什么。您可以继续选择 `Add a new Gemini account`，重复上述流程为您的其他 Google 账户和项目添加凭证。
    - 添加完所有账户后，选择 `Exit` 退出向导。

### 第 3 步：使用 Docker 启动服务

当 `accounts` 目录中已经包含所有账户的 `.json` 文件后，您就可以轻松地通过 Docker 启动服务了。

**先决条件**: 您的服务器上已安装 [Docker](https://www.docker.com/) 和 [Docker Compose](https://docs.docker.com/compose/install/)。

1.  **（可选）创建 `.env` 文件**:

    - 如果您需要指定端口或配置代理，可以在项目根目录下创建一个 `.env` 文件。
        ```env
        # .env (可选)
        PORT=8080
        # PROXY=http://127.0.0.1:7890
        ```

2.  **启动服务**:
    - 在项目根目录下，运行以下命令：
        ```bash
        docker-compose up -d
        ```

### 第 4 步：使用 API

您的 Gemini 代理服务现已成功运行！

- **API 端点**: `http://<YOUR_SERVER_IP>:3000/v1/chat/completions` (如果您未在 `.env` 中修改端口)
- **API Key**: 无需提供，可以随意填写。

**`curl` 测试示例:**

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-anything" \
  -d '{
    "model": "gemini-1.0-pro",
    "messages": [
      {
        "role": "user",
        "content": "你好，请介绍一下你自己。"
      }
    ],
    "stream": false
  }'
```

## 📦 服务器迁移与手动部署

如果您已经在本地通过 `npm run setup` 生成了 `accounts` 目录，您可以将整个项目文件夹（**必须包含 `accounts` 目录**）直接拷贝到您的生产服务器上，然后执行 `docker-compose up -d` 即可，无需再次授权。

## ⚙️ 配置 (Configuration)

服务通过环境变量进行配置。

| 环境变量              | 描述                                                                                     | 是否必须 | 默认值       |
| --------------------- | ---------------------------------------------------------------------------------------- | -------- | ------------ |
| `PORT`                | 服务器监听的端口。                                                                       | 否       | `3000`       |
| `HOST`                | 服务器绑定的主机地址。`0.0.0.0` 表示监听所有可用的网络接口。                             | 否       | `0.0.0.0`    |
| `PROXY`               | (可选) 用于路由所有出站请求的 HTTP/HTTPS 代理的 URL。例如 `http://your-proxy-url:port`。 | 否       | `null`       |
| `NODE_ENV`            | 运行环境模式。                                                                           | 否       | `production` |
| `OAUTH_CLIENT_ID`     | **(运行 `setup` 脚本时必须)** 用于身份验证的 Google OAuth 客户端 ID。请设置为您的凭证。  | 是       | `null`       |
| `OAUTH_CLIENT_SECRET` | **(运行 `setup` 脚本时必须)** 用于身份验证的 Google OAuth 客户端密钥。请设置为您的凭证。 | 是       | `null`       |

## ❓ 常见问题解答 (FAQ)

**Q: 我可以将服务部署在没有图形界面的服务器上吗？**
A: 可以，而且很简单。只需在您的**本地电脑**上先运行 `npm run setup`，为所有账户完成授权并生成 `accounts` 目录。然后，将整个项目文件夹（包含已生成好的 `accounts` 目录）上传到您的服务器，直接运行 `docker-compose up -d` 即可。

**Q: 为什么日志里显示账户被 "frozen" (冻结) 了？**
A: 这是服务的核心故障转移机制。当一个账户在请求中遇到错误（例如 Google API 的速率限制），它会被临时冻结，服务会立即用下一个最好的账户重试，保证服务的连续性。
