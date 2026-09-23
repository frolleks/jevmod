import { expect, test } from "bun:test";
import { Collection, SnowflakeUtil, type TextChannel } from "discord.js";
import { fetchChannelMessages, parseRange, transcriptPage } from "./reports";

test("parseRange validates dates and makes `to` inclusive", () => {
  expect(parseRange("2026-09-01", "2026-09-01")).toEqual({
    start: Date.UTC(2026, 8, 1),
    end: Date.UTC(2026, 8, 2),
  });
  expect(parseRange("2026-02-31", null)).toBeTypeOf("string"); // Date would roll this into March
  expect(parseRange("09/01/2026", null)).toBeTypeOf("string");
  expect(parseRange("2026-09-02", "2026-09-01")).toBeTypeOf("string");
});

test("fetchChannelMessages pages through the range and keeps only the user's messages", async () => {
  // 500 messages one minute apart, alternating between two authors
  const t0 = Date.UTC(2026, 8, 1);
  const all = Array.from({ length: 500 }, (_, n) => ({
    id: SnowflakeUtil.generate({ timestamp: t0 + n * 60_000 }).toString(),
    author: { id: n % 2 ? "bob" : "alice" },
    createdTimestamp: t0 + n * 60_000,
    content: `msg ${n}`,
  }));
  const channel = {
    messages: {
      // mimics Discord: the `limit` messages right after `after`, newest first
      fetch: async ({ after, limit }: { after: string; limit: number }) =>
        new Collection(
          all
            .filter((m) => BigInt(m.id) > BigInt(after))
            .slice(0, limit)
            .reverse()
            .map((m) => [m.id, m]),
        ),
    },
  } as unknown as TextChannel;

  // minutes [100, 350): 250 messages, 125 of them alice's, spanning 3 pages
  const found = await fetchChannelMessages(channel, "alice", t0 + 100 * 60_000, t0 + 350 * 60_000);
  expect(found.length).toBe(125);
  expect(found.every((m) => m.author.id === "alice")).toBe(true);
  expect(Math.min(...found.map((m) => m.createdTimestamp))).toBe(t0 + 100 * 60_000);
  expect(Math.max(...found.map((m) => m.createdTimestamp))).toBe(t0 + 348 * 60_000);
});

test("transcriptPage shows 10 per page, clamps the page, and fits Discord's embed limits", () => {
  // worst case: max-length messages and 19-digit snowflakes everywhere
  const id = "1".repeat(19);
  const entries = Array.from({ length: 25 }, () => ({
    content: "x".repeat(2000),
    at: Date.UTC(2026, 8, 1),
    url: `https://discord.com/channels/${id}/${id}/${id}`,
    channelId: id,
  }));

  const first = transcriptPage(entries, 0);
  const embed = first.embeds[0]!.toJSON();
  expect(embed.fields).toHaveLength(10);
  expect(JSON.stringify(embed).length).toBeLessThan(6000); // stringified JSON overcounts, so the real size is smaller
  expect(embed.fields!.every((f) => f.value.length <= 1024)).toBe(true);

  const last = transcriptPage(entries, 99); // past the end clamps to page 3
  expect(last.embeds[0]!.toJSON().fields).toHaveLength(5);
  expect(last.embeds[0]!.toJSON().footer?.text).toStartWith("Page 3/3");
  const [prev, next] = last.components[0]!.toJSON().components as { disabled?: boolean }[];
  expect(prev!.disabled).toBe(false);
  expect(next!.disabled).toBe(true);

  expect(transcriptPage(entries, Number.NaN).embeds[0]!.toJSON().footer?.text).toStartWith("Page 1/3");
});
