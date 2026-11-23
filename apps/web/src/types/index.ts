export type { ApiResponse } from "shared";

export type Role = "admin" | "ta";

/** Who is looking. A TA sees only the courses listed here. */
export interface Viewer {
  id: string;
  name: string;
  email: string;
  role: Role;
  courseIds: string[];
}

export type DocKey = "pca" | "patch" | "fbi" | "mandated" | "conduct" | "affidavit";

export type DocStatus = "missing" | "uploaded" | "approved" | "resubmit";

export type RejectReason = "wrong" | "expired" | "other";

export interface DocRecord {
  status: DocStatus;
  /** Days before today the file landed in Box, for uploaded documents. */
  uploadedDaysAgo?: number;
  reason?: RejectReason;
  note?: string;
}

export interface Course {
  id: string;
  name: string;
  program: string;
  /** Documents this course needs on top of PCA, PATCH and FBI. */
  extraDocs: DocKey[];
  lastReminder: Date;
}

export interface Student {
  id: string;
  name: string;
  pennkey: string;
  email: string;
  courseId: string;
  /** International students without an SSN file the affidavit instead of PCA, PATCH and FBI. */
  intlNoSsn?: boolean;
  docs: Partial<Record<DocKey, DocRecord>>;
}

export type BlastFrequency = "daily" | "weekly" | "biweekly";

export interface BlastSettings {
  enabled: boolean;
  frequency: BlastFrequency;
  replyTo: string;
  lastSent: Date;
  lastSentTo: number;
}
