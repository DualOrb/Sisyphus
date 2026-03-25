/**
 * Unit tests for the ProcessWatcher file hot-reload system.
 *
 * Covers: debouncing, stop behavior, non-.md file filtering.
 * Uses vitest mocks for fs.watch and fs/promises.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { FSWatcher } from "node:fs";

// ---------------------------------------------------------------------------
// Mock state — shared between the mocked modules and tests
// ---------------------------------------------------------------------------

/** Captured watch callbacks, keyed by directory path. */
let watchCallbacks: Map<string, (eventType: string, filename: string | null) => void>;

/** All created fake watchers (so tests can verify .close() was called). */
let fakeWatchers: { close: ReturnType<typeof vi.fn> }[];

// ---------------------------------------------------------------------------
// Mock fs.watch (node:fs)
// ---------------------------------------------------------------------------

vi.mock("node:fs", () => ({
  watch: vi.fn((dir: string, cb: (eventType: string, filename: string | null) => void) => {
    watchCallbacks.set(dir, cb);
    const watcher = { close: vi.fn() };
    fakeWatchers.push(watcher);
    return watcher as unknown as FSWatcher;
  }),
}));

// ---------------------------------------------------------------------------
// Mock fs/promises — readdir returns no subdirectories by default
// ---------------------------------------------------------------------------

vi.mock("node:fs/promises", () => ({
  readdir: vi.fn(async () => []),
}));

// ---------------------------------------------------------------------------
// Mock the process-loader so we control what loadProcessDirectory returns
// ---------------------------------------------------------------------------

const mockLoadProcessDirectory = vi.fn(async () => [
  {
    name: "test-process",
    agent: "supervisor",
    trigger: "new_event",
    priority: "normal",
    version: "1.0",
    content: "# Test\nSome content",
    filePath: "/fake/processes/test.md",
  },
]);

vi.mock("@tools/process-loader", () => ({
  loadProcessDirectory: (...args: unknown[]) => mockLoadProcessDirectory(...args),
}));

// ---------------------------------------------------------------------------
// Mock the logger to silence output during tests
// ---------------------------------------------------------------------------

