import type {
  BlastFrequency,
  Course,
  DocKey,
  DocStatus,
  RejectReason,
  Student,
} from "../types";

export interface DocInfo {
  key: DocKey;
  name: string;
  /** Short enough to sit in a badge in a table row. */
  short: string;
  /** The prefix students use when naming the file in Box. */
  code: string;
}

export const DOCS: Record<DocKey, DocInfo> = {
  pca: { key: "pca", name: "PA Child Abuse", short: "PCA", code: "PCA" },
  patch: {
    key: "patch",
    name: "PA Criminal History (PATCH)",
    short: "PATCH",
    code: "PATCH",
  },
  fbi: { key: "fbi", name: "FBI Fingerprint", short: "FBI", code: "FBI" },
  mandated: {
    key: "mandated",
    name: "Mandated Reporter",
    short: "Mandated Reporter",
    code: "MANDATED",
  },
  conduct: {
    key: "conduct",
    name: "SDP Code of Conduct",
    short: "Code of Conduct",
    code: "CONDUCT",
  },
  affidavit: {
    key: "affidavit",
    name: "International Affidavit",
    short: "Affidavit",
    code: "AFFIDAVIT",
  },
};

/** Required by law for everyone, unless the student is international without an SSN. */
export const CORE_DOCS: DocKey[] = ["pca", "patch", "fbi"];

/** Extras a course can switch on in Settings. */
export const EXTRA_DOCS: DocKey[] = ["mandated", "conduct"];

export const STATUS_LABEL: Record<DocStatus, string> = {
  missing: "Missing",
  uploaded: "Uploaded",
  approved: "Approved",
  resubmit: "Needs resubmission",
};

export const REASON_LABEL: Record<RejectReason, string> = {
  wrong: "Wrong document",
  expired: "Expired",
  other: "Other",
};

export const FREQUENCY_DAYS: Record<BlastFrequency, number> = {
  daily: 1,
  weekly: 7,
  biweekly: 14,
};

export function requiredDocs(student: Student, course: Course | undefined): DocKey[] {
  const core: DocKey[] = student.intlNoSsn ? ["affidavit"] : CORE_DOCS;
  return [...core, ...(course?.extraDocs ?? [])];
}

export function docStatus(student: Student, doc: DocKey): DocStatus {
  return student.docs[doc]?.status ?? "missing";
}

export interface Progress {
  required: number;
  uploaded: number;
  approved: number;
  uploadedPct: number;
  approvedPct: number;
  complete: boolean;
}

/** Uploaded counts anything a student has sent in, approved or not; a rejected file must be sent again. */
export function progressOf(student: Student, course: Course | undefined): Progress {
  const docs = requiredDocs(student, course);
  const statuses = docs.map((d) => docStatus(student, d));
  const uploaded = statuses.filter((s) => s === "uploaded" || s === "approved").length;
  const approved = statuses.filter((s) => s === "approved").length;
  return {
    required: docs.length,
    uploaded,
    approved,
    uploadedPct: pct(uploaded, docs.length),
    approvedPct: pct(approved, docs.length),
    complete: approved === docs.length,
  };
}

export function pct(part: number, whole: number) {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

export function fileName(student: Student, doc: DocKey, rejected = false) {
  return `${DOCS[doc].code}_${student.pennkey}${rejected ? "_REJECTED" : ""}.pdf`;
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2);
}

const dayFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

export function formatDay(date: Date) {
  return dayFormat.format(date);
}

export function daysAgoLabel(days: number) {
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

export function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}
