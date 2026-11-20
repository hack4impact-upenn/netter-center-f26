import type { ComponentProps, ReactNode } from "react";
import { cx } from "../../lib/cx";

export function Card({ className, ...rest }: ComponentProps<"div">) {
  return <div className={cx("card", className)} {...rest} />;
}

export function CardHeader({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="card__header">
      <div>
        <h3 className="card__title">{title}</h3>
        {description && <p className="card__desc">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function StatTile({
  label,
  value,
  detail,
  action,
  aside,
}: {
  label: ReactNode;
  value: ReactNode;
  detail?: ReactNode;
  action?: ReactNode;
  /** Sits opposite the label: a badge, a tile. */
  aside?: ReactNode;
}) {
  return (
    <Card className="stat">
      <div className="stat__label">
        <span>{label}</span>
        {aside}
      </div>
      <p className="stat__value display">{value}</p>
      {detail && <div className="stat__detail">{detail}</div>}
      {action && <div className="stat__action">{action}</div>}
    </Card>
  );
}
