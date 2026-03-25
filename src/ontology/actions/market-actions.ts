/**
 * Market monitoring action definitions.
 *
 * Actions:
 *   - FlagMarketIssue
 *
 * Registered as a side effect of importing this module.
 *
 * @see planning/09-ontology-layer-design.md section 4.4
 */

import { z } from "zod";
import { defineAction } from "../../guardrails/registry.js";
import { Tier } from "../../guardrails/types.js";
import type { OntologyStore } from "../state/store.js";
import { Severity } from "../objects/enums.js";

// ---------------------------------------------------------------------------
// Param schemas
// ---------------------------------------------------------------------------

const FlagMarketIssueParams = z.object({
  market: z.string().describe("PascalCase market name (e.g. 'PortElgin')"),
  issueType: z.enum(["low_drivers", "high_demand", "high_eta", "unassigned_orders"])
    .describe("Type of market health issue"),
  severity: Severity.describe("Issue severity level"),
  details: z.string().describe("Human-readable description of the issue"),
});

// ---------------------------------------------------------------------------
// FlagMarketIssue
// ---------------------------------------------------------------------------

defineAction({
  name: "FlagMarketIssue",
  description: "Flag a market health issue for awareness",
  tier: Tier.GREEN,
  paramsSchema: FlagMarketIssueParams,
  execution: "internal",
  sideEffects: ["notify_supervisor", "alert_dispatchers_if_high", "audit_log"],
  criteria: [
    {
      name: "market_exists",
      check: (params, state) => {
        const store = state as unknown as OntologyStore;
        const market = store.getMarket(params.market as string);
        if (!market) return { passed: false, message: "Market not found in store" };
        return { passed: true };
      },
    },
  ],
});
