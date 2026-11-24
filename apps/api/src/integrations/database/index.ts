const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";

function headers() {
  return {
    Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
    "Content-Type": "application/json",
  };
}

function dbUrl() {
  return `${CLOUDFLARE_API}/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/d1/database/${process.env.D1_DATABASE_ID}`;
}

export async function query<T = unknown>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const res = await fetch(`${dbUrl()}/query`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ sql, params }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`D1 query failed: ${err}`);
  }

  const json = (await res.json()) as {
    success?: boolean;
    result?: { success?: boolean; results?: T[] }[];
  } | null;
  const result = json?.result?.[0];
  if (
    json?.success === false ||
    !result ||
    result.success === false ||
    !Array.isArray(result.results)
  ) {
    throw new Error("D1 query returned an invalid result");
  }
  return result.results;
}

export async function execute(sql: string, params: unknown[] = []): Promise<void> {
  const res = await fetch(`${dbUrl()}/query`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ sql, params }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`D1 execute failed: ${err}`);
  }
}
