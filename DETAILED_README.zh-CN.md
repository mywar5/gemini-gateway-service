# Gemini 智能网关：深度解析与完整使用指南

[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![Docker](https://img.shields.io/badge/Docker-Ready-blue.svg)](https://www.docker.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## 1. 总览

**Gemini 智能网关** 是一个高性能、生产级的代理服务，旨在将任何兼容 OpenAI API 的应用程序（如 NextChat, LobeChat, One-API 等）无缝对接到 Google 的 Gemini API。

它不仅仅是一个简单的请求转发器，而是一个智能的、具备高可用性的网关。通过在内部管理一个由多个 Gemini 账户组成的资源池，它实现了**智能负载均衡**、**自动故障转移**和**零手动维护**，为上层应用提供一个统一、稳定且标准的 OpenAI API v1 端点。

## 2. 核心特性与工作原理

本服务的设计哲学是**智能、健壮、高效**。以下是其核心特性及其背后的技术实现：

- **无缝兼容 OpenAI**

    - **描述:** 无需修改任何应用代码，即可将您现有的 OpenAI 应用即时切换到 Gemini。
    - **工作原理:** 网关在 `/v1/chat/completions` 端点上模拟了 OpenAI 的 API 规范。它接收 OpenAI 格式的请求，在内部将其转换为 Gemini 格式，然后将 Gemini 的响应流再转换回 OpenAI 的 SSE（Server-Sent Events）格式，确保了协议层面的完全兼容。

- **智能多账户负载均衡**

    - **描述:** 超越简单的轮询机制，动态地将流量路由到当前表现最佳的账户。
    - **工作原理:** 采用先进的 **汤普森采样 (Thompson Sampling)** 算法。
        1.  **数据驱动:** 每个账户都维护着 `successes` (成功) 和 `failures` (失败) 两个计数器。
        2.  **贝塔分布:** 算法将这两个计数器作为参数（alpha 和 beta），为每个账户构建一个贝塔概率分布模型。这个模型代表了该账户真实成功率的不确定性。
        3.  **随机采样:** 每次选择账户时，不是直接选择成功率最高的，而是从每个账户的贝塔分布中随机抽取一个样本值。
        4.  **选择最优:** 选择本次抽样中样本值最高的账户。
        5.  **平衡探索与利用:** 这种方法完美地平衡了“利用”已知成功率高的账户（Exploitation）和“探索”其他可能暂时表现不佳但有潜力的账户（Exploration），确保了长期稳定性和高吞吐量。
        6.  **时间衰减:** 为了更关注近期的账户表现，每次选择前，所有账户的成功/失败计数都会乘以一个衰减因子（如0.995），使得旧记录的影响力随时间下降。

- **自动故障转移与恢复**

    - **描述:** 当某个账户请求失败时（例如，由于速率限制或API错误），服务会立即“冻结”该账户，并使用资源池中次优的账户进行透明重试，对上层应用完全无感。
    - **工作原理:**
        1.  **透明重试:** `executeRequest` 方法包含一个重试循环。当一个账户失败后，它会立即调用 `selectAccount` 选择下一个最佳账户重试。
        2.  **指数退避与抖动 (Exponential Backoff with Jitter):** 对失败的账户实施智能冷却策略。
            - 失败次数越多，基础冷却时间（区分普通失败和速率限制失败）会以2的指数幂增长，避免对有问题的端点造成持续冲击。
            - 在冷却时间上增加一个随机的“抖动”值，防止多个账户在同一时刻解冻，避免“惊群效应”。
        3.  **自动解冻:** 账户的 `frozenUntil` 时间戳过后，它会自动变为可用状态，重新参与负载均衡。

- **静默的令牌刷新与持久化**

    - **描述:** 在后台自动处理 Gemini OAuth 令牌的刷新和持久化，无需任何手动维护。
    - **工作原理:**
        1.  **请求前检查:** 在每次使用账户发起请求前，`ensureAuthenticated` 方法会检查其 `access_token` 是否即将过期。
        2.  **自动刷新:** 如果令牌过期，它会使用 `refresh_token` 自动向 Google OAuth 服务器请求新的令牌。
        3.  **状态持久化:** 成功获取新令牌后，它会立即将更新后的凭证（包含新的 `access_token` 和 `expiry_date`）写回到该账户对应的 `.json` 文件中。这确保了即使服务重启，也无需重新进行手动授权。

- **生产就绪**
    - **一键式 Docker 部署:** 提供优化的多阶段 `Dockerfile` 和 `docker-compose.yml`，可实现轻量、安全且可扩展的容器化部署。
    - **高性能 HTTP/2 代理:** 利用 `hpagent` 管理一个持久化的 HTTP/2 连接池，通过复用连接，极大地减少了 TCP 和 TLS 握手带来的延迟，确保了高吞t量。
    - **并行预热:** 服务启动时，会并行地对所有账户进行预认证和初始化，将认证开销前置，避免将其叠加到用户的首次请求上。

## 3. 快速开始

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

    - 在项目根目录的 `docker-compose.yml` 文件中直接修改端口和IP。
        ```yaml
        # docker-compose.yml
        services:
          gemini-gateway:
            ...
            ports:
              - "YOUR_PUBLIC_IP:3001:3000" # 将 YOUR_PUBLIC_IP 替换为您的公网IP, 8888 替换为您的目标端口
            ...
        ```

2.  **启动服务**:
    - 在项目根目录运行:
        ```bash
        docker-compose up --build -d
        ```

### 步骤 4: 使用 API

您的 Gemini 网关现在已上线！

- **API 端点**: `http://<YOUR_PUBLIC_IP>:3001/v1/chat/completions`
- **API 密钥**: 不需要。您可以使用任何字符串。

**`curl` 示例:**

```bash
curl http://YOUR_PUBLIC_IP:3001/v1/chat/completions \
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
    "stream": true
  }'
```

## 4. 配置

核心服务配置现在直接在 `docker-compose.yml` 文件中管理。

| 配置项                | 描述                                              | `setup` 脚本是否需要 | 默认值/示例                  |
| --------------------- | ------------------------------------------------- | -------------------- | ---------------------------- |
| **端口与IP**          | 在 `docker-compose.yml` 的 `ports` 部分直接设置。 | 否                   | `"YOUR_PUBLIC_IP:8888:3000"` |
| `PROXY`               | （可选）用于所有出站请求的 HTTP/HTTPS 代理 URL。  | 否                   | `null`                       |
| `OAUTH_CLIENT_ID`     | 您的 Google OAuth 客户端 ID。                     | **是**               | `null`                       |
| `OAUTH_CLIENT_SECRET` | 您的 Google OAuth 客户端密钥。                    | **是**               | `null`                       |

## 5. 常见问题 (FAQ)

**问: 我可以在没有图形用户界面的服务器上部署吗？**
答: 可以。首先在您的 **本地机器** 上运行 `npm run setup` 向导来生成 `accounts` 目录。然后，将整个项目文件夹（包含已填充的 `accounts` 目录）上传到您的服务器，并使用 `docker-compose up -d` 启动它。

**问: 为什么我在日志中看到 "Account frozen"？**
答: 这是自动故障转移机制在工作，是正常现象。当一个账户遇到错误（如速率限制）时，它会被暂时置于冷却期，服务会无缝地使用下一个最佳账户重试，以确保服务不中断。

**问: 汤普森采样和轮询有什么区别？**
答: 轮询是“雨露均沾”，机械地轮流使用每个账户，无论其好坏。而汤普森采样是“优胜劣汰”，它会根据历史表现，更频繁地使用那些成功率高的账户，同时也会给表现不佳的账户一些“探索”机会，整体效率和吞吐量远高于轮询。

## 6. 日常维护与监控

### 查看服务日志

查看实时日志对于监控服务状态和排查问题至关重要。本服务使用 `docker-compose` 进行管理，因此可以通过以下命令来查看日志。

**1. 查看全部历史日志**

此命令会打印出服务自启动以来的所有日志。

```bash
docker-compose logs
```

**2. 实时跟踪日志 (最常用)**

使用 `-f` 或 `--follow` 参数可以实时查看新产生的日志，类似于 `tail -f` 命令。

```bash
docker-compose logs -f
```

或者指定服务名（在我们的 `docker-compose.yml` 中定义为 `gemini-gateway`）：

```bash
docker-compose logs -f gemini-gateway
```

**3. 查看最新的N行日志**

如果你只关心最近发生的事情，可以使用 `--tail` 参数。

```bash
# 查看最新的 100 行日志
docker-compose logs --tail 100
```

**4. 结合实时跟踪与最新日志**

一个非常实用的组合是先看最新的几行，然后继续实时跟踪。

```bash
# 查看最新的 50 行日志，并继续实时跟踪
docker-compose logs --tail 50 -f
```

## 7. 高级主题 (面向开发者)

### 项目结构

```
src/
├── __tests__/         # 端到端和服务集成测试
├── routes/            # Fastify 路由层，处理 HTTP 请求
│   └── chat.ts        # 核心的 /v1/chat/completions 路由
├── services/          # 核心业务逻辑层
│   └── gemini-account-pool.ts # 灵魂所在：账户池、汤普森采样、故障转移
├── utils/             # 工具函数
│   └── transformations.ts # OpenAI 与 Gemini 格式的相互转换
├── server.ts          # 服务器启动入口
└── setup.ts           # 交互式安装脚本
```

### 运行测试

本项目拥有覆盖全面的测试套件。要运行测试，请执行：

```bash
npm test
```

### 参与开发

- **修改转换逻辑:** 如果需要支持新的 API 参数或格式，请修改 `src/utils/transformations.ts`。
- **添加新路由:** 在 `src/routes/` 目录下创建新的路由文件，并在 `src/server.ts` 中注册它。
- **调整负载均衡策略:** 核心算法位于 `src/services/gemini-account-pool.ts` 的 `selectAccount` 方法中。
