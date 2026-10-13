export interface LineSplitter {
  /** Feed the next decoded chunk; complete lines go to `onLine`. */
  push(chunk: string): void;
  /** The input ended: a last line without a terminator is delivered too. */
  end(): void;
}

/**
 * Splits a stream of decoded text into lines across chunk boundaries. `\n` and `\r\n` both end a
 * line (the `\r` is dropped). A line longer than `maxChars` keeps only its first `maxChars + 1`
 * characters, enough for the consumer to see it is over the limit without holding all of it, and
 * the rest up to the next newline is discarded.
 */
export function createLineSplitter(onLine: (line: string) => void, maxChars = Infinity): LineSplitter {
  let carry = "";

  const append = (s: string) => {
    if (carry.length <= maxChars) carry += s.length + carry.length > maxChars + 1 ? s.slice(0, maxChars + 1 - carry.length) : s;
  };
  const emit = () => {
    const line = carry.endsWith("\r") ? carry.slice(0, -1) : carry;
    carry = "";
    onLine(line);
  };

  return {
    push(chunk) {
      let start = 0;
      for (;;) {
        const nl = chunk.indexOf("\n", start);
        if (nl < 0) {
          append(chunk.slice(start));
          return;
        }
        append(chunk.slice(start, nl));
        emit();
        start = nl + 1;
      }
    },
    end() {
      if (carry !== "") emit();
    },
  };
}
