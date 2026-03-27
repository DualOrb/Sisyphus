/**
 * Canvas-rendered holographic icon textures for the 3D graph.
 *
 * Each entity type gets an SVG icon rendered to canvas with glow.
 * Textures are cached by type+color key for reuse across nodes.
 */

import * as THREE from "three";

// ---------------------------------------------------------------------------
// SVG icon paths (stroke-based, 24x24 viewbox)
// Sourced from Heroicons / Feather style
// ---------------------------------------------------------------------------

const ICON_SVGS: Record<string, string> = {
  // Shopping bag (order)
  order: `<path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4zM3 6h18M16 10a4 4 0 01-8 0" fill="none" stroke="COLOR" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,

  // Car (driver)
  driver: `<path d="M5 17h14M5 17a2 2 0 01-2-2v-4l2-5h14l2 5v4a2 2 0 01-2 2M7 17a2 2 0 100-4 2 2 0 000 4zM17 17a2 2 0 100-4 2 2 0 000 4z" fill="none" stroke="COLOR" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,

  // Storefront (restaurant)
  restaurant: `<path d="M3 21h18M3 10h18M5 6l1-3h12l1 3M4 10v11M20 10v11M8 14v3M12 14v3M16 14v3" fill="none" stroke="COLOR" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,

  // Globe (market)
  market: `<circle cx="12" cy="12" r="10" fill="none" stroke="COLOR" stroke-width="1.2"/><path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10A15.3 15.3 0 0112 2z" fill="none" stroke="COLOR" stroke-width="1.2"/>`,

  // Alert triangle (ticket)
  ticket: `<path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4M12 17h.01" fill="none" stroke="COLOR" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,
};

// ---------------------------------------------------------------------------
// Texture cache
// ---------------------------------------------------------------------------

const cache = new Map<string, THREE.CanvasTexture>();

/**
 * Create (or return cached) holographic icon texture.
 */
export function getIconTexture(
  entityType: string,
  color: string,
  active: boolean = false,
): THREE.CanvasTexture {
  const key = `${entityType}:${color}:${active}`;
  if (cache.has(key)) return cache.get(key)!;

  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  // Outer glow circle
  const cx = size / 2;
  const cy = size / 2;
  const glowRadius = size * 0.45;

  // Background glow
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowRadius);
  const alpha = active ? 0.25 : 0.08;
  grad.addColorStop(0, hexToRGBA(color, alpha));
  grad.addColorStop(0.6, hexToRGBA(color, alpha * 0.4));
  grad.addColorStop(1, "transparent");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  // Thin ring
  ctx.beginPath();
  ctx.arc(cx, cy, glowRadius * 0.8, 0, Math.PI * 2);
  ctx.strokeStyle = hexToRGBA(color, active ? 0.5 : 0.2);
  ctx.lineWidth = 1;
  ctx.stroke();

  // Render SVG icon to canvas
  const svgMarkup = ICON_SVGS[entityType] ?? ICON_SVGS.order;
  const svgStr = svgMarkup.replace(/COLOR/g, color);
  const iconSize = size * 0.4;
  const offset = (size - iconSize) / 2;

  const img = new Image();
  const svgFull = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${iconSize}" height="${iconSize}">${svgStr}</svg>`;
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgFull);

  // Since img.onload is async, we draw synchronously with a fallback
  // and update the texture when the SVG loads
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;

  img.onload = () => {
    // Glow behind icon
    ctx.shadowColor = color;
    ctx.shadowBlur = active ? 12 : 6;
    ctx.drawImage(img, offset, offset, iconSize, iconSize);
    ctx.shadowBlur = 0;

    texture.needsUpdate = true;
  };

  // Fallback: draw a simple symbol immediately
  ctx.font = `${iconSize * 0.6}px monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  const symbols: Record<string, string> = {
    order: "O", driver: "D", restaurant: "R", market: "M", ticket: "T",
  };
  ctx.fillText(symbols[entityType] ?? "?", cx, cy);

  cache.set(key, texture);
  return texture;
}

/**
 * Create a starfield background texture.
 */
export function createStarfieldTexture(): THREE.CanvasTexture {
  const size = 2048;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  // Deep space gradient
  ctx.fillStyle = "#000008";
  ctx.fillRect(0, 0, size, size);

  // Stars
  for (let i = 0; i < 1500; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = Math.random() * 1.2;
    const brightness = 0.2 + Math.random() * 0.6;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(180, 200, 255, ${brightness})`;
    ctx.fill();
  }

  // Faint nebula wisps
  for (let i = 0; i < 4; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, 200 + Math.random() * 300);
    const hue = Math.random() < 0.5 ? "60, 100, 200" : "100, 50, 150";
    grad.addColorStop(0, `rgba(${hue}, 0.03)`);
    grad.addColorStop(1, "transparent");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  return tex;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hexToRGBA(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16) || 0;
  const g = parseInt(h.substring(2, 4), 16) || 0;
  const b = parseInt(h.substring(4, 6), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
