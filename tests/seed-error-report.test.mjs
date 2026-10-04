import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  describeSeedError,
  formatSeedErrorReport,
  REDACTED,
  REDACTED_DATABASE_URL,
  REDACTED_HOST,
  redactSecrets,
} from "../src/lib/server/seed-error.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

/** The production-shaped connection string the CLI is pointed at. */
const NEON_URL =
  "postgresql://neondb_owner:npg_S3cretP4ss@ep-cool-rain-123456-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require";
const NEON_HOST = "ep-cool-rain-123456-pooler.us-east-1.aws.neon.tech";

function reportOutput(error, context) {
  return formatSeedErrorReport(describeSeedError(error, context));
}

test("P2028 transaction timeouts keep their code, message, and useful metadata", () => {
  const error = Object.assign(
    new Error(
      "Transaction API error: A query cannot be executed on an expired transaction. " +
        "The timeout for this transaction was 5000 ms, however 5792 ms passed since the " +
        "start of the transaction. Consider increasing the interactive transaction timeout " +
        "or doing less work in the transaction.",
    ),
    {
      name: "PrismaClientKnownRequestError",
      code: "P2028",
      meta: { modelName: "ProductImage", operation: "query", timeout: 5000, timeTaken: 5792 },
    },
  );

  const report = describeSeedError(error);
  assert.equal(report.code, "P2028");
  assert.equal(report.name, "PrismaClientKnownRequestError");
  assert.match(report.message, /expired transaction/);
  assert.match(report.message, /timeout for this transaction was 5000 ms/);
  assert.deepEqual(report.meta, {
    modelName: "ProductImage",
    operation: "query",
    timeout: 5000,
    timeTaken: 5792,
  });
  assert.match(report.hint, /idempotent/);

  const output = reportOutput(error);
  assert.match(
    output,
    /^\[devKitCat catalog seed\] Failed \(P2028\) PrismaClientKnownRequestError\./,
  );
  assert.match(output, /\n {2}message: Transaction API error: A query cannot be executed/);
  assert.match(
    output,
    /\n {2}meta: modelName=ProductImage operation=query timeout=5000 timeTaken=5792/,
  );
  // The report is what the previous CLI could not print: the code alone was not
  // enough to tell a 5s transaction timeout from a connection failure.
  assert.ok(output.includes("Consider increasing the interactive transaction timeout"));
});

test("the connection string, username, password, and host never reach the report", () => {
  const error = Object.assign(
    new Error(`Can't reach database server at ${NEON_HOST}:5432`),
    {
      name: "PrismaClientKnownRequestError",
      code: "P1001",
      meta: {
        driverAdapterError: {
          name: "DriverAdapterError",
          cause: { kind: "DatabaseNotReachable", host: NEON_HOST, port: 5432 },
        },
      },
    },
  );

  const output = reportOutput(error, { secrets: [NEON_URL] });

  for (const secret of [
    NEON_URL,
    "npg_S3cretP4ss",
    "neondb_owner",
    NEON_HOST,
    "neon.tech",
    "sslmode",
    "://",
  ]) {
    assert.ok(!output.includes(secret), `report must not contain ${secret}:\n${output}`);
  }

  assert.match(output, /Failed \(P1001\) PrismaClientKnownRequestError\./);
  assert.ok(output.includes(`Can't reach database server at ${REDACTED_HOST}`));
  assert.ok(output.includes("driverAdapterError.cause.kind=DatabaseNotReachable"));
});

test("credential-shaped text is redacted even without a known connection string", () => {
  const message =
    'connection failed: password=hunter2 user="neondb_owner" ' +
    "postgres://someuser:somepass@db.example.test:5432/app?sslmode=require " +
    "hook https://service:tok3n@example.test/hook";

  const redacted = redactSecrets(message);

  assert.ok(!redacted.includes("hunter2"), redacted);
  assert.ok(!redacted.includes("neondb_owner"), redacted);
  assert.ok(!redacted.includes("someuser"), redacted);
  assert.ok(!redacted.includes("somepass"), redacted);
  assert.ok(!redacted.includes("db.example.test"), redacted);
  assert.ok(!redacted.includes("tok3n"), redacted);

  // Non-database links stay usable; only their credentials are dropped.
  assert.ok(redacted.includes("https://[redacted]@example.test/hook"), redacted);
  assert.ok(redacted.includes(`password=${REDACTED}`), redacted);
  assert.ok(redacted.includes("user=[redacted]"), redacted);
  assert.ok(redacted.includes(REDACTED_DATABASE_URL), redacted);
});

