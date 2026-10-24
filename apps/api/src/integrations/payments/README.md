# Payments — Stripe

Stripe Checkout for one-time payments and subscriptions.

## Setup

1. Sign up at https://stripe.com
2. Get your **test mode** API keys from https://dashboard.stripe.com/test/apikeys
3. Add to your `.env`:
   ```
   STRIPE_SECRET_KEY=sk_test_your_key
   STRIPE_WEBHOOK_SECRET=whsec_your_secret
   ```

## Install dependency

```bash
bun add stripe
```

## Usage

### One-time payment

```ts
import { createCheckoutSession } from "./integrations/payments";

// Create a Price in Stripe Dashboard first, then:
const checkoutUrl = await createCheckoutSession({
  priceId: "price_abc123",
  successUrl: "https://yourapp.com/success",
  cancelUrl: "https://yourapp.com/cancel",
  customerEmail: "user@example.com",
});

// Redirect user to checkoutUrl
```

### Subscription

```ts
import { createSubscriptionCheckout } from "./integrations/payments";

const checkoutUrl = await createSubscriptionCheckout({
  priceId: "price_recurring_abc123",
  successUrl: "https://yourapp.com/success",
  cancelUrl: "https://yourapp.com/cancel",
});
```

### Webhooks

```ts
import { constructWebhookEvent } from "./integrations/payments";

app.post("/api/webhooks/stripe", async (c) => {
  const body = await c.req.text();
  const sig = c.req.header("stripe-signature")!;
  const event = await constructWebhookEvent(body, sig);

  switch (event.type) {
    case "checkout.session.completed":
      // Payment successful — fulfill the order
      break;
    case "customer.subscription.deleted":
      // Subscription cancelled
      break;
  }

  return c.json({ received: true });
});
```

## Setting up webhooks

1. Install Stripe CLI: https://stripe.com/docs/stripe-cli
2. For local testing: `stripe listen --forward-to localhost:3001/api/webhooks/stripe`
3. Copy the webhook signing secret into `STRIPE_WEBHOOK_SECRET`
4. For production, create a webhook endpoint in the Stripe Dashboard

## Notes

- Always use **test mode** keys during development
- Stripe charges no monthly fee — only per-transaction fees
- Use Stripe Dashboard to create Products and Prices
