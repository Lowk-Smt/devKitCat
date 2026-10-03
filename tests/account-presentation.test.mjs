import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  customerInitials,
  firstSearchParam,
  getPasswordConfirmationError,
  parseAccountCollectionPreviewState,
  resolveAuthNotice,
  toIsoDate,
} from "../src/lib/account-presentation.ts";

test("collection preview states accept the four explicit UI examples", () => {
  assert.equal(parseAccountCollectionPreviewState("populated"), "populated");
  assert.equal(parseAccountCollectionPreviewState("empty"), "empty");
  assert.equal(parseAccountCollectionPreviewState("loading"), "loading");
  assert.equal(parseAccountCollectionPreviewState("error"), "error");
});

test("unknown or missing collection states fall back to populated demo data", () => {
  assert.equal(parseAccountCollectionPreviewState(undefined), "populated");
  assert.equal(parseAccountCollectionPreviewState("unknown"), "populated");
  assert.equal(parseAccountCollectionPreviewState(["error", "empty"]), "error");
});

test("search-param helper safely handles absent, scalar, and repeated values", () => {
  assert.equal(firstSearchParam(undefined), undefined);
  assert.equal(firstSearchParam("order"), "order");
  assert.equal(firstSearchParam(["first", "second"]), "first");
  assert.equal(firstSearchParam([]), undefined);
});

test("registration password confirmation returns a clear mismatch error", () => {
  assert.equal(getPasswordConfirmationError("matching-password", "matching-password"), undefined);
  assert.equal(
    getPasswordConfirmationError("first-password", "other-password"),
    "Passwords do not match. Check both fields.",
  );
});

test("account identity helpers format real customer records", () => {
  assert.equal(customerInitials("Jordan Taylor"), "JT");
  assert.equal(customerInitials("  grace   hopper  "), "GH");
  assert.equal(customerInitials("Ada"), "AD");
  assert.equal(customerInitials("Ada Lovelace Byron"), "AB");
  assert.equal(customerInitials(""), "?");
  assert.equal(customerInitials("   "), "?");

  assert.equal(toIsoDate(new Date("2025-11-08T00:00:00.000Z")), "2025-11-08");
  assert.equal(toIsoDate(new Date("2026-01-01T23:59:59.999Z")), "2026-01-01");
});

test("auth notices come from a fixed set, never from raw query values", () => {
  assert.equal(resolveAuthNotice({}), null);
  assert.equal(resolveAuthNotice({ unknown: "value" }), null);
  assert.equal(resolveAuthNotice({ error: "not-a-known-code" }), null);
  assert.equal(resolveAuthNotice({ error: ["service-unavailable", "x"] }).tone, "warning");
  assert.equal(resolveAuthNotice({ "signed-out": "1" }).title, "You are signed out");
  assert.equal(resolveAuthNotice({ "signed-out": "0" }), null);
  assert.equal(resolveAuthNotice({ "signed-out": ["1"] }).tone, "info");
  // Reflected query text is never rendered back into the page.
  assert.ok(
    !JSON.stringify(resolveAuthNotice({ error: "service-unavailable" })).includes(
      "<script",
    ),
  );
});

test("auth and settings forms post to Server Functions and never put credentials in a URL", async () => {
  const authForm = await readFile(
    new URL("../src/components/account/AuthForm.tsx", import.meta.url),
    "utf8",
  );
  const settingsForm = await readFile(
    new URL("../src/components/account/SettingsForm.tsx", import.meta.url),
    "utf8",
  );

  // Real submissions go through a Server Function over POST.
  assert.match(authForm, /action=\{formAction\}/);
  assert.match(settingsForm, /action=\{formAction\}/);
  assert.match(authForm, /method="post"/);
  assert.match(settingsForm, /method="post"/);
  assert.doesNotMatch(authForm, /method="get"/);
  assert.doesNotMatch(settingsForm, /method="get"/);

  // Named controls exist exactly for the fields the server validates.
  for (const name of ["email", "password", "rememberMe", "name", "confirmPassword", "acceptTerms"]) {
    assert.match(authForm, new RegExp(`name="${name}"`), `missing auth field ${name}`);
  }
  for (const name of ["name", "theme", "productUpdates", "releaseNotes"]) {
    assert.match(settingsForm, new RegExp(`name="${name}"`), `missing settings field ${name}`);
  }

  // The email address is read-only and deliberately not submitted, so it cannot
  // be changed through the settings form.
  const emailInput = settingsForm.match(/<input[^>]*id="account-email"[^>]*>/s)[0];
  assert.match(emailInput, /readOnly/);
  assert.doesNotMatch(emailInput, /\bname=/);

  // Browser hints and the documented password floor are preserved.
  assert.match(authForm, /type="email"/);
  assert.match(authForm, /"current-password"/);
  assert.match(authForm, /"new-password"/);
  assert.match(authForm, /minLength=\{8\}/);
  assert.match(authForm, /Confirm password/);
  assert.match(authForm, /I acknowledge and agree to the account terms/);
  assert.match(authForm, /required/);

  // Credentials are handled by the server action, not by browser storage.
  assert.doesNotMatch(authForm, /\b(fetch|localStorage|sessionStorage)\s*\(/);
  assert.doesNotMatch(settingsForm, /\b(fetch|localStorage|sessionStorage)\s*\(/);
  assert.doesNotMatch(authForm, /Demo only|no account was created/);
});
