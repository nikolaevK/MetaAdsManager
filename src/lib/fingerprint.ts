/** Slice size for content fingerprints. It is part of the hash: changing it changes every fingerprint. */
export const FINGERPRINT_SLICE_BYTES = 8 * 1024 * 1024;

/**
 * SHA-256 of the SHA-256 digests of each slice: identifies a file's bytes without holding the whole file in memory
 * (Web Crypto can't hash incrementally). Runs in browsers and Node, so the browser and scripts agree.
 */
export async function contentFingerprint(file: Blob, sliceBytes = FINGERPRINT_SLICE_BYTES): Promise<string> {
  const digests = new Uint8Array(Math.ceil(file.size / sliceBytes) * 32);
  for (let i = 0, at = 0; at < file.size; i++, at += sliceBytes) {
    const slice = await file.slice(at, at + sliceBytes).arrayBuffer();
    digests.set(new Uint8Array(await crypto.subtle.digest("SHA-256", slice)), i * 32);
  }
  const final = new Uint8Array(await crypto.subtle.digest("SHA-256", digests));
  return Array.from(final, (b) => b.toString(16).padStart(2, "0")).join("");
}
