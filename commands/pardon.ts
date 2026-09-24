import {
  type ChatInputCommandInteraction,
  Colors,
  EmbedBuilder,
  InteractionContextType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import { decrementViolations } from "../utils/db";
import { logToMod } from "../utils/moderation";

export const data = new SlashCommandBuilder()
  .setName("pardon")
  .setDescription(
    "Stop counting a member's latest violation and lift their timeout",
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .setContexts(InteractionContextType.Guild)
  .addUserOption((o) =>
    o.setName("user").setDescription("Who to pardon").setRequired(true),
  );

export async function execute(i: ChatInputCommandInteraction) {
  if (!i.inCachedGuild()) return;
  const user = i.options.getUser("user", true);
  await i.deferReply({ flags: "Ephemeral" });
  const remaining = decrementViolations(i.guildId, user.id);
  // force: without the GuildMembers intent, the cached timeout state can be stale
  const member = await i.guild.members
    .fetch({ user: user.id, force: true })
    .catch(() => null);
  let timeout: "none" | "lifted" | "failed" = "none";
  if (member?.isCommunicationDisabled()) {
    timeout = await member.timeout(null, `Pardoned by ${i.user.tag}`).then(
      () => "lifted" as const,
      () => "failed" as const,
    );
  }
  if (remaining === null && timeout === "none") {
    return void (await i.editReply(
      `Nothing to pardon: ${user} has no violations on record and isn't timed out.`,
    ));
  }

  const result = [
    remaining === null
      ? "They had no violations on record."
      : `Their latest violation no longer counts (${remaining} left on record).`,
  ];
  if (timeout === "lifted") result.push("Their timeout was lifted.");
  if (timeout === "failed") {
    result.push(
      "Couldn't lift their timeout; the bot needs Moderate Members and a role above theirs.",
    );
  }
  await i.editReply(result.join("\n"));

  const undone: string[] = [];
  if (remaining !== null) undone.push("your latest violation no longer counts");
  if (timeout === "lifted") undone.push("your timeout has been lifted");
  if (undone.length) {
    await user
      .send(
        `A moderator in **${i.guild.name}** pardoned you: ${undone.join(" and ")}.`,
      )
      .catch(() => {}); // DMs may be closed
  }

  await logToMod(
    i.guild,
    new EmbedBuilder()
      .setTitle("Member pardoned")
      .setColor(Colors.Green)
      .setDescription(result.join("\n"))
      .addFields(
        { name: "Member", value: `${user} (${user.tag})`, inline: true },
        { name: "Pardoned by", value: `${i.user}`, inline: true },
      ),
  );
}
