import type { ReactNode } from "react";
import { ExternalLink, RefreshCw, Send } from "lucide-react";
import type { BlastFrequency } from "../types";
import { useClearance } from "../state/clearance";
import { box, viewers } from "../data/sample";
import {
  CORE_DOCS,
  DOCS,
  EXTRA_DOCS,
  FREQUENCY_DAYS,
  addDays,
  formatDay,
} from "../lib/clearance";
import {
  Badge,
  Button,
  ButtonAnchor,
  Card,
  Field,
  Input,
  PageHeader,
  Segmented,
  Switch,
  useToast,
} from "../components/ui";

function Setting({
  title,
  description,
  children,
}: {
  title: string;
  description: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="setting">
      <div className="setting__label">
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      <div className="setting__body">{children}</div>
    </section>
  );
}

export default function Settings() {
  const { blast, setBlast, courses, courseById, toggleExtraDoc, students } =
    useClearance();
  const toast = useToast();

  return (
    <>
      <PageHeader
        title="Settings"
        description="Reminders, the Box connection, and who needs what."
      />

      <Setting
        title="Reminder emails"
        description="A blast to every student who still has documents missing or rejected."
      >
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span>Send automatically</span>
          <Switch
            label="Send reminder emails automatically"
            checked={blast.enabled}
            onChange={(enabled) => setBlast({ enabled })}
          />
        </div>
        <div className="field">
          <span className="field__label">How often</span>
          <Segmented<BlastFrequency>
            label="How often"
            value={blast.frequency}
            onChange={(frequency) => setBlast({ frequency })}
            options={[
              { value: "daily", label: "Daily" },
              { value: "weekly", label: "Weekly" },
              { value: "biweekly", label: "Every two weeks" },
            ]}
          />
        </div>
        <Field
          label="Replies go to"
          htmlFor="reply-to"
          hint="Sent from the Center's sender account, with replies routed to this address."
        >
          <Input
            id="reply-to"
            type="email"
            value={blast.replyTo}
            onChange={(event) => setBlast({ replyTo: event.target.value })}
          />
        </Field>
        <div
          className="callout"
          style={{ alignItems: "center", justifyContent: "space-between", marginTop: 0 }}
        >
          <span>
            Last sent {formatDay(blast.lastSent)} to {blast.lastSentTo} students
            {blast.enabled &&
              ` · next ${formatDay(addDays(blast.lastSent, FREQUENCY_DAYS[blast.frequency]))}`}
          </span>
          <Button
            size="sm"
            variant="secondary"
            icon={<Send />}
            onClick={() => toast("Preview only: sending needs the email API")}
          >
            Send now
          </Button>
        </div>
      </Setting>

      <Setting
        title="Box connection"
        description="One dedicated reader account lists folder and file names. It can't open or download documents."
      >
        <Card>
          <dl className="facts" style={{ margin: 0, border: 0, borderRadius: 16 }}>
            <div>
              <dt>Status</dt>
              <dd>
                <span className="status-line">
                  <span className="status-line__dot" aria-hidden />
                  Connected
                </span>
              </dd>
            </div>
            <div>
              <dt>Reader account</dt>
              <dd className="mono">{box.account}</dd>
            </div>
            <div>
              <dt>Folder</dt>
              <dd>{box.folder}</dd>
            </div>
            <div>
              <dt>Last checked</dt>
              <dd>{box.checkedMinutesAgo} minutes ago</dd>
            </div>
          </dl>
        </Card>
        <div className="row">
          <Button
            variant="secondary"
            icon={<RefreshCw />}
            onClick={() => toast("Box connection checked: all good")}
          >
            Check now
          </Button>
          <ButtonAnchor
            variant="ghost"
            icon={<ExternalLink />}
            href={box.url}
            target="_blank"
            rel="noreferrer"
          >
            Open folder in Box
          </ButtonAnchor>
        </div>
      </Setting>

      <Setting
        title="Required documents"
        description={
          <>
            Everyone needs {CORE_DOCS.map((d) => DOCS[d].short).join(", ")}. International
            students without an SSN file the {DOCS.affidavit.name} instead. Turn on what
            each course adds.
          </>
        }
      >
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Course</th>
                {EXTRA_DOCS.map((doc) => (
                  <th key={doc}>{DOCS[doc].name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {courses.map((course) => (
                <tr key={course.id}>
                  <td>
                    <div className="cell-primary">{course.name}</div>
                    <div className="cell-secondary">
                      {course.program} ·{" "}
                      {students.filter((s) => s.courseId === course.id).length} students
                    </div>
                  </td>
                  {EXTRA_DOCS.map((doc) => (
                    <td key={doc}>
                      <Switch
                        label={`${course.name} requires ${DOCS[doc].name}`}
                        checked={course.extraDocs.includes(doc)}
                        onChange={() => toggleExtraDoc(course.id, doc)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Setting>

      <Setting
        title="Team"
        description="Admins approve documents. TAs and program directors see upload status for their own courses only."
      >
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Courses</th>
              </tr>
            </thead>
            <tbody>
              {viewers.map((person) => (
                <tr key={person.id}>
                  <td>
                    <div className="cell-primary">{person.name}</div>
                    <div className="cell-secondary">{person.email}</div>
                  </td>
                  <td>
                    <Badge tone={person.role === "admin" ? "blue" : "neutral"}>
                      {person.role === "admin" ? "Admin" : "TA"}
                    </Badge>
                  </td>
                  <td className="muted">
                    {person.role === "admin"
                      ? "All"
                      : person.courseIds.map((id) => courseById(id)?.name).join(", ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Setting>
    </>
  );
}
