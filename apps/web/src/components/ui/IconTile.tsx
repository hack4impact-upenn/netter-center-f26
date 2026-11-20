import type { ReactNode } from "react";

export type TileTone = "neutral" | "green" | "amber" | "red" | "blue";
type TileSize = "sm" | "md" | "lg" | "xl";

/**
 * A superellipse as a CSS clip-path, `size` pixels square: the shape of an
 * app icon. Five is the exponent Resend's tiles use.
 */
function squircle(size: number, n = 5, steps = 72) {
  const a = size / 2;
  const points: string[] = [];
  for (let i = 0; i < steps; i++) {
    const th = (i / steps) * Math.PI * 2;
    const c = Math.cos(th);
    const s = Math.sin(th);
    const x = a + a * Math.sign(c) * Math.abs(c) ** (2 / n);
    const y = a + a * Math.sign(s) * Math.abs(s) ** (2 / n);
    points.push(`${x.toFixed(2)} ${y.toFixed(2)}`);
  }
  return `path('M ${points.join(" L ")} Z')`;
}

/** Each size's squircle, its rim, and the dark ring inside the rim, in pixels. */
const SIZES: Record<TileSize, { px: number; rim: number; ring: number; ink: number }> = {
  sm: { px: 32, rim: 1, ring: 1.5, ink: 16 },
  md: { px: 40, rim: 1, ring: 2, ink: 18 },
  lg: { px: 48, rim: 1, ring: 2, ink: 20 },
  xl: { px: 80, rim: 2, ring: 3.5, ink: 34 },
};

const CLIPS = Object.fromEntries(
  Object.entries(SIZES).map(([size, s]) => [
    size,
    {
      outline: squircle(s.px),
      ring: squircle(s.px - 2 * s.rim),
      face: squircle(s.px - 2 * (s.rim + s.ring)),
    },
  ])
) as Record<TileSize, { outline: string; ring: string; face: string }>;

/**
 * After Resend's icon tiles: a squircle with a rim lit from above, a dark
 * ring, and a face. A toned tile lights its face from within in that colour.
 */
export function IconTile({
  tone = "neutral",
  size = "md",
  children,
}: {
  tone?: TileTone;
  size?: TileSize;
  children: ReactNode;
}) {
  const s = SIZES[size];
  const clip = CLIPS[size];
  return (
    <span
      data-tone={tone}
      className="tile"
      style={{ width: s.px, height: s.px, clipPath: clip.outline }}
    >
      <span aria-hidden className="tile__rim" />
      <span
        aria-hidden
        className="tile__gap"
        style={{ inset: s.rim, clipPath: clip.ring }}
      />
      <span
        aria-hidden
        className="tile__face"
        style={{ inset: s.rim + s.ring, clipPath: clip.face }}
      />
      <span className="tile__ink" style={{ width: s.ink, height: s.ink }}>
        {children}
      </span>
    </span>
  );
}
