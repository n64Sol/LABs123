import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getRun, getGetRunQueryKey } from "@workspace/api-client-react";
import { RUN_SPRITE_NAMES } from "@/lib/runSprites";

interface Props {
  runId: string;
  /** Biome accent hex (e.g. "#7c5cff"). */
  accent: string;
  /** Labyrinth / biome name shown as the descent caption. */
  biomeName: string;
  /** Called once the descent completes and the run page should take over. */
  onBegin: () => void;
}

const WALK_MS = 2100;
const FADE_MS = 420;
// After the screen is fully black, wait at most this long for the run query/sprites
// to warm before navigating anyway (so a stalled network can never trap the player).
const BLACK_HOLD_CAP_MS = 3500;

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/**
 * Seamless walk-in entrance chamber. Renders a themed, torch-lit stone vestibule on
 * its own full-screen canvas while the player's silhouette descends toward a glowing
 * doorway. Meanwhile it warms the run's sprite cache and prefetches the run query so
 * that, when it hands off to the run page, there is no visible loading step — a short
 * cross-fade to black covers the route swap.
 *
 * It is intentionally self-contained (its own canvas, its own loop) so a bug here can
 * never break the live overworld map underneath it.
 */
export default function EntranceChamber({ runId, accent, biomeName, onBegin }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const qc = useQueryClient();

  // Latest callback via ref so the animation effect can run once on mount.
  const onBeginRef = useRef(onBegin);
  onBeginRef.current = onBegin;

  const readyRef = useRef(false);
  const skipRef = useRef<(() => void) | null>(null);

  // Warm sprite cache + prefetch the run while the player descends.
  useEffect(() => {
    for (const n of RUN_SPRITE_NAMES) {
      const img = new Image();
      img.src = `${import.meta.env.BASE_URL}game/${n}.png`;
    }
    const idNum = Number(runId);
    let cancelled = false;
    qc.prefetchQuery({ queryKey: getGetRunQueryKey(idNum), queryFn: () => getRun(idNum) })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) readyRef.current = true;
      });
    // No slow-network fallback needed here: the animation loop holds on a fully black
    // screen until readyRef flips, with its own BLACK_HOLD_CAP_MS backstop.
    return () => { cancelled = true; };
  }, [qc, runId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let disposed = false;
    const start = performance.now();
    let walkStart = start;
    let fadeStart: number | null = null;
    let dpr = 1;
    let W = 0;
    let H = 0;

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = window.innerWidth;
      H = window.innerHeight;
      canvas.width = Math.floor(W * dpr);
      canvas.height = Math.floor(H * dpr);
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
    };
    resize();
    window.addEventListener("resize", resize);

    const skip = () => { walkStart = performance.now() - WALK_MS; };
    skipRef.current = skip;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " " || e.key === "e" || e.key === "E") skip();
    };
    window.addEventListener("keydown", onKey);

    const hex = (a: number) => {
      const v = Math.max(0, Math.min(255, Math.round(a * 255))).toString(16).padStart(2, "0");
      return accent + v;
    };

    const draw = (now: number) => {
      if (disposed) return;
      const walkT = easeInOut(Math.min(1, (now - walkStart) / WALK_MS));

      // Begin fading the moment the descent finishes, regardless of network state.
      if (walkT >= 1 && fadeStart === null) fadeStart = now;
      const fade = fadeStart === null ? 0 : Math.min(1, (now - fadeStart) / FADE_MS);

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, W, H);

      const cx = W / 2;
      const vpY = H * 0.30;
      const floorY = H * 0.66;

      // Backdrop.
      const bg = ctx.createRadialGradient(cx, vpY, 20, cx, H * 0.5, Math.max(W, H) * 0.7);
      bg.addColorStop(0, "#0a0e16");
      bg.addColorStop(1, "#03040a");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // Side walls (dark, angled toward the vanishing point).
      ctx.fillStyle = "#0b0f17";
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(cx - 70, vpY); ctx.lineTo(cx - 70, vpY + 40); ctx.lineTo(0, H);
      ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(W, 0); ctx.lineTo(cx + 70, vpY); ctx.lineTo(cx + 70, vpY + 40); ctx.lineTo(W, H);
      ctx.closePath(); ctx.fill();

      // Floor.
      ctx.fillStyle = "#0f1420";
      ctx.beginPath();
      ctx.moveTo(0, H); ctx.lineTo(W, H); ctx.lineTo(cx + 70, vpY + 40); ctx.lineTo(cx - 70, vpY + 40);
      ctx.closePath(); ctx.fill();

      // Receding floor seams.
      ctx.strokeStyle = hex(0.16);
      ctx.lineWidth = 1;
      for (let i = 1; i <= 7; i++) {
        const t = i / 8;
        const y = H + (vpY + 40 - H) * t;
        const halfTop = 70;
        const halfBot = W / 2;
        const half = halfBot + (halfTop - halfBot) * t;
        ctx.beginPath();
        ctx.moveTo(cx - half, y);
        ctx.lineTo(cx + half, y);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(0, H); ctx.lineTo(cx - 70, vpY + 40);
      ctx.moveTo(W, H); ctx.lineTo(cx + 70, vpY + 40);
      ctx.stroke();

      // Wall torches with flicker.
      const torchY = [0.34, 0.5, 0.68];
      for (const ty of torchY) {
        const y = vpY + (floorY - vpY) * ty;
        const inset = 70 + (1 - ty) * (cx - 110);
        for (const sx of [-1, 1]) {
          const tx = cx + sx * inset;
          const flick = 0.7 + 0.3 * Math.sin(now / 90 + tx);
          const g = ctx.createRadialGradient(tx, y, 2, tx, y, 60 * (0.6 + 0.5 * ty));
          g.addColorStop(0, `rgba(255,180,90,${0.5 * flick})`);
          g.addColorStop(1, "rgba(255,150,60,0)");
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(tx, y, 60 * (0.6 + 0.5 * ty), 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = `rgba(255,210,140,${flick})`;
          ctx.beginPath();
          ctx.arc(tx, y, 3.5 * (0.6 + 0.6 * ty), 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Glowing far doorway, growing as we approach.
      const doorScale = 0.7 + walkT * 0.6;
      const dw = 70 * doorScale;
      const dh = 120 * doorScale;
      const dx = cx;
      const dy = vpY + 40;
      const dGlow = ctx.createRadialGradient(dx, dy + dh * 0.4, 6, dx, dy + dh * 0.4, dh * (1.1 + 0.3 * Math.sin(now / 400)));
      dGlow.addColorStop(0, hex(0.85));
      dGlow.addColorStop(0.5, hex(0.3));
      dGlow.addColorStop(1, hex(0));
      ctx.fillStyle = dGlow;
      ctx.fillRect(dx - dw * 1.6, dy - 20, dw * 3.2, dh * 1.8);
      // Arched door opening.
      ctx.fillStyle = "#01030a";
      ctx.beginPath();
      ctx.moveTo(dx - dw / 2, dy + dh);
      ctx.lineTo(dx - dw / 2, dy + dh * 0.4);
      ctx.arc(dx, dy + dh * 0.4, dw / 2, Math.PI, Math.PI * 2, false);
      ctx.lineTo(dx + dw / 2, dy + dh);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = hex(0.7);
      ctx.lineWidth = 3;
      ctx.stroke();

      // Hero silhouette descending (back view), shrinking toward the door.
      const hx = cx;
      const hy = floorY + (dy + dh * 0.8 - floorY) * walkT;
      const hScale = 1 - walkT * 0.45;
      const stride = Math.sin(now / 130) * 6 * hScale;
      ctx.save();
      ctx.translate(hx, hy);
      ctx.scale(hScale, hScale);
      // Lantern glow at the hero's side.
      const lg = ctx.createRadialGradient(16, -34, 2, 16, -34, 46);
      lg.addColorStop(0, "rgba(255,196,110,0.7)");
      lg.addColorStop(1, "rgba(255,196,110,0)");
      ctx.fillStyle = lg;
      ctx.beginPath(); ctx.arc(16, -34, 46, 0, Math.PI * 2); ctx.fill();
      // Shadow.
      ctx.fillStyle = "rgba(0,0,0,0.4)";
      ctx.beginPath(); ctx.ellipse(0, 2, 22, 7, 0, 0, Math.PI * 2); ctx.fill();
      // Legs.
      ctx.fillStyle = "#06070c";
      ctx.fillRect(-9 + stride * 0.5, -22, 7, 24);
      ctx.fillRect(2 - stride * 0.5, -22, 7, 24);
      // Cloaked body.
      ctx.beginPath();
      ctx.moveTo(-16, -20);
      ctx.lineTo(16, -20);
      ctx.lineTo(11, -64);
      ctx.lineTo(-11, -64);
      ctx.closePath();
      ctx.fillStyle = "#0a0c14";
      ctx.fill();
      // Rim light along one shoulder, biome-tinted.
      ctx.strokeStyle = hex(0.5);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-16, -20); ctx.lineTo(-11, -64); ctx.stroke();
      // Hood / head.
      ctx.fillStyle = "#0a0c14";
      ctx.beginPath(); ctx.arc(0, -70, 9, 0, Math.PI * 2); ctx.fill();
      ctx.restore();

      // Dust motes drifting up in the light.
      for (let i = 0; i < 14; i++) {
        const ph = now / 1600 + i * 1.7;
        const mx = cx + Math.sin(ph * 1.3 + i) * (W * 0.12);
        const span = floorY - vpY;
        const my = floorY - (((ph * 30) % span) + span) % span;
        ctx.globalAlpha = 0.10 + 0.10 * (0.5 + 0.5 * Math.sin(ph * 2));
        ctx.fillStyle = "#ffd9a0";
        ctx.beginPath(); ctx.arc(mx, my, 1.4, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Vignette.
      const vg = ctx.createRadialGradient(cx, H * 0.5, H * 0.25, cx, H * 0.5, H * 0.75);
      vg.addColorStop(0, "rgba(0,0,0,0)");
      vg.addColorStop(1, "rgba(0,0,0,0.7)");
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, W, H);

      // Caption.
      ctx.textAlign = "center";
      ctx.globalAlpha = 0.9 - fade;
      ctx.fillStyle = "#f3ead2";
      ctx.font = "700 26px ui-sans-serif, system-ui, sans-serif";
      ctx.fillText(`Descending into ${biomeName}`, cx, H * 0.16);
      ctx.font = "500 14px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "rgba(243,234,210,0.6)";
      const hint = walkT >= 1 && !readyRef.current ? "Steadying the torchlight…" : "Enter to descend";
      ctx.fillText(hint, cx, H * 0.16 + 26);
      ctx.globalAlpha = 1;
      ctx.textAlign = "left";

      // Fade to black for the seamless hand-off.
      if (fade > 0) {
        ctx.fillStyle = `rgba(0,0,0,${fade})`;
        ctx.fillRect(0, 0, W, H);
      }

      ctx.restore();

      // Once the screen is fully black, hold here until the run is actually warm so
      // Run.tsx never flashes its own loading state. A hard cap guarantees we still
      // navigate even if the prefetch never resolves.
      if (fade >= 1 && fadeStart !== null) {
        const heldMs = now - (fadeStart + FADE_MS);
        if (readyRef.current || heldMs >= BLACK_HOLD_CAP_MS) {
          disposed = true;
          window.removeEventListener("resize", resize);
          window.removeEventListener("keydown", onKey);
          onBeginRef.current();
          return;
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", onKey);
    };
  }, [accent, biomeName]);

  return (
    <div className="fixed inset-0 z-50 bg-black" aria-hidden>
      <canvas
        ref={canvasRef}
        className="h-full w-full cursor-pointer"
        onClick={() => skipRef.current?.()}
      />
    </div>
  );
}
