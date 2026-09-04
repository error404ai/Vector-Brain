/**
 * Zero-cost result verification (v1).
 *
 * Free models sometimes "complete" a task by listing websites in the final
 * answer that were never actually visited (e.g. claiming khanacademy.org when
 * the step evidence only shows bbc.co.uk). Domains are the one claim type we
 * can check reliably with plain string work, so v1 verifies only domains:
 * every domain mentioned in the final message must also appear somewhere in
 * the step evidence, otherwise it is flagged as unsupported.
 *
 * This is intentionally conservative — it never blocks anything, it only
 * produces an "unverified" warning for the UI to display.
 */

export interface VerificationOutcome {
  /** True when every domain claimed in the final message appears in evidence. */
  verified: boolean;
  /** Domains mentioned in the final message but absent from all evidence. */
  unsupportedDomains: string[];
  /** Total domains found in the final message (0 means nothing to verify). */
  claimedCount: number;
}

/**
 * Matches bare domains like youtube.com, bbc.co.uk, ck12.org, app.vectoragent.in.
 * Restricted to common TLDs to avoid false positives on things like "file.txt".
 */
const DOMAIN_REGEX =
  /\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:com|org|net|edu|gov|io|co|in|uk|ai|app|dev|tv|me|info|xyz)\b/gi;

function normalizeDomain(domain: string): string {
  return domain.toLowerCase().replace(/^www\./, '');
}

function extractDomains(text: string): string[] {
  const matches = text.match(DOMAIN_REGEX) ?? [];
  return Array.from(new Set(matches.map(normalizeDomain)));
}

/**
 * Checks the final agent message against evidence gathered during the run
 * (step thoughts, step results, visited URLs — anything textual).
 */
export function verifyResultClaims(finalMessage: string | null | undefined, evidenceParts: Array<string | null | undefined>): VerificationOutcome {
  if (!finalMessage) {
    return { verified: true, unsupportedDomains: [], claimedCount: 0 };
  }

  const claimed = extractDomains(finalMessage);
  if (claimed.length === 0) {
    return { verified: true, unsupportedDomains: [], claimedCount: 0 };
  }

  // Only the domains matter, and step results carry whole screen dumps, so the
  // evidence is reduced to its domains rather than lower-casing tens of
  // kilobytes of text. This runs on every render of a finished run, and the
  // naive version was heavy enough to make the live screen stutter.
  const evidence = new Set<string>();
  for (const part of evidenceParts) {
    if (typeof part !== 'string' || part.length === 0) continue;
    for (const domain of extractDomains(part)) evidence.add(domain);
  }

  const unsupported = claimed.filter((domain) => {
    if (evidence.has(domain)) return false;
    // A claim like "youtube.com" is also supported by evidence that only
    // mentions a subdomain such as "m.youtube.com".
    for (const seen of evidence) {
      if (seen.endsWith(`.${domain}`)) return false;
    }
    return true;
  });

  return {
    verified: unsupported.length === 0,
    unsupportedDomains: unsupported,
    claimedCount: claimed.length,
  };
}
