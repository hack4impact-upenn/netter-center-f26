import { useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { Search, Send } from "lucide-react";
import { useClearance } from "../state/clearance";
import { formatDay, pct, progressOf } from "../lib/clearance";
import { StatusLegend } from "../components/DocBadge";
import { StudentTable } from "../components/StudentTable";
import {
  Button,
  Input,
  PageHeader,
  Segmented,
  StatTile,
  useToast,
} from "../components/ui";

/** A TA's or program director's view: status for their own courses, never the documents. */
export default function MyClass() {
  const { viewer, students, courseById, remind } = useClearance();
  const { courseId = viewer.courseIds[0] } = useParams();
  const toast = useToast();
  const [show, setShow] = useState<"incomplete" | "all">("incomplete");
  const [query, setQuery] = useState("");

  const course = courseId ? courseById(courseId) : undefined;
  if (!course || !viewer.courseIds.includes(course.id))
    return <Navigate to="/class" replace />;

  const inCourse = students.filter((s) => s.courseId === course.id);
  const progress = inCourse.map((s) => progressOf(s, course));
  const required = progress.reduce((sum, p) => sum + p.required, 0);
  const incomplete = inCourse.filter((_, i) => !progress[i]!.complete);
  const q = query.trim().toLowerCase();
  const shown = (show === "incomplete" ? incomplete : inCourse).filter(
    (s) => !q || s.name.toLowerCase().includes(q)
  );

  return (
    <>
      <PageHeader
        title={course.name}
        description={`${course.program}. Upload status only: TAs can't see documents. Sample data.`}
        actions={
          <>
            <span className="subtle">Last reminder {formatDay(course.lastReminder)}</span>
            <Button
              icon={<Send />}
              disabled={incomplete.length === 0}
              onClick={() => {
                const sent = remind([course.id]);
                toast(`Reminder sent to ${sent} students in ${course.name}`);
              }}
            >
              Send reminder
            </Button>
          </>
        }
      />

      <div className="stack">
        <div className="stats">
          <StatTile
            label="Students"
            value={inCourse.length}
            detail={`${inCourse.length - incomplete.length} fully cleared`}
          />
          <StatTile
            label="Documents uploaded"
            value={`${pct(
              progress.reduce((sum, p) => sum + p.uploaded, 0),
              required
            )}%`}
            detail={`of ${required} required across the class`}
          />
          <StatTile
            label="Documents approved"
            value={`${pct(
              progress.reduce((sum, p) => sum + p.approved, 0),
              required
            )}%`}
            detail="Checked by a Netter Center admin"
          />
        </div>

        <section>
          <div className="toolbar">
            <Input
              className="control--search"
              leading={<Search />}
              placeholder="Search students"
              aria-label="Search students"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <Segmented
              label="Show"
              value={show}
              onChange={setShow}
              options={[
                { value: "incomplete", label: "Incomplete", count: incomplete.length },
                { value: "all", label: "All", count: inCourse.length },
              ]}
            />
          </div>
          <StudentTable students={shown} courseById={courseById} showCourse={false} />
          <div className="table-footer">
            <StatusLegend />
          </div>
        </section>
      </div>
    </>
  );
}
