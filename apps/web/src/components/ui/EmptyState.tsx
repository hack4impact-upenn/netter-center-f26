import type { ReactNode } from "react";

export function EmptyState({
  art,
  title,
  description,
  action,
}: {
  art: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div>
        <div className="empty__art">{art}</div>
        <p className="empty__title">{title}</p>
        {description && <p className="empty__desc">{description}</p>}
      </div>
      {action}
    </div>
  );
}
