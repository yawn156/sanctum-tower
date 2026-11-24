export function cleanDialogueText(raw: string): string {
  if (!raw) return "";
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/#n/gi, "\n")
    .replace(/\[ruby=[^\]]*\]/gi, "")
    .replace(/\[\/ruby\]/gi, "")
    .replace(/\[[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?\]/g, "")
    .replace(/\[-\]/g, "")
    .replace(/\[\/?(?:b|i|u|s|sup|sub)\]/gi, "")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter((line, idx, arr) => line !== "" || (idx > 0 && arr[idx - 1] !== ""))
    .join("\n")
    .trim();
}

export type ParsedScriptKr =
  | { kind: "speech"; speakerKey: string; textKr: string }
  | { kind: "sensei_choice"; textKr: string }
  | { kind: "narration"; textKr: string }
  | { kind: "directive" };

function splitFirstN(str: string, delim: string, maxSplits: number): string[] {
  const parts: string[] = [];
  let start = 0;
  for (let i = 0; i < maxSplits; i++) {
    const idx = str.indexOf(delim, start);
    if (idx === -1) break;
    parts.push(str.slice(start, idx));
    start = idx + delim.length;
  }
  parts.push(str.slice(start));
  return parts;
}

/**
 * Parses a ScenarioScriptExcel script_kr command string into a typed action.
 * Handles multi-line command blocks by prioritizing character speech over
 * stage directives / expression cues.
 */
export function parseScriptKr(scriptKr: string): ParsedScriptKr {
  if (!scriptKr) return { kind: "directive" };

  const lines = scriptKr
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  let speechSpeaker = "";
  const speechTexts: string[] = [];
  const senseiTexts: string[] = [];
  const narrationTexts: string[] = [];

  for (const line of lines) {
    // 1. Sensei choice options: [s] ..., [s1] ..., [ns] ..., [ns1] ...
    if (/^\[n?s\d*\]/i.test(line)) {
      const cleanedChoice = cleanDialogueText(
        line.replace(/^\[n?s\d*\]\s*/i, "")
      );
      if (cleanedChoice) senseiTexts.push(cleanedChoice);
      continue;
    }

    // 2. Off-screen / comms speech or narration: #na;speaker;text or #na;text
    if (/^#na;/i.test(line)) {
      const parts = splitFirstN(line, ";", 2);
      if (parts.length >= 3 && parts[1].trim() && parts[2].trim()) {
        const speaker = parts[1].trim();
        const text = cleanDialogueText(parts[2]);
        if (text) {
          if (!speechSpeaker) speechSpeaker = speaker;
          if (speaker === speechSpeaker) {
            speechTexts.push(text);
          }
        }
      } else if (parts.length === 2 && parts[1].trim()) {
        const text = cleanDialogueText(parts[1]);
        if (text) narrationTexts.push(text);
      }
      continue;
    }

    // 3. Stage / camera / emote / BGM directives starting with #
    if (line.startsWith("#")) {
      continue;
    }

    // 4. On-screen character speech: <slot 1-5>;<kr_key>;<expr>;<kr_text>
    if (/^[1-5];/.test(line)) {
      const parts = splitFirstN(line, ";", 3);
      if (parts.length >= 4 && parts[1].trim() && parts[3].trim()) {
        const speaker = parts[1].trim();
        const text = cleanDialogueText(parts[3]);
        if (text) {
          if (!speechSpeaker) speechSpeaker = speaker;
          if (speaker === speechSpeaker) {
            speechTexts.push(text);
          }
        }
      }
      // 3-part lines (e.g. "3;키사키;05") are expression-only updates
      continue;
    }
  }

  if (speechSpeaker && speechTexts.length > 0) {
    return {
      kind: "speech",
      speakerKey: speechSpeaker,
      textKr: speechTexts.join("\n"),
    };
  }
  if (senseiTexts.length > 0) {
    return {
      kind: "sensei_choice",
      textKr: senseiTexts.join("\n"),
    };
  }
  if (narrationTexts.length > 0) {
    return {
      kind: "narration",
      textKr: narrationTexts.join("\n"),
    };
  }
  return { kind: "directive" };
}
