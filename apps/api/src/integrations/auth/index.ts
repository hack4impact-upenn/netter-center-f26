import { Resend } from "resend";
export { generateCode } from "./utils";

let client: Resend | null = null;

function getClient() {
  if (!client) {
    client = new Resend(process.env.RESEND_API_KEY);
  }
  return client;
}

export async function sendVerificationEmail(
  to: string,
  code: string,
  fromAddress: string = "noreply@yourdomain.com"
): Promise<void> {
  await getClient().emails.send({
    from: fromAddress,
    to,
    subject: "Your verification code",
    html: `
      <div style="font-family: sans-serif; max-width: 400px; margin: 0 auto; padding: 20px;">
        <h2>Verification Code</h2>
        <p style="font-size: 32px; font-weight: bold; letter-spacing: 4px; padding: 16px; background: #f4f4f4; text-align: center; border-radius: 8px;">
          ${code}
        </p>
        <p style="color: #666;">This code expires in 10 minutes.</p>
      </div>
    `,
  });
}

export async function sendMagicLink(
  to: string,
  url: string,
  fromAddress: string = "noreply@yourdomain.com"
): Promise<void> {
  await getClient().emails.send({
    from: fromAddress,
    to,
    subject: "Your login link",
    html: `
      <div style="font-family: sans-serif; max-width: 400px; margin: 0 auto; padding: 20px;">
        <h2>Log In</h2>
        <p>Click the link below to log in:</p>
        <a href="${url}" style="display: inline-block; padding: 12px 24px; background: #5170FF; color: white; text-decoration: none; border-radius: 6px;">
          Log In
        </a>
        <p style="color: #666; margin-top: 16px;">This link expires in 10 minutes. If you didn't request this, ignore this email.</p>
      </div>
    `,
  });
}
