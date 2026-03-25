# Sisyphus: Cost Analysis & Business Case

**Date:** 2026-03-25
**Status:** Planning

---

## 1. Current Cost: Human Dispatchers

### Assumptions

| Factor | Value | Notes |
|--------|-------|-------|
| Dispatcher hourly wage (CAD) | $18-22/hr | Entry-level dispatch in Alberta |
| Shift length | 8-13 hours | Business hours coverage |
| Days per week | 7 | Food delivery operates daily |
| Benefits/overhead multiplier | 1.3x | CPP, EI, vacation, sick days |

### Annual Cost per Dispatcher

| Component | Low Estimate | High Estimate |
|-----------|-------------|---------------|
| Base wages (8 hr/day, 365 days) | $52,560 | $64,240 |
| Benefits/overhead (1.3x) | $68,328 | $83,512 |
| Training & onboarding | $2,000 | $4,000 |
| **Total per dispatcher** | **$70,328** | **$87,512** |

If Sisyphus replaces **1 full-time dispatcher**, savings = ~$70K-88K/year.

---

## 2. Sisyphus Operating Costs

### 2.1 Hardware (One-Time)

| Item | Cost (CAD) | Notes |
|------|-----------|-------|
| AMD Halo mini PC (128 GB) | $2,500-3,500 | Framework Desktop or MINISFORUM |
| Server machine (Docker host) | $800-1,200 | Standard desktop/mini PC, 32 GB RAM |
| Network switch/cables | $100 | Gigabit LAN |
| UPS (battery backup) | $200 | Protect both machines |
| **Total hardware** | **$3,600-5,000** |

### 2.2 Monthly Operating Costs

| Cost | Monthly (CAD) | Annual (CAD) | Notes |
|------|--------------|-------------|-------|
| **Electricity — Halo** | $25-40 | $300-480 | ~120W under load, 13 hrs/day |
| **Electricity — Server** | $10-15 | $120-180 | ~60W average |
| **OpenRouter (fallback)** | $30-100 | $360-1,200 | ~5-15% of requests routed to cloud |
| **AWS (marginal)** | $0 | $0 | Uses existing dispatch API infra |
| **Internet (marginal)** | $0 | $0 | Already have internet |
| **LangSmith (observability)** | $0-39 | $0-468 | Free tier may suffice; Pro is $39/mo |
| **Maintenance time** | $100-200 | $1,200-2,400 | ~2-4 hrs/month of developer time |
| **Total monthly** | **$165-394** | | |
| **Total annual operating** | | **$1,980-4,728** | |

### 2.3 Development Cost (One-Time)

| Phase | Estimated Effort | Cost (at $80/hr) | Notes |
|-------|-----------------|-------------------|-------|
| Phase 1: Foundation | 80-120 hours | $6,400-9,600 | Docker, LangGraph, basic monitoring |
| Phase 2: Browser automation | 60-100 hours | $4,800-8,000 | browser-use integration, UI interaction |
| Phase 3: Full dispatch | 80-120 hours | $6,400-9,600 | All sub-agents, process files, memory |
| Phase 4: Hardening | 40-60 hours | $3,200-4,800 | Error handling, edge cases, monitoring |
| **Total development** | **260-400 hours** | **$20,800-32,000** | |

If building in-house (not outsourced), this is developer time cost, not cash outlay.

---

## 3. Total Cost of Ownership (3-Year View)

### Scenario: Sisyphus replaces 1 FT dispatcher

| Year | Human Dispatcher | Sisyphus | Savings |
|------|-----------------|----------|---------|
| **Year 0 (setup)** | $0 | $23,600-37,000 | -$23,600 to -$37,000 |
| | | Hardware: $3,600-5,000 | |
| | | Development: $20,000-32,000 | |
| **Year 1** | $70,328-87,512 | $1,980-4,728 | $65,600-85,532 |
| **Year 2** | $70,328-87,512 | $1,980-4,728 | $65,600-85,532 |
| **Year 3** | $70,328-87,512 | $2,480-5,228 | $65,100-85,032 |
| | | (may need hardware refresh) | |
| **3-Year Total** | **$210,984-262,536** | **$30,040-51,684** | **$180,944-210,852** |

### Break-Even Point

- **If development is free** (built by existing team): **~1 month** after launch
- **If development is outsourced**: **4-6 months** after launch
- **Conservative estimate**: **6 months** to full ROI on all investment

---

## 4. Local Inference vs. Cloud API: Detailed Comparison

### 4.1 Token Usage Estimate

Estimating Sisyphus's daily token consumption:

| Activity | Calls/Day | Avg Tokens/Call | Daily Tokens |
|----------|----------|----------------|-------------|
| Market monitoring (30s polls, LLM analysis) | 960 | 1,500 (in) + 200 (out) | 1,632,000 |
| Driver messages (respond + compose) | 50-200 | 2,000 (in) + 300 (out) | 460,000 |
| Ticket resolution | 10-30 | 3,000 (in) + 500 (out) | 105,000 |
| Supervisor triage/delegation | 200 | 1,000 (in) + 200 (out) | 240,000 |
| Admin tasks | 10-20 | 1,500 (in) + 300 (out) | 36,000 |
| **Daily total** | | | **~2.5M tokens** |
| **Monthly total** | | | **~75M tokens** |

