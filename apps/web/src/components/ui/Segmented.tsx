import type { ReactNode } from "react";
import { cx } from "../../lib/cx";

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  count?: number;
}

/** A choice of one, drawn as Resend's pill tabs. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  options: SegmentedOption<T>[];
  size?: "sm";
  label?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cx("seg", size === "sm" && "seg--sm")}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          className="seg__item"
          onClick={() => onChange(option.value)}
        >
          {option.label}
          {option.count !== undefined && (
            <span className="seg__count num">{option.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className="switch"
      onClick={() => onChange(!checked)}
    />
  );
}
