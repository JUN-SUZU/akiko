<script lang="ts">
  import { resolve, asset } from "$app/paths";
  import ChevronRight from "lucide-svelte/icons/chevron-right";
  import Timetable from "$lib/Timetable.svelte";
  import { type TimetableTab } from "$lib/timetable";
  import HowToImportFromTwins from "$lib/HowToImportFromTwins.svelte";
  import HowToExportForTwins from "$lib/HowToExportForTwins.svelte";
  import Meta from "$lib/Meta.svelte";
  import { SvelteAkiko } from "$lib/akiko.svelte";
  import { MAJOR_TO_JA } from "$lib/constants";
  import { parseImportedCsv } from "$lib/csv";
  import {
    columnIdIsElective,
    courseIdCompare,
    DOWS,
    dowCompare,
    dowToString,
    gradeIsPass,
    isCellId,
    isCourseId,
    akikoNew,
    slotToString,
    termCompare,
    termToString,
    type Availability,
    type BaseCreditStats,
    type CellCreditStats,
    type CreditStats,
    type CellId,
    type ColumnCreditStats,
    type CourseId,
    type Dow,
    type ElectiveCreditStats,
    type FakeCourse,
    type Grade,
    type RealCourse,
    type Slot,
    type Term,
    cellIdToRow,
    cellIdToColumnId,
  } from "$lib/akiko";
  import {
    createCreditRequirementsOrFail,
    classifyCoursesOrFail,
    type MajorConfig,
  } from "$lib/app-setup";
  import { trackEvent } from "$lib/analytics";
  import {
    localDataDefault,
    localDataFromJson,
    localDataToJson,
    type LocalDataV3,
  } from "$lib/local-data";
  import { browser, dev } from "$app/environment";
  import { assert } from "$lib/util.js";
  import Callout from "$lib/Callout.svelte";
  import { tick, untrack, onMount, getContext } from "svelte";
  import { beforeNavigate, goto } from "$app/navigation";
  import { STUDENT_SESSION, type StudentSession } from "$lib/student-session";
  import { ServerAutosave } from "$lib/server-autosave";
  import { courseMatchesTarget } from "$lib/course-target";
  import { base } from "$app/paths";

  type UiOverlapCourse = {
    id: CourseId;
    name: string;
    cellId: CellId | undefined;
  };

  type UiOverlapGroup = {
    slot: string;
    term: TimetableTab;
    courses: UiOverlapCourse[];
  };

  type UiJizentourokuCourse = UiOverlapCourse & { term: TimetableTab };

  type WontTakeFilters = {
    courseIdOrName: string;
    credit: number | undefined;
    expects: number | undefined;
    term: Term | undefined;
    dows: Dow[];
    onlyUnoccupied: boolean;
    onlyMatchingTarget: boolean;
  };

  type UiCourse = {
    id: CourseId;
    name: string;
    credit: number | undefined;
    slots: string | undefined;
    expects: string | undefined;
    expectsRaw: number[];
    slotsRaw: Slot[];
    grade: Grade | undefined;
    takenYear: number | undefined;
    syllabusYear: number;
    availability: Availability;
    remark: string;
    cellId: CellId | undefined;
  };

  let { config }: { config: MajorConfig } = $props();

  const dataScope = $derived(`${config.major}_${config.tableYear}`);
  const studentSession = getContext<StudentSession>(STUDENT_SESSION);
  const studentDataUrl = $derived(
    `${base}/api/students/${studentSession.studentId}/${encodeURIComponent(dataScope)}`,
  );
  const initialData = localDataDefault();
  let storageMessage = $state("");
  let dataReady = $state(false);
  let dataLoading = $state(false);
  let saveStatus = $state<"saving" | "saved" | "error">("saved");
  let initialOverrides = $state(initialData.listKindOverrides);
  let plannedYears = $state(initialData.plannedYears);
  let autosave: ServerAutosave | undefined;
  let mounted = true;

  function snapshot(): LocalDataV3 {
    return {
      version: 3,
      listKindOverrides: svelteAkiko.getListKindOverrides(),
      plannedYears,
      realCourses: Array.from(realCourses),
      fakeCourses: Array.from(fakeCourses),
      native: isNative,
    };
  }

  function restore(json: string) {
    const data = localDataFromJson(json);
    if (!data) throw new Error("保存データの形式が正しくありません。");
    initialOverrides = data.listKindOverrides;
    plannedYears = data.plannedYears;
    realCourses = data.realCourses;
    fakeCourses = data.fakeCourses;
    isNative = data.native;
  }

  function downloadData() {
    const url = URL.createObjectURL(
      new Blob([localDataToJson(snapshot())], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `akiko-${studentSession.studentId}-${dataScope}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function importData(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      if (!window.confirm("現在の履修データをファイルの内容で置き換えますか？"))
        return;
      restore(await file.text());
      storageMessage = "端末のファイルから復元しました。";
    } catch (error) {
      storageMessage =
        error instanceof Error ? error.message : "復元に失敗しました。";
    } finally {
      input.value = "";
    }
  }

  async function loadStudentData() {
    if (dataLoading || dataReady) return;
    dataLoading = true;
    storageMessage = "サーバーから履修データを読み込んでいます。";
    try {
      const response = await fetch(studentDataUrl, {
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok)
        throw new Error(
          "履修データを読み込めませんでした。サーバーへの接続を確認し、再試行してください。",
        );
      const result = (await response.json()) as { data: string };
      if (!mounted) return;
      restore(result.data);
      // Never save defaults over an existing record while its request is loading.
      await tick();
      const url = studentDataUrl;
      autosave = new ServerAutosave(
        async (json) => {
          const saved = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ data: json }),
            signal: AbortSignal.timeout(10000),
          });
          if (!saved.ok) throw new Error("Server save failed");
        },
        (status) => {
          saveStatus = status;
        },
        localDataToJson(snapshot()),
      );
      storageMessage = "";
      dataReady = true;
    } catch (error) {
      storageMessage =
        error instanceof Error ? error.message : "読み込みに失敗しました。";
    } finally {
      dataLoading = false;
    }
  }

  onMount(() => {
    void loadStudentData();
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (autosave?.hasUnsavedData) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      mounted = false;
      autosave?.stopRetries();
      window.removeEventListener("beforeunload", beforeUnload);
    };
  });

  beforeNavigate((navigation) => {
    if (navigation.willUnload || !navigation.to || !autosave?.hasUnsavedData)
      return;
    navigation.cancel();
    const target = navigation.to.url;
    void autosave
      .flush()
      .then(() => {
        // The navigation destination is already resolved by SvelteKit.
        // eslint-disable-next-line svelte/no-navigation-without-resolve
        return goto(target, { replaceState: navigation.type === "popstate" });
      })
      .catch(() => {
        saveStatus = "error";
      });
  });
  let realCourses = $state<RealCourse[]>(initialData.realCourses);
  let fakeCourses = $state<FakeCourse[]>(initialData.fakeCourses);
  let isNative = $state<boolean>(initialData.native);
  let selectedCellId = $state<CellId | undefined>(undefined);
  let showCourseRemark = $state(true);
  let showNonAvailable = $state(false);
  let wontTakeVisibleLimit = $state(100);
  let leftBarScrollEl = $state<HTMLDivElement | undefined>();
  let wontTakeSentinelEl = $state<HTMLDivElement | undefined>();
  let wontTakeFilters = $state<WontTakeFilters>({
    courseIdOrName: "",
    credit: undefined,
    expects: undefined,
    term: undefined,
    dows: [],
    onlyUnoccupied: false,
    onlyMatchingTarget: true,
  });

  const creditRequirements = $derived(
    createCreditRequirementsOrFail(
      config.getCreditRequirements(config.tableYear, config.major),
    ),
  );

  const svelteAkiko = $derived.by(() => {
    const { courseIdToCellId, realCoursePositions, fakeCoursePositions } =
      classifyCoursesOrFail(
        config.knownCourses,
        realCourses,
        fakeCourses,
        isNative,
        config.tableYear,
        config.major,
        config.classifyKnownCourses,
        config.classifyRealCourses,
        config.classifyFakeCourses,
      );
    const akiko = akikoNew(
      config.knownCourses,
      realCourses,
      fakeCourses,
      initialOverrides,
      courseIdToCellId,
      realCoursePositions,
      fakeCoursePositions,
      creditRequirements,
    );
    assert(akiko !== undefined);
    return new SvelteAkiko(akiko);
  });

  const creditStats = $derived(svelteAkiko.getCreditStats());
  const knownCoursesMap = $derived(
    new Map(config.knownCourses.map((c) => [c.id, c])),
  );
  const realCoursesMap = $derived(svelteAkiko.getRealCoursesMap());
  const fakeCourseMap = $derived(svelteAkiko.getFakeCoursesMap());

  $effect(() => {
    if (!browser || !dataReady) return;
    const json = localDataToJson({
      version: 3,
      listKindOverrides,
      plannedYears,
      realCourses: Array.from(realCourses),
      fakeCourses: Array.from(fakeCourses),
      native: isNative,
    });
    untrack(() => autosave?.enqueue(json));
  });

  type Tab = "import" | "export" | "courses" | "settings";

  let timetableShowTaken = $state(true);
  let timetableYear = $state(untrack(() => config.knownCourseYear));
  let activeTimetableTerm = $state<TimetableTab>("spring-a");
  const planYearOptions = $derived(
    Array.from(
      new Set([
        ...Array.from(
          {
            length: Math.max(8, config.knownCourseYear - config.tableYear + 6),
          },
          (_, index) => config.tableYear + index,
        ),
        ...plannedYears.values(),
        timetableYear,
      ]),
    ).sort((a, b) => a - b),
  );

  let barsVisible = $state(true);
  let activeTab = $state<Tab>("courses");
  let compactLayout = $state(
    browser ? window.matchMedia("(max-width: 1350px)").matches : false,
  );

  onMount(() => {
    const query = window.matchMedia("(max-width: 1350px)");
    const update = () => (compactLayout = query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  });

  const SIDEBAR_MARGIN = 100;
  const SIDEBAR_WIDTH_DEFAULT = 740;
  const SIDEBAR_WIDTH_MIN = 500;

  let sidebarWidth = $state(SIDEBAR_WIDTH_DEFAULT);
  let sidebarWidthResizing = $state(false);

  $effect(() => {
    document.documentElement.style.setProperty(
      "--sidebar-width",
      `${sidebarWidth}px`,
    );
  });

  function onSidebarResizePointerDown(
    e: PointerEvent & { currentTarget: HTMLDivElement },
  ) {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    sidebarWidthResizing = true;
  }

  function onSidebarResizePointerMove(e: PointerEvent) {
    if (!sidebarWidthResizing) return;
    const raw = window.innerWidth - e.clientX;
    const snapped = Math.round(raw / 5) * 5;
    sidebarWidth = Math.min(
      window.innerWidth - SIDEBAR_MARGIN,
      Math.max(SIDEBAR_WIDTH_MIN, snapped),
    );
  }

  function onSidebarResizePointerUp() {
    sidebarWidthResizing = false;
  }

  const TIMETABLE_HEIGHT_DEFAULT = 400;
  const TIMETABLE_HEIGHT_MIN = 100;

  let timetableHeight = $state(TIMETABLE_HEIGHT_DEFAULT);
  let timetableHeightResizing = $state(false);

  $effect(() => {
    document.documentElement.style.setProperty(
      "--timetable-height",
      `${timetableHeight}px`,
    );
  });

  $effect(() => {
    const update = () => {
      if (!rightBarEl) return;
      document.documentElement.style.setProperty(
        "--right-bar-top",
        `${rightBarEl.getBoundingClientRect().top}px`,
      );
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  });

  function onTimetableResizePointerDown(
    e: PointerEvent & { currentTarget: HTMLDivElement },
  ) {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    timetableHeightResizing = true;
  }

  function onTimetableResizePointerMove(e: PointerEvent) {
    if (!timetableHeightResizing || !rightBarEl) return;
    const top = rightBarEl.getBoundingClientRect().top;
    const raw = e.clientY - top;
    const snapped = Math.round(raw / 5) * 5;
    timetableHeight = Math.min(
      window.innerHeight - top - SIDEBAR_MARGIN,
      Math.max(TIMETABLE_HEIGHT_MIN, snapped),
    );
  }

  function onTimetableResizePointerUp() {
    timetableHeightResizing = false;
  }

  let scrollX = $state(0);

  // Zoom uses two representations:
  // - zoomLevel: the actual scale multiplier (e.g. 0.7 = 70% of base size)
  // - sliderZoomLevel: a log-scale value driving the slider so equal slider
  //   distances feel like equal zoom steps. slider=0 → ZOOM_MIN,
  //   slider=1 → ZOOM_DEFAULT, slider=ZOOM_SLIDER_MAX → ZOOM_MAX.
  // Pinch/scroll gestures compute a new zoomLevel directly and convert back
  // to sliderZoomLevel via zoomToSlider to keep the slider in sync.
  const tableScale = 2048 / untrack(() => config.tableViewBox.width);
  const ZOOM_DEFAULT = 0.7;
  const ZOOM_MIN = 0.4;
  const ZOOM_MAX = 2;
  const ZOOM_SLIDER_MAX =
    Math.log(ZOOM_MAX / ZOOM_MIN) / Math.log(ZOOM_DEFAULT / ZOOM_MIN);
  function sliderToZoom(s: number): number {
    return Math.min(
      ZOOM_MAX,
      Math.max(ZOOM_MIN, ZOOM_MIN * Math.pow(ZOOM_DEFAULT / ZOOM_MIN, s)),
    );
  }
  function zoomToSlider(z: number): number {
    return Math.log(z / ZOOM_MIN) / Math.log(ZOOM_DEFAULT / ZOOM_MIN);
  }
  let sliderZoomLevel = $state(1);
  const zoomLevel = $derived(sliderToZoom(sliderZoomLevel));

  const cellRects = $derived(
    Object.entries(config.cellIdToRectRecord).map(([id, rect]) => {
      assert(isCellId(id), `Bad cell id: "${id}"`);
      return {
        id,
        x: rect.x * zoomLevel,
        y: rect.y * zoomLevel,
        width: rect.width * zoomLevel,
        height: rect.height * zoomLevel,
      };
    }),
  );

  function handleCsvUpload(event: Event) {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const file = input.files?.[0];
    if (!file) return;
    void file.text().then((csv) => {
      // 同じファイルをもう一度選んだときにも change が発火するようにする
      input.value = "";
      const result = parseImportedCsv(csv);
      if (result.kind !== "ok") {
        alert("CSVファイルを正しく読み込めませんでした。");
        return;
      }
      applyImport(result.realCourses, result.fakeCourses);
    });
  }

  /** 成績データを取り込み、同時に「取る授業」をリセットする */
  function applyImport(
    newRealCourses: RealCourse[],
    newFakeCourses: FakeCourse[],
  ) {
    initialOverrides = new Map();
    plannedYears = new Map();
    realCourses = newRealCourses;
    fakeCourses = newFakeCourses;
    trackEvent(
      "grades",
      "import-grades",
      `${config.tableYear}/${config.major}`,
    );
    if (dev) debugPrintCreditStats(svelteAkiko.getCreditStats());
  }

  function debugPrintCreditStats(stats: CreditStats) {
    function fmt(s: BaseCreditStats): Record<string, number> {
      const o: Record<string, number> = {};
      if (s.rawTaken > 0) {
        if (s.overflowTaken === 0) {
          o.taken = s.rawTaken;
        } else {
          o.rawTaken = s.rawTaken;
          o.effectiveTaken = s.effectiveTaken;
        }
      }
      if (s.rawMightTake > 0) {
        if (s.overflowMightTake === 0) {
          o.mightTake = s.rawMightTake;
        } else {
          o.rawMightTake = s.rawMightTake;
          o.effectiveMightTake = s.effectiveMightTake;
        }
      }
      return o;
    }
    const cells: Record<string, object> = {};
    for (const [cellId, stat] of stats.cells) {
      const cell = fmt(stat);
      if (Object.keys(cell).length > 0) cells[cellId] = cell;
    }
    const columns: Record<string, object> = {};
    for (const [colId, stat] of stats.columns) {
      const col = fmt(stat);
      if (Object.keys(col).length > 0) columns[colId] = col;
    }
    const compulsory = fmt(stats.compulsory);
    const elective = fmt(stats.elective);
    console.log(JSON.stringify({ cells, columns, compulsory, elective }));
  }

  function getSyllabusUrl(courseId: string, year: number) {
    return `https://kdb.tsukuba.ac.jp/syllabi/${year}/${courseId}/jpn`;
  }

  function handleDragStart(
    event: DragEvent,
    courseId: string,
    listKind: "wont-take" | "might-take",
  ) {
    if (event.dataTransfer) {
      event.dataTransfer.setData("text/plain", courseId);
      event.dataTransfer.dropEffect = "move";
    }
    const target = listKind === "wont-take" ? rightBarEl : leftBarEl;
    if (target) {
      const r = target.getBoundingClientRect();
      dropGuide = {
        left: r.left,
        top: r.top,
        width: r.width,
        height: r.height,
      };
    }
  }

  function handleDragEnd() {
    dropGuide = undefined;
  }

  function moveCourse(courseId: CourseId, dst: "wont-take" | "might-take") {
    // undefined means the course actually moved (see akikoMoveCourse); only
    // track real moves so no-op re-drops onto the same list don't count.
    if (svelteAkiko.moveCourse(courseId, dst) === undefined) {
      initialOverrides = new Map(svelteAkiko.getListKindOverrides());
      const nextYears = new Map(plannedYears);
      if (dst === "might-take") nextYears.set(courseId, timetableYear);
      else nextYears.delete(courseId);
      plannedYears = nextYears;
      trackEvent(
        "plan",
        dst === "might-take" ? "add-course" : "remove-course",
        courseId,
      );
    }
    if (dst === "might-take") {
      const slots = knownCoursesMap.get(courseId)?.slots ?? [];
      const terms = slots
        .filter((s) => s.when.kind === "regular")
        .map((s) => s.term);
      if (terms.length === 0) {
        activeTimetableTerm = "other";
      } else if (
        activeTimetableTerm === "other" ||
        !terms.includes(activeTimetableTerm)
      ) {
        activeTimetableTerm = terms[0];
      }
    }
  }

  function handleDrop(event: DragEvent, dst: "wont-take" | "might-take") {
    event.preventDefault();
    const courseId = event.dataTransfer?.getData("text/plain");
    if (courseId === undefined || !isCourseId(courseId)) return;
    moveCourse(courseId, dst);
  }

  function plannedYearFor(courseId: CourseId): number {
    return (
      plannedYears.get(courseId) ??
      (realCoursesMap.get(courseId)?.grade === "wip"
        ? realCoursesMap.get(courseId)?.takenYear
        : undefined) ??
      config.knownCourseYear
    );
  }

  function updatePlannedYear(courseId: CourseId, year: number) {
    plannedYears = new Map(plannedYears).set(courseId, year);
    timetableYear = year;
  }

  // Does not depend on wontTakeFilters
  const courseLists = $derived.by(() => {
    const cs = selectedCellId
      ? svelteAkiko.getCoursesInCell(selectedCellId)
      : svelteAkiko.getAllCourses();
    const courseCellIds = svelteAkiko.getCourseIdToCellId();

    function toUi(id: CourseId): UiCourse {
      const kc = knownCoursesMap.get(id);
      const rc = realCoursesMap.get(id);
      return {
        id,
        name: rc?.name || kc?.name || "（不明）",
        credit: rc?.credit ?? kc?.credit,
        slots: kc?.slotsString,
        expects: kc?.expectsString,
        expectsRaw: kc?.expects ?? [],
        slotsRaw: kc?.slots ?? [],
        grade: rc?.grade,
        takenYear: rc?.takenYear,
        syllabusYear:
          rc?.grade && gradeIsPass(rc.grade)
            ? rc.takenYear
            : config.knownCourseYear,
        availability: kc?.availability ?? "available",
        remark: kc?.remark ?? "",
        cellId: courseCellIds.get(id),
      };
    }

    function gradePriority(g: Grade | undefined): number {
      if (g === "wip") return 0;
      if (g === "d" || g === "fail") return 1;
      return 2;
    }
    const compareByGradeThenId = (a: UiCourse, b: UiCourse): number => {
      const gd = gradePriority(a.grade) - gradePriority(b.grade);
      if (gd !== 0) return gd;
      return courseIdCompare(a.id, b.id);
    };
    const compareById = (a: UiCourse, b: UiCourse) =>
      courseIdCompare(a.id, b.id);
    return {
      wontTake: cs.wontTake
        .map(toUi)
        .filter((c) => showNonAvailable || c.availability === "available")
        .sort(compareByGradeThenId),
      mightTake: cs.mightTake.map(toUi).sort(compareByGradeThenId),
      taken: cs.taken.map(toUi).sort(compareById),
      fake: cs.fake
        .map((id) => fakeCourseMap.get(id))
        .filter((fc) => fc !== undefined),
    };
  });

  const mightTakeCourseIds = $derived(svelteAkiko.getMightTakeCourseIds());
  const plannedForTimetable = $derived(
    mightTakeCourseIds.filter((id) => plannedYearFor(id) === timetableYear),
  );
  const occupiedSlots = $derived(
    svelteAkiko.getOccupiedSlots(new Set(plannedForTimetable)),
  );

  /**
   * 学期と曜日のフィルタに当てはまるか。学期と曜日は同じ Slot が両方を満たす必要
   * があり、曜日を選ぶと曜時限のない授業（集中・応談など）は除外される。
   */
  function matchesSlotFilters(
    slots: Slot[],
    term: Term | undefined,
    dows: Dow[],
  ): boolean {
    if (term === undefined && dows.length === 0) return true;
    return slots.some((s) => {
      if (term !== undefined && s.term !== term) return false;
      if (dows.length === 0) return true;
      return s.when.kind === "regular" && dows.includes(s.when.dow);
    });
  }

  const filteredCourseLists = $derived.by(() => {
    let {
      courseIdOrName,
      credit,
      expects,
      term,
      dows,
      onlyUnoccupied,
      onlyMatchingTarget,
    } = wontTakeFilters;
    courseIdOrName = courseIdOrName.toLowerCase();
    return {
      wontTake: courseLists.wontTake.filter((c) => {
        if (
          onlyMatchingTarget &&
          !courseMatchesTarget(c.remark, config.major, config.tableYear)
        )
          return false;
        if (courseIdOrName) {
          const kc = knownCoursesMap.get(c.id);
          const rc = realCoursesMap.get(c.id);
          const name = rc?.name || kc?.name || "";
          if (
            !c.id.toLowerCase().includes(courseIdOrName) &&
            !name.toLowerCase().includes(courseIdOrName) &&
            !c.remark.toLowerCase().includes(courseIdOrName)
          )
            return false;
        }
        if (credit !== undefined && c.credit !== credit) return false;
        if (expects !== undefined && !c.expectsRaw.includes(expects))
          return false;
        if (!matchesSlotFilters(c.slotsRaw, term, dows)) return false;
        if (onlyUnoccupied && svelteAkiko.isOccupied(occupiedSlots, c.id))
          return false;
        return true;
      }),
      mightTake: courseLists.mightTake,
      taken: courseLists.taken,
      fake: courseLists.fake,
    };
  });

  // Fake courses that landed in a cell, i.e. those that count toward graduation
  const classifiedFakeCourses = $derived(
    Array.from(svelteAkiko.getFakeCoursePositions().keys())
      .map((id) => fakeCourseMap.get(id))
      .filter((c) => c !== undefined),
  );

  const fakeCreditTotal = $derived(
    filteredCourseLists.fake.reduce((sum, c) => sum + (c.credit ?? 0), 0),
  );
  const plannedYearCredits = $derived(
    courseLists.mightTake
      .filter((c) => plannedYearFor(c.id) === timetableYear)
      .reduce((sum, c) => sum + (c.credit ?? 0), 0),
  );

  const availableCredits = $derived.by(() => {
    const credits = new Set<number>();
    for (const c of courseLists.wontTake) {
      if (c.credit !== undefined) credits.add(c.credit);
    }
    return Array.from(credits).sort((a, b) => a - b);
  });
  const availableExpects = $derived.by(() => {
    const expects = new Set<number>();
    for (const c of courseLists.wontTake) {
      for (const e of c.expectsRaw) expects.add(e);
    }
    return Array.from(expects).sort((a, b) => a - b);
  });
  const availableDows = $derived.by(() => {
    const dows = new Set<Dow>();
    for (const c of courseLists.wontTake) {
      for (const s of c.slotsRaw) {
        if (s.when.kind === "regular") dows.add(s.when.dow);
      }
    }
    return Array.from(dows).sort(dowCompare);
  });

  const TERM_GROUP_LABELS = ["モジュール", "学期", "その他"] as const;
  type TermGroupLabel = (typeof TERM_GROUP_LABELS)[number];
  // 春Aと春学期のように紛らわしい学期があるので、選択肢を分類して並べる
  const TERM_TO_GROUP: Record<Term, TermGroupLabel> = {
    "spring-a": "モジュール",
    "spring-b": "モジュール",
    "spring-c": "モジュール",
    "autumn-a": "モジュール",
    "autumn-b": "モジュール",
    "autumn-c": "モジュール",
    spring: "学期",
    autumn: "学期",
    "all-year": "学期",
    "spring-break": "その他",
    "summer-break": "その他",
  };

  const availableTerms = $derived.by(() => {
    const terms = new Set<Term>();
    for (const c of courseLists.wontTake) {
      for (const s of c.slotsRaw) terms.add(s.term);
    }
    return Array.from(terms).sort(termCompare);
  });
  const availableTermGroups = $derived(
    TERM_GROUP_LABELS.map((label) => ({
      label,
      terms: availableTerms.filter((t) => TERM_TO_GROUP[t] === label),
    })).filter((g) => g.terms.length > 0),
  );

  $effect(() => {
    if (
      wontTakeFilters.credit !== undefined &&
      !availableCredits.includes(wontTakeFilters.credit)
    ) {
      wontTakeFilters.credit = undefined;
    }
  });
  $effect(() => {
    if (
      wontTakeFilters.expects !== undefined &&
      !availableExpects.includes(wontTakeFilters.expects)
    ) {
      wontTakeFilters.expects = undefined;
    }
  });
  $effect(() => {
    if (
      wontTakeFilters.term !== undefined &&
      !availableTerms.includes(wontTakeFilters.term)
    ) {
      wontTakeFilters.term = undefined;
    }
  });
  $effect(() => {
    const kept = wontTakeFilters.dows.filter((d) => availableDows.includes(d));
    if (kept.length !== wontTakeFilters.dows.length) {
      wontTakeFilters.dows = kept;
    }
  });

  $effect(() => {
    void selectedCellId;
    void wontTakeFilters.courseIdOrName;
    void wontTakeFilters.credit;
    void wontTakeFilters.expects;
    void wontTakeFilters.term;
    void wontTakeFilters.dows;
    void wontTakeFilters.onlyUnoccupied;
    void wontTakeFilters.onlyMatchingTarget;
    wontTakeVisibleLimit = 100;
  });
  $effect(() => {
    if (!wontTakeSentinelEl || !leftBarScrollEl) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (
          entry.isIntersecting &&
          wontTakeVisibleLimit < filteredCourseLists.wontTake.length
        )
          wontTakeVisibleLimit += 100;
      },
      { root: leftBarScrollEl, rootMargin: "0px 0px 200px 0px" },
    );
    observer.observe(wontTakeSentinelEl);
    return () => observer.disconnect();
  });

  const wontTakeSliced = $derived(
    filteredCourseLists.wontTake.slice(0, wontTakeVisibleLimit),
  );

  const selectedCellStats = $derived(
    selectedCellId !== undefined
      ? creditStats.cells.get(selectedCellId)
      : undefined,
  );
  const selectedCellRemark = $derived(
    selectedCellId !== undefined
      ? config.getRemark?.(selectedCellId, config.tableYear, config.major)
      : undefined,
  );
  const listKindOverrides = $derived(svelteAkiko.getListKindOverrides());
  const takenCourseIds = $derived(svelteAkiko.getTakenCourseIds());
  const unclassifiedCourses = $derived(svelteAkiko.getUnclassifiedCourses());
  const exportForTwinsResult = $derived(
    svelteAkiko.exportForTwins(new Set(plannedForTimetable)),
  );
  const uiJizentouroku = $derived.by((): UiJizentourokuCourse[] => {
    return exportForTwinsResult.jizentouroku.map((kc) => {
      const rc = realCoursesMap.get(kc.id);
      const firstSlot = kc.slots[0];
      const term: TimetableTab =
        firstSlot !== undefined ? firstSlot.term : "other";
      return {
        id: kc.id,
        name: rc?.name ?? kc.name,
        cellId: svelteAkiko.getCellId(kc.id),
        term,
      };
    });
  });
  const uiOverlaps = $derived.by((): UiOverlapGroup[] => {
    if (exportForTwinsResult.kind === "ok") return [];
    return exportForTwinsResult.overlaps.map((overlap) => ({
      slot: slotToString(overlap.slot),
      term: overlap.slot.term,
      courses: overlap.courses.map((kc) => {
        const rc = realCoursesMap.get(kc.id);
        return {
          id: kc.id,
          name: rc?.name ?? kc.name,
          cellId: svelteAkiko.getCellId(kc.id),
        };
      }),
    }));
  });

  function exportMightTake() {
    if (
      exportForTwinsResult.kind !== "ok" ||
      exportForTwinsResult.toExport.length === 0
    )
      return;
    const content = exportForTwinsResult.toExport.map((c) => c.id).join("\n");
    trackEvent(
      "export",
      "export-for-twins",
      `${config.tableYear}/${config.major}`,
      exportForTwinsResult.toExport.length,
    );
    const a = document.createElement("a");
    a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(content);
    a.download = `${timetableYear}年度-科目番号一覧.csv`;
    a.click();
  }

  function reset() {
    const msg =
      "成績データや履修計画をリセットし、サーバーにも保存します。本当にリセットしますか？";
    if (window.confirm(msg)) {
      restore(localDataToJson(localDataDefault()));
      storageMessage = "履修データをリセットしました。";
    }
  }

  function gradeDisplay(g: Grade): string {
    if (g === "wip") return "（履修中）";
    if (g === "d" || g === "fail") return "（落単済み）";
    if (g === "pass") return "評価：P";
    return `評価：${g.toUpperCase()}`;
  }

  function creditBoundsToString(min: number, max: number | undefined): string {
    if (max === undefined) return `${min}~`;
    if (min === max) return min.toString();
    return `${min}~${max}`;
  }

  function cellCreditStatsDisplay(c: CellCreditStats): {
    brief: string;
    warning: string | undefined;
  } {
    let brief = "計:";
    if (c.effectiveMightTake === 0) {
      brief += c.effectiveTaken.toString();
    } else {
      brief += `${c.effectiveTaken}→${c.effectiveTaken + c.effectiveMightTake}`;
    }
    brief += "　要:" + creditBoundsToString(c.min, c.max);

    let warning: string | undefined;
    if (c.overflowTotal > 0) {
      warning = `このマスは合計で${c.max}単位まで有効です。「取る授業」と「単位取得済みの授業」は合計で${c.rawTotal}単位なので、残りの${c.overflowTotal}単位は卒業単位に含まれません。`;
    }

    return { brief, warning };
  }

  function columnCreditStatsDisplay(c: ColumnCreditStats): {
    brief: string;
    warning: string | undefined;
  } {
    let brief = "計:";
    if (c.effectiveMightTake === 0) {
      brief += c.effectiveTaken.toString();
    } else {
      brief += `${c.effectiveTaken}→${c.effectiveTaken + c.effectiveMightTake}`;
    }
    brief += "　要:" + creditBoundsToString(c.min, c.max);

    let warning: string | undefined;
    if (c.overflowTotal > 0) {
      warning = `この列は合計で${c.max}単位まで有効です。「取る授業」と「単位取得済みの授業」は合計で${c.rawTotal}単位なので、残りの${c.overflowTotal}単位は卒業単位に含まれません。`;
    }

    return { brief, warning };
  }

  function electiveCreditStatsDisplay(c: ElectiveCreditStats): {
    brief: string;
    warning: string | undefined;
  } {
    let brief = "選択科目計:";
    if (c.effectiveMightTake === 0) {
      brief += c.effectiveTaken.toString();
    } else {
      brief += `${c.effectiveTaken}→${c.effectiveTaken + c.effectiveMightTake}`;
    }
    brief += "　要:" + creditBoundsToString(c.min, c.max);

    let warning: string | undefined;
    if (c.overflowTotal > 0) {
      warning = `選択科目全体は合計で${c.max}単位まで有効です。「取る授業」と「単位取得済みの授業」は合計で${c.rawTotal}単位なので、残りの${c.overflowTotal}単位は卒業単位に含まれません。`;
    }

    return { brief, warning };
  }

  function getPercentage(
    taken: number,
    mightTake: number,
    min: number,
  ): [number, number] {
    if (min === 0) return [100, 100];
    return [
      Math.min(1, taken / min) * 100,
      Math.min(1, (taken + mightTake) / min) * 100,
    ];
  }

  type UiColumnCredit = {
    colId: string;
    rect: { x: number; width: number };
    display: { brief: string; warning: string | undefined };
    green: number;
    yellow: number;
  };

  // Two-stage derivation: display strings depend only on creditStats, while
  // rects depend on cellRects (updated on every zoom). Keeping them separate
  // prevents recomputing display strings on zoom.
  const uiColumnCreditsWithoutRect = $derived.by(() => {
    const res = new Map<string, Omit<UiColumnCredit, "rect">>();
    for (const [colId, stats] of creditStats.columns) {
      if (!columnIdIsElective(colId)) continue;
      const display = columnCreditStatsDisplay(stats);
      const [green, yellow] = getPercentage(
        stats.effectiveTaken,
        stats.effectiveMightTake,
        stats.min,
      );
      res.set(colId, { colId, display, green, yellow });
    }
    return res;
  });

  const uiColumnCredits = $derived.by(() => {
    const res: UiColumnCredit[] = [];
    for (const rect of cellRects) {
      if (cellIdToRow(rect.id) !== 1) continue;
      const colId = cellIdToColumnId(rect.id);
      const entry = uiColumnCreditsWithoutRect.get(colId);
      if (entry === undefined) continue;
      res.push({ ...entry, rect });
    }
    return res;
  });

  let metaTitle = $derived(
    `あきこ - ${config.tableYear}年度 ${MAJOR_TO_JA[config.major]}`,
  );
  let metaDescription = $derived(
    `${config.tableYear}年度入学の${MAJOR_TO_JA[config.major]}の学生向け履修サポートツールです。単位の計算・授業探し・Twinsへの登録を楽に終わらせましょう！`,
  );

  let requirementsEl = $state<HTMLDivElement | undefined>();
  let leftBarEl = $state<HTMLDivElement | undefined>();
  let rightBarEl = $state<HTMLDivElement | undefined>();

  function scrollCellIntoView(cellId: CellId) {
    const rect = cellRects.find((r) => r.id === cellId);
    if (!rect || !requirementsEl) return;
    requirementsEl.scrollLeft =
      rect.x + rect.width / 2 - requirementsEl.clientWidth / 2;
    requirementsEl.scrollTop =
      rect.y + rect.height / 2 - requirementsEl.clientHeight / 2;
  }

  function focusCell(cellId: CellId) {
    selectedCellId = cellId;
    barsVisible = !compactLayout;
    activeTab = "courses";
    void tick().then(() => scrollCellIntoView(cellId));
  }

  let dropGuide = $state<
    { left: number; top: number; width: number; height: number } | undefined
  >();

  let columnSpanEls = $state<Record<string, HTMLSpanElement | undefined>>({});
  let overallSpanEl = $state<HTMLSpanElement | undefined>();

  $effect(() => {
    void zoomLevel; // re-run squishing when zoom changes container widths
    const spans: HTMLSpanElement[] = [];
    for (const [colId] of creditStats.columns.entries()) {
      if (!columnIdIsElective(colId)) continue;
      const span = columnSpanEls[colId];
      if (span?.isConnected && span.parentElement) spans.push(span);
    }
    if (
      creditStats.elective &&
      overallSpanEl?.isConnected &&
      overallSpanEl.parentElement
    )
      spans.push(overallSpanEl);

    const BORDER = 1;
    const PADDING = 5;

    // Batch write: clear all transforms first
    for (const span of spans) {
      span.style.transform = "";
    }

    // Batch read: measure all at once (single reflow)
    const measurements = spans.map((span) => {
      const maxWidth =
        span.parentElement!.getBoundingClientRect().width -
        (BORDER + PADDING) * 2;
      const spanWidth = span.getBoundingClientRect().width;
      return { span, maxWidth, spanWidth };
    });

    // Batch write: apply all transforms
    for (const { span, maxWidth, spanWidth } of measurements) {
      if (spanWidth > 0) {
        span.style.transform = `scaleX(${Math.min(maxWidth / spanWidth, 1)})`;
      }
    }
  });

  async function handleWheel(e: WheelEvent) {
    if (!e.ctrlKey) return;
    const container = requirementsEl;
    if (!container || !container.contains(e.target as Node)) return;
    e.preventDefault();
    const rect = container.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const oldZoom = zoomLevel;
    const newZoom = Math.min(
      ZOOM_MAX,
      Math.max(ZOOM_MIN, oldZoom * Math.exp(-e.deltaY * 0.01)),
    );
    const f = newZoom / oldZoom;
    const newScrollLeft = (container.scrollLeft + cx) * f - cx;
    const newScrollTop = (container.scrollTop + cy) * f - cy;
    sliderZoomLevel = zoomToSlider(newZoom);
    await tick();
    container.scrollLeft = newScrollLeft;
    container.scrollTop = newScrollTop;
  }

  $effect(() => {
    if (!browser) return;
    const onWheel = (e: WheelEvent) => void handleWheel(e);
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  });

  // ----- Mobile unsupported detection -----
