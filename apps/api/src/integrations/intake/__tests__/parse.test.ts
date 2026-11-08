import { describe, it, expect } from "bun:test";
import { parseRSSItems, extractTag } from "../parser";

describe("parseRSSItems", () => {
  it("parses standard RSS XML with multiple items", () => {
    const xml = `
      <rss>
        <channel>
          <item>
            <title>First Article</title>
            <link>https://example.com/1</link>
            <description>Description of first article</description>
            <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
          </item>
          <item>
            <title>Second Article</title>
            <link>https://example.com/2</link>
            <description>Description of second article</description>
            <pubDate>Tue, 02 Jan 2024 00:00:00 GMT</pubDate>
          </item>
        </channel>
      </rss>
    `;

    const items = parseRSSItems(xml);

    expect(items).toHaveLength(2);
    expect(items[0]!.title).toBe("First Article");
    expect(items[0]!.link).toBe("https://example.com/1");
    expect(items[0]!.description).toBe("Description of first article");
    expect(items[0]!.pubDate).toBe("Mon, 01 Jan 2024 00:00:00 GMT");
    expect(items[1]!.title).toBe("Second Article");
  });

  it("handles CDATA-wrapped content", () => {
    const xml = `
      <rss>
        <channel>
          <item>
            <title><![CDATA[Breaking: <em>Important</em> News]]></title>
            <link>https://example.com/breaking</link>
            <description><![CDATA[This has <b>HTML</b> inside]]></description>
            <pubDate>Wed, 03 Jan 2024 12:00:00 GMT</pubDate>
          </item>
        </channel>
      </rss>
    `;

    const items = parseRSSItems(xml);

    expect(items).toHaveLength(1);
    expect(items[0]!.title).toBe("Breaking: <em>Important</em> News");
    expect(items[0]!.description).toBe("This has <b>HTML</b> inside");
  });

  it("returns empty array for feed with no items", () => {
    const xml = `
      <rss>
        <channel>
          <title>Empty Feed</title>
        </channel>
      </rss>
    `;

    const items = parseRSSItems(xml);
    expect(items).toHaveLength(0);
  });

  it("handles items with missing tags", () => {
    const xml = `
      <rss>
        <channel>
          <item>
            <title>Title Only</title>
          </item>
        </channel>
      </rss>
    `;

    const items = parseRSSItems(xml);

    expect(items).toHaveLength(1);
    expect(items[0]!.title).toBe("Title Only");
    expect(items[0]!.link).toBe("");
    expect(items[0]!.description).toBe("");
    expect(items[0]!.pubDate).toBe("");
  });

  it("handles mixed CDATA and plain text across items", () => {
    const xml = `
      <rss>
        <channel>
          <item>
            <title><![CDATA[CDATA Title]]></title>
            <link>https://example.com/1</link>
            <description>Plain description</description>
            <pubDate>Thu, 04 Jan 2024 00:00:00 GMT</pubDate>
          </item>
          <item>
            <title>Plain Title</title>
            <link>https://example.com/2</link>
            <description><![CDATA[CDATA description]]></description>
            <pubDate>Fri, 05 Jan 2024 00:00:00 GMT</pubDate>
          </item>
        </channel>
      </rss>
    `;

    const items = parseRSSItems(xml);

    expect(items).toHaveLength(2);
    expect(items[0]!.title).toBe("CDATA Title");
    expect(items[0]!.description).toBe("Plain description");
    expect(items[1]!.title).toBe("Plain Title");
    expect(items[1]!.description).toBe("CDATA description");
  });
});

describe("extractTag", () => {
  it("extracts plain text content", () => {
    const result = extractTag("<title>Hello World</title>", "title");
    expect(result).toBe("Hello World");
  });

  it("extracts CDATA content", () => {
    const result = extractTag(
      "<title><![CDATA[Hello <b>World</b>]]></title>",
      "title"
    );
    expect(result).toBe("Hello <b>World</b>");
  });

  it("returns empty string for missing tag", () => {
    const result = extractTag("<title>Hello</title>", "link");
    expect(result).toBe("");
  });

  it("trims whitespace from extracted content", () => {
    const result = extractTag("<title>  Hello World  </title>", "title");
    expect(result).toBe("Hello World");
  });

  it("handles tags with surrounding content", () => {
    const xml =
      "<item><title>My Title</title><link>https://example.com</link></item>";
    expect(extractTag(xml, "title")).toBe("My Title");
    expect(extractTag(xml, "link")).toBe("https://example.com");
  });
});
