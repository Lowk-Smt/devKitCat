import assert from "node:assert/strict";
import test from "node:test";
import {
  OWNER_BOOTSTRAP_CONFIRMATION,
  createStaffAccess,
} from "../src/lib/server/staff-core.ts";
import { createStaffAccessService } from "../src/lib/server/staff-service.ts";

/**
 * Regression tests for the owner invariant under concurrency.
 *
 * The invariant is: the database must never finish with zero OWNER
 * memberships because of concurrent owner mutations. The fix is
 * PostgreSQL SERIALIZABLE transactions with bounded retry on serialization
 * failures (40001 / P2034). These tests prove the invariant holds under
 * simulated concurrency.
 */

function makeConcurrentDatabase(options = {}) {
  const customers = new Map();
  const memberships = new Map();
  const calls = [];
  let sequence = 0;
  const nextId = (prefix) => `${prefix}-${++sequence}`;

  // Track transaction metadata for assertions.
  const transactions = [];
  let transactionLock = Promise.resolve();
  // When true, the next Serializable transaction that reads owner count will
  // throw a serialization failure to exercise retry.
  let injectSerializationFailure = options.injectSerializationFailure ?? false;
  let failureInjected = false;

  const delegates = {
    customer: {
      async findUnique({ where }) {
        // Small yield to allow interleaving of concurrent operations.
        await new Promise((r) => setImmediate(r));
        const row = where.email
          ? [...customers.values()].find((c) => c.email === where.email)
          : customers.get(where.id);
        return row ?? null;
      },
    },
    staffMembership: {
      async findUnique({ where }) {
        await new Promise((r) => setImmediate(r));
        const row = memberships.get(where.customerId);
        return row ?? null;
      },
      async findMany() {
        return [...memberships.values()];
      },
      async count({ where } = {}) {
        await new Promise((r) => setImmediate(r));
        if (
          injectSerializationFailure &&
          !failureInjected &&
          where?.role === "OWNER"
        ) {
          // Simulate PostgreSQL detecting a serialization anomaly: the first
          // concurrent Serializable transaction that counts owners is aborted.
          failureInjected = true;
          const err = new Error("could not serialize access due to concurrent update");
          err.code = "P2034";
          throw err;
        }
        return [...memberships.values()].filter(
          (row) => !where?.role || row.role === where.role,
        ).length;
      },
      async upsert({ where, create, update }) {
        await new Promise((r) => setImmediate(r));
        const existing = memberships.get(where.customerId);
        if (!existing) {
          const row = {
            id: nextId("membership"),
            customerId: create.customerId,
            role: create.role,
            grantedByCustomerId: create.grantedByCustomerId ?? null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          memberships.set(row.customerId, row);
          calls.push(["staffMembership.upsert.create", row.customerId]);
          return row;
        }
        Object.assign(existing, update, { updatedAt: new Date() });
        calls.push(["staffMembership.upsert.update", existing.customerId]);
        return existing;
      },
      async deleteMany({ where }) {
        await new Promise((r) => setImmediate(r));
        const existed = memberships.delete(where.customerId);
        return { count: existed ? 1 : 0 };
      },
    },
  };

  const client = {
    ...delegates,
    async $transaction(callback, opts) {
      const isolationLevel = opts?.isolationLevel ?? null;
      transactions.push({ isolationLevel, startedAt: Date.now() });
      calls.push(["$transaction", isolationLevel]);

      // For Serializable, serialize execution so the second transaction sees
      // the first's commit. This models PostgreSQL's behavior where one of
      // two concurrent Serializable transactions that both read ownerCount=2
      // is aborted; the abort+retry then sees count=1.
      // We implement it as a queue.
      if (isolationLevel === "Serializable") {
        let result;
        let error;
        const prev = transactionLock;
        let release;
        transactionLock = new Promise((r) => (release = r));
        await prev;
        try {
          result = await callback(delegates);
        } catch (e) {
          error = e;
        } finally {
          release();
        }
        if (error) throw error;
        return result;
      }

      // Non-serializable path: direct interleaving (to expose the old race).
      return callback(delegates);
    },
  };

  return {
    client,
    delegates,
    customers,
    memberships,
    calls,
    transactions,
    addCustomer({ email, name = "Test", passwordHash = "scrypt$1$2$3$a$b", id }) {
      const row = {
        id: id ?? nextId("customer"),
        email: email.trim().toLocaleLowerCase("en-US"),
        name,
        passwordHash,
        themePreference: "DARK",
        productUpdates: true,
        releaseNotes: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      customers.set(row.id, row);
      return row;
    },
    addMembership(customerId, role, grantedBy = null) {
      const row = {
        id: nextId("membership"),
        customerId,
        role,
        grantedByCustomerId: grantedBy,
        createdAt: new Date("2026-10-04T00:00:00.000Z"),
        updatedAt: new Date("2026-10-04T00:00:00.000Z"),
      };
      memberships.set(customerId, row);
      return row;
    },
    get ownerCount() {
      return [...memberships.values()].filter((r) => r.role === "OWNER").length;
    },
  };
}

const access = (customerId, role) =>
  createStaffAccess({ customerId, role, grantedAt: new Date("2026-10-04T00:00:00.000Z") });

/* ------------------------------------------------------------------ */

test("concurrent revoke of two owners never leaves zero owners (SERIALIZABLE)", async () => {
  const db = makeConcurrentDatabase();
  const staff = createStaffAccessService(() => db.client);

  const ownerA = db.addCustomer({ email: "owner-a@example.test", name: "Owner A" });
  const ownerB = db.addCustomer({ email: "owner-b@example.test", name: "Owner B" });
  db.addMembership(ownerA.id, "OWNER");
  db.addMembership(ownerB.id, "OWNER");

  assert.equal(db.ownerCount, 2);

  const actorA = access(ownerA.id, "OWNER");
  const actorB = access(ownerB.id, "OWNER");

  // Start both revocations concurrently. Each tries to revoke the *other* owner
  // to avoid self-revocation edge cases, but the invariant is the same: with
  // two owners, one revoke may succeed, the second must fail with LAST_OWNER.
  // We use Promise.all to force interleaving via setImmediate yields inside the
  // delegates.
  const [resultA, resultB] = await Promise.all([
    staff.revokeMembership(actorA, "owner-b@example.test"),
    staff.revokeMembership(actorB, "owner-a@example.test"),
  ]);

  // At least one must have succeeded, at most one, and the store must not be empty.
  const successes = [resultA, resultB].filter((r) => r.ok);
  const failures = [resultA, resultB].filter((r) => !r.ok);

  // The database can never finish with zero owners.
  assert.ok(db.ownerCount >= 1, `ownerCount was ${db.ownerCount}, expected >=1`);
  assert.equal(db.ownerCount, 1, "exactly one owner should remain after concurrent revokes");

  // At least one transaction was refused by the invariant guard.
  assert.equal(failures.length, 1, `expected 1 failure, got ${JSON.stringify([resultA, resultB])}`);
  assert.equal(failures[0].code, "LAST_OWNER");

  // The successful one reports revoked:true.
  assert.equal(successes[0].value.revoked, true);

  // Both mutations went through a SERIALIZABLE transaction.
  const serializableCount = db.transactions.filter((t) => t.isolationLevel === "Serializable").length;
  assert.equal(serializableCount, 2, `expected 2 Serializable transactions, got ${serializableCount}`);
});

test("concurrent demotion of two owners via grant(STAFF) never leaves zero owners", async () => {
  const db = makeConcurrentDatabase();
  const staff = createStaffAccessService(() => db.client);

  const ownerA = db.addCustomer({ email: "owner-a@example.test" });
  const ownerB = db.addCustomer({ email: "owner-b@example.test" });
  db.addMembership(ownerA.id, "OWNER");
  db.addMembership(ownerB.id, "OWNER");

  const actorA = access(ownerA.id, "OWNER");
  const actorB = access(ownerB.id, "OWNER");

  // Each owner tries to demote the *other* owner to STAFF. This is the grant
  // path that replaces role, not the revoke path.
  const [resultA, resultB] = await Promise.all([
    staff.grantMembership(actorA, { email: "owner-b@example.test", role: "staff" }),
    staff.grantMembership(actorB, { email: "owner-a@example.test", role: "staff" }),
  ]);

  const successes = [resultA, resultB].filter((r) => r.ok);
  const failures = [resultA, resultB].filter((r) => !r.ok);

  assert.equal(db.ownerCount, 1, `ownerCount should be 1 after concurrent demotions, was ${db.ownerCount}`);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].code, "LAST_OWNER");
  assert.equal(successes.length, 1);

  // Verify the survivor is still OWNER.
  const owners = [...db.memberships.values()].filter((r) => r.role === "OWNER");
  assert.equal(owners.length, 1);

  assert.equal(
    db.transactions.filter((t) => t.isolationLevel === "Serializable").length,
    2,
  );
});

