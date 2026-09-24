import { Colors, EmbedBuilder, type Guild, type GuildMember, type Message } from "discord.js";
import { getSettings, incrementViolations, resetViolations } from "./db";

export async function logToMod(guild: Guild, embed: EmbedBuilder) {
  const { mod_log_channel_id } = getSettings(guild.id);
  if (!mod_log_channel_id) return;
  const channel = guild.channels.cache.get(mod_log_channel_id);
  // logged, not thrown: e.g. a missing Embed Links permission shouldn't break moderation
  if (channel?.isTextBased()) {
    await channel.send({ embeds: [embed.setTimestamp()] }).catch((e) => console.error("mod log failed", e));
  }
}

// a message Jev flagged: red if it was deleted, yellow with a jump link if it's left up for review.
// the content fits the description as-is: messages max out at 4000 chars (Nitro), descriptions at 4096
export function flaggedMessageEmbed(m: Message<true>, title: string, confidence: string, deleted: boolean) {
  return new EmbedBuilder()
    .setTitle(title)
    .setColor(deleted ? Colors.Red : Colors.Yellow)
    .setDescription(m.content)
    .addFields(
      { name: "Author", value: `${m.author} (${m.author.tag})`, inline: true },
      { name: "Channel", value: deleted ? `${m.channel}` : `${m.channel} · [Jump to message](${m.url})`, inline: true },
      { name: "Jev confidence", value: confidence, inline: true },
    );
}

export async function recordViolation(member: GuildMember, reason: string) {
  const settings = getSettings(member.guild.id);
  const count = incrementViolations(member.guild.id, member.id);
  if (count < settings.timeout_threshold) return;
  const timedOut = await member.timeout(settings.timeout_minutes * 60_000, reason).then(
    () => true,
    (e) => {
      console.error("timeout failed", e);
      return false;
    },
  );
  resetViolations(member.guild.id, member.id);
  await logToMod(
    member.guild,
    new EmbedBuilder()
      .setTitle(timedOut ? "Member timed out" : "Auto-timeout failed")
      .setColor(timedOut ? Colors.Orange : Colors.DarkRed)
      .setDescription(timedOut ? null : "Check that the bot has Moderate Members and a role above this member's.")
      .addFields(
        { name: "Member", value: `${member} (${member.user.tag})`, inline: true },
        { name: "Duration", value: `${settings.timeout_minutes}m`, inline: true },
        { name: "Reason", value: `Repeated violations (${reason})`, inline: true },
      ),
  );
}
