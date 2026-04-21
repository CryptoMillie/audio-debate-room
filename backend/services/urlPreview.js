/**
 * URL Preview Service
 *
 * Detects URLs in chat messages and fetches Open Graph / oEmbed metadata
 * for rich link previews. No external dependencies — uses native fetch.
 */

const URL_REGEX = /https?:\/\/[^\s<>\"')\]]+/gi;
const TWITTER_REGEX = /^https?:\/\/(twitter\.com|x\.com)\//i;
const FETCH_TIMEOUT = 3000;

/**
 * Extract all URLs from a text string.
 */
function extractUrls(text) {
  return text.match(URL_REGEX) || [];
}

/**
 * Fetch with a timeout — aborts if it takes longer than `ms`.
 */
function fetchWithTimeout(url, options = {}, ms = FETCH_TIMEOUT) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...options, signal: controller.signal }).finally(() =>
    clearTimeout(timer)
  );
}

/**
 * Get a Twitter/X oEmbed preview via publish.twitter.com.
 */
async function getTwitterPreview(url) {
  const oembedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}&omit_script=true`;
  const res = await fetchWithTimeout(oembedUrl);
  if (!res.ok) return null;

  const data = await res.json();
  return {
    url,
    title: data.author_name ? `${data.author_name} on X` : "Post on X",
    description: data.author_name
      ? `@${data.author_url?.split("/").pop() || data.author_name}`
      : "",
    image: null,
    siteName: "X (Twitter)",
    type: "twitter",
    twitterHtml: data.html || null,
    authorName: data.author_name || null,
  };
}

/**
 * Parse Open Graph meta tags from raw HTML.
 */
function parseOgTags(html) {
  const og = {};
  // Match <meta property="og:..." content="..."> and <meta name="og:..." content="...">
  const metaRegex =
    /<meta\s+(?:[^>]*?)(?:property|name)\s*=\s*["']og:([^"']+)["'][^>]*?content\s*=\s*["']([^"']*)["'][^>]*?\/?>/gi;
  let match;
  while ((match = metaRegex.exec(html)) !== null) {
    og[match[1]] = match[2];
  }
  // Also match content before property (some sites flip the order)
  const metaRegex2 =
    /<meta\s+(?:[^>]*?)content\s*=\s*["']([^"']*)["'][^>]*?(?:property|name)\s*=\s*["']og:([^"']+)["'][^>]*?\/?>/gi;
  while ((match = metaRegex2.exec(html)) !== null) {
    if (!og[match[2]]) og[match[2]] = match[1];
  }
  // Fallback: try <title> tag if no og:title
  if (!og.title) {
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch) og.title = titleMatch[1].trim();
  }
  // Fallback: try meta description if no og:description
  if (!og.description) {
    const descMatch = html.match(
      /<meta\s+(?:[^>]*?)name\s*=\s*["']description["'][^>]*?content\s*=\s*["']([^"']*)["'][^>]*?\/?>/i
    );
    if (descMatch) og.description = descMatch[1];
  }
  return og;
}

/**
 * Fetch Open Graph metadata for a generic URL.
 */
async function getOpenGraphPreview(url) {
  const res = await fetchWithTimeout(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; BackchannelBot/1.0; +https://backchannel.app)",
      Accept: "text/html",
    },
    redirect: "follow",
  });
  if (!res.ok) return null;

  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return null;

  const html = await res.text();
  const og = parseOgTags(html);

  if (!og.title && !og.description) return null;

  return {
    url,
    title: og.title || null,
    description: og.description || null,
    image: og.image || null,
    siteName: og.site_name || new URL(url).hostname,
    type: "opengraph",
  };
}

/**
 * Main handler — detects URL type, routes to the correct fetcher.
 * Returns preview object or null on failure.
 */
async function getUrlPreview(url) {
  try {
    if (TWITTER_REGEX.test(url)) {
      return await getTwitterPreview(url);
    }
    return await getOpenGraphPreview(url);
  } catch (err) {
    // Timeout, network error, parse error — silently return null
    return null;
  }
}

module.exports = { extractUrls, getUrlPreview };
