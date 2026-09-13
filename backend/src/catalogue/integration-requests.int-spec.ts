/**
 * Integration requests against real Postgres (backend/.env). Run with `pnpm test:int`.
 */
import type { User } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CatalogueService } from "./catalogue.service";
import { IntegrationRequestsService, MAX_REQUESTS_PER_USER } from "./integration-requests.service";

process.loadEnvFile(".env");
jest.setTimeout(60_000);

const prisma = new PrismaService();
const createdUsers: string[] = [];
const available = [{ id: "github-stats", name: "GitHub Stats" }];
const catalogue = { list: async () => available } as unknown as CatalogueService;
const requests = new IntegrationRequestsService(prisma, catalogue);

async function user(): Promise<User> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const created = await prisma.user.create({ data: { githubId: `req-${suffix}`, githubLogin: `req-${suffix}` } });
  createdUsers.push(created.id);
  return created;
}

beforeAll(() => prisma.$connect());
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
  await prisma.$disconnect();
});

it("records one vote per person per integration, and keeps the latest note", async () => {
  const asha = await user();
  expect(await requests.request(asha, { key: "spotify-now-playing" })).toEqual({ key: "spotify-now-playing", name: "Spotify Now Playing", requested: true });
  await requests.request(asha, { key: "spotify-now-playing", note: "For my music page" });

  const rows = await prisma.integrationRequest.findMany({ where: { userId: asha.id } });
  expect(rows).toEqual([expect.objectContaining({ key: "spotify-now-playing", note: "For my music page" })]);
  expect(await requests.keysFor(asha)).toEqual(["spotify-now-playing"]);
});

it("maps a typed suggestion onto the planned entry it names, or keeps it as a suggestion", async () => {
  const ravi = await user();
  expect(await requests.request(ravi, { name: "stripe payment link" })).toMatchObject({ key: "stripe-payment-link", name: "Stripe Payment Link" });
  expect(await requests.request(ravi, { name: "Notion Pages!" })).toEqual({ key: "suggested:notion-pages", name: "Notion Pages!", requested: true });
  expect(await requests.request(ravi, { name: "  notion   pages " })).toMatchObject({ key: "suggested:notion-pages" });
  expect(await prisma.integrationRequest.count({ where: { userId: ravi.id } })).toBe(2);
});

it("refuses to request something already installable, or unknown ids", async () => {
  const meera = await user();
  await expect(requests.request(meera, { key: "github-stats" })).rejects.toThrow("already available");
  await expect(requests.request(meera, { name: "GitHub Stats" })).rejects.toThrow("already available");
  await expect(requests.request(meera, { key: "no-such-plan" })).rejects.toThrow("There's no planned integration");
  await expect(requests.request(meera, {})).rejects.toThrow("Choose an integration or name one.");
  await expect(requests.request(meera, { name: "x".repeat(61) })).rejects.toThrow("under 60 characters");
});

it("withdraws a request", async () => {
  const kai = await user();
  await requests.request(kai, { key: "calendly-booking" });
  expect(await requests.withdraw(kai, "calendly-booking")).toMatchObject({ requested: false });
  await expect(requests.withdraw(kai, "calendly-booking")).rejects.toThrow("haven't requested");
});

it("caps how many integrations one account can request", async () => {
  const noisy = await user();
  await prisma.integrationRequest.createMany({
    data: Array.from({ length: MAX_REQUESTS_PER_USER }, (_, i) => ({ userId: noisy.id, key: `suggested:thing-${i}`, name: `Thing ${i}` })),
  });
  await expect(requests.request(noisy, { key: "posthog" })).rejects.toThrow(`up to ${MAX_REQUESTS_PER_USER}`);
  // Re-requesting something already counted is still allowed.
  await expect(requests.request(noisy, { name: "Thing 1", note: "still want it" })).resolves.toMatchObject({ key: "suggested:thing-1" });
});

it("ranks requests by how many people asked, for the superadmin", async () => {
  const people = await Promise.all([user(), user(), user()]);
  const wanted = `zz-rank-${Date.now()}`;
  for (const person of people) await requests.request(person, { name: wanted, note: `note from ${person.githubLogin}` });
  await requests.request(people[0], { name: `${wanted} solo` });

  const stats = await requests.stats();
  const top = stats.items.find((item) => item.key === `suggested:${wanted}`)!;
  const solo = stats.items.find((item) => item.key === `suggested:${wanted}-solo`)!;
  expect(top).toMatchObject({ count: 3, planned: false, category: null, name: wanted });
  expect(top.notes).toHaveLength(3);
  expect(stats.items.indexOf(top)).toBeLessThan(stats.items.indexOf(solo));
  expect(stats.uniqueRequesters).toBeGreaterThanOrEqual(3);
  const spotify = stats.items.find((item) => item.key === "spotify-now-playing");
  if (spotify) expect(spotify).toMatchObject({ planned: true, category: "other", name: "Spotify Now Playing" });
});
