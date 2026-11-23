import type { ComponentProps, ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cx } from "../../lib/cx";

export function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && <p className="field__hint">{hint}</p>}
    </div>
  );
}

export function Input({
  leading,
  size,
  className,
  ...rest
}: Omit<ComponentProps<"input">, "size"> & { leading?: ReactNode; size?: "sm" }) {
  return (
    <label className={cx("control", size === "sm" && "control--sm", className)}>
      {leading}
      <input {...rest} />
    </label>
  );
}

export function Select({
  size,
  className,
  children,
  ...rest
}: Omit<ComponentProps<"select">, "size"> & { size?: "sm" }) {
  return (
    <div
      className={cx("control control--select", size === "sm" && "control--sm", className)}
    >
      <select {...rest}>{children}</select>
      <ChevronDown />
    </div>
  );
}

export function Textarea({ className, ...rest }: ComponentProps<"textarea">) {
  return (
    <div className={cx("control control--textarea", className)}>
      <textarea {...rest} />
    </div>
  );
}
