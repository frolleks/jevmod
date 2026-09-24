import { ApplicationCommandOptionType, type ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import * as pardon from "./pardon";
import * as ping from "./ping";
import * as report from "./report";
import * as settings from "./settings";

export const data = new SlashCommandBuilder().setName("help").setDescription("List available commands");

export async function execute(i: ChatInputCommandInteraction) {
  await i.reply({ content: helpText(), flags: "Ephemeral" });
}

function usage(command: string, options: { name: string; required?: boolean }[] = []) {
  const args = options.map((o) => (o.required ? `<${o.name}>` : `[${o.name}]`));
  return `\`/${[command, ...args].join(" ")}\``;
}

// built from the commands' own definitions, so this can't drift out of sync
function helpText() {
  const settingsJson = settings.data.toJSON();
  const lines = [
    "This bot moderates mostly on its own: every message is scanned for hate speech and spam, clear cases are removed, and borderline ones are flagged to the mods. Each removal is a violation: the first gets a warning, the second a final warning, then timeouts start at 5 minutes and double each time. Apart from `/pardon`, there are no manual mod commands — use Discord's own kick/ban/timeout for those. Anyone can `/report` a member to open a private ticket with the mods; `/settings` configures the automation.",
    "",
    ...[ping.data, report.data, pardon.data].map((c) => {
      const json = c.toJSON();
      return `${usage(json.name, json.options)} — ${json.description}`;
    }),
    "",
    `**/settings** — ${settingsJson.description}`,
  ];
  for (const sub of settingsJson.options ?? []) {
    if (sub.type !== ApplicationCommandOptionType.Subcommand) continue;
    lines.push(`${usage(`settings ${sub.name}`, sub.options)} — ${sub.description}`);
  }
  return lines.join("\n");
}