### 4.2 Cloud-Only Cost (If No Local Hardware)

| Provider/Model | Monthly Cost (75M tokens) |
|----------------|--------------------------|
| Claude Sonnet 4.6 ($3/$15) | Input: $168 + Output: $169 = **$337/mo** |
| GPT-4.1 ($2/$8) | Input: $112 + Output: $90 = **$202/mo** |
| GPT-4.1-mini ($0.40/$1.60) | Input: $22 + Output: $18 = **$40/mo** |
| Gemini 2.5 Flash ($0.30/$2.50) | Input: $17 + Output: $28 = **$45/mo** |
| Qwen3-30B on OpenRouter (~$0.20/$0.60) | Input: $11 + Output: $7 = **$18/mo** |

### 4.3 Local Inference Cost

| Factor | Monthly Cost |
|--------|-------------|
| Electricity (Halo, 13 hrs/day) | $25-40 |
| Hardware amortization (over 3 years) | $70-115 |
| **Total monthly** | **$95-155** |

### 4.4 Verdict

- **For Qwen-class models**: Local is cheaper than cloud after ~8 months (hardware payback)
- **For frontier models** (Claude, GPT-4.1): Local can't match quality, so cloud is needed for complex tasks
- **Hybrid approach** (90% local, 10% cloud): ~$110-170/mo — best balance of cost and quality
- **Cloud-only with cheap models** (GPT-4.1-mini, Gemini Flash): $40-45/mo — viable for testing phase, but quality may limit what Sisyphus can handle

**Recommendation**: Start with cloud-only (OpenRouter) during development. Buy Halo hardware once agent logic is proven and quality requirements are clear.

---

## 5. Risk-Adjusted ROI

### 5.1 Risks That Could Reduce Value

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|-----------|
| Agent makes costly mistakes | Refunds, customer churn | Medium | Process files, cooldowns, escalation rules, human oversight |
| Browser automation breaks with UI changes | Downtime until fixed | Medium | Dispatch UI is controlled by us; coordinate changes |
| LLM quality insufficient for dispatch | Can't handle complex scenarios | Low-Medium | Hybrid model routing; human fallback |
| Hardware failure | Temporary downtime | Low | Fallback to cloud; human dispatchers on standby |
| Development takes longer than estimated | Higher upfront cost | Medium | Phased approach; deliver value incrementally |

### 5.2 Additional Value (Not Quantified)

- **24/7 capability**: Sisyphus could eventually extend to off-hours (late night orders)
- **Consistency**: Never tired, never has a bad day, always follows process
- **Scalability**: Can handle more markets without additional hires
- **Data collection**: Every decision logged; enables optimization over time
- **Speed**: Responds to driver messages in seconds vs. minutes
- **Multi-tasking**: Monitors all markets simultaneously (humans can only focus on one)

### 5.3 Adjusted Savings Estimate

Applying a 25% risk discount to account for imperfect execution:

| | Conservative | Optimistic |
|---|-------------|-----------|
| Gross annual savings | $65,600 | $85,532 |
| Risk discount (25%) | -$16,400 | -$21,383 |
| **Net annual savings** | **$49,200** | **$64,149** |
| **3-year net savings** | **$124,000** | **$155,000** |

---

## 6. Comparison: Build vs. Buy

### Are there existing AI dispatch solutions?

| Solution | Relevance | Cost |
|----------|-----------|------|
| General AI customer service (Intercom, Zendesk AI) | Partial — handles tickets, not full dispatch | $300-1,000/mo |
| Food delivery dispatch automation (proprietary) | Mostly assignment optimization, not full dispatch | Custom pricing |
| Custom AI agents (consulting firms) | Could build, but expensive | $50K-200K+ |

**Verdict**: No off-the-shelf product does what we need (full dispatcher replacement that works through our specific UI). Building custom is the right choice given our specific requirements.

---

## 7. Phased Investment Strategy

### Phase 1: Prove It Works ($0-500)
- Use OpenRouter free/cheap models
- Build basic agent loop on developer's machine
- Prove: can Sisyphus read the dispatch page and take a simple action?

### Phase 2: Prove It's Useful ($500-2,000)
- OpenRouter paid models for quality
- Run alongside a human dispatcher (shadow mode)
- Prove: does Sisyphus make correct decisions 90%+ of the time?

### Phase 3: Prove It Scales ($2,500-5,000)
- Buy AMD Halo hardware
- Deploy Docker stack on server
- Prove: can Sisyphus run a full shift with minimal human intervention?

### Phase 4: Full ROI ($0/ongoing)
- Operating costs only (~$110-170/mo)
- Sisyphus handles primary dispatch; humans supervise
- ROI compounds monthly

---

## 8. Summary

| Metric | Value |
|--------|-------|
| **Total investment (Year 0)** | $24K-37K (dev) + $4K-5K (hardware) |
| **Annual operating cost** | $2K-5K |
| **Annual savings** (vs. 1 FT dispatcher) | $49K-64K (risk-adjusted) |
| **Break-even** | 4-6 months post-launch |
| **3-year net savings** | $124K-155K |
| **ROI** | 300-500% over 3 years |
