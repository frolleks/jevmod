import { Database } from "bun:sqlite";
import type { TranscriptEntry } from "./reports";

// in-memory under `bun test` (which sets NODE_ENV=test), so tests never touch the real data
export const db = new Database(
  process.env.NODE_ENV === "test" ? ":memory:" : "bot.sqlite",
);
db.run(
  "CREATE TABLE IF NOT EXISTS exempt_channels (guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, PRIMARY KEY (guild_id, channel_id))",
);
db.run(
  `CREATE TABLE IF NOT EXISTS guild_settings (
    guild_id TEXT PRIMARY KEY,
    hate_speech_enabled INTEGER NOT NULL DEFAULT 1,
    mod_log_channel_id TEXT
  )`,
);
db.run(
  "CREATE TABLE IF NOT EXISTS violations (guild_id TEXT NOT NULL, user_id TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (guild_id, user_id))",
);
// keyed by the ticket channel for /report, and by the reply message for /profile (several can share a channel)
// ponytail: rows outlive deleted tickets and dismissed profile replies; prune old rows if the db grows
db.run(
  "CREATE TABLE IF NOT EXISTS report_transcripts (ticket_id TEXT PRIMARY KEY, messages TEXT NOT NULL)",
);

export function saveTranscript(key: string, entries: TranscriptEntry[]) {
  db.run("INSERT OR REPLACE INTO report_transcripts VALUES (?, ?)", [
    key,
    JSON.stringify(entries),
  ]);
}
export function getTranscript(key: string): TranscriptEntry[] | null {
  const row = db
    .query("SELECT messages FROM report_transcripts WHERE ticket_id = ?")
    .get(key) as {
    messages: string;
  } | null;
  return row ? JSON.parse(row.messages) : null;
}

const isExemptQuery = db.query(
  "SELECT 1 FROM exempt_channels WHERE guild_id = ? AND channel_id = ?",
);
export function isChannelExempt(guildId: string, channelId: string): boolean {
  return isExemptQuery.get(guildId, channelId) !== null;
}
export function addExempt(guildId: string, channelId: string) {
  db.run("INSERT OR IGNORE INTO exempt_channels VALUES (?, ?)", [
    guildId,
    channelId,
  ]);
}
export function removeExempt(guildId: string, channelId: string) {
  db.run("DELETE FROM exempt_channels WHERE guild_id = ? AND channel_id = ?", [
    guildId,
    channelId,
  ]);
}
export function listExempt(guildId: string): string[] {
  const rows = db
    .query("SELECT channel_id FROM exempt_channels WHERE guild_id = ?")
    .all(guildId) as {
    channel_id: string;
  }[];
  return rows.map((r) => r.channel_id);
}

export type GuildSettings = {
  hate_speech_enabled: number;
  mod_log_channel_id: string | null;
};
const DEFAULT_SETTINGS: GuildSettings = {
  hate_speech_enabled: 1,
  mod_log_channel_id: null,
};
// databases created before the violation ladder still have unused timeout_threshold/timeout_minutes columns
const getSettingsQuery = db.query(
  "SELECT hate_speech_enabled, mod_log_channel_id FROM guild_settings WHERE guild_id = ?",
);
export function getSettings(guildId: string): GuildSettings {
  return (
    (getSettingsQuery.get(guildId) as GuildSettings | null) ?? DEFAULT_SETTINGS
  );
}
// column name is only ever one of the literals passed at call sites, never user input
export function upsertSetting(
  guildId: string,
  column: "hate_speech_enabled" | "mod_log_channel_id",
  value: string | number | null,
) {
  db.run(
    `INSERT INTO guild_settings (guild_id, ${column}) VALUES (?, ?) ON CONFLICT(guild_id) DO UPDATE SET ${column} = excluded.${column}`,
    [guildId, value],
  );
}
// ponytail: violations never expire, so old history still moves someone up the ladder; store a timestamp per
// violation and ignore old ones if that turns out too harsh
export function incrementViolations(guildId: string, userId: string): number {
  db.run(
    "INSERT INTO violations (guild_id, user_id, count) VALUES (?, ?, 1) ON CONFLICT(guild_id, user_id) DO UPDATE SET count = count + 1",
    [guildId, userId],
  );
  return getViolations(guildId, userId);
}
export function getViolations(guildId: string, userId: string): number {
  const row = db
    .query("SELECT count FROM violations WHERE guild_id = ? AND user_id = ?")
    .get(guildId, userId) as { count: number } | null;
  return row?.count ?? 0;
}
// stops counting the latest violation, moving the member one step back down the ladder;
// returns the new count, or null if they had none
export function decrementViolations(
  guildId: string,
  userId: string,
): number | null {
  const row = db
    .query(
      "UPDATE violations SET count = count - 1 WHERE guild_id = ? AND user_id = ? AND count > 0 RETURNING count",
    )
    .get(guildId, userId) as { count: number } | null;
  return row?.count ?? null;
}
