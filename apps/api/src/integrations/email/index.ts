import { Resend } from "resend";
import type { EmailContent } from "./templates";

let client: Resend | null = null;

function getClient() {
  if (!client) {
    client = new Resend(process.env.RESEND_API_KEY);
  }
  return client;
}

function fromAddress() {
  // onboarding@resend.dev works for testing but only delivers to your own Resend account email.
  return process.env.EMAIL_FROM || "Netter Center <onboarding@resend.dev>";
}

export type OutgoingEmail = {
  to: string;
  content: EmailContent;
};

export async function sendEmail(to: string, content: EmailContent): Promise<void> {
  const { error } = await getClient().emails.send({
    from: fromAddress(),
    to,
    subject: content.subject,
    html: content.html,
    text: content.text,
  });
  if (error) throw new Error(`Email to ${to} failed: ${error.message}`);
}

// Sends one email per recipient (so nobody sees anyone else's address).
// Resend's batch endpoint takes up to 100 emails per call.
export async function sendBatch(emails: OutgoingEmail[]): Promise<void> {
  for (let i = 0; i < emails.length; i += 100) {
    const chunk = emails.slice(i, i + 100);
    const { error } = await getClient().batch.send(
      chunk.map((e) => ({
        from: fromAddress(),
        to: e.to,
        subject: e.content.subject,
        html: e.content.html,
        text: e.content.text,
      }))
    );
    if (error) throw new Error(`Batch email failed: ${error.message}`);
  }
}