vi.mock("@lib/logger", () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Import after mocks are established
// ---------------------------------------------------------------------------

import { ProcessWatcher } from "@tools/process-watcher";

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("ProcessWatcher", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    watchCallbacks = new Map();
    fakeWatchers = [];
    mockLoadProcessDirectory.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Debouncing
  // -------------------------------------------------------------------------

  describe("debouncing", () => {
    it("coalesces multiple rapid changes into a single callback", async () => {
      const onChange = vi.fn();
      const watcher = new ProcessWatcher({ debounceMs: 100 });

      await watcher.watch("/fake/processes", onChange);

      // Simulate 5 rapid file changes
      const rootCb = watchCallbacks.get("/fake/processes")!;
      expect(rootCb).toBeDefined();

      rootCb("change", "file1.md");
      rootCb("change", "file2.md");
      rootCb("change", "file3.md");
      rootCb("rename", "file4.md");
      rootCb("change", "file5.md");

      // onChange should NOT have been called yet (still debouncing)
      expect(onChange).not.toHaveBeenCalled();

      // Advance past the debounce window
      await vi.advanceTimersByTimeAsync(150);

      // Now exactly one call
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(mockLoadProcessDirectory).toHaveBeenCalledTimes(1);

      // The callback receives the loaded files
      expect(onChange).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ name: "test-process" }),
        ]),
      );

      watcher.stop();
    });

    it("resets the debounce timer on each new change", async () => {
      const onChange = vi.fn();
      const watcher = new ProcessWatcher({ debounceMs: 200 });

      await watcher.watch("/fake/processes", onChange);
      const rootCb = watchCallbacks.get("/fake/processes")!;

      // First change at t=0
      rootCb("change", "file.md");

      // Another change at t=150 (resets the timer)
      await vi.advanceTimersByTimeAsync(150);
      expect(onChange).not.toHaveBeenCalled();
      rootCb("change", "file.md");

      // At t=300 (150ms after the last change, but less than 200ms debounce), not fired yet
      await vi.advanceTimersByTimeAsync(150);
      expect(onChange).not.toHaveBeenCalled();

      // At t=400 (200ms after the last change), it fires
      await vi.advanceTimersByTimeAsync(100);
      expect(onChange).toHaveBeenCalledTimes(1);

      watcher.stop();
    });
  });

  // -------------------------------------------------------------------------
  // Stop behavior
  // -------------------------------------------------------------------------

  describe("stop()", () => {
    it("prevents further callbacks after stopping", async () => {
      const onChange = vi.fn();
      const watcher = new ProcessWatcher({ debounceMs: 100 });

      await watcher.watch("/fake/processes", onChange);
      const rootCb = watchCallbacks.get("/fake/processes")!;

      // Trigger a change
      rootCb("change", "file.md");

      // Stop before debounce fires
      watcher.stop();

      // Advance past debounce
      await vi.advanceTimersByTimeAsync(200);

      // Callback should never fire
      expect(onChange).not.toHaveBeenCalled();
    });

    it("closes all underlying fs watchers", async () => {
      const watcher = new ProcessWatcher({ debounceMs: 100 });
      await watcher.watch("/fake/processes", vi.fn());

      expect(fakeWatchers.length).toBeGreaterThan(0);

      watcher.stop();

      for (const fw of fakeWatchers) {
        expect(fw.close).toHaveBeenCalled();
      }
    });

    it("ignores events triggered after stop even if the fs watcher leaks an event", async () => {
      const onChange = vi.fn();
      const watcher = new ProcessWatcher({ debounceMs: 50 });

      await watcher.watch("/fake/processes", onChange);
      const rootCb = watchCallbacks.get("/fake/processes")!;

      watcher.stop();

      // Simulate a late event from the OS (fs.watch can emit after close)
      rootCb("change", "late-file.md");
      await vi.advanceTimersByTimeAsync(200);

      expect(onChange).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // File filtering
  // -------------------------------------------------------------------------

  describe("file filtering", () => {
    it("ignores non-.md files", async () => {
      const onChange = vi.fn();
      const watcher = new ProcessWatcher({ debounceMs: 50 });

      await watcher.watch("/fake/processes", onChange);
      const rootCb = watchCallbacks.get("/fake/processes")!;

      // These should be ignored
      rootCb("change", "notes.txt");
      rootCb("change", "config.yaml");
      rootCb("change", "script.ts");
      rootCb("change", ".DS_Store");
      rootCb("change", "README");

      await vi.advanceTimersByTimeAsync(200);

      // No reload should have triggered
      expect(onChange).not.toHaveBeenCalled();
      expect(mockLoadProcessDirectory).not.toHaveBeenCalled();

      watcher.stop();
    });

    it("processes .md files correctly", async () => {
      const onChange = vi.fn();
      const watcher = new ProcessWatcher({ debounceMs: 50 });

      await watcher.watch("/fake/processes", onChange);
      const rootCb = watchCallbacks.get("/fake/processes")!;

      rootCb("change", "process.md");

      await vi.advanceTimersByTimeAsync(100);

      expect(onChange).toHaveBeenCalledTimes(1);

      watcher.stop();
    });

    it("ignores events with null filename", async () => {
      const onChange = vi.fn();
      const watcher = new ProcessWatcher({ debounceMs: 50 });

      await watcher.watch("/fake/processes", onChange);
      const rootCb = watchCallbacks.get("/fake/processes")!;

      rootCb("change", null as unknown as string);

      await vi.advanceTimersByTimeAsync(200);

      expect(onChange).not.toHaveBeenCalled();

      watcher.stop();
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe("error handling", () => {
    it("does not throw when loadProcessDirectory fails", async () => {
      mockLoadProcessDirectory.mockRejectedValueOnce(new Error("disk on fire"));

      const onChange = vi.fn();
      const watcher = new ProcessWatcher({ debounceMs: 50 });

      await watcher.watch("/fake/processes", onChange);
      const rootCb = watchCallbacks.get("/fake/processes")!;

      rootCb("change", "broken.md");

      // Should not throw — error is caught and logged
      await vi.advanceTimersByTimeAsync(200);

      expect(onChange).not.toHaveBeenCalled();
      expect(mockLoadProcessDirectory).toHaveBeenCalledTimes(1);

      watcher.stop();
    });
  });
});
