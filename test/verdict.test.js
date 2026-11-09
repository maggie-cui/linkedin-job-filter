import { describe, expect, it } from "vitest";
import {
  badgeText,
  badgesFor,
  experienceBadge,
  hideReasons,
  shouldHide,
  sponsorshipBadge,
} from "../src/verdict.js";

const settings = (over = {}) => ({
  minYearsExperience: 0,
  excludeNoSponsorship: false,
  ...over,
});

describe("experienceBadge", () => {
  it("shows the number when one was matched", () => {
    expect(experienceBadge({ status: "matched", min: 5 })).toMatchObject({
      label: "5+ yrs",
      tone: "info",
    });
  });

  it("distinguishes ambiguous from nothing stated", () => {
    expect(experienceBadge({ status: "ambiguous", min: 5 }).label).toBe("yrs unclear");
    expect(experienceBadge({ status: "no-mention" }).label).toBe("yrs not stated");
  });

  it("marks a verdict the model resolved", () => {
    const badge = experienceBadge({ status: "matched", min: 3, resolvedBy: "llm" });
    expect(badge.viaLlm).toBe(true);
    expect(badgeText(badge)).toBe("3+ yrs ✦");
  });
});

describe("sponsorshipBadge", () => {
  it("flags a refusal to sponsor", () => {
    expect(sponsorshipBadge({ status: "matched", sponsors: false })).toMatchObject({
      label: "no sponsorship",
      tone: "warn",
    });
  });

  it("flags an employer that will sponsor", () => {
    expect(sponsorshipBadge({ status: "matched", sponsors: true }).tone).toBe("good");
  });

  // Almost every posting is silent on sponsorship, so a badge saying so would
  // appear everywhere and mean nothing.
  it("stays silent when the posting is silent", () => {
    expect(sponsorshipBadge({ status: "no-mention" })).toBeNull();
  });
});

describe("badgesFor", () => {
  it("reports a card that has not been classified yet as pending", () => {
    expect(badgesFor(null).map((b) => b.label)).toEqual(["checking…"]);
  });

  it("omits the sponsorship chip but keeps the experience one", () => {
    const labels = badgesFor({
      experience: { status: "matched", min: 2 },
      sponsorship: { status: "no-mention" },
    }).map((b) => b.label);
    expect(labels).toEqual(["2+ yrs"]);
  });
});

describe("hideReasons", () => {
  it("is empty when no filter is set, however the job reads", () => {
    const classification = {
      experience: { status: "matched", min: 10 },
      sponsorship: { status: "matched", sponsors: false },
    };
    expect(hideReasons(classification, settings())).toEqual([]);
  });

  it("keeps a job asking for exactly the threshold", () => {
    const classification = {
      experience: { status: "matched", min: 3 },
      sponsorship: { status: "no-mention" },
    };
    expect(shouldHide(classification, settings({ minYearsExperience: 3 }))).toBe(false);
  });

  it("filters a job asking for more than the threshold, and says why", () => {
    const classification = {
      experience: { status: "matched", min: 4 },
      sponsorship: { status: "no-mention" },
    };
    expect(hideReasons(classification, settings({ minYearsExperience: 3 }))).toEqual([
      "asks for 4+ years",
    ]);
  });

  it("never filters on an unresolved field", () => {
    const classification = {
      experience: { status: "ambiguous", min: 9 },
      sponsorship: { status: "ambiguous" },
    };
    const both = settings({ minYearsExperience: 1, excludeNoSponsorship: true });
    expect(hideReasons(classification, both)).toEqual([]);
  });

  it("reports both reasons when both apply", () => {
    const classification = {
      experience: { status: "matched", min: 8 },
      sponsorship: { status: "matched", sponsors: false },
    };
    const both = settings({ minYearsExperience: 3, excludeNoSponsorship: true });
    expect(hideReasons(classification, both)).toEqual([
      "asks for 8+ years",
      "states no sponsorship",
    ]);
  });

  it("treats an unclassified card as not filtered", () => {
    expect(hideReasons(null, settings({ minYearsExperience: 1 }))).toEqual([]);
  });
});
