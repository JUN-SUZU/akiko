import {
  DOCS_PAGE_NAME_TO_JA,
  MAJOR_TO_DOCS_PAGE_NAME,
  type DocsPageName,
  type Major,
} from "./constants";

type Audience = { colleges: readonly DocsPageName[] };
type YearRule = { year: number; comparison: "since" | "until" | "exact" };
type Targets = { audiences: Audience[]; years: YearRule[] };

const collegeAliases: Record<DocsPageName, readonly string[]> = {
  help: ["人文"],
  ccc: ["比文", "比較文化"],
  jpjp: ["日日", "日本語・日本文化"],
  css: ["社会"],
  cis: ["国際", "国際総合"],
  edu: ["教育"],
  psy: ["心理"],
  ds: ["障害", "障害科学"],
  biol: ["生物"],
  bres: ["資源", "生物資源"],
  earth: ["地球"],
  math: ["数学"],
  physics: ["物理"],
  chem: ["化学"],
  coens: ["応理", "応用理工"],
  esys: ["工シス", "工学システム"],
  pops: ["社工", "社会工学"],
  coins: ["情報", "情報科学"],
  mast: ["創成", "情報メディア創成"],
  klis: ["知識", "知識情報・図書館"],
  med: ["医学"],
  nurse: ["看護"],
  meds: ["医療", "医療科学"],
  pe: ["体育"],
  art: ["芸術"],
};

const aliasToColleges = new Map<string, readonly DocsPageName[]>();
for (const [college, aliases] of Object.entries(collegeAliases) as [
  DocsPageName,
  readonly string[],
][]) {
  for (const alias of [...aliases, DOCS_PAGE_NAME_TO_JA[college]]) {
    aliasToColleges.set(alias, [college]);
  }
}
const groups: Record<string, readonly DocsPageName[]> = {
  "人文・文化学群": ["help", "ccc", "jpjp"],
  "社会・国際学群": ["css", "cis"],
  人間学群: ["edu", "psy", "ds"],
  生命環境学群: ["biol", "bres", "earth"],
  理工学群: ["math", "physics", "chem", "coens", "esys", "pops"],
  情報学群: ["coins", "mast", "klis"],
  医学群: ["med", "nurse", "meds"],
};
for (const [group, colleges] of Object.entries(groups))
  aliasToColleges.set(group, colleges);
const allColleges = Object.keys(collegeAliases) as DocsPageName[];
for (const alias of ["全学群", "全学類", "全学", "全学群・学類"])
  aliasToColleges.set(alias, allColleges);
// 総学 is a separate audience, not an alias for the student's current college.
for (const alias of ["総学", "総合学域群"]) aliasToColleges.set(alias, []);

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
const aliasPattern = [...aliasToColleges.keys()]
  .sort((a, b) => b.length - a.length)
  .map(escapeRegex)
  .join("|");
const separator = "(?:[,、・/]|及び|および|又は|または|と|並びに|ならびに)";
const classSuffix = "(?:[0-9]+(?:[,・~〜-][0-9]+)*(?:クラス|組|班)?)?";
const itemPattern = `(?:${aliasPattern})${classSuffix}`;
const audiencePattern = new RegExp(
  `(${itemPattern}(?:${separator}${itemPattern})*)[」』)】]*(?:[0-9]+(?:[,・~〜-][0-9]+)*(?:班|組|クラス))?(?:の)?(?:学生|学類生|学群生|正規生|生)?(?:のみ|主)?(?:を|が)?$`,
);
const aliasMatcher = new RegExp(aliasPattern, "g");

function audienceBeforeTarget(prefix: string): Audience | undefined {
  const match = audiencePattern.exec(prefix);
  if (!match) return undefined;
  // Don't interpret an alias embedded in a longer unknown name as a college.
  const preceding = prefix[match.index - 1];
  if (preceding && !/[「『(【、,:：]/.test(preceding)) return undefined;
  const colleges = new Set<DocsPageName>();
  for (const alias of match[1].matchAll(aliasMatcher)) {
    for (const college of aliasToColleges.get(alias[0]) ?? [])
      colleges.add(college);
  }
  return { colleges: [...colleges] };
}

const yearPattern =
  /(?:(令和|平成|昭和)(元|\d{1,2})|(\d{4}))(?:年度|年)(?:の)?(?:(以降|以後|以前|から|まで)(?:の)?(?:入学者|入学生|入学の者)|(?:入学者|入学生)(以降|以後|以前|まで)?(?:の学生)?)(?:を|が|のみ)?対象/g;
const parsedCache = new Map<string, Targets>();

function parseTargets(remark: string): Targets {
  const cached = parsedCache.get(remark);
  if (cached) return cached;
  let text = remark.normalize("NFKC").replace(/[\t \u3000]/g, "");
  // A target annotation attached to a named prerequisite describes that other course.
  text = text.replace(/([「『][^」』]+[」』])\([^()]*対象[^()]*\)/g, "$1");
  const audiences: Audience[] = [];
  const years: YearRule[] = [];
  for (const match of text.matchAll(yearPattern)) {
    const eraYear = match[2] === "元" ? 1 : Number(match[2]);
    const year = match[3]
      ? Number(match[3])
      : eraYear + ({ 令和: 2018, 平成: 1988, 昭和: 1925 }[match[1]] ?? 0);
    const comparison = match[4] || match[5];
    years.push({
      year,
      comparison:
        comparison === "以前" || comparison === "まで"
          ? "until"
          : comparison
            ? "since"
            : "exact",
    });
    const prefix =
      text
        .slice(0, match.index)
        .split(/[。\n.;]/)
        .at(-1) ?? "";
    const audience = audienceBeforeTarget(
      prefix.replace(/(?:の|生については)$/, ""),
    );
    if (audience) audiences.push(audience);
  }
  for (const segment of text.split(/[。\n.;]/)) {
    for (const clause of segment.split("対象").slice(0, -1)) {
      const audience = audienceBeforeTarget(clause);
      if (audience) audiences.push(audience);
    }
  }
  const result = { audiences, years };
  parsedCache.set(remark, result);
  return result;
}

/** Check explicit college/group and admission-year targets; unknown conditions stay visible. */
export function courseMatchesTarget(
  remark: string,
  major: Major,
  admissionYear: number,
): boolean {
  const { audiences, years } = parseTargets(remark);
  const college = MAJOR_TO_DOCS_PAGE_NAME[major];
  if (
    audiences.length > 0 &&
    !audiences.some((audience) => audience.colleges.includes(college))
  )
    return false;
  return years.every((rule) =>
    rule.comparison === "since"
      ? admissionYear >= rule.year
      : rule.comparison === "until"
        ? admissionYear <= rule.year
        : admissionYear === rule.year,
  );
}
