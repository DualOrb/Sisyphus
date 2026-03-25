import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts"],
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      "@config": resolve(__dirname, "src/config"),
      "@ontology": resolve(__dirname, "src/ontology"),
      "@agents": resolve(__dirname, "src/agents"),
      "@execution": resolve(__dirname, "src/execution"),
      "@guardrails": resolve(__dirname, "src/guardrails"),
      "@memory": resolve(__dirname, "src/memory"),
      "@shift": resolve(__dirname, "src/shift"),
      "@llm": resolve(__dirname, "src/llm"),
      "@tools": resolve(__dirname, "src/tools"),
      "@lib": resolve(__dirname, "src/lib"),
      "@adapters": resolve(__dirname, "src/adapters"),
      "@events": resolve(__dirname, "src/events"),
    },
  },
});
