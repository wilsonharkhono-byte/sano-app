export function normalizeMaterialName(input: string | null | undefined): string {
  if (input == null) return '';
  return input
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
