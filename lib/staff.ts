// Server-only: the staff directory used to populate the attendee picker.
// Sourced from STAFF_EMAILS (the same list that receives booking notifications).

export function staffDirectory(): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of (process.env.STAFF_EMAILS || '').split(',')) {
    const a = raw.trim();
    if (!a || seen.has(a.toLowerCase())) continue;
    seen.add(a.toLowerCase());
    out.push(a);
  }
  return out.sort((a, b) => a.localeCompare(b));
}
