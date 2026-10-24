import Stripe from "stripe";

let client: Stripe | null = null;

function getClient() {
  if (!client) {
    client = new Stripe(process.env.STRIPE_SECRET_KEY!);
  }
  return client;
}

export async function createCheckoutSession(options: {
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string;
}): Promise<string> {
  const session = await getClient().checkout.sessions.create({
    mode: "payment",
    line_items: [{ price: options.priceId, quantity: 1 }],
    success_url: options.successUrl,
    cancel_url: options.cancelUrl,
    ...(options.customerEmail && {
      customer_email: options.customerEmail,
    }),
  });
  return session.url!;
}

export async function createSubscriptionCheckout(options: {
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string;
}): Promise<string> {
  const session = await getClient().checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: options.priceId, quantity: 1 }],
    success_url: options.successUrl,
    cancel_url: options.cancelUrl,
    ...(options.customerEmail && {
      customer_email: options.customerEmail,
    }),
  });
  return session.url!;
}

export async function constructWebhookEvent(
  body: string,
  signature: string
): Promise<Stripe.Event> {
  return getClient().webhooks.constructEvent(
    body,
    signature,
    process.env.STRIPE_WEBHOOK_SECRET!
  );
}
