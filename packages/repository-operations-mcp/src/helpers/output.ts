import { TextDecoder } from "node:util";

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

function decodeUtf8Prefix(buffer: Buffer, maxBytes: number): string {
  let end = Math.min(buffer.length, maxBytes);
  while (end > 0) {
    try {
      return utf8Decoder.decode(buffer.subarray(0, end));
    } catch {
      end -= 1;
    }
  }
  return "";
}

export function truncateUtf8(
  text: string,
  maxBytes: number,
  marker = "\n[truncated]",
): string {
  const content = Buffer.from(text, "utf8");
  if (content.length <= maxBytes) {
    return text;
  }

  return markUtf8Truncated(text, maxBytes, marker);
}

export function markUtf8Truncated(
  text: string,
  maxBytes: number,
  marker = "\n[truncated]",
): string {
  const content = Buffer.from(text, "utf8");
  const markerBuffer = Buffer.from(marker, "utf8");
  if (markerBuffer.length >= maxBytes) {
    return decodeUtf8Prefix(markerBuffer, maxBytes);
  }

  const prefix = decodeUtf8Prefix(content, maxBytes - markerBuffer.length);
  return `${prefix}${marker}`;
}
