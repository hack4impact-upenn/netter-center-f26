import { useNavigate } from "react-router-dom";
import { Send } from "lucide-react";
import { useClearance } from "../state/clearance";
import { useHotkey } from "../hooks/useHotkey";
import { FREQUENCY_DAYS, addDays, formatDay, pct, progressOf } from "../lib/clearance";
import {
  Badge,
  Button,
  Meter,
  PageHeader,
  SectionTitle,
  StatTile,
  useToast,
} from "../components/ui";

const FREQUENCY_LABEL = { daily: "daily", weekly: "weekly", biweekly: "every two weeks" };

export default function Dashboard() {
  const { students, courses, courseById, queue, blast, remind } = useClearance();
  const navigate = useNavigate();
  const toast = useToast();
  useHotkey("q", () => navigate("/review"));

  const incomplete = students.filter(
    (s) => !progressOf(s, courseById(s.courseId)).complete
  );

  // Lowest approval first: the classes that need a nudge rise to the top.
  const rows = courses
    .map((course) => {
      const inCourse = students.filter((s) => s.courseId === course.id);
      const totals = inCourse.reduce(
        (sum, s) => {
          const p = progressOf(s, course);
          return {
            required: sum.required + p.required,
            uploaded: sum.uploaded + p.uploaded,
            approved: sum.approved + p.approved,
          };
        },
        { required: 0, uploaded: 0, approved: 0 }
      );
      return {
        course,
        students: inCourse.length,
        toReview: queue.filter((item) => item.student.courseId === course.id).length,
        uploadedPct: pct(totals.uploaded, totals.required),
        approvedPct: pct(totals.approved, totals.required),
      };
    })
    .sort((a, b) => a.approvedPct - b.approvedPct);

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Clearance progress across every program. Sample data."
      />

      <div className="stack">
        <div className="stats">
          <StatTile
            label="Documents to review"
            value={queue.length}
            detail={
              queue[0]
                ? `Oldest waiting ${queue[0].uploadedDaysAgo} days`
                : "Nothing waiting"
            }
            action={
              <Button size="sm" keys={["Q"]} onClick={() => navigate("/review")}>
                Open review queue
              </Button>
            }
          />
          <StatTile
            label="Students missing documents"
            value={
              <>
                {incomplete.length}
                <small>of {students.length}</small>
              </>
            }
            detail={`${students.length - incomplete.length} fully cleared`}
            action={
              <Button
                size="sm"
                variant="secondary"
                onClick={() => navigate("/students?show=incomplete")}
              >
                View list
              </Button>
            }
          />
          <StatTile
            label="Last reminder blast"
            aside={
              <Badge tone={blast.enabled ? "green" : "neutral"} dot>
                {blast.enabled ? "Automatic" : "Paused"}
              </Badge>
            }
            value={formatDay(blast.lastSent)}
            detail={`${blast.lastSentTo} non-compliant students · ${FREQUENCY_LABEL[blast.frequency]}${
              blast.enabled
                ? ` · next ${formatDay(addDays(blast.lastSent, FREQUENCY_DAYS[blast.frequency]))}`
                : ""
            }`}
            action={
              <Button size="sm" variant="secondary" onClick={() => navigate("/settings")}>
                Change schedule
              </Button>
            }
          />
        </div>

        <section>
          <SectionTitle
            title="Classes"
            description="Lowest share of approved documents first."
          />
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Class</th>
                  <th className="align-right">To review</th>
                  <th>Uploaded</th>
                  <th>Approved</th>
                  <th>Last reminder</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.course.id}>
                    <td>
                      <div className="cell-primary">{row.course.name}</div>
                      <div className="cell-secondary">
                        {row.course.program} · {row.students} students
                      </div>
                    </td>
                    <td className="align-right num">
                      {row.toReview > 0 ? (
                        row.toReview
                      ) : (
                        <span className="subtle">0</span>
                      )}
                    </td>
                    <td>
                      <Meter
                        value={row.uploadedPct}
                        label={`${row.course.name} uploaded`}
                      />
                    </td>
                    <td>
                      <Meter
                        value={row.approvedPct}
                        tone="green"
                        label={`${row.course.name} approved`}
                      />
                    </td>
                    <td className="muted num">{formatDay(row.course.lastReminder)}</td>
                    <td className="align-right">
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={<Send />}
                        onClick={() => {
                          const sent = remind([row.course.id]);
                          toast(
                            `Reminder sent to ${sent} students in ${row.course.name}`
                          );
                        }}
                      >
                        Email reminder
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}
