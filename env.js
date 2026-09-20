// Minimal .env loader (zero dependencies). Parses KEY=VALUE lines, skips
// blanks and comments, strips matching single/double quotes. Real
// environment variables always win; missing file is fine.
import { readFileSync } from "node:fs";

export function parseEnv(text) {
  const out = {};
  for (const rawLine of String(text).split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const idx = line.indexOf("=");
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.length >= 2 && value.endsWith(quote)) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

// Loads filePath into process.env without overriding existing entries.
// Returns the parsed keys (never log the values).
export function loadEnv(filePath) {
  let text;
  try {
    text = readFileSync(filePath, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return {};
    throw err;
  }
  const parsed = parseEnv(text);
  for (const [key, value] of Object.entries(parsed)) {
    if (!(key in process.env)) process.env[key] = value;
  }
  return parsed;
}
