# Sisyphus: Infrastructure & Hardware Plan

**Date:** 2026-03-25
**Status:** Planning

---

## 1. Deployment Overview

Two physical machines working together:

```
┌─────────────────────────────────┐     ┌─────────────────────────────────┐
│     SERVER MACHINE              │     │     AMD HALO MACHINE            │
│     (Docker Host)               │     │     (LLM Inference)             │
│                                 │     │                                 │
│  ┌───────────────────────────┐  │     │  AMD Ryzen AI MAX+ 395          │
│  │  Docker Compose Stack     │  │     │  128 GB LPDDR5x                 │
│  │                           │  │     │  40 RDNA 3.5 CUs                │
│  │  - sisyphus-app (Node.js) │  │     │                                 │
│  │  - temporal-server        │  │     │  ┌───────────────────────────┐  │
│  │  - chrome (Steel)         │──┼─────┼──│  llama.cpp HTTP Server    │  │
│  │  - redis                  │  │     │  │  OpenAI-compatible API    │  │
│  │  - postgres               │  │     │  │  Port 8080                │  │
│  │                           │  │     │  │                           │  │
│  │                           │  │     │  │  Model: Qwen3-30B-A3B     │  │
│  └───────────────────────────┘  │     │  │  Backend: Vulkan          │  │
│                                 │     │  └───────────────────────────┘  │
└─────────────────────────────────┘     └─────────────────────────────────┘
         │                                          │
         │              LAN Connection              │
         └──────────────────────────────────────────┘
```

---

## 2. Docker Compose Architecture

### 2.1 docker-compose.yml

```yaml
version: "3.9"

services:
  # ─── Core Application ──────────────────────────────────────
  sisyphus-app:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: sisyphus-app
    environment:
      - LLM_BASE_URL=${LLM_BASE_URL:-http://halo:8080/v1}
      - LLM_FALLBACK_URL=https://openrouter.ai/api/v1
      - LLM_FALLBACK_API_KEY=${OPENROUTER_API_KEY}
      - LLM_MODEL=${LLM_MODEL:-qwen3-30b-a3b}
      - LLM_FALLBACK_MODEL=${LLM_FALLBACK_MODEL:-anthropic/claude-sonnet-4-6}
      - REDIS_URL=redis://redis:6379/0
      - POSTGRES_URL=postgresql://sisyphus:${POSTGRES_PASSWORD}@postgres:5432/sisyphus
      - TEMPORAL_HOST=temporal:7233
      - CHROME_CDP_URL=ws://chrome:9222
      - DISPATCH_URL=${DISPATCH_URL}
      - DISPATCH_USERNAME=${DISPATCH_USERNAME}
      - DISPATCH_PASSWORD=${DISPATCH_PASSWORD}
      - BUSINESS_HOURS_START=${BUSINESS_HOURS_START:-09:00}
      - BUSINESS_HOURS_END=${BUSINESS_HOURS_END:-22:00}
      - BUSINESS_TIMEZONE=${BUSINESS_TIMEZONE:-America/Edmonton}
      - LOG_LEVEL=${LOG_LEVEL:-INFO}
    depends_on:
      redis:
        condition: service_healthy
      postgres:
        condition: service_healthy
      temporal:
        condition: service_started
      chrome:
        condition: service_healthy
    volumes:
      - ./processes:/app/processes:ro        # Process .md files (read-only)
      - ./logs:/app/logs                     # Application logs
    deploy:
      resources:
        limits:
          memory: 4G
          cpus: "2.0"
    restart: unless-stopped
    networks:
      - sisyphus-net

  # ─── Temporal (Durable Execution) ──────────────────────────
  temporal:
    image: temporalio/auto-setup:latest
    container_name: sisyphus-temporal
    environment:
      - DB=postgresql
      - DB_PORT=5432
      - POSTGRES_USER=temporal
      - POSTGRES_PWD=${TEMPORAL_POSTGRES_PASSWORD}
      - POSTGRES_SEEDS=postgres
    depends_on:
      postgres:
        condition: service_healthy
    ports:
      - "7233:7233"     # gRPC
    deploy:
      resources:
        limits:
          memory: 2G
          cpus: "1.0"
    restart: unless-stopped
    networks:
      - sisyphus-net

  temporal-ui:
    image: temporalio/ui:latest
    container_name: sisyphus-temporal-ui
    environment:
      - TEMPORAL_ADDRESS=temporal:7233
    depends_on:
      - temporal
    ports:
      - "8088:8080"     # Temporal Web UI
    deploy:
      resources:
        limits:
          memory: 512M
    restart: unless-stopped
    networks:
      - sisyphus-net

  # Note: Temporal worker runs in-process within sisyphus-app (TypeScript SDK supports this)
  # No separate worker container needed at our scale.

  # ─── Headless Chrome ───────────────────────────────────────
  chrome:
    image: ghcr.io/nicholasrose/steel:latest    # or browserless/chrome
    container_name: sisyphus-chrome
    environment:
      - CHROME_FLAGS=--no-sandbox --disable-gpu --disable-dev-shm-usage
      - MAX_CONCURRENT_SESSIONS=2
    ports:
      - "9222:9222"     # CDP
    deploy:
      resources:
        limits:
          memory: 2G
          cpus: "2.0"
    shm_size: "1gb"     # Chrome needs shared memory
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9222/json/version"]
      interval: 30s
      timeout: 10s
      retries: 3
    restart: unless-stopped
    networks:
      - sisyphus-net

  # ─── Redis (Operational Memory) ────────────────────────────
  redis:
    image: redis:7-alpine
    container_name: sisyphus-redis
    command: redis-server --maxmemory 512mb --maxmemory-policy allkeys-lru
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    deploy:
      resources:
        limits:
          memory: 1G
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 3
    restart: unless-stopped
    networks:
      - sisyphus-net

  # ─── PostgreSQL (Persistent Memory) ────────────────────────
  postgres:
    image: postgres:16-alpine
    container_name: sisyphus-postgres
    environment:
      - POSTGRES_USER=sisyphus
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
      - POSTGRES_DB=sisyphus
    ports:
      - "5432:5432"
    volumes:
      - postgres-data:/var/lib/postgresql/data
      - ./init-db.sql:/docker-entrypoint-initdb.d/01-init.sql
    deploy:
      resources:
        limits:
          memory: 2G
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U sisyphus"]
      interval: 10s
      timeout: 5s
      retries: 3
    restart: unless-stopped
    networks:
      - sisyphus-net

volumes:
  redis-data:
  postgres-data:

networks:
  sisyphus-net:
    driver: bridge
```

