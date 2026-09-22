import type { Guild, GuildMember } from "discord.js";
import { getSettings, incrementViolations, resetViolations } from "./db";

export async function logToMod(guild: Guild, text: string) {
  const { mod_log_channel_id } = getSettings(guild.id);
  if (!mod_log_channel_id) return;
  const channel = guild.channels.cache.get(mod_log_channel_id);
  if (channel?.isTextBased()) await channel.send(text).catch(() => {});
}

export async function recordViolation(member: GuildMember, reason: string) {
  const settings = getSettings(member.guild.id);
  const count = incrementViolations(member.guild.id, member.id);
  if (count < settings.timeout_threshold) return;
  await member.timeout(settings.timeout_minutes * 60_000, reason).catch((e) => console.error("timeout failed", e));
  resetViolations(member.guild.id, member.id);
  await logToMod(
    member.guild,
    `${member} was timed out for ${settings.timeout_minutes}m after repeated violations (${reason}).`,
  );
}
