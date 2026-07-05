/* =============================================================================
 * unzip.js — dependency-free ZIP extraction in the browser
 * -----------------------------------------------------------------------------
 * Parses the ZIP central directory and inflates DEFLATE entries using the native
 * DecompressionStream('deflate-raw'). No external library required.
 *
 * Supports:
 *   - method 0 (stored) and method 8 (deflate)
 * Returns: { "path/file.wav": Uint8Array, ... } for the entries you keep.
 * ========================================================================== */

DM.unzip = (function () {
  'use strict';

  const SIG_EOCD = 0x06054b50; // End Of Central Directory
  const SIG_CDH = 0x02014b50;  // Central Directory File Header
  const SIG_LFH = 0x04034b50;  // Local File Header

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('DecompressionStream not supported — cannot inflate ZIP. Use a stored (uncompressed) ZIP or a newer browser.');
    }
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  }

  function findEOCD(view) {
    // EOCD is at the end; scan backwards (comment can be up to 65535 bytes).
    const len = view.byteLength;
    const min = Math.max(0, len - 65535 - 22);
    for (let i = len - 22; i >= min; i--) {
      if (view.getUint32(i, true) === SIG_EOCD) return i;
    }
    throw new Error('Not a valid ZIP file (EOCD not found).');
  }

  /**
   * Extract entries from an ArrayBuffer.
   * @param {ArrayBuffer} buffer
   * @param {(name:string)=>boolean} [filter] keep only entries that pass
   * @returns {Promise<Object<string, Uint8Array>>}
   */
  async function extract(buffer, filter) {
    const u8 = new Uint8Array(buffer);
    const view = new DataView(buffer);
    const eocd = findEOCD(view);

    const total = view.getUint16(eocd + 10, true);
    let cdOffset = view.getUint32(eocd + 16, true);

    const out = {};
    const decoder = new TextDecoder('utf-8');

    for (let n = 0; n < total; n++) {
      if (view.getUint32(cdOffset, true) !== SIG_CDH) break;

      const method = view.getUint16(cdOffset + 10, true);
      const compSize = view.getUint32(cdOffset + 20, true);
      const nameLen = view.getUint16(cdOffset + 28, true);
      const extraLen = view.getUint16(cdOffset + 30, true);
      const commentLen = view.getUint16(cdOffset + 32, true);
      const localOffset = view.getUint32(cdOffset + 42, true);

      const name = decoder.decode(u8.subarray(cdOffset + 46, cdOffset + 46 + nameLen));
      cdOffset += 46 + nameLen + extraLen + commentLen;

      // Skip directories and (optionally) entries the caller doesn't want.
      const isDir = name.endsWith('/');
      if (isDir) continue;
      if (filter && !filter(name)) continue;

      // Jump to the local header to find where the data actually starts
      // (local header has its own name/extra lengths).
      if (view.getUint32(localOffset, true) !== SIG_LFH) continue;
      const lNameLen = view.getUint16(localOffset + 26, true);
      const lExtraLen = view.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + lNameLen + lExtraLen;
      const comp = u8.subarray(dataStart, dataStart + compSize);

      let data;
      if (method === 0) data = comp.slice();        // stored
      else if (method === 8) data = await inflateRaw(comp); // deflate
      else continue;                                 // unsupported method

      out[name] = data;
    }
    return out;
  }

  return { extract };
})();
