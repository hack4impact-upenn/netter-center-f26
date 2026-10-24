import { Hono } from "hono";
import {
  createCheckoutSession,
  createSubscriptionCheckout,
  constructWebhookEvent,
} from "../integrations/payments";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types";

const payments = new Hono<AppEnv>();

payments.post("/checkout", requireAuth, async (c) => {
  const body = await c.req.json<{
    priceId?: string;
    successUrl?: string;
    cancelUrl?: string;
  }>();

  if (!body.priceId || !body.successUrl || !body.cancelUrl) {
    return c.json(
      { error: "priceId, successUrl, and cancelUrl are required" },
      400
    );
  }

  const url = await createCheckoutSession({
    priceId: body.priceId,
    successUrl: body.successUrl,
    cancelUrl: body.cancelUrl,
  });

  return c.json({ url });
});

payments.post("/subscribe", requireAuth, async (c) => {
  const body = await c.req.json<{
    priceId?: string;
    successUrl?: string;
    cancelUrl?: string;
  }>();

  if (!body.priceId || !body.successUrl || !body.cancelUrl) {
    return c.json(
      { error: "priceId, successUrl, and cancelUrl are required" },
      400
    );
  }

  const url = await createSubscriptionCheckout({
    priceId: body.priceId,
    successUrl: body.successUrl,
    cancelUrl: body.cancelUrl,
  });

  return c.json({ url });
});

payments.post("/webhook", async (c) => {
  const body = await c.req.text();
  const signature = c.req.header("stripe-signature");

  if (!signature) {
    return c.json({ error: "Missing stripe-signature header" }, 400);
  }

  try {
    const event = await constructWebhookEvent(body, signature);

    switch (event.type) {
      case "checkout.session.completed":
        // Handle successful payment
        break;
      case "customer.subscription.created":
        // Handle new subscription
        break;
      case "customer.subscription.deleted":
        // Handle cancelled subscription
        break;
    }

    return c.json({ received: true });
  } catch {
    return c.json({ error: "Invalid webhook signature" }, 400);
  }
});

export default payments;
