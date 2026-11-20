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
    result: { results: T[] }[];
  };
  return json.result[0]?.results ?? [];
}

export async function execute(
  sql: string,
  params: unknown[] = []
): Promise<void> {
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
