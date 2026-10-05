import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  MANAGE_NOTICES,
  OWNER_BOOTSTRAP_CONFIRMATION,
  ROLE_PRIVILEGES,
  STAFF_PRIVILEGES,
  canManageStaffAccess,
  createStaffAccess,
  describeStaffFailure,
  evaluateMembershipChange,
  hasStaffPrivilege,
  isStaffRoleName,
  parseBootstrapOwnerEmails,
  parseGrantableStaffRole,
  parseStaffRoleInput,
  resolveManageNotice,
  staffNoticeCode,
} from "../src/lib/server/staff-core.ts";
import { createStaffAccessService } from "../src/lib/server/staff-service.ts";
import {
  productNoticeCode,
  productValidationNoticeCode,
  slugifyProductSlug,
  validateProductDraftInput,
  parsePublicationFlag,
  isProductId,
  PRODUCT_DRAFT_DEFAULTS,
} from "../src/lib/server/product-admin-core.ts";
import { createProductAdminService } from "../src/lib/server/product-admin-service.ts";
import { createCustomerAuthService, CUSTOMER_SELECT } from "../src/lib/server/auth-service.ts";
import { createMarketplaceDataAccess } from "../src/lib/server/data-access-core.ts";

/**
 * Tests for Phase 1 of the private creator-management system.
 *
 * The suite is arranged the way the code is: the policy is exercised as pure
 * functions, the database behaviour against an in-memory Prisma stand-in, and the
 * request-facing wiring against the source of the modules that perform it (a
 * Server Function cannot be invoked outside a Next.js runtime, so its
 * authorization order is asserted structurally, the same way the authentication
 * tests assert the account gates).
 *
 * The four questions the business decision depends on are asked at every layer:
 * unauthenticated, ordinary customer, authorized staff, and "can this account
 * make itself staff?"
 */

const repositoryRoot = path.resolve(fileURLToPath(import.meta.url), "../..");
const readSource = (relativePath) =>
  readFile(path.join(repositoryRoot, relativePath), "utf8");
const readCode = async (relativePath) => codeOf(await readSource(relativePath));

/**
 * Comments are where the design rationale lives, including the names of the
 * things a guard refuses to do. Source-level assertions therefore read the code
 * with block and line comments removed, so a doc comment saying "never
 * `unstable_cache`" cannot fail (or satisfy) a guard by accident.
 */
