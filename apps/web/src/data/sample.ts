/**
 * Sample data for laying out the screens. Every number on a page is worked
 * out from these records, so the dashboard, queue and class views agree.
 * Swap this file for API calls once the roster and Box routes exist.
 */
import type {
  BlastSettings,
  Course,
  DocKey,
  DocRecord,
  RejectReason,
  Student,
  Viewer,
} from "../types";
import { addDays } from "../lib/clearance";

const today = new Date();
const daysAgo = (days: number) => addDays(today, -days);

export const courses: Course[] = [
  {
    id: "a",
    name: "Course A",
    program: "Program 1",
    extraDocs: ["mandated"],
    lastReminder: daysAgo(3),
  },
  {
    id: "b",
    name: "Course B",
    program: "Program 1",
    extraDocs: ["mandated", "conduct"],
    lastReminder: daysAgo(10),
  },
  {
    id: "c",
    name: "Course C",
    program: "Program 2",
    extraDocs: [],
    lastReminder: daysAgo(3),
  },
];

const A: DocRecord = { status: "approved" };
const up = (uploadedDaysAgo: number): DocRecord => ({
  status: "uploaded",
  uploadedDaysAgo,
});
const redo = (reason: RejectReason): DocRecord => ({ status: "resubmit", reason });

let nextId = 1;
function student(
  name: string,
  courseId: string,
  docs: Partial<Record<DocKey, DocRecord>>,
  intlNoSsn?: boolean
): Student {
  const [first = "", ...rest] = name.split(" ");
  const pennkey = (first[0] + rest.join("")).toLowerCase().replace(/[^a-z]/g, "");
  return {
    id: String(nextId++),
    name,
    pennkey,
    email: `${pennkey}@upenn.edu`,
    courseId,
    intlNoSsn,
    docs,
  };
}

export const students: Student[] = [
  student("Alex Kim", "a", { pca: A, patch: up(3) }),
  student("Jordan Lee", "a", { pca: up(2) }),
  student("Priya Raman", "a", { pca: A, patch: A, fbi: A, mandated: A }),
  student("Ethan Brooks", "a", { pca: A, patch: A, fbi: up(1), mandated: A }),
  student("Sofia Alvarez", "a", { pca: redo("expired"), patch: A }),
  student("Noah Williams", "a", {}),
  student("Hana Sato", "a", { affidavit: A, mandated: up(0) }, true),
  student("Liam O'Connor", "a", { pca: A, patch: A, fbi: A, mandated: A }),

  student("Sam Patel", "b", { pca: A, patch: redo("wrong"), fbi: up(3) }),
  student("Chris Diaz", "b", { pca: A, patch: up(0) }),
  student("Ava Thompson", "b", { pca: A, patch: A, fbi: A, mandated: A, conduct: A }),
  student("Marcus Johnson", "b", { pca: A, patch: A, conduct: up(4) }),
  student("Grace Liu", "b", { pca: up(5), patch: up(5), fbi: up(5) }),
  student("Daniel Okafor", "b", {}),
  student("Isabella Rossi", "b", { pca: A, patch: A, fbi: A, mandated: A }),

  student("Maya Chen", "c", { pca: A, patch: A, fbi: up(1) }),
  student("Wei Zhang", "c", { affidavit: up(2) }, true),
  student("Olivia Martin", "c", { pca: A, patch: A, fbi: A }),
  student("Ben Carter", "c", { pca: A, patch: A, fbi: A }),
  student("Zoe Nguyen", "c", { pca: A, patch: A, fbi: redo("expired") }),
];

export const viewers: Viewer[] = [
  {
    id: "admin",
    name: "Main Admin",
    email: "admin@example.org",
    role: "admin",
    courseIds: [],
  },
  {
    id: "ta-a",
    name: "Course A TA",
    email: "ta.a@example.org",
    role: "ta",
    courseIds: ["a"],
  },
  {
    id: "ta-b",
    name: "Course B TA",
    email: "ta.b@example.org",
    role: "ta",
    courseIds: ["b"],
  },
  {
    id: "director-1",
    name: "Program 1 Director",
    email: "director@example.org",
    role: "ta",
    courseIds: ["a", "b"],
  },
];

export const blast: BlastSettings = {
  enabled: true,
  frequency: "weekly",
  replyTo: "compliance@example.org",
  lastSent: daysAgo(3),
  lastSentTo: 16,
};

export const box = {
  account: "netter-clearances-reader",
  folder: "Clearances / Fall 2026",
  url: "https://upenn.app.box.com/",
  checkedMinutesAgo: 4,
};

export const term = "Fall 2026";

export const imports = [
  {
    id: "2",
    at: daysAgo(5),
    file: "fall-2026-roster-v2.csv",
    rows: 20,
    added: 2,
    updated: 3,
  },
  {
    id: "1",
    at: daysAgo(12),
    file: "fall-2026-roster.csv",
    rows: 18,
    added: 18,
    updated: 0,
  },
];
