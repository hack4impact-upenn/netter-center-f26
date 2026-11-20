import type { ReactNode } from "react";
import { cx } from "../../lib/cx";

export type BadgeTone =
  | "neutral"
  | "green"
  | "amber"
  | "red"
  | "blue"
  | "outline"
  | "dashed";

export function Badge({
  tone = "neutral",
  dot,
  mono,
  title,
  className,
  children,
}: {
  tone?: BadgeTone;
  dot?: boolean;
  mono?: boolean;
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      title={title}
      className={cx("badge", `badge--${tone}`, mono && "badge--mono", className)}
    >
      {dot && <span className="badge__dot" />}
      {children}
    </span>
  );
}
