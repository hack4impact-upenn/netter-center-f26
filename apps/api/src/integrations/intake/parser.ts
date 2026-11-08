export type FeedItem = {
  title: string;
  link: string;
  description: string;
  pubDate: string;
};

export function parseRSSItems(xml: string): FeedItem[] {
  const items: FeedItem[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;

  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const itemXml = match[1] ?? "";
    items.push({
      title: extractTag(itemXml, "title"),
      link: extractTag(itemXml, "link"),
      description: extractTag(itemXml, "description"),
      pubDate: extractTag(itemXml, "pubDate"),
    });
  }

  return items;
}

export function extractTag(xml: string, tag: string): string {
  const match =
    xml.match(
      new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`)
    ) ?? xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return match?.[1]?.trim() ?? "";
}
