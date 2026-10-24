# Storage — Cloudflare R2

R2 is Cloudflare's S3-compatible object storage with zero egress fees.

## Setup

1. Go to https://dash.cloudflare.com → R2 → Create Bucket
2. Name your bucket and create it
3. Go to R2 → Manage R2 API Tokens → Create API Token
4. Give it **Object Read & Write** permissions for your bucket
5. Copy the credentials into your `.env`:
   ```
   R2_BUCKET_NAME=my-app-bucket
   R2_ACCESS_KEY_ID=your-access-key
   R2_SECRET_ACCESS_KEY=your-secret-key
   CLOUDFLARE_ACCOUNT_ID=your-account-id
   ```

## Install dependency

```bash
bun add @aws-sdk/client-s3
```

R2 is S3-compatible, so we use the standard AWS SDK.

## Usage

```ts
import { upload, download, list, remove } from "./integrations/storage";

// Upload a file
const file = Buffer.from("hello world");
await upload("uploads/hello.txt", file, "text/plain");

// Upload an image from a request
await upload("images/photo.jpg", imageBuffer, "image/jpeg");

// Download a file
const data = await download("uploads/hello.txt");

// List files
const files = await list("uploads/");

// Delete a file
await remove("uploads/hello.txt");
```

## Notes

- Free tier: 10 GB storage, 10 million reads, 1 million writes per month
- No egress fees — ever
- Max object size: 5 TB (multipart upload for files > 5 GB)
