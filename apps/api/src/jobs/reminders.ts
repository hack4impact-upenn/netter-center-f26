import { query, execute } from "../integrations/database";
import { reminderEmail } from "../integrations/email/templates";
import { deliver, allUsers, parseRecipients } from "../lib/notify";

type ReminderRow = {
  id: string;
  title: string;
  message: string | null;
  item: string | null;
  deadline: string | null;
  send_to_all: number;
  recipients: string | null;
  created_by: string | null;
};

// Sends every pending reminder whose time has come. Returns how many were processed.
export async function processDueReminders(now: Date = new Date()): Promise<number> {
  const due = await query<ReminderRow>(
    "SELECT id, title, message, item, deadline, send_to_all, recipients, created_by FROM reminders WHERE status = 'pending' AND send_at <= ? ORDER BY send_at",
    [now.toISOString()]
  );

  for (const r of due) {
    // Mark first so a slow send can't be picked up twice by the next tick.
    await execute(
      "UPDATE reminders SET status = 'sending' WHERE id = ? AND status = 'pending'",
      [r.id]
    );

    try {
      let recipients = r.send_to_all ? await allUsers() : null;
      if (!recipients) {
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(r.recipients ?? "null");
        } catch {
          parsed = null;
        }
        recipients = parseRecipients(parsed) ?? [];
      }

      if (recipients.length > 0) {
        await deliver(
          "scheduled_reminder",
          recipients,
          (rec) =>
            reminderEmail({
              name: rec.name,
              item: r.item ?? undefined,
              message: r.message ?? undefined,
              deadline: r.deadline ?? undefined,
            }),
          r.created_by
        );
      }

      await execute("UPDATE reminders SET status = 'sent', sent_at = ? WHERE id = ?", [
        new Date().toISOString(),
        r.id,
      ]);
    } catch (err) {
      await execute("UPDATE reminders SET status = 'failed', error = ? WHERE id = ?", [
        err instanceof Error ? err.message : String(err),
        r.id,
      ]);
    }
  }

  return due.length;
}

export function startReminderScheduler(intervalMs: number = 60_000): void {
  const tick = () =>
    processDueReminders().catch((err) =>
      console.error("Reminder scheduler error:", err instanceof Error ? err.message : err)
    );
  setInterval(tick, intervalMs);
  console.log("✓ Reminder scheduler running (checks every minute)");
}
