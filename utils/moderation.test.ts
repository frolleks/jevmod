import { expect, test } from "bun:test";
import type { GuildMember } from "discord.js";
import { recordViolation, timeoutMinutes } from "./moderation";

test("timeouts double from 5m and stop at Discord's 28-day max", () => {
  expect([1, 2, 3, 4, 5, 6].map((n) => timeoutMinutes(n))).toEqual([
    0, 0, 5, 10, 20, 40,
  ]);
  expect(timeoutMinutes(15)).toBe(20_480);
  expect(timeoutMinutes(16)).toBe(40_320); // 40,960 would exceed the cap
  expect(timeoutMinutes(10_000)).toBe(40_320);
});

test("recordViolation walks the ladder: warning, final warning, then growing timeouts", async () => {
  const timeouts: number[] = [];
  const dms: string[] = [];
  const member = {
    id: "ladder-user",
    guild: { id: "ladder-guild", name: "Test Server" },
    timeout: async (ms: number) => void timeouts.push(ms),
    send: async (text: string) => void dms.push(text),
  } as unknown as GuildMember;

  expect(await recordViolation(member, "spam")).toBe("Warning (violation 1)");
  expect(await recordViolation(member, "spam")).toBe(
    "Final warning (violation 2)",
  );
  expect(await recordViolation(member, "spam")).toStartWith(
    "Timed out until <t:",
  );
  expect(await recordViolation(member, "spam")).toEndWith("(violation 4)");

  expect(timeouts).toEqual([5 * 60_000, 10 * 60_000]);
  expect(dms[0]).toBe(
    "Your message in **Test Server** was removed because it was flagged as spam. This is a warning.",
  );
  expect(dms[1]).toContain("final warning");
  expect(dms[2]).toContain("timed out until <t:");
});
