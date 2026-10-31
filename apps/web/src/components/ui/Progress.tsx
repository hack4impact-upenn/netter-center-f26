import { cx } from "../../lib/cx";

export function Progress({
  value,
  tone = "accent",
  label,
}: {
  /** 0 to 100. */
  value: number;
  tone?: "accent" | "green";
  label?: string;
}) {
  const width = Math.max(0, Math.min(100, value));
  return (
    <div
      className={cx("progress", tone === "green" && "progress--green")}
      role="progressbar"
      aria-valuenow={width}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div className="progress__bar" style={{ width: `${width}%` }} />
    </div>
  );
}

/** A bar with its percentage beside it, for a table cell. */
export function Meter({
  value,
  tone,
  label,
}: {
  value: number;
  tone?: "accent" | "green";
  label?: string;
}) {
  return (
    <div className="meter">
      <Progress value={value} tone={tone} label={label} />
      <span className="meter__value">{value}%</span>
    </div>
  );
}
