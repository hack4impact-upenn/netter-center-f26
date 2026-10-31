import { describe, it, expect } from "bun:test";
import {
  escapeHtml,
  approvalEmail,
  rejectionEmail,
  fileNameEmail,
  reminderEmail,
  customEmail,
} from "../templates";
import { isValidFileName } from "../fileName";

describe("escapeHtml", () => {
  it("escapes HTML special characters", () => {
    expect(escapeHtml(`<script>"x" & 'y'</script>`)).toBe(
      "&lt;script&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/script&gt;"
    );
  });
});

describe("approvalEmail", () => {
  it("names the item and greets the person", () => {
    const e = approvalEmail({ name: "Sam", item: "consent form" });
    expect(e.subject).toBe("Your consent form has been approved");
    expect(e.html).toContain("Hi Sam,");
    expect(e.text).toContain("approved");
  });

  it("falls back to a generic item", () => {
    expect(approvalEmail({}).subject).toBe("Your submission has been approved");
  });
});

describe("rejectionEmail", () => {
  it("includes the reason, escaped, with line breaks kept", () => {
    const e = rejectionEmail({
      item: "packet",
      reason: "Missing <b>ID</b>\nPlease sign page 2",
    });
    expect(e.html).toContain("Missing &lt;b&gt;ID&lt;/b&gt;<br>Please sign page 2");
    expect(e.text).toContain("Missing <b>ID</b>");
  });
});

describe("fileNameEmail", () => {
  it("shows the wrong name and the required format", () => {
    const e = fileNameEmail({
      fileName: "scan1.pdf",
      expectedFormat: "{last}_{first}.pdf",
    });
    expect(e.html).toContain("scan1.pdf");
    expect(e.html).toContain("{last}_{first}.pdf");
  });
});

describe("reminderEmail", () => {
  it("includes the deadline when given", () => {
    const e = reminderEmail({ item: "timesheet", deadline: "Nov 5" });
    expect(e.subject).toBe("Reminder: timesheet");
    expect(e.text).toContain("Deadline: Nov 5");
    expect(e.html).toContain("Nov 5");
  });

  it("uses a custom message when given", () => {
    expect(reminderEmail({ message: "Bring your badge" }).text).toContain(
      "Bring your badge"
    );
  });
});

describe("customEmail", () => {
  it("escapes the subject in the HTML heading", () => {
    const e = customEmail({ subject: "A & B", message: "hello" });
    expect(e.subject).toBe("A & B");
    expect(e.html).toContain("A &amp; B");
  });
});

describe("isValidFileName", () => {
  const format = "{lastname}_{firstname}_{document}.pdf";

  it("accepts names that match", () => {
    expect(isValidFileName("Smith_Jane_Consent.pdf", format)).toBe(true);
    expect(isValidFileName("o-neil_sam_w9.PDF", format)).toBe(true);
  });

  it("rejects names that don't match", () => {
    expect(isValidFileName("scan.pdf", format)).toBe(false);
    expect(isValidFileName("Smith Jane Consent.pdf", format)).toBe(false);
    expect(isValidFileName("Smith_Jane_Consent.docx", format)).toBe(false);
    expect(isValidFileName("Smith_Jane_Consent_extra.pdf", format)).toBe(false);
  });

  it("treats regex characters in the format literally", () => {
    expect(isValidFileName("a(1).txt", "{x}(1).txt")).toBe(true);
    expect(isValidFileName("ab1).txt", "{x}(1).txt")).toBe(false);
  });
});
