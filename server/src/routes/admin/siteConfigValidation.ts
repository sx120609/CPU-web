import { z } from "zod";

export const anonymousTiersPatchSchema = z.array(z.object({
  reputation: z.number().int().min(0).max(9999),
  quota: z.number().int().min(0).max(999),
})).length(5);
