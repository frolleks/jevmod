import { Database } from "bun:sqlite";
import {
  ActivityType,
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import { OpenRouter } from "@openrouter/sdk";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // privileged: enable in the Developer Portal
  ],
});
const openrouter = new OpenRouter({ apiKey: process.env.OPENROUTER_API_KEY });

const HATE_THRESHOLD = 0.8;

const db = new Database("bot.sqlite");
db.run(
  "CREATE TABLE IF NOT EXISTS exempt_channels (guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, PRIMARY KEY (guild_id, channel_id))",
);
const isExempt = db.query(
  "SELECT 1 FROM exempt_channels WHERE guild_id = ? AND channel_id = ?",
);

const settingsCommand = new SlashCommandBuilder()
  .setName("settings")
  .setDescription("Configure the moderation bot")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((sc) =>
    sc
      .setName("exempt-add")
      .setDescription("Stop scanning a channel for hate speech")
      .addChannelOption((o) =>
        o
          .setName("channel")
          .setDescription("Channel to exempt")
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true),
      ),
  )
  .addSubcommand((sc) =>
    sc
      .setName("exempt-remove")
      .setDescription("Resume scanning a channel")
      .addChannelOption((o) =>
        o
          .setName("channel")
          .setDescription("Channel to un-exempt")
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true),
      ),
  )
  .addSubcommand((sc) =>
    sc.setName("exempt-list").setDescription("List channels exempt from scanning"),
  );

async function isHateSpeech(text: string) {
  const { answers } = await openrouter.alpha.decisions.create({
    decisionsRequest: {
      model: "typesafe/jev-1.13",
      state: text,
      questions: {
        is_hate_speech: {
          type: "noul",
          instructions: "Is this message hate speech?",
          criteria: {
            true: "Attacks or demeans people for race, religion, ethnicity, gender, sexuality, disability or similar",
            false: "No hate speech",
          },
        },
      },
    },
  });
  const a = answers.is_hate_speech;
  return a?.type === "noul" && a.noul > HATE_THRESHOLD;
}

client.once(Events.ClientReady, async (c) => {
  // ponytail: global command sync on every boot; move to a deploy script if it hits rate limits
  await c.application.commands.set([{ name: "ping", description: "Pong" }, settingsCommand.toJSON()]);
  console.log(`Logged in as ${c.user.tag}`);

  c.user.setPresence({
    activities: [
      {
        name: "Watching and moderating",
        type: ActivityType.Watching,
      },
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
      db.run("INSERT OR IGNORE INTO exempt_channels VALUES (?, ?)", [i.guildId, channel.id]);
      await i.reply({ content: `${channel} is now exempt from scanning.`, ephemeral: true });
    } else if (sub === "exempt-remove" && channel) {
      db.run("DELETE FROM exempt_channels WHERE guild_id = ? AND channel_id = ?", [i.guildId, channel.id]);
      await i.reply({ content: `${channel} is no longer exempt.`, ephemeral: true });
    } else if (sub === "exempt-list") {
      const rows = db
        .query("SELECT channel_id FROM exempt_channels WHERE guild_id = ?")
        .all(i.guildId) as { channel_id: string }[];
      const list = rows.length ? rows.map((r) => `<#${r.channel_id}>`).join(", ") : "None";
      await i.reply({ content: `Exempt channels: ${list}`, ephemeral: true });
    }
  }
});

client.on(Events.MessageCreate, async (m) => {
  if (m.author.bot || !m.content || !m.inGuild()) return;
  if (isExempt.get(m.guildId, m.channelId)) return;
  try {
    if (!(await isHateSpeech(m.content))) return;
    await m.delete();
    await m.author
      .send("Your message was removed because it was flagged as hate speech.")
      .catch(() => {}); // DMs may be closed
  } catch (e) {
    console.error("moderation failed", e); // fail open: a scan error never blocks chat
  }
});

await client.login(process.env.DISCORD_TOKEN); // bun loads .env automatically
