import { expect, test } from "bun:test";
import { decrementViolations, incrementViolations } from "./db";

test("decrementViolations removes the latest violation and never goes below zero", () => {
  expect(decrementViolations("guild", "unknown")).toBeNull();

  incrementViolations("guild", "user");
  incrementViolations("guild", "user");
  expect(decrementViolations("guild", "user")).toBe(1);
  expect(decrementViolations("guild", "user")).toBe(0);
  expect(decrementViolations("guild", "user")).toBeNull();
});
