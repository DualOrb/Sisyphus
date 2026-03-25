/**
 * File watcher for process .md hot-reload.
 *
 * Watches a directory of process files and triggers a reload callback when
 * any .md file changes. This enables live editing of agent behavior without
 * restarting the system — edit a markdown file, save, and agents rebuild
 * their system prompts within 500ms.
 *
 * Uses Node's built-in `fs.watch` with debouncing to coalesce rapid saves
 * (e.g. auto-formatters, multi-file renames) into a single reload.
 *
 * @see planning/03-agent-design.md section 6 (hot reload)
 */

import { watch, type FSWatcher } from "node:fs";
import { resolve, extname, join } from "node:path";
import { readdir } from "node:fs/promises";
import { loadProcessDirectory, type ProcessFile } from "./process-loader.js";
import { createChildLogger } from "../lib/index.js";

const log = createChildLogger("process-watcher");

// ---------------------------------------------------------------------------
// ProcessWatcher
// ---------------------------------------------------------------------------

export class ProcessWatcher {
  private watchers: FSWatcher[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  /** Debounce window in milliseconds. */
  private readonly debounceMs: number;

  constructor(opts?: { debounceMs?: number }) {
    this.debounceMs = opts?.debounceMs ?? 500;
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Start watching a directory (and subdirectories) for .md file changes.
   *
   * On any change to a .md file, waits for the debounce window to expire,
   * then re-reads ALL process files and invokes the onChange callback with
   * the complete new set. This is intentionally a full reload rather than
   * an incremental patch — process files are small and the reload is fast.
   */
  async watch(
    dirPath: string,
    onChange: (files: ProcessFile[]) => void,
  ): Promise<void> {
    const absoluteDir = resolve(dirPath);

    log.info({ dir: absoluteDir, debounceMs: this.debounceMs }, "Starting process file watcher");

    // Collect all directories to watch (recursive)
    const dirs = await collectDirectories(absoluteDir);
    dirs.push(absoluteDir);

    for (const dir of dirs) {
      try {
        const watcher = watch(dir, (eventType, filename) => {
          if (this.stopped) return;
          if (!filename) return;

          // Ignore non-.md files
          if (extname(filename) !== ".md") return;

          const changedPath = join(dir, filename);
          log.info(
            { event: eventType, file: changedPath },
            "Process file changed",
          );

          this.scheduleReload(absoluteDir, onChange);
        });

        this.watchers.push(watcher);
      } catch (err) {
        log.warn({ dir, err }, "Failed to watch directory");
      }
    }

    log.info(
      { directories: dirs.length },
      "Process file watcher active",
    );
  }

  /**
   * Stop watching for file changes. Further callbacks will not be invoked.
   */
  stop(): void {
    this.stopped = true;

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    for (const watcher of this.watchers) {
      watcher.close();
    }
    this.watchers = [];

    log.info("Process file watcher stopped");
  }

  // --------------------------------------------------------------------------
  // Internal
  // --------------------------------------------------------------------------

  /**
   * Schedule a reload after the debounce window. If another change arrives
   * before the window expires, the timer resets — only the final batch
   * triggers the actual reload.
   */
  private scheduleReload(
    dirPath: string,
    onChange: (files: ProcessFile[]) => void,
  ): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(async () => {
      if (this.stopped) return;

      try {
        log.info({ dir: dirPath }, "Reloading all process files");
        const files = await loadProcessDirectory(dirPath);
        log.info(
          { count: files.length },
          "Process files reloaded successfully",
        );
        onChange(files);
      } catch (err) {
        log.error({ err }, "Failed to reload process files");
      }
    }, this.debounceMs);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Recursively collect all subdirectory paths under a root directory.
 */
async function collectDirectories(root: string): Promise<string[]> {
  const result: string[] = [];

  try {
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const subdir = join(root, entry.name);
        result.push(subdir);
        const nested = await collectDirectories(subdir);
        result.push(...nested);
      }
    }
  } catch {
    // Directory may have been removed between listing and reading
  }

  return result;
}
