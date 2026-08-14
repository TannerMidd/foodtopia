import { FOOD_CONCEPTS, type FoodConcept } from "./concepts";

export function normalizeFoodLabel(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/&/g, " and ")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const aliasesByNormalizedLabel = (() => {
  const aliases = new Map<string, FoodConcept>();

  for (const concept of FOOD_CONCEPTS) {
    for (const label of [concept.id, concept.name, ...concept.aliases]) {
      const normalized = normalizeFoodLabel(label);
      const existing = aliases.get(normalized);

      if (existing && existing.id !== concept.id) {
        throw new Error(
          `Food alias "${normalized}" belongs to both ${existing.id} and ${concept.id}`,
        );
      }

      aliases.set(normalized, concept);
    }
  }

  return aliases;
})();

export function resolveFoodConcept(value: string): FoodConcept | undefined {
  return aliasesByNormalizedLabel.get(normalizeFoodLabel(value));
}

export type FoodIdentity = Readonly<{
  foodConceptId: string | null;
  category: string;
}>;

/** Resolves only an exact normalized concept name or alias; never guesses. */
export function resolveFoodIdentity(value: string): FoodIdentity {
  const concept = resolveFoodConcept(value);
  return {
    foodConceptId: concept?.id ?? null,
    category: concept?.category ?? "Other",
  };
}

export function isKnownFoodConceptId(value: string): boolean {
  return FOOD_CONCEPTS.some((concept) => concept.id === value);
}

export type FoodConceptMention = Readonly<{
  concept: FoodConcept;
  matchedAlias: string;
}>;

/**
 * Finds vocabulary terms explicitly named in prose. This is intentionally a
 * lexical validator, not a semantic classifier; it is used to catch a recipe
 * step that introduces an undeclared ingredient such as "add butter".
 */
export function findFoodConceptMentions(value: string): FoodConceptMention[] {
  const normalized = normalizeFoodLabel(value);
  type Candidate = FoodConceptMention & { start: number; end: number };
  const candidates: Candidate[] = [];

  for (const concept of FOOD_CONCEPTS) {
    for (const alias of [concept.name, ...concept.aliases]) {
      const normalizedAlias = normalizeFoodLabel(alias);
      if (normalizedAlias.length < 3) {
        continue;
      }

      let start = normalized.indexOf(normalizedAlias);
      while (start >= 0) {
        const end = start + normalizedAlias.length;
        const leftBoundary = start === 0 || normalized[start - 1] === " ";
        const rightBoundary = end === normalized.length || normalized[end] === " ";
        if (leftBoundary && rightBoundary) {
          candidates.push({
            concept,
            matchedAlias: normalizedAlias,
            start,
            end,
          });
        }
        start = normalized.indexOf(normalizedAlias, start + 1);
      }
    }
  }

  // Prefer the most specific phrase at each position, so "bell pepper" does
  // not also count as the black-pepper alias "pepper".
  candidates.sort(
    (left, right) =>
      left.start - right.start ||
      right.end - right.start - (left.end - left.start) ||
      left.concept.id.localeCompare(right.concept.id),
  );
  const accepted: Candidate[] = [];
  for (const candidate of candidates) {
    if (
      accepted.some(
        (mention) =>
          candidate.start < mention.end && candidate.end > mention.start,
      )
    ) {
      continue;
    }
    accepted.push(candidate);
  }

  const mentions = new Map<string, FoodConceptMention>();
  for (const { concept, matchedAlias } of accepted) {
    mentions.set(concept.id, { concept, matchedAlias });
  }
  return [...mentions.values()];
}
