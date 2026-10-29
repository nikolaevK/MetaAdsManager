import "server-only";
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

// OWASP minimum for scrypt: N=2^17, r=8, p=1.
const PARAMS = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 } as const;
const KEY_LEN = 64;

// Each derivation takes ~128 MiB and a libuv thread for ~150 ms; unbounded parallel sign-ins could exhaust memory
// and starve file and network I/O that share the thread pool. Run at most two at a time, queue a few more.
const MAX_RUNNING = 2;
const MAX_WAITING = 16;
let running = 0;
const waiting: (() => void)[] = [];

/** True when sign-in attempts should be turned away instead of queued. */
export const passwordChecksBusy = () => waiting.length >= MAX_WAITING;

async function derive(password: string, salt: Buffer, opts: ScryptOptions): Promise<Buffer> {
  // A finishing call hands its slot straight to the next waiter, so `running` never exceeds the cap.
  if (running >= MAX_RUNNING) await new Promise<void>((go) => waiting.push(go));
  else running++;
  try {
    return await new Promise((resolve, reject) =>
      scrypt(password.normalize("NFKC"), salt, KEY_LEN, opts, (err, key) => (err ? reject(err) : resolve(key))),
    );
  } finally {
    const next = waiting.shift();
    if (next) next();
    else running--;
  }
}

/** Format: scrypt$N$r$p$saltB64$hashB64 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, PARAMS);
  return ["scrypt", PARAMS.N, PARAMS.r, PARAMS.p, salt.toString("base64"), key.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, r, p, saltB64, hashB64] = stored.split("$");
  if (algo !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const key = await derive(password, Buffer.from(saltB64, "base64"), {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: PARAMS.maxmem,
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

export const PASSWORD_MIN_LENGTH = 12;
