import type { ConverseCommandOutput } from "@aws-sdk/client-bedrock-runtime";
import { AiProviderError, type AiProvider, type AiRequest, type AiResult } from "./ai-provider";

export interface BedrockCredentials {
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

/** The part of the SDK client this provider uses; tests pass a fake. */
export interface BedrockSender {
  send(command: unknown, options?: { abortSignal?: AbortSignal }): Promise<ConverseCommandOutput>;
}

const RETRYABLE = new Set(["ThrottlingException", "ServiceUnavailableException", "InternalServerException", "ModelNotReadyException", "ModelTimeoutException"]);

/** AWS Bedrock through the Converse API, with forced tool use for structured output. */
export class BedrockProvider implements AiProvider {
  readonly id = "bedrock" as const;
  private client: BedrockSender | null;

  constructor(
    private readonly credentials: BedrockCredentials,
    client?: BedrockSender,
  ) {
    this.client = client ?? null;
  }

  configured(): boolean {
    return Boolean(this.client || (this.credentials.region && this.credentials.accessKeyId && this.credentials.secretAccessKey));
  }

  async generate(request: AiRequest): Promise<AiResult> {
    if (!this.configured()) throw new AiProviderError(this.id, "AWS Bedrock isn't configured.", false, "NOT_CONFIGURED");
    // Loaded lazily so the api role and tests never pay for the SDK.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sdk = require("@aws-sdk/client-bedrock-runtime") as typeof import("@aws-sdk/client-bedrock-runtime");
    this.client ??= new sdk.BedrockRuntimeClient({
      region: this.credentials.region,
      credentials: { accessKeyId: this.credentials.accessKeyId!, secretAccessKey: this.credentials.secretAccessKey! },
      maxAttempts: 2,
    });

    const command = new sdk.ConverseCommand({
      modelId: request.providerModel,
      system: [{ text: request.system }],
      messages: request.messages.map((message) => ({ role: message.role, content: [{ text: message.text }] })),
      inferenceConfig: { maxTokens: request.maxTokens, temperature: request.temperature },
      toolConfig: {
        tools: [{ toolSpec: { name: request.tool.name, description: request.tool.description, inputSchema: { json: request.tool.schema as never } } }],
        toolChoice: { tool: { name: request.tool.name } },
      },
    });

    let response: ConverseCommandOutput;
    try {
      response = await this.client.send(command, { abortSignal: request.signal });
    } catch (error) {
      const name = (error as { name?: string }).name ?? "Error";
      throw new AiProviderError(this.id, (error as Error).message ?? String(error), RETRYABLE.has(name), name);
    }

    const content = response.output?.message?.content ?? [];
    const toolUse = content.find((block) => block.toolUse?.name === request.tool.name)?.toolUse;
    return {
      output: toolUse?.input ?? null,
      text: content.map((block) => block.text ?? "").join(""),
      usage: { inputTokens: response.usage?.inputTokens ?? 0, outputTokens: response.usage?.outputTokens ?? 0 },
      stopReason: response.stopReason ?? null,
    };
  }
}
