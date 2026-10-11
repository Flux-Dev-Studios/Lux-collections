const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^[+\d][\d\s()+.-]{6,23}$/;
const PROFILE_FIELDS = ["fullName", "phone", "city"] as const;
export const MAX_RENTAL_DAYS = 90;

export interface Profile {
  fullName: string;
  phone: string;
  city: string;
}

export interface Registration {
  email: string;
  password: string;
}

export interface RentalDates {
  from: Date;
  to: Date;
  days: number;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function normalizeEmail(email: unknown): string {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

export function validateRegistration(body: unknown): { error: string } | { value: Registration } {
  const input = asRecord(body);
  const email = normalizeEmail(input.email);
  const password = typeof input.password === "string" ? input.password : "";
  if (!EMAIL_PATTERN.test(email) || email.length > 254) {
    return { error: "Enter a valid email address." };
  }
  if (password.length < 8 || Buffer.byteLength(password, "utf8") > 72) {
    return { error: "Your password must be between 8 and 72 characters." };
  }
  return { value: { email, password } };
}

export function validateProfile(body: unknown): { error: string } | { value: Profile } {
  const input = asRecord(body);
  const profile: Profile = {
    fullName: typeof input.fullName === "string" ? input.fullName.trim() : "",
    phone: typeof input.phone === "string" ? input.phone.trim() : "",
    city: typeof input.city === "string" ? input.city.trim() : "",
  };
  if (profile.fullName.length < 2 || profile.fullName.length > 80) {
    return { error: "Enter your name (2–80 characters)." };
  }
  if (!PHONE_PATTERN.test(profile.phone) || profile.phone.length > 25) {
    return { error: "Enter a valid phone number." };
  }
  if (profile.city.length < 2 || profile.city.length > 80) {
    return { error: "Enter your home city (2–80 characters)." };
  }
  return { value: profile };
}

export function profileIsComplete(profile: Partial<Profile> | null | undefined): boolean {
  return PROFILE_FIELDS.every((field) => {
    const value = profile?.[field];
    return typeof value === "string" && value.trim().length > 0;
  });
}

export function parseUtcDate(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

export function validateRentalDates(
  fromValue: unknown,
  toValue: unknown,
  today = new Date(),
): { error: string } | { value: RentalDates } {
  const from = parseUtcDate(fromValue);
  const to = parseUtcDate(toValue);
  const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  if (!from || !to) return { error: "Enter valid pick-up and return dates." };
  if (from < todayUtc) return { error: "Pick-up must be today or a future date." };
  const days = (to.getTime() - from.getTime()) / 86_400_000;
  if (!Number.isInteger(days) || days < 1) {
    return { error: "The return date must be after the pick-up date." };
  }
  if (days > MAX_RENTAL_DAYS) {
    return { error: `Rentals can be booked for up to ${MAX_RENTAL_DAYS} days.` };
  }
  return { value: { from, to, days } };
}

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function escapeLike(value: string): string {
  return value.replace(/[!%_]/g, "!$&");
}
