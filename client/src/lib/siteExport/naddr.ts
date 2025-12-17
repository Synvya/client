// This implementation intentionally mirrors internal/naddr/generate_naddrs.py
// to produce identical naddr strings (including TLV ordering).

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

function bech32Polymod(values: number[]): number {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const b = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) {
      chk ^= ((b >> i) & 1) ? GEN[i] : 0;
    }
  }
  return chk;
}

function bech32HrpExpand(hrp: string): number[] {
  const out: number[] = [];
  for (const ch of hrp) out.push(ch.charCodeAt(0) >> 5);
  out.push(0);
  for (const ch of hrp) out.push(ch.charCodeAt(0) & 31);
  return out;
}

function bech32CreateChecksum(hrp: string, data: number[]): number[] {
  const values = [...bech32HrpExpand(hrp), ...data];
  const polymod = bech32Polymod([...values, 0, 0, 0, 0, 0, 0]) ^ 1;
  const res: number[] = [];
  for (let i = 0; i < 6; i++) {
    res.push((polymod >> (5 * (5 - i))) & 31);
  }
  return res;
}

function bech32Encode(hrp: string, data: number[]): string {
  const combined = [...data, ...bech32CreateChecksum(hrp, data)];
  return `${hrp}1${combined.map((d) => CHARSET[d]).join("")}`;
}

function convertBits(data: Uint8Array, fromBits: number, toBits: number, pad = true): number[] {
  let acc = 0;
  let bits = 0;
  const ret: number[] = [];
  const maxv = (1 << toBits) - 1;
  const maxAcc = (1 << (fromBits + toBits - 1)) - 1;
  for (const value of data) {
    acc = ((acc << fromBits) | value) & maxAcc;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      ret.push((acc >> bits) & maxv);
    }
  }
  if (pad) {
    if (bits) ret.push((acc << (toBits - bits)) & maxv);
  } else if (bits >= fromBits || ((acc << (toBits - bits)) & maxv)) {
    throw new Error("Invalid bits");
  }
  return ret;
}

function hexToBytes(hex: string): Uint8Array {
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) {
    throw new Error("Invalid hex pubkey");
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function encodeTlv(entries: Array<{ type: number; value: Uint8Array }>): Uint8Array {
  const chunks: number[] = [];
  for (const { type, value } of entries) {
    chunks.push(type, value.length, ...value);
  }
  return new Uint8Array(chunks);
}

export function naddrForAddressableEvent(params: {
  identifier: string; // d-tag
  pubkey: string; // hex pubkey
  kind: number;
  relays?: string[];
}): string {
  const tlv: Array<{ type: number; value: Uint8Array }> = [];

  // Type 0: identifier
  tlv.push({ type: 0, value: new TextEncoder().encode(params.identifier) });

  // Type 1: relays (optional, repeated)
  if (params.relays?.length) {
    for (const relay of params.relays) {
      tlv.push({ type: 1, value: new TextEncoder().encode(relay) });
    }
  }

  // Type 2: author
  tlv.push({ type: 2, value: hexToBytes(params.pubkey) });

  // Type 3: kind (u32 big-endian)
  const kindBytes = new Uint8Array(4);
  kindBytes[0] = (params.kind >>> 24) & 0xff;
  kindBytes[1] = (params.kind >>> 16) & 0xff;
  kindBytes[2] = (params.kind >>> 8) & 0xff;
  kindBytes[3] = params.kind & 0xff;
  tlv.push({ type: 3, value: kindBytes });

  const tlvBytes = encodeTlv(tlv);
  const data5 = convertBits(tlvBytes, 8, 5, true);
  return bech32Encode("naddr", data5);
}