function codeOf(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/* In-memory Prisma stand-in
   ------------------------------------------------------------------ */

/** Applies a Prisma `select` object, so projections are honoured by the stub. */
function project(row, select) {
  if (!select) return row;

  const output = {};
  for (const [key, value] of Object.entries(select)) {
    if (value === false) continue;
    if (value === true) {
      if (key in row) output[key] = row[key];
      continue;
    }
    if (typeof value === "object" && value !== null) {
      if (!(key in row)) continue;
      const nested = row[key];
      output[key] = Array.isArray(nested)
        ? nested.map((item) => project(item, value.select ?? value))
        : project(nested, value.select ?? value);
    }
  }

  return output;
}

const baseProduct = {
  id: "prosave",
  slug: "prosave",
  title: "ProSave — DataStore System",
  description: "Persistent player data with retries and session locking.",
  overview: ["A reliable player-data layer."],
  price: "14.99",
  type: "SYSTEM",
  version: "1.4.2",
  features: [],
  requirements: [],
  includedFiles: [],
  installation: [],
  documentationSummary: "Setup and API documentation.",
  documentationTopics: [],
  license: "devKitCat Standard License",
  releasedAt: new Date("2026-03-12T00:00:00.000Z"),
  isFeatured: true,
  isNew: false,
  published: true,
  sortOrder: 0,
  categoryId: "systems",
  createdAt: new Date("2026-03-12T00:00:00.000Z"),
  updatedAt: new Date("2026-08-14T00:00:00.000Z"),
};

/** A database stand-in covering the tables staff authorization and product management use. */
function makeDatabase(options = {}) {
  const customers = new Map();
  const memberships = new Map();
  const products = new Map();
  const categories = new Map([
    ["systems", { id: "systems", name: "Systems", slug: "systems" }],
    ["vfx", { id: "vfx", name: "VFX", slug: "vfx" }],
  ]);
  const references = { orderItem: [], download: [], cartItem: [] };
  const calls = [];
  let sequence = 0;

  if (options.withProducts !== false) {
    products.set(baseProduct.id, { ...baseProduct, category: categories.get("systems") });
    products.set("vfx-starter-pack", {
      ...baseProduct,
      id: "vfx-starter-pack",
      slug: "vfx-starter-pack",
      title: "VFX Starter Pack",
      type: "VFX_PACK",
      price: "8.99",
      isFeatured: false,
      published: false,
      categoryId: "vfx",
      category: categories.get("vfx"),
    });
  }

  const attachRelations = (row) => ({
    ...row,
    images: [],
    modelPreviews: [],
    changelog: [],
    orderItems: references.orderItem
      .filter((item) => item.productId === row.id)
      .map((item) => ({ id: item.id })),
    downloads: references.download
      .filter((item) => item.productId === row.id)
      .map((item) => ({ id: item.id })),
    cartItems: references.cartItem
      .filter((item) => item.productId === row.id)
      .map((item) => ({ id: item.id })),
  });

  const findProduct = (where = {}) => {
    for (const row of products.values()) {
      if (where.id !== undefined && row.id !== where.id) continue;
      if (where.slug !== undefined && row.slug !== where.slug) continue;
      if (where.published !== undefined && row.published !== where.published) continue;
      if (where.NOT?.id !== undefined && row.id === where.NOT.id) continue;
      return row;
    }

    return null;
  };

  const nextId = (prefix) => `${prefix}-${++sequence}`;

  const delegates = {
    customer: {
      async create({ data, select }) {
        calls.push(["customer.create", { email: data.email }]);
        if ([...customers.values()].some((row) => row.email === data.email)) {
          throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
        }

        const now = new Date();
        const row = {
          id: data.id ?? nextId("customer"),
          email: data.email,
          name: data.name,
          passwordHash: data.passwordHash ?? null,
          themePreference: "DARK",
          productUpdates: true,
          releaseNotes: false,
          createdAt: now,
          updatedAt: now,
        };
        customers.set(row.id, row);
        return project(row, select) ?? row;
      },
      async findUnique({ where, select }) {
        const row = where.email
          ? [...customers.values()].find((candidate) => candidate.email === where.email)
          : customers.get(where.id);
        return row ? project(row, select) ?? row : null;
      },
      async update({ where, data, select }) {
        const row = customers.get(where.id);
        if (!row) throw Object.assign(new Error("not found"), { code: "P2025" });
        Object.assign(row, data, { updatedAt: new Date() });
        return project(row, select) ?? row;
      },
    },
    staffMembership: {
      async findUnique({ where, select }) {
        const row = memberships.get(where.customerId);
        return row ? project(row, select) ?? row : null;
      },
      async findMany({ select } = {}) {
        const rows = [...memberships.values()].sort((a, b) =>
          String(a.role).localeCompare(String(b.role)) ||
          a.createdAt.getTime() - b.createdAt.getTime(),
        );
        return rows.map((row) => {
          const withCustomer = { ...row, customer: customers.get(row.customerId) };
          return project(withCustomer, select) ?? withCustomer;
        });
      },
      async count({ where } = {}) {
        return [...memberships.values()].filter(
          (row) => !where?.role || row.role === where.role,
        ).length;
      },
      async upsert({ where, create, update, select }) {
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
          return project(row, select) ?? row;
        }

        Object.assign(existing, update, { updatedAt: new Date() });
        calls.push(["staffMembership.upsert.update", existing.customerId]);
        return project(existing, select) ?? existing;
      },
      async deleteMany({ where }) {
        const existed = memberships.delete(where.customerId);
        return { count: existed ? 1 : 0 };
      },
    },
    product: {
      async findMany({ where = {}, select } = {}) {
        const rows = [...products.values()]
          .filter((row) => {
            if (where.published !== undefined && row.published !== where.published) return false;
            if (where.isFeatured !== undefined && row.isFeatured !== where.isFeatured) return false;
            return true;
          })
          .sort(
            (a, b) =>
              Number(a.published) - Number(b.published) || a.slug.localeCompare(b.slug),
          );
        return rows.map((row) => {
          const full = attachRelations(row);
          return project(full, select) ?? full;
        });
      },
      async findFirst({ where = {}, select } = {}) {
        const row = findProduct(where);
        if (!row) return null;
        const full = attachRelations(row);
        return project(full, select) ?? full;
      },
      async findUnique({ where, select }) {
        const row = findProduct(where);
        if (!row) return null;
        const full = attachRelations(row);
        return project(full, select) ?? full;
      },
      async create({ data, select }) {
        calls.push(["product.create", { slug: data.slug, published: data.published }]);
        if ([...products.values()].some((row) => row.slug === data.slug)) {
          throw Object.assign(new Error("Unique constraint failed on Product.slug"), {
            code: "P2002",
          });
        }

        const now = new Date();
        // Defaults first, then the columns the write actually supplied: the
        // created row has to look like a row Prisma would have returned.
        const row = {
          ...baseProduct,
          category: categories.get(data.categoryId),
          ...data,
          id: nextId("product"),
          createdAt: now,
          updatedAt: now,
        };
        products.set(row.id, row);
        const full = attachRelations(row);
        return project(full, select) ?? full;
      },
      async update({ where, data, select }) {
        calls.push(["product.update", { id: where.id, ...data }]);
        const row = products.get(where.id);
        if (!row) throw Object.assign(new Error("not found"), { code: "P2025" });
        if (data.slug && data.slug !== row.slug) {
          const taken = [...products.values()].some(
            (candidate) => candidate.slug === data.slug && candidate.id !== row.id,
          );
          if (taken) {
            throw Object.assign(new Error("Unique constraint failed on Product.slug"), {
              code: "P2002",
            });
          }
        }

        Object.assign(row, data, {
          category: data.categoryId ? categories.get(data.categoryId) : row.category,
          updatedAt: new Date(),
        });
        const full = attachRelations(row);
        return project(full, select) ?? full;
      },
      async delete({ where }) {
        calls.push(["product.delete", where.id]);
        const referenced = [...references.orderItem, ...references.download, ...references.cartItem].some(
          (item) => item.productId === where.id,
        );
        if (referenced) {
          throw Object.assign(new Error("Foreign key constraint violated"), { code: "P2003" });
        }
        if (!products.delete(where.id)) {
          throw Object.assign(new Error("not found"), { code: "P2025" });
        }

        return { id: where.id };
      },
    },
    category: {
      async findUnique({ where }) {
        const row = categories.get(where.slug);
        return row ?? null;
      },
    },
    orderItem: {
      async count({ where }) {
        return references.orderItem.filter((item) => item.productId === where.productId).length;
      },
    },
    download: {
      async count({ where }) {
        return references.download.filter((item) => item.productId === where.productId).length;
      },
    },
    cartItem: {
      async count({ where }) {
        return references.cartItem.filter((item) => item.productId === where.productId).length;
      },
    },
  };

  const client = {
    ...delegates,
    async $transaction(callback) {
      return callback(delegates);
    },
  };

  return {
    client,
    delegates,
    customers,
    memberships,
    products,
    categories,
    references,
    calls,
    /** Adds a customer directly, bypassing registration, for fixture setup. */
    addCustomer({ email, name = "Test", passwordHash = "scrypt$1$2$3$a$b", id }) {
      const row = {
        id: id ?? nextId("customer"),
        // Registration stores the normalized address, so the fixture does too.
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
    /** Writes a membership directly, simulating a previous run or a bad row. */
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
    addReference(kind, productId) {
      references[kind].push({ id: nextId(kind), productId });
    },
  };
}

function makeServices(database) {
  const staff = createStaffAccessService(() => database.client);
  const products = createProductAdminService(() => database.client);
  const auth = createCustomerAuthService(() => database.client, () => ({
    cookieName: "devkitcat_session",
    sessionMaxAgeDays: 7,
    rememberMeMaxAgeDays: 30,
    secureCookies: false,
  }));

  return { staff, products, auth };
}

const access = (customerId, role, grantedAt = new Date("2026-10-04T00:00:00.000Z")) =>
  createStaffAccess({ customerId, role, grantedAt });

/* Part 1 — the policy itself
   ------------------------------------------------------------------ */

test("only owners and staff hold product privileges, and only owners manage staff", () => {
  assert.deepEqual([...ROLE_PRIVILEGES.staff], [
    "products:view",
    "products:manage",
    "products:delete",
  ]);
  assert.deepEqual([...ROLE_PRIVILEGES.owner], [
    "products:view",
    "products:manage",
    "products:delete",
    "staff:manage",
  ]);

  assert.equal(hasStaffPrivilege(access("c1", "STAFF"), "products:manage"), true);
  assert.equal(hasStaffPrivilege(access("c1", "OWNER"), "staff:manage"), true);
  assert.equal(hasStaffPrivilege(access("c1", "STAFF"), "staff:manage"), false);
  assert.equal(canManageStaffAccess(access("c1", "STAFF")), false);
});

test("every staff privilege is granted by at most the owner role", () => {
  for (const privilege of STAFF_PRIVILEGES) {
    for (const role of ["staff", "owner"]) {
      const granted = ROLE_PRIVILEGES[role].includes(privilege);
      if (privilege === "staff:manage") {
        assert.equal(granted, role === "owner", `${role}/${privilege}`);
      } else {
        assert.equal(granted, true, `${role}/${privilege}`);
      }
    }
  }
});

test("authorization fails closed for missing, forged, or unknown access", () => {
  assert.equal(hasStaffPrivilege(null, "products:manage"), false);
  assert.equal(hasStaffPrivilege(undefined, "products:manage"), false);

  // A hand-built object that carries its own privilege list grants nothing:
  // privileges are derived from the role, never read off the value.
  assert.equal(
    hasStaffPrivilege({ customerId: "c1", role: "owner", privileges: ["staff:manage"] }, "products:manage"),
    true,
  );
  assert.equal(
    hasStaffPrivilege({ customerId: "c1", role: "admin", privileges: ["staff:manage"] }, "staff:manage"),
    false,
  );
  assert.equal(hasStaffPrivilege({ customerId: "c1", role: "OWNER" }, "staff:manage"), false);

  // `createStaffAccess` is the only producer, and it refuses everything else.
  assert.equal(createStaffAccess({ customerId: "c1", role: "ADMIN" }), null);
  assert.equal(createStaffAccess({ customerId: "", role: "OWNER" }), null);
  assert.equal(createStaffAccess({ customerId: "c1", role: null }), null);
  assert.equal(createStaffAccess({ customerId: "c1", role: "OWNER" }).role, "owner");
  assert.equal(createStaffAccess({ customerId: "c1", role: "staff" }).role, "staff");
});

test("a role can only ever be one of the two names, and never defaulted upward", () => {
  assert.equal(parseStaffRoleInput("owner"), "owner");
  assert.equal(parseStaffRoleInput("  STAFF "), "staff");
  assert.equal(isStaffRoleName("Owner"), true);

  for (const value of ["admin", "OWNER ", "true", true, 1, null, undefined, {}, [], "creator"]) {
    // "OWNER " is trimmed by the parser, so it is the one accepted variant here.
    if (value === "OWNER ") continue;
    assert.equal(parseStaffRoleInput(value), null, String(value));
  }

  // The grantable parse defaults down, never up.
  assert.equal(parseGrantableStaffRole("owner"), "owner");
  assert.equal(parseGrantableStaffRole("OWNER"), "owner");
  for (const value of [undefined, null, "", "admin", "creator", "OWNER; DELETE", {}]) {
    assert.equal(parseGrantableStaffRole(value), "staff", String(value));
  }
});

test("the last owner cannot be demoted or revoked", () => {
  const owner = access("owner-1", "OWNER");
  const staff = access("staff-1", "STAFF");

  // Refused: a staff member changing access at all.
  assert.deepEqual(
    evaluateMembershipChange({
      actor: staff,
      currentRole: null,
      requestedRole: "owner",
      ownerCount: 1,
    }),
    { ok: false, code: "FORBIDDEN" },
  );

  // Refused: the only owner stepping down or revoking themself.
  assert.deepEqual(
    evaluateMembershipChange({
      actor: owner,
      currentRole: "owner",
      requestedRole: "staff",
      ownerCount: 1,
    }),
    { ok: false, code: "LAST_OWNER" },
  );
  assert.deepEqual(
    evaluateMembershipChange({
      actor: owner,
      currentRole: "owner",
      requestedRole: null,
      ownerCount: 1,
    }),
    { ok: false, code: "LAST_OWNER" },
  );

  // Allowed: a second owner exists, so the first can go.
  assert.deepEqual(
    evaluateMembershipChange({
      actor: owner,
      currentRole: "owner",
      requestedRole: null,
      ownerCount: 2,
    }),
    { ok: true },
  );

  // Allowed: re-granting OWNER to the only owner changes nothing.
  assert.deepEqual(
    evaluateMembershipChange({
      actor: owner,
      currentRole: "owner",
      requestedRole: "owner",
      ownerCount: 1,
    }),
    { ok: true },
  );

  // Allowed: granting staff when nobody is losing owner status.
  assert.deepEqual(
    evaluateMembershipChange({
      actor: owner,
      currentRole: null,
      requestedRole: "staff",
      ownerCount: 1,
    }),
    { ok: true },
  );

  // The bootstrap command has no actor yet, and only it may claim that.
  assert.deepEqual(
    evaluateMembershipChange({
      actor: null,
      currentRole: null,
      requestedRole: "owner",
      ownerCount: 0,
      bootstrap: true,
    }),
    { ok: true },
  );
  assert.deepEqual(
    evaluateMembershipChange({
      actor: null,
      currentRole: null,
      requestedRole: "owner",
      ownerCount: 0,
    }),
    { ok: false, code: "FORBIDDEN" },
  );
});

test("notices are an allowlist and never echo the requested value", () => {
  assert.deepEqual(resolveManageNotice({ notice: "published" }), {
    tone: "ok",
    message: MANAGE_NOTICES.published.message,
  });
  assert.equal(resolveManageNotice({ notice: "denied" }).tone, "problem");
  assert.equal(resolveManageNotice({ notice: "made-up" }), null);
  assert.equal(resolveManageNotice({ notice: "<script>alert(1)</script>" }), null);
  assert.equal(resolveManageNotice({}), null);
  assert.equal(resolveManageNotice({ notice: ["created", "deleted"] }).message, MANAGE_NOTICES.created.message);

  // Every mapping target exists, so a service can never redirect to an unknown notice.
  const staffCodes = [
    "UNAVAILABLE",
    "UNAUTHENTICATED",
    "FORBIDDEN",
    "INVALID_INPUT",
    "NOT_FOUND",
    "LAST_OWNER",
    "ERROR",
  ];
  for (const code of staffCodes) {
    assert.ok(code in MANAGE_NOTICES === false || typeof staffNoticeCode(code) === "string");
    assert.ok(Object.hasOwn(MANAGE_NOTICES, staffNoticeCode(code)), code);
  }

  const productCodes = [
    "UNAVAILABLE",
    "UNAUTHENTICATED",
    "FORBIDDEN",
    "INVALID_TITLE",
    "INVALID_SLUG",
    "INVALID_DESCRIPTION",
    "INVALID_PRICE",
    "INVALID_TYPE",
    "INVALID_CATEGORY",
    "INVALID_VERSION",
    "SLUG_TAKEN",
    "NOT_FOUND",
    "IN_USE",
    "ERROR",
  ];
  for (const code of productCodes) {
    assert.ok(Object.hasOwn(MANAGE_NOTICES, productNoticeCode(code)), code);
  }

  assert.equal(productNoticeCode("FORBIDDEN"), "denied");
  assert.equal(productNoticeCode("ERROR"), "error");
  assert.equal(productNoticeCode("UNAUTHENTICATED"), "signed-out");
  assert.equal(productValidationNoticeCode({ price: "x" }), "invalid-price");
  assert.equal(productValidationNoticeCode({ slug: "x" }), "invalid-slug");
  assert.equal(productValidationNoticeCode({}), "invalid-input");
});

test("refusal copy never reveals whether an account or a row exists", () => {
  assert.doesNotMatch(describeStaffFailure("FORBIDDEN"), /staff list|not found|does not exist/i);
  assert.doesNotMatch(describeStaffFailure("UNAUTHENTICATED"), /staff list|permission/i);

  // A refusal and an internal failure both stay generic, and neither names a
  // customer, an address, or the size of the staff list.
  for (const code of ["FORBIDDEN", "ERROR", "UNAUTHENTICATED"]) {
    const notice = MANAGE_NOTICES[staffNoticeCode(code)];
    assert.equal(notice.tone, "problem", code);
    assert.doesNotMatch(notice.message, /@|customer id|not found|no such/i, code);
  }
  assert.equal(staffNoticeCode("FORBIDDEN"), "denied");
  assert.equal(staffNoticeCode("ERROR"), "error");
});

test("the bootstrap email list is validated, deduplicated, and capped", () => {
  const parsed = parseBootstrapOwnerEmails(
    "  Ada@Example.test , grace@example.test;ada@example.test  broken ,  ",
  );
  assert.deepEqual(parsed.emails, ["ada@example.test", "grace@example.test"]);
  assert.deepEqual(parsed.rejected, ["broken"]);
  assert.equal(parsed.truncated, false);

  const tooMany = parseBootstrapOwnerEmails(
    Array.from({ length: 12 }, (_, index) => `owner${index}@example.test`).join(","),
  );
  assert.equal(tooMany.emails.length, 10);
  assert.equal(tooMany.truncated, true);

  assert.deepEqual(parseBootstrapOwnerEmails(undefined), {
    emails: [],
    rejected: [],
    truncated: false,
  });

  // Control characters and ANSI escapes cannot ride an operator's terminal.
  const hostile = parseBootstrapOwnerEmails("ada@example.test\u001b[31m\u0007 \u0000x@example.test");
  assert.equal(hostile.rejected.length, 2);
  for (const token of hostile.rejected) {
    assert.doesNotMatch(token, /[\u0000-\u001f\u007f\u001b]/);
  }
});

/* Part 2 — the staff service against a database stand-in
   ------------------------------------------------------------------ */

test("a deployment without a database reports itself unavailable", async () => {
  const service = createStaffAccessService(() => null);

  assert.equal(service.isAvailable(), false);
  assert.deepEqual(await service.getAccessForCustomer("c1"), { ok: false, code: "UNAVAILABLE" });
  assert.deepEqual(await service.listMemberships(access("c1", "OWNER")), {
    ok: false,
    code: "UNAVAILABLE",
  });
  assert.deepEqual(await service.grantMembership(access("c1", "OWNER"), { email: "a@b.test", role: "staff" }), {
    ok: false,
    code: "UNAVAILABLE",
  });
  assert.deepEqual(await service.revokeMembership(access("c1", "OWNER"), "a@b.test"), {
    ok: false,
    code: "UNAVAILABLE",
  });
  assert.deepEqual(
    await service.bootstrapOwnerAccess({
      email: "a@b.test",
      confirmation: OWNER_BOOTSTRAP_CONFIRMATION,
    }),
    { ok: false, code: "UNAVAILABLE" },
  );
});

test("unauthenticated requests are refused before any query runs", async () => {
  const database = makeDatabase();
  const { staff } = makeServices(database);

  for (const actor of [null, undefined]) {
    assert.deepEqual(await staff.grantMembership(actor, { email: "ada@example.test", role: "owner" }), {
      ok: false,
      code: "UNAUTHENTICATED",
    });
    assert.deepEqual(await staff.revokeMembership(actor, "ada@example.test"), {
      ok: false,
      code: "UNAUTHENTICATED",
    });
    assert.deepEqual(await staff.listMemberships(actor), { ok: false, code: "UNAUTHENTICATED" });
  }

  // A customer id that is not an id is refused too, so no lookup is attempted.
  assert.deepEqual(await staff.getAccessForCustomer(""), { ok: false, code: "UNAUTHENTICATED" });
  assert.deepEqual(await staff.getAccessForCustomer("not an id!!"), {
    ok: false,
    code: "UNAUTHENTICATED",
  });
  assert.equal(database.memberships.size, 0);
});

test("an ordinary customer resolves to no access at all", async () => {
  const database = makeDatabase();
  const { staff, auth } = makeServices(database);

  const registration = await auth.registerCustomer({
    name: "Ada Lovelace",
    email: "ada@example.test",
    password: "correct-horse-battery",
  });
  assert.equal(registration.ok, true);

  const result = await staff.getAccessForCustomer(registration.value.id);
  assert.deepEqual(result, { ok: true, value: null });

  // Registering wrote no grant, and there is nothing to grant from the client side.
  assert.equal(database.memberships.size, 0);
  const stored = database.customers.get(registration.value.id);
  assert.ok(!("role" in stored) && !("staffRole" in stored) && !("isStaff" in stored));

  // Every privileged write is refused for a customer-shaped actor.
  const customerActor = { customerId: registration.value.id, role: undefined };
  assert.deepEqual(await staff.listMemberships(customerActor), { ok: false, code: "FORBIDDEN" });
  assert.deepEqual(await staff.grantMembership(customerActor, { email: "ada@example.test", role: "owner" }), {
    ok: false,
    code: "FORBIDDEN",
  });
  assert.deepEqual(await staff.revokeMembership(customerActor, "ada@example.test"), {
    ok: false,
    code: "FORBIDDEN",
  });
  assert.equal(database.memberships.size, 0);
});

test("a stored role the policy does not know grants nothing", async () => {
  const database = makeDatabase();
  const { staff } = makeServices(database);
  const customer = database.addCustomer({ email: "ghost@example.test" });

  // Simulates a future enum value or a hand-edited row: fail closed.
  database.addMembership(customer.id, "SUPPORT");
  assert.deepEqual(await staff.getAccessForCustomer(customer.id), { ok: true, value: null });

  const productsService = createProductAdminService(() => database.client);
  assert.deepEqual(await productsService.listProducts(null), {
    ok: false,
    code: "UNAUTHENTICATED",
  });
});

test("the owner grant, directory, and revocation flow work end to end", async () => {
  const database = makeDatabase();
  const { staff } = makeServices(database);

  const owner = database.addCustomer({ email: "owner@example.test", name: "Owner" });
  const staffMember = database.addCustomer({ email: "staff@example.test", name: "Staffy" });
  const other = database.addCustomer({ email: "other@example.test", name: "Other" });
  database.addMembership(owner.id, "OWNER");

  const ownerAccess = access(owner.id, "OWNER");
  assert.deepEqual(await staff.getAccessForCustomer(owner.id), {
    ok: true,
    value: { customerId: owner.id, role: "owner", grantedAt: new Date("2026-10-04T00:00:00.000Z") },
  });

  const granted = await staff.grantMembership(ownerAccess, {
    email: "STAFF@example.test",
    role: "staff",
  });
  assert.equal(granted.ok, true);
  assert.equal(granted.value.email, "staff@example.test");
  assert.equal(granted.value.role, "staff");
  assert.equal(granted.value.alreadyGranted, false);
  assert.equal(granted.value.canSignIn, true);
  assert.equal(granted.value.bootstrapped, false);
  assert.equal(database.memberships.get(staffMember.id).grantedByCustomerId, owner.id);

  // The grant is real for the target account.
  assert.equal((await staff.getAccessForCustomer(staffMember.id)).value.role, "staff");

  // Re-granting the same role is idempotent and never stacks a second row.
  const again = await staff.grantMembership(ownerAccess, {
    email: "staff@example.test",
    role: "staff",
  });
  assert.equal(again.value.alreadyGranted, true);
  assert.equal(database.memberships.size, 2);

  // The directory is owner-only and shows both grants with identity only.
  const directory = await staff.listMemberships(ownerAccess);
  assert.equal(directory.ok, true);
  assert.deepEqual(
    directory.value.map((row) => [row.email, row.role]).sort(),
    [
      ["owner@example.test", "owner"],
      ["staff@example.test", "staff"],
    ],
  );
  assert.deepEqual(Object.keys(directory.value[0]).sort(), [
    "bootstrapped",
    "customerId",
    "email",
    "grantedAt",
    "name",
    "role",
  ]);

  assert.deepEqual(await staff.listMemberships(access(staffMember.id, "STAFF")), {
    ok: false,
    code: "FORBIDDEN",
  });

  // An unknown address is refused, and nothing is created for it.
  const unknown = await staff.grantMembership(ownerAccess, {
    email: "nobody@example.test",
    role: "staff",
  });
  assert.deepEqual(unknown, { ok: false, code: "NOT_FOUND" });
  assert.equal(database.memberships.size, 2);

  // Revoking leaves the customer account intact.
  const revoked = await staff.revokeMembership(ownerAccess, "staff@example.test");
  assert.deepEqual(revoked, { ok: true, value: { revoked: true } });
  assert.equal(database.memberships.has(staffMember.id), false);
  assert.equal(database.customers.has(staffMember.id), true);
  assert.deepEqual(await staff.getAccessForCustomer(staffMember.id), { ok: true, value: null });

  // Revoking twice, or revoking a plain customer, is a NOT_FOUND rather than a
  // silent success.
  assert.deepEqual(await staff.revokeMembership(ownerAccess, "staff@example.test"), {
    ok: false,
    code: "NOT_FOUND",
  });
  assert.deepEqual(await staff.revokeMembership(ownerAccess, "other@example.test"), {
    ok: false,
    code: "NOT_FOUND",
  });
  assert.equal(database.memberships.size, 1);
  assert.ok(other.id);
});

test("a malformed grant target never reaches a query", async () => {
  const database = makeDatabase();
  const { staff } = makeServices(database);
  const owner = database.addCustomer({ email: "owner@example.test" });
  database.addMembership(owner.id, "OWNER");
  const actor = access(owner.id, "OWNER");

  for (const email of ["", "  ", "nope", {}, null, undefined, "a@b".repeat(80)]) {
    assert.deepEqual(await staff.grantMembership(actor, { email, role: "staff" }), {
      ok: false,
      code: "INVALID_INPUT",
    }, String(email));
  }

  // A role outside the enum is refused rather than defaulted.
  assert.deepEqual(
    await staff.grantMembership(actor, { email: "nobody@example.test", role: "admin" }),
    { ok: false, code: "INVALID_INPUT" },
  );
  assert.equal(database.memberships.size, 1);
});

test("nobody can grant themselves access", async () => {
  const database = makeDatabase();
  const { staff, auth } = makeServices(database);
  const owner = database.addCustomer({ email: "owner@example.test" });
  database.addMembership(owner.id, "OWNER");

  // A registered customer tries the owner-only grant, aimed at themself.
  const attacker = (
    await auth.registerCustomer({
      name: "Wannabe",
      email: "wannabe@example.test",
      password: "correct-horse-battery",
    })
  ).value;

  for (const actor of [null, { customerId: attacker.id, role: undefined }, access(attacker.id, "STAFF")]) {
    const attempt = await staff.grantMembership(actor, {
      email: "wannabe@example.test",
      role: "owner",
    });
    assert.equal(attempt.ok, false);
    assert.ok(["UNAUTHENTICATED", "FORBIDDEN"].includes(attempt.code), attempt.code);
  }

  assert.equal(database.memberships.has(attacker.id), false);
  assert.deepEqual(await staff.getAccessForCustomer(attacker.id), { ok: true, value: null });

  // A staff member cannot promote themself or anyone else to owner.
  const helper = database.addCustomer({ email: "helper@example.test" });
  database.addMembership(helper.id, "STAFF");
  assert.deepEqual(
    await staff.grantMembership(access(helper.id, "STAFF"), {
      email: "helper@example.test",
      role: "owner",
    }),
    { ok: false, code: "FORBIDDEN" },
  );
  assert.equal(database.memberships.get(helper.id).role, "STAFF");

  // The bootstrap path needs the confirmation literal; any other value is refused
  // without touching the database.
  assert.deepEqual(
    await staff.bootstrapOwnerAccess({ email: "wannabe@example.test", confirmation: "please" }),
    { ok: false, code: "FORBIDDEN" },
  );
  assert.equal(database.memberships.has(attacker.id), false);
});

test("the bootstrap command promotes exactly the address it was handed", async () => {
  const database = makeDatabase();
  const { staff } = makeServices(database);
  const founder = database.addCustomer({ email: "Founder@Example.test", name: "Founder" });
  // An earlier registration must not be swept up by a bootstrap run.
  database.addCustomer({ email: "first-signup@example.test", name: "First Signup" });

  const result = await staff.bootstrapOwnerAccess({
    email: "founder@example.test",
    confirmation: OWNER_BOOTSTRAP_CONFIRMATION,
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.value.role, "owner");
  assert.equal(result.value.bootstrapped, true);
  assert.equal(result.value.customerId, founder.id);
  assert.equal(database.memberships.size, 1);
  assert.equal(database.memberships.get(founder.id).grantedByCustomerId, null);
  assert.deepEqual(await staff.getAccessForCustomer(founder.id), {
    ok: true,
    value: { customerId: founder.id, role: "owner", grantedAt: expectDate(result.value.grantedAt) },
  });

  // An address with no account is refused instead of creating one.
  assert.deepEqual(
    await staff.bootstrapOwnerAccess({
      email: "whoever@example.test",
      confirmation: OWNER_BOOTSTRAP_CONFIRMATION,
    }),
    { ok: false, code: "NOT_FOUND" },
  );
  assert.equal(database.memberships.size, 1);
});

function expectDate(value) {
  return value instanceof Date ? value : undefined;
}

test("the bootstrap command refuses an account that cannot sign in", async () => {
  const database = makeDatabase();
  const { staff } = makeServices(database);
  // The seeded fixture customer: an account with no password digest.
  database.addCustomer({
    email: "demo-customer@example.test",
    name: "Demo",
    passwordHash: null,
    id: "demo-customer",
  });

  const summary = await staff.describeBootstrapAccount("demo-customer@example.test");
  assert.equal(summary.ok, true);
  assert.equal(summary.value.canSignIn, false);
  assert.equal(summary.value.currentRole, null);

  const granted = await staff.bootstrapOwnerAccess({
    email: "demo-customer@example.test",
    confirmation: OWNER_BOOTSTRAP_CONFIRMATION,
  });
  // The service would accept it; the CLI refuses it. Assert both halves so the
  // refusal is a deliberate product decision rather than an accident.
  assert.equal(granted.ok, true);
  assert.equal(granted.value.canSignIn, false);

  const cli = await readSource("prisma/grant-owner-runner.ts");
  assert.match(cli, /canSignIn/);
  assert.match(cli, /refused \(this account has no password and cannot sign in\)/);
});

test("the last owner cannot lock themselves out through the service either", async () => {
  const database = makeDatabase();
  const { staff } = makeServices(database);
  const soleOwner = database.addCustomer({ email: "sole@example.test" });
  database.addMembership(soleOwner.id, "OWNER");
  const actor = access(soleOwner.id, "OWNER");

  assert.deepEqual(await staff.revokeMembership(actor, "sole@example.test"), {
    ok: false,
    code: "LAST_OWNER",
  });
  assert.deepEqual(await staff.grantMembership(actor, { email: "sole@example.test", role: "staff" }), {
    ok: false,
    code: "LAST_OWNER",
  });
  assert.equal(database.memberships.get(soleOwner.id).role, "OWNER");

  // Once a second owner exists, stepping down is allowed.
  database.addCustomer({ email: "second@example.test" });
  const promoted = await staff.grantMembership(actor, { email: "second@example.test", role: "owner" });
  assert.equal(promoted.ok, true);
  assert.deepEqual(await staff.revokeMembership(actor, "sole@example.test"), {
    ok: true,
    value: { revoked: true },
  });
});

test("promoting an account to OWNER is idempotent and audited", async () => {
  const database = makeDatabase();
  const { staff } = makeServices(database);
  const owner = database.addCustomer({ email: "owner@example.test" });
  const target = database.addCustomer({ email: "target@example.test" });
  database.addMembership(owner.id, "OWNER");

  const first = await staff.grantMembership(access(owner.id, "OWNER"), {
    email: "target@example.test",
    role: "owner",
  });
  assert.equal(first.ok, true);

  const second = await staff.grantMembership(access(owner.id, "OWNER"), {
    email: "target@example.test",
    role: "owner",
  });
  assert.equal(second.value.alreadyGranted, true);
  assert.equal(database.memberships.size, 2);
  assert.equal(database.memberships.get(target.id).role, "OWNER");
  assert.equal(
    database.memberships.get(target.id).grantedByCustomerId,
    owner.id,
    "the audit trail records who issued the grant",
  );
});

test("the staff service never returns credential fields", async () => {
  const database = makeDatabase();
  const { staff } = makeServices(database);
  const owner = database.addCustomer({ email: "owner@example.test", passwordHash: "scrypt$1$2$3$s$d" });
  database.addMembership(owner.id, "OWNER");

  const directory = await staff.listMemberships(access(owner.id, "OWNER"));
  assert.equal(directory.ok, true);
  const serialized = JSON.stringify(directory.value);
  assert.ok(!serialized.includes("scrypt$"));
  assert.ok(!serialized.includes("passwordHash"));

  const grant = await staff.grantMembership(access(owner.id, "OWNER"), {
    email: "owner@example.test",
    role: "owner",
  });
  assert.ok(!JSON.stringify(grant.value).includes("scrypt$"));
  assert.deepEqual(Object.keys(grant.value).sort(), [
    "alreadyGranted",
    "bootstrapped",
    "canSignIn",
    "customerId",
    "email",
    "grantedAt",
    "name",
    "role",
  ]);
});

test("logging a staff failure never includes an address, id, or digest", async () => {
  const logged = [];
  const staff = createStaffAccessService(
    () => {
      throw new Error("DATABASE_URL is postgresql://owner:hunter2@private-host:5432/db");
    },
    (resource, code) => logged.push([resource, code]),
  );

  assert.deepEqual(await staff.getAccessForCustomer("c1"), { ok: false, code: "UNAVAILABLE" });
  const text = JSON.stringify(logged);
  assert.ok(!text.includes("hunter2"));
  assert.ok(!text.includes("private-host"));
  assert.ok(!text.includes("c1"));
});

/* Part 3 — product management
   ------------------------------------------------------------------ */

/** The form the management screen submits. */
const validDraftForm = {
  title: "Cozy Lounge Kit",
  slug: "cozy-lounge-kit",
  description: "A furnished lounge set with seating, lighting, and triggers.",
  price: "19.99",
  type: "starter-kit",
  category: "systems",
  version: "1.0.0",
};

/** The server-validated payload the service accepts (`categorySlug`, fixed price). */
const validDraft = {
  title: validDraftForm.title,
  slug: validDraftForm.slug,
  description: validDraftForm.description,
  price: "19.99",
  type: "starter-kit",
  categorySlug: "systems",
  version: "1.0.0",
};

test("the draft validator rejects malformed content instead of coercing it", () => {
  assert.deepEqual(validateProductDraftInput(validDraftForm), {
    ok: true,
    value: {
      title: validDraftForm.title,
      slug: validDraftForm.slug,
      description: validDraftForm.description,
      price: "19.99",
      type: validDraftForm.type,
      // The validated payload names the category by slug, and the price is
      // fixed-point text rather than a float.
      categorySlug: validDraftForm.category,
      version: validDraftForm.version,
    },
  });

  // A blank slug is derived from the title, so the public URL is never blank.
  assert.equal(
    validateProductDraftInput({ ...validDraftForm, slug: "  " }).value.slug,
    "cozy-lounge-kit",
  );

  const failures = validateProductDraftInput({
    ...validDraftForm,
    title: "ab",
    slug: "!!!",
    description: "too short",
    price: "19.999",
    type: "weapon",
    category: "not/a-category",
    version: "",
  });
  assert.equal(failures.ok, false);
  assert.deepEqual(Object.keys(failures.errors).sort(), [
    "category",
    "description",
    "price",
    "slug",
    "title",
    "type",
    "version",
  ]);

  // An over-long value is refused rather than silently truncated.
  assert.ok(validateProductDraftInput({ ...validDraftForm, title: "x".repeat(200) }).ok === false);

  // A path-shaped slug is neutralized into a URL segment, never stored verbatim.
  assert.equal(slugifyProductSlug("../../etc/passwd"), "etc-passwd");
  assert.equal(slugifyProductSlug("  Cozy   Lounge!!  "), "cozy-lounge");
  // Diacritics fold to ASCII; a letter that cannot fold becomes a separator
  // rather than a character that would not survive a URL.
  assert.equal(slugifyProductSlug("Ünïcodé  Pack"), "unicode-pack");
  assert.equal(slugifyProductSlug("Åke’s Kit"), "ake-s-kit");
  assert.equal(slugifyProductSlug("   "), null);
  assert.equal(slugifyProductSlug("a"), null);

  // Only an explicit publish value publishes.
  assert.equal(parsePublicationFlag("publish"), true);
  assert.equal(parsePublicationFlag(true), true);
  for (const value of [null, undefined, "", "on", "unpublish", "false", 0, {}]) {
    assert.equal(parsePublicationFlag(value), false, String(value));
  }

  assert.equal(isProductId("abc_123"), true);
  for (const value of ["", " ", "a/b", "a b", "x".repeat(65), 42, null, undefined]) {
    assert.equal(isProductId(value), false, String(value));
  }
});

test("product management refuses unauthenticated and ordinary-customer actors", async () => {
  const database = makeDatabase();
  const { products } = makeServices(database);

  for (const actor of [null, undefined]) {
    assert.deepEqual(await products.listProducts(actor), { ok: false, code: "UNAUTHENTICATED" });
    assert.deepEqual(await products.createProduct(actor, validDraft), {
      ok: false,
      code: "UNAUTHENTICATED",
    });
    assert.deepEqual(await products.updateProduct(actor, "prosave", validDraft), {
      ok: false,
      code: "UNAUTHENTICATED",
    });
    assert.deepEqual(await products.setPublished(actor, "prosave", false), {
      ok: false,
      code: "UNAUTHENTICATED",
    });
    assert.deepEqual(await products.deleteProduct(actor, "prosave"), {
      ok: false,
      code: "UNAUTHENTICATED",
    });
  }

  const customer = { customerId: "customer-1", role: undefined };
  for (const call of [
    () => products.listProducts(customer),
    () => products.createProduct(customer, validDraft),
    () => products.updateProduct(customer, "prosave", validDraft),
    () => products.setPublished(customer, "prosave", false),
    () => products.deleteProduct(customer, "prosave"),
  ]) {
    assert.deepEqual(await call(), { ok: false, code: "FORBIDDEN" });
  }

  // Nothing was written for any of those attempts.
  assert.equal(database.products.get("prosave").published, true);
  assert.equal(database.calls.filter(([name]) => name.startsWith("product.")).length, 0);
});

test("staff can create a draft, edit it, publish it, and delete it", async () => {
  const database = makeDatabase();
  const { products } = makeServices(database);
  const actor = access("staff-1", "STAFF");

  const created = await products.createProduct(actor, validDraft);
  assert.equal(created.ok, true, JSON.stringify(created));
  assert.equal(created.value.published, false, "a new product is always a draft");
  assert.equal(created.value.price, "19.99");
  assert.equal(created.value.categorySlug, "systems");
  assert.equal(created.value.description, validDraft.description);
  assert.equal(
    database.products.get(created.value.id).documentationSummary,
    PRODUCT_DRAFT_DEFAULTS.documentationSummary,
    "columns this phase does not edit fall back to the documented defaults",
  );
  assert.equal(database.products.get(created.value.id).published, false);

  // A duplicate slug is refused rather than silently suffixed.
  const duplicate = await products.createProduct(actor, validDraft);
  assert.deepEqual(duplicate, { ok: false, code: "SLUG_TAKEN" });

  // A draft cannot be smuggled in as published, whatever the caller passes.
  const smuggled = await products.createProduct(actor, {
    ...validDraft,
    slug: "smuggled",
    published: true,
  });
  assert.equal(smuggled.ok, true);
  assert.equal(smuggled.value.published, false);

  const renamed = await products.updateProduct(actor, created.value.id, {
    ...validDraft,
    title: "Cozy Lounge Kit v2",
    price: "24.00",
  });
  assert.equal(renamed.ok, true);
  assert.equal(renamed.value.title, "Cozy Lounge Kit v2");
  assert.equal(renamed.value.price, "24.00");
  // Editing does not publish.
  assert.equal(renamed.value.published, false);

  // An edit that would steal another product's slug is refused.
  const clash = await products.updateProduct(actor, created.value.id, {
    ...validDraft,
    slug: "prosave",
  });
  assert.deepEqual(clash, { ok: false, code: "SLUG_TAKEN" });
  assert.equal(database.products.get(created.value.id).slug, "cozy-lounge-kit");

  const published = await products.setPublished(actor, created.value.id, true);
  assert.deepEqual(published, {
    ok: true,
    value: {
      productId: created.value.id,
      slug: created.value.slug,
      published: true,
      changed: true,
    },
  });
  assert.equal(database.products.get(created.value.id).published, true);

  // Re-publishing is idempotent and says so.
  const again = await products.setPublished(actor, created.value.id, true);
  assert.equal(again.value.changed, false);

  const unpublished = await products.setPublished(actor, created.value.id, false);
  assert.equal(unpublished.value.published, false);
  assert.equal(database.products.get(created.value.id).published, false);

  // A product nothing bought can be deleted.
  const deleted = await products.deleteProduct(actor, created.value.id);
  assert.deepEqual(deleted, { ok: true, value: { deleted: true } });
  assert.equal(database.products.has(created.value.id), false);

  // An unknown id is a NOT_FOUND, not a crash.
  assert.deepEqual(await products.setPublished(actor, "gone", true), {
    ok: false,
    code: "NOT_FOUND",
  });
  assert.deepEqual(await products.deleteProduct(actor, "gone"), { ok: false, code: "NOT_FOUND" });
});

test("a staff grant is required for every product write, including a rename", async () => {
  const database = makeDatabase();
  const { products } = makeServices(database);

  // An access object naming a customer who holds no privilege cannot write.
  const impersonated = createStaffAccess({ customerId: "prosave", role: "OWNER" });
  assert.ok(impersonated);
  assert.equal(hasStaffPrivilege(impersonated, "products:manage"), true);
  // ...which is why the id inside it comes from the session, not the request.
  const refused = await products.updateProduct(
    createStaffAccess({ customerId: "nobody", role: "SUPPORT" }),
    "prosave",
    validDraft,
  );
  assert.deepEqual(refused, { ok: false, code: "UNAUTHENTICATED" });
});

test("a sold product cannot be deleted, only unpublished", async () => {
  const database = makeDatabase();
  const { products } = makeServices(database);
  const actor = access("staff-1", "STAFF");
  database.addReference("orderItem", "prosave");
  database.addReference("cartItem", "prosave");

  const refused = await products.deleteProduct(actor, "prosave");
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "IN_USE");
  assert.deepEqual(refused.references, { orders: 1, downloads: 0, carts: 1 });
  assert.equal(database.products.has("prosave"), true);

  // The management list flags it, and the staff member can still unpublish.
  const list = await products.listProducts(actor);
  assert.equal(list.value.find((row) => row.id === "prosave").referenced, true);
  assert.equal((await products.setPublished(actor, "prosave", false)).ok, true);
});

test("the staff list shows drafts while every public read stays published-only", async () => {
  const database = makeDatabase();
  const { products } = makeServices(database);
  const fallback = { products: [], categories: [] };
  const publicReaders = createMarketplaceDataAccess(() => database.client, fallback);

  const staffList = await products.listProducts(access("staff-1", "STAFF"));
  assert.equal(staffList.ok, true);
  assert.deepEqual(staffList.value.map((row) => row.slug).sort(), [
    "prosave",
    "vfx-starter-pack",
  ]);

  const publicList = await publicReaders.listProducts();
  assert.deepEqual(publicList.map((product) => product.slug), ["prosave"]);

  assert.equal((await publicReaders.getProductBySlug("vfx-starter-pack")), undefined);
  assert.equal((await publicReaders.getProductById("vfx-starter-pack")), undefined);
  assert.ok(await publicReaders.getProductBySlug("prosave"));
  assert.equal((await publicReaders.listProducts({ featuredOnly: true }))[0].slug, "prosave");

  // Creating a draft through management stays invisible to the public reads.
  const created = await products.createProduct(access("staff-1", "STAFF"), {
    ...validDraft,
    slug: "brand-new-draft",
  });
  assert.equal(created.ok, true);
  assert.equal(await publicReaders.getProductBySlug("brand-new-draft"), undefined);
  assert.equal(
    (await publicReaders.listProducts()).some((product) => product.slug === "brand-new-draft"),
    false,
  );
  assert.equal(
    (await products.listProducts(access("staff-1", "STAFF"))).value.length,
    3,
    "management still sees it",
  );
});

test("an unknown category blocks a write instead of creating an orphan row", async () => {
  const database = makeDatabase();
  const { products } = makeServices(database);
  const actor = access("staff-1", "STAFF");

  const result = await products.createProduct(actor, {
    ...validDraft,
    slug: "orphan-attempt",
    categorySlug: "does-not-exist",
  });
  assert.deepEqual(result, { ok: false, code: "INVALID_CATEGORY" });
  assert.equal(database.products.has("orphan-attempt"), false);
});

/* Part 4 — the request-facing wiring, asserted at the source
   ------------------------------------------------------------------ */

const PROTECTED_MANAGE_FILES = [
  "src/app/manage/layout.tsx",
  "src/app/manage/page.tsx",
];

for (const route of PROTECTED_MANAGE_FILES) {
  test(`${route} is gated by requireStaffAccess()`, async () => {
    const source = await readSource(route);

    assert.match(source, /requireStaffAccess\(/);
    assert.match(source, /from "@\/lib\/server\/staff"/);
    assert.match(source, /requireCustomer\(\)|requireStaffAccess/);
    // No management screen reads a role or a flag off the request to decide.
    assert.doesNotMatch(source, /searchParams[^\n]*(role|staff=|isAdmin)/);
  });
}

test("the management page keeps private data out of the shared caches", async () => {
  const page = await readCode("src/app/manage/page.tsx");
  const cache = await readCode("src/lib/server/catalog-cache.ts");

  // Dynamic per request, and out of search indexes.
  assert.match(page, /await connection\(\)/);
  assert.match(page, /robots: \{ index: false, follow: false \}/);
  // Staff reads come from the admin service, never the cached public readers.
  assert.match(page, /productAdmin\.listProducts\(access\)/);
  assert.doesNotMatch(page, /getCachedProducts|catalog-cache/);
  // ...and the cache module stays public-catalog-only.
  assert.doesNotMatch(cache, /product-admin|staff|listMemberships/);
});

test("every management Server Function authorizes before it reads a form field", async () => {
  const sources = {
    "src/lib/server/product-admin-actions.ts": ["products:manage", "products:delete"],
    "src/lib/server/staff-actions.ts": ["staff:manage"],
  };

  for (const [file, expectedPrivileges] of Object.entries(sources)) {
    const source = await readSource(file);
    assert.match(source, /^"use server";/m);

    const bodies = [...source.matchAll(/export async function (\w+)\([\s\S]*?\n\}\n/g)];
    assert.ok(bodies.length >= 4 || file.includes("staff-actions"), file);

    for (const [raw] of bodies) {
      const name = /export async function (\w+)/.exec(raw)[1];
      const authorizationIndex = raw.indexOf("authorizeStaffAction(");
      const firstReadIndex = raw.indexOf("formData.get(");

      assert.notEqual(authorizationIndex, -1, `${name} has no authorization check`);
      if (firstReadIndex !== -1) {
        assert.ok(
          authorizationIndex < firstReadIndex ||
            /const (published|productId|email|role) = formData\.get/.test(raw) === false ||
            authorizationIndex < raw.search(/const (published|productId|email|role) = formData\.get/),
          `${name} reads a form field before authorizing`,
        );
      }

      // Each function asks for one of the two product privileges (or staff:manage),
      // and the service it calls re-checks the same one.
      const privilege = /authorizeStaffAction\("([\w:]+)"\)/.exec(raw)?.[1];
      assert.ok(expectedPrivileges.includes(privilege), `${name} asked for ${privilege}`);
    }

    // No action accepts an actor, a role of its own, or a privilege list.
    assert.doesNotMatch(
      source,
      /formData\.get\("(customerId|actorId|userId|isAdmin|isStaff|privileges|access)("\)|,)/,
      file,
    );
  }
});

test("management actions read no more of the form than the draft fields", async () => {
  const source = await readSource("src/lib/server/product-admin-actions.ts");
  const reads = [...source.matchAll(/formData\.get\("(\w+)"\)/g)].map((match) => match[1]);

  assert.deepEqual([...new Set(reads)].sort(), [
    "category",
    "description",
    "price",
    "productId",
    "publish",
    "slug",
    "title",
    "type",
    "version",
  ]);
});

test("the publication flag is written only by the publication path", async () => {
  const service = await readSource("src/lib/server/product-admin-service.ts");
  const actions = await readSource("src/lib/server/product-admin-actions.ts");

  // Creating forces a draft, so nothing can be smuggled into the storefront.
  assert.match(service, /published: false,\n/);
  assert.match(service, /data: \{ published \},/);
  // The edit payload never carries `published`.
  const draftPayload = /function draftData\([\s\S]*?\n\}/.exec(service)[0];
  assert.doesNotMatch(draftPayload, /published/);
  // And the actions module does not let a form decide it for a create or update.
  assert.doesNotMatch(/export async function createProductDraftAction[\s\S]*?\n\}/.exec(actions)[0], /publish/i);
  assert.doesNotMatch(/export async function updateProductAction[\s\S]*?\n\}/.exec(actions)[0], /publish/i);
});

