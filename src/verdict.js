// Turns a classification plus the user's settings into what a card should
// say and whether it should be filtered. Pure — no DOM, no extension APIs —
// so the wording and the hide rule are both unit-testable, and content.js is
// left with nothing but rendering.

const LLM_MARK = "✦";

export const PENDING_BADGE = { label: "checking…", tone: "pending" };

export function experienceBadge(field) {
  if (!field) return null;
  if (field.status === "matched") {
    return { label: `${field.min}+ yrs`, tone: "info", viaLlm: field.resolvedBy === "llm" };
  }
  if (field.status === "ambiguous") return { label: "yrs unclear", tone: "muted" };
  return { label: "yrs not stated", tone: "muted" };
}

// Most postings say nothing at all about sponsorship, so a "not stated" badge
// would appear on almost every card and carry no information. This one is
// omitted unless the posting actually takes a position.
export function sponsorshipBadge(field) {
  if (!field) return null;
  if (field.status === "matched") {
    return field.sponsors === false
      ? { label: "no sponsorship", tone: "warn", viaLlm: field.resolvedBy === "llm" }
      : { label: "sponsors visas", tone: "good", viaLlm: field.resolvedBy === "llm" };
  }
  if (field.status === "ambiguous") return { label: "sponsorship unclear", tone: "muted" };
  return null;
}

// A card with no classification yet is queued for a description lookup, which
// is a different thing from a card we looked at and learned nothing about.
// Saying so is the whole point of the badges.
export function badgesFor(classification) {
  if (!classification) return [PENDING_BADGE];
  return [
    experienceBadge(classification.experience),
    sponsorshipBadge(classification.sponsorship),
  ].filter(Boolean);
}

export function badgeText(badge) {
  return badge.viaLlm ? `${badge.label} ${LLM_MARK}` : badge.label;
}

// The single source of truth for filtering: every reason this job fails the
// user's criteria, phrased for the collapsed stub. An empty array means show
// it. shouldHide is derived from this rather than duplicating the conditions,
// so the explanation can never drift from the decision.
export function hideReasons(classification, settings) {
  if (!classification) return [];
  const { experience, sponsorship } = classification;
  const reasons = [];

  if (
    settings.minYearsExperience > 0 &&
    experience?.status === "matched" &&
    experience.min > settings.minYearsExperience
  ) {
    reasons.push(`asks for ${experience.min}+ years`);
  }

  if (
    settings.excludeNoSponsorship &&
    sponsorship?.status === "matched" &&
    sponsorship.sponsors === false
  ) {
    reasons.push("states no sponsorship");
  }

  return reasons;
}

export function shouldHide(classification, settings) {
  return hideReasons(classification, settings).length > 0;
}
