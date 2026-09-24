import {
  Colors,
  EmbedBuilder,
  type Guild,
  type GuildMember,
  type Message,
} from "discord.js";
import { getSettings, incrementViolations } from "./db";

const FIRST_TIMEOUT_MINUTES = 5;
const MAX_TIMEOUT_MINUTES = 28 * 24 * 60; // Discord's limit

export async function logToMod(guild: Guild, embed: EmbedBuilder) {
  const { mod_log_channel_id } = getSettings(guild.id);
  if (!mod_log_channel_id) return;
  const channel = guild.channels.cache.get(mod_log_channel_id);
  // logged, not thrown: e.g. a missing Embed Links permission shouldn't break moderation
  if (channel?.isTextBased()) {
    await channel
      .send({ embeds: [embed.setTimestamp()] })
      .catch((e) => console.error("mod log failed", e));
  }
}

// a message Jev flagged: red if it was deleted, yellow with a jump link if it's left up for review.
// the content fits the description as-is: messages max out at 4000 chars (Nitro), descriptions at 4096
export function flaggedMessageEmbed(
  m: Message<true>,
  title: string,
  confidence: string,
  deleted: boolean,
) {
  return new EmbedBuilder()
    .setTitle(title)
    .setColor(deleted ? Colors.Red : Colors.Yellow)
    .setDescription(m.content)
    .addFields(
      { name: "Author", value: `${m.author} (${m.author.tag})`, inline: true },
      {
        name: "Channel",
        value: deleted
          ? `${m.channel}`
          : `${m.channel} · [Jump to message](${m.url})`,
        inline: true,
      },
      { name: "Jev confidence", value: confidence, inline: true },
    );
}

// the ladder: violation 1 is a warning, 2 a final warning, then timeouts that double from 5m (0 = no timeout)
export function timeoutMinutes(violation: number) {
  return violation < 3
    ? 0
    : Math.min(
        FIRST_TIMEOUT_MINUTES * 2 ** (violation - 3),
        MAX_TIMEOUT_MINUTES,
      );
}

// counts a violation, applies the ladder, DMs the member what happened, and returns the action for the mod log
export async function recordViolation(member: GuildMember, reason: string) {
  const count = incrementViolations(member.guild.id, member.id);
  const minutes = timeoutMinutes(count);
  let action = "Warning";
  let notice = "This is a warning.";
  if (count === 2) {
    action = "Final warning";
    notice =
      "This is your final warning: your next violation will get you timed out.";
  } else if (minutes) {
    const until = `<t:${Math.floor(Date.now() / 1000) + minutes * 60}:f>`;
    const timedOut = await member.timeout(minutes * 60_000, reason).then(
      () => true,
      (e) => {
        console.error("timeout failed", e);
        return false;
      },
    );
    action = timedOut
      ? `Timed out until ${until}`
      : "Timeout failed; the bot needs Moderate Members and a role above theirs";
    notice = timedOut
      ? `You've been timed out until ${until}. Each further violation doubles the timeout.`
      : "";
  }
  await member
    .send(
      `Your message in **${member.guild.name}** was removed because it was flagged as ${reason}. ${notice}`.trim(),
    )
    .catch(() => {}); // DMs may be closed
  return `${action} (violation ${count})`;
}
