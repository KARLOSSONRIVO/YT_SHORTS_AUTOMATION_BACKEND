import { z } from "zod";

export const mockLoginSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(2).max(100)
});
