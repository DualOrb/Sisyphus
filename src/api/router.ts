/**
 * Lightweight HTTP router for the Sisyphus dashboard API.
 *
 * Adds a route table + path-param matcher to the existing raw `http` server.
 * No Express needed — just a Map of pattern → handler.
 */

import type http from "node:http";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RouteParams {
  [key: string]: string;
}

export interface RouteContext {
  params: RouteParams;
  query: URLSearchParams;
}

export type RouteHandler = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: RouteContext,
) => Promise<void> | void;

interface CompiledRoute {
  pattern: string;
  paramNames: string[];
  regex: RegExp;
  handler: RouteHandler;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export class ApiRouter {
  private routes: CompiledRoute[] = [];

  /**
   * Register a GET route.
   *
   * Supports path parameters with `:param` syntax:
   *   router.get("/api/orders/:id", handler)
   */
  get(pattern: string, handler: RouteHandler): void {
    const paramNames: string[] = [];
    const regexStr = pattern.replace(/:([^/]+)/g, (_match, name) => {
      paramNames.push(name);
      return "([^/]+)";
    });
    this.routes.push({
      pattern,
      paramNames,
      regex: new RegExp(`^${regexStr}$`),
      handler,
    });
  }

  /**
   * Try to match a URL path to a registered route.
   * Returns the handler and context if matched, or null.
   */
  match(url: string): { handler: RouteHandler; ctx: RouteContext } | null {
    const parsed = new URL(url, "http://localhost");
    const pathname = parsed.pathname;

    for (const route of this.routes) {
      const m = pathname.match(route.regex);
      if (m) {
        const params: RouteParams = {};
        for (let i = 0; i < route.paramNames.length; i++) {
          params[route.paramNames[i]] = decodeURIComponent(m[i + 1]);
        }
        return {
          handler: route.handler,
          ctx: { params, query: parsed.searchParams },
        };
      }
    }

    return null;
  }
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function json(res: http.ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { "Content-Type": "application/json", ...CORS_HEADERS });
  res.end(JSON.stringify(data));
}

export function notFound(res: http.ServerResponse): void {
  json(res, { error: "Not found" }, 404);
}

export function serverError(res: http.ServerResponse, message: string): void {
  json(res, { error: message }, 500);
}
