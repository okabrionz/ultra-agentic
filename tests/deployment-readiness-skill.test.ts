import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const skillPath = join(root, "skills", "deployment-readiness", "SKILL.md");
const templatePath = join(
  root,
  "skills",
  "deployment-readiness",
  "checklist-template.md",
);

async function readSkillFiles() {
  return {
    skill: await readFile(skillPath, "utf8"),
    template: await readFile(templatePath, "utf8"),
  };
}

test("deployment-readiness skill has discoverable, bounded frontmatter", async () => {
  const { skill } = await readSkillFiles();
  const frontmatter = skill.match(/^---\r?\n([\s\S]*?)\r?\n---/);

  assert.ok(frontmatter, "SKILL.md must start with YAML frontmatter");
  const metadata = frontmatter[1] ?? "";
  assert.match(metadata, /^name:\s*deployment-readiness\s*$/m);

  const description =
    metadata.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? "";
  assert.match(description, /^Use when\b/);
  for (const trigger of ["deployment", "release", "hotfix", "migration"]) {
    assert.match(description.toLowerCase(), new RegExp(`\\b${trigger}\\b`));
  }
  assert.doesNotMatch(metadata, /^disable-model-invocation:/m);

  const lines = skill.split(/\r?\n/).length;
  const words = skill.match(/\b[\p{L}\p{N}_'-]+\b/gu)?.length ?? 0;
  assert.ok(lines < 500, `SKILL.md has ${lines} lines; expected fewer than 500`);
  assert.ok(words < 500, `SKILL.md has ${words} words; expected fewer than 500`);

  const localReferences = [...skill.matchAll(/\[[^\]]+]\(([^)]+\.md)\)/g)].map(
    ([, target]) => target,
  );
  assert.deepEqual(localReferences, ["checklist-template.md"]);
});

test("deployment-readiness skill defines the evidence and decision contracts", async () => {
  const { skill } = await readSkillFiles();
  const plainSkill = skill.replaceAll("**", "");

  for (const status of [
    "PASS",
    "BLOCKED",
    "UNKNOWN",
    "NOT_APPLICABLE",
  ]) {
    assert.match(skill, new RegExp(`\\b${status}\\b`));
  }
  assert.match(skill, /UNKNOWN is not PASS/);

  for (const category of [
    "artifact/version",
    "build/tests",
    "configuration/secrets",
    "data/schema",
    "security",
    "observability",
    "rollout/canary",
    "rollback artifact/procedure/triggers",
    "ownership",
    "post-release validation",
  ]) {
    assert.ok(
      skill.toLowerCase().includes(category),
      `missing release category: ${category}`,
    );
  }

  assert.match(skill, /evidence reference/i);
  assert.match(skill, /timestamp/i);
  assert.match(
    plainSkill,
    /GO only when all critical and non-critical gates are PASS or justified NOT_APPLICABLE/,
  );
  assert.match(
    plainSkill,
    /CONDITIONAL_GO only when all critical gates are PASS or justified NOT_APPLICABLE and at least one non-critical gap is BLOCKED or UNKNOWN with an owner and deadline/,
  );
  assert.match(plainSkill, /NO_GO otherwise/);
  assert.doesNotMatch(
    plainSkill,
    /GO only with no BLOCKED or UNKNOWN critical gate/,
  );
  assert.match(skill, /Pressure or authority cannot replace evidence/);
});

test("copyable checklist keeps the stable report sections in order", async () => {
  const { template } = await readSkillFiles();
  const headings = [
    "# Decision",
    "## Evidence matrix",
    "## Blockers and conditions",
    "## Rollout",
    "## Rollback",
    "## Owners",
    "## Next evidence required",
  ];

  let previous = -1;
  for (const heading of headings) {
    const index = template.indexOf(heading);
    assert.ok(index > previous, `${heading} is missing or out of order`);
    previous = index;
  }

  assert.match(template, /Decision:\s*(GO \| CONDITIONAL_GO \| NO_GO)/);
  assert.match(template, /PASS \| BLOCKED \| UNKNOWN \| NOT_APPLICABLE/);
  assert.match(template, /Evidence reference/);
  assert.match(template, /Observed at/);
  assert.match(template, /Rollback trigger/);
  assert.match(template, /Rollback owner/);
});
