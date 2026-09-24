import {
  type ChatInputCommandInteraction,
  Colors,
  EmbedBuilder,
  InteractionContextType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import { saveTranscript } from "../utils/db";
import { scoreHateSpeech } from "../utils/jev";
import { logToMod } from "../utils/moderation";
import {
  createTicket,
  fetchUserMessages,
  formatDay,
  onCooldown,
  parseRange,
  toTranscript,
  transcriptPage,
} from "../utils/reports";

export const data = new SlashCommandBuilder()
  .setName("report")
  .setDescription(
    "Report a member breaking the rules; opens a private ticket with the mods",
  )
  .setContexts(InteractionContextType.Guild)
  .addUserOption((o) =>
    o.setName("user").setDescription("Who to report").setRequired(true),
  )
  .addStringOption((o) =>
    o
      .setName("type")
      .setDescription("What they did")
      .addChoices({ name: "Hate speech", value: "hate_speech" })
      .setRequired(true),
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
  const target = i.options.getUser("user", true);
  const type = i.options.getString("type", true);
  const range = parseRange(
    i.options.getString("from", true),
    i.options.getString("to"),
  );
  if (typeof range === "string")
    return void (await i.reply({ content: range, flags: "Ephemeral" }));
  // has() also passes for Administrator
  if (
    !i.memberPermissions.has(PermissionFlagsBits.ManageGuild) &&
    onCooldown(`${i.guildId}:${i.user.id}`)
  ) {
    return void (await i.reply({
      content: "You can file one report every 5 minutes.",
      flags: "Ephemeral",
    }));
  }

  await i.deferReply({ flags: "Ephemeral" });
  const ticket = await createTicket(
    i.guild,
    i.member,
    `report-${target.username.replace(/[^a-z0-9_-]/g, "")}`,
  ).catch((e) => {
    console.error("ticket creation failed", e);
    return null;
  });
  if (!ticket)
    return void (await i.editReply(
      "Couldn't open a ticket; the bot needs the Manage Channels permission.",
    ));

  await ticket.send({
    content: [
      `**Report:** ${type.replaceAll("_", " ")}`,
      `**Reported user:** ${target} (${target.tag}, ${target.id})`,
      `**Reported by:** ${i.user}`,
      `**Range:** ${formatDay(range.start)} to ${formatDay(range.end - 1)} (UTC)`,
    ].join("\n"),
    allowedMentions: { parse: [] },
  });
  await i.editReply(`Report filed: ${ticket}`);
  await logToMod(
    i.guild,
    new EmbedBuilder()
      .setTitle("New report ticket")
      .setColor(Colors.Blurple)
      .addFields(
        { name: "Ticket", value: `${ticket}`, inline: true },
        { name: "Type", value: type.replaceAll("_", " "), inline: true },
        {
          name: "Reported user",
          value: `${target} (${target.tag})`,
          inline: true,
        },
        { name: "Reported by", value: `${i.user}`, inline: true },
      ),
  );

  try {
    const messages = await fetchUserMessages(
      i.guild,
      i.member,
      target.id,
      range.start,
      range.end,
    );
    if (!messages.length)
      return void (await ticket.send(
        "No messages from this user in that range to analyze.",
      ));
    const entries = toTranscript(messages);
    saveTranscript(ticket.id, entries);
    await ticket.send(transcriptPage(entries, 0));
    const score = await scoreHateSpeech(entries.map((e) => e.content));
    await ticket.send(
      `Jev hate speech confidence across ${messages.length} messages: **${Math.round(score * 100)}%**`,
    );
  } catch (e) {
    console.error("report analysis failed", e);
    await ticket.send("Automatic analysis failed; please review manually.");
  }
}
