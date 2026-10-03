import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_REMEMBER_ME_MAX_AGE_DAYS,
  DEFAULT_SESSION_MAX_AGE_DAYS,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  SCRYPT_BLOCK_SIZE,
  SCRYPT_COST,
  SCRYPT_PARALLELIZATION,
  SESSION_COOKIE_NAME,
  SESSION_TOKEN_BYTES,
  expiredSessionCookieOptions,
  generateSessionToken,
  hashPassword,
  hashSessionToken,
  isSessionTokenValue,
  isValidEmailAddress,
  normalizeDisplayName,
  normalizeEmail,
  parseBooleanFormField,
  parsePasswordHash,
  resolveAuthConfig,
  runPasswordVerificationDecoy,
  sessionCookieOptions,
  sessionExpiresAt,
  validateLoginInput,
  validateProfileInput,
  validateRegistrationInput,
  verifyPassword,
} from "../src/lib/server/auth-core.ts";
import {
  createCustomerAuthService,
  mapCustomerRecord,
} from "../src/lib/server/auth-service.ts";

const repositoryRoot = path.resolve(fileURLToPath(import.meta.url), "../..");
const readSource = (relativePath) =>
  readFile(path.join(repositoryRoot, relativePath), "utf8");

const PASSWORD = "correct-horse-battery";
const testConfig = () => resolveAuthConfig({ NODE_ENV: "development" });

