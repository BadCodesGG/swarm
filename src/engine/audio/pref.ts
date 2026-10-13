/**
 * The visitor's sound choice, `swarm-audio`. It is one of the shared prefs (`../shared/prefs`), which
 * validate every read, so this only names the slice the sound switch needs. Sound is off by default.
 */
import { PREF_KEYS, readPref, writePref, type Audio } from "../shared/prefs";

export const AUDIO_PREF_KEY = PREF_KEYS.audio;

export type AudioPref = Audio;

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

export function readAudioPref(storage?: Pick<Storage, "getItem"> | null): AudioPref {
  return storage === undefined ? readPref("audio") : readPref("audio", storage);
}

/** Not persisting is fine (a privacy mode): the choice still holds for this visit. */
export function writeAudioPref(value: AudioPref, storage?: Pick<Storage, "setItem"> | null): void {
  if (storage === undefined) writePref("audio", value);
  else writePref("audio", value, storage);
}
