/** Human-readable size of a response captured so far. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * Rough token count. The member CLIs report only text on stdout — no usage
 * metadata — so this is derived from length at the usual ~4 characters per
 * token for English prose. Always rendered with a `~` so it never reads as
 * an exact figure.
 */
export function formatTokens(bytes: number): string {
  const tokens = Math.round(bytes / 4);
  return tokens < 1000 ? `~${tokens}t` : `~${(tokens / 1000).toFixed(1)}kt`;
}

/** Size plus approximate tokens, e.g. `1.2KB ~310t`. Empty when nothing yet. */
export function formatVolume(bytes: number): string {
  if (bytes <= 0) return "";
  return `${formatBytes(bytes)} ${formatTokens(bytes)}`;
}
