// Pure email builders. Kept separate from index.ts so tests can import them
// without hitting the mocked Resend module (see AGENTS.md "mock isolation").

export type EmailContent = {
  subject: string;
  html: string;
  text: string;
};

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Escapes user text and keeps their line breaks.
function paragraph(value: string): string {
  return escapeHtml(value).replace(/\r?\n/g, "<br>");
}

function greeting(name?: string): string {
  return name ? `Hi ${name},` : "Hi,";
}

function layout(heading: string, body: string): string {
  return `
    <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto; padding: 20px; color: #222;">
      <h2 style="margin-bottom: 16px;">${escapeHtml(heading)}</h2>
      ${body}
      <p style="color: #888; font-size: 13px; margin-top: 24px;">Netter Center</p>
    </div>
  `;
}

function box(content: string): string {
  return `<div style="padding: 12px 16px; background: #f4f4f4; border-radius: 8px; margin: 12px 0;">${content}</div>`;
}

export function approvalEmail(opts: { name?: string; item?: string }): EmailContent {
  const item = opts.item || "submission";
  const subject = `Your ${item} has been approved`;
  const text = `${greeting(opts.name)}\n\nGood news: your ${item} has been approved. No further action is needed.`;
  const html = layout(
    "Approved",
    `<p>${escapeHtml(greeting(opts.name))}</p>
     <p>Good news: your <strong>${escapeHtml(item)}</strong> has been approved. No further action is needed.</p>`
  );
  return { subject, html, text };
}

export function rejectionEmail(opts: {
  name?: string;
  item?: string;
  reason: string;
}): EmailContent {
  const item = opts.item || "submission";
  const subject = `Action needed: your ${item} was not approved`;
  const text = `${greeting(opts.name)}\n\nYour ${item} was not approved yet. Reason:\n\n${opts.reason}\n\nPlease fix this and resubmit.`;
  const html = layout(
    "Action needed",
    `<p>${escapeHtml(greeting(opts.name))}</p>
     <p>Your <strong>${escapeHtml(item)}</strong> was not approved yet. Reason:</p>
     ${box(paragraph(opts.reason))}
     <p>Please fix this and resubmit.</p>`
  );
  return { subject, html, text };
}

export function fileNameEmail(opts: {
  name?: string;
  fileName: string;
  expectedFormat: string;
}): EmailContent {
  const subject = "Please rename your file";
  const text = `${greeting(opts.name)}\n\nThe file you uploaded, "${opts.fileName}", doesn't match the required naming format.\n\nRequired format: ${opts.expectedFormat}\n\nPlease rename the file and upload it again.`;
  const html = layout(
    "Please rename your file",
    `<p>${escapeHtml(greeting(opts.name))}</p>
     <p>The file you uploaded doesn't match the required naming format.</p>
     ${box(`Your file: <code>${escapeHtml(opts.fileName)}</code><br>Required format: <code>${escapeHtml(opts.expectedFormat)}</code>`)}
     <p>Please rename the file and upload it again.</p>`
  );
  return { subject, html, text };
}

export function reminderEmail(opts: {
  name?: string;
  item?: string;
  message?: string;
  deadline?: string;
}): EmailContent {
  const what = opts.item ? `your ${opts.item}` : "your outstanding items";
  const subject = opts.item
    ? `Reminder: ${opts.item}`
    : "Reminder from the Netter Center";
  const message = opts.message || `This is a reminder to submit ${what}.`;
  const text = `${greeting(opts.name)}\n\n${message}${opts.deadline ? `\n\nDeadline: ${opts.deadline}` : ""}`;
  const html = layout(
    "Reminder",
    `<p>${escapeHtml(greeting(opts.name))}</p>
     <p>${paragraph(message)}</p>
     ${opts.deadline ? box(`<strong>Deadline:</strong> ${escapeHtml(opts.deadline)}`) : ""}`
  );
  return { subject, html, text };
}

export function customEmail(opts: {
  name?: string;
  subject: string;
  message: string;
}): EmailContent {
  const text = `${greeting(opts.name)}\n\n${opts.message}`;
  const html = layout(
    opts.subject,
    `<p>${escapeHtml(greeting(opts.name))}</p><p>${paragraph(opts.message)}</p>`
  );
  return { subject: opts.subject, html, text };
}