test("a database URL echoed by a driver is replaced whole, with no network details left", () => {
  const output = reportOutput(
    Object.assign(new Error(`failed to connect using ${NEON_URL}`), { code: "P1000" }),
  );

  assert.ok(!output.includes(NEON_HOST), output);
  assert.ok(!output.includes("neondb_owner"), output);
  assert.ok(!output.includes("npg_S3cretP4ss"), output);
  assert.ok(output.includes(REDACTED_DATABASE_URL), output);
  assert.match(output, /hint: The database rejected the credentials\./);
});

test("metadata is flattened to safe scalars: credential keys and deep nesting are dropped", () => {
  const report = describeSeedError({
    code: "P1001",
    meta: {
      user: "neondb_owner",
      password: "hunter2",
      connectionString: NEON_URL,
      target: ["Product", "id"],
      active: true,
      retries: 3,
      missing: null,
      driverAdapterError: {
        name: "DriverAdapterError",
        cause: { kind: "DatabaseNotReachable", host: NEON_HOST, port: 5432 },
      },
      too: { deep: { nested: { value: "never printed" } } },
    },
  });

  assert.deepEqual(Object.keys(report.meta).sort(), [
    "active",
    "driverAdapterError.cause.kind",
    "driverAdapterError.name",
    "retries",
    "target[0]",
    "target[1]",
  ]);
  assert.deepEqual(report.meta, {
    active: true,
    "driverAdapterError.cause.kind": "DatabaseNotReachable",
    "driverAdapterError.name": "DriverAdapterError",
    retries: 3,
    "target[0]": "Product",
    "target[1]": "id",
  });
  assert.equal(Object.values(report.meta).includes("never printed"), false);
  assert.equal(Object.values(report.meta).includes("neondb_owner"), false);
  assert.equal(Object.values(report.meta).includes("hunter2"), false);
});

test("unexpected thrown values stay useful and never echo unknown objects", () => {
  assert.equal(describeSeedError(undefined).code, "UNKNOWN");
  assert.match(describeSeedError(undefined).message, /without an error message/);
  assert.match(describeSeedError(undefined).hint, /Check DATABASE_URL/);

  assert.equal(describeSeedError("boom").message, "boom");
  assert.equal(describeSeedError({ code: "definitely not a code" }).code, "UNKNOWN");

  // A circular payload must not make the reporter throw or print the object.
  const circular = { message: "circular" };
  circular.self = circular;
  const report = describeSeedError(circular);
  assert.equal(report.code, "UNKNOWN");
  assert.equal(report.message, "circular");

  // Secrets hidden in a message of a non-Error value are still redacted.
  const sneaky = describeSeedError({ message: `crashed at ${NEON_URL}` });
  assert.ok(!sneaky.message.includes(NEON_HOST));
  assert.equal(sneaky.message, `crashed at ${REDACTED_DATABASE_URL}`);
});

test("the report is one line per field: control characters and newlines are collapsed", () => {
  const report = describeSeedError(
    Object.assign(new Error("\u001b[31mboom\u001b[0m\nline two\n\n\nline four"), {
      code: "P2022",
    }),
  );

  assert.equal(report.message, "boom line two line four");
  assert.match(formatSeedErrorReport(report), /hint: A column referenced by the seed is missing\./);
});

test("the catalog seed CLI fails closed with a sanitized report and no credentials", () => {
  const username = "neondb_owner";
  const password = "sup3r-secret-value";
  const connectionString = `postgresql://${username}:${password}@127.0.0.1:1/neondb?sslmode=disable`;

  // Port 1 on the loopback interface refuses immediately: the run fails at
  // connection time, which is the path whose output used to hide the cause.
  const failure = spawnSync(
    process.execPath,
    ["--conditions=react-server", "--import=tsx", path.join(repoRoot, "prisma", "seed-catalog.ts")],
    {
      env: { ...process.env, DATABASE_URL: connectionString },
      encoding: "utf8",
      timeout: 60_000,
    },
  );

  const output = failure.stderr + failure.stdout;

  assert.equal(failure.status, 1);
  assert.match(output, /\[devKitCat catalog seed\] Failed \(P\d{4}\) \w+\./);
  assert.match(output, /\n {2}message: /);
  assert.match(output, /\n {2}hint: /);

  for (const secret of [connectionString, username, password, "127.0.0.1", "neondb", "://"]) {
    assert.ok(!output.includes(secret), `CLI output must not contain ${secret}:\n${output}`);
  }

  assert.ok(
    output.includes(REDACTED_HOST),
    `the unreachable host must be reported as redacted:\n${output}`,
  );
});
