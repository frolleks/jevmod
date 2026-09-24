import { ActivityType, Client, Events, GatewayIntentBits } from "discord.js";
import * as help from "./commands/help";
import * as pardon from "./commands/pardon";
import * as ping from "./commands/ping";
import * as report from "./commands/report";
import * as settings from "./commands/settings";
import { getSettings, isChannelExempt } from "./utils/db";
import { pushHistory } from "./utils/history";
import { judge } from "./utils/jev";
import { flaggedMessageEmbed, logToMod, recordViolation } from "./utils/moderation";

// each command module exports its definition (`data`) and its handler (`execute`)
const commands = [ping, help, report, pardon, settings];

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // privileged: enable in the Developer Portal
  ],
});

client.once(Events.ClientReady, async (c) => {
  // ponytail: global command sync on every boot; move to a deploy script if it hits rate limits
  await c.application.commands.set(commands.map((cmd) => cmd.data.toJSON()));
  console.log(`Logged in as ${c.user.tag}`);
  c.user.setPresence({
    activities: [{ name: "Watching and moderating", type: ActivityType.Watching }],
  });
});

client.on(Events.InteractionCreate, async (i) => {
  // under Bun, an error thrown out of an async listener kills the whole process
  try {
    if (i.isButton() && i.customId.startsWith("report-page:")) await report.handlePageButton(i);
    else if (i.isChatInputCommand()) await commands.find((cmd) => cmd.data.name === i.commandName)?.execute(i);
  } catch (e) {
    console.error("interaction failed", e);
  }
});

client.on(Events.MessageCreate, async (m) => {
  if (m.author.bot || !m.content || !m.inGuild()) return;
  if (isChannelExempt(m.guildId, m.channelId)) return;

  const { hate_speech_enabled } = getSettings(m.guildId);
  const history = pushHistory(`${m.guildId}:${m.author.id}`, m.content);

  try {
    const { hateScore, hateLevel, spamLevel, spamScore } = await judge({
      message: m.content,
      account_created_at: m.author.createdAt.toISOString(),
      guild_joined_at: m.member?.joinedAt?.toISOString() ?? null,
      recent_messages: history.map((h) => h.content),
    });
    const pct = (p: number | null) => (p === null ? "n/a" : `${Math.round(p * 100)}%`);

    if (hate_speech_enabled && hateLevel === "remove") {
      await m.delete();
      // recordViolation DMs the member and applies the warning/timeout ladder
      const action = m.member ? await recordViolation(m.member, "hate speech") : "None: member not found";
      await logToMod(
        m.guild,
        flaggedMessageEmbed(m, "Hate speech deleted", pct(hateScore), true).addFields({ name: "Action", value: action }),
      );
    } else if (spamLevel === "high_spam") {
      await m.delete();
      const action = m.member ? await recordViolation(m.member, "spam") : "None: member not found";
      await logToMod(
        m.guild,
        flaggedMessageEmbed(m, "High-confidence spam deleted", pct(spamScore), true).addFields({
          name: "Action",
          value: action,
        }),
      );
    } else if (hate_speech_enabled && hateLevel === "review") {
      await logToMod(
        m.guild,
        flaggedMessageEmbed(m, "Possible hate speech: needs review, no action taken", pct(hateScore), false),
      );
    } else if (spamLevel === "medium_spam") {
      await logToMod(m.guild, flaggedMessageEmbed(m, "Possible spam: needs review, no action taken", pct(spamScore), false));
    }
  } catch (e) {
    console.error("moderation failed", e); // fail open: a scan error never blocks chat
  }
});

await client.login(process.env.DISCORD_TOKEN); // bun loads .env automatically
