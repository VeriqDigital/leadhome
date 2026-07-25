import { describe, expect, it } from "vitest";
import { inboundLeadSchema } from "@/lib/inbound-validation";
import { leadSchema } from "@/lib/validation";

describe("lead validation boundaries", () => {
  it("normalizes optional form text and empty form values", () => {
    const result = leadSchema.parse({
      name: "  Jane Doe  ",
      email: "",
      phone: "  ",
      company: "  Acme  ",
      source: "MANUAL",
      status: "NEW",
      message: "",
      estimatedValue: "",
      nextFollowUpDate: "",
    });

    expect(result).toMatchObject({
      name: "Jane Doe",
      email: null,
      phone: null,
      company: "Acme",
      message: null,
      estimatedValue: null,
      nextFollowUpDate: null,
    });
  });

  it("keeps date-only form input on the selected local calendar date", () => {
    const result = leadSchema.parse({
      name: "Jane",
      email: "",
      phone: "",
      company: "",
      source: "MANUAL",
      status: "NEW",
      message: "",
      estimatedValue: "",
      nextFollowUpDate: "2026-07-24",
    });

    expect(result.nextFollowUpDate?.getHours()).toBe(12);
    expect(result.nextFollowUpDate?.getFullYear()).toBe(2026);
    expect(result.nextFollowUpDate?.getMonth()).toBe(6);
    expect(result.nextFollowUpDate?.getDate()).toBe(24);
  });

  it("accepts numeric inbound values but rejects HTML-style numeric strings", () => {
    expect(
      inboundLeadSchema.safeParse({ name: "Jane", estimatedValue: 2500 })
        .success,
    ).toBe(true);
    expect(
      inboundLeadSchema.safeParse({ name: "Jane", estimatedValue: "2500" })
        .success,
    ).toBe(false);
  });
});
