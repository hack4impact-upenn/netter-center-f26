import { Hono } from "hono";
import type { Context } from "hono";
import { query, execute } from "../integrations/database";
import {
  approvalEmail,
  rejectionEmail,
  fileNameEmail,
  reminderEmail,
  customEmail,
} from "../integrations/email/templates";
import { isValidFileName } from "../integrations/email/fileName";
import { requireAuth } from "../middleware/auth";
import { requireAdmin } from "../middleware/admin";
import {
  deliver,
  isEmail,
  parseRecipients,
  allUsers,
  type Recipient,
} from "../lib/notify";
import type { AppEnv } from "../types";

type Body = Record<string, unknown>;

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function readBody(c: Context<AppEnv>): Promise<Body> {
  try {
    const body = await c.req.json();
    return body && typeof body === "object" ? (body as Body) : {};
  } catch {
    return {};
  }
}

// Bulk sends take either { all: true } or { recipients: [{ email, name? }] }.
async function resolveRecipients(body: Body): Promise<Recipient[] | null> {
  if (body.all === true) return allUsers();
  return parseRecipients(body.recipients);
}

function sendFailed(c: Context<AppEnv>, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return c.json({ error: `Email failed to send: ${message}` }, 502);
}

const notifications = new Hono<AppEnv>();

notifications.use("*", requireAuth, requireAdmin);

// Approve a submission → approval email
notifications.post("/approve", async (c) => {
  const body = await readBody(c);
  if (!isEmail(body.email)) return c.json({ error: "A valid email is required" }, 400);

  const name = str(body.name);
  const item = str(body.item);
  try {
    await deliver(
      "approval",
      [{ email: body.email.trim(), name }],
      () => approvalEmail({ name, item }),
      c.get("userId")
    );
  } catch (err) {
    return sendFailed(c, err);
  }
  return c.json({ sent: 1 });
});

// Reject a submission with a reason → rejection email
notifications.post("/reject", async (c) => {
  const body = await readBody(c);
  if (!isEmail(body.email)) return c.json({ error: "A valid email is required" }, 400);
  const reason = str(body.reason);
  if (!reason) return c.json({ error: "A reason is required when rejecting" }, 400);

  const name = str(body.name);
  const item = str(body.item);
  try {
    await deliver(
      "rejection",
      [{ email: body.email.trim(), name }],
      () => rejectionEmail({ name, item, reason }),
      c.get("userId")
    );
  } catch (err) {
    return sendFailed(c, err);
  }
  return c.json({ sent: 1 });
});

// Check a file name against the naming format. If it's wrong, email the person.
// Format comes from the request, or FILE_NAME_FORMAT in .env.
notifications.post("/check-file-name", async (c) => {
  const body = await readBody(c);
  if (!isEmail(body.email)) return c.json({ error: "A valid email is required" }, 400);
  const fileName = str(body.fileName);
  if (!fileName) return c.json({ error: "fileName is required" }, 400);
  const format = str(body.expectedFormat) || str(process.env.FILE_NAME_FORMAT);
  if (!format) {
    return c.json({ error: "expectedFormat is required (or set FILE_NAME_FORMAT)" }, 400);
  }

  if (isValidFileName(fileName, format)) {
    return c.json({ valid: true, emailed: false });
  }

  const name = str(body.name);
  try {
    await deliver(
      "file_name",
      [{ email: body.email.trim(), name }],
      () => fileNameEmail({ name, fileName, expectedFormat: format }),
      c.get("userId")
    );
  } catch (err) {
    return sendFailed(c, err);
  }
  return c.json({ valid: false, emailed: true });
});

// "Remind everyone" button, or remind a chosen list
notifications.post("/remind", async (c) => {
  const body = await readBody(c);
  const recipients = await resolveRecipients(body);
  if (!recipients) return c.json({ error: "Provide recipients or set all: true" }, 400);
  if (recipients.length === 0) return c.json({ sent: 0 });

  const message = str(body.message);
  const item = str(body.item);
  const deadline = str(body.deadline);
  try {
    await deliver(
      "reminder",
      recipients,
      (r) => reminderEmail({ name: r.name, message, item, deadline }),
      c.get("userId")
    );
  } catch (err) {
    return sendFailed(c, err);
  }
  return c.json({ sent: recipients.length });
});

// Write-your-own email
notifications.post("/custom", async (c) => {
  const body = await readBody(c);
  const subject = str(body.subject);
  const message = str(body.message);
  if (!subject || !message)
    return c.json({ error: "Subject and message are required" }, 400);
  const recipients = await resolveRecipients(body);
  if (!recipients) return c.json({ error: "Provide recipients or set all: true" }, 400);
  if (recipients.length === 0) return c.json({ sent: 0 });

  try {
    await deliver(
      "custom",
      recipients,
      (r) => customEmail({ name: r.name, subject, message }),
      c.get("userId")
    );
  } catch (err) {
    return sendFailed(c, err);
  }
  return c.json({ sent: recipients.length });
});

// Scheduled reminders
notifications.get("/reminders", async (c) => {
  const reminders = await query(
    "SELECT id, title, message, item, deadline, send_at, send_to_all, recipients, status, error, created_at, sent_at FROM reminders ORDER BY send_at DESC LIMIT 100"
  );
  return c.json({ reminders });
});

notifications.post("/reminders", async (c) => {
  const body = await readBody(c);
  const title = str(body.title);
  if (!title) return c.json({ error: "title is required" }, 400);

  const sendAtRaw = str(body.sendAt);
  const sendAt = sendAtRaw ? new Date(sendAtRaw) : null;
  if (!sendAt || Number.isNaN(sendAt.getTime())) {
    return c.json({ error: "sendAt must be a valid date/time" }, 400);
  }
  if (sendAt.getTime() < Date.now() - 60_000) {
    return c.json({ error: "sendAt must be in the future" }, 400);
  }

  const sendToAll = body.all === true;
  const recipients = sendToAll ? null : parseRecipients(body.recipients);
  if (!sendToAll && !recipients) {
    return c.json({ error: "Provide recipients or set all: true" }, 400);
  }

  await execute(
    "INSERT INTO reminders (title, message, item, deadline, send_at, send_to_all, recipients, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [
      title,
      str(body.message) ?? null,
      str(body.item) ?? null,
      str(body.deadline) ?? null,
      sendAt.toISOString(),
      sendToAll ? 1 : 0,
      recipients ? JSON.stringify(recipients) : null,
      c.get("userId"),
    ]
  );
  return c.json({ scheduled: true, sendAt: sendAt.toISOString() }, 201);
});

notifications.delete("/reminders/:id", async (c) => {
  await execute(
    "UPDATE reminders SET status = 'cancelled' WHERE id = ? AND status = 'pending'",
    [c.req.param("id")]
  );
  return c.json({ cancelled: true });
});

// Recent sends, for the dashboard
notifications.get("/log", async (c) => {
  const log = await query(
    "SELECT id, kind, subject, recipients, recipient_count, status, error, created_at FROM email_log ORDER BY created_at DESC LIMIT 100"
  );
  return c.json({ log });
});

export default notifications;
