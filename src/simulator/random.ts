// Seeded randomness so a simulated campus and its scans are reproducible.

export type Rng = {
  /** Uniform in [0, 1). */
  next(): number;
  chance(probability: number): boolean;
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  /** Normally distributed value (Box-Muller). */
  normal(mean: number, stdDev: number): number;
  shuffle<T>(items: readonly T[]): T[];
};

export function createRng(seed: number | string): Rng {
  let state = typeof seed === "number" ? seed >>> 0 : hashString(seed);

  // mulberry32
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const rng: Rng = {
    next,
    chance: (probability) => next() < probability,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (items) => items[Math.floor(next() * items.length)],
    normal: (mean, stdDev) => {
      const u = 1 - next();
      const v = next();
      return mean + stdDev * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    shuffle: (items) => {
      const copy = [...items];
      for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(next() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy;
    },
  };

  return rng;
}

export function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
