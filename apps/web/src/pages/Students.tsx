import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Search, Send } from "lucide-react";
import { useClearance } from "../state/clearance";
import { progressOf } from "../lib/clearance";
import { StatusLegend } from "../components/DocBadge";
import { StudentTable } from "../components/StudentTable";
import { Button, Input, PageHeader, Segmented, Select, useToast } from "../components/ui";

type Show = "all" | "incomplete" | "cleared";

export default function Students() {
  const { students, courses, courseById, remind } = useClearance();
  const toast = useToast();
  const [params] = useSearchParams();
  const [show, setShow] = useState<Show>(
    params.get("show") === "incomplete" ? "incomplete" : "all"
  );
  const [query, setQuery] = useState("");
  const [program, setProgram] = useState("");
  const [courseId, setCourseId] = useState("");

  const programs = [...new Set(courses.map((c) => c.program))];
  const coursesShown = courses.filter((c) => !program || c.program === program);

  const scoped = students.filter((s) => {
    const course = courseById(s.courseId);
    if (program && course?.program !== program) return false;
    if (courseId && s.courseId !== courseId) return false;
    const q = query.trim().toLowerCase();
    return !q || s.name.toLowerCase().includes(q) || s.pennkey.includes(q);
  });
  const isComplete = (s: (typeof students)[number]) =>
    progressOf(s, courseById(s.courseId)).complete;
  const incomplete = scoped.filter((s) => !isComplete(s));
  const shown =
    show === "incomplete"
      ? incomplete
      : show === "cleared"
        ? scoped.filter(isComplete)
        : scoped;

  return (
    <>
      <PageHeader
        title="Students"
        description="Every volunteer on the roster and where each of their documents stands. Sample data."
        actions={
          <Button
            variant="secondary"
            icon={<Send />}
            disabled={incomplete.length === 0}
            onClick={() => {
              const sent = remind(courseId ? [courseId] : coursesShown.map((c) => c.id));
              toast(`Reminder sent to ${sent} students`);
            }}
          >
            Remind {incomplete.length} incomplete
          </Button>
        }
      />

      <div className="toolbar">
        <div className="toolbar__filters">
          <Input
            className="control--search"
            leading={<Search />}
            placeholder="Search name or PennKey"
            aria-label="Search students"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Select
            aria-label="Program"
            value={program}
            onChange={(event) => {
              setProgram(event.target.value);
              setCourseId("");
            }}
          >
            <option value="">All programs</option>
            {programs.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </Select>
          <Select
            aria-label="Course"
            value={courseId}
            onChange={(event) => setCourseId(event.target.value)}
          >
            <option value="">All courses</option>
            {coursesShown.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <Segmented
          label="Show"
          value={show}
          onChange={setShow}
          options={[
            { value: "all", label: "All", count: scoped.length },
            { value: "incomplete", label: "Incomplete", count: incomplete.length },
            {
              value: "cleared",
              label: "Cleared",
              count: scoped.length - incomplete.length,
            },
          ]}
        />
      </div>

      <StudentTable students={shown} courseById={courseById} />
      <div className="table-footer">
        <StatusLegend />
      </div>
    </>
  );
}
