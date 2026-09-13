import "reflect-metadata";
import type { DynamicModule, Type } from "@nestjs/common";
// Not re-exported from the package root. If @nestjs/bullmq renames it, this import fails loudly.
import { PROCESSOR_METADATA } from "@nestjs/bullmq/dist/bull.constants";

type ModuleRef =
  | Type<unknown>
  | DynamicModule
  | Promise<DynamicModule>
  | { forwardRef: () => ModuleRef };

/**
 * Walks a module graph statically — nothing is instantiated, so no database or Redis is needed —
 * and returns every provider class decorated as a BullMQ processor.
 *
 * Async because some modules (ConfigModule.forRoot, anything *.forRootAsync-shaped) are Promises;
 * skipping them would let a processor hide inside one.
 */
export async function findProcessors(root: ModuleRef): Promise<Type<unknown>[]> {
  const seen = new Set<unknown>();
  const found = new Set<Type<unknown>>();

  const visit = async (input: ModuleRef | undefined): Promise<void> => {
    if (!input) return;
    const ref = input instanceof Promise ? await input : input;
    if ("forwardRef" in ref) return visit(ref.forwardRef());
    if (seen.has(ref)) return;
    seen.add(ref);

    const cls = typeof ref === "function" ? ref : ref.module;
    const dynamic = typeof ref === "function" ? undefined : ref;

    const imports: ModuleRef[] = [
      ...(Reflect.getMetadata("imports", cls) ?? []),
      ...(dynamic?.imports ?? []),
    ];
    const providers: unknown[] = [
      ...(Reflect.getMetadata("providers", cls) ?? []),
      ...(dynamic?.providers ?? []),
    ];

    for (const provider of providers) {
      const providerClass =
        typeof provider === "function"
          ? provider
          : (provider as { useClass?: unknown } | undefined)?.useClass;
      if (typeof providerClass === "function" && Reflect.hasMetadata(PROCESSOR_METADATA, providerClass)) {
        found.add(providerClass as Type<unknown>);
      }
    }
    for (const child of imports) await visit(child);
  };

  await visit(root);
  return [...found];
}
