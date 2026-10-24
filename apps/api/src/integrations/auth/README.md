# Auth

Authentication is built-in using email/password with Bun's password hashing. No external service required.

## How it works

1. User registers with email + password
2. Password is hashed with `Bun.password.hash()` (argon2id)
3. A session token is created and returned
4. Client includes `Authorization: Bearer <token>` on requests
5. `requireAuth` middleware validates the token against D1

## Routes

| Route | Method | Description |
|---|---|---|
| `/api/auth/register` | POST | Create account with email + password |
| `/api/auth/login` | POST | Log in, returns session token |
| `/api/auth/logout` | POST | Invalidate session (requires auth) |
| `/api/auth/me` | GET | Get current user (requires auth) |

## Usage

```ts
// Register
const res = await fetch("/api/auth/register", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "user@example.com", password: "securepassword" }),
});
const { token } = await res.json();

// Use token for authenticated requests
const me = await fetch("/api/auth/me", {
  headers: { Authorization: `Bearer ${token}` },
});
```

## Optional: Email via Resend

If you want to send emails (welcome emails, notifications, password resets), add the Resend integration. This requires a verified domain.

1. Sign up at https://resend.com
2. Verify your domain
3. Add `RESEND_API_KEY=re_your_key` to your `.env`

See `integrations/auth/index.ts` for the email sending helpers.

## Notes

- Passwords are hashed with argon2id via `Bun.password.hash()`
- Sessions expire after 30 days
- Rate limited: 10 attempts per 15 minutes
- No external service required for basic auth
