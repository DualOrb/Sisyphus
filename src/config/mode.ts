/**
 * Operating mode configuration for Sisyphus.
 *
 * - "shadow"     — Full pipeline runs, but no real actions are executed.
 *                  Everything is logged as a "proposal" for human review.
 * - "supervised" — Actions execute but require human confirmation for ORANGE/RED tiers.
 * - "autonomous" — Full autonomous execution (with guardrails still enforced).
 *
 * Default is "shadow" so the system is safe-by-default on first deployment.
 */

export type OperatingMode = "shadow" | "supervised" | "autonomous";

const VALID_MODES: readonly OperatingMode[] = ["shadow", "supervised", "autonomous"];

/**
 * Read the operating mode from the OPERATING_MODE environment variable.
 * Falls back to "shadow" if unset or invalid.
 */
export function getOperatingMode(): OperatingMode {
  const raw = process.env.OPERATING_MODE?.toLowerCase();
  if (raw && VALID_MODES.includes(raw as OperatingMode)) {
    return raw as OperatingMode;
  }
  return "shadow";
}

/** True when Sisyphus is in shadow mode (proposals only, no real execution). */
export function isShadowMode(): boolean {
  return getOperatingMode() === "shadow";
}

/** True when Sisyphus is in supervised mode (human confirms ORANGE/RED). */
export function isSupervisedMode(): boolean {
  return getOperatingMode() === "supervised";
}

/** True when Sisyphus is fully autonomous (guardrails still enforced). */
export function isAutonomousMode(): boolean {
  return getOperatingMode() === "autonomous";
}