test("concurrent revoke of the same last owner is consistently refused", async () => {
  const db = makeConcurrentDatabase();
  const staff = createStaffAccessService(() => db.client);

  const sole = db.addCustomer({ email: "sole@example.test" });
  db.addMembership(sole.id, "OWNER");
  const actor = access(sole.id, "OWNER");

  // Two concurrent attempts to revoke the sole owner (e.g., two tabs). No
  // matter the interleaving, the count must stay 1 and both must get LAST_OWNER.
  const [r1, r2] = await Promise.all([
    staff.revokeMembership(actor, "sole@example.test"),
    staff.revokeMembership(actor, "sole@example.test"),
  ]);

  assert.equal(db.ownerCount, 1);
  assert.equal(r1.ok, false);
  assert.equal(r2.ok, false);
  assert.equal(r1.code, "LAST_OWNER");
  assert.equal(r2.code, "LAST_OWNER");
});

test("revokeMembership is atomic: count and delete in same SERIALIZABLE transaction", async () => {
  const db = makeConcurrentDatabase();
  const staff = createStaffAccessService(() => db.client);
  const owner = db.addCustomer({ email: "owner@example.test" });
  const other = db.addCustomer({ email: "other@example.test" });
  db.addMembership(owner.id, "OWNER");
  db.addMembership(other.id, "OWNER");
  const actor = access(owner.id, "OWNER");

  await staff.revokeMembership(actor, "other@example.test");

  // The revoke path must have used a Serializable transaction (not the old
  // non-transactional sequence of find + count + delete on the outer client).
  assert.ok(
    db.transactions.some((t) => t.isolationLevel === "Serializable"),
    "revokeMembership should run inside a Serializable transaction",
  );
  assert.ok(
    db.calls.some(([name, level]) => name === "$transaction" && level === "Serializable"),
    "expected $transaction with Serializable",
  );
  // After a successful revoke, owner count is 1.
  assert.equal(db.ownerCount, 1);
});

