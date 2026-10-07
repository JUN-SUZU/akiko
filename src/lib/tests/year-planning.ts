import {
  akikoExportForTwins,
  akikoGetOccupiedSlots,
  akikoIsOccupied,
  akikoNew,
  isCourseId,
  type CourseId,
  type KnownCourse,
  type Slot,
} from "$lib/akiko";
import { createCreditRequirementsOrFail } from "$lib/app-setup";
import { assert } from "$lib/util";

function courseId(value: string): CourseId {
  assert(isCourseId(value));
  return value;
}

const first = courseId("GB40000");
const second = courseId("GB50000");
const slot: Slot = {
  term: "spring-a",
  when: { kind: "regular", dow: "mon", period: 1 },
};
function knownCourse(id: CourseId): KnownCourse {
  return {
    id,
    name: id,
    credit: 1,
    expects: [1],
    expectsString: "1",
    slots: [slot],
    slotsString: "春A月1",
    availability: "available",
    remark: "",
  };
}

const akiko = akikoNew(
  [knownCourse(first), knownCourse(second)],
  [],
  [],
  new Map<CourseId, "might-take">([
    [first, "might-take"],
    [second, "might-take"],
  ]),
  new Map(),
  new Map(),
  new Map(),
  createCreditRequirementsOrFail({
    cells: {},
    columns: {},
    compulsory: 0,
    elective: 0,
  }),
);
assert(akiko !== undefined);

// Identical slots in different planned years must not block either export.
assert(akikoExportForTwins(akiko).kind === "err");
const firstYear = akikoExportForTwins(akiko, new Set([first]));
assert(firstYear.kind === "ok");
assert(firstYear.toExport.length === 1 && firstYear.toExport[0].id === first);
const secondYear = akikoExportForTwins(akiko, new Set([second]));
assert(secondYear.kind === "ok");
assert(
  secondYear.toExport.length === 1 && secondYear.toExport[0].id === second,
);

assert(
  !akikoIsOccupied(akiko, akikoGetOccupiedSlots(akiko, new Set()), second),
);
assert(
  akikoIsOccupied(
    akiko,
    akikoGetOccupiedSlots(akiko, new Set([first])),
    second,
  ),
);

console.log(import.meta.filename, "ok");
