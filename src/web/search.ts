/** Provider interface — add Brave or any other engine by implementing this */
export interface SearchProvider {
  name: string;
  search(query: string, maxResults?: number): Promise<SearchResult[]>;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
}

// ─── DuckDuckGo provider (free, no key needed) ────────────────────────────────

export class DuckDuckGoProvider implements SearchProvider {
  readonly name = "DuckDuckGo";

  async search(query: string, maxResults = 5): Promise<SearchResult[]> {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1`;
    const res = await fetch(url, {
      headers: { "User-Agent": "SomaFlow/1.0 (Arthur)" },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) throw new Error(`DDG search failed: ${res.statusText}`);

    const data = await res.json() as any;
    const results: SearchResult[] = [];

    if (data.AbstractText) {
      results.push({
        title: data.AbstractSource || "DuckDuckGo Summary",
        url: data.AbstractURL || "",
        snippet: data.AbstractText,
        source: "ddg-abstract",
      });
    }

    for (const topic of (data.RelatedTopics || []).slice(0, maxResults - results.length)) {
      if (!topic.Text || !topic.FirstURL) continue;
      results.push({
        title: topic.Text.slice(0, 80),
        url: topic.FirstURL,
        snippet: topic.Text,
        source: "ddg-related",
      });
    }

    return results.slice(0, maxResults);
  }
}

// ─── Brave Search provider (add key to use) ────────────────────────────────────

export class BraveSearchProvider implements SearchProvider {
  readonly name = "Brave";

  constructor(private readonly apiKey: string) {}

  async search(query: string, maxResults = 5): Promise<SearchResult[]> {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}`;
    const res = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": this.apiKey,
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) throw new Error(`Brave search failed: ${res.statusText}`);

    const data = await res.json() as any;
    return (data.web?.results || []).slice(0, maxResults).map((r: any) => ({
      title: r.title,
      url: r.url,
      snippet: r.description || "",
      source: "brave",
    }));
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createSearchProvider(): SearchProvider {
  const braveKey = process.env.BRAVE_SEARCH_API_KEY;
  if (braveKey) {
    return new BraveSearchProvider(braveKey);
  }
  return new DuckDuckGoProvider();
}

export function formatSearchResults(results: SearchResult[], query: string): string {
  if (results.length === 0) return `No results found for: "${query}"`;
  const lines = [
    `## Search Results for "${query}"`,
    "",
    ...results.map((r, i) =>
      `### ${i + 1}. ${r.title}\n**URL:** ${r.url}\n${r.snippet}`
    ),
  ];
  return lines.join("\n\n");
}
