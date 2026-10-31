import { describe, it, expect, beforeEach, mock } from "bun:test";

let dueRows: Record<string, unknown>[] = [];

const mockQuery = mock((sql: string) => {
  if (sql.includes("FROM reminders")) return Promise.resolve(dueRows);
  if (sql.includes("SELECT email, name FROM users")) {
    return Promise.resolve([
      { email: "a@example.com", name: "Ann" },
      { email: "b@example.com", name: null },
    ]);
  }
  return Promise.resolve([]);
});
const mockExecute = mock((_sql: string, _params?: unknown[]) => Promise.resolve());

mock.module("../../integrations/database", () => ({
  query: mockQuery,
  execute: mockExecute,
}));

const mockSendEmail = mock((_to: string, _content: unknown) => Promise.resolve());
const mockSendBatch = mock((_emails: { to: string }[]) => Promise.resolve());

mock.module("../../integrations/email", () => ({
  sendEmail: mockSendEmail,
  sendBatch: mockSendBatch,
}));

const { processDueReminders } = await import("../reminders");

function statusUpdates() {
  return mockExecute.mock.calls
    .filter(([sql]) => sql.startsWith("UPDATE reminders SET status"))
    .map(([sql]) => sql.match(/status = '(\w+)'/)?.[1]);
}

beforeEach(() => {
  dueRows = [];
  mockExecute.mockClear();
  mockSendEmail.mockClear();
  mockSendBatch.mockClear();
  mockSendEmail.mockImplementation(() => Promise.resolve());
});

describe("processDueReminders", () => {
  it("does nothing when nothing is due", async () => {
    expect(await processDueReminders()).toBe(0);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("sends to everyone and marks the reminder sent", async () => {
    dueRows = [
      {
        id: "r1",
        title: "T",
        message: null,
        item: "timesheet",
        deadline: null,
        send_to_all: 1,
        recipients: null,
        created_by: "u1",
      },
    ];
    await processDueReminders();
    expect(mockSendBatch.mock.calls[0]![0].map((e) => e.to)).toEqual([
      "a@example.com",
      "b@example.com",
    ]);
    expect(statusUpdates()).toEqual(["sending", "sent"]);
  });

  it("sends to a saved recipient list", async () => {
    dueRows = [
      {
        id: "r2",
        title: "T",
        message: "hi",
        item: null,
        deadline: null,
        send_to_all: 0,
        recipients: JSON.stringify([{ email: "x@example.com" }]),
        created_by: null,
      },
    ];
    await processDueReminders();
    expect(mockSendEmail.mock.calls[0]![0]).toBe("x@example.com");
  });

  it("marks the reminder failed when sending fails", async () => {
    mockSendEmail.mockImplementation(() => Promise.reject(new Error("quota exceeded")));
    dueRows = [
      {
        id: "r3",
        title: "T",
        message: null,
        item: null,
        deadline: null,
        send_to_all: 0,
        recipients: JSON.stringify([{ email: "x@example.com" }]),
        created_by: null,
      },
    ];
    await processDueReminders();
    expect(statusUpdates()).toEqual(["sending", "failed"]);
  });
});
