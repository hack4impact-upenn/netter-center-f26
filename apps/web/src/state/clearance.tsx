import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type {
  BlastSettings,
  Course,
  DocKey,
  RejectReason,
  Student,
  Viewer,
} from "../types";
import * as sample from "../data/sample";
import { progressOf } from "../lib/clearance";

export interface QueueItem {
  key: string;
  student: Student;
  course: Course | undefined;
  doc: DocKey;
  uploadedDaysAgo: number;
}

interface ClearanceStore {
  viewer: Viewer;
  setViewerId: (id: string) => void;
  courses: Course[];
  courseById: (id: string) => Course | undefined;
  students: Student[];
  queue: QueueItem[];
  blast: BlastSettings;
  setBlast: (patch: Partial<BlastSettings>) => void;
  approve: (studentId: string, doc: DocKey) => void;
  reject: (studentId: string, doc: DocKey, reason: RejectReason, note: string) => void;
  /** Emails every incomplete student in these courses; returns how many. */
  remind: (courseIds: string[]) => number;
  toggleExtraDoc: (courseId: string, doc: DocKey) => void;
}

const ClearanceContext = createContext<ClearanceStore | null>(null);

/**
 * Holds the sample records in memory so a decision in the review queue shows
 * up on every other page. When the API lands, each action here becomes a
 * POST and the state a fetch.
 */
export function ClearanceProvider({ children }: { children: ReactNode }) {
  const [viewerId, setViewerId] = useState("admin");
  const [courses, setCourses] = useState(sample.courses);
  const [students, setStudents] = useState(sample.students);
  const [blast, setBlastState] = useState(sample.blast);

  const store = useMemo<ClearanceStore>(() => {
    const courseById = (id: string) => courses.find((c) => c.id === id);

    const queue = students
      .flatMap((student) =>
        Object.entries(student.docs)
          .filter(([, record]) => record?.status === "uploaded")
          .map(([doc, record]) => ({
            key: `${student.id}:${doc}`,
            student,
            course: courseById(student.courseId),
            doc: doc as DocKey,
            uploadedDaysAgo: record?.uploadedDaysAgo ?? 0,
          }))
      )
      .sort((a, b) => b.uploadedDaysAgo - a.uploadedDaysAgo);

    const updateDoc = (studentId: string, doc: DocKey, record: Student["docs"][DocKey]) =>
      setStudents((all) =>
        all.map((s) =>
          s.id === studentId ? { ...s, docs: { ...s.docs, [doc]: record } } : s
        )
      );

    return {
      viewer: sample.viewers.find((v) => v.id === viewerId) ?? sample.viewers[0]!,
      setViewerId,
      courses,
      courseById,
      students,
      queue,
      blast,
      setBlast: (patch) => setBlastState((b) => ({ ...b, ...patch })),
      approve: (studentId, doc) => updateDoc(studentId, doc, { status: "approved" }),
      reject: (studentId, doc, reason, note) =>
        updateDoc(studentId, doc, {
          status: "resubmit",
          reason,
          note: note || undefined,
        }),
      remind: (courseIds) => {
        const now = new Date();
        setCourses((all) =>
          all.map((c) => (courseIds.includes(c.id) ? { ...c, lastReminder: now } : c))
        );
        return students.filter(
          (s) =>
            courseIds.includes(s.courseId) &&
            !progressOf(s, courseById(s.courseId)).complete
        ).length;
      },
      toggleExtraDoc: (courseId, doc) =>
        setCourses((all) =>
          all.map((c) =>
            c.id === courseId
              ? {
                  ...c,
                  extraDocs: c.extraDocs.includes(doc)
                    ? c.extraDocs.filter((d) => d !== doc)
                    : [...c.extraDocs, doc],
                }
              : c
          )
        ),
    };
  }, [viewerId, courses, students, blast]);

  return <ClearanceContext.Provider value={store}>{children}</ClearanceContext.Provider>;
}

export function useClearance() {
  const store = useContext(ClearanceContext);
  if (!store) throw new Error("useClearance must be used inside ClearanceProvider");
  return store;
}
