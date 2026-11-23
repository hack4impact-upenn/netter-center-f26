import { Search } from "lucide-react";
import type { Course, Student } from "../types";
import { progressOf, requiredDocs } from "../lib/clearance";
import { DocBadge } from "./DocBadge";
import { Card, EmptyState, IconTile, Meter } from "./ui";

export function StudentTable({
  students,
  courseById,
  showCourse = true,
}: {
  students: Student[];
  courseById: (id: string) => Course | undefined;
  showCourse?: boolean;
}) {
  if (students.length === 0) {
    return (
      <Card>
        <EmptyState
          art={
            <IconTile size="lg">
              <Search />
            </IconTile>
          }
          title="No students match"
          description="Try a different search or filter."
        />
      </Card>
    );
  }

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Student</th>
            {showCourse && <th>Course</th>}
            <th>Approved</th>
            <th>Documents</th>
          </tr>
        </thead>
        <tbody>
          {students.map((student) => {
            const course = courseById(student.courseId);
            const progress = progressOf(student, course);
            return (
              <tr key={student.id}>
                <td>
                  <div className="cell-primary">{student.name}</div>
                  <div className="cell-secondary">
                    {student.pennkey}
                    {student.intlNoSsn && " · Intl, no SSN"}
                  </div>
                </td>
                {showCourse && (
                  <td>
                    <div>{course?.name}</div>
                    <div className="cell-secondary">{course?.program}</div>
                  </td>
                )}
                <td>
                  <Meter
                    value={progress.approvedPct}
                    tone="green"
                    label={`${student.name}: ${progress.approved} of ${progress.required} approved`}
                  />
                </td>
                <td>
                  <div className="doc-chips">
                    {requiredDocs(student, course).map((doc) => (
                      <DocBadge key={doc} doc={doc} record={student.docs[doc]} />
                    ))}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
