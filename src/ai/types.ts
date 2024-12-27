import {s} from "ajv-ts";

export const OpenAIProviderConfig = s.object({
    apiKey: s.string(),
    baseUrl: s.string().optional(),
    temperature: s.number().min(0).max(2).optional().default(0.7),
    maxTokens: s.number().positive().optional().default(2048),
    topP: s.number().min(0).max(1).optional().default(0.9),
    presencePenalty: s.number().min(-2).max(2).optional().default(0),
    frequencyPenalty: s.number().min(-2).max(2).optional().default(0),
    seed: s.number().int().optional(),
    organizationId: s.string().optional(),
    projectId: s.string().optional(),
});

export type OpenAIProviderConfig = s.infer<typeof OpenAIProviderConfig>;
