# Email — Resend

Sends notification emails: approvals, rejections (with a reason), wrong file name warnings, reminders, and custom messages.

## Setup

1. Sign up at https://resend.com and create an API key (**API Keys → Create**).
2. Add it to `apps/api/.env`:
   ```
   RESEND_API_KEY=re_your_key
   ```
3. **Testing:** leave `EMAIL_FROM` empty. Emails come from `onboarding@resend.dev`, which **only delivers to the email on your Resend account**.
4. **Real users:** verify a domain in Resend (**Domains → Add domain**, then add the DNS records it shows), then set:
   ```
   EMAIL_FROM=Netter Center <notifications@yourdomain.org>
   ```
5. List the staff allowed to send emails from the dashboard:
   ```
   ADMIN_EMAILS=staff1@upenn.edu,staff2@upenn.edu
   ```
6. Optional default file-name rule (each `{placeholder}` matches letters, numbers, and hyphens):
   ```
   FILE_NAME_FORMAT={lastname}_{firstname}_{document}.pdf
   ```
7. Create the `email_log` and `reminders` tables: `bun run setup`

## Routes

All routes need a logged-in user whose email is in `ADMIN_EMAILS`.

| Route                                     | Body                                                                                       | What it does                                             |
| ----------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| `POST /api/notifications/approve`         | `{ email, name?, item? }`                                                                  | Sends an approval email                                  |
| `POST /api/notifications/reject`          | `{ email, name?, item?, reason }`                                                          | Sends a rejection email with the reason                  |
| `POST /api/notifications/check-file-name` | `{ email, name?, fileName, expectedFormat? }`                                              | If the name is wrong, emails the person how to rename it |
| `POST /api/notifications/remind`          | `{ all: true }` or `{ recipients: [{ email, name? }] }`, plus `message?, item?, deadline?` | Sends a reminder now                                     |
| `POST /api/notifications/custom`          | recipients as above, plus `subject, message`                                               | Sends your own email                                     |
| `GET /api/notifications/reminders`        |                                                                                            | Lists scheduled reminders                                |
| `POST /api/notifications/reminders`       | `{ title, sendAt, message?, item?, deadline? }` + recipients                               | Schedules a reminder                                     |
| `DELETE /api/notifications/reminders/:id` |                                                                                            | Cancels a pending reminder                               |
| `GET /api/notifications/log`              |                                                                                            | Last 100 sends                                           |

Scheduled reminders are checked every minute while the API is running (`src/jobs/reminders.ts`).

## Using it from other code

```ts
import { deliver } from "../lib/notify";
import { rejectionEmail } from "../integrations/email/templates";

await deliver(
  "rejection",
  [{ email: "student@example.com", name: "Sam" }],
  (r) =>
    rejectionEmail({ name: r.name, item: "consent form", reason: "Missing signature" }),
  staffUserId
);
```

For example, the Box upload flow can call `isValidFileName()` from `fileName.ts` and send `fileNameEmail()` when it fails.

## Notes

- Free tier: 100 emails/day, 3,000/month.
- Bulk sends go out as one email per person, so nobody sees anyone else's address.
