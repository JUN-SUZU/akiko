import assert from "node:assert/strict";
import { courseMatchesTarget } from "../course-target";
import { knownCourses } from "../current-courses";

assert.equal(courseMatchesTarget("医学対象", "med-new", 2023), true);
assert.equal(courseMatchesTarget("医学対象", "meds-ms", 2023), false);
assert.equal(courseMatchesTarget("医療科学対象", "meds-ims", 2023), true);
assert.equal(courseMatchesTarget("医療科学対象", "med", 2023), false);
assert.equal(courseMatchesTarget("情報対象", "coins-cs", 2023), true);
assert.equal(courseMatchesTarget("情報対象", "mast", 2023), false);
assert.equal(courseMatchesTarget("知識対象", "klis-system", 2023), true);
assert.equal(courseMatchesTarget("生物資源学類対象", "bres-as", 2023), true);
assert.equal(courseMatchesTarget("生物資源学類対象", "biol", 2023), false);
assert.equal(courseMatchesTarget("情報学群対象", "mast", 2023), true);
assert.equal(courseMatchesTarget("情報学群対象", "math", 2023), false);
assert.equal(
  courseMatchesTarget("国際総合学類の学生のみ対象", "cis-id", 2023),
  true,
);
assert.equal(
  courseMatchesTarget("国際総合学類の学生のみ対象", "coins", 2023),
  false,
);
const audience =
  "「医学、看護、医療科学、芸術、生物、地球、数学、物理、化学、創成、総学3・4組」対象";
assert.equal(courseMatchesTarget(audience, "nurse-n", 2023), true);
assert.equal(courseMatchesTarget(audience, "mast", 2023), true);
assert.equal(courseMatchesTarget(audience, "coins", 2023), false);
assert.equal(
  courseMatchesTarget(
    "「医学、看護、医療科学、芸術、総学4組」 1班対象",
    "coins",
    2023,
  ),
  false,
);
assert.equal(courseMatchesTarget("教育1・2クラス対象", "edu", 2023), true);
assert.equal(courseMatchesTarget("教育1・2クラス対象", "psy", 2023), false);
assert.equal(
  courseMatchesTarget("全学群対象(「医学、情報」優先)", "math", 2023),
  true,
);
assert.equal(courseMatchesTarget("対面。事前登録対象", "coins", 2023), true);
assert.equal(courseMatchesTarget("短期留学生のみ対象", "coins", 2023), true);
assert.equal(
  courseMatchesTarget("医学の知識を扱う授業。事前登録対象", "coins", 2023),
  true,
);
assert.equal(courseMatchesTarget("未知の学類対象", "coins", 2023), true);
assert.equal(
  courseMatchesTarget("2019年度以降入学者対象", "coins", 2018),
  false,
);
assert.equal(
  courseMatchesTarget("2019年度以降入学者対象", "coins", 2019),
  true,
);
assert.equal(
  courseMatchesTarget("2018年度以前入学者対象", "coins", 2018),
  true,
);
assert.equal(
  courseMatchesTarget("2018年度以前入学者対象", "coins", 2019),
  false,
);
assert.equal(
  courseMatchesTarget("2019年度以降の入学者対象", "coins", 2023),
  true,
);
assert.equal(
  courseMatchesTarget("令和4年度以降入学者対象", "coins", 2021),
  false,
);
assert.equal(
  courseMatchesTarget("令和4年度以降入学者対象", "coins", 2022),
  true,
);
assert.equal(
  courseMatchesTarget("令和2年度以前入学者対象", "coins", 2021),
  false,
);
assert.equal(
  courseMatchesTarget(
    "平成30年度入学者以前の学生を対象とする。",
    "coins",
    2018,
  ),
  true,
);
assert.equal(
  courseMatchesTarget(
    "平成30年度入学者以前の学生を対象とする。",
    "coins",
    2019,
  ),
  false,
);
assert.equal(
  courseMatchesTarget("2023年度入学生以降を対象。", "coins", 2022),
  false,
);
assert.equal(
  courseMatchesTarget("2022年度入学生までを対象。", "coins", 2023),
  false,
);
assert.equal(
  courseMatchesTarget("2024年度入学者までが対象。", "coins", 2024),
  true,
);
assert.equal(
  courseMatchesTarget("2024年度入学者までが対象。", "coins", 2025),
  false,
);
assert.equal(
  courseMatchesTarget("２０２４年度入学者対象", "coins", 2024),
  true,
);
assert.equal(courseMatchesTarget("2024年度入学者対象", "coins", 2023), false);
assert.equal(
  courseMatchesTarget("情報対象\n2022年度以降入学者対象", "coins", 2021),
  false,
);
assert.equal(
  courseMatchesTarget("情報対象\n2022年度以降入学者対象", "mast", 2023),
  false,
);
assert.equal(
  courseMatchesTarget("情報対象\n2022年度以降入学者対象", "coins", 2023),
  true,
);
assert.equal(
  courseMatchesTarget(
    "情報メディア創成学類の2019年度以降の入学者対象。",
    "mast",
    2023,
  ),
  true,
);
assert.equal(
  courseMatchesTarget(
    "情報メディア創成学類の2019年度以降の入学者対象。",
    "coins",
    2023,
  ),
  false,
);
assert.equal(
  courseMatchesTarget(
    "「旧科目」(2018年度以前入学者対象)、もしくは「新科目」(2019年度以降入学者対象)を履修していることが望ましい。",
    "coins",
    2023,
  ),
  true,
);

const remarks = new Map<string, string>(
  knownCourses.map((course) => [course.id, course.remark]),
);
assert.equal(
  courseMatchesTarget(remarks.get("31HH012") ?? "", "coins", 2018),
  false,
);
assert.equal(
  courseMatchesTarget(remarks.get("31HH012") ?? "", "coins", 2019),
  true,
);
assert.equal(
  courseMatchesTarget(remarks.get("GC24501") ?? "", "coins", 2023),
  false,
);
assert.equal(
  courseMatchesTarget(remarks.get("GC24501") ?? "", "mast", 2023),
  true,
);
assert.equal(
  courseMatchesTarget(remarks.get("GC50501") ?? "", "coins", 2023),
  true,
);
console.log(import.meta.filename, "ok");
