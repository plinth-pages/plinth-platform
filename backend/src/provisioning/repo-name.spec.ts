import { repoNameCandidates } from "./repo-name";

describe("repoNameCandidates", () => {
  it("starts with portfolio-<login>, then numbered variants", () => {
    expect(repoNameCandidates("SumitVerma77").slice(0, 3)).toEqual([
      "portfolio-sumitverma77",
      "portfolio-sumitverma77-2",
      "portfolio-sumitverma77-3",
    ]);
  });

  it("normalises characters GitHub would reject or rewrite", () => {
    expect(repoNameCandidates("--Odd__Name--")[0]).toBe("portfolio-odd-name");
  });
});
