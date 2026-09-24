import {
  ActivityType,
  Client,
  Colors,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits,
} from "discord.js";
import {
  addExempt,
  decrementViolations,
  getSettings,
  getTranscript,
  isChannelExempt,
  listExempt,
  removeExempt,
  saveTranscript,
  upsertSetting,
} from "./utils/db";
import {
  buildHelpText,
  helpCommand,
  pardonCommand,
  reportCommand,
  settingsCommand,
} from "./utils/commands";
import { judge, scoreHateSpeech } from "./utils/jev";
import { pushHistory } from "./utils/history";
import {
  flaggedMessageEmbed,
  logToMod,
  recordViolation,
} from "./utils/moderation";
import {
  createTicket,
  fetchUserMessages,
  onCooldown,
  parseRange,
  toTranscript,
  transcriptPage,
} from "./utils/reports";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // privileged: enable in the Developer Portal
  ],
});

client.once(Events.ClientReady, async (c) => {
  // ponytail: global command sync on every boot; move to a deploy script if it hits rate limits
  await c.application.commands.set([
    { name: "ping", description: "Pong" },
    helpCommand.toJSON(),
    reportCommand.toJSON(),
    pardonCommand.toJSON(),
    settingsCommand.toJSON(),
  ]);
  console.log(`Logged in as ${c.user.tag}`);

  c.user.setPresence({
    activities: [
      { name: "Watching and moderating", type: ActivityType.Watching },
    ],
  });
});

client.on(Events.InteractionCreate, async (i) => {
  if (i.isButton() && i.customId.startsWith("report-page:")) {
    const entries = getTranscript(i.channelId);
    if (!entries)
      return void (await i.reply({
        content: "This transcript is no longer available.",
        flags: "Ephemeral",
      }));
    return void (await i.update(
      transcriptPage(entries, Number(i.customId.split(":")[1])),
    ));
  }

  if (!i.isChatInputCommand()) return;

  if (i.commandName === "ping") return void (await i.reply("Pong"));

  if (i.commandName === "help")
    return void (await i.reply({
      content: buildHelpText(),
      flags: "Ephemeral",
    }));

  if (i.commandName === "report" && i.inCachedGuild()) {
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

    const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    await ticket.send({
      content: [
        `**Report:** ${type.replaceAll("_", " ")}`,
        `**Reported user:** ${target} (${target.tag}, ${target.id})`,
        `**Reported by:** ${i.user}`,
        `**Range:** ${day(range.start)} to ${day(range.end - 1)} (UTC)`,
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
          { name: "Reported user", value: `${target} (${target.tag})`, inline: true },
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
    return;
  }

  if (i.commandName === "pardon" && i.inCachedGuild()) {
    const user = i.options.getUser("user", true);
    await i.deferReply({ flags: "Ephemeral" });
    const remaining = decrementViolations(i.guildId, user.id);
    // force: without the GuildMembers intent, the cached timeout state can be stale
    const member = await i.guild.members
      .fetch({ user: user.id, force: true })
      .catch(() => null);
    let timeout: "none" | "lifted" | "failed" = "none";
    if (member?.isCommunicationDisabled()) {
      timeout = await member
        .timeout(null, `Pardoned by ${i.user.tag}`)
        .then(
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
    return;
  }

  if (i.commandName === "settings" && i.inGuild()) {
    const channel = i.options.getChannel("channel");
    const sub = i.options.getSubcommand();
    if (sub === "exempt-add" && channel) {
      addExempt(i.guildId, channel.id);
      await i.reply({
        content: `${channel} is now exempt from scanning.`,
        flags: "Ephemeral",
      });
    } else if (sub === "exempt-remove" && channel) {
      removeExempt(i.guildId, channel.id);
      await i.reply({
        content: `${channel} is no longer exempt.`,
        flags: "Ephemeral",
      });
    } else if (sub === "exempt-list") {
      const ids = listExempt(i.guildId);
      const list = ids.length ? ids.map((id) => `<#${id}>`).join(", ") : "None";
      await i.reply({
        content: `Exempt channels: ${list}`,
        flags: "Ephemeral",
      });
    } else if (sub === "hate-speech") {
      const enabled = i.options.getBoolean("enabled", true);
      upsertSetting(i.guildId, "hate_speech_enabled", enabled ? 1 : 0);
      await i.reply({
        content: `Hate speech filter ${enabled ? "enabled" : "disabled"}.`,
        flags: "Ephemeral",
      });
    } else if (sub === "mod-log-channel" && channel) {
      upsertSetting(i.guildId, "mod_log_channel_id", channel.id);
      await i.reply({
        content: `Moderation log channel set to ${channel}.`,
        flags: "Ephemeral",
      });
    }
  }
});

client.on(Events.MessageCreate, async (m) => {
  if (m.author.bot || !m.content || !m.inGuild()) return;
  if (isChannelExempt(m.guildId, m.channelId)) return;

  const settings = getSettings(m.guildId);
  const history = pushHistory(`${m.guildId}:${m.author.id}`, m.content);

  try {
    const { hateScore, hateLevel, spamLevel, spamScore } = await judge({
      message: m.content,
      account_created_at: m.author.createdAt.toISOString(),
      guild_joined_at: m.member?.joinedAt?.toISOString() ?? null,
      recent_messages: history.map((h) => h.content),
    });
    const pct = (p: number | null) =>
      p === null ? "n/a" : `${Math.round(p * 100)}%`;

    if (settings.hate_speech_enabled && hateLevel === "remove") {
      await m.delete();
      // recordViolation DMs the member and applies the warning/timeout ladder
      const action = m.member
        ? await recordViolation(m.member, "hate speech")
        : "None: member not found";
      await logToMod(
        m.guild,
        flaggedMessageEmbed(m, "Hate speech deleted", pct(hateScore), true).addFields({
          name: "Action",
          value: action,
        }),
      );
    } else if (spamLevel === "high_spam") {
      await m.delete();
      const action = m.member
        ? await recordViolation(m.member, "spam")
        : "None: member not found";
      await logToMod(
        m.guild,
        flaggedMessageEmbed(m, "High-confidence spam deleted", pct(spamScore), true).addFields({
          name: "Action",
          value: action,
        }),
      );
    } else if (settings.hate_speech_enabled && hateLevel === "review") {
      await logToMod(
        m.guild,
        flaggedMessageEmbed(
          m,
          "Possible hate speech: needs review, no action taken",
          pct(hateScore),
          false,
        ),
      );
    } else if (spamLevel === "medium_spam") {
      await logToMod(
        m.guild,
        flaggedMessageEmbed(
          m,
          "Possible spam: needs review, no action taken",
          pct(spamScore),
          false,
        ),
      );
    }
  } catch (e) {
    console.error("moderation failed", e); // fail open: a scan error never blocks chat
  }
});

await client.login(process.env.DISCORD_TOKEN); // bun loads .env automatically