### 2.2 Environment File (.env)

```bash
# LLM Configuration
LLM_BASE_URL=http://halo.local:8080/v1          # AMD Halo machine on LAN
LLM_MODEL=qwen3-30b-a3b
LLM_FALLBACK_MODEL=anthropic/claude-sonnet-4-6
OPENROUTER_API_KEY=sk-or-...

# Dispatch Credentials (Cognito)
DISPATCH_URL=https://dispatch.valleyeats.ca
DISPATCH_USERNAME=sisyphus@valleyeats.ca
DISPATCH_PASSWORD=...

# Business Hours
BUSINESS_HOURS_START=09:00
BUSINESS_HOURS_END=22:00
BUSINESS_TIMEZONE=America/Edmonton

# Database
POSTGRES_PASSWORD=...
TEMPORAL_POSTGRES_PASSWORD=...

# Logging
LOG_LEVEL=INFO
```

---

## 3. AMD Halo Machine Setup

### 3.1 Hardware Recommendation

| Option | Model | Price | Notes |
|--------|-------|-------|-------|
| **Budget** | GMKtec Evo X2 (128 GB) | ~$1,500 | Basic mini PC, good value |
| **Recommended** | Framework Desktop (128 GB) | ~$2,000 | Reputable brand, upgradeable |
| **Premium** | MINISFORUM MS-S1 MAX (128 GB) | ~$2,900 | Best cooling, most reliable |

**Recommendation**: Framework Desktop or similar in the $2,000-2,500 range.

### 3.2 OS & Driver Setup

**Operating System**: Fedora 42 (or Ubuntu 24.04 LTS)

**Why Fedora**: Latest Mesa drivers (critical for Vulkan performance), recent kernel, strong AMD support.

**Setup Steps**:

