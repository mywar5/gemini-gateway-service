# Gemini Gateway: Production-Grade Smart Proxy for Gemini API

[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![Docker](https://img.shields.io/badge/Docker-Ready-blue.svg)](https://www.docker.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**A high-performance, production-grade proxy service designed to seamlessly bridge any OpenAI API-compatible application with Google's Gemini API.**

This service provides a unified, stable, and standard OpenAI API v1 endpoint by intelligently managing a pool of multiple Gemini accounts. It leverages the advanced **Thompson Sampling** algorithm for smart load balancing and automatic failover, ensuring high availability and optimal performance.

---

## ✨ Core Features

- **Seamless OpenAI Compatibility**: Instantly switch your existing OpenAI applications (e.g., NextChat, LobeChat) to Gemini with zero code changes.
- **Intelligent Multi-Account Load Balancing**:
    - **Thompson Sampling Algorithm**: Goes beyond simple round-robin by using a sophisticated Bayesian approach. It dynamically routes traffic to the best-performing account based on a statistical analysis of its historical success and failure rates.
    - **Explore-Exploit Balance**: Perfectly balances "exploiting" the known best accounts and "exploring" the potential of others, guaranteeing long-term stability and high throughput.
- **Automated Failover & Recovery**:
    - **Transparent Retries**: If a request to an account fails (e.g., due to rate limits or API errors), the service instantly "freezes" it and transparently retries with the next-best account in the pool.
    - **Exponential Backoff with Jitter**: Implements an exponential backoff strategy for failed accounts, progressively increasing their cooldown period to avoid overwhelming problematic endpoints.
- **Silent Token Refresh**: Automatically handles the refresh and persistence of Gemini OAuth tokens in the background, eliminating manual maintenance.
- **Zero-Config & Simplified Setup**:
    - **Fixed Credential Path**: All account credentials are stored in the `/accounts` folder at the project root, requiring no path configuration.
    - **Interactive Setup Wizard**: A simple `npm run setup` command guides you through a semi-automated, question-based process to acquire and configure all necessary credentials.
- **Production-Ready**:
    - **One-Click Docker Deployment**: Comes with an optimized multi-stage `Dockerfile` and `docker-compose.yml` for lightweight, secure, and scalable containerized deployment.
    - **High-Performance HTTP/2 Agent**: Utilizes `hpagent` to manage a pool of persistent HTTP/2 connections, ensuring low latency and high throughput for API requests.

## 🚀 Getting Started

This guide will walk you through deploying and running the service using the recommended **Interactive Setup Wizard**.

### Step 1: Prepare Google Cloud Project(s)

For each Google account you intend to use, you need a corresponding Google Cloud project with the necessary APIs enabled.

1.  **Create a Google Cloud Project**:
    - Go to the [Google Cloud Console](https://console.cloud.google.com/).
    - Create a new project (e.g., `gemini-proxy-01`) and note down the **Project ID**.
2.  **Enable APIs**:
    - In your new project, navigate to "APIs & Services" > "Library".
    - Search for and enable the following APIs:
        - `Gemini for Google Cloud`

**Repeat these steps for every Google account you wish to add to the pool.**

### Step 2: Run the Interactive Setup Wizard

This script will automatically handle the OAuth flow and credential generation.

**Prerequisites**: [Node.js](https://nodejs.org/en) (v18+) installed on your local machine or remote server.

1.  **Clone & Install**:

    ```bash
    git clone https://github.com/mywar5/gemini-gateway-service.git
    cd gemini-gateway-service
    npm install
    ```

2.  **Launch the Wizard**:

    ```bash
    npm run setup
    ```

3.  **Follow the Prompts**:

    - Choose `Add a new Gemini account`.
    - Enter the **Project ID** you prepared in Step 1.
    - The script will generate an authorization URL. Open it in your browser.
    - Log in with the corresponding Google account and grant permissions.
    - Upon success, the script will automatically save the credential file (e.g., `gemini-proxy-01.json`) to the `./accounts` directory.

4.  **Add More Accounts**:
    - Repeat the process for all your Google accounts.
    - Select `Exit` when you are finished.

### Step 3: Deploy with Docker

Once the `accounts` directory is populated with your credential files, you can start the service.

**Prerequisites**: [Docker](https://www.docker.com/) and [Docker Compose](https://docs.docker.com/compose/install/) installed on your server.

1.  **(Optional) Configure Environment**:

    - Create a `.env` file in the project root to customize the port or set an HTTP proxy.
        ```env
        # .env (Optional)
        PORT=8080
        # PROXY=http://127.0.0.1:7890
        ```

2.  **Start the Service**:
    - In the project root, run:
        ```bash
        docker-compose up -d
        ```

### Step 4: Use the API

Your Gemini Gateway is now live!

- **API Endpoint**: `http://<YOUR_SERVER_IP>:3000/v1/chat/completions` (or your custom port)
- **API Key**: Not required. You can use any string.

**`curl` Example:**

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-anything" \
  -d '{
    "model": "gemini-1.0-pro",
    "messages": [
      {
        "role": "user",
        "content": "Hello, tell me about yourself."
      }
    ],
    "stream": false
  }'
```

## 📦 Server Migration & Manual Deployment

If you have already generated the `accounts` directory locally, you can simply copy the entire project folder (including the `accounts` directory) to your production server and run `docker-compose up -d`. No re-authorization is needed.

## ⚙️ Configuration

The service is configured via environment variables.

| Environment Variable  | Description                                                       | Required for `setup` | Default   |
| --------------------- | ----------------------------------------------------------------- | -------------------- | --------- |
| `PORT`                | The port the server will listen on.                               | No                   | `3000`    |
| `HOST`                | The host address to bind to. `0.0.0.0` listens on all interfaces. | No                   | `0.0.0.0` |
| `PROXY`               | Optional HTTP/HTTPS proxy URL for all outbound requests.          | No                   | `null`    |
| `OAUTH_CLIENT_ID`     | Your Google OAuth Client ID.                                      | **Yes**              | `null`    |
| `OAUTH_CLIENT_SECRET` | Your Google OAuth Client Secret.                                  | **Yes**              | `null`    |

## ❓ FAQ

**Q: Can I deploy this on a server without a GUI?**
A: Yes. Run the `npm run setup` wizard on your **local machine** first to generate the `accounts` directory. Then, upload the entire project folder (with the populated `accounts` directory) to your server and start it with `docker-compose up -d`.

**Q: Why do I see "Account frozen" in the logs?**
A: This is the automatic failover mechanism at work. When an account encounters an error (like a rate limit), it's temporarily put on cooldown, and the service seamlessly retries with the next-best account to ensure uninterrupted service.