test("customer-facing auth code cannot grant staff access", async () => {
  const actions = await readSource("src/lib/server/auth-actions.ts");
  const service = await readSource("src/lib/server/auth-service.ts");
  const core = await readSource("src/lib/server/auth-core.ts");

  // Registration writes exactly these columns, and profile editing exactly those.
  const createPayload = /client\.customer\.create\(\{\s*data: \{([\s\S]*?)\}/.exec(service)[1];
  assert.deepEqual(
    createPayload
      .split(",")
      .map((line) => line.trim().split(":")[0])
      .filter(Boolean)
      .sort(),
    ["email", "name", "passwordHash"],
  );

  const profilePayload = /client\.customer\.update\(\{[\s\S]*?data: \{([\s\S]*?)\},/.exec(service)[1];
  assert.deepEqual(
    profilePayload
      .split(",")
      .map((line) => line.trim().split(":")[0])
      .filter(Boolean)
      .sort(),
    ["name", "productUpdates", "releaseNotes", "themePreference"],
  );

  // The safe customer projection still has no role or grant of any kind.
  assert.deepEqual(Object.keys(CUSTOMER_SELECT).sort(), [
    "createdAt",
    "email",
    "id",
    "name",
    "preferences",
    "productUpdates",
    "releaseNotes",
    "themePreference",
    "updatedAt",
  ].filter((key) => key !== "preferences"));

  for (const source of [actions, service, core]) {
    assert.doesNotMatch(source, /StaffMembership|staffMembership|staff:manage|OWNER/i);
  }

  // No registration or settings field name could carry a role, and none is read.
  assert.doesNotMatch(actions, /formData\.get\("(role|staff|isAdmin|privileges)"\)/);
  assert.doesNotMatch(core, /role/i);
});

test("no product-management surface is linked from the public chrome", async () => {
  const header = await readSource("src/components/layout/Header.tsx");
  const footer = await readSource("src/components/layout/Footer.tsx");
  const home = await readSource("src/app/page.tsx");
  const accountNav = await readSource("src/components/account/AccountNavigation.tsx");
  const authForm = await readSource("src/components/account/AuthForm.tsx");

  for (const [name, source] of [
    ["Header", header],
    ["Footer", footer],
    ["home", home],
    ["AccountNavigation", accountNav],
    ["AuthForm", authForm],
  ]) {
    assert.doesNotMatch(source, /\/manage/, `${name} links to /manage`);
    assert.doesNotMatch(source, /creator application|apply to sell|become a creator/i, name);
  }
});

test("the seed paths cannot create or promote staff accounts", async () => {
  const sources = await Promise.all([
    readSource("prisma/seed.ts"),
    readSource("prisma/seed-catalog.ts"),
    readSource("src/lib/server/seed-database.ts"),
    readSource("src/lib/server/seed-catalog.ts"),
    readSource("src/lib/server/seed-data.ts"),
  ]);

  for (const source of sources) {
    assert.doesNotMatch(source, /staffMembership|StaffMembership|StaffRole|OWNER/);
  }
});

test("the migration is additive and the role lives outside Customer", async () => {
  const migration = await readSource(
    "prisma/migrations/20261004120000_add_staff_access/migration.sql",
  );
  const schema = await readSource("prisma/schema.prisma");

  assert.match(migration, /CREATE TYPE "StaffRole" AS ENUM \(\s*'OWNER',\s*'STAFF'\s*\);/);
  assert.match(migration, /CREATE TABLE "StaffMembership"/);
  assert.match(migration, /CREATE UNIQUE INDEX "StaffMembership_customerId_key"/);
  assert.match(
    migration,
    /FOREIGN KEY \("customerId"\) REFERENCES "Customer"\("id"\)\s*ON DELETE CASCADE/,
  );

  // Nothing destructive and no data touched: this migration cannot rewrite or
  // remove a customer, an order, a product, or their history. `ON DELETE
  // CASCADE` on the new table's own foreign key is the only delete-ish clause.
  assert.doesNotMatch(migration, /^\s*(DROP|TRUNCATE|DELETE\s+FROM|UPDATE\s|INSERT)/gim);
  assert.doesNotMatch(migration, /\bDROP (TABLE|COLUMN|TYPE|INDEX)\b/i);
  assert.doesNotMatch(migration, /ALTER TABLE "Customer"[^;]*\bDROP\b/i);
  assert.doesNotMatch(migration, /ALTER TABLE "Product"\b/);

  // `Customer` gained only the two relation fields, never a scalar role column.
  const customerBlock = /model Customer \{([\s\S]*?)\n\}/.exec(schema)[1];
  assert.match(customerBlock, /staffMembership\s+StaffMembership\?/);
  assert.doesNotMatch(customerBlock, /role\s+StaffRole|role\s+String|isStaff\s+Boolean/);

  // The grant model exists once and its role has a default that is the lower one.
  const membershipBlock = /model StaffMembership \{([\s\S]*?)\n\}/.exec(schema)[1];
  assert.match(membershipBlock, /role\s+StaffRole\s+@default\(STAFF\)/);
  assert.match(membershipBlock, /customerId\s+String\s+@unique/);
});

test("the bootstrap path is only reachable from the CLI, and has no shared password", async () => {
  const [runner, entrypoint, wiring, actions, service] = await Promise.all([
    readSource("prisma/grant-owner-runner.ts"),
    readSource("prisma/grant-owner.ts"),
    readSource("src/lib/server/staff.ts"),
    readSource("src/lib/server/staff-actions.ts"),
    readSource("src/lib/server/staff-service.ts"),
  ]);

  // Only the CLI runner imports the bootstrap confirmation and calls the writer.
  assert.match(runner, /OWNER_BOOTSTRAP_CONFIRMATION/);
  assert.match(runner, /bootstrapOwnerAccess/);
  for (const [name, source] of [
    ["staff.ts wiring", wiring],
    ["staff-actions.ts", actions],
  ]) {
    assert.doesNotMatch(source, /OWNER_BOOTSTRAP_CONFIRMATION|bootstrapOwnerAccess/, name);
  }
  assert.match(service, /input\.confirmation !== OWNER_BOOTSTRAP_CONFIRMATION/);

  // The command is explicit, dry by default, and refuses a silent promotion.
  assert.match(entrypoint, /--apply/);
  assert.match(entrypoint, /BOOTSTRAP_OWNER_EMAILS_ENV_VAR/);
  assert.match(entrypoint, /process\.env\[BOOTSTRAP_OWNER_EMAILS_ENV_VAR\]/);
  assert.match(entrypoint, /normalizeDatabaseUrl\(process\.env\.DATABASE_URL\)/);
  assert.doesNotMatch(entrypoint, /findFirst\(\s*\{\s*\}/);
  assert.doesNotMatch(entrypoint, /count\(\)\s*===?\s*0|first customer|oldest/i);

  // Nothing in the authorization model is a password or a shared secret.
  const allSources = [runner, entrypoint, wiring, actions, service].join("\n");
  assert.doesNotMatch(allSources, /STAFF_PASSWORD|ADMIN_PASSWORD|process\.env\.\w*(PASSWORD|SECRET|KEY)/);
});

test("the staff modules read no environment secrets and cache nothing", async () => {
  const modules = [
    "src/lib/server/staff-core.ts",
    "src/lib/server/staff-service.ts",
    "src/lib/server/staff.ts",
    "src/lib/server/product-admin-core.ts",
    "src/lib/server/product-admin-service.ts",
    "src/lib/server/product-admin.ts",
  ];

  for (const modulePath of modules) {
    const source = await readCode(modulePath);
    assert.match(source, /import "server-only";/, modulePath);

    const envReads = [...source.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((match) => match[1]);
    for (const name of envReads) {
      assert.ok(
        ["DATABASE_URL", "NODE_ENV", "MARKETPLACE_OWNER_EMAILS"].includes(name),
        `${modulePath} reads ${name}`,
      );
    }

    // No unstable_cache, no revalidate tags, no client-side export.
    assert.doesNotMatch(source, /unstable_cache|cacheTag\(/, modulePath);
    assert.doesNotMatch(source, /"use client"/, modulePath);
    assert.doesNotMatch(
      source,
      /console\.(log|error|warn|info|debug)\([^)]*(password|token|secret|digest|email)/i,
      `${modulePath} logs credential material`,
    );
  }

  const envExample = await readSource(".env.example");
  assert.match(envExample, /MARKETPLACE_OWNER_EMAILS/);
  assert.doesNotMatch(envExample, /(STAFF|ADMIN|OWNER)_?PASSWORD\s*=/);
  assert.doesNotMatch(envExample, /BEGIN [A-Z ]*PRIVATE KEY/);
});

test("requireStaffAccess redirects on every non-authorized state", async () => {
  const wiring = await readCode("src/lib/server/staff.ts");

  assert.match(wiring, /export const requireStaffAccess = cache\(/);
  assert.match(wiring, /await requireCustomer\(\)/);
  assert.match(wiring, /redirect\(STAFF_DENIED_PATH\)/);
  // A read failure is a denial, not a pass: the only non-`ok` branch yields null.
  assert.match(wiring, /result\.ok \? result\.value : null/);
  // Access is memoized per request only.
  assert.match(wiring, /export const getStaffAccess = cache\(/);
  // And the actor's id is re-checked against the session's own customer.
  assert.match(wiring, /access\.customerId !== customer\.id/);
  assert.doesNotMatch(wiring, /unstable_cache|revalidateTag/);
});

test("the management components submit to the guarded actions and nothing else", async () => {
  const [row, draftForm, staffPanel] = await Promise.all([
    readCode("src/components/manage/ManagedProductRow.tsx"),
    readCode("src/components/manage/ProductDraftForm.tsx"),
    readCode("src/components/manage/StaffAccessPanel.tsx"),
  ]);

  const sources = { row, draftForm, staffPanel };
  const importedActions = {
    row: /from "@\/lib\/server\/product-admin-actions"/,
    draftForm: /from "@\/lib\/server\/product-admin-actions"/,
    staffPanel: /from "@\/lib\/server\/staff-actions"/,
  };

  for (const [name, source] of Object.entries(sources)) {
    assert.match(source, importedActions[name], name);
    assert.match(source, /method="post"/, `${name} must not submit as a GET`);
    // No client component and no browser state.
    assert.doesNotMatch(source, /"use client"/, name);
    // No control can name an actor or carry a privilege list.
    assert.doesNotMatch(source, /name="(customerId|actorId|isAdmin|privileges)"/, name);
    // Only the owner's grant form has a role field, and it is the *target's* role.
    if (name !== "staffPanel") assert.doesNotMatch(source, /name="role"/, name);
    // A draft form has no publish control; publishing is the row's own action.
    if (name !== "row") assert.doesNotMatch(source, /name="publish"/, name);
  }

  // The staff panel renders the role select, and only an owner is ever shown it.
  assert.match(staffPanel, /defaultValue="staff"/);
  assert.match(staffPanel, /grantStaffAccessAction/);
  assert.match(staffPanel, /revokeStaffAccessAction/);
});

test("the package scripts and test registration cover the new commands", async () => {
  const pkg = JSON.parse(await readSource("package.json"));

  assert.equal(pkg.scripts["db:grant-owner"], "tsx --conditions=react-server prisma/grant-owner.ts");
  assert.match(pkg.scripts.test, /staff-authorization\.test\.mjs/);
  // The development seed still runs through the same guard as before.
  assert.match(pkg.scripts["db:seed"], /prisma db seed/);
});
