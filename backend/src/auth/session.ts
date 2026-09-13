import type { Request } from "express";
import type { User } from "@prisma/client";

export const SESSION_COOKIE = "plinth_session";
export const OAUTH_STATE_COOKIE = "plinth_oauth_state";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export interface AuthenticatedRequest extends Request {
  user: User;
}
