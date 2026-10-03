import { hash, verify } from "@node-rs/argon2";
import type { CookieOptions, NextFunction, Request, RequestHandler, Response } from "express";
import { jwtVerify, SignJWT } from "jose";
import { HttpError } from "../errors";
import { AdminUser, type AdminRole, type AdminUserDoc } from "../models/Admin";

export interface AdminAuthConfig {
  jwtSecret: string;
  /** Secure cookies need HTTPS; on in production. Browsers treat http://localhost as secure anyway. */
  secureCookies: boolean;
}

export const SESSION_COOKIE = "hn_admin";
const SESSION_TTL_S = 2 * 60 * 60;
/** Sessions are re-issued on activity once less than this much time is left. */
const RENEW_BELOW_S = 60 * 60;
/** Header the admin app sends on every change; a cross-site form or image tag cannot set it. */
export const ADMIN_HEADER = "x-hn-admin";

export const hashPassword = (password: string) => hash(password);

// A real hash of a throwaway password, so unknown emails take as long as wrong passwords.
const DUMMY_HASH = hash("not-a-real-password-for-timing-only");

export async function checkCredentials(email: string, password: string): Promise<AdminUserDoc | null> {
  const user = await AdminUser.findOne({ email: email.toLowerCase().trim(), active: true });
  const ok = await verify(user?.passwordHash ?? (await DUMMY_HASH), password).catch(() => false);
  return user && ok ? user : null;
}

function cookieOptions(cfg: AdminAuthConfig): CookieOptions {
  return {
    httpOnly: true,
    secure: cfg.secureCookies,
    sameSite: "strict",
    path: "/api/admin",
    maxAge: SESSION_TTL_S * 1000,
  };
}

const key = (cfg: AdminAuthConfig) => new TextEncoder().encode(cfg.jwtSecret);

export async function issueSession(res: Response, user: AdminUserDoc, cfg: AdminAuthConfig): Promise<void> {
  const token = await new SignJWT({ role: user.role, v: user.tokenVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_S}s`)
    .sign(key(cfg));
  res.cookie(SESSION_COOKIE, token, cookieOptions(cfg));
}

export function clearSession(res: Response, cfg: AdminAuthConfig): void {
  const { maxAge: _maxAge, ...opts } = cookieOptions(cfg);
  res.clearCookie(SESSION_COOKIE, opts);
}

export interface AdminPrincipal {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by requireAdmin. */
      admin?: AdminPrincipal;
    }
  }
}

/** Requires a valid session; checks the user is still active and the session not revoked. */
export function requireAdmin(cfg: AdminAuthConfig): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    if (typeof token !== "string") throw new HttpError(401, "UNAUTHENTICATED", "Please sign in");
    let payload: { sub?: string; v?: unknown; exp?: number };
    try {
      ({ payload } = await jwtVerify(token, key(cfg), { algorithms: ["HS256"] }));
    } catch {
      clearSession(res, cfg);
      throw new HttpError(401, "UNAUTHENTICATED", "Please sign in again");
    }
    const user = payload.sub ? await AdminUser.findById(payload.sub) : null;
    if (!user || !user.active || payload.v !== user.tokenVersion) {
      clearSession(res, cfg);
      throw new HttpError(401, "UNAUTHENTICATED", "Please sign in again");
    }
    req.admin = { id: user.id, email: user.email, name: user.name, role: user.role };
    if ((payload.exp ?? 0) - Date.now() / 1000 < RENEW_BELOW_S) await issueSession(res, user, cfg);
    next();
  };
}

/** Owner-only actions: refunds, prices and catalogue, team and content. */
export const requireOwner: RequestHandler = (req, _res, next) => {
  if (req.admin?.role !== "owner") throw new HttpError(403, "FORBIDDEN", "Only the owner can do this");
  next();
};

/** Every state-changing admin request must carry the admin header (defence in depth with SameSite=Strict). */
export const requireAdminHeader: RequestHandler = (req, _res, next) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && req.get(ADMIN_HEADER) !== "1") {
    throw new HttpError(403, "FORBIDDEN", "Missing admin request header");
  }
  next();
};
