import {
  ActivityType,
  Client,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits,
} from "discord.js";
import {
  addExempt,
  getSettings,
  getTranscript,
  isChannelExempt,
  listExempt,
  removeExempt,
  saveTranscript,
  setTimeoutConfig,
  upsertSetting,
} from "./utils/db";
import {
  buildHelpText,
  helpCommand,
  reportCommand,
  settingsCommand,
} from "./utils/commands";
import { judge, scoreHateSpeech } from "./utils/jev";
import { pushHistory } from "./utils/history";
import { logToMod, recordViolation } from "./utils/moderation";
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
    await logToMod(i.guild, `New report ticket: ${ticket}`);

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
    } else if (sub === "timeout-config") {
      const threshold = i.options.getInteger("threshold", true);
      const minutes = i.options.getInteger("minutes", true);
      setTimeoutConfig(i.guildId, threshold, minutes);
      await i.reply({
        content: `Auto-timeout: ${threshold} violations → ${minutes}m timeout.`,
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
      await m.author
        .send("Your message was removed because it was flagged as hate speech.")
        .catch(() => {}); // DMs may be closed
      await logToMod(
        m.guild,
        `Deleted hate speech (Jev confidence ${pct(hateScore)}) from ${m.author} in ${m.channel}:\n${m.content}`,
      );
      if (m.member) await recordViolation(m.member, "hate speech");
    } else if (spamLevel === "high_spam") {
      await m.delete();
      await m.author
        .send("Your message was removed because it was flagged as spam.")
        .catch(() => {});
      await logToMod(
        m.guild,
        `Deleted high-confidence spam (Jev confidence ${pct(spamScore)}) from ${m.author} in ${m.channel}:\n${m.content}`,
      );
      if (m.member) await recordViolation(m.member, "spam");
    } else if (settings.hate_speech_enabled && hateLevel === "review") {
      await logToMod(
        m.guild,
        `Needs review, no action taken: possible hate speech (Jev confidence ${pct(hateScore)}) from ${m.author} in ${m.channel} ${m.url}\n${m.content}`,
      );
    } else if (spamLevel === "medium_spam") {
      await logToMod(
        m.guild,
        `Needs review, no action taken: possible spam (Jev confidence ${pct(spamScore)}) from ${m.author} in ${m.channel} ${m.url}\n${m.content}`,
      );
    }
  } catch (e) {
    console.error("moderation failed", e); // fail open: a scan error never blocks chat
  }
});

await client.login(process.env.DISCORD_TOKEN); // bun loads .env automatically
