// Offline check of Jev's hate speech and spam calls, through the same judge() the bot uses. No Discord or users needed.
// Hate speech cases: HateCheck (Röttger et al., ACL 2021, CC-BY-4.0) https://huggingface.co/datasets/Paul/hatecheck
// Usage: bun run eval [sample size, default 100]. Costs one Jev call per case.
import { judge } from "../utils/jev";

const SAMPLE = Number(process.argv[2] ?? 100);
const CONCURRENCY = 5;
const MINUTE = 60_000;
const DAY = 86_400_000;

if (!Number.isInteger(SAMPLE) || SAMPLE < 1) throw new Error("Sample size must be a positive integer");
if (!process.env.OPENROUTER_API_KEY) throw new Error("Set OPENROUTER_API_KEY in .env");

type Row = { functionality: string; test_case: string; label_gold: "hateful" | "non-hateful" };
type Judgment = Awaited<ReturnType<typeof judge>>;

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "n/a");

async function fetchHateCheck(): Promise<Row[]> {
  const rows: Row[] = [];
  for (let offset = 0; ; offset += 100) {
    const res = await fetch(
      `https://datasets-server.huggingface.co/rows?dataset=Paul/hatecheck&config=default&split=test&offset=${offset}&length=100`,
    );
    if (!res.ok) throw new Error(`HateCheck fetch failed: HTTP ${res.status}`);
    const page = (await res.json()) as { rows: { row: Row }[]; num_rows_total: number };
    rows.push(...page.rows.map((r) => r.row));
    if (offset + 100 >= page.num_rows_total) return rows;
  }
}

// runs fn over items with at most n in flight; a failed call becomes null instead of aborting the run
async function mapPool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<(R | null)[]> {
  const out: (R | null)[] = new Array(items.length).fill(null);
  let next = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!).catch((e) => (console.error(`case ${i} failed:`, e.message), null));
      }
    }),
  );
  return out;
}

// --- hate speech: HateCheck sample, sent as an ordinary message from an established member ---
const all = await fetchHateCheck();
// rows are grouped by functionality, so an even stride covers every category
const cases = Array.from({ length: Math.min(SAMPLE, all.length) }, (_, k) => all[Math.floor((k * all.length) / SAMPLE)]!);
console.log(`Judging ${cases.length} of ${all.length} HateCheck cases...`);

const results = await mapPool(cases, CONCURRENCY, (c) =>
  judge({
    message: c.test_case,
    account_created_at: ago(730 * DAY),
    guild_joined_at: ago(365 * DAY),
    recent_messages: [c.test_case],
  }),
);
const judged = cases
  .map((c, i) => ({ ...c, j: results[i] }))
  .filter((r): r is Row & { j: Judgment } => r.j !== null);

const byFunctionality = new Map<string, { gold: string; n: number; none: number; review: number; remove: number }>();
for (const r of judged) {
  const row = byFunctionality.get(r.functionality) ?? { gold: r.label_gold, n: 0, none: 0, review: 0, remove: 0 };
  row.n++;
  row[r.j.hateLevel]++;
  byFunctionality.set(r.functionality, row);
}
console.table(Object.fromEntries(byFunctionality));

const clean = judged.filter((r) => r.label_gold === "non-hateful");
const hateful = judged.filter((r) => r.label_gold === "hateful");
const falseRemovals = clean.filter((r) => r.j.hateLevel === "remove");
const falseReviews = clean.filter((r) => r.j.hateLevel === "review");
const missed = hateful.filter((r) => r.j.hateLevel === "none");
console.log(`\nFalse removals: ${falseRemovals.length}/${clean.length} non-hateful (${pct(falseRemovals.length, clean.length)}), real users who'd have been deleted`);
console.log(`False reviews:  ${falseReviews.length}/${clean.length} non-hateful (${pct(falseReviews.length, clean.length)}), mod-log noise`);
console.log(`Missed hate:    ${missed.length}/${hateful.length} hateful (${pct(missed.length, hateful.length)}), no action and no log`);
for (const r of falseRemovals) console.log(`  wrongly removed [${r.functionality}] ${Math.round(r.j.hateScore * 100)}%: ${r.test_case}`);

console.log("\nThreshold sweep on the raw hate score (bot removes above 0.8, flags above 0.5):");
console.table(
  [0.5, 0.6, 0.7, 0.8, 0.9, 0.95].map((t) => ({
    threshold: t,
    "non-hateful above": pct(clean.filter((r) => r.j.hateScore > t).length, clean.length),
    "hateful above": pct(hateful.filter((r) => r.j.hateScore > t).length, hateful.length),
  })),
);

// --- spam: hand-written scenarios, since spam depends on account age and message history ---
const scamLink = "Free Discord Nitro for everyone!! Claim yours before it runs out: https://dlscord-nitro.example/claim";
const invite = "JOIN MY SERVER NOW discord.gg/abc123 free giveaways";
const spamCases = [
  { name: "brand-new account, scam link", expect: "high_spam", message: scamLink, created: 2 * 60 * MINUTE, joined: 5 * MINUTE, recent: [scamLink] },
  { name: "burst of identical invites", expect: "high_spam", message: invite, created: 3 * DAY, joined: 10 * MINUTE, recent: Array(6).fill(invite) },
  { name: "mass-mention link drop", expect: "high_spam", message: "@everyone @here you have to see this https://bit.ly/3xYz", created: DAY, joined: 30 * MINUTE, recent: [] },
  { name: "old account, one self-promo link", expect: "medium_spam", message: "I just released my first indie game on Steam, would love feedback! https://store.steampowered.com/app/123", created: 900 * DAY, joined: 400 * DAY, recent: [] },
  { name: "brand-new account, normal hello", expect: "no_spam", message: "hi everyone! just joined, found this server through the subreddit", created: 60 * MINUTE, joined: 2 * MINUTE, recent: [] },
  { name: "old account, normal chat", expect: "no_spam", message: "anyone up for ranked tonight?", created: 1200 * DAY, joined: 700 * DAY, recent: ["gg last night", "that last round was wild"] },
];
const spamResults = await mapPool(spamCases, CONCURRENCY, (s) =>
  judge({
    message: s.message,
    account_created_at: ago(s.created),
    guild_joined_at: ago(s.joined),
    recent_messages: [...s.recent, s.message],
  }),
);
console.log("\nSpam scenarios:");
console.table(
  spamCases.map((s, i) => ({
    scenario: s.name,
    expected: s.expect,
    got: spamResults[i]?.spamLevel ?? "error",
    confidence: spamResults[i]?.spamScore == null ? "n/a" : `${Math.round(spamResults[i]!.spamScore! * 100)}%`,
    match: spamResults[i]?.spamLevel === s.expect ? "yes" : "NO",
  })),
);
