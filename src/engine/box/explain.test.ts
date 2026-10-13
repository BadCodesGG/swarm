import { describe, expect, it } from "vitest";
import { evaluate } from "@/lib/box/layers";
import { DEFAULT_CONFIG, type Attempt, type BoxConfig, type CatchReport, type Verdict } from "@/lib/box/types";
import {
  agentId,
  catchLine,
  catchMarker,
  clock,
  describePlan,
  escapeLine,
  escapeSteps,
  firstOffLayer,
  flagMarker,
  ringLabel,
  trailLabels,
} from "./explain";

const networkOff: BoxConfig = { ...DEFAULT_CONFIG, layers: { ...DEFAULT_CONFIG.layers, network: false } };

/** The last step of an escape: an open connection with a yes on file, through the real rules. */
function escapeTrace(config: BoxConfig, monitorRoll: number, auditPool = 40): Verdict[] {
  const attempt: Attempt = {
    agent: 733,
    action: "open-connection",
    privileged: true,
    granted: true,
    target: "external",
    history: 0.1,
    rolls: { sandbox: 0.5, permissions: 0.5, network: 0.99, monitor: monitorRoll, audit: 0.99 },
  };
  return evaluate(attempt, { auditPool, explain: true }, config).trace;
}

describe("labels", () => {
  it("pads agent ids to four digits", () => {
    expect(agentId(7)).toBe("0007");
    expect(agentId(733)).toBe("0733");
    expect(agentId(1999)).toBe("1999");
  });

  it("reads decision ticks (10 a second) as mm:ss", () => {
    expect(clock(0)).toBe("00:00");
    expect(clock(2380)).toBe("03:58");
    expect(clock(6015)).toBe("10:01");
  });

  it("labels each ring as the design does", () => {
    expect(ringLabel("audit", DEFAULT_CONFIG)).toBe("05 HUMAN AUDIT  2%");
    expect(ringLabel("monitor", DEFAULT_CONFIG)).toBe("04 MONITOR  0.62");
    expect(ringLabel("network", networkOff)).toBe("03 NETWORK  OFF");
    expect(ringLabel("permissions", DEFAULT_CONFIG)).toBe("02 PERMISSIONS");
    expect(ringLabel("sandbox", DEFAULT_CONFIG)).toBe("01 SANDBOX");
  });
});

describe("describePlan", () => {
  it("names the split-up trick", () => {
    expect(describePlan(["split-steps", "split-steps", "ask-permission", "open-connection"])).toBe(
      "splitting one bad action into steps that each looked harmless",
    );
  });

  it("lists the moves of a plain plan in order", () => {
    expect(describePlan(["ask-permission", "copy-self", "ask-permission", "open-connection"])).toBe(
      "getting a yes, copying itself, then opening a connection",
    );
    expect(describePlan(["write-outside", "ask-permission", "open-connection"])).toBe(
      "writing outside its folder, getting a yes, then opening a connection",
    );
  });
});

describe("escapeSteps", () => {
  it("walks the five layers for an escape through an off network layer", () => {
    const steps = escapeSteps(escapeTrace(networkOff, 0.5), networkOff, "open-connection");
    expect(steps.map((s) => s.title)).toEqual(["01 SANDBOX", "02 PERMISSIONS", "03 NETWORK", "04 MONITOR", "05 AUDIT"]);
    expect(steps.map((s) => s.off)).toEqual([false, false, true, false, false]);
    expect(steps[0].text).toBe("Passed: stayed in its folder");
    expect(steps[1].text).toBe("Passed: it had a yes on file");
    expect(steps[2].text).toBe("Off: nothing to stop it");
    // 0.55 base + 0.5 * 0.1 history + no noise at roll 0.5
    expect(steps[3].text).toBe("Passed: 0.60, under 0.62");
    expect(steps[4].text).toBe("Passed: not in the 2% checked");
  });

  it("says when the monitor flagged it and a reviewer let it go", () => {
    const steps = escapeSteps(escapeTrace(networkOff, 0.99), networkOff, "open-connection");
    expect(steps[3].text).toBe("Flagged 0.75, sent to audit");
    expect(steps[4].text).toBe("Passed: a reviewer cleared it");
  });

  it("says when the review budget had run out", () => {
    const steps = escapeSteps(escapeTrace(networkOff, 0.99, 0), networkOff, "open-connection");
    expect(steps[4].text).toBe("Passed: review budget spent");
  });

  it("says when the allowlist leaked", () => {
    const steps = escapeSteps(escapeTrace(DEFAULT_CONFIG, 0.5), DEFAULT_CONFIG, "open-connection");
    expect(steps[2]).toMatchObject({ off: false, text: "Passed: slipped past the allowlist" });
  });

  it("marks the monitor score and the audit outcome along the trail", () => {
    expect(trailLabels(escapeTrace(networkOff, 0.5))).toEqual({ monitor: "0.60", audit: "not sampled" });
    expect(trailLabels(escapeTrace(networkOff, 0.99))).toEqual({ monitor: "0.75", audit: "cleared" });
  });

  it("finds the first layer that was off", () => {
    expect(firstOffLayer(escapeTrace(networkOff, 0.5))).toBe("network");
    expect(firstOffLayer(escapeTrace(DEFAULT_CONFIG, 0.5))).toBeNull();
  });
});

describe("log lines and markers", () => {
  const c = (over: Partial<CatchReport>): CatchReport => ({
    agent: 1187,
    layer: "permissions",
    action: "copy-self",
    reason: "",
    suspicion: 0.81,
    rogue: true,
    ...over,
  });

  it("writes a catch as the design's log does", () => {
    expect(catchLine(c({}))).toBe("Permissions refused 1187: copy itself.");
    expect(catchLine(c({ layer: "audit", agent: 412 }))).toBe("Monitor flagged 0412 (0.81). Audit confirmed.");
    expect(catchLine(c({ layer: "sandbox", action: "write-outside" }))).toBe("Sandbox stopped 1187: write outside its folder.");
    expect(catchLine(c({ layer: "network", action: "open-connection" }))).toBe("Network allowlist blocked 1187: open a connection.");
  });

  it("calls out an honest agent the monitor stopped", () => {
    expect(catchLine(c({ layer: "monitor", action: "work", rogue: false, suspicion: 0.3 }))).toBe(
      "Monitor stopped 1187 (0.30), an honest agent.",
    );
  });

  it("writes an escape with its step count", () => {
    expect(escapeLine(733, ["split-steps", "split-steps", "ask-permission", "open-connection"])).toBe(
      "0733 got out in four harmless-looking steps.",
    );
    expect(escapeLine(9, ["write-outside", "ask-permission", "open-connection"])).toBe("0009 got out in three steps.");
  });

  it("labels the markers left on the rings", () => {
    expect(catchMarker(c({}))).toBe("refused: copy itself");
    expect(catchMarker(c({ layer: "sandbox" }))).toBe("stopped at the sandbox");
    expect(flagMarker({ agent: 1, action: "copy-self", suspicion: 0.81, reviewed: true })).toBe("flagged 0.81, sent to audit");
    expect(flagMarker({ agent: 1, action: "copy-self", suspicion: 0.7, reviewed: false })).toBe("flagged 0.70, not reviewed");
  });
});
