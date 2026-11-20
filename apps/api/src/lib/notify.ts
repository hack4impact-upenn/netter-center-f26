import { query, execute } from "../integrations/database";
import { sendEmail, sendBatch } from "../integrations/email";
import type { EmailContent } from "../integrations/email/templates";

export type Recipient = { email: string; name?: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmail(value: unknown): value is string {
  return typeof value === "string" && EMAIL_RE.test(value.trim());
}

// Accepts a list of {email, name} from the request. Returns null if any entry is invalid.
export function parseRecipients(value: unknown): Recipient[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const out: Recipient[] = [];
  const seen = new Set<string>();
  for (const r of value) {
    if (!r || typeof r !== "object" || !isEmail((r as Recipient).email)) return null;
    const email = (r as Recipient).email.trim();
    const name = (r as Recipient).name;
    if (seen.has(email.toLowerCase())) continue;
    seen.add(email.toLowerCase());
    out.push(
      typeof name === "string" && name.trim() ? { email, name: name.trim() } : { email }
    );
  }
  return out;
}

export async function allUsers(): Promise<Recipient[]> {
  const rows = await query<{ email: string; name: string | null }>(
    "SELECT email, name FROM users"
  );
  return rows.map((r) =>
    r.name ? { email: r.email, name: r.name } : { email: r.email }
  );
}

// Sends one personalised email per recipient and records the send in email_log.
// Throws if Resend rejects the send (after logging the failure).
export async function deliver(
  kind: string,
  recipients: Recipient[],
  build: (r: Recipient) => EmailContent,
  sentBy: string | null
): Promise<void> {
  const emails = recipients.map((r) => ({ to: r.email, content: build(r) }));
  const subject = emails[0]?.content.subject ?? "";
  let status = "sent";
  let error: string | null = null;

  try {
    if (emails.length === 1) {
      await sendEmail(emails[0]!.to, emails[0]!.content);
    } else if (emails.length > 1) {
      await sendBatch(emails);
    }
  } catch (err) {
    status = "failed";
    error = err instanceof Error ? err.message : String(err);
  }

  await execute(
    "INSERT INTO email_log (kind, subject, recipients, recipient_count, status, error, sent_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [
      kind,
      subject,
      recipients.map((r) => r.email).join(", "),
      recipients.length,
      status,
      error,
      sentBy,
    ]
  );

  if (error) throw new Error(error);
}
