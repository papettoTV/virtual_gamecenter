import {
  createDefaultTerrain,
  editTerrainWall,
  nearestTerrainSide,
  loadTerrainCourse,
  saveTerrainCourse,
  sanitizeTerrainCourse,
  terrainWidthsAt,
  type TerrainCourse,
  type TerrainFeatureKind,
  type TerrainSide,
} from "./terrain";

type Tool = "wall" | TerrainFeatureKind | "erase";

export function initTerrainEditor() {
  const openButton = document.querySelector<HTMLButtonElement>("#open-terrain-editor");
  openButton?.addEventListener("click", () => {
    const url = new URL(window.location.href); url.searchParams.set("game", "deep-sea-salvage"); url.searchParams.set("terrainEditor", "1");
    window.location.assign(url);
  });
  if (new URLSearchParams(window.location.search).get("terrainEditor") !== "1") return;

  const section = document.querySelector<HTMLElement>("#salvage-terrain-editor");
  const canvas = document.querySelector<HTMLCanvasElement>("#terrain-editor-canvas")!;
  const textarea = document.querySelector<HTMLTextAreaElement>("#terrain-editor-json")!;
  const status = document.querySelector<HTMLElement>("#terrain-editor-status");
  if (!section || !canvas || !textarea) return;
  const ctx = canvas.getContext("2d")!; if (!ctx) return;
  section.hidden = false; document.body.classList.add("is-terrain-editor");

  let course = loadTerrainCourse(); let tool: Tool = "wall"; let dragging = false; let selectedFeatureId: string | null = null;
  let wallSide: TerrainSide | null = null;
  const overview = document.querySelector<HTMLInputElement>("#terrain-editor-overview")!;
  const previewDepth = document.querySelector<HTMLInputElement>("#terrain-editor-preview-depth")!;
  const scrollArea = document.querySelector<HTMLElement>(".terrain-editor-scroll")!;
  previewDepth.value = String(Math.max(0, Math.min(course.maxDepth, Number(new URLSearchParams(window.location.search).get("startDepth")) || 0)));
  const scrollToPreviewDepth = () => {
    if (!overview.checked) scrollArea.scrollTop = (Number(previewDepth.value) || 0) / course.maxDepth * canvas.getBoundingClientRect().height - scrollArea.clientHeight / 2;
  };
  previewDepth.addEventListener("change", scrollToPreviewDepth);
  document.querySelector("#terrain-editor-jump")?.addEventListener("click", scrollToPreviewDepth);
  overview.addEventListener("change", () => {
    const centerDepth = (scrollArea.scrollTop + scrollArea.clientHeight / 2) / canvas.getBoundingClientRect().height * course.maxDepth;
    canvas.height = overview.checked ? 760 : course.maxDepth;
    const scale = document.querySelector("#terrain-editor-scale");
    if (scale) scale.textContent = overview.checked ? "全体図は縦方向を圧縮しています。形状確認はチェックを外してください。" : "ゲームと同じ縦横比。スクロールして深い場所を編集できます。";
    draw();
    scrollArea.scrollTop = centerDepth / course.maxDepth * canvas.getBoundingClientRect().height - scrollArea.clientHeight / 2;
  });
  const history: TerrainCourse[] = [];
  const clone = (value: TerrainCourse) => structuredClone(value);
  const pushHistory = () => { history.push(clone(course)); if (history.length > 30) history.shift(); };
  const setStatus = (text: string) => { if (status) status.textContent = text; };

  const pointerPosition = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * canvas.width / rect.width, y: (event.clientY - rect.top) * canvas.height / rect.height };
  };
  const depthFromY = (y: number) => Math.max(0, Math.min(course.maxDepth, y / canvas.height * course.maxDepth));
  const yFromDepth = (depth: number) => depth / course.maxDepth * canvas.height;

  const findFeature = (x: number, y: number) => course.features.find((feature) => {
    const widths = terrainWidthsAt(course, feature.depth);
    const featureX = feature.side === "left" ? widths.left : canvas.width - widths.right;
    return Math.hypot(featureX - x, yFromDepth(feature.depth) - y) < 22;
  });

  const editAt = (x: number, y: number, start: boolean) => {
    const depth = depthFromY(y);
    if (tool === "wall") {
      const point = course.points.reduce((closest, candidate) => Math.abs(candidate.depth - depth) < Math.abs(closest.depth - depth) ? candidate : closest);
      if (point.depth === 0) return;
      if (start) wallSide = nearestTerrainSide(point, x);
      if (wallSide) editTerrainWall(point, wallSide, x);
    } else if (tool === "erase") {
      if (!start) return;
      const feature = findFeature(x, y); if (feature) course.features = course.features.filter((candidate) => candidate.id !== feature.id);
    } else {
      if (start) {
        const existing = findFeature(x, y);
        if (existing?.kind === tool) selectedFeatureId = existing.id;
        else {
          const feature = { id: `${tool}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, kind: tool, side: nearestTerrainSide(terrainWidthsAt(course, depth), x), depth };
          course.features.push(feature); selectedFeatureId = feature.id;
        }
      }
      const selected = course.features.find((feature) => feature.id === selectedFeatureId);
      if (selected) { selected.depth = depth; selected.side = nearestTerrainSide(terrainWidthsAt(course, depth), x); }
    }
    draw();
  };

  canvas.addEventListener("pointerdown", (event) => { pushHistory(); dragging = true; canvas.setPointerCapture(event.pointerId); const point = pointerPosition(event); editAt(point.x, point.y, true); });
  canvas.addEventListener("pointermove", (event) => { if (!dragging || tool === "erase") return; const point = pointerPosition(event); editAt(point.x, point.y, false); });
  canvas.addEventListener("pointerup", () => { dragging = false; selectedFeatureId = null; wallSide = null; });
  canvas.addEventListener("pointercancel", () => { dragging = false; selectedFeatureId = null; wallSide = null; });

  document.querySelectorAll<HTMLButtonElement>("[data-terrain-tool]").forEach((button) => button.addEventListener("click", () => {
    tool = button.dataset.terrainTool as Tool;
    document.querySelectorAll("[data-terrain-tool]").forEach((candidate) => candidate.classList.toggle("is-active", candidate === button));
    setStatus(`${button.textContent ?? "ツール"}を選択中`);
  }));
  document.querySelector("#terrain-editor-undo")?.addEventListener("click", () => { const previous = history.pop(); if (previous) { course = previous; draw(); setStatus("1つ前の状態へ戻しました"); } });
  document.querySelector("#terrain-editor-reset")?.addEventListener("click", () => { pushHistory(); course = createDefaultTerrain(); draw(); setStatus("初期地形へ戻しました（まだ保存されていません）"); });
  document.querySelector("#terrain-editor-export")?.addEventListener("click", () => { textarea.value = JSON.stringify(course, null, 2); setStatus("現在のコースJSONを表示しました"); });
  document.querySelector("#terrain-editor-import")?.addEventListener("click", () => {
    try { pushHistory(); course = sanitizeTerrainCourse(JSON.parse(textarea.value)); draw(); setStatus("JSONを読み込みました（まだ保存されていません）"); }
    catch { setStatus("JSONの形式を確認してください"); }
  });
  const saveAndPreview = (atDepth: boolean) => {
    try {
      saveTerrainCourse(course);
      const url = new URL(window.location.href);
      url.searchParams.delete("terrainEditor");
      url.searchParams.delete("startDepth");
      url.searchParams.delete("terrainPreview");
      if (atDepth) {
        url.searchParams.set("terrainPreview", "1");
        url.searchParams.set("startDepth", String(Math.max(0, Math.min(course.maxDepth, Number(previewDepth.value) || 0))));
      }
      url.searchParams.set("surfacePreview", "1");
      window.location.assign(url);
    } catch {
      setStatus("保存できませんでした。編集内容はこの画面に残っています。コースJSONを控え、ブラウザの保存設定を確認してください。");
    }
  };
  document.querySelector("#terrain-editor-play")?.addEventListener("click", () => saveAndPreview(false));
  document.querySelector("#terrain-editor-preview")?.addEventListener("click", () => saveAndPreview(true));

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const sea = ctx.createLinearGradient(0, 0, 0, canvas.height); sea.addColorStop(0, "#176a87"); sea.addColorStop(.45, "#082c48"); sea.addColorStop(1, "#010813");
    ctx.fillStyle = sea; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "rgba(158,240,244,.13)"; ctx.lineWidth = 1; ctx.font = "700 12px system-ui"; ctx.fillStyle = "#9ecbd0";
    for (let depth = 0; depth <= course.maxDepth; depth += 1_000) {
      const y = yFromDepth(depth); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke(); ctx.fillText(`${depth.toLocaleString()}m`, canvas.width / 2 + 8, y + 14);
    }

    const drawWall = (side: "left" | "right") => {
      ctx.beginPath(); ctx.moveTo(side === "left" ? 0 : canvas.width, 0);
      for (const point of course.points) ctx.lineTo(side === "left" ? point.left : canvas.width - point.right, yFromDepth(point.depth));
      ctx.lineTo(side === "left" ? 0 : canvas.width, canvas.height); ctx.closePath();
      const rock = ctx.createLinearGradient(side === "left" ? 0 : canvas.width, 0, side === "left" ? 300 : canvas.width - 300, 0);
      rock.addColorStop(0, "#101a23"); rock.addColorStop(1, "#3a5360"); ctx.fillStyle = rock; ctx.fill(); ctx.strokeStyle = "#7893a0"; ctx.lineWidth = 2; ctx.stroke();
    };
    drawWall("left"); drawWall("right");

    ctx.setLineDash([3, 4]); ctx.strokeStyle = "rgba(142,255,240,.28)";
    for (const point of course.points.slice(1)) {
      const y = yFromDepth(point.depth); ctx.beginPath(); ctx.moveTo(point.left - 7, y); ctx.lineTo(point.left + 7, y); ctx.moveTo(canvas.width - point.right - 7, y); ctx.lineTo(canvas.width - point.right + 7, y); ctx.stroke();
    }
    ctx.setLineDash([]);
    for (const feature of course.features) {
      const widths = terrainWidthsAt(course, feature.depth); const x = feature.side === "left" ? widths.left : canvas.width - widths.right; const y = yFromDepth(feature.depth);
      ctx.save(); ctx.translate(x, y); ctx.fillStyle = feature.kind === "kelp" ? "#63d892" : "#ff9362"; ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 10;
      if (feature.kind === "kelp") { ctx.fillRect(-3, -13, 6, 25); ctx.fillRect(feature.side === "left" ? 4 : -9, -9, 5, 19); }
      else { ctx.beginPath(); ctx.moveTo(-9, 8); ctx.lineTo(0, -10); ctx.lineTo(9, 8); ctx.closePath(); ctx.fill(); }
      ctx.restore();
    }
  }

  draw(); requestAnimationFrame(scrollToPreviewDepth); setStatus("地形はこのブラウザ・同じURLに保存されます。深度を入力して「この深度へ移動」で編集位置へ移動、「指定深度を確認」でその場所を明るく確認できます。");
}
