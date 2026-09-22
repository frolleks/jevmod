import { ActivityType, Client, Events, GatewayIntentBits } from "discord.js";
import {
  addExempt,
  getSettings,
  isChannelExempt,
  listExempt,
  removeExempt,
  setTimeoutConfig,
  upsertSetting,
} from "./utils/db";
import { settingsCommand } from "./utils/commands";
import { judge } from "./utils/jev";
import { pushHistory } from "./utils/history";
import { logToMod, recordViolation } from "./utils/moderation";

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
  if (!i.isChatInputCommand()) return;

  if (i.commandName === "ping") return void (await i.reply("Pong"));

  if (i.commandName === "settings" && i.inGuild()) {
    const channel = i.options.getChannel("channel");
    const sub = i.options.getSubcommand();
    if (sub === "exempt-add" && channel) {
      addExempt(i.guildId, channel.id);
      await i.reply({
        content: `${channel} is now exempt from scanning.`,
        ephemeral: true,
      });
    } else if (sub === "exempt-remove" && channel) {
      removeExempt(i.guildId, channel.id);
      await i.reply({
        content: `${channel} is no longer exempt.`,
        ephemeral: true,
      });
    } else if (sub === "exempt-list") {
      const ids = listExempt(i.guildId);
      const list = ids.length ? ids.map((id) => `<#${id}>`).join(", ") : "None";
      await i.reply({ content: `Exempt channels: ${list}`, ephemeral: true });
    } else if (sub === "hate-speech") {
      const enabled = i.options.getBoolean("enabled", true);
      upsertSetting(i.guildId, "hate_speech_enabled", enabled ? 1 : 0);
      await i.reply({
        content: `Hate speech filter ${enabled ? "enabled" : "disabled"}.`,
        ephemeral: true,
      });
    } else if (sub === "mod-log-channel" && channel) {
      upsertSetting(i.guildId, "mod_log_channel_id", channel.id);
      await i.reply({
        content: `Moderation log channel set to ${channel}.`,
        ephemeral: true,
      });
    } else if (sub === "timeout-config") {
      const threshold = i.options.getInteger("threshold", true);
      const minutes = i.options.getInteger("minutes", true);
      setTimeoutConfig(i.guildId, threshold, minutes);
      await i.reply({
        content: `Auto-timeout: ${threshold} violations → ${minutes}m timeout.`,
        ephemeral: true,
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
    const { isHate, spamLevel } = await judge({
      message: m.content,
      account_created_at: m.author.createdAt.toISOString(),
      guild_joined_at: m.member?.joinedAt?.toISOString() ?? null,
      recent_messages: history.map((h) => h.content),
    });

    if (settings.hate_speech_enabled && isHate) {
      await m.delete();
      await m.author
        .send("Your message was removed because it was flagged as hate speech.")
        .catch(() => {}); // DMs may be closed
      if (m.member) await recordViolation(m.member, "hate speech");
    } else if (spamLevel === "high_spam") {
      await m.delete();
      await m.author
        .send("Your message was removed because it was flagged as spam.")
        .catch(() => {});
      await logToMod(
        m.guild,
        `High-confidence spam deleted from ${m.author} in ${m.channel}: ${m.content}`,
      );
      if (m.member) await recordViolation(m.member, "spam");
    } else if (spamLevel === "medium_spam") {
      await logToMod(
        m.guild,
        `Possible spam from ${m.author} in ${m.channel}: ${m.content}`,
      );
    }
  } catch (e) {
    console.error("moderation failed", e); // fail open: a scan error never blocks chat
  }
});

await client.login(process.env.DISCORD_TOKEN); // bun loads .env automatically
