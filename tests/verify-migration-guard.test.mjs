import assert from "node:assert/strict";
import test from "node:test";
import {
  getUrlDatabase,
  getUrlHost,
  isProbablyProductionUrl,
  isScratchOverrideValid,
  shouldAllowRealVerification,
} from "../scripts/verify-staff-migration.mjs";

// Helpers to manipulate env safely per test
function withEnv(vars, fn) {
  const prev = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function withCleanScratchEnv(fn) {
  withEnv(
    {
      VERIFY_MIGRATION_SCRATCH_DB: undefined,
      VERIFY_MIGRATION_SCRATCH_HOST: undefined,
      VERIFY_MIGRATION_SCRATCH_DATABASE: undefined,
      VERIFY_MIGRATION_EXPECTED_HOST: undefined,
      VERIFY_MIGRATION_EXPECTED_DATABASE: undefined,
    },
    fn,
  );
}

// --------------------------------------------------------------------------
// isProbablyProductionUrl
// --------------------------------------------------------------------------

test("isProbablyProductionUrl: non-Neon hosts are not production", () => {
  withCleanScratchEnv(() => {
    assert.equal(isProbablyProductionUrl("postgresql://postgres:postgres@localhost:5432/devkitcat"), false);
    assert.equal(isProbablyProductionUrl("postgresql://user:pass@127.0.0.1:5432/db"), false);
    assert.equal(isProbablyProductionUrl("postgresql://user:pass@some-ec2.aws.com/db"), false);
    assert.equal(isProbablyProductionUrl("postgresql://user:pass@example.com/db"), false);
  });
});

test("isProbablyProductionUrl: neon.tech without scratch/test is production", () => {
  withCleanScratchEnv(() => {
    assert.equal(
      isProbablyProductionUrl("postgresql://user:pass@ep-example-123-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require"),
      true,
    );
    assert.equal(isProbablyProductionUrl("postgresql://user:pass@ep-cool-123.neon.tech/db"), true);
  });
});

test("isProbablyProductionUrl: neon.tech with scratch/test marker is not production", () => {
  withCleanScratchEnv(() => {
    assert.equal(isProbablyProductionUrl("postgresql://user:pass@ep-scratch-123.neon.tech/db"), false);
    assert.equal(isProbablyProductionUrl("postgresql://user:pass@ep-test-123.neon.tech/db"), false);
    assert.equal(isProbablyProductionUrl("postgresql://user:pass@ep-example.neon.tech/scratchdb"), false);
    assert.equal(isProbablyProductionUrl("postgresql://user:pass@ep-example.neon.tech/test"), false);
    // Case-insensitive
    assert.equal(isProbablyProductionUrl("postgresql://user:pass@ep-SCRATCH-123.neon.tech/db"), false);
  });
});

// --------------------------------------------------------------------------
// getUrlHost / getUrlDatabase
// --------------------------------------------------------------------------

test("getUrlHost and getUrlDatabase parse correctly", () => {
  assert.equal(getUrlHost("postgresql://user:pass@ep-example-123.neon.tech/neondb?sslmode=require"), "ep-example-123.neon.tech");
  assert.equal(getUrlDatabase("postgresql://user:pass@ep-example-123.neon.tech/neondb?sslmode=require"), "neondb");
  assert.equal(getUrlHost("postgresql://postgres:postgres@localhost:5432/devkitcat"), "localhost");
  assert.equal(getUrlDatabase("postgresql://postgres:postgres@localhost:5432/devkitcat"), "devkitcat");
  assert.equal(getUrlHost("not a url"), "");
  assert.equal(getUrlDatabase("not a url"), "");
});

// --------------------------------------------------------------------------
// isScratchOverrideValid — fail-closed
// --------------------------------------------------------------------------

test("guard rejects normal production Neon URL with no opt-in", () => {
  withCleanScratchEnv(() => {
    const prod = "postgresql://user:pass@ep-prod-123-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require";
    assert.equal(isProbablyProductionUrl(prod), true);
    assert.equal(isScratchOverrideValid(prod), false);
    assert.equal(shouldAllowRealVerification(prod), false);
  });
});

test("guard rejects production Neon URL with only VERIFY_MIGRATION_SCRATCH_DB=true (no host/database)", () => {
  withEnv({ VERIFY_MIGRATION_SCRATCH_DB: "true", VERIFY_MIGRATION_SCRATCH_HOST: undefined, VERIFY_MIGRATION_SCRATCH_DATABASE: undefined }, () => {
    const prod = "postgresql://user:pass@ep-prod-123.neon.tech/neondb";
    assert.equal(isScratchOverrideValid(prod), false);
    assert.equal(shouldAllowRealVerification(prod), false);
  });
});

test("guard rejects production Neon URL with incorrect opt-in values", () => {
  const prod = "postgresql://user:pass@ep-prod-123.neon.tech/neondb";

  // Flag not exactly "true"
  withEnv({ VERIFY_MIGRATION_SCRATCH_DB: "1", VERIFY_MIGRATION_SCRATCH_HOST: "ep-prod-123" }, () => {
    assert.equal(isScratchOverrideValid(prod), false);
  });
  withEnv({ VERIFY_MIGRATION_SCRATCH_DB: "True", VERIFY_MIGRATION_SCRATCH_HOST: "ep-prod-123" }, () => {
    // Our check is case-insensitive for the value (toLowerCase === "true"), so "True" should actually pass.
    // But we test that mismatched host still fails.
    // Let's use a wrong host.
    assert.equal(isScratchOverrideValid(prod), true, "True (case-insensitive) should be accepted if host matches");
  });
  withEnv({ VERIFY_MIGRATION_SCRATCH_DB: "true", VERIFY_MIGRATION_SCRATCH_HOST: "wrong-host" }, () => {
    assert.equal(isScratchOverrideValid(prod), false);
  });
  withEnv({ VERIFY_MIGRATION_SCRATCH_DB: "true", VERIFY_MIGRATION_SCRATCH_HOST: "ep-prod-999" }, () => {
    assert.equal(isScratchOverrideValid(prod), false);
  });
  withEnv({ VERIFY_MIGRATION_SCRATCH_DB: "false", VERIFY_MIGRATION_SCRATCH_HOST: "ep-prod-123" }, () => {
    assert.equal(isScratchOverrideValid(prod), false);
  });
  // Correct host but missing opt-in
  withEnv({ VERIFY_MIGRATION_SCRATCH_DB: undefined, VERIFY_MIGRATION_SCRATCH_HOST: "ep-prod-123" }, () => {
    assert.equal(isScratchOverrideValid(prod), false);
  });
});

test("guard rejects production Neon URL with wrong database when database check is required", () => {
  const url = "postgresql://user:pass@ep-scratch-123.neon.tech/prod_db";
  withEnv({ VERIFY_MIGRATION_SCRATCH_DB: "true", VERIFY_MIGRATION_SCRATCH_HOST: "ep-scratch-123", VERIFY_MIGRATION_SCRATCH_DATABASE: "scratch_db" }, () => {
    assert.equal(isScratchOverrideValid(url), false);
  });
});

test("guard allows explicitly designated scratch Neon URL with correct opt-in and host", () => {
  const scratch = "postgresql://user:pass@ep-scratch-xyz123-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require";
  // This host contains "scratch", so it is NOT considered production and needs no override — verify marker logic
  withEnv({ VERIFY_MIGRATION_SCRATCH_DB: "true", VERIFY_MIGRATION_SCRATCH_HOST: "ep-scratch-xyz123-pooler" }, () => {
    assert.equal(isProbablyProductionUrl(scratch), false);
    assert.equal(shouldAllowRealVerification(scratch), true);
  });

  // Use a normal Neon hostname without scratch/test marker — this is the real case the task describes
  const normalNeonScratch = "postgresql://user:pass@ep-ordinary-abc123-pooler.c-2.us-east-1.aws.neon.tech/neondb";
  // Without override, it's considered production
  withCleanScratchEnv(() => {
    assert.equal(isProbablyProductionUrl(normalNeonScratch), true);
    assert.equal(shouldAllowRealVerification(normalNeonScratch), false);
  });
  // With correct override, it is allowed
  withEnv({ VERIFY_MIGRATION_SCRATCH_DB: "true", VERIFY_MIGRATION_SCRATCH_HOST: "ep-ordinary-abc123-pooler" }, () => {
    assert.equal(isScratchOverrideValid(normalNeonScratch), true);
    assert.equal(shouldAllowRealVerification(normalNeonScratch), true);
  });
  // Full host also works
  withEnv({ VERIFY_MIGRATION_SCRATCH_DB: "true", VERIFY_MIGRATION_SCRATCH_HOST: "ep-ordinary-abc123-pooler.c-2.us-east-1.aws.neon.tech" }, () => {
    assert.equal(isScratchOverrideValid(normalNeonScratch), true);
  });
  // Case-insensitive
  withEnv({ VERIFY_MIGRATION_SCRATCH_DB: "TRUE", VERIFY_MIGRATION_SCRATCH_HOST: "EP-ORDINARY-ABC123-POOLER" }, () => {
    assert.equal(isScratchOverrideValid(normalNeonScratch), true);
  });
});

test("guard allows scratch override with database name check", () => {
  const url = "postgresql://user:pass@ep-ordinary-abc123.neon.tech/scratch_mydb";
  // Host-only check
  withEnv({ VERIFY_MIGRATION_SCRATCH_DB: "true", VERIFY_MIGRATION_SCRATCH_HOST: "ep-ordinary-abc123" }, () => {
    assert.equal(isScratchOverrideValid(url), true);
  });
  // Database-only check
  withEnv({ VERIFY_MIGRATION_SCRATCH_DB: "true", VERIFY_MIGRATION_SCRATCH_DATABASE: "scratch_mydb" }, () => {
    assert.equal(isScratchOverrideValid(url), true);
  });
  // Both host and database must match when both supplied
  withEnv({ VERIFY_MIGRATION_SCRATCH_DB: "true", VERIFY_MIGRATION_SCRATCH_HOST: "ep-ordinary-abc123", VERIFY_MIGRATION_SCRATCH_DATABASE: "scratch_mydb" }, () => {
    assert.equal(isScratchOverrideValid(url), true);
  });
  withEnv({ VERIFY_MIGRATION_SCRATCH_DB: "true", VERIFY_MIGRATION_SCRATCH_HOST: "ep-ordinary-abc123", VERIFY_MIGRATION_SCRATCH_DATABASE: "wrongdb" }, () => {
    assert.equal(isScratchOverrideValid(url), false);
  });
});

test("guard allows via alias VERIFY_MIGRATION_EXPECTED_HOST", () => {
  const url = "postgresql://user:pass@ep-ordinary-abc123.neon.tech/neondb";
  withEnv({ VERIFY_MIGRATION_SCRATCH_DB: "true", VERIFY_MIGRATION_EXPECTED_HOST: "ep-ordinary-abc123" }, () => {
    assert.equal(isScratchOverrideValid(url), true);
  });
  withEnv({ VERIFY_MIGRATION_SCRATCH_DB: "true", VERIFY_MIGRATION_EXPECTED_DATABASE: "neondb" }, () => {
    assert.equal(isScratchOverrideValid(url), true);
  });
});

test("non-Neon/local PostgreSQL remains allowed without opt-in", () => {
  withCleanScratchEnv(() => {
    const local = "postgresql://postgres:postgres@localhost:5432/devkitcat";
    assert.equal(shouldAllowRealVerification(local), true);
    const remoteNonNeon = "postgresql://user:pass@some.rds.amazonaws.com/db";
    assert.equal(shouldAllowRealVerification(remoteNonNeon), true);
  });
  // Even with opt-in set, local should still be allowed
  withEnv({ VERIFY_MIGRATION_SCRATCH_DB: "true", VERIFY_MIGRATION_SCRATCH_HOST: "something" }, () => {
    const local = "postgresql://postgres:postgres@localhost:5432/devkitcat";
    assert.equal(shouldAllowRealVerification(local), true);
  });
});

test("guard fails closed when required safety info is missing or mismatched", () => {
  const prod = "postgresql://user:pass@ep-prod-123.neon.tech/neondb";
  // Missing DATABASE_URL (null/undefined) — isProbablyProductionUrl false, but shouldAllow with null should not throw
  withCleanScratchEnv(() => {
    assert.equal(shouldAllowRealVerification(null), true); // null is not production, but caller will error on missing DB separately
    assert.equal(isScratchOverrideValid(null), false);
    assert.equal(isScratchOverrideValid(""), false);
  });
  // Empty host expected
  withEnv({ VERIFY_MIGRATION_SCRATCH_DB: "true", VERIFY_MIGRATION_SCRATCH_HOST: "", VERIFY_MIGRATION_SCRATCH_DATABASE: "" }, () => {
    assert.equal(isScratchOverrideValid(prod), false);
  });
  withEnv({ VERIFY_MIGRATION_SCRATCH_DB: "true", VERIFY_MIGRATION_SCRATCH_HOST: "   " }, () => {
    assert.equal(isScratchOverrideValid(prod), false);
  });
});

test("regression: explicit scratch host ep-sweet-surf-azojjdxn allows probable-Neon verification (issue observed locally)", () => {
  // Exact host observed locally: ep-sweet-surf-azojjdxn.c-3.ap-southeast-1.aws.neon.tech
  // User set VERIFY_MIGRATION_SCRATCH_DB=true + VERIFY_MIGRATION_SCRATCH_HOST=ep-sweet-surf-azojjdxn
  // Expected: isProbablyProductionUrl=true, isScratchOverrideValid=true, shouldAllow=true
  const realNeonScratch = "postgresql://neondb_owner:npg_fake@ep-sweet-surf-azojjdxn.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require";
  // Also test pooler variant
  const realNeonScratchPooler = "postgresql://neondb_owner:npg_fake@ep-sweet-surf-azojjdxn-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require";

  for (const url of [realNeonScratch, realNeonScratchPooler]) {
    // Without override → production, rejected
    withCleanScratchEnv(() => {
      assert.equal(isProbablyProductionUrl(url), true, `expected production for ${getUrlHost(url)}`);
      assert.equal(isScratchOverrideValid(url), false);
      assert.equal(shouldAllowRealVerification(url), false);
    });
    // Flag alone → still rejected (fail-closed)
    withEnv({ VERIFY_MIGRATION_SCRATCH_DB: "true" }, () => {
      assert.equal(isScratchOverrideValid(url), false);
      assert.equal(shouldAllowRealVerification(url), false);
    });
    // Correct host → allowed
    withEnv({ VERIFY_MIGRATION_SCRATCH_DB: "true", VERIFY_MIGRATION_SCRATCH_HOST: "ep-sweet-surf-azojjdxn" }, () => {
      assert.equal(getUrlHost(url), url.includes("pooler") ? "ep-sweet-surf-azojjdxn-pooler.c-3.ap-southeast-1.aws.neon.tech" : "ep-sweet-surf-azojjdxn.c-3.ap-southeast-1.aws.neon.tech");
      assert.equal(isProbablyProductionUrl(url), true);
      assert.equal(isScratchOverrideValid(url), true, `expected override valid for ${url} with host ep-sweet-surf-azojjdxn`);
      assert.equal(shouldAllowRealVerification(url), true);
    });
    // Wrong host → rejected
    withEnv({ VERIFY_MIGRATION_SCRATCH_DB: "true", VERIFY_MIGRATION_SCRATCH_HOST: "ep-wrong-host" }, () => {
      assert.equal(isScratchOverrideValid(url), false);
      assert.equal(shouldAllowRealVerification(url), false);
    });
    // Case-insensitive and full-host also works
    withEnv({ VERIFY_MIGRATION_SCRATCH_DB: "TRUE", VERIFY_MIGRATION_SCRATCH_HOST: "EP-SWEET-SURF-AZOJJDXN" }, () => {
      assert.equal(isScratchOverrideValid(url), true);
    });
    withEnv({ VERIFY_MIGRATION_SCRATCH_DB: "true", VERIFY_MIGRATION_SCRATCH_HOST: getUrlHost(url) }, () => {
      assert.equal(isScratchOverrideValid(url), true);
    });
  }

  // Normal production URL must still be rejected even with correct scratch host for *other* DB
  const otherProd = "postgresql://user:pass@ep-other-prod-999.c-2.us-east-1.aws.neon.tech/neondb";
  withEnv({ VERIFY_MIGRATION_SCRATCH_DB: "true", VERIFY_MIGRATION_SCRATCH_HOST: "ep-sweet-surf-azojjdxn" }, () => {
    assert.equal(isProbablyProductionUrl(otherProd), true);
    assert.equal(isScratchOverrideValid(otherProd), false);
    assert.equal(shouldAllowRealVerification(otherProd), false);
  });

  // Local/non-Neon unchanged
  withCleanScratchEnv(() => {
    assert.equal(shouldAllowRealVerification("postgresql://postgres:postgres@localhost:5432/devkitcat"), true);
  });
});