```bash
# 1. Install Fedora 42 (server or workstation)

# 2. Update system and kernel (need 6.18.4+ for stable KFD)
sudo dnf update -y

# 3. Install Mesa Vulkan drivers
sudo dnf install mesa-vulkan-drivers vulkan-tools

# 4. Verify GPU detection
vulkaninfo | grep "GPU"
# Should show: AMD Radeon Graphics (RADV GFX1151)

# 5. Install llama.cpp (Vulkan build)
git clone https://github.com/ggerganov/llama.cpp
cd llama.cpp
cmake -B build -DGGML_VULKAN=ON
cmake --build build --config Release -j$(nproc)

# 6. Download model
# Qwen3-30B-A3B Q4_K_XL (recommended)
./build/bin/llama-cli --hf-repo Qwen/Qwen3-30B-A3B-GGUF --hf-file qwen3-30b-a3b-q4_k_xl.gguf

# 7. Start server
./build/bin/llama-server \
  --model qwen3-30b-a3b-q4_k_xl.gguf \
  --host 0.0.0.0 \
  --port 8080 \
  --n-gpu-layers 99 \
  --ctx-size 8192 \
  --parallel 2 \
  --cont-batching
```

### 3.3 Expected Performance

| Model | Quantization | Prompt Processing | Token Generation |
|-------|-------------|-------------------|-----------------|
| **Qwen3-30B-A3B** (daily driver) | Q4_K_XL | ~800 tok/s | **52-72 tok/s** |
| **Llama 3.3 70B** (complex tasks) | Q4 | ~105 tok/s | **3-5 tok/s** |
| **Llama 4 Scout 109B** (frontier-ish) | Default | ~150 tok/s | **~15 tok/s** |

**Qwen3-30B-A3B is the sweet spot**: MoE architecture means only 3B parameters are active per token, giving blazing speed with 30B-class quality.

### 3.4 Known Issues & Mitigations

| Issue | Mitigation |
|-------|-----------|
| gfx1151 not on official ROCm support list | Use Vulkan backend (works out of box with Mesa) |
| Kernel < 6.18.4 breaks GPU compute | Pin kernel to 6.18.4+ |
| Specific linux-firmware versions break ROCm | Test firmware before updating |
| GPU can get stuck in low-power state | Monitor power state; restart llama-server if perf drops |
| Simultaneous GPU workloads cause hangs | Dedicate machine to inference only (no gaming/video) |

### 3.5 Monitoring the Halo Machine

```bash
# GPU utilization and memory
watch -n 1 cat /sys/class/drm/card0/device/gpu_busy_percent

# Memory usage
watch -n 1 "cat /sys/class/drm/card0/device/mem_info_vram_used"

# Temperature
sensors | grep edge

# llama.cpp server health
curl http://localhost:8080/health
```

---

## 4. OpenRouter Configuration (Development / Fallback)

### 4.1 For Development (Before Hardware Purchase)

During development, use OpenRouter as the primary LLM provider:

```bash
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_MODEL=qwen/qwen3-30b-a3b          # Test same model as local
OPENROUTER_API_KEY=sk-or-...
```

**Free models for initial testing**:
- Various open-source models at zero cost (rate-limited: 20 req/min, 200 req/day)
- Good for testing agent logic before spending on API calls

**Paid models for quality testing**:
- `anthropic/claude-sonnet-4-6`: $3/$15 per M tokens — best reasoning
- `openai/gpt-4.1`: $2/$8 per M tokens — good balance
- `openai/gpt-4.1-mini`: $0.40/$1.60 per M tokens — cost-effective testing

### 4.2 Fallback Logic

```typescript
async function callLlm(messages: ChatMessage[], tools?: Tool[]) {
  // Try local first, fall back to OpenRouter
  try {
    return await localClient.chat.completions.create({
      model: config.localModel,
      messages,
      tools,
      timeout: 30_000, // 30s timeout for local
    });
  } catch (err) {
    logger.warn({ err }, "Local LLM unavailable, falling back to OpenRouter");
    return await openRouterClient.chat.completions.create({
      model: config.fallbackModel,
      messages,
      tools,
    });
  }
}
```

### 4.3 Model Routing Strategy

| Task Type | Model | Where |
|-----------|-------|-------|
| Market monitoring (routine checks) | Qwen3-30B-A3B | Local |
| Driver messaging (standard) | Qwen3-30B-A3B | Local |
| Ticket resolution (simple) | Qwen3-30B-A3B | Local |
| Complex reasoning / escalation decisions | Claude Sonnet 4.6 | OpenRouter |
| Ambiguous customer complaints | Claude Sonnet 4.6 | OpenRouter |
| Multi-step investigation | Llama 3.3 70B or Claude | Local or OpenRouter |

