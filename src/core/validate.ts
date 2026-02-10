import { z } from "zod";

const inputSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("place_url"),
    placeUrl: z.string().url()
  }),
  z.object({
    mode: z.literal("biz_search"),
    name: z.string().min(1),
    address: z.string().min(1),
    phone: z.string().optional()
  })
]);

export const analyzeRequestSchema = z.object({
  input: inputSchema,
  options: z.object({
    plan: z.enum(["free", "pro"]).default("free"),
    language: z.literal("ko").default("ko"),
    depth: z.enum(["standard", "deep"]).default("standard")
  })
});
