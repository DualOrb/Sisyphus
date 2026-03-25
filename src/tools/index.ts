/**
 * Barrel export for agent tools.
 *
 * - process-loader: Reads and parses process .md files into structured objects
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

// ---- Ontology LangGraph tools ----
export { createOntologyTools } from "./ontology-tools.js";
