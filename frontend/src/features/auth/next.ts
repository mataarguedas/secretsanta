/**
 * Client-side mirror of the backend's `safe_next` (FR-AUTH-5): only same-origin relative
 * paths survive, anything else becomes `/`. The backend re-validates; this keeps the app
 * from ever building a login URL or `<Navigate>` from a hostile value.
 */
export function safeNext(value: string | null | undefined): string {
  if (!value || value.length > 2048) return '/';
  if (!value.startsWith('/') || value.startsWith('//')) return '/';
  if (value.includes('\\')) return '/';
  // Control characters (C0, DEL, C1) could smuggle line breaks or confuse URL parsers.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f-\u009f]/.test(value)) return '/';
  return value;
}

export const GOOGLE_LOGIN_PATH = '/api/v1/auth/google/login';

export function googleLoginUrl(next: string | null | undefined): string {
  return `${GOOGLE_LOGIN_PATH}?next=${encodeURIComponent(safeNext(next))}`;
}

/** Where a signed-out visitor is sent: the landing page, remembering the full path. */
export function signInRedirect(pathname: string, search: string): string {
  const next = `${pathname}${search}`;
  return next === '/' ? '/' : `/?next=${encodeURIComponent(next)}`;
}
