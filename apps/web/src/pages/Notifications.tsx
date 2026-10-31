import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ApiError, del, get, post } from "../services/api";

type Reminder = {
  id: string;
  title: string;
  item: string | null;
  deadline: string | null;
  send_at: string;
  send_to_all: number;
  recipients: string | null;
  status: string;
  error: string | null;
};

type LogEntry = {
  id: string;
  kind: string;
  subject: string;
  recipients: string;
  recipient_count: number;
  status: string;
  error: string | null;
  created_at: string;
};

type Status = { kind: "ok" | "error"; text: string } | null;

const QUICK_REASONS = [
  "A required document is missing.",
  "The form is missing a signature.",
  "The file is unreadable or blank. Please upload a clearer copy.",
  "The file is named incorrectly.",
];

const DEFAULT_FORMAT = "{lastname}_{firstname}_{document}.pdf";

// Turns "a@x.com, b@y.com\nc@z.com" into [{ email }].
function parseEmails(text: string) {
  return text
    .split(/[\s,;]+/)
    .map((e) => e.trim())
    .filter(Boolean)
    .map((email) => ({ email }));
}

// Runs an API call and returns a status message for the section.
function useAction(onDone?: () => void) {
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<string>) {
    setBusy(true);
    setStatus(null);
    try {
      setStatus({ kind: "ok", text: await fn() });
      onDone?.();
    } catch (err) {
      setStatus({
        kind: "error",
        text: err instanceof Error ? err.message : "Something went wrong",
      });
    } finally {
      setBusy(false);
    }
  }

  return { status, busy, run };
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="card">
      <h2>{title}</h2>
      {hint && <p className="hint">{hint}</p>}
      {children}
    </section>
  );
}

function StatusLine({ status }: { status: Status }) {
  if (!status) return null;
  return <p className={`status ${status.kind}`}>{status.text}</p>;
}

function countRecipients(json: string | null): number {
  try {
    const list = JSON.parse(json || "[]");
    return Array.isArray(list) ? list.length : 0;
  } catch {
    return 0;
  }
}

