import "server-only";

import { z } from "zod";

const adminLoginConfigSchema = z.object({
  enabled: z.literal("true"),
  username: z.string().trim().min(1).max(64),
  email: z.string().trim().email().max(254),
});

export type AdminLoginConfig = z.infer<typeof adminLoginConfigSchema>;

export function getAdminLoginConfig(): AdminLoginConfig | null {
  const parsed = adminLoginConfigSchema.safeParse({
    enabled: process.env.FOODTOPIA_ADMIN_LOGIN_ENABLED,
    username: process.env.FOODTOPIA_ADMIN_USERNAME,
    email: process.env.FOODTOPIA_ADMIN_EMAIL,
  });
  return parsed.success ? parsed.data : null;
}

export function isAdminLoginEnabled() {
  return getAdminLoginConfig() !== null;
}

export function matchesAdminUsername(input: string, configured: string) {
  return input.trim().toLocaleLowerCase("en-US") ===
    configured.trim().toLocaleLowerCase("en-US");
}
