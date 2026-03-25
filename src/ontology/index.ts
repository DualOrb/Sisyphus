/**
 * Top-level barrel export for the Sisyphus ontology layer.
 *
 * Combines:
 *   - objects  — Zod schemas and inferred TypeScript types
 *   - state    — In-memory OntologyStore with query methods
 *   - sync     — Dispatch API client, transformers, and sync orchestrator
 */

// ---- Object schemas & types ----
export * from "./objects/index.js";

// ---- State management ----
export * from "./state/index.js";

// ---- Sync layer ----
export * from "./sync/index.js";
