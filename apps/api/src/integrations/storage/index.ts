import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";

let client: S3Client | null = null;

function getClient() {
  if (!client) {
    client = new S3Client({
      region: "auto",
      endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    });
  }
  return client;
}

const bucket = () => process.env.R2_BUCKET_NAME!;

export async function upload(
  key: string,
  body: Buffer | Uint8Array | string,
  contentType?: string
): Promise<void> {
  await getClient().send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
}

export async function download(
  key: string
): Promise<Uint8Array<ArrayBuffer> | null> {
  try {
    const res = await getClient().send(
      new GetObjectCommand({ Bucket: bucket(), Key: key })
    );
    return res.Body ? new Uint8Array(await res.Body.transformToByteArray()) : null;
  } catch {
    return null;
  }
}

export async function remove(key: string): Promise<void> {
  await getClient().send(
    new DeleteObjectCommand({ Bucket: bucket(), Key: key })
  );
}

export async function list(prefix?: string): Promise<string[]> {
  const res = await getClient().send(
    new ListObjectsV2Command({ Bucket: bucket(), Prefix: prefix })
  );
  return (res.Contents ?? []).map((obj) => obj.Key!);
}
