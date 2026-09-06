/**
 * Classnames samenvoegen, zonder dependency.
 *
 * Genoeg voor wat dit project doet: voorwaardelijke klassen aan- en uitzetten.
 * Het lost geen conflicterende Tailwind-utilities op zoals tailwind-merge; dat
 * is hier ook niet nodig, want de componenten kiezen zelf welke variant ze
 * schrijven in plaats van klassen over elkaar heen te stapelen.
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
