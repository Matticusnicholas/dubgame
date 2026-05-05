// Avoids visually confusing chars (no I, L, O, 0, 1).
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateGameCode(length = 5): string {
  const arr = new Uint8Array(length);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < length; i++) arr[i] = Math.floor(Math.random() * 256);
  }
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ALPHABET[arr[i] % ALPHABET.length];
  }
  return out;
}

export function generateToken(): string {
  const arr = new Uint8Array(24);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function isValidCode(code: string): boolean {
  if (typeof code !== "string") return false;
  if (code.length !== 5) return false;
  for (const c of code) if (!ALPHABET.includes(c)) return false;
  return true;
}
