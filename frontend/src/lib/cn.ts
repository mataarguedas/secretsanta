type ClassValue = string | false | null | undefined | 0;

/** Join truthy class names. Tailwind classes stay literal so the scanner and lint rules see them. */
export function cn(...classes: ClassValue[]): string {
  return classes.filter(Boolean).join(' ');
}
