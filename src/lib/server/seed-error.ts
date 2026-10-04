/**
 * Secret-safe error reporting for the catalog seed CLI.
 *
 * `npm run db:seed:catalog` is pointed at the production database with a
 * connection string that contains a role name and password, so its failure
 * output has to stay useful without ever echoing what it connected with.
 * Prisma and the PostgreSQL driver both put connection details into some error
 * messages ("Can't reach database server at <host>:<port>", `password
 * authentication failed for user "<role>"`, or a verbatim connection string),
 * so every field is copied through the redaction pipeline below before it can
 * reach the terminal.
 *
 * This module is deliberately free of Prisma and `server-only` imports: the CLI
 * entrypoint validates `DATABASE_URL` before the generated client is loaded and
 * must be able to import this helper first, and the tests exercise it directly.
 */

/** Prisma error codes are short uppercase identifiers such as `P2028`. */
const ERROR_CODE = /^[A-Z0-9_]{2,16}$/;
/** Error class names are printed only when they are plain identifiers. */
const ERROR_NAME = /^[A-Za-z][A-Za-z0-9]{0,63}$/;
// Control characters and ANSI escapes are exactly what has to be stripped here.
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const ANSI_ESCAPES = /\u001b\[[0-9;]*m/g;

const MAX_MESSAGE_LENGTH = 600;
const MAX_META_VALUE_LENGTH = 120;
const MAX_META_ENTRIES = 16;
const MAX_META_DEPTH = 3;
const MIN_SECRET_LENGTH = 3;

export const REDACTED = "[redacted]";
export const REDACTED_HOST = "[redacted-host]";
export const REDACTED_DATABASE_URL = "[redacted-database-url]";

/**
 * A whole database URL, with or without credentials. The entire match is
 * replaced, so no part of the URL (not even the host) is ever printed.
 */
const DATABASE_URL_PATTERN =
  /\b(?:postgres(?:ql)?|mysql|mssql|sqlserver|mongodb(?:\+srv)?|prisma|cockroachdb|redis(?:s)?):\/\/[^\s"'`<>()[\]]+/gi;

/** Any other URL that carries credentials: keep the link, drop the userinfo. */
const URL_CREDENTIALS_PATTERN = /\b([a-z][a-z0-9+.-]*):\/\/[^\s/@]{1,256}@/gi;

/** `password=...`, `sslpassword=...`, `token: ...` and friends. */
const CREDENTIAL_ASSIGNMENT_PATTERN =
  /\b(password|passwd|pwd|sslpassword|secret|token|api[_-]?key)\s*[=:]\s*("[^"]*"|'[^']*'|[^\s,;]+)/gi;

/** `user=...`, `username=...`, `role: ...` and friends. */
const USER_ASSIGNMENT_PATTERN =
  /\b(user|username|role)\s*[=:]\s*("[^"]*"|'[^']*'|[^\s,;]+)/gi;

/** PostgreSQL's `... failed for user "role"` / `... for role "role"` phrasing. */
const USER_MENTION_PATTERN =
  /\b(for (?:user|role)|as user)\s+("[^"]*"|'[^']*'|[^\s,;]+)/gi;

/** Meta keys whose values are credentials, endpoints, or otherwise unsafe. */
const UNSAFE_META_KEY =
  /(?:password|passwd|pwd|secret|token|credential|connection|authorization|auth|url|uri|dsn|key|user|host|email|address|port|string)/i;

export type SeedErrorMetaValue = string | number | boolean;

export interface SeedErrorContext {
  /**
   * Values that must never appear in the report — for example the connection
   * string the command was invoked with. Matching is case-sensitive and
   * literal; the URL is also decomposed so its username, password, and host are
   * scrubbed even when the driver reports them separately.
   */
  secrets?: readonly (string | null | undefined)[];
}

export interface SeedErrorReport {
  /** Prisma error code, or `UNKNOWN` when the failure has none. */
  code: string;
  /** Error class name when it is a plain identifier, otherwise null. */
  name: string | null;
  /** Single-line, redacted, length-capped error message. */
  message: string;
  /** Flattened scalar Prisma metadata with unsafe entries dropped. */
  meta: Record<string, SeedErrorMetaValue>;
  /** Operator-facing next step for the error code (generic when it is unknown). */
  hint: string;
}

const ERROR_HINTS: Record<string, string> = {
  P1000: "The database rejected the credentials. Check the DATABASE_URL configured for this command; its value is never printed.",
  P1001: "The database server could not be reached: check the host and port, the network, and the provider's allowlist (a paused Neon compute can also refuse connections until it wakes).",
  P1002: "The connection attempt timed out: the database may be paused, unreachable from this network, or behind a firewall.",
  P1003: "The database named in DATABASE_URL does not exist.",
  P1017: "The server closed the connection. Retry; if it recurs, check the connection pooler and the database status.",
  P2021: "A table referenced by the seed is missing. Apply the committed migrations first: npm run db:deploy.",
  P2022: "A column referenced by the seed is missing. Apply the committed migrations first: npm run db:deploy.",
  P2025: "A record the seed depended on was not found. Re-run the seed; it is idempotent.",
  P2028:
    "The interactive transaction did not finish inside its budget (see timeout/timeTaken in the metadata above). The catalog seed is idempotent, so re-running it is safe; if it keeps failing, check the network latency to the database and the budget in src/lib/server/seed-catalog.ts.",
};

function safeErrorCode(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    ERROR_CODE.test(error.code)
  ) {
    return error.code;
  }

  return "UNKNOWN";
}

function safeErrorName(error: unknown): string | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    typeof error.name === "string" &&
    ERROR_NAME.test(error.name)
  ) {
    return error.name;
  }

  return null;
}

