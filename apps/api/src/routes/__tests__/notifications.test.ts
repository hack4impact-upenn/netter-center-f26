import { describe, it, expect, beforeAll, beforeEach, mock } from "bun:test";
import { Hono } from "hono";

const ADMIN = "staff@example.com";

let currentUserEmail = ADMIN;
const allUserRows = [
  { email: "a@example.com", name: "Ann" },
  { email: "b@example.com", name: null },
];

const mockQuery = mock((sql: string) => {
  if (sql.includes("FROM sessions")) {
    return Promise.resolve([{ user_id: "user-1", expires_at: "2099-01-01" }]);
  }
  if (sql.includes("SELECT email FROM users WHERE id")) {
    return Promise.resolve([{ email: currentUserEmail }]);
  }
  if (sql.includes("SELECT email, name FROM users")) {
    return Promise.resolve(allUserRows);
  }
  return Promise.resolve([]);
});
const mockExecute = mock((_sql: string, _params?: unknown[]) => Promise.resolve());

mock.module("../../integrations/database", () => ({
  query: mockQuery,
  execute: mockExecute,
}));

const mockSendEmail = mock((_to: string, _content: { subject: string; html: string }) =>
  Promise.resolve()
);
const mockSendBatch = mock((_emails: { to: string }[]) => Promise.resolve());

mock.module("../../integrations/email", () => ({
  sendEmail: mockSendEmail,
  sendBatch: mockSendBatch,
}));

const auth = { Authorization: "Bearer valid-token", "Content-Type": "application/json" };

function post(path: string, body: unknown, headers: Record<string, string> = auth) {
  return app.request(`/api/notifications${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

let app: Hono;

beforeAll(async () => {
  process.env.ADMIN_EMAILS = `other@example.com, ${ADMIN.toUpperCase()}`;
  const { default: routes } = await import("../notifications");
  app = new Hono();
  app.route("/api/notifications", routes);
});

beforeEach(() => {
  currentUserEmail = ADMIN;
  delete process.env.FILE_NAME_FORMAT;
  mockSendEmail.mockClear();
  mockSendBatch.mockClear();
  mockExecute.mockClear();
  mockSendEmail.mockImplementation(() => Promise.resolve());
});

describe("access control", () => {
  it("returns 401 without a token", async () => {
    const res = await post(
      "/approve",
      { email: "x@example.com" },
      { "Content-Type": "application/json" }
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 for users not in ADMIN_EMAILS", async () => {
    currentUserEmail = "student@example.com";
    const res = await post("/approve", { email: "x@example.com" });
    expect(res.status).toBe(403);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});

describe("POST /approve", () => {
  it("sends an approval email and logs it", async () => {
    const res = await post("/approve", {
      email: "sam@example.com",
      name: "Sam",
      item: "consent form",
    });
    expect(res.status).toBe(200);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const [to, content] = mockSendEmail.mock.calls[0]!;
    expect(to).toBe("sam@example.com");
    expect(content.subject).toContain("approved");
    expect(
      mockExecute.mock.calls.some(([sql]) => sql.includes("INSERT INTO email_log"))
    ).toBe(true);
  });

  it("returns 400 for a bad email", async () => {
    const res = await post("/approve", { email: "not-an-email" });
    expect(res.status).toBe(400);
  });

  it("returns 502 and logs a failure when Resend fails", async () => {
    mockSendEmail.mockImplementation(() =>
      Promise.reject(new Error("domain not verified"))
    );
    const res = await post("/approve", { email: "sam@example.com" });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain("domain not verified");
    const log = mockExecute.mock.calls.find(([sql]) =>
      sql.includes("INSERT INTO email_log")
    );
    expect(log?.[1]).toContain("failed");
  });
});

describe("POST /reject", () => {
  it("requires a reason", async () => {
    const res = await post("/reject", { email: "sam@example.com", reason: "  " });
    expect(res.status).toBe(400);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("sends the reason in the email", async () => {
    const res = await post("/reject", {
      email: "sam@example.com",
      reason: "Forgot the W-9",
    });
    expect(res.status).toBe(200);
    expect(mockSendEmail.mock.calls[0]![1].html).toContain("Forgot the W-9");
  });
});

describe("POST /check-file-name", () => {
  const format = "{lastname}_{firstname}.pdf";

  it("does not email when the name is correct", async () => {
    const res = await post("/check-file-name", {
      email: "sam@example.com",
      fileName: "Lee_Sam.pdf",
      expectedFormat: format,
    });
    expect(await res.json()).toEqual({ valid: true, emailed: false });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("emails the person when the name is wrong", async () => {
    const res = await post("/check-file-name", {
      email: "sam@example.com",
      fileName: "scan001.pdf",
      expectedFormat: format,
    });
    expect(await res.json()).toEqual({ valid: false, emailed: true });
    expect(mockSendEmail.mock.calls[0]![1].html).toContain("scan001.pdf");
  });

  it("uses FILE_NAME_FORMAT when no format is sent", async () => {
    process.env.FILE_NAME_FORMAT = format;
    const res = await post("/check-file-name", {
      email: "sam@example.com",
      fileName: "Lee_Sam.pdf",
    });
    expect((await res.json()).valid).toBe(true);
  });

  it("returns 400 when no format is available", async () => {
    const res = await post("/check-file-name", {
      email: "sam@example.com",
      fileName: "x.pdf",
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /remind", () => {
  it("reminds every user with all: true", async () => {
    const res = await post("/remind", { all: true, item: "timesheet" });
    expect(await res.json()).toEqual({ sent: 2 });
    const emails = mockSendBatch.mock.calls[0]![0];
    expect(emails.map((e) => e.to)).toEqual(["a@example.com", "b@example.com"]);
  });

  it("returns 400 without recipients", async () => {
    const res = await post("/remind", {});
    expect(res.status).toBe(400);
  });

  it("returns 400 if any recipient email is invalid", async () => {
    const res = await post("/remind", {
      recipients: [{ email: "ok@example.com" }, { email: "bad" }],
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /custom", () => {
  it("requires a subject and message", async () => {
    const res = await post("/custom", { all: true, subject: "Hi" });
    expect(res.status).toBe(400);
  });

  it("sends to the chosen recipients", async () => {
    const res = await post("/custom", {
      recipients: [{ email: "a@example.com", name: "Ann" }],
      subject: "Schedule change",
      message: "No program Friday",
    });
    expect(await res.json()).toEqual({ sent: 1 });
    expect(mockSendEmail.mock.calls[0]![1].subject).toBe("Schedule change");
  });
});

describe("POST /reminders", () => {
  it("schedules a reminder", async () => {
    const sendAt = new Date(Date.now() + 86_400_000).toISOString();
    const res = await post("/reminders", { title: "Timesheets", sendAt, all: true });
    expect(res.status).toBe(201);
    const insert = mockExecute.mock.calls.find(([sql]) =>
      sql.includes("INSERT INTO reminders")
    );
    expect(insert?.[1]?.[4]).toBe(sendAt);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("rejects a time in the past", async () => {
    const res = await post("/reminders", {
      title: "Late",
      sendAt: "2020-01-01T00:00:00Z",
      all: true,
    });
    expect(res.status).toBe(400);
  });

  it("rejects an invalid date", async () => {
    const res = await post("/reminders", {
      title: "Bad",
      sendAt: "tomorrow-ish",
      all: true,
    });
    expect(res.status).toBe(400);
  });
});
