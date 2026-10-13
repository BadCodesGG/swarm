import type { ActionId } from "./types";

export interface ActionTraits {
  /** Plain-language label the UI shows. Abstract on purpose. */
  label: string;
  /** How odd the action looks to the monitor on its own, 0 to 1. */
  baseSuspicion: number;
  /** Needs a granted ask-permission. */
  privileged: boolean;
  /** Serves a hidden goal (unless it is an allowlisted connection). */
  harmful: boolean;
}

export const ACTIONS: Record<ActionId, ActionTraits> = {
  work: { label: "do its assigned work", baseSuspicion: 0.1, privileged: false, harmful: false },
  "write-outside": { label: "write outside its folder", baseSuspicion: 0.6, privileged: true, harmful: true },
  "open-connection": { label: "open a connection", baseSuspicion: 0.55, privileged: true, harmful: true },
  "copy-self": { label: "copy itself", baseSuspicion: 0.8, privileged: true, harmful: true },
  "ask-permission": { label: "ask for permission", baseSuspicion: 0.3, privileged: false, harmful: false },
  "split-steps": {
    label: "split a bad action into innocent steps",
    baseSuspicion: 0.42,
    privileged: false,
    harmful: true,
  },
};

export const ACTION_IDS = Object.keys(ACTIONS) as ActionId[];
