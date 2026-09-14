# AI providers

The co-pilot never calls a vendor SDK directly. It asks `AiService` for one structured answer: a call to the
`submit_changes` tool, validated in `copilot/copilot-plan.ts` and then run through the safety net like every other
change. Vendors plug in behind that seam.

| File | Role |
|---|---|
| `ai-provider.ts` | The `AiProvider` contract and `AiProviderError` (retryable or not). |
| `ai-models.ts` | Every model as data: provider, vendor model id, tier, token budget. |
| `ai.service.ts` | `createProviders()` (one line per vendor), model lookup, the selector catalogue. |
| `*.provider.ts` | One file per vendor. |
| `ai-provider.conformance.spec.ts` | The contract every provider must pass. |

## Turn on a Pro model you've paid for

1. Add the vendor key to `backend/.env` (e.g. `ANTHROPIC_API_KEY`). The provider reports itself configured.
2. Its models are already in `ai-models.ts`. They show as locked until plans ship (Phase 14); to offer one before
   then, set its `tier` to `"free"`.

## Add a new model from an existing vendor

Add one entry to `buildModels()` in `ai-models.ts`. Use a new `id` (ids are stored with chat messages — never reuse one
for a different model) and a budget from `BUDGET`.

## Add a new vendor

1. Add its id to `AiProviderId` in `ai-provider.ts`.
2. Create `<vendor>.provider.ts` implementing `AiProvider`:
   - accept an injectable client (for tests) and load the SDK lazily in `generate()`;
   - offer `request.tool` and return its arguments as `output` (`null` when the model didn't call it);
   - map vendor errors to `AiProviderError`, with `retryable: true` for rate limits, overload and network errors.
3. Add the key to `config/env.ts` and one line to `createProviders()`.
4. Add the vendor to `PROVIDERS` in `ai-provider.conformance.spec.ts` and make it pass.

Nothing else changes: the prompt, the edit validation and the safety net are shared by every provider.
