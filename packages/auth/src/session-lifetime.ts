/**
 * How long a Forge session lasts — the signed token's `exp` and the session cookie's `Max-Age` both
 * derive from this one value, so the cookie can never outlive (or expire before) the token it carries.
 */
export const SESSION_TTL_SECONDS = 24 * 60 * 60;
