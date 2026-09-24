import {
  ActionRowBuilder,
  ButtonBuilder,
  type ButtonInteraction,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  type Guild,
  type GuildMember,
  type Message,
  OverwriteType,
  PermissionFlagsBits,
  SnowflakeUtil,
  type TextChannel,
} from "discord.js";
import { addExempt, getTranscript, isChannelExempt } from "./db";

const DAY_MS = 86_400_000;
const MAX_PAGES_PER_CHANNEL = 10; // 100 messages per page
// ponytail: newest 100 messages only; raise if Jev needs more context and the request size allows it
const MAX_MESSAGES = 100;
const COOLDOWN_MS = 5 * 60_000;

// "YYYY-MM-DD" (UTC) -> Date; the round-trip rejects days like 2026-02-31 that Date silently rolls over
export function parseDay(s: string): Date | null {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
    ? d
    : null;
}
// the inverse: ms -> "YYYY-MM-DD" (UTC)
export const formatDay = (ms: number) =>
  new Date(ms).toISOString().slice(0, 10);

// returns [start, end) in ms, or an error message for the user; `to` covers that whole day, omitted means now
export function parseRange(
  from: string,
  to: string | null,
): { start: number; end: number } | string {
  const start = parseDay(from);
  const toDay = to === null ? null : parseDay(to);
  if (!start || (to !== null && !toDay))
    return "Dates must be in YYYY-MM-DD format.";
  const end = toDay ? toDay.getTime() + DAY_MS : Date.now();
  if (start.getTime() >= end)
    return "The start date must be before the end date.";
  return { start: start.getTime(), end };
}

export async function fetchChannelMessages(
  channel: Pick<TextChannel, "messages">,
  userId: string,
  start: number,
  end: number,
) {
  const found: Message[] = [];
  let after = SnowflakeUtil.generate({ timestamp: start - 1 }).toString();
  for (let page = 0; page < MAX_PAGES_PER_CHANNEL; page++) {
    const batch = await channel.messages.fetch({ after, limit: 100 });
    if (!batch.size) break;
    for (const m of batch.values()) {
      if (m.author.id === userId && m.createdTimestamp < end && m.content)
        found.push(m);
    }
    const newest = batch.reduce((a, m) =>
      m.createdTimestamp > a.createdTimestamp ? m : a,
    );
    if (newest.createdTimestamp >= end || batch.size < 100) break;
    after = newest.id;
  }
  return found;
}

// the reported user's messages across every text channel the reporter can see, oldest first
export async function fetchUserMessages(
  guild: Guild,
  reporter: GuildMember,
  userId: string,
  start: number,
  end: number,
) {
  const me = await guild.members.fetchMe();
  const channels = guild.channels.cache.filter(
    (c): c is TextChannel =>
      c.type === ChannelType.GuildText &&
      !isChannelExempt(guild.id, c.id) &&
      c
        .permissionsFor(me)
        .has([
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.ReadMessageHistory,
        ]) &&
      c.permissionsFor(reporter).has(PermissionFlagsBits.ViewChannel), // never score content the reporter couldn't see
  );
  const perChannel = await Promise.all(
    channels.map((c) =>
      fetchChannelMessages(c, userId, start, end).catch(() => []),
    ),
  );
  return perChannel
    .flat()
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
    .slice(-MAX_MESSAGES);
}

// private channel: hidden from @everyone, open to the bot, the reporter, and every role with Moderate Members (admins included)
// ponytail: "mods" = roles with Moderate Members; add a /settings mod-role if servers need finer control
export async function createTicket(
  guild: Guild,
  reporter: GuildMember,
  name: string,
) {
  const access = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ReadMessageHistory,
  ];
  const modRoles = guild.roles.cache.filter(
    (r) =>
      r.id !== guild.id &&
      r.permissions.has(PermissionFlagsBits.ModerateMembers),
  );
  const ticket = await guild.channels.create({
    name,
    type: ChannelType.GuildText,
    permissionOverwrites: [
      {
        id: guild.id,
        type: OverwriteType.Role,
        deny: [PermissionFlagsBits.ViewChannel],
      },
      { id: guild.client.user.id, type: OverwriteType.Member, allow: access },
      { id: reporter.id, type: OverwriteType.Member, allow: access },
      ...modRoles.map((r) => ({
        id: r.id,
        type: OverwriteType.Role,
        allow: access,
      })),
    ],
  });
  addExempt(guild.id, ticket.id); // so quoting the reported message in the ticket doesn't trip the filter
  return ticket;
}

export type TranscriptEntry = {
  content: string;
  at: number;
  url: string;
  channelId: string;
};

const PAGE_SIZE = 10;
const PREVIEW_CHARS = 350; // keeps 10 fields under Discord's 6000-char embed limit

export function toTranscript(messages: Message[]): TranscriptEntry[] {
  return messages.map((m) => ({
    content: m.content,
    at: m.createdTimestamp,
    url: m.url,
    channelId: m.channelId,
  }));
}

// one page of the transcript as a message payload; Previous/Next buttons carry the target page in their customId
export function transcriptPage(entries: TranscriptEntry[], page: number) {
  const pages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  page = Math.min(Math.max(page || 0, 0), pages - 1); // `|| 0` catches NaN from a malformed customId
  const embed = new EmbedBuilder()
    .setTitle("Message history")
    .setFooter({
      text: `Page ${page + 1}/${pages} · ${entries.length} messages`,
    })
    .addFields(
      entries.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((e, n) => ({
        name: `#${page * PAGE_SIZE + n + 1}`,
        value: `<t:${Math.floor(e.at / 1000)}:f> in <#${e.channelId}> · [jump](${e.url})\n${
          e.content.length > PREVIEW_CHARS
            ? `${e.content.slice(0, PREVIEW_CHARS)}…`
            : e.content
        }`,
      })),
    );
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`report-page:${page - 1}`)
      .setLabel("Previous")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === 0),
    new ButtonBuilder()
      .setCustomId(`report-page:${page + 1}`)
      .setLabel("Next")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === pages - 1),
  );
  return { embeds: [embed], components: [row] };
}

// Previous/Next on a transcript embed; the customId carries the target page.
// /profile stores transcripts under the reply message, /report under the ticket channel
export async function handlePageButton(i: ButtonInteraction) {
  const entries = getTranscript(i.message.id) ?? getTranscript(i.channelId);
  if (!entries)
    return void (await i.reply({
      content: "This transcript is no longer available.",
      flags: "Ephemeral",
    }));
  await i.update(transcriptPage(entries, Number(i.customId.split(":")[1])));
}

// ponytail: in-memory per-user cooldown, resets on restart
const lastReport = new Map<string, number>();
export function onCooldown(key: string) {
  const now = Date.now();
  if (now - (lastReport.get(key) ?? 0) < COOLDOWN_MS) return true;
  lastReport.set(key, now);
  return false;
}
