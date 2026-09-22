import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

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
      .setDescription("Set the channel spam flags are logged to")
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
