export function parseMessageBindToken(text: string) {
  const normalized = String(text || "").trim().replace(/^[\/／]\s*/, "").trim();
  const commandMatch = normalized.match(/^绑定(?:码)?\s*[：:,，-]?\s*([A-Z0-9]{6,16})$/i);
  if (commandMatch) return commandMatch[1].toUpperCase();
  const tokenMatch = normalized.match(/^([A-Z0-9]{6,16})$/i);
  return tokenMatch ? tokenMatch[1].toUpperCase() : "";
}
