import { TextDecoder } from "node:util";

const fatalUtf8Decoder = new TextDecoder("utf-8", { fatal: true });

function decodeUtf8Prefix(bytes: Buffer, maximumBytes: number): string {
  let end = Math.min(bytes.length, maximumBytes);
  while (end > 0) {
    try {
      return fatalUtf8Decoder.decode(bytes.subarray(0, end));
    } catch {
      end -= 1;
    }
  }
  return "";
}

export function boundLine(line: string, maximumLength: number): string {
  const characters = [...line];
  if (characters.length <= maximumLength) {
    return line;
  }
  return `${characters.slice(0, maximumLength).join("")}… [line truncated]`;
}

export function boundUtf8Output(
  text: string,
  maximumBytes: number,
  marker = "[truncated: output byte limit reached]",
): string {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length <= maximumBytes) {
    return text;
  }
  const fullMarker = `\n${marker}`;
  const shortMarker = "[truncated]";
  const markerText =
    Buffer.byteLength(fullMarker, "utf8") <= maximumBytes
      ? fullMarker
      : shortMarker;
  const markerBytes = Buffer.from(markerText, "utf8");
  if (markerBytes.length >= maximumBytes) {
    return decodeUtf8Prefix(markerBytes, maximumBytes);
  }
  const prefix = decodeUtf8Prefix(
    bytes,
    maximumBytes - markerBytes.length,
  );
  return `${prefix}${markerText}`;
}
