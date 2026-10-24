import { describe, it, expect, beforeAll, mock } from "bun:test";
import { Hono } from "hono";

// Mock the database integration (used by auth middleware)
mock.module("../../integrations/database", () => ({
  query: mock(() =>
    Promise.resolve([{ user_id: "user-1", expires_at: "2099-01-01" }])
  ),
  execute: mock(() => Promise.resolve()),
}));

// Mock the payments integration
const mockCreateCheckout = mock(() =>
  Promise.resolve("https://checkout.stripe.com/session/test123")
);
const mockCreateSubscription = mock(() =>
  Promise.resolve("https://checkout.stripe.com/session/sub456")
);
const mockConstructWebhook = mock();

mock.module("../../integrations/payments", () => ({
  createCheckoutSession: mockCreateCheckout,
  createSubscriptionCheckout: mockCreateSubscription,
  constructWebhookEvent: mockConstructWebhook,
}));

const authHeader = { Authorization: "Bearer valid-token" };

let app: Hono;

beforeAll(async () => {
  const { default: paymentsRoutes } = await import("../payments");
  app = new Hono();
  app.route("/api/payments", paymentsRoutes);
});

describe("POST /api/payments/checkout", () => {
  it("returns checkout URL with valid body", async () => {
    const res = await app.request("/api/payments/checkout", {
      method: "POST",
      headers: { ...authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({
        priceId: "price_123",
        successUrl: "https://example.com/success",
        cancelUrl: "https://example.com/cancel",
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toBe("https://checkout.stripe.com/session/test123");
  });

  it("returns 400 when priceId is missing", async () => {
    const res = await app.request("/api/payments/checkout", {
      method: "POST",
      headers: { ...authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({
        successUrl: "https://example.com/success",
        cancelUrl: "https://example.com/cancel",
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("priceId");
  });

  it("returns 401 without auth", async () => {
    const res = await app.request("/api/payments/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        priceId: "price_123",
        successUrl: "https://example.com/success",
        cancelUrl: "https://example.com/cancel",
      }),
    });

    expect(res.status).toBe(401);
  });
});

describe("POST /api/payments/subscribe", () => {
  it("returns subscription checkout URL", async () => {
    const res = await app.request("/api/payments/subscribe", {
      method: "POST",
      headers: { ...authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({
        priceId: "price_recurring_123",
        successUrl: "https://example.com/success",
        cancelUrl: "https://example.com/cancel",
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toBe("https://checkout.stripe.com/session/sub456");
  });
});

describe("POST /api/payments/webhook", () => {
  it("processes valid webhook event", async () => {
    mockConstructWebhook.mockImplementation(() => ({
      type: "checkout.session.completed",
      data: { object: {} },
    }));

    const res = await app.request("/api/payments/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "stripe-signature": "valid_sig",
      },
      body: JSON.stringify({ id: "evt_123" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received).toBe(true);
  });

  it("returns 400 when signature is missing", async () => {
    const res = await app.request("/api/payments/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "evt_123" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("stripe-signature");
  });

  it("returns 400 when signature is invalid", async () => {
    mockConstructWebhook.mockImplementation(() => {
      throw new Error("Invalid signature");
    });

    const res = await app.request("/api/payments/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "stripe-signature": "invalid_sig",
      },
      body: JSON.stringify({ id: "evt_123" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Invalid webhook signature");
  });

  it("does not require auth (Stripe calls this endpoint)", async () => {
    mockConstructWebhook.mockImplementation(() => ({
      type: "checkout.session.completed",
      data: { object: {} },
    }));

    const res = await app.request("/api/payments/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "stripe-signature": "valid_sig",
      },
      body: JSON.stringify({ id: "evt_123" }),
    });

    // Should not be 401
    expect(res.status).toBe(200);
  });
});
