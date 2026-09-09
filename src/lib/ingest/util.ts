export function jsonlLines(text: string): string[] {
  return text.split(/\r?\n/);
}

export function parseJsonl(
  text: string,
): { rows: Record<string, unknown>[]; skipped: number } {
  const rows: Record<string, unknown>[] = [];
  let skipped = 0;
  for (const line of jsonlLines(text)) {
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(line) as unknown;
      if (value && typeof value === "object" && !Array.isArray(value)) {
        rows.push(value as Record<string, unknown>);
      } else {
        skipped += 1;
      }
    } catch {
      skipped += 1;
    }
  }
  return { rows, skipped };
}

export function detectSource(
  rows: Record<string, unknown>[],
): "claude-code" | "codex" | "unknown" {
  if (
    rows.some(
      (row) =>
        row.type === "session_meta" &&
        row.payload !== null &&
        typeof row.payload === "object",
    )
  ) {
    return "codex";
  }
  if (
    rows.some((row) => {
      if (row.type !== "user" && row.type !== "assistant") return false;
      const message = row.message;
      return Boolean(
        message &&
          typeof message === "object" &&
          !Array.isArray(message) &&
          "role" in message,
      );
    })
  ) {
    return "claude-code";
  }
  return "unknown";
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function cwdShortName(cwd: string | undefined): string | undefined {
  if (!cwd) return undefined;
  const parts = cwd.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.at(-1) ?? cwd;
}

export function fallbackTitle(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? filename;
  return base.replace(/\.jsonl$/i, "") || filename;
}

export function previewText(text: string, max = 80): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max - 1)}…`;
}

function extractXmlTag(text: string, name: string): string | undefined {
  const match = text.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "i"));
  const value = match?.[1]?.trim();
  return value || undefined;
}

export type SlashCommand = {
  name: string;
  args?: string;
  message?: string;
};

export function parseSlashCommand(text: string): SlashCommand | undefined {
  const name = extractXmlTag(text, "command-name");
  if (!name) return undefined;
  return {
    name,
    args: extractXmlTag(text, "command-args"),
    message: extractXmlTag(text, "command-message"),
  };
}

export function stripXmlTags(text: string): string {
  return text.replace(/<\/?[a-zA-Z0-9_-]+>/g, " ").replace(/\s+/g, " ").trim();
}

export function humanizeSessionText(text: string, max = 80): string {
  const command = parseSlashCommand(text);
  if (command) {
    const args = command.args ? previewText(command.args.replace(/\s+/g, " "), Math.max(24, max - command.name.length - 1)) : "";
    return previewText(args ? `${command.name} ${args}` : command.name, max);
  }
  const stripped = stripXmlTags(text);
  return previewText(stripped || text, max);
}

export function stringifyUnknown(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function toolPayloadLength(value: unknown): { chars: number; lines: number } {
  const text = stringifyUnknown(value);
  return {
    chars: text.length,
    lines: text ? text.split("\n").length : 0,
  };
}

export function isLongPayload(value: unknown): boolean {
  const { chars, lines } = toolPayloadLength(value);
  return chars > 2048 || lines > 20;
}
