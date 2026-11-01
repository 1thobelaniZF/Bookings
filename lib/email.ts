// Shared email rules. Kept free of any server-only imports so both the client
// components and the server (API routes) can use it.

export const ALLOWED_EMAIL_DOMAIN = 'zenexfoundation.org.za';

/** True for any well-formed email address (any domain). */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/** True only for a well-formed address on the allowed staff domain. */
export function isAllowedEmail(email: string): boolean {
  const value = email.trim().toLowerCase();
  return isValidEmail(value) && value.endsWith(`@${ALLOWED_EMAIL_DOMAIN}`);
}
