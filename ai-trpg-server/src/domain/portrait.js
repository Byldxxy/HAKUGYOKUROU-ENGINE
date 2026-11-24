const prefix = 'data:image/png;base64,';
const maxBytes = 128 * 1024;
const signature = Buffer.from('89504e470d0a1a0a', 'hex');
const end = Buffer.from('0000000049454e44ae426082', 'hex');

const decodePortrait = value => {
  if (typeof value !== 'string' || value.length > prefix.length + 4 * Math.ceil(maxBytes / 3) || !value.startsWith(prefix)) return null;
  const bytes = Buffer.from(value.slice(prefix.length), 'base64');
  if (bytes.length > maxBytes || bytes.length < 57 || !bytes.subarray(0, 8).equals(signature) ||
      bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR' ||
      !bytes.subarray(-12).equals(end) || bytes.toString('base64') !== value.slice(prefix.length)) return null;
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (!width || !height || width > 512 || height > 512) return null;
  // A PNG chunk has a length, a four-byte type, its payload, and a checksum.
  let offset = 33; // Immediately after IHDR.
  let hasImageData = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('latin1', offset + 4, offset + 8);
    offset += 12 + length;
    if (offset > bytes.length) return null;
    if (type === 'IDAT' && length > 0) hasImageData = true;
    if (type === 'IEND') return hasImageData && offset === bytes.length ? bytes : null;
  }
  return null;
};
module.exports = { decodePortrait };
