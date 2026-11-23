import type { ComponentProps, ReactNode } from "react";
import { CornerDownLeft } from "lucide-react";
import { cx } from "../../lib/cx";

export type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

interface ButtonStyleProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  iconOnly?: boolean;
  block?: boolean;
  icon?: ReactNode;
  /**
   * The keys that press this button, drawn inside it the way Resend draws
   * "Add ⌘ ↩". Wire the key itself with useHotkey.
   */
  keys?: string[];
  className?: string;
}

function classes({
  variant = "primary",
  size = "md",
  iconOnly,
  block,
  keys,
  className,
}: ButtonStyleProps) {
  return cx(
    "btn",
    `btn--${variant}`,
    size === "sm" && "btn--sm",
    iconOnly && "btn--icon",
    block && "btn--block",
    keys && "btn--has-keys",
    className
  );
}

function Inner({
  icon,
  keys,
  children,
}: {
  icon?: ReactNode;
  keys?: string[];
  children?: ReactNode;
}) {
  return (
    <>
      {icon}
      {children}
      {keys && (
        <span className="keys" aria-hidden>
          {keys.map((key) => (
            // The return arrow as text comes out as a colour emoji on a Mac.
            <kbd key={key}>
              {key === "↩" ? <CornerDownLeft strokeWidth={2.25} /> : key}
            </kbd>
          ))}
        </span>
      )}
    </>
  );
}

export type ButtonProps = ButtonStyleProps & Omit<ComponentProps<"button">, "className">;

export function Button({
  variant,
  size,
  iconOnly,
  block,
  icon,
  keys,
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={classes({ variant, size, iconOnly, block, keys, className })}
      {...rest}
    >
      <Inner icon={icon} keys={keys}>
        {children}
      </Inner>
    </button>
  );
}

export type ButtonAnchorProps = ButtonStyleProps & Omit<ComponentProps<"a">, "className">;

/** A link that looks like a button, for leaving the app (Box, mail). */
export function ButtonAnchor({
  variant,
  size,
  iconOnly,
  block,
  icon,
  keys,
  className,
  children,
  ...rest
}: ButtonAnchorProps) {
  return (
    <a className={classes({ variant, size, iconOnly, block, keys, className })} {...rest}>
      <Inner icon={icon} keys={keys}>
        {children}
      </Inner>
    </a>
  );
}
