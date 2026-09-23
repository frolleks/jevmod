import { Database } from "bun:sqlite";
import type { TranscriptEntry } from "./reports";

export const db = new Database("bot.sqlite");
db.run(
  "CREATE TABLE IF NOT EXISTS exempt_channels (guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, PRIMARY KEY (guild_id, channel_id))",
);
db.run(
  `CREATE TABLE IF NOT EXISTS guild_settings (
    guild_id TEXT PRIMARY KEY,
    hate_speech_enabled INTEGER NOT NULL DEFAULT 1,
    timeout_threshold INTEGER NOT NULL DEFAULT 3,
    timeout_minutes INTEGER NOT NULL DEFAULT 10,
    mod_log_channel_id TEXT
  )`,
);
db.run(
  "CREATE TABLE IF NOT EXISTS violations (guild_id TEXT NOT NULL, user_id TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (guild_id, user_id))",
);
// ponytail: rows outlive deleted ticket channels; clean up on ChannelDelete if the db grows
db.run("CREATE TABLE IF NOT EXISTS report_transcripts (ticket_id TEXT PRIMARY KEY, messages TEXT NOT NULL)");

export function saveTranscript(ticketId: string, entries: TranscriptEntry[]) {
  db.run("INSERT OR REPLACE INTO report_transcripts VALUES (?, ?)", [ticketId, JSON.stringify(entries)]);
}
export function getTranscript(ticketId: string): TranscriptEntry[] | null {
  const row = db.query("SELECT messages FROM report_transcripts WHERE ticket_id = ?").get(ticketId) as {
    messages: string;
  } | null;
  return row ? JSON.parse(row.messages) : null;
}

const isExemptQuery = db.query("SELECT 1 FROM exempt_channels WHERE guild_id = ? AND channel_id = ?");
export function isChannelExempt(guildId: string, channelId: string): boolean {
  return isExemptQuery.get(guildId, channelId) !== null;
}
export function addExempt(guildId: string, channelId: string) {
  db.run("INSERT OR IGNORE INTO exempt_channels VALUES (?, ?)", [guildId, channelId]);
}
export function removeExempt(guildId: string, channelId: string) {
  db.run("DELETE FROM exempt_channels WHERE guild_id = ? AND channel_id = ?", [guildId, channelId]);
}
export function listExempt(guildId: string): string[] {
  const rows = db.query("SELECT channel_id FROM exempt_channels WHERE guild_id = ?").all(guildId) as {
    channel_id: string;
  }[];
  return rows.map((r) => r.channel_id);
}

export type GuildSettings = {
  hate_speech_enabled: number;
  timeout_threshold: number;
  timeout_minutes: number;
  mod_log_channel_id: string | null;
};
const DEFAULT_SETTINGS: GuildSettings = {
  hate_speech_enabled: 1,
  timeout_threshold: 3,
  timeout_minutes: 10,
  mod_log_channel_id: null,
};
const getSettingsQuery = db.query(
  "SELECT hate_speech_enabled, timeout_threshold, timeout_minutes, mod_log_channel_id FROM guild_settings WHERE guild_id = ?",
);
export function getSettings(guildId: string): GuildSettings {
  return (getSettingsQuery.get(guildId) as GuildSettings | null) ?? DEFAULT_SETTINGS;
}
// column name is only ever one of the literals passed at call sites, never user input
export function upsertSetting(
  guildId: string,
  column: "hate_speech_enabled" | "mod_log_channel_id",
  value: string | number,
) {
  db.run(
    `INSERT INTO guild_settings (guild_id, ${column}) VALUES (?, ?) ON CONFLICT(guild_id) DO UPDATE SET ${column} = excluded.${column}`,
    [guildId, value],
  );
}
export function setTimeoutConfig(guildId: string, threshold: number, minutes: number) {
  db.run(
    `INSERT INTO guild_settings (guild_id, timeout_threshold, timeout_minutes) VALUES (?, ?, ?)
     ON CONFLICT(guild_id) DO UPDATE SET timeout_threshold = excluded.timeout_threshold, timeout_minutes = excluded.timeout_minutes`,
    [guildId, threshold, minutes],
  );
}

export function incrementViolations(guildId: string, userId: string): number {
  db.run(
    "INSERT INTO violations (guild_id, user_id, count) VALUES (?, ?, 1) ON CONFLICT(guild_id, user_id) DO UPDATE SET count = count + 1",
    [guildId, userId],
  );
  const row = db.query("SELECT count FROM violations WHERE guild_id = ? AND user_id = ?").get(guildId, userId) as {
    count: number;
  };
  return row.count;
}
export function resetViolations(guildId: string, userId: string) {
  db.run("UPDATE violations SET count = 0 WHERE guild_id = ? AND user_id = ?", [guildId, userId]);
}