</script>

<Meta title={metaTitle} description={metaDescription} />

{#snippet courseRow(
  c: UiCourse,
  dragSource: "wont-take" | "might-take" | undefined,
  colspan: number,
)}
  {@const draggable = dragSource !== undefined}
  <tr
    class="course"
    {draggable}
    ondragstart={(e) => {
      if (dragSource === undefined) return;
      handleDragStart(e, c.id, dragSource);
    }}
    ondragend={handleDragEnd}
  >
    <td class="id-name">
      <span class="course-id">{c.id}</span>
      {#if !selectedCellId && c.cellId !== undefined}
        {@const cellId = c.cellId}
        <button class="goto-cell" onclick={() => focusCell(cellId)}
          >該当マスを表示</button
        >
      {/if}
      <br />
      <a
        href={getSyllabusUrl(c.id, c.syllabusYear)}
        target="_blank"
        draggable="false"
        >{c.name}{c.grade && gradeIsPass(c.grade) ? ` (${c.takenYear})` : ""}</a
      >
      {#if c.grade}<br /><span>{gradeDisplay(c.grade)}</span>{/if}
      {#if c.availability !== "available"}<br /><span>（非開講）</span>{/if}
      {#if dragSource === "wont-take"}
        <div class="course-plan-actions">
          <button type="button" onclick={() => moveCourse(c.id, "might-take")}
            >{timetableYear}年度の予定に追加</button
          >
        </div>
      {:else if dragSource === "might-take"}
        <div class="course-plan-actions">
          <label>
            予定年度
            <select
              aria-label={`${c.name}の予定年度`}
              value={plannedYearFor(c.id)}
              onchange={(event) =>
                updatePlannedYear(c.id, Number(event.currentTarget.value))}
            >
              {#each planYearOptions as year (year)}
                <option value={year}>{year}年度</option>
              {/each}
            </select>
          </label>
          <button type="button" onclick={() => moveCourse(c.id, "wont-take")}
            >予定から外す</button
          >
        </div>
      {/if}
    </td>
    <td class="credit">{c.credit ?? "-"}</td>
    <td class="slots">{c.slots ?? "-"}</td>
    <td class="expects">{c.expects ?? "-"}</td>
  </tr>
  {#if showCourseRemark}
    <tr class="course-remark">
      {#if c.remark}
        <td {colspan}>{c.remark}</td>
      {:else}
        <td {colspan} class="no-remark">（備考なし）</td>
      {/if}
    </tr>
  {/if}
{/snippet}

{#snippet courseTable(
  courses: UiCourse[],
  state: "no-courses" | "contains-courses",
  showSlots: boolean,
  showExpects: boolean,
  dragSource: "wont-take" | "might-take" | undefined,
)}
  {#if state === "no-courses"}
    <p>該当する授業がありません</p>
  {:else}
    {@const colspan = 2 + +showSlots + +showExpects}
    <table class:show-slots={showSlots} class:show-expects={showExpects}>
      <thead>
        <tr class="course">
          <th class="id-name">科目</th>
          <th class="credit">単位</th>
          <th class="slots">時限</th>
          <th class="expects">標準<br />履修<br />年次</th>
        </tr>
      </thead>
      <tbody>
        {#each courses as c (c.id)}
          {@render courseRow(c, dragSource, colspan)}
        {/each}
      </tbody>
    </table>
  {/if}
{/snippet}

{#snippet fakeCourseTable(courses: FakeCourse[])}
  <table>
    <thead>
      <tr class="course">
        <th class="id-name">科目</th>
        <th class="credit">単位</th>
      </tr>
    </thead>
    <tbody>
      {#each courses as c (c.id)}
        <tr class="course">
          <td class="id-name">{c.name} ({c.takenYear})</td>
          <td class="credit">{c.credit ?? "-"}</td>
        </tr>
      {/each}
    </tbody>
  </table>
{/snippet}

{#if !dataReady}
  <section class="server-loading" aria-live="polite">
    <h1>履修データの読み込み</h1>
    <p>学生ID：{studentSession.studentId}</p>
    <p>{storageMessage}</p>
    {#if !dataLoading}<button class="button" onclick={loadStudentData}
        >再試行</button
      >{/if}
  </section>
{/if}
<div class="save-status" role="status" aria-live="polite">
  {#if dataReady}
    {studentSession.studentId}：{saveStatus === "saving"
      ? "サーバーに保存中…"
      : saveStatus === "error"
        ? "未保存：接続を確認してください。自動で再試行します。"
        : "サーバーと同期済み"}
  {/if}
</div>
{#if dataReady}
  <main class:bars-hidden={!barsVisible}>
    <div id="view-switcher" role="group" aria-label="表示する画面">
      <button
        type="button"
        class:active={!barsVisible}
        aria-pressed={!barsVisible}
        onclick={() => (barsVisible = false)}>卒業要件表</button
      >
      <button
        type="button"
        class:active={barsVisible}
        aria-pressed={barsVisible}
        onclick={() => (barsVisible = true)}>授業計画</button
      >
    </div>
    {#if !compactLayout || !barsVisible}
      <div id="table-view">
        <div
          id="requirements"
          bind:this={requirementsEl}
          onscroll={(e) => (scrollX = -e.currentTarget.scrollLeft)}
          onclick={() => {
            selectedCellId = undefined;
          }}
        >
          <img
            src={asset(`/tables/${config.tableYear}/${config.major}.svg`)}
            alt="Table"
            width={tableScale * zoomLevel * config.tableViewBox.width}
            height={tableScale * zoomLevel * config.tableViewBox.height}
            draggable="false"
          />
          <div id="title">
            <a href={resolve("/")} class="akiko"
              ><img src={asset("/images/akiko.png")} alt="あきこ" /></a
            >
            <span
              >このページは <strong>{config.tableYear}</strong>
              年度入学の
              <strong>{MAJOR_TO_JA[config.major]}</strong> の学生向けですよ〜</span
            >
            <nav>
              <a href="{resolve('/')}#app-page-links">学類一覧に戻る</a>
              <a href={resolve("/docs")}>あきこの使い方</a>
              <a
                href="https://docs.google.com/forms/d/e/1FAIpQLSfUbueFsF6fbyJxCohNTqh5S8bYdxNgqx_HQ76RCR5TJQkpyQ/viewform?usp=dialog"
                target="_blank"
                rel="noreferrer">ご意見はこちらから</a
              >
            </nav>
          </div>
          {#each cellRects as r (r.id)}
            {@const cellStats = creditStats.cells.get(r.id)}
            {#if cellStats}
              {@const [green, yellow] = getPercentage(
                cellStats.effectiveTaken,
                cellStats.effectiveMightTake,
                cellStats.min,
              )}
              <div
                class="cell"
                class:selected={selectedCellId === r.id}
                style="left:{r.x}px; top:{r.y}px; width:{r.width}px; height:{r.height}px; --green-percentage:{green}%; --yellow-percentage:{yellow}%"
                onclick={(e) => {
                  e.stopPropagation();
                  selectedCellId = r.id;
                  barsVisible = true;
                  activeTab = "courses";
                }}
              ></div>
            {/if}
          {/each}
        </div>
        <div id="credit-sums-container">
          <div id="zoom-control">
            <img src={asset("/icons/zoom-in.svg")} width="15" alt="zoom" />
            <input
              type="range"
              min="0"
              max={ZOOM_SLIDER_MAX}
              step="0.01"
              bind:value={sliderZoomLevel}
            />
          </div>
          <div id="column-credit-sums" style="--x: {scrollX}px">
            {#each uiColumnCredits as { colId, rect, display, green, yellow } (colId)}
              <div
                style="left:{rect.x}px; width:{rect.width}px; --green-percentage:{green}%; --yellow-percentage:{yellow}%"
                data-message-on-click={display.warning}
                onclick={() => display.warning && alert(display.warning)}
              >
                <img
                  src={asset("/icons/warning.svg")}
                  width="20"
                  alt="warning"
                />
                <span bind:this={columnSpanEls[colId]}>{display.brief}</span>
              </div>
            {/each}
          </div>
          {#if creditStats.elective}
            {@const s = creditStats.elective}
            {@const display = electiveCreditStatsDisplay(s)}
            {@const [green, yellow] = getPercentage(
              s.effectiveTaken,
              s.effectiveMightTake,
              s.min,
            )}
            <div
              id="overall-credit-sum"
              style="--green-percentage:{green}%; --yellow-percentage:{yellow}%"
              data-message-on-click={display.warning}
              onclick={() => display.warning && alert(display.warning)}
            >
              <img src={asset("/icons/warning.svg")} width="20" alt="warning" />
              <span bind:this={overallSpanEl}>{display.brief}</span>
            </div>
          {/if}
        </div>
      </div>
    {/if}

    <div id="sidebar">
      <div id="tab-header">
        <button
          class:active={activeTab === "import"}
          onclick={() => (activeTab = "import")}
          ><span class="step-number" aria-hidden="true">1</span><span
            class="icon"
            style="--src: url({asset('/icons/math.svg')})"
          ></span>単位チェック</button
        >
        <span class="workflow-arrow" aria-hidden="true">
          <ChevronRight size={15} />
        </span>
        <button
          class:active={activeTab === "courses"}
          onclick={() => (activeTab = "courses")}
          ><span class="step-number" aria-hidden="true">2</span><span
            class="icon"
            style="--src: url({asset('/icons/book.svg')})"
          ></span>履修を組む</button
        >
        <span class="workflow-arrow" aria-hidden="true">
          <ChevronRight size={15} />
        </span>
        <button
          class:active={activeTab === "export"}
          onclick={() => (activeTab = "export")}
          ><span class="step-number" aria-hidden="true">3</span><span
            class="icon"
            style="--src: url({asset('/icons/itf.svg')})"
          ></span>TWINSに出力</button
        >
        <button
          class="settings"
          class:active={activeTab === "settings"}
          onclick={() => (activeTab = "settings")}
          ><span class="icon" style="--src: url({asset('/icons/cog.svg')})"
          ></span>設定</button
        >
      </div>

      {#if activeTab === "import"}
        <div id="import-tab" class:active={activeTab === "import"}>
          <div id="control">
            <label id="import-grades-button" class="button">
              <img src={asset("/icons/import.svg")} width="15px" alt="import" />
              <span>TWINSの成績データをインポート</span>
              <input
                type="file"
                id="csv"
                accept=".csv"
                onchange={handleCsvUpload}
              />
            </label>
            <div id="student-type-container" style="margin-bottom: 50px;">
              <label
                ><input
                  type="radio"
                  name="student-type"
                  bind:group={isNative}
                  value={true}
                /> <span>1年生からこの学類に所属している</span></label
              ><br />
              <label
                ><input
                  type="radio"
                  name="student-type"
                  bind:group={isNative}
                  value={false}
                /> <span>総合学域群からこの学類に移行した</span></label
              >
            </div>
            {#if unclassifiedCourses.real.length + unclassifiedCourses.fake.length > 0}
              <h2>卒業単位に含まれない授業</h2>
              <table class="show-term">
                <thead>
                  <tr class="course">
                    <th class="id-name">科目</th>
                    <th class="credit">単位</th>
                    <th class="term">評価</th>
                  </tr>
                </thead>
                <tbody>
                  {#each unclassifiedCourses.real as c (c.id)}
                    <tr class="course">
                      <td class="id-name">
                        <span>{c.id}</span><br />
                        <a
                          href={getSyllabusUrl(c.id, c.takenYear)}
                          target="_blank">{c.name}</a
                        >
                      </td>
                      <td class="credit">{c.credit ?? "-"}</td>
                      <td class="term">{gradeDisplay(c.grade)}</td>
                    </tr>
                  {/each}
                  {#each unclassifiedCourses.fake as c (c.id)}
                    <tr class="course">
                      <td class="id-name">
                        <span>（科目番号不明）</span><br />
                        <span>{c.name}</span>
                      </td>
                      <td class="credit">{c.credit ?? "-"}</td>
                      <td class="term">-</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            {/if}
            <Callout kind="info">
              取り込んだ成績データは、この学生IDの履修データとしてサーバーに自動保存されます。
            </Callout>
            <Callout kind="warning">
              成績データのファイルは、あきこにインポートする前にExcelやNumbersなどのアプリケーションで開いたり保存しないでください。
              データの形式が壊れ、あきこに正しくインポートできなくなる場合があります。
            </Callout>
          </div>
          <HowToImportFromTwins />
        </div>
      {/if}

      {#if activeTab === "export"}
        <div id="export-tab" class:active={activeTab === "export"}>
          <div id="control">
            <label class="export-year">
              出力する年度
              <select bind:value={timetableYear}>
                {#each planYearOptions as year (year)}
                  <option value={year}>{year}年度</option>
                {/each}
              </select>
            </label>
            {#if timetableYear !== config.knownCourseYear}
              <Callout kind="warning">
                授業情報は{config.knownCourseYear}年度版です。{timetableYear}年度の開講状況はTWINSで確認してください。
              </Callout>
            {/if}
            <button
              class="button"
              onclick={exportMightTake}
              disabled={exportForTwinsResult.kind !== "ok" ||
                exportForTwinsResult.toExport.length === 0}
              style="margin-bottom: 20px"
            >
              <img src={asset("/icons/export.svg")} width="15px" alt="export" />
              <span>取る授業一覧を出力</span>
            </button>
            {#if exportForTwinsResult.kind === "ok" && exportForTwinsResult.toExport.length === 0}
              <p>{timetableYear}年度に出力する授業はありません。</p>
            {/if}
            {#if uiJizentouroku.length > 0}
              <Callout kind="warning">
                「取る授業」に事前登録対象の授業が存在します。
                事前登録対象の授業はTWINSへのアップロードではなく、別途事前登録が必要です。
              </Callout>
              <h2 style="margin-top: 10px; margin-bottom: 0">
                事前登録対象の授業
              </h2>
              <table>
                <thead>
                  <tr class="course">
                    <th class="id-name">科目</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {#each uiJizentouroku as course (course.id)}
                    <tr class="course">
                      <td class="id-name">
                        <span>{course.id}</span><br />
                        <a
                          href={getSyllabusUrl(
                            course.id,
                            config.knownCourseYear,
                          )}
                          target="_blank">{course.name}</a
                        >
                      </td>
                      <td>
                        {#if course.cellId !== undefined}
                          {@const cellId = course.cellId}
                          <button
                            onclick={() => {
                              activeTimetableTerm = course.term;
                              focusCell(cellId);
                            }}>表示</button
                          >
                        {/if}
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            {/if}
            {#if uiOverlaps.length > 0}
              <Callout kind="warning">
                「取る授業」に時間が被っている授業が存在します。
                時間が被っている授業をTWINSに登録するすることはできないため、取る授業一覧をTWINSにアップロードするとエラーになります。
              </Callout>
              <h2 style="margin-top: 10px; margin-bottom: 0">
                時間が被っている授業
              </h2>
              <table class="show-term">
                <thead>
                  <tr class="course">
                    <th class="term">時限</th>
                    <th class="id-name">科目</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {#each uiOverlaps as group (group.slot)}
                    {#each group.courses as course, i (course.id)}
                      <tr class="course">
                        {#if i === 0}
                          <td
                            class="term"
                            rowspan={group.courses.length}
                            style="white-space: nowrap">{group.slot}</td
                          >
                        {/if}
                        <td class="id-name">
                          <span>{course.id}</span><br />
                          <a
                            href={getSyllabusUrl(
                              course.id,
                              config.knownCourseYear,
                            )}
                            target="_blank">{course.name}</a
                          >
                        </td>
                        <td>
                          {#if course.cellId !== undefined}
                            {@const cellId = course.cellId}
                            <button
                              onclick={() => {
                                activeTimetableTerm = group.term;
                                focusCell(cellId);
                              }}>表示</button
                            >
                          {/if}
                        </td>
                      </tr>
                    {/each}
                  {/each}
                </tbody>
              </table>
            {/if}
          </div>
          <HowToExportForTwins />
        </div>
      {/if}

      {#if activeTab === "settings"}
        <div id="settings-tab" class:active={activeTab === "settings"}>
          <h2>データの保存</h2>
          <p>学生ID：{studentSession.studentId}</p>
          <p>変更はサーバーに自動保存されます。</p>
          <div class="backup-actions">
            <button type="button" onclick={downloadData}
              >バックアップを保存</button
            >
            <label class="backup-restore">
              バックアップから復元
              <input
                type="file"
                accept=".json,application/json"
                onchange={importData}
              />
            </label>
          </div>
          <p class="backup-hint">
            復元するJSONファイルを選ぶと、現在のデータを置き換えるか確認します。
          </p>
          <p role="status">{storageMessage}</p>
          <label class="settings-row">
            <input type="checkbox" bind:checked={showNonAvailable} />
            <span>今年度開講しない授業を表示する</span>
          </label>
          <label class="settings-row">
            <input type="checkbox" bind:checked={timetableShowTaken} />
            <span>時間割に単位取得済みの授業を表示する</span>
          </label>
          <label class="settings-row">
            <span>表示・出力する年度</span>
            <select bind:value={timetableYear}>
              {#each planYearOptions as year (year)}
                <option value={year}>{year}年度</option>
              {/each}
            </select>
          </label>
          <div id="control">
            <button id="reset" class="button" onclick={() => reset()}>
              <img src={asset("/icons/trash.svg")} width="15px" alt="reset" />
              <span>リセット</span>
            </button>
          </div>
        </div>
      {/if}

      {#if activeTab === "courses"}
        <div id="courses-tab" class:active={activeTab === "courses"}>
          <div id="plan-year-toolbar">
            <label>
              計画する年度
              <select bind:value={timetableYear}>
                {#each planYearOptions as year (year)}
                  <option value={year}>{year}年度</option>
                {/each}
              </select>
            </label>
            <span>授業を選ぶ → 年度別に予定を立てる → TWINSへ出力</span>
            {#if timetableYear !== config.knownCourseYear}
              <span class="plan-year-note"
                >授業・時限は{config.knownCourseYear}年度版を参考表示</span
              >
            {/if}
          </div>
          <div
            bind:this={leftBarEl}
            id="left-bar"
            ondragover={(e) => {
              e.preventDefault();
              if (e.dataTransfer !== null) e.dataTransfer.dropEffect = "move";
            }}
            ondrop={(e) => handleDrop(e, "wont-take")}
          >
            <div id="filter-bar">
              <div id="filter-bar-row">
                <search>
                  <input
                    type="text"
                    placeholder="科目番号・科目名・対象者（備考）"
                    bind:value={wontTakeFilters.courseIdOrName}
                  />
                </search>
                <select
                  value={wontTakeFilters.credit ?? ""}
                  class:placeholder={wontTakeFilters.credit === undefined}
                  onchange={(e) => {
                    const v = e.currentTarget.value;
                    wontTakeFilters.credit = v === "" ? undefined : Number(v);
                  }}
                >
                  <option value="">全単位</option>
                  {#each availableCredits as v (v)}
                    <option value={v}>{v}単位</option>
                  {/each}
                </select>
                <select
                  value={wontTakeFilters.expects ?? ""}
                  class:placeholder={wontTakeFilters.expects === undefined}
                  onchange={(e) => {
                    const v = e.currentTarget.value;
                    wontTakeFilters.expects = v === "" ? undefined : Number(v);
                  }}
                >
                  <option value="">全年次</option>
                  {#each availableExpects as v (v)}
                    <option value={v}>{v}年次</option>
                  {/each}
                </select>
              </div>
              <div id="filter-bar-slot-row">
                <select
                  value={wontTakeFilters.term ?? ""}
                  class:placeholder={wontTakeFilters.term === undefined}
                  onchange={(e) => {
                    const v = e.currentTarget.value;
                    wontTakeFilters.term = v === "" ? undefined : (v as Term);
                  }}
                >
                  <option value="">全学期</option>
                  {#each availableTermGroups as group (group.label)}
                    <optgroup label={group.label}>
                      {#each group.terms as t (t)}
                        <option value={t}>{termToString(t)}</option>
                      {/each}
                    </optgroup>
                  {/each}
                </select>
                <div id="dow-chips" role="group" aria-label="曜日で絞り込む">
                  {#each DOWS as d (d)}
                    {@const active = wontTakeFilters.dows.includes(d)}
                    <button
                      type="button"
                      class="dow-chip"
                      class:active
                      aria-pressed={active}
                      disabled={!availableDows.includes(d)}
                      onclick={() => {
                        wontTakeFilters.dows = active
                          ? wontTakeFilters.dows.filter((x) => x !== d)
                          : [...wontTakeFilters.dows, d];
                      }}>{dowToString(d)}</button
                    >
                  {/each}
                </div>
              </div>
              <div id="filter-bar-checkboxes">
                <label class="filter-checkbox">
                  <input
                    type="checkbox"
                    bind:checked={wontTakeFilters.onlyMatchingTarget}
                  />
                  学類・入学年度に合う授業のみ
                </label>
                <label class="filter-checkbox">
                  <input
                    type="checkbox"
                    bind:checked={wontTakeFilters.onlyUnoccupied}
                  />
                  空きコマのみ表示
                </label>
                <label class="filter-checkbox">
                  <input type="checkbox" bind:checked={showCourseRemark} />
                  備考を表示
                </label>
              </div>
            </div>
            <div id="left-bar-scroll" bind:this={leftBarScrollEl}>
              <div class="section">
                <h2>
                  {selectedCellId ? "当てはまる授業" : "全ての授業"}
                  ({filteredCourseLists.wontTake.length}/{courseLists.wontTake
                    .length})
                </h2>
                {@render courseTable(
                  wontTakeSliced,
                  courseLists.wontTake.length === 0
                    ? "no-courses"
                    : "contains-courses",
                  true,
                  true,
                  "wont-take",
                )}
                <div bind:this={wontTakeSentinelEl}></div>
              </div>
            </div>
            {#if selectedCellRemark}
              <div id="cell-remark">
                <h2>備考</h2>
                <p style="white-space: pre-line">{selectedCellRemark}</p>
              </div>
            {/if}
          </div>

          <div
            bind:this={rightBarEl}
            id="right-bar"
            ondragover={(e) => {
              e.preventDefault();
              if (e.dataTransfer !== null) e.dataTransfer.dropEffect = "move";
            }}
            ondrop={(e) => handleDrop(e, "might-take")}
          >
            <Timetable
              year={timetableYear}
              bind:activeTerm={activeTimetableTerm}
              mightTakeCourseIds={plannedForTimetable}
              {takenCourseIds}
              fakeCourses={classifiedFakeCourses}
              showTaken={timetableShowTaken}
              {knownCoursesMap}
              {realCoursesMap}
              onBarClick={(courseId: CourseId) => {
                const cellId = svelteAkiko.getCellId(courseId);
                if (cellId !== undefined) {
                  focusCell(cellId);
                }
              }}
              onBarDragStart={(e: DragEvent, courseId: CourseId) =>
                handleDragStart(e, courseId, "might-take")}
              onBarDragEnd={handleDragEnd}
            />
            <div id="right-bar-scroll">
              <div id="credit-overview" class="section">
                <h2>卒業単位の合計</h2>
                <div class="credit-overview-grid">
                  <p>
                    <span>必修</span>
                    <strong
                      >{creditStats.compulsory.effectiveTaken +
                        creditStats.compulsory.effectiveMightTake}</strong
                    >
                    / {creditStats.compulsory.min}単位
                  </p>
                  <p>
                    <span>選択</span>
                    <strong
                      >{creditStats.elective.effectiveTaken +
                        creditStats.elective.effectiveMightTake}</strong
                    >
                    / {creditStats.elective.min}単位
                  </p>
                </div>
                <p class="credit-overview-total">
                  必修＋選択：<strong
                    >{creditStats.compulsory.effectiveTotal +
                      creditStats.elective.effectiveTotal}</strong
                  >
                  / {creditStats.compulsory.min + creditStats.elective.min}単位
                </p>
                <small
                  >取得済みと全年度の予定を合算（卒業要件に算入できる単位）</small
                >
              </div>
              {#if selectedCellStats}
                {@const display = cellCreditStatsDisplay(selectedCellStats)}
                <div class="section">
                  <h2>単位数</h2>
                  <p>
                    選択されたマスの単位：{display.brief}
                    {#if display.warning}<br />⚠️ {display.warning}{/if}
                  </p>
                </div>
              {/if}
              <div class="section">
                <div class="list-heading">
                  <h2>取る授業（年度別）</h2>
                  <span class="credit-total">
                    {timetableYear}年度：{plannedYearCredits}単位
                  </span>
                </div>
                {@render courseTable(
                  filteredCourseLists.mightTake,
                  filteredCourseLists.mightTake.length === 0
                    ? "no-courses"
                    : "contains-courses",
                  true,
                  false,
                  "might-take",
                )}
              </div>
              <div class="section">
                <div class="list-heading">
                  <h2>単位取得済みの授業</h2>
                  {#if selectedCellStats}
                    <span class="credit-total">
                      {selectedCellStats.rawTaken}単位
                    </span>
                  {/if}
                </div>
                {@render courseTable(
                  filteredCourseLists.taken,
                  filteredCourseLists.taken.length === 0
                    ? "no-courses"
                    : "contains-courses",
                  false,
                  false,
                  undefined,
                )}
              </div>
              {#if filteredCourseLists.fake.length > 0}
                <div class="section">
                  <div class="list-heading">
                    <h2>認可された授業</h2>
                    <span class="credit-total">{fakeCreditTotal}単位</span>
                  </div>
                  {@render fakeCourseTable(filteredCourseLists.fake)}
                </div>
              {/if}
            </div>
          </div>
        </div>
      {/if}
    </div>
  </main>

  {#if dropGuide}
    <div
      id="drop-guide"
      style="left:{dropGuide.left}px; top:{dropGuide.top}px; width:{dropGuide.width}px; height:{dropGuide.height}px"
    >
      ここに授業をドロップ
    </div>
  {/if}

  <button
    id="bars-toggle"
    style="left: {barsVisible
      ? 'calc(100vw - var(--sidebar-width) - var(--toggle-width))'
      : 'calc(100vw - var(--toggle-width))'}"
    onclick={() => (barsVisible = !barsVisible)}
  >
    {barsVisible ? "⏵" : "⏴"}
  </button>

  {#if barsVisible}
    <div
      id="sidebar-resize-handle"
      onpointerdown={onSidebarResizePointerDown}
      onpointermove={onSidebarResizePointerMove}
      onpointerup={onSidebarResizePointerUp}
    ></div>
    <div
      id="timetable-resize-handle"
      onpointerdown={onTimetableResizePointerDown}
      onpointermove={onTimetableResizePointerMove}
      onpointerup={onTimetableResizePointerUp}
    ></div>
  {/if}
{/if}

<style lang="scss">
  .server-loading {
    padding: 24px;
  }
  .save-status {
    position: fixed;
    bottom: 12px;
    left: 12px;
    z-index: 1000;
    padding: 8px 12px;
    background: white;
    border: 1px solid #ccc;
    border-radius: 6px;
    font-size: 0.85rem;
  }

  #view-switcher {
    display: none;
  }

  $color-progress-taken: rgb(51, 204, 51);
  $color-progress-might-take: rgb(255, 204, 0);
  $color-hover-overlay: rgba(0, 0, 0, 0.25);

  :global(:root) {
    --sidebar-width: 740px;
    --toggle-width: 30px;
    --timetable-height: 400px;
    --right-bar-top: 0px;
  }

  main {
    position: fixed;
    inset: 0;
    font-size: 14px;
    --fs-xs: 0.75em;
    --fs-sm: 0.9em;
    --fs-lg: 1.4em;

    display: grid;
    grid-template-columns: auto var(--sidebar-width);
    grid-template-rows: 100vh;

    &.bars-hidden {
      grid-template-columns: auto 0;

      & > #sidebar {
        display: none;
      }
    }
  }

  #table-view {
    grid-column: 1/2;
    display: grid;
    grid-template-rows: 1fr 85px;
    min-width: 0;
    min-height: 0;
  }

  #requirements {
    grid-row: 1/2;
    position: relative;
    overflow: scroll;
  }

  #title {
    position: absolute;
    left: 0;
    top: 0;
    box-sizing: border-box;
    width: 100%;
    display: grid;
    grid-template-columns: 80px minmax(0, 1fr);
    grid-template-rows: auto auto;
    align-items: center;
    background-color: oklch(98% 4% 350);
    border-right: 1px solid;
    border-bottom: 1px solid;
    border-color: oklch(92% 10% 350);
    border-bottom-right-radius: 10px;
    padding: 10px 20px;

    & > span {
      min-width: 0;
      overflow-wrap: anywhere;
    }

    & > .akiko {
      grid-column: 1/2;
      grid-row: 1/3;
      width: 60px;
      height: 60px;
      margin-right: 20px;
      background-color: hsl(0, 0%, 98%);
      border: 1px solid oklch(92% 10% 350);
      border-radius: 50%;
      overflow: hidden;

      & > img {
        width: 100%;
        height: 100%;
        object-fit: contain;
      }
    }

    & > nav {
      width: 100%;
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      gap: 20px;
      flex-wrap: wrap;
    }

    & > span > strong {
      font-size: 1.2em;
    }
  }

  #sidebar {
    grid-column: 2/3;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    border-left: 1px solid black;
    overflow: hidden;
    min-width: 0;

    & h2 {
      margin-top: 0;
      &:not(:first-of-type) {
        margin-top: 50px;
      }
    }
  }

  #tab-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px;
    border-bottom: 1px solid black;

    & > button > .step-number {
      display: grid;
      place-items: center;
      width: 18px;
      height: 18px;
      flex: none;
      border-radius: 50%;
      background: #edf0ff;
      color: #3443a2;
      font-size: 0.8em;
      font-weight: bold;
    }

    & > button.active > .step-number {
      background: white;
      color: #3443a2;
    }

    & > .workflow-arrow {
      display: flex;
      margin: 0 -10px;
      color: #999;
    }

    & > button {
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 5px 10px;
      background-color: white;
      color: #444;
      border: 1px solid currentColor;
      border-radius: 10px;

      &.settings {
        margin-left: auto;
      }

      &:hover {
        background-color: oklch(95% 0 0);
      }

      &.active {
        $c: oklch(70% 50% 270);
        background-color: $c;
        border-color: $c;
        color: white;
      }

      & > .icon {
        width: 15px;
        height: 15px;
        background-color: currentColor;
        mask-image: var(--src);
        mask-size: contain;
        mask-repeat: no-repeat;
        mask-position: center;
      }
    }
  }

  #import-tab,
  #export-tab {
    display: none;
    grid-template-rows: 1fr;
    overflow-y: scroll;
    padding: 15px;
    padding-bottom: 50vh;

    &.active {
      display: grid;
    }
  }

  #settings-tab {
    display: none;
    overflow-y: scroll;
    padding: 15px;
    padding-bottom: 50vh;

    &.active {
      display: flex;
      flex-direction: column;
    }
  }

  .backup-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;

    & > button,
    & > label {
      position: relative;
      flex: 1;
      min-width: 170px;
      box-sizing: border-box;
      padding: 10px;
      font: inherit;
      text-align: center;
      color: #3443a2;
      background: #eef1ff;
      border: 1px solid #bbc4f5;
      border-radius: 8px;
      cursor: pointer;
    }

    & > label:focus-within {
      outline: 2px solid #3443a2;
      outline-offset: 2px;
    }

    & input {
      position: absolute;
      width: 1px;
      height: 1px;
      opacity: 0;
    }
  }

  .backup-hint {
    color: #555;
    font-size: 0.9em;
  }

  #courses-tab {
    display: none;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr);
    overflow: hidden;

    &.active {
      display: grid;
    }
  }

  #plan-year-toolbar {
    grid-column: 1/-1;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px 16px;
    padding: 8px 12px;
    background: #f7f8ff;
    border-bottom: 1px solid #d9def6;

    & > label {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: bold;
    }

    & > span {
      color: #555;
      font-size: 0.9em;
    }

    & > .plan-year-note {
      color: #885700;
    }
  }

  #plan-year-toolbar select,
  .export-year select,
  .settings-row select,
  .course-plan-actions select {
    font: inherit;
    padding: 4px 6px;
    background: white;
    border: 1px solid #aaa;
    border-radius: 6px;
  }

  .export-year {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  #left-bar {
    display: grid;
    grid-template-rows: auto 1fr auto;
    border-right: 1px dashed black;
    overflow: hidden;
    min-width: 0;
    min-height: 0;
  }

  #left-bar-scroll {
    overflow-y: scroll;
    padding: 0 15px;
    display: flex;
    flex-direction: column;
    gap: 30px;

    & h2 {
      position: sticky;
      top: 0;
      background-color: white;
      padding: 5px 0;
      margin: 0;
    }
  }

  #filter-bar {
    border-bottom: 1px dashed black;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 15px;
  }

  #filter-bar-row {
    display: flex;
    gap: 5px;

    & > search {
      flex: 1;
      min-width: 0;
    }
  }

  #filter-bar-slot-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
  }

  #filter-bar select {
    font-size: var(--fs-sm);
    border: 1px solid gray;
    border-radius: 10px;
    padding: 5px 0px 5px 5px;
    background-color: white;
    cursor: pointer;

    &.placeholder {
      color: oklch(0.6 0 0);
    }
  }

  #dow-chips {
    display: flex;
    gap: 5px;
  }

  .dow-chip {
    font-size: var(--fs-sm);
    min-width: 30px;
    padding: 5px 0;
    border: 1px solid gray;
    border-radius: 10px;
    background-color: white;
    cursor: pointer;

    &:hover:not(:disabled) {
      background-color: oklch(95% 0 0);
    }

    &.active {
      border-color: oklch(60% 15% 250);
      background-color: oklch(90% 8% 250);
    }

    &:disabled {
      color: oklch(0.6 0 0);
      border-color: oklch(0.8 0 0);
      cursor: default;
    }
  }

  #filter-bar-checkboxes {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 15px;
  }

  .filter-checkbox {
    font-size: var(--fs-sm);
    display: flex;
    align-items: center;
    cursor: pointer;
  }

  #right-bar {
    display: grid;
    grid-template-rows: var(--timetable-height) minmax(0, 1fr);
    overflow: hidden;
    min-width: 0;
    min-height: 0;
  }

  #credit-overview {
    padding: 12px;
    background: #f7f8ff;
    border: 1px solid #d9def6;
    border-radius: 10px;

    & > small {
      color: #555;
    }
  }

  .credit-overview-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
    margin: 8px 0;

    & > p {
      padding: 8px;
      background: white;
      border-radius: 8px;
    }

    & span {
      display: block;
    }

    & strong {
      font-size: 1.5em;
    }
  }

  .credit-overview-total {
    margin: 0 0 8px;
    font-weight: bold;
  }

  #right-bar-scroll {
    overflow-y: scroll;
    padding: 0 15px;
    border-top: 1px dashed black;
    display: flex;
    flex-direction: column;
    gap: 30px;

    & h2 {
      margin: 0;
    }

    & h2,
    & .list-heading {
      position: sticky;
      top: 0;
      background-color: white;
      padding: 5px 0;
    }

    & .list-heading h2 {
      position: static;
      padding: 0;
    }
  }

  #left-bar-scroll,
  #right-bar-scroll {
    & p {
      margin: 0;
      margin-top: 0;
    }

    & > .section:first-child {
      margin-top: 15px;
    }

    & > .section:last-child {
      margin-bottom: 15px;
    }
  }

  #cell-remark {
    border-top: 1px dashed black;
    padding: 15px;

    & > h2 {
      margin: 0;
    }

    & > p {
      margin: 0;
      margin-top: 10px;
    }
  }

  .list-heading {
    display: flex;
    align-items: center;
    gap: 20px;
  }

  .credit-total {
    font-size: 1em;
  }

  .cell {
    --border-width: 3px;
    --green-percentage: 0%;
    --yellow-percentage: 0%;
    position: absolute;
    box-sizing: border-box;
    border: var(--border-width) dashed rgba(0, 0, 0, 0.2);
    cursor: pointer;

    &::before {
      content: "";
      display: block;
      position: absolute;
      inset: calc(-1 * var(--border-width));
      background: linear-gradient(
        90deg,
        $color-progress-taken 0%,
        $color-progress-taken var(--green-percentage),
        $color-progress-might-take var(--green-percentage),
        $color-progress-might-take var(--yellow-percentage),
        transparent var(--yellow-percentage),
        transparent 100%
      );
      opacity: 0.4;
    }

    &:hover {
      background-color: $color-hover-overlay;
    }

    &.selected {
      outline: 6px solid #0066ff;
      outline-offset: 4px;
      z-index: 1;
    }
  }

  .goto-cell {
    all: unset;
    cursor: pointer;
    font-size: var(--fs-xs);
    color: oklch(0.4 0.15 250);
    text-decoration: underline;
  }

  .course-plan-actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 6px;

    & > label {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 4px;
      font-size: var(--fs-sm);
    }

    & > button {
      padding: 3px 6px;
      font: inherit;
      font-size: var(--fs-sm);
      color: #3443a2;
      background: #eef1ff;
      border: 1px solid #bbc4f5;
      border-radius: 5px;
      cursor: pointer;
    }
  }

  .course-remark td {
    font-size: 0.85em;
    padding: 3px 5px 8px;
    background-color: hsl(0, 0%, 96%);
    border-top: 1px solid #ccc;
    overflow-wrap: anywhere;

    &.no-remark {
      color: #aaa;
    }
  }

  table,
  th,
  td {
    border: 1px solid black;
    border-collapse: collapse;
  }

  table {
    width: 100%;

    .slots,
    .expects {
      display: none;
    }
    &.show-slots .slots,
    &.show-expects .expects {
      display: revert;
    }

    & .course-id {
      vertical-align: middle;
    }
  }

  th {
    white-space: nowrap;
  }

  tbody > tr {
    background-color: white;
  }

  tbody > tr[draggable="true"] {
    cursor: grab;
    &:active {
      cursor: grabbing;
    }
  }

  #bars-toggle {
    position: absolute;
    margin: 0;
    padding: 0;
    border-radius: 0 0 0 10px;
    width: var(--toggle-width);
    height: var(--toggle-width);
    font-size: var(--fs-lg);
    text-align: center;
    background-color: white;
    border: unset;
    border-left: 1px solid black;
    border-bottom: 1px solid black;

    &:hover {
      background-color: #ddd;
    }
  }

  #sidebar-resize-handle {
    position: fixed;
    top: var(--toggle-width);
    bottom: 0;
    left: calc(100vw - var(--sidebar-width));
    width: 10px;
    transform: translateX(-5px);
    cursor: col-resize;
    z-index: 100;
  }

  #timetable-resize-handle {
    position: fixed;
    top: calc(var(--right-bar-top) + var(--timetable-height));
    left: calc(100vw - var(--sidebar-width) / 2);
    right: 0;
    height: 10px;
    transform: translateY(-5px);
    cursor: row-resize;
    z-index: 100;
  }

  input[name="student-type"]:checked + span {
    font-weight: bold;
  }

  #control {
    margin-bottom: 50px;
    display: flex;
    flex-direction: column;
    gap: 10px;

    & .button {
      --bg-l: 0.92;
      --bg-c: 0.05;
      --border-l: 0.85;
      --border-c: 0.1;
      --h: 270;
      display: grid;
      place-content: center;
      place-items: center;
      gap: 10px;
      grid-template-columns: auto auto;
      width: 100%;
      height: 40px;
      background-color: oklch(var(--bg-l) var(--bg-c) var(--h));
      border: 1px solid oklch(var(--border-l) var(--border-c) var(--h));
      border-radius: 10px;

      &:hover {
        background-color: oklch(var(--border-l) var(--border-c) var(--h));
      }

      &:disabled {
        --bg-l: 0.92;
        --bg-c: 0;
        --border-l: 0.85;
        --border-c: 0;
        color: oklch(0.6 0 0);

        &:hover {
          background-color: oklch(var(--bg-l) var(--bg-c) var(--h));
        }
      }
    }

    & label.button {
      box-sizing: border-box;
    }

    & #reset {
      --h: 10;
    }
  }

  #csv {
    display: none;
  }

  #student-type-container {
    padding: 10px;
    background-color: hsl(0, 0%, 97%);
    border-radius: 10px;
  }

  #filter-bar-row > search > input {
    box-sizing: border-box;
    width: 100%;
    border: 1px solid gray;
    border-radius: 10px;
    padding: 5px 10px;
  }

  #credit-sums-container {
    grid-row: 2/3;
    overflow: hidden;
    position: relative;
  }

  #column-credit-sums {
    position: relative;
    transform: translateX(var(--x, 0));
  }

  #column-credit-sums > div,
  #overall-credit-sum {
    --green-percentage: 0%;
    --yellow-percentage: 0%;
    position: absolute;
    box-sizing: border-box;
    border: 1px solid black;
    padding: 5px;
    height: 35px;
    display: grid;
    user-select: none;
    -webkit-user-select: none;

    $alpha: 0.4;
    background: linear-gradient(
      90deg,
      rgba($color-progress-taken, $alpha) 0%,
      rgba($color-progress-taken, $alpha) var(--green-percentage),
      rgba($color-progress-might-take, $alpha) var(--green-percentage),
      rgba($color-progress-might-take, $alpha) var(--yellow-percentage),
      transparent var(--yellow-percentage),
      transparent 100%
    );

    &[data-message-on-click]:not([data-message-on-click=""]) {
      cursor: pointer;

      & > img {
        display: unset;
      }

      &:hover {
        background-color: $color-hover-overlay;
      }
    }

    & > img {
      display: none;
      position: absolute;
      left: 8px;
      top: 5.5px;
    }

    & > span {
      align-self: center;
      justify-self: right;
      transform-origin: top left;
      text-wrap: nowrap;
    }
  }

  #column-credit-sums > div {
    top: 5px;
  }

  #overall-credit-sum {
    right: 5px;
    bottom: 5px;
    width: 300px;
  }

  .settings-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px;
    background-color: hsl(0, 0%, 97%);
    border-radius: 10px;
    margin-bottom: 5px;
  }

  #drop-guide {
    display: grid;
    position: fixed;
    background-color: rgba(255, 255, 255, 0.9);
    outline: 8px dashed hsla(0, 0%, 70%, 0.8);
    outline-offset: -20px;
    place-items: center;
    pointer-events: none;
  }

  #zoom-control {
    position: absolute;
    bottom: 60px;
    left: 5px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 5px 15px;
    background-color: rgba(255, 255, 255, 0.9);
    border: 1px solid #ccc;
    border-radius: 10px;
    font-size: var(--fs-sm);

    & > input[type="range"] {
      width: 100px;
    }
  }

  @media (max-width: 1350px) {
    main,
    main.bars-hidden {
      box-sizing: border-box;
      padding-bottom: 48px;
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: auto minmax(0, 1fr);
    }

    .save-status {
      bottom: 0;
      left: 0;
      right: 0;
      padding: 5px 10px;
      text-align: center;
      border-radius: 0;
    }

    #view-switcher {
      grid-column: 1;
      grid-row: 1;
      display: flex;
      gap: 6px;
      padding: 6px;
      background: #f7f8ff;
      border-bottom: 1px solid #d9def6;

      & > button {
        flex: 1;
        padding: 6px;
        font: inherit;
        background: white;
        border: 1px solid #bbc4f5;
        border-radius: 6px;
        cursor: pointer;
      }

      & > button.active {
        color: white;
        background: #728cff;
      }
    }

    #table-view,
    #sidebar {
      grid-column: 1;
      grid-row: 2;
    }

    main:not(.bars-hidden) > #table-view {
      display: none;
    }

    main.bars-hidden > #table-view {
      display: grid;
    }

    #sidebar {
      border-left: 0;
    }

    #bars-toggle,
    #sidebar-resize-handle {
      display: none;
    }

    #timetable-resize-handle {
      left: 50%;
    }
  }

  @media (max-width: 700px) {
    #tab-header {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 4px;
      padding: 6px;

      & > .workflow-arrow {
        display: none;
      }

      & > button {
        min-width: 0;
        width: 100%;
        margin: 0;
        padding: 5px 2px;
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: 2px;
        font-size: 0.78em;
        line-height: 1.2;
        text-align: center;
      }
    }

    #courses-tab.active {
      display: block;
      overflow-y: auto;
      padding-bottom: 50px;
    }

    #plan-year-toolbar {
      position: sticky;
      top: 0;
      z-index: 10;
    }

    #left-bar,
    #right-bar {
      display: block;
      overflow: visible;
    }

    #left-bar {
      border-right: 0;
      border-bottom: 1px solid #ccc;
    }

    #left-bar-scroll {
      height: 45vh;
      overflow-y: auto;
    }

    #right-bar :global(.timetable) {
      height: 350px;
    }

    #right-bar-scroll {
      max-height: 55vh;
      overflow-y: auto;
    }

    #filter-bar-row {
      flex-wrap: wrap;

      & > search {
        flex-basis: 100%;
      }
    }

    #filter-bar-checkboxes {
      flex-direction: column;
    }

    #title {
      grid-template-columns: 52px minmax(0, 1fr);
      padding: 8px;

      & > .akiko {
        width: 42px;
        height: 42px;
        margin-right: 10px;
      }

      & > nav {
        gap: 4px 10px;
      }
    }

    #timetable-resize-handle {
      display: none;
    }
  }
</style>
