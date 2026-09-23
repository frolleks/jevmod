import {
  ApplicationCommandOptionType,
  ChannelType,
  InteractionContextType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";

export const settingsCommand = new SlashCommandBuilder()
  .setName("settings")
  .setDescription("Configure the moderation bot")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((sc) =>
    sc
      .setName("exempt-add")
      .setDescription("Stop scanning a channel")
      .addChannelOption((o) =>
        o.setName("channel").setDescription("Channel to exempt").addChannelTypes(ChannelType.GuildText).setRequired(true),
      ),
  )
  .addSubcommand((sc) =>
    sc
      .setName("exempt-remove")
      .setDescription("Resume scanning a channel")
      .addChannelOption((o) =>
        o.setName("channel").setDescription("Channel to un-exempt").addChannelTypes(ChannelType.GuildText).setRequired(true),
      ),
  )
  .addSubcommand((sc) => sc.setName("exempt-list").setDescription("List channels exempt from scanning"))
  .addSubcommand((sc) =>
    sc
      .setName("hate-speech")
      .setDescription("Toggle the hate speech filter")
      .addBooleanOption((o) => o.setName("enabled").setDescription("Enable filtering").setRequired(true)),
  )
  .addSubcommand((sc) =>
    sc
      .setName("mod-log-channel")
      .setDescription("Set the channel that mod flags, auto-timeouts and new reports are logged to")
      .addChannelOption((o) =>
        o.setName("channel").setDescription("Log channel").addChannelTypes(ChannelType.GuildText).setRequired(true),
      ),
  )
  .addSubcommand((sc) =>
    sc
      .setName("timeout-config")
      .setDescription("Configure auto-timeout for repeated violations")
      .addIntegerOption((o) => o.setName("threshold").setDescription("Violations before timeout").setMinValue(1).setRequired(true))
      .addIntegerOption((o) => o.setName("minutes").setDescription("Timeout duration in minutes").setMinValue(1).setRequired(true)),
  );

export const reportCommand = new SlashCommandBuilder()
  .setName("report")
  .setDescription("Report a member breaking the rules; opens a private ticket with the mods")
  .setContexts(InteractionContextType.Guild)
  .addUserOption((o) => o.setName("user").setDescription("Who to report").setRequired(true))
  .addStringOption((o) =>
    o
      .setName("type")
      .setDescription("What they did")
      .addChoices({ name: "Hate speech", value: "hate_speech" })
      .setRequired(true),
  )
  .addStringOption((o) =>
    o.setName("from").setDescription("Check their messages from this date (YYYY-MM-DD, UTC)").setRequired(true),
  )
  .addStringOption((o) =>
    o.setName("to").setDescription("Up to and including this date (YYYY-MM-DD, UTC); defaults to now").setRequired(false),
  );

export const helpCommand = new SlashCommandBuilder().setName("help").setDescription("List available commands");

function usage(command: string, options: { name: string; required?: boolean }[] = []) {
  const args = options.map((o) => (o.required ? `<${o.name}>` : `[${o.name}]`));
  return `\`/${[command, ...args].join(" ")}\``;
}

// built from the commands' own definitions, so this can't drift out of sync
export function buildHelpText(): string {
  const report = reportCommand.toJSON();
  const settings = settingsCommand.toJSON();
  const lines = [
    "This bot moderates mostly on its own: every message is scanned for hate speech and spam, clear cases are removed, borderline ones are flagged to the mods, and repeat violators are timed out automatically. There are no manual mod commands — use Discord's own kick/ban/timeout for that. Anyone can `/report` a member to open a private ticket with the mods; `/settings` configures the automation.",
    "",
    "**/ping** — Pong",
    `${usage(report.name, report.options)} — ${report.description}`,
    "",
    `**/settings** — ${settings.description}`,
  ];
  for (const sub of settings.options ?? []) {
    if (sub.type !== ApplicationCommandOptionType.Subcommand) continue;
    lines.push(`${usage(`settings ${sub.name}`, sub.options)} — ${sub.description}`);
  }
  return lines.join("\n");
}