// D1 stores CURRENT_TIMESTAMP as "YYYY-MM-DD HH:MM:SS" in UTC.
function fromDbTime(value: string): Date {
  return new Date(value.includes("T") ? value : value.replace(" ", "T") + "Z");
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function Review({ onSent }: { onSent: () => void }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [item, setItem] = useState("");
  const [reason, setReason] = useState("");
  const { status, busy, run } = useAction(onSent);

  const person = { email, name: name || undefined, item: item || undefined };

  return (
    <Section
      title="Approve or reject a submission"
      hint="The person gets an email either way. Rejections include your reason."
    >
      <div className="grid">
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="student@example.com"
          />
        </label>
        <label>
          Name (optional)
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          What it is (optional)
          <input
            value={item}
            onChange={(e) => setItem(e.target.value)}
            placeholder="consent form"
          />
        </label>
      </div>
      <label>
        Reason (needed to reject)
        <textarea
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. You forgot to attach your W-9."
        />
      </label>
      <div className="chips">
        {QUICK_REASONS.map((r) => (
          <button key={r} type="button" className="chip" onClick={() => setReason(r)}>
            {r}
          </button>
        ))}
      </div>
      <div className="actions">
        <button
          className="approve"
          disabled={busy || !email}
          onClick={() =>
            run(async () => {
              await post("/api/notifications/approve", person);
              return `Approval sent to ${email}.`;
            })
          }
        >
          Approve & email
        </button>
        <button
          className="reject"
          disabled={busy || !email || !reason.trim()}
          onClick={() =>
            run(async () => {
              await post("/api/notifications/reject", { ...person, reason });
              setReason("");
              return `Rejection sent to ${email}.`;
            })
          }
        >
          Reject & email
        </button>
      </div>
      <StatusLine status={status} />
    </Section>
  );
}

function FileNameCheck({ onSent }: { onSent: () => void }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [fileName, setFileName] = useState("");
  const [format, setFormat] = useState(DEFAULT_FORMAT);
  const { status, busy, run } = useAction(onSent);

  return (
    <Section
      title="Check a file name"
      hint="If the name doesn't match the format, the person is emailed how to rename it. Each {placeholder} matches letters, numbers, and hyphens."
    >
      <div className="grid">
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Name (optional)
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Their file name
          <input
            value={fileName}
            onChange={(e) => setFileName(e.target.value)}
            placeholder="scan001.pdf"
          />
        </label>
        <label>
          Required format
          <input value={format} onChange={(e) => setFormat(e.target.value)} />
        </label>
      </div>
      <div className="actions">
        <button
          disabled={busy || !email || !fileName}
          onClick={() =>
            run(async () => {
              const res = await post<{ valid: boolean }>(
                "/api/notifications/check-file-name",
                {
                  email,
                  name: name || undefined,
                  fileName,
                  expectedFormat: format,
                }
              );
              return res.valid
                ? "That file name is correct. No email sent."
                : `Wrong file name. Email sent to ${email}.`;
            })
          }
        >
          Check & email if wrong
        </button>
      </div>
      <StatusLine status={status} />
    </Section>
  );
}

function RemindEveryone({ onSent }: { onSent: () => void }) {
  const [item, setItem] = useState("");
  const [deadline, setDeadline] = useState("");
  const [message, setMessage] = useState("");
  const { status, busy, run } = useAction(onSent);

  return (
    <Section
      title="Remind everyone now"
      hint="Sends a reminder to every user in the system."
    >
      <div className="grid">
        <label>
          What's due (optional)
          <input
            value={item}
            onChange={(e) => setItem(e.target.value)}
            placeholder="timesheets"
          />
        </label>
        <label>
          Deadline (optional)
          <input
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            placeholder="Friday, Nov 7"
          />
        </label>
      </div>
      <label>
        Message (optional)
        <textarea rows={2} value={message} onChange={(e) => setMessage(e.target.value)} />
      </label>
      <div className="actions">
        <button
          disabled={busy}
          onClick={() => {
            if (!confirm("Send a reminder to everyone?")) return;
            run(async () => {
              const res = await post<{ sent: number }>("/api/notifications/remind", {
                all: true,
                item: item || undefined,
                deadline: deadline || undefined,
                message: message || undefined,
              });
              return `Reminder sent to ${plural(res.sent, "person")}.`;
            });
          }}
        >
          Remind everyone
        </button>
      </div>
      <StatusLine status={status} />
    </Section>
  );
}

function RecipientPicker({
  everyone,
  setEveryone,
  list,
  setList,
}: {
  everyone: boolean;
  setEveryone: (v: boolean) => void;
  list: string;
  setList: (v: string) => void;
}) {
  return (
    <>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={everyone}
          onChange={(e) => setEveryone(e.target.checked)}
        />
        Send to everyone
      </label>
      {!everyone && (
        <label>
          Recipients (separate emails with commas or new lines)
          <textarea rows={2} value={list} onChange={(e) => setList(e.target.value)} />
        </label>
      )}
    </>
  );
}

function CustomEmail({ onSent }: { onSent: () => void }) {
  const [everyone, setEveryone] = useState(false);
  const [list, setList] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const { status, busy, run } = useAction(onSent);

  return (
    <Section title="Write your own email">
      <RecipientPicker
        everyone={everyone}
        setEveryone={setEveryone}
        list={list}
        setList={setList}
      />
      <label>
        Subject
        <input value={subject} onChange={(e) => setSubject(e.target.value)} />
      </label>
      <label>
        Message
        <textarea rows={5} value={message} onChange={(e) => setMessage(e.target.value)} />
      </label>
      <div className="actions">
        <button
          disabled={
            busy || !subject.trim() || !message.trim() || (!everyone && !list.trim())
          }
          onClick={() => {
            if (everyone && !confirm("Send this email to everyone?")) return;
            run(async () => {
              const res = await post<{ sent: number }>("/api/notifications/custom", {
                ...(everyone ? { all: true } : { recipients: parseEmails(list) }),
                subject,
                message,
              });
              setSubject("");
              setMessage("");
              return `Email sent to ${plural(res.sent, "person")}.`;
            });
          }}
        >
          Send email
        </button>
      </div>
      <StatusLine status={status} />
    </Section>
  );
}

function ScheduledReminders({
  reminders,
  reload,
}: {
  reminders: Reminder[];
  reload: () => void;
}) {
  const [title, setTitle] = useState("");
  const [item, setItem] = useState("");
  const [deadline, setDeadline] = useState("");
  const [message, setMessage] = useState("");
  const [sendAt, setSendAt] = useState("");
  const [everyone, setEveryone] = useState(true);
  const [list, setList] = useState("");
  const { status, busy, run } = useAction(reload);

  return (
    <Section
      title="Schedule a reminder"
      hint="Set a time and the reminder goes out on its own."
    >
      <div className="grid">
        <label>
          Name for this reminder
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Week 3 timesheets"
          />
        </label>
        <label>
          Send at
          <input
            type="datetime-local"
            value={sendAt}
            onChange={(e) => setSendAt(e.target.value)}
          />
        </label>
        <label>
          What's due (optional)
          <input value={item} onChange={(e) => setItem(e.target.value)} />
        </label>
        <label>
          Deadline shown in email (optional)
          <input value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </label>
      </div>
      <label>
        Message (optional)
        <textarea rows={2} value={message} onChange={(e) => setMessage(e.target.value)} />
      </label>
      <RecipientPicker
        everyone={everyone}
        setEveryone={setEveryone}
        list={list}
        setList={setList}
      />
      <div className="actions">
        <button
          disabled={busy || !title.trim() || !sendAt || (!everyone && !list.trim())}
          onClick={() =>
            run(async () => {
              const when = new Date(sendAt);
              await post("/api/notifications/reminders", {
                title,
                item: item || undefined,
                deadline: deadline || undefined,
                message: message || undefined,
                sendAt: when.toISOString(),
                ...(everyone ? { all: true } : { recipients: parseEmails(list) }),
              });
              setTitle("");
              return `Scheduled for ${when.toLocaleString()}.`;
            })
          }
        >
          Schedule reminder
        </button>
      </div>
      <StatusLine status={status} />

      {reminders.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Reminder</th>
              <th>Sends</th>
              <th>To</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {reminders.map((r) => (
              <tr key={r.id}>
                <td>{r.title}</td>
                <td>{new Date(r.send_at).toLocaleString()}</td>
                <td>
                  {r.send_to_all
                    ? "Everyone"
                    : plural(countRecipients(r.recipients), "person")}
                </td>
                <td title={r.error ?? undefined}>{r.status}</td>
                <td>
                  {r.status === "pending" && (
                    <button
                      className="link"
                      onClick={async () => {
                        await del(`/api/notifications/reminders/${r.id}`);
                        reload();
                      }}
                    >
                      Cancel
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}

function EmailLog({ log }: { log: LogEntry[] }) {
  return (
    <Section title="Recently sent">
      {log.length === 0 ? (
        <p className="hint">Nothing sent yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Type</th>
              <th>Subject</th>
              <th>To</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {log.map((e) => (
              <tr key={e.id}>
                <td>{fromDbTime(e.created_at).toLocaleString()}</td>
                <td>{e.kind.replace(/_/g, " ")}</td>
                <td>{e.subject}</td>
                <td title={e.recipients}>
                  {e.recipient_count === 1
                    ? e.recipients
                    : plural(e.recipient_count, "person")}
                </td>
                <td
                  className={e.status === "failed" ? "error" : undefined}
                  title={e.error ?? undefined}
                >
                  {e.status}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}

export default function Notifications() {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [accessError, setAccessError] = useState<string | null>(null);

  const reload = useCallback(() => {
    Promise.all([
      get<{ reminders: Reminder[] }>("/api/notifications/reminders"),
      get<{ log: LogEntry[] }>("/api/notifications/log"),
    ])
      .then(([r, l]) => {
        setReminders(r.reminders);
        setLog(l.log);
        setAccessError(null);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401)
          setAccessError("Please log in first.");
        else if (err instanceof ApiError && err.status === 403)
          setAccessError("Your account isn't on the staff list (ADMIN_EMAILS).");
        else
          setAccessError(
            err instanceof Error ? err.message : "Couldn't load the dashboard."
          );
      });
  }, []);

  useEffect(reload, [reload]);

  if (accessError) {
    return (
      <main className="page narrow">
        <h1>Email notifications</h1>
        <p className="status error">{accessError}</p>
        <Link to="/login">Go to login</Link>
      </main>
    );
  }

  return (
    <main className="page">
      <h1>Email notifications</h1>
      <Review onSent={reload} />
      <FileNameCheck onSent={reload} />
      <RemindEveryone onSent={reload} />
      <CustomEmail onSent={reload} />
      <ScheduledReminders reminders={reminders} reload={reload} />
      <EmailLog log={log} />
    </main>
  );
}