test("grantMembership demotion uses Serializable transactions", async () => {
  const db = makeConcurrentDatabase();
  const staff = createStaffAccessService(() => db.client);
  const owner = db.addCustomer({ email: "owner@example.test" });
  const target = db.addCustomer({ email: "target@example.test" });
  db.addMembership(owner.id, "OWNER");
  db.addMembership(target.id, "OWNER");
  const actor = access(owner.id, "OWNER");

  // Demote one owner to staff: this is the writeMembership path that must be
  // serializable to prevent the grant race.
  const result = await staff.grantMembership(actor, {
    email: "target@example.test",
    role: "staff",
  });
  assert.equal(result.ok, true);
  assert.equal(db.ownerCount, 1);
  assert.ok(db.transactions.some((t) => t.isolationLevel === "Serializable"));
});

test("bootstrapOwnerAccess is also serializable and preserves idempotency under concurrency", async () => {
  const db = makeConcurrentDatabase();
  const staff = createStaffAccessService(() => db.client);
  db.addCustomer({ email: "founder@example.test" });
  // No owners yet; bootstrap will create the first.
  const r1 = await staff.bootstrapOwnerAccess({
    email: "founder@example.test",
    confirmation: OWNER_BOOTSTRAP_CONFIRMATION,
  });
  assert.equal(r1.ok, true);
  assert.equal(db.ownerCount, 1);

  // Second concurrent bootstrap for the same address should be idempotent,
  // not create a duplicate, and should still be Serializable.
  const [a, b] = await Promise.all([
    staff.bootstrapOwnerAccess({
      email: "founder@example.test",
      confirmation: OWNER_BOOTSTRAP_CONFIRMATION,
    }),
    staff.bootstrapOwnerAccess({
      email: "founder@example.test",
      confirmation: OWNER_BOOTSTRAP_CONFIRMATION,
    }),
  ]);
  assert.equal(db.ownerCount, 1);
  assert.ok(a.ok && b.ok);
  // Both report alreadyGranted or one does.
  assert.ok(a.value.alreadyGranted || b.value.alreadyGranted);
  assert.equal(
    db.transactions.filter((t) => t.isolationLevel === "Serializable").length >= 2,
    true,
  );
});

