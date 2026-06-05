import { docCache } from "./doc-cache";

/** Convert HTML to clean Markdown (simplified, no external deps) */
function htmlToMarkdown(html: string): string {
  return html
    // Remove scripts and style blocks entirely
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    // Headings
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n# $1\n")
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n## $1\n")
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n### $1\n")
    .replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, "\n#### $1\n")
    // Code blocks
    .replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, "\n```\n$1\n```\n")
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`")
    // Lists
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "\n- $1")
    // Paragraphs and breaks
    .replace(/<p[^>]*>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    // Links
    .replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)")
    // Bold/italic
    .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, "**$1**")
    .replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, "*$1*")
    // Strip remaining tags
    .replace(/<[^>]+>/g, " ")
    // Decode HTML entities
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    // Clean up excess whitespace
    .replace(/\n{4,}/g, "\n\n\n")
    .replace(/ {2,}/g, " ")
    .trim();
}

function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1]!.trim() : "";
}

export interface FetchResult {
  url: string;
  title: string;
  markdown: string;
  fromCache: boolean;
  citation: string;
}

export async function fetchPageAsMarkdown(url: string): Promise<FetchResult> {
  // Check cache first
  const cached = docCache.get(url);
  if (cached) {
    return {
      url,
      title: cached.title || url,
      markdown: cached.markdown,
      fromCache: true,
      citation: `Source: ${cached.title || url} — ${url} (cached)`,
    };
  }

  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; SomaFlow/1.0; Arthur)",
      "Accept": "text/html,application/xhtml+xml",
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);

  const contentType = res.headers.get("content-type") || "";
  let markdown: string;
  let title = url;

  if (contentType.includes("application/json")) {
    markdown = `\`\`\`json\n${JSON.stringify(await res.json(), null, 2)}\n\`\`\``;
  } else {
    const html = await res.text();
    title = extractTitle(html) || url;
    markdown = htmlToMarkdown(html);
  }

  // Truncate to ~40K chars to keep token usage reasonable
  if (markdown.length > 40000) {
    markdown = markdown.slice(0, 40000) + "\n\n...(truncated — use a more specific URL to get more)";
  }

  docCache.set(url, markdown, title);

  return {
    url,
    title,
    markdown,
    fromCache: false,
    citation: `Source: ${title} — ${url}`,
  };
}

/** Derive npm docs URL from a package name */
export function npmDocsUrl(packageName: string): string {
  return `https://www.npmjs.com/package/${encodeURIComponent(packageName)}`;
}
