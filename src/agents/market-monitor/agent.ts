/**
 * Market Monitor sub-agent.
 *
 * Watches market health: driver/order ratios, unassigned orders, high
 * ETAs, zone health scores. Flags anomalies to the supervisor.
 *
 * Tools: query_orders, query_drivers, get_entity_timeline, execute_action
 * (for FlagMarketIssue).
 *
 * @see planning/03-agent-design.md section 2.2
 */

import type { DynamicStructuredTool } from "@langchain/core/tools";
import type { ChatOpenAI } from "@langchain/openai";
import { createAgentNode, type AgentNodeConfig } from "../create-agent.js";
import type { AgentStateType, AgentStateUpdate } from "../state.js";

// ---------------------------------------------------------------------------
// Agent identity
// ---------------------------------------------------------------------------

export const MARKET_MONITOR_NAME = "market_monitor";

const MARKET_MONITOR_PREAMBLE = `
## Your Role: Market Monitor Agent

You are the Market Monitor agent for Sisyphus. Your job is to watch the overall health of each delivery zone and flag anomalies before they become customer-facing problems.

### What You Monitor:
- Unassigned orders (any order without a driver for > 3 minutes is urgent)
- Driver-to-order ratio per zone (below 1.0 means understaffed)
- Average ETA across zones (above 25 min signals slowdown)
- Driver offline rates (above 30% is a concern)
- Order volume spikes (2x normal volume = potential surge)

### Your Tools:
- **query_orders** — Find orders by status, zone, driver
- **query_drivers** — Find drivers by zone, availability
- **get_entity_timeline** — Check recent events for an entity
- **execute_action** — Flag issues via FlagMarketIssue action

### Decision Framework:
1. Query current orders and drivers to assess zone health
2. Identify any anomalies against thresholds
3. For each anomaly, use execute_action with FlagMarketIssue to create an alert
4. Summarize your findings for the supervisor

### Important:
- Be proactive, not reactive. Flag issues early.
- Provide specific data in your flags (e.g., "Zone A has 5 unassigned orders, only 2 available drivers").
- Do NOT send messages to drivers or resolve tickets — that's not your job.
`;

// ---------------------------------------------------------------------------
// Tool filter
// ---------------------------------------------------------------------------

const ALLOWED_TOOL_NAMES = new Set([
  "query_orders",
  "query_drivers",
  "get_entity_timeline",
  "execute_action",
]);

/**
 * Filter the full ontology tool set to only those the market monitor
 * is authorised to use.
 */
export function filterMarketMonitorTools(
  allTools: DynamicStructuredTool[],
): DynamicStructuredTool[] {
  return allTools.filter((t) => ALLOWED_TOOL_NAMES.has(t.name));
}

// ---------------------------------------------------------------------------
// Node factory
// ---------------------------------------------------------------------------

export interface MarketMonitorConfig {
  /** System prompt assembled from process files. */
  processPrompt: string;
  /** Filtered ontology tools for this agent. */
  tools: DynamicStructuredTool[];
  /** Pre-configured ChatOpenAI instance. */
  model: ChatOpenAI;
}

/**
 * Create the market monitor graph node.
 */
export function createMarketMonitorNode(
  config: MarketMonitorConfig,
): (state: AgentStateType) => Promise<AgentStateUpdate> {
  const agentConfig: AgentNodeConfig = {
    name: MARKET_MONITOR_NAME,
    systemPrompt: MARKET_MONITOR_PREAMBLE + "\n\n" + config.processPrompt,
    tools: config.tools,
    model: config.model,
    maxIterations: 8,
  };

  return createAgentNode(agentConfig);
}
