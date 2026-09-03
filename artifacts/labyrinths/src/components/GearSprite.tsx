import { useEffect, useRef, useState } from "react";
import { composeSpriteFromLayers, drawStillPose } from "@/lib/sprite";

/**
 * A single composited gear sprite, rendered from a template's flat
 * `{ layerKey -> relativePath }` sprite-layer map over the shared base body —
 * the exact same compositor the in-game character and loadout preview use, so a
 * Codex entry looks identical to the gear in a run.
 *
 * Composition is deferred until the sprite scrolls into view (Intersection
 * observer) so a gallery of hundreds of catalog entries doesn't decode every
 * base sheet at once. Falls back to the template emoji icon when the sprite is
 * still loading, has no sprite layers, or composition is unavailable.
 */
export function GearSprite({
  layers,
  fallbackIcon,
  size = 72,
  className = "",
}: {
  layers?: Record<string, string> | null;
  fallbackIcon?: string;
  size?: number;
  className?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [drawn, setDrawn] = useState(false);

  const hasLayers = !!layers && Object.keys(layers).length > 0;

  // Only start composing once the card enters the viewport.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || visible) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible || !hasLayers) return;
    let cancelled = false;
    const baseUrl = import.meta.env.BASE_URL as string;

    composeSpriteFromLayers(layers, baseUrl).then((composed) => {
      if (cancelled || !composed) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = size * dpr;
      canvas.height = size * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      // Scale the 64px still cell up to fill the box, anchored slightly low.
      drawStillPose(ctx, composed, 0, size * 0.04, size);
      setDrawn(true);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, hasLayers, size]);

  return (
    <div
      ref={wrapRef}
      className={`relative flex items-center justify-center overflow-hidden ${className}`}
      style={{ width: size, height: size }}
    >
      {hasLayers ? (
        <canvas
          ref={canvasRef}
          className="h-full w-full [image-rendering:pixelated]"
          style={{ opacity: drawn ? 1 : 0, transition: "opacity 150ms ease" }}
        />
      ) : (
        <span className="text-3xl" aria-hidden>
          {fallbackIcon}
        </span>
      )}
      {hasLayers && !drawn && (
        <span className="absolute text-3xl opacity-60" aria-hidden>
          {fallbackIcon}
        </span>
      )}
    </div>
  );
}
