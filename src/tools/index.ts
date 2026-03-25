/**
 * Barrel export for agent tools.
 *
 * - process-loader: Reads and parses process .md files into structured objects
 * - process-watcher: File watcher for hot-reloading process files on change
 * - ontology-tools: LangGraph tools agents use to interact with the ontology
 */

// ---- Process file loader ----
export {
  type ProcessFile,
  loadProcessFileAsync,
  loadProcessDirectory,
  getProcessesForAgent,
  buildSystemPrompt,
} from "./process-loader.js";

// ---- Process file watcher (hot-reload) ----
export { ProcessWatcher } from "./process-watcher.js";

// ---- Ontology LangGraph tools ----
export { createOntologyTools } from "./ontology-tools.js";