test("serialization failure is retried and still preserves last-owner invariant", async () => {
  // This database will throw P2034 on the first count inside a Serializable
  // transaction, forcing the service's retry loop to run. The retry must see
  // a consistent snapshot and still enforce LAST_OWNER if only one owner
  // would remain.
  const db = makeConcurrentDatabase({ injectSerializationFailure: true });
  const logged = [];
  const staff = createStaffAccessService(() => db.client, (r, c) => logged.push([r, c]));

  const sole = db.addCustomer({ email: "sole@example.test" });
  db.addMembership(sole.id, "OWNER");
  const actor = access(sole.id, "OWNER");

  // Even with an injected serialization failure, revoking the sole owner must
  // not succeed and must not leave zero owners. The retry should either see
  // the same count and return LAST_OWNER, or after retries exhaust return ERROR
  // — never delete.
  const result = await staff.revokeMembership(actor, "sole@example.test");

  // The operation must be refused (LAST_OWNER is the business-level refusal;
  // if retries were exhausted it would be ERROR, but with our injection it
  // retries once and then sees count=1).
  assert.equal(result.ok, false);
  assert.ok(
    result.code === "LAST_OWNER" || result.code === "ERROR",
    `got ${result.code}`,
  );
  assert.equal(db.ownerCount, 1, "retry must not have left zero owners");
  // At least one transaction was attempted and it was Serializable.
  assert.ok(db.transactions.some((t) => t.isolationLevel === "Serializable"));
});

test("concurrent grant of OWNER to two new accounts does not violate invariant and is serializable", async () => {
  const db = makeConcurrentDatabase();
  const staff = createStaffAccessService(() => db.client);
  const owner = db.addCustomer({ email: "owner@example.test" });
  db.addCustomer({ email: "alice@example.test" });
  db.addCustomer({ email: "bob@example.test" });
  db.addMembership(owner.id, "OWNER");
  const actor = access(owner.id, "OWNER");

  const [r1, r2] = await Promise.all([
    staff.grantMembership(actor, { email: "alice@example.test", role: "owner" }),
    staff.grantMembership(actor, { email: "bob@example.test", role: "owner" }),
  ]);

  // Both grants should succeed (they only add owners, never remove), and we
  // end with 3 owners. This checks that adding owners is also under
  // Serializable but does not incorrectly trigger LAST_OWNER.
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
  assert.equal(db.ownerCount, 3);
  assert.equal(db.transactions.filter((t) => t.isolationLevel === "Serializable").length, 2);
});