---

## 5. Network Architecture

```
┌─────────────────────────────────────────────────┐
│                    LAN (Gigabit)                │
│                                                 │
│  Server Machine ◄──────────► AMD Halo Machine   │
│  192.168.1.100               192.168.1.101      │
│  Docker stack                llama.cpp :8080     │
│                                                 │
└────────────────────┬────────────────────────────┘
                     │
                     │ Internet
                     │
          ┌──────────┴──────────┐
          │                     │
   OpenRouter API        AWS (ValleyEats)
   (LLM fallback)       - Dispatch API
                         - Cognito Auth
                         - DynamoDB
                         - S3 Snapshots
```

### Network Requirements

- **LAN**: Gigabit Ethernet between server and Halo (latency-sensitive LLM calls)
- **Internet**: Stable connection for AWS API access and OpenRouter fallback
- **Firewall**: Halo machine only exposes port 8080 on LAN; no internet access needed
- **DNS**: Set `halo.local` or static IP for the Halo machine

---

## 6. Business Hours Scheduling

Temporal handles start/stop:

```typescript
// Temporal Schedule (created once at setup)
const handle = await client.schedule.create({
  scheduleId: "sisyphus-daily-shift",
  spec: {
    calendars: [{
      // Monday through Sunday, 9 AM start
      dayOfWeek: [{ start: 0, end: 6 }],
      hour: [9],
      minute: [0],
    }],
    jitter: "5m",
  },
  action: {
    type: "startWorkflow",
    workflowType: sisyphusShiftWorkflow,
    workflowId: "sisyphus-shift",
    taskQueue: "sisyphus-workers",
  },
});
```

The shift workflow:
1. **9:00 AM**: Temporal triggers `SisyphusShiftWorkflow`
2. **Startup**: Launch Chrome, authenticate, load process files, connect to services
3. **9:05 AM - 9:55 PM**: Main dispatch loop (continuous)
4. **9:55 PM**: Begin graceful shutdown
5. **10:00 PM**: Complete shutdown, log shift summary

---

## 7. Monitoring & Alerting

| Component | Health Check | Alert On |
|-----------|-------------|----------|
| Docker containers | `docker compose ps` | Any container unhealthy/restarted |
| Temporal workflows | Temporal Web UI (:8088) | Workflow failed/stuck |
| Chrome browser | CDP health endpoint | Connection refused or crash |
| Redis | `redis-cli ping` | Memory > 80%, connection refused |
| PostgreSQL | `pg_isready` | Disk > 80%, connection refused |
| llama.cpp (Halo) | `/health` endpoint | Server down, response > 60s |
| LLM quality | Response validation | Nonsensical outputs, repeated failures |

### Simple Monitoring Script (Phase 1)

```bash
#!/bin/bash
# health-check.sh — runs every 5 minutes via cron on the server machine

check_service() {
    if ! curl -sf "$1" > /dev/null 2>&1; then
        echo "ALERT: $2 is DOWN at $(date)" >> /app/logs/alerts.log
        # Could send Slack/email notification here
    fi
}

check_service "http://localhost:9222/json/version" "Chrome"
check_service "http://halo.local:8080/health" "LLM Server"

# Check Docker containers
unhealthy=$(docker compose ps --filter "health=unhealthy" --format "{{.Name}}")
if [ -n "$unhealthy" ]; then
    echo "ALERT: Unhealthy containers: $unhealthy at $(date)" >> /app/logs/alerts.log
fi
```

---

## 8. Backup & Recovery

| What | How | Frequency |
|------|-----|-----------|
| PostgreSQL data | `pg_dump` to S3 | Daily |
| Redis (optional) | RDB snapshots | Hourly |
| Process .md files | Git repository | On every change |
| Docker Compose config | Git repository | On every change |
| Halo model files | Manual backup | On model change |
| Shift summaries | Already in PostgreSQL | N/A |

**Recovery procedure**:
1. `docker compose down`
2. Restore PostgreSQL from backup
3. `docker compose up -d`
4. Temporal automatically resumes any interrupted workflows
