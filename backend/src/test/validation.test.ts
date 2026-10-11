const test = require("node:test");
const assert = require("node:assert/strict");
const {
  MAX_RENTAL_DAYS,
  escapeLike,
  escapeRegex,
  normalizeEmail,
  parseUtcDate,
  profileIsComplete,
  validateProfile,
  validateRegistration,
  validateRentalDates,
} = require("../lib/validation");

test("normalizes and validates registration credentials", () => {
  assert.equal(normalizeEmail("  DRIVE@example.com "), "drive@example.com");
  assert.deepEqual(validateRegistration({ email: " DRIVE@example.com ", password: "secure-pass" }), {
    value: { email: "drive@example.com", password: "secure-pass" },
  });
  assert.match(validateRegistration({ email: "not-an-email", password: "secure-pass" }).error, /email/i);
  assert.match(validateRegistration({ email: "drive@example.com", password: "short" }).error, /password/i);
  assert.match(validateRegistration({ email: "drive@example.com", password: "😀".repeat(20) }).error, /password/i);
  assert.match(validateRegistration(null).error, /email/i);
});

test("validates required profile details without adding unrequested fields", () => {
  const result = validateProfile({ fullName: "  Alex Driver ", phone: "+44 7700 900123", city: " Edinburgh " });
  assert.deepEqual(result.value, { fullName: "Alex Driver", phone: "+44 7700 900123", city: "Edinburgh" });
  assert.equal(profileIsComplete(result.value), true);
  assert.equal(profileIsComplete({ fullName: "Alex Driver", phone: "", city: "Edinburgh" }), false);
  assert.match(validateProfile({ fullName: "Alex", phone: "call me", city: "London" }).error, /phone/i);
});

test("parses only real, normalized UTC calendar dates", () => {
  assert.equal(parseUtcDate("2028-02-29").toISOString(), "2028-02-29T00:00:00.000Z");
  assert.equal(parseUtcDate("2027-02-29"), null);
  assert.equal(parseUtcDate("2028-2-09"), null);
  assert.equal(parseUtcDate("not-a-date"), null);
});

test("validates future-or-today rental periods and configured duration limits", () => {
  const today = new Date("2028-01-10T11:00:00.000Z");
  assert.equal(validateRentalDates("2028-01-10", "2028-01-12", today).value.days, 2);
  assert.match(validateRentalDates("2028-01-09", "2028-01-12", today).error, /today or a future/i);
  assert.match(validateRentalDates("2028-01-12", "2028-01-12", today).error, /after/i);
  assert.match(
    validateRentalDates("2028-01-10", "2028-04-10", today).error,
    new RegExp(String(MAX_RENTAL_DAYS)),
  );
});

test("escapes user input before it is used in a database search expression", () => {
  assert.equal(escapeRegex("BMW (M4) +"), "BMW \\(M4\\) \\+");
  assert.equal(escapeLike("BMW!_100%"), "BMW!!!_100!%");
});
