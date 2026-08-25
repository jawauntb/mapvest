export function withOccurrenceKeys<T>(
  values: readonly T[],
  baseKeyFor: (value: T) => string,
): Array<{ key: string; value: T }> {
  const occurrences = new Map<string, number>();
  return values.map((value) => {
    const baseKey = baseKeyFor(value);
    const occurrence = (occurrences.get(baseKey) ?? 0) + 1;
    occurrences.set(baseKey, occurrence);
    return { key: `${baseKey}:${occurrence}`, value };
  });
}
