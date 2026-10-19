import { randomInt } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { inviteCodeHash, validateAndroidNextAccess, type AndroidNextAccess } from "../services/androidNextAccess";

/**
 * Creates an invitation link for 药大拾间 NEXT and records only the code's
 * SHA-256 in server/src/releases/android-next-access.json (deploy to take effect).
 *
 *   node --import ./server/node_modules/tsx/dist/loader.mjs server/src/scripts/androidNextInvite.ts --write
 *   ... --revoke-all --write   (drop every earlier invitation first)
 *
 * The printed link is the only copy of the code: keep it out of commits and logs.
 */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const root = path.resolve(__dirname, "../../..");
const file = path.join(root, "server/src/releases/android-next-access.json");

async function main() {
  const code = Array.from({ length: 12 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  const policy = validateAndroidNextAccess(JSON.parse(await readFile(file, "utf8")) as AndroidNextAccess);
  const hashes = process.argv.includes("--revoke-all") ? [] : policy.inviteCodeSha256;
  const next = validateAndroidNextAccess({ ...policy, inviteCodeSha256: [...hashes, inviteCodeHash(code)] });
  if (process.argv.includes("--write")) await writeFile(file, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`https://cputime.cn/next?invite=${code}`);
}

if (require.main === module) main().catch((error) => { console.error(`[android-next-invite] ${error.message}`); process.exitCode = 1; });
