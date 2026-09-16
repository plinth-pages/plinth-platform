import { SetMetadata } from "@nestjs/common";
import type { User } from "@prisma/client";

/**
 * The current Terms of Service and Privacy Policy, by date. Bump it whenever either document changes materially:
 * every signed-in user is then asked to accept again before using the app. Keep it equal to the "Last updated" date
 * shown on /terms and /privacy.
 */
export const TERMS_VERSION = "2026-09-17";

export function hasAcceptedTerms(user: Pick<User, "termsVersion">): boolean {
  return user.termsVersion === TERMS_VERSION;
}

const ALLOW_WITHOUT_TERMS = "plinth:allow-without-terms";

/** For the few signed-in routes a user must reach before accepting: who am I, accept, sign out. */
export const AllowWithoutTerms = () => SetMetadata(ALLOW_WITHOUT_TERMS, true);
export const ALLOW_WITHOUT_TERMS_KEY = ALLOW_WITHOUT_TERMS;
