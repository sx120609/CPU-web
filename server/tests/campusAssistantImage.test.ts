import test from "node:test";
import assert from "node:assert/strict";
import { selectCampusAssistantImageProviders } from "../src/services/campusAssistantImage";
import type { AiProviderCandidate } from "../src/services/aiJsonApi";

const candidate = (name: string, provider: string, apiUrl = "https://relay.example/v1"): AiProviderCandidate =>
  ({ name, provider, apiUrl, apiKey: "test" }) as AiProviderCandidate;

test("image generation skips services that have no image2 endpoint", () => {
  const selected = selectCampusAssistantImageProviders([
    candidate("Claude", "anthropic"),
    candidate("local", "ollama"),
    candidate("blank", "openai", " "),
    candidate("relay", "openai"),
    candidate("second", "OpenAI"),
  ]);
  assert.deepEqual(selected.map((provider) => provider.name), ["relay", "second"]);
});