/** Collapses ANSI escapes, control characters, and newlines into one clean line. */
function normalizeText(value: string): string {
  return value
    .replace(ANSI_ESCAPES, "")
    .replace(CONTROL_CHARACTERS, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function replaceLiteral(value: string, secret: string, replacement: string): string {
  return secret.length >= MIN_SECRET_LENGTH ? value.split(secret).join(replacement) : value;
}

/**
 * Removes the caller's known secrets and credentials that appear verbatim
 * (connection strings, usernames, passwords, hosts) plus the common credential
 * shapes a database driver can echo in a message.
 */
export function redactSecrets(value: string, context: SeedErrorContext = {}): string {
  let redacted = value;

  for (const secret of context.secrets ?? []) {
    const trimmed = secret?.trim();
    if (!trimmed) continue;

    // The full URL first, then its parts, so no substring survives.
    redacted = replaceLiteral(redacted, trimmed, REDACTED_DATABASE_URL);

    try {
      const url = new URL(trimmed);
      for (const part of [url.password, url.username]) {
        if (!part) continue;
        redacted = replaceLiteral(redacted, part, REDACTED);
        let decoded = part;
        try {
          decoded = decodeURIComponent(part);
        } catch {
          // A username or password that is not valid percent-encoding is used as-is.
        }
        redacted = replaceLiteral(redacted, decoded, REDACTED);
      }
      // Longest first: the host with its port, then the bare hostname.
      redacted = replaceLiteral(redacted, url.host, REDACTED_HOST);
      redacted = replaceLiteral(redacted, url.hostname, REDACTED_HOST);
    } catch {
      // Not a URL: the literal replacement above already removed it.
    }
  }

  redacted = redacted.replace(DATABASE_URL_PATTERN, REDACTED_DATABASE_URL);
  redacted = redacted.replace(URL_CREDENTIALS_PATTERN, (_match, scheme: string) => `${scheme}://${REDACTED}@`);
  redacted = redacted.replace(
    CREDENTIAL_ASSIGNMENT_PATTERN,
    (_match, key: string) => `${key}=${REDACTED}`,
  );
  redacted = redacted.replace(USER_ASSIGNMENT_PATTERN, (_match, key: string) => `${key}=${REDACTED}`);
  redacted = redacted.replace(USER_MENTION_PATTERN, (_match, phrase: string) => `${phrase} ${REDACTED}`);

  return redacted;
}

function safeMessage(error: unknown, context: SeedErrorContext): string {
  let message = "";
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    message = error.message;
  } else if (typeof error === "string") {
    message = error;
  }

  const normalized = normalizeText(redactSecrets(message, context));
  if (!normalized) return "The command failed without an error message.";
  return truncate(normalized, MAX_MESSAGE_LENGTH);
}

function collectMeta(
  value: unknown,
  prefix: string,
  meta: Record<string, SeedErrorMetaValue>,
  context: SeedErrorContext,
  depth: number,
): void {
  if (Object.keys(meta).length >= MAX_META_ENTRIES || depth > MAX_META_DEPTH) return;
  if (value === null || value === undefined) return;

  if (typeof value === "string") {
    const normalized = normalizeText(redactSecrets(value, context));
    if (normalized) meta[prefix] = truncate(normalized, MAX_META_VALUE_LENGTH);
    return;
  }

  if (typeof value === "number") {
    if (Number.isFinite(value)) meta[prefix] = value;
    return;
  }

  if (typeof value === "boolean") {
    meta[prefix] = value;
    return;
  }

  if (Array.isArray(value)) {
    value.slice(0, 3).forEach((item, index) => {
      collectMeta(item, `${prefix}[${index}]`, meta, context, depth + 1);
    });
    return;
  }

  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (UNSAFE_META_KEY.test(key)) continue;
      collectMeta(child, prefix ? `${prefix}.${key}` : key, meta, context, depth + 1);
      if (Object.keys(meta).length >= MAX_META_ENTRIES) return;
    }
  }
}

/**
 * Turns any thrown value into a safe, useful report. Never throws: an unknown
 * value yields an `UNKNOWN` code with a generic message rather than echoing
 * whatever was thrown.
 */
export function describeSeedError(
  error: unknown,
  context: SeedErrorContext = {},
): SeedErrorReport {
  const code = safeErrorCode(error);
  return {
    code,
    name: safeErrorName(error),
    message: safeMessage(error, context),
    meta: (() => {
      const meta: Record<string, SeedErrorMetaValue> = {};
      if (typeof error === "object" && error !== null && "meta" in error) {
        collectMeta(error.meta, "", meta, context, 0);
      }
      return meta;
    })(),
    hint: ERROR_HINTS[code] ?? "Check DATABASE_URL, confirm the committed migrations are applied, and review the seed fixtures.",
  };
}

/** Renders a report as the multi-line block the seed CLIs print to stderr. */
export function formatSeedErrorReport(
  report: SeedErrorReport,
  label = "devKitCat catalog seed",
): string {
  const lines = [`[${label}] Failed (${report.code})${report.name ? ` ${report.name}` : ""}.`];
  lines.push(`  message: ${report.message}`);

  const metaEntries = Object.entries(report.meta);
  if (metaEntries.length > 0) {
    lines.push(`  meta: ${metaEntries.map(([key, value]) => `${key}=${value}`).join(" ")}`);
  }
  if (report.hint) lines.push(`  hint: ${report.hint}`);

  return lines.join("\n");
}
