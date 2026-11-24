const P1 = 2654435761;
const P2 = 2246822519;
const P3 = 3266489917;
const P4 = 668265263;
const P5 = 374761393;

function rotl(x: number, r: number): number {
  return ((x << r) | (x >>> (32 - r))) >>> 0;
}

/**
 * Computes unsigned 32-bit XXHash (seed 0 by default) on UTF-8 input.
 * Matches Blue Archive's ScenarioCharacterNameExcel character_name hashes.
 */
export function xxhash32(input: string, seed = 0): number {
  const buf = Buffer.from(input, "utf8");
  const len = buf.length;
  let h32: number;
  let i = 0;

  if (len >= 16) {
    let v1 = (seed + P1 + P2) >>> 0;
    let v2 = (seed + P2) >>> 0;
    let v3 = seed >>> 0;
    let v4 = (seed - P1) >>> 0;
    const limit = len - 16;

    while (i <= limit) {
      v1 = Math.imul(rotl((v1 + Math.imul(buf.readUInt32LE(i), P2)) >>> 0, 13), P1) >>> 0;
      i += 4;
      v2 = Math.imul(rotl((v2 + Math.imul(buf.readUInt32LE(i), P2)) >>> 0, 13), P1) >>> 0;
      i += 4;
      v3 = Math.imul(rotl((v3 + Math.imul(buf.readUInt32LE(i), P2)) >>> 0, 13), P1) >>> 0;
      i += 4;
      v4 = Math.imul(rotl((v4 + Math.imul(buf.readUInt32LE(i), P2)) >>> 0, 13), P1) >>> 0;
      i += 4;
    }

    h32 =
      (rotl(v1, 1) + rotl(v2, 7) + rotl(v3, 12) + rotl(v4, 18)) >>> 0;
  } else {
    h32 = (seed + P5) >>> 0;
  }

  h32 = (h32 + len) >>> 0;

  while (i + 4 <= len) {
    h32 = Math.imul(rotl((h32 + Math.imul(buf.readUInt32LE(i), P3)) >>> 0, 17), P4) >>> 0;
    i += 4;
  }

  while (i < len) {
    h32 = Math.imul(rotl((h32 + Math.imul(buf[i], P5)) >>> 0, 11), P1) >>> 0;
    i++;
  }

  h32 = Math.imul(h32 ^ (h32 >>> 15), P2) >>> 0;
  h32 = Math.imul(h32 ^ (h32 >>> 13), P3) >>> 0;
  return (h32 ^ (h32 >>> 16)) >>> 0;
}
