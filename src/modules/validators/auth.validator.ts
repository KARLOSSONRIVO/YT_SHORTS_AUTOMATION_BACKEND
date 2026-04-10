import { z } from "zod";

const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .max(100, "Password must be at most 100 characters.");

export const mockLoginSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(2).max(100)
});

export const registerSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(2).max(100),
  password: passwordSchema
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: passwordSchema
});
