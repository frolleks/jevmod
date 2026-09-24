import { type ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";

export const data = new SlashCommandBuilder().setName("ping").setDescription("Pong");

export async function execute(i: ChatInputCommandInteraction) {
  await i.reply("Pong");
}
