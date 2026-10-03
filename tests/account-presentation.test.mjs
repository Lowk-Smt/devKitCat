import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  firstSearchParam,
  getPasswordConfirmationError,
  parseAccountCollectionPreviewState,
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

test("auth and settings forms cannot serialize entered values without JavaScript", async () => {
  const authForm = await readFile(
    new URL("../src/components/account/AuthForm.tsx", import.meta.url),
    "utf8",
  );
  const settingsForm = await readFile(
    new URL("../src/components/account/SettingsForm.tsx", import.meta.url),
    "utf8",
  );

  assert.match(authForm, /method="get"/);
  assert.match(settingsForm, /method="get"/);
  assert.match(authForm, /type="email"/);
  assert.match(authForm, /"current-password"/);
  assert.match(authForm, /"new-password"/);
  assert.match(authForm, /minLength=\{8\}/);
  assert.match(authForm, /Confirm password/);
  assert.match(authForm, /I acknowledge and agree to the demo terms/);
  assert.match(authForm, /required/);
  const successfulControlName = /<(?:input|select|textarea)\b[^>]*\bname\s*=/s;
  assert.doesNotMatch(authForm, successfulControlName);
  assert.doesNotMatch(settingsForm, successfulControlName);
  assert.doesNotMatch(authForm, /\b(fetch|localStorage|sessionStorage)\s*\(/);
  assert.doesNotMatch(settingsForm, /\b(fetch|localStorage|sessionStorage)\s*\(/);
});
