import type { Profile } from "../lib/validation";

declare global {
  namespace Express {
    interface Request {
      user: {
        id: string;
        email: string;
        role: "customer" | "operator" | "admin";
        profile: Profile;
      };
    }
  }
}

export {};
