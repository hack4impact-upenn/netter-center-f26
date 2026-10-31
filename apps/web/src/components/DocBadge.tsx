import { Check, Clock, RotateCcw } from "lucide-react";
import type { DocKey, DocRecord, DocStatus } from "../types";
import { DOCS, REASON_LABEL, STATUS_LABEL } from "../lib/clearance";
import { Badge, type BadgeTone } from "./ui";

const TONE: Record<DocStatus, BadgeTone> = {
  approved: "green",
  uploaded: "blue",
  resubmit: "red",
  missing: "dashed",
};

/** Each status has its own shape as well as its colour, so it reads without colour too. */
const ICON: Record<DocStatus, typeof Check | null> = {
  approved: Check,
  uploaded: Clock,
  resubmit: RotateCcw,
  missing: null,
};

export function StatusBadge({
  status,
  children,
}: {
  status: DocStatus;
  children: string;
}) {
  const Icon = ICON[status];
  return (
    <Badge tone={TONE[status]}>
      {Icon && <Icon strokeWidth={2.25} aria-hidden />}
      {children}
    </Badge>
  );
}

export function DocBadge({
  doc,
  record,
}: {
  doc: DocKey;
  record: DocRecord | undefined;
}) {
  const status = record?.status ?? "missing";
  const reason = record?.reason ? ` (${REASON_LABEL[record.reason].toLowerCase()})` : "";
  const label = `${DOCS[doc].name}: ${STATUS_LABEL[status]}${reason}`;
  const Icon = ICON[status];
  return (
    <Badge tone={TONE[status]} title={label}>
      {Icon && <Icon strokeWidth={2.25} aria-hidden />}
      <span aria-hidden>{DOCS[doc].short}</span>
      <span className="sr-only">{label}</span>
    </Badge>
  );
}

export function StatusLegend() {
  return (
    <div className="legend" aria-label="Document statuses">
      {(["approved", "uploaded", "resubmit", "missing"] as const).map((status) => (
        <StatusBadge key={status} status={status}>
          {STATUS_LABEL[status]}
        </StatusBadge>
      ))}
    </div>
  );
}
