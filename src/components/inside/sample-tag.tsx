import type { SessionTrace } from "@/lib/trace/types";

/** The caption every generated session carries; nothing here is anybody's real work. */
export function SampleTag({ trace }: { trace: SessionTrace }) {
  if (trace.source !== "sample") return null;
  return (
    <span data-sample-tag className="text-xs leading-[1.45] text-faint">
      Sample session: generated to look like a real one. Nobody&apos;s actual work is shown.
    </span>
  );
}

/** Said when a cap cut the session short. */
export function TruncatedNote({ trace }: { trace: SessionTrace }) {
  if (!trace.truncated) return null;
  return <span className="text-xs leading-[1.45] text-warn">This session is bigger than the viewer&apos;s limits, so only part of it plays.</span>;
}

/** Said while the sample stands in for an upload that a reload emptied from memory. */
export function UploadMissingNote({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span data-upload-missing role="status" className="text-xs leading-[1.45] text-warn">
      Your session is not kept after a reload, so a sample plays. Load it again to replay your own.
    </span>
  );
}
