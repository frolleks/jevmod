import { ChannelType, type ChatInputCommandInteraction, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { addExempt, listExempt, removeExempt, upsertSetting } from "../utils/db";

export const data = new SlashCommandBuilder()
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
      .setDescription("Set the channel that mod flags, warnings, timeouts and new reports are logged to")
      .addChannelOption((o) =>
        o.setName("channel").setDescription("Log channel").addChannelTypes(ChannelType.GuildText).setRequired(true),
      ),
  );

export async function execute(i: ChatInputCommandInteraction) {
  if (!i.inGuild()) return;
  const channel = i.options.getChannel("channel");
  const sub = i.options.getSubcommand();
  if (sub === "exempt-add" && channel) {
    addExempt(i.guildId, channel.id);
    await i.reply({ content: `${channel} is now exempt from scanning.`, flags: "Ephemeral" });
  } else if (sub === "exempt-remove" && channel) {
    removeExempt(i.guildId, channel.id);
    await i.reply({ content: `${channel} is no longer exempt.`, flags: "Ephemeral" });
  } else if (sub === "exempt-list") {
    const ids = listExempt(i.guildId);
    const list = ids.length ? ids.map((id) => `<#${id}>`).join(", ") : "None";
    await i.reply({ content: `Exempt channels: ${list}`, flags: "Ephemeral" });
  } else if (sub === "hate-speech") {
    const enabled = i.options.getBoolean("enabled", true);
    upsertSetting(i.guildId, "hate_speech_enabled", enabled ? 1 : 0);
    await i.reply({ content: `Hate speech filter ${enabled ? "enabled" : "disabled"}.`, flags: "Ephemeral" });
  } else if (sub === "mod-log-channel" && channel) {
    upsertSetting(i.guildId, "mod_log_channel_id", channel.id);
    await i.reply({ content: `Moderation log channel set to ${channel}.`, flags: "Ephemeral" });
  }
}
