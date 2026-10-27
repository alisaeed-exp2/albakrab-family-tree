import "server-only";
import { prisma } from "./db";
import { computeFamily, type Family } from "./family";

export async function loadFamily(): Promise<Family> {
  const [persons, marriages] = await Promise.all([
    prisma.person.findMany({
      select: { id: true, name: true, gender: true, fatherId: true, motherId: true, parentMarriageId: true },
      orderBy: { id: "asc" },
    }),
    prisma.marriage.findMany({
      select: { id: true, husbandId: true, wifeId: true, order: true },
    }),
  ]);
  return computeFamily(persons, marriages);
}