/** Minimal in-memory stand-in for the Prisma client the auth service uses. */
function makeAuthDatabase() {
  const customers = new Map();
  const sessions = new Map();
  const calls = [];
  let nextCustomerId = 0;
  let nextSessionId = 0;

  const publicRow = (row) => ({
    id: row.id,
    email: row.email,
    name: row.name,
    themePreference: row.themePreference,
    productUpdates: row.productUpdates,
    releaseNotes: row.releaseNotes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

  const client = {
    customer: {
      async create({ data }) {
        calls.push(["customer.create", { email: data.email }]);
        const duplicate = [...customers.values()].some((row) => row.email === data.email);
        if (duplicate) {
          throw Object.assign(new Error("Unique constraint failed on Customer.email"), {
            code: "P2002",
          });
        }

        const now = new Date();
        const row = {
          id: `customer-${++nextCustomerId}`,
          email: data.email,
          name: data.name,
          passwordHash: data.passwordHash ?? null,
          themePreference: data.themePreference ?? "DARK",
          productUpdates: data.productUpdates ?? true,
          releaseNotes: data.releaseNotes ?? false,
          createdAt: data.createdAt ?? now,
          updatedAt: now,
        };
        customers.set(row.id, row);
        return publicRow(row);
      },
      async findUnique({ where, select }) {
        calls.push(["customer.findUnique", Object.keys(where).sort()]);
        const row = where.email
          ? [...customers.values()].find((candidate) => candidate.email === where.email)
          : customers.get(where.id);
        if (!row) return null;
        return select?.passwordHash
          ? { ...publicRow(row), passwordHash: row.passwordHash }
          : publicRow(row);
      },
      async update({ where, data }) {
        calls.push(["customer.update", { id: where.id }]);
        const row = customers.get(where.id);
        if (!row) {
          throw Object.assign(new Error("Record to update not found"), { code: "P2025" });
        }

        Object.assign(row, {
          name: data.name ?? row.name,
          themePreference: data.themePreference ?? row.themePreference,
          productUpdates: data.productUpdates ?? row.productUpdates,
          releaseNotes: data.releaseNotes ?? row.releaseNotes,
          updatedAt: new Date(),
        });
        return publicRow(row);
      },
    },
    session: {
      async create({ data }) {
        calls.push(["session.create", { customerId: data.customerId }]);
        const row = {
          id: `session-${++nextSessionId}`,
          tokenHash: data.tokenHash,
          customerId: data.customerId,
          expiresAt: data.expiresAt,
          createdAt: new Date(),
        };
        sessions.set(row.tokenHash, row);
        return { id: row.id };
      },
      async findUnique({ where }) {
        calls.push(["session.findUnique", Object.keys(where)]);
        const row = sessions.get(where.tokenHash);
        if (!row) return null;
        const customer = customers.get(row.customerId);
        return customer
          ? { id: row.id, expiresAt: row.expiresAt, customer: publicRow(customer) }
          : null;
      },
      async delete({ where }) {
        calls.push(["session.delete", { id: where.id }]);
        for (const [tokenHash, row] of sessions) {
          if (row.id === where.id) sessions.delete(tokenHash);
        }
        return { id: where.id };
      },
      async deleteMany({ where }) {
        calls.push(["session.deleteMany", Object.keys(where)]);
        let count = 0;
        for (const [tokenHash, row] of sessions) {
          const matchesToken = where.tokenHash === undefined || row.tokenHash === where.tokenHash;
          const matchesExpiry =
            where.expiresAt?.lt === undefined || row.expiresAt < where.expiresAt.lt;
          if (matchesToken && matchesExpiry) {
            sessions.delete(tokenHash);
            count += 1;
          }
        }
        return { count };
      },
    },
  };

  return { client, customers, sessions, calls };
}

function makeService(database = makeAuthDatabase(), logger = () => {}) {
  return {
    database,
    logged: logger,
    auth: createCustomerAuthService(() => database.client, testConfig, logger),
  };
}

const registration = { name: "Ada Lovelace", email: "ada@example.test", password: PASSWORD };

// --- Password storage -------------------------------------------------------

test("passwords are stored as salted scrypt digests, never as plaintext", async () => {
  const first = await hashPassword(PASSWORD);
  const second = await hashPassword(PASSWORD);

  const parts = first.split("$");
  assert.equal(parts[0], "scrypt");
  assert.deepEqual(
    parts.slice(1, 4).map(Number),
    [SCRYPT_COST, SCRYPT_BLOCK_SIZE, SCRYPT_PARALLELIZATION],
  );
  assert.equal(parts.length, 6);
  assert.ok(!first.includes(PASSWORD));
  assert.ok(!first.toLowerCase().includes("password"));
  // A fresh random salt per hash: identical passwords never produce identical rows.
  assert.notEqual(first, second);
  assert.notEqual(parts[4], second.split("$")[4]);

  assert.equal(await verifyPassword(PASSWORD, first), true);
  assert.equal(await verifyPassword(PASSWORD, second), true);
  assert.equal(await verifyPassword(`${PASSWORD}!`, first), false);
  assert.equal(await verifyPassword("", first), false);
});

test("malformed, absent, or downgraded digests are rejected without deriving a key", async () => {
  const valid = await hashPassword(PASSWORD);
  const [algorithm, cost, blockSize, parallelization, salt, digest] = valid.split("$");

  for (const stored of [
    null,
    undefined,
    "",
    PASSWORD,
    "bcrypt$10$abcdefghijklmnopqrstuv",
    `${algorithm}$${cost}$${blockSize}$${parallelization}$${salt}`,
    `${algorithm}$${cost}$${blockSize}$${parallelization}$${salt}$${digest}$extra`,
    `argon2id$${cost}$${blockSize}$${parallelization}$${salt}$${digest}`,
    // A hostile row must not be able to request an enormous derivation.
    `${algorithm}$999999999$${blockSize}$${parallelization}$${salt}$${digest}`,
    `${algorithm}$not-a-number$${blockSize}$${parallelization}$${salt}$${digest}`,
    `${algorithm}$${cost}$${blockSize}$${parallelization}$c2hvcnQ=$${digest}`,
  ]) {
    assert.equal(await verifyPassword(PASSWORD, stored), false, `accepted ${String(stored)}`);
  }

  assert.equal(parsePasswordHash(valid)?.digest.length, 64);
  assert.equal(parsePasswordHash("scrypt$1$8$1$AAAA$BBBB"), null);
});

test("an unknown account costs the same verification work as a known one", async () => {
  const started = Date.now();
  await runPasswordVerificationDecoy(PASSWORD);
  const decoy = Date.now() - started;

  const stored = await hashPassword(PASSWORD);
  const verifyStarted = Date.now();
  await verifyPassword(PASSWORD, stored);
  const real = Date.now() - verifyStarted;

  assert.ok(decoy > 0 && real > 0);
  // Same order of magnitude: no fast path that reveals a missing account.
  assert.ok(decoy / real > 0.2 && decoy / real < 5, `decoy ${decoy}ms vs real ${real}ms`);
});

// --- Input validation -------------------------------------------------------

test("registration validation accepts a complete, well-formed submission", () => {
  const result = validateRegistrationInput({
    name: "  Ada   Lovelace ",
    email: "  ADA@Example.TEST ",
    password: PASSWORD,
    confirmPassword: PASSWORD,
    acceptTerms: "true",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    name: "Ada Lovelace",
    email: "ada@example.test",
    password: PASSWORD,
  });
});

test("registration validation rejects every incomplete or malformed field", () => {
  const complete = {
    name: "Ada Lovelace",
    email: "ada@example.test",
    password: PASSWORD,
    confirmPassword: PASSWORD,
    acceptTerms: "on",
  };

  const cases = [
    [{ name: "" }, ["name"]],
    [{ name: "   " }, ["name"]],
    [{ name: "A" }, ["name"]],
    [{ name: 42 }, ["name"]],
    [{ email: "" }, ["email"]],
    [{ email: "ada@example" }, ["email"]],
    [{ email: "ada example.test" }, ["email"]],
    [{ email: "@example.test" }, ["email"]],
    [{ email: `a${"b".repeat(300)}@example.test` }, ["email"]],
    [{ password: "short" }, ["password"]],
    [{ password: "".padEnd(PASSWORD_MIN_LENGTH - 1, "a") }, ["password"]],
    [{ password: "a".repeat(PASSWORD_MAX_LENGTH + 1) }, ["password"]],
    [{ password: undefined }, ["password"]],
    [{ confirmPassword: "different-password" }, ["confirmPassword"]],
    [{ acceptTerms: null }, ["acceptTerms"]],
    [{ acceptTerms: "false" }, ["acceptTerms"]],
  ];

  for (const [overrides, expectedFields] of cases) {
    const result = validateRegistrationInput({ ...complete, ...overrides });
    assert.equal(result.ok, false, `accepted ${JSON.stringify(overrides)}`);
    assert.deepEqual(
      Object.keys(result.errors).sort(),
      [...expectedFields].sort(),
      `wrong fields for ${JSON.stringify(overrides)}`,
    );
    assert.ok(result.message);
  }

  // An entirely empty submission reports every required field at once.
  const empty = validateRegistrationInput({});
  assert.equal(empty.ok, false);
  assert.deepEqual(Object.keys(empty.errors).sort(), [
    "acceptTerms",
    "email",
    "name",
    "password",
  ]);
});

test("sign-in validation accepts credentials and rejects malformed input", () => {
  const accepted = validateLoginInput({
    email: " ADA@Example.TEST ",
    password: PASSWORD,
    rememberMe: "true",
  });
  assert.equal(accepted.ok, true);
  assert.deepEqual(accepted.value, {
    email: "ada@example.test",
    password: PASSWORD,
    rememberMe: true,
  });

  assert.equal(validateLoginInput({ email: "ada@example.test", password: PASSWORD }).value.rememberMe, false);

  for (const overrides of [{ email: "nope" }, { password: "" }, { password: undefined }]) {
    assert.equal(
      validateLoginInput({ email: "ada@example.test", password: PASSWORD, ...overrides }).ok,
      false,
      `accepted ${JSON.stringify(overrides)}`,
    );
  }

  const empty = validateLoginInput({});
  assert.equal(empty.ok, false);
  assert.deepEqual(Object.keys(empty.errors).sort(), ["email", "password"]);
});

test("settings validation normalizes the profile and rejects invalid values", () => {
  const accepted = validateProfileInput({
    name: " Grace  Hopper ",
    theme: "SYSTEM",
    productUpdates: "true",
    releaseNotes: null,
  });
  assert.equal(accepted.ok, true);
  assert.deepEqual(accepted.value, {
    name: "Grace Hopper",
    theme: "system",
    productUpdates: true,
    releaseNotes: false,
  });

  const rejected = validateProfileInput({ name: " ", theme: "neon", productUpdates: "on" });
  assert.equal(rejected.ok, false);
  assert.deepEqual(Object.keys(rejected.errors).sort(), ["name", "theme"]);
});

test("email and name normalization strips control characters and case", () => {
  assert.equal(normalizeEmail("  Mixed.Case@Example.TEST "), "mixed.case@example.test");
  assert.equal(normalizeEmail(undefined), "");
  assert.equal(isValidEmailAddress("ada@example.test"), true);
  assert.equal(isValidEmailAddress("ada@example"), false);
  assert.equal(isValidEmailAddress(`a@${"b".repeat(250)}.test`), false);

  assert.equal(normalizeDisplayName("Ada\u0000\u200B  Lovelace\n"), "Ada Lovelace");
  assert.equal(normalizeDisplayName("A".repeat(120)).length, 80);
  assert.equal(parseBooleanFormField("on"), true);
  assert.equal(parseBooleanFormField("TRUE"), true);
  assert.equal(parseBooleanFormField("false"), false);
  assert.equal(parseBooleanFormField(null), false);
});

// --- Session tokens and cookie policy --------------------------------------

test("session tokens are high-entropy and only their hash is comparable", () => {
  const first = generateSessionToken();
  const second = generateSessionToken();

  assert.notEqual(first, second);
  assert.equal(isSessionTokenValue(first), true);
  assert.ok(first.length >= SESSION_TOKEN_BYTES);
  assert.equal(hashSessionToken(first), hashSessionToken(first));
  assert.notEqual(hashSessionToken(first), hashSessionToken(second));
  assert.equal(hashSessionToken(first).length, 64);
  assert.ok(!hashSessionToken(first).includes(first));
});

test("cookie values that are not tokens never reach a database lookup", () => {
  for (const value of [
    undefined,
    null,
    "",
    " ",
    "1' OR '1'='1",
    "a".repeat(42),
    "a".repeat(44),
    generateSessionToken().replace(/.$/, "="),
    `${generateSessionToken()} extra`,
  ]) {
    assert.equal(isSessionTokenValue(value), false, `accepted ${String(value)}`);
  }
});

test("session cookies are HttpOnly, SameSite=Lax, path-scoped, and Secure in production", () => {
  assert.equal(SESSION_COOKIE_NAME, "devkitcat_session");

  const production = resolveAuthConfig({ NODE_ENV: "production" });
  const development = resolveAuthConfig({ NODE_ENV: "development" });
  assert.equal(production.secureCookies, true);
  assert.equal(development.secureCookies, false);
  // Secure can be forced on for HTTPS previews, but never off in production.
  assert.equal(resolveAuthConfig({ NODE_ENV: "development", AUTH_COOKIE_SECURE: "true" }).secureCookies, true);
  assert.equal(resolveAuthConfig({ NODE_ENV: "production", AUTH_COOKIE_SECURE: "false" }).secureCookies, true);

  const now = new Date("2026-10-03T00:00:00.000Z");
  const expiresAt = sessionExpiresAt(now, false, development);
  assert.equal(expiresAt.toISOString(), "2026-10-10T00:00:00.000Z");
  assert.deepEqual(sessionCookieOptions(expiresAt, now, development), {
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
    maxAge: DEFAULT_SESSION_MAX_AGE_DAYS * 86_400,
  });

  const remembered = sessionCookieOptions(sessionExpiresAt(now, true, development), now, development);
  assert.equal(remembered.maxAge, DEFAULT_REMEMBER_ME_MAX_AGE_DAYS * 86_400);

  const cleared = expiredSessionCookieOptions(production);
  assert.deepEqual(cleared, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    expires: new Date(0),
    maxAge: 0,
  });
});

test("session lifetime configuration ignores invalid and unsafe values", () => {
  const defaults = resolveAuthConfig({ NODE_ENV: "test" });
  assert.equal(defaults.sessionMaxAgeDays, DEFAULT_SESSION_MAX_AGE_DAYS);
  assert.equal(defaults.rememberMeMaxAgeDays, DEFAULT_REMEMBER_ME_MAX_AGE_DAYS);

  for (const value of ["0", "-3", "1000", "abc", "", undefined]) {
    assert.equal(
      resolveAuthConfig({ NODE_ENV: "test", AUTH_SESSION_MAX_AGE_DAYS: value }).sessionMaxAgeDays,
      DEFAULT_SESSION_MAX_AGE_DAYS,
      `accepted ${String(value)}`,
    );
  }

  assert.equal(resolveAuthConfig({ NODE_ENV: "test", AUTH_SESSION_MAX_AGE_DAYS: "1" }).sessionMaxAgeDays, 1);
  // "Remember me" can never be shorter than the default session.
  assert.equal(
    resolveAuthConfig({
      NODE_ENV: "test",
      AUTH_SESSION_MAX_AGE_DAYS: "90",
      AUTH_REMEMBER_ME_MAX_AGE_DAYS: "2",
    }).rememberMeMaxAgeDays,
    90,
  );
});

// --- Registration and sign-in against the database --------------------------

test("registration creates a customer whose stored password is only a digest", async () => {
  const { auth, database } = makeService();
  const result = await auth.registerCustomer(registration);

  assert.equal(result.ok, true);
  assert.equal(result.value.email, "ada@example.test");
  assert.equal(result.value.name, "Ada Lovelace");
  assert.deepEqual(result.value.preferences, {
    theme: "dark",
    productUpdates: true,
    releaseNotes: false,
  });

  const stored = [...database.customers.values()][0];
  assert.ok(stored.passwordHash.startsWith("scrypt$"));
  assert.notEqual(stored.passwordHash, PASSWORD);
  assert.ok(!stored.passwordHash.includes(PASSWORD));
  assert.equal(await verifyPassword(PASSWORD, stored.passwordHash), true);

  // The value handed to the UI carries no credential material at all.
  assert.deepEqual(Object.keys(result.value).sort(), [
    "createdAt",
    "email",
    "id",
    "name",
    "preferences",
    "updatedAt",
  ]);
  assert.ok(!JSON.stringify(result.value).includes("scrypt$"));
});

test("a duplicate email address is rejected and creates no second customer", async () => {
  const { auth, database } = makeService();
  assert.equal((await auth.registerCustomer(registration)).ok, true);

  const duplicate = await auth.registerCustomer({
    ...registration,
    email: "  ADA@EXAMPLE.TEST ",
    password: "another-password",
  });

  assert.deepEqual(duplicate, { ok: false, code: "EMAIL_TAKEN" });
  assert.equal(database.customers.size, 1);
  assert.equal(database.calls.filter(([name]) => name === "customer.create").length, 2);
});

test("sign-in succeeds with the right password and fails cleanly otherwise", async () => {
  const { auth, database } = makeService();
  const created = await auth.registerCustomer(registration);
  assert.equal(created.ok, true);

  const success = await auth.verifyCredentials({ email: " ADA@Example.TEST ", password: PASSWORD });
  assert.equal(success.ok, true);
  assert.equal(success.value.id, created.value.id);

  const wrongPassword = await auth.verifyCredentials({ email: registration.email, password: `${PASSWORD}!` });
  assert.deepEqual(wrongPassword, { ok: false, code: "INVALID_CREDENTIALS" });

  const unknownEmail = await auth.verifyCredentials({ email: "nobody@example.test", password: PASSWORD });
  assert.deepEqual(unknownEmail, { ok: false, code: "INVALID_CREDENTIALS" });

  // A customer row without a password (the seeded fixture) cannot sign in.
  await database.client.customer.create({
    data: { email: "fixture@example.test", name: "Fixture Customer" },
  });
  const noPassword = await auth.verifyCredentials({ email: "fixture@example.test", password: PASSWORD });
  assert.deepEqual(noPassword, { ok: false, code: "INVALID_CREDENTIALS" });
  assert.equal(database.sessions.size, 0);
});

test("database failures stay generic and never leak credentials into logs", async () => {
  const logged = [];
  const database = makeAuthDatabase();
  const secret = "postgres://user:super-secret@database.example/devkitcat";
  database.client.customer.create = async () => {
    throw Object.assign(new Error(`Cannot reach ${secret}`), { code: "P1001" });
  };
  const auth = createCustomerAuthService(
    () => database.client,
    testConfig,
    (resource, code) => logged.push({ resource, code }),
  );

  const result = await auth.registerCustomer(registration);
  assert.deepEqual(result, { ok: false, code: "ERROR" });
  assert.deepEqual(logged, [{ resource: "registration", code: "P1001" }]);
  assert.ok(!JSON.stringify(logged).includes("super-secret"));
  assert.ok(!JSON.stringify(logged).includes(PASSWORD));
});

test("without a configured database no account operation succeeds or falls back", async () => {
  const auth = createCustomerAuthService(() => null, testConfig, () => {});

  assert.equal(auth.isAvailable(), false);
  assert.deepEqual(await auth.registerCustomer(registration), { ok: false, code: "UNAVAILABLE" });
  assert.deepEqual(
    await auth.verifyCredentials({ email: registration.email, password: PASSWORD }),
    { ok: false, code: "UNAVAILABLE" },
  );
  assert.deepEqual(await auth.createSession("customer-1"), { ok: false, code: "UNAVAILABLE" });
  assert.deepEqual(await auth.readSession(generateSessionToken()), { ok: false, code: "UNAVAILABLE" });
  assert.deepEqual(await auth.destroySession(generateSessionToken()), { ok: false, code: "UNAVAILABLE" });
  assert.deepEqual(
    await auth.updateProfile("customer-1", {
      name: "Ada",
      theme: "dark",
      productUpdates: true,
      releaseNotes: false,
    }),
    { ok: false, code: "UNAVAILABLE" },
  );
});

test("an unusable DATABASE_URL is treated as unavailable instead of throwing", () => {
  const logged = [];
  const auth = createCustomerAuthService(
    () => {
      throw new Error("DATABASE_URL must be a valid PostgreSQL connection URL.");
    },
    testConfig,
    (resource, code) => logged.push({ resource, code }),
  );

  assert.equal(auth.isAvailable(), false);
  assert.deepEqual(logged, [{ resource: "database configuration", code: "INVALID_DATABASE_URL" }]);
});

// --- Sessions ---------------------------------------------------------------

test("a session stores only a token hash and returns the owning customer", async () => {
  const { auth, database } = makeService();
  const customer = (await auth.registerCustomer(registration)).value;

  const issued = await auth.createSession(customer.id, { rememberMe: false });
  assert.equal(issued.ok, true);
  assert.equal(isSessionTokenValue(issued.value.token), true);

  const stored = [...database.sessions.values()][0];
  assert.equal(stored.tokenHash, hashSessionToken(issued.value.token));
  assert.ok(!stored.tokenHash.includes(issued.value.token));
  assert.equal(stored.customerId, customer.id);
  assert.equal(stored.expiresAt.getTime(), issued.value.expiresAt.getTime());
  const daysUntilExpiry = (stored.expiresAt.getTime() - Date.now()) / 86_400_000;
  assert.ok(daysUntilExpiry > 6.9 && daysUntilExpiry <= 7, `${daysUntilExpiry} days`);

  const read = await auth.readSession(issued.value.token);
  assert.equal(read.ok, true);
  assert.equal(read.value.customer.id, customer.id);
  assert.equal(read.value.customer.email, customer.email);
  assert.equal(read.value.sessionId, stored.id);
  assert.deepEqual(Object.keys(read.value.customer).sort(), [
    "createdAt",
    "email",
    "id",
    "name",
    "preferences",
    "updatedAt",
  ]);
});

test("remember-me issues a longer-lived session than a normal sign-in", async () => {
  const { auth } = makeService();
  const customer = (await auth.registerCustomer(registration)).value;
  const now = new Date("2026-10-03T12:00:00.000Z");

  const short = await auth.createSession(customer.id, { rememberMe: false, now });
  const long = await auth.createSession(customer.id, { rememberMe: true, now });

  assert.equal(short.value.expiresAt.toISOString(), "2026-10-10T12:00:00.000Z");
  assert.equal(long.value.expiresAt.toISOString(), "2026-11-02T12:00:00.000Z");
});

test("logout revokes the stored session so the same cookie stops working", async () => {
  const { auth, database } = makeService();
  const customer = (await auth.registerCustomer(registration)).value;
  const issued = (await auth.createSession(customer.id)).value;

  assert.equal((await auth.readSession(issued.token)).ok, true);

  const destroyed = await auth.destroySession(issued.token);
  assert.deepEqual(destroyed, { ok: true, value: { destroyed: true } });
  assert.equal(database.sessions.size, 0);

  // The cookie value is unchanged, but the server no longer accepts it.
  assert.deepEqual(await auth.readSession(issued.token), { ok: false, code: "INVALID_SESSION" });
  assert.deepEqual(await auth.destroySession(issued.token), { ok: true, value: { destroyed: false } });
});

test("expired, tampered, and unknown sessions are rejected", async () => {
  const { auth, database } = makeService();
  const customer = (await auth.registerCustomer(registration)).value;
  const now = new Date("2026-10-03T00:00:00.000Z");
  const issued = (await auth.createSession(customer.id, { now })).value;

  // Still valid one second before expiry, invalid at expiry, and cleaned up.
  assert.equal((await auth.readSession(issued.token, { now: new Date("2026-10-09T23:59:59.000Z") })).ok, true);
  const expired = await auth.readSession(issued.token, { now: new Date("2026-10-10T00:00:00.000Z") });
  assert.deepEqual(expired, { ok: false, code: "INVALID_SESSION" });
  assert.equal(database.sessions.size, 0);
  assert.ok(database.calls.some(([name]) => name === "session.delete"));

  assert.deepEqual(await auth.readSession(generateSessionToken()), { ok: false, code: "INVALID_SESSION" });
  assert.deepEqual(await auth.readSession("not-a-token"), { ok: false, code: "INVALID_SESSION" });
});

test("signing in again leaves other devices signed in", async () => {
  const { auth, database } = makeService();
  const customer = (await auth.registerCustomer(registration)).value;
  const first = (await auth.createSession(customer.id)).value;
  const second = (await auth.createSession(customer.id)).value;

  assert.equal(database.sessions.size, 2);
  assert.equal((await auth.readSession(first.token)).ok, true);
  assert.equal((await auth.readSession(second.token)).ok, true);

  await auth.destroySession(second.token);
  assert.equal((await auth.readSession(first.token)).ok, true);
  assert.equal((await auth.readSession(second.token)).ok, false);
});

// --- Profile updates --------------------------------------------------------

test("profile updates change only the session customer's own record", async () => {
  const { auth, database } = makeService();
  const customer = (await auth.registerCustomer(registration)).value;
  const other = (
    await auth.registerCustomer({ ...registration, email: "grace@example.test", name: "Grace Hopper" })
  ).value;

  const updated = await auth.updateProfile(customer.id, {
    name: "Ada L.",
    theme: "system",
    productUpdates: false,
    releaseNotes: true,
  });

  assert.equal(updated.ok, true);
  assert.equal(updated.value.name, "Ada L.");
  assert.deepEqual(updated.value.preferences, {
    theme: "system",
    productUpdates: false,
    releaseNotes: true,
  });
  assert.equal(database.customers.get(other.id).name, "Grace Hopper");
  assert.equal(database.customers.get(other.id).themePreference, "DARK");
  assert.deepEqual(database.calls.filter(([name]) => name === "customer.update"), [
    ["customer.update", { id: customer.id }],
  ]);

  assert.deepEqual(await auth.updateProfile("missing-customer", {
    name: "Nobody",
    theme: "dark",
    productUpdates: true,
    releaseNotes: false,
  }), { ok: false, code: "NOT_FOUND" });
});

test("the customer projection never carries a password digest", async () => {
  const record = mapCustomerRecord({
    id: "customer-1",
    email: "ada@example.test",
    name: "Ada Lovelace",
    themePreference: "SYSTEM",
    productUpdates: false,
    releaseNotes: true,
    createdAt: new Date("2026-10-03T00:00:00.000Z"),
    updatedAt: new Date("2026-10-03T00:00:00.000Z"),
  });

  assert.deepEqual(record, {
    id: "customer-1",
    email: "ada@example.test",
    name: "Ada Lovelace",
    preferences: { theme: "system", productUpdates: false, releaseNotes: true },
    createdAt: new Date("2026-10-03T00:00:00.000Z"),
    updatedAt: new Date("2026-10-03T00:00:00.000Z"),
  });
  assert.ok(!("passwordHash" in record));
  assert.ok(!("tokenHash" in record));
});

// --- Route and configuration guards ----------------------------------------

const PROTECTED_ROUTES = [
  "src/app/account/layout.tsx",
  "src/app/account/page.tsx",
  "src/app/account/purchases/page.tsx",
  "src/app/account/purchases/[id]/page.tsx",
  "src/app/account/downloads/page.tsx",
  "src/app/account/settings/page.tsx",
];

for (const route of PROTECTED_ROUTES) {
  test(`${route} is gated by requireCustomer()`, async () => {
    const source = await readSource(route);
    assert.match(source, /requireCustomer\(\)/);
    assert.match(source, /from "@\/lib\/server\/auth"/);
    // No screen falls back to the PR #4 demo identity any more.
    assert.doesNotMatch(source, /mock-account|mockAccountPresentation/);
  });
}

test("account data reads are scoped to the authenticated customer", async () => {
  const purchases = await readSource("src/app/account/purchases/page.tsx");
  const downloads = await readSource("src/app/account/downloads/page.tsx");
  const order = await readSource("src/app/account/purchases/[id]/page.tsx");

  assert.match(purchases, /listCustomerOrders\(customer\.id\)/);
  assert.match(downloads, /listCustomerDownloads\(customer\.id\)/);
  // The route parameter supplies only the order ID, never the owner.
  assert.match(order, /getCustomerOrderById\(customer\.id, id\)/);
});

test("server actions authorize before mutating and return no credential material", async () => {
  const source = await readSource("src/lib/server/auth-actions.ts");

  assert.match(source, /^"use server";/m);
  assert.match(source, /const customer = await requireCustomer\(\);/);
  assert.match(source, /customerAuth\.updateProfile\(customer\.id,/);
  assert.match(source, /signOutCurrentSession\(\)/);
  assert.match(source, /revalidatePath\("\/account", "layout"\)/);
  // No account identifier is accepted from the client for a mutation.
  assert.doesNotMatch(source, /formData\.get\("(customerId|id|passwordHash)"\)/);
  // Returned state fields never carry credential material.
  assert.doesNotMatch(source, /(message|errors|status|email):\s*[^,\n]*password/);
});

test("authentication modules never log passwords, digests, tokens, or secrets", async () => {
  const modules = [
    "src/lib/server/auth-core.ts",
    "src/lib/server/auth-service.ts",
    "src/lib/server/auth.ts",
    "src/lib/server/auth-actions.ts",
  ];

  for (const modulePath of modules) {
    const source = await readSource(modulePath);
    assert.doesNotMatch(
      source,
      /console\.(log|error|warn|info|debug)\([^)]*(password|token|secret|digest|hash)/i,
      `${modulePath} logs credential material`,
    );
  }

  // The reusable customer projection must never select the digest, so no caller
  // can accidentally forward it to a component.
  const service = await readSource("src/lib/server/auth-service.ts");
  const projection = /CUSTOMER_SELECT = \{([\s\S]*?)\}/.exec(service)[1];
  assert.doesNotMatch(projection, /passwordHash/);
  assert.match(projection, /email: true/);
});

test("environment configuration is templated without secrets and stays untracked", async () => {
  const example = await readSource(".env.example");
  const ignore = await readSource(".gitignore");

  assert.match(example, /DATABASE_URL=/);
  assert.match(example, /postgresql:\/\/postgres:postgres@localhost:5432\/devkitcat/);
  assert.doesNotMatch(example, /SECRET\s*=\s*["']?[A-Za-z0-9+/]{16,}/);
  assert.doesNotMatch(example, /BEGIN [A-Z ]*PRIVATE KEY/);
  assert.match(ignore, /^\.env\*$/m);
  assert.match(ignore, /^!\.env\.example$/m);
});
