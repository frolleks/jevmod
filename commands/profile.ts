import {
  type ChatInputCommandInteraction,
  Colors,
  EmbedBuilder,
  InteractionContextType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import { getViolations, saveTranscript } from "../utils/db";
import { scoreProfile } from "../utils/jev";
import {
  fetchUserMessages,
  formatDay,
  parseRange,
  toTranscript,
  transcriptPage,
} from "../utils/reports";

export const data = new SlashCommandBuilder()
  .setName("profile")
  .setDescription(
    "Look up a member: their messages, violations, and Jev's hate speech and spam scores",
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .setContexts(InteractionContextType.Guild)
  .addUserOption((o) =>
    o.setName("user").setDescription("Who to look up").setRequired(true),
  )
  .addStringOption((o) =>
    o
      .setName("from")
      .setDescription("Check their messages from this date (YYYY-MM-DD, UTC)")
      .setRequired(true),
  )
  .addStringOption((o) =>
    o
      .setName("to")
      .setDescription(
        "Up to and including this date (YYYY-MM-DD, UTC); defaults to now",
      )
      .setRequired(false),
  );

export async function execute(i: ChatInputCommandInteraction) {
  if (!i.inCachedGuild()) return;
  const user = i.options.getUser("user", true);
  const range = parseRange(
    i.options.getString("from", true),
    i.options.getString("to"),
  );
  if (typeof range === "string")
    return void (await i.reply({ content: range, flags: "Ephemeral" }));

  await i.deferReply({ flags: "Ephemeral" });
  const member = await i.guild.members.fetch(user.id).catch(() => null);
  // like /report, only channels the person running this can see
  const entries = toTranscript(
    await fetchUserMessages(i.guild, i.member, user.id, range.start, range.end),
  );

  let hate = "n/a (no messages)";
  let spam = "n/a (no messages)";
  if (entries.length) {
    const scores = await scoreProfile({
      messages: entries.map((e) => e.content),
      account_created_at: user.createdAt.toISOString(),
      guild_joined_at: member?.joinedAt?.toISOString() ?? null,
    }).catch((e) => {
      console.error("profile analysis failed", e);
      return null;
    });
    const pct = (p: number) => `${Math.round(p * 100)}%`;
    hate = scores ? pct(scores.hateScore) : "Analysis failed";
    spam = scores ? pct(scores.spamScore) : "Analysis failed";
  }

  const date = (ms: number) => `<t:${Math.floor(ms / 1000)}:D>`;
  await i.editReply({
    embeds: [
      new EmbedBuilder()
        .setTitle(`Profile: ${user.tag}`)
        .setThumbnail(user.displayAvatarURL())
        .setColor(Colors.Blurple)
        .addFields(
          {
            name: "Account created",
            value: date(user.createdTimestamp),
            inline: true,
          },
          {
            name: "Joined server",
            value: member?.joinedTimestamp
              ? date(member.joinedTimestamp)
              : "Not in the server",
            inline: true,
          },
          {
            name: "Violations on record",
            value: `${getViolations(i.guildId, user.id)}`,
            inline: true,
          },
          {
            name: "Messages analyzed",
            value: `${entries.length} (${formatDay(range.start)} to ${formatDay(range.end - 1)}, UTC)`,
            inline: true,
          },
          { name: "Hate speech (Jev)", value: hate, inline: true },
          { name: "Spam (Jev)", value: spam, inline: true },
        ),
    ],
  });

  if (!entries.length) return;
  const transcript = await i.followUp({
    ...transcriptPage(entries, 0),
    flags: "Ephemeral",
  });
  saveTranscript(transcript.id, entries);
}
