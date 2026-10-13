export function createAgentPrompt(options?: {
  type?: "game" | "tool" | "extension";
  requirements?: string;
  sdkTypes?: string;
  shellTypes?: string;
}): string;
