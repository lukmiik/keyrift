/**
 * Splits a stream of text into lines. The engine speaks NDJSON: one JSON message per line.
 *
 * Socket data arrives in chunks of any size: one chunk can hold several lines, or only part
 * of one. The splitter keeps an unfinished line until the rest of it arrives.
 */
export class LineSplitter {
  /** Text after the last "\n" seen so far: the start of a line that is not complete yet. */
  #pending = "";

  /** Adds a chunk and returns every line it completed (without the "\n"; blank lines skipped). */
  push(chunk: string): string[] {
    const parts = (this.#pending + chunk).split("\n");
    // The last part has no "\n" after it yet, so it is unfinished: keep it for the next chunk.
    this.#pending = parts.pop() ?? "";
    return parts.filter((line) => line.trim() !== "");
  }
}
