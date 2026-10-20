import crypto from "crypto";

// Compare a typed password with one from .env in constant time, so the response
// time doesn't reveal how many characters were right. Both are hashed first so the
// lengths always match (timingSafeEqual needs equal lengths). An unset secret never matches.
export const sameSecret = (given, expected) => {
  if (!expected) return false;
  const digest = (value) => crypto.createHash("sha256").update(String(value ?? "")).digest();
  return crypto.timingSafeEqual(digest(given), digest(expected));
};
