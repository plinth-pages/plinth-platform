import { gunzipSync } from "zlib";

/**
 * Reads files out of an npm package tarball (`.tgz`) in memory: gunzip, then walk the tar headers. Enough for the
 * catalogue to read `package/package.json` and `package/plinth.manifest.json` without unpacking anything to disk.
 */
export function readTarballFiles(tgz: Buffer, wanted: string[]): Record<string, string> {
  const tar = gunzipSync(tgz);
  const found: Record<string, string> = {};
  let offset = 0;

  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;

    const name = cString(header.subarray(0, 100));
    const prefix = cString(header.subarray(345, 500));
    const path = prefix ? `${prefix}/${name}` : name;
    const size = parseInt(cString(header.subarray(124, 136)).trim() || "0", 8);
    const type = String.fromCharCode(header[156] || 48);
    if (!Number.isFinite(size) || size < 0) throw new Error("Corrupt tarball header");

    const start = offset + 512;
    if ((type === "0" || type === "\0") && wanted.includes(path)) {
      found[path] = tar.subarray(start, start + size).toString("utf8");
    }
    offset = start + Math.ceil(size / 512) * 512;
  }
  return found;
}

function cString(bytes: Buffer): string {
  const end = bytes.indexOf(0);
  return bytes.subarray(0, end === -1 ? bytes.length : end).toString("utf8");
}
