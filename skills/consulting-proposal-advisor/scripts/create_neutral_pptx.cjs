#!/usr/bin/env node
/**
 * Create a simple editable consulting-style PPTX from a JSON deck plan.
 *
 * Usage:
 *   node create_neutral_pptx.cjs deck-plan.json output.pptx
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const Module = require("module");

function loadPptxgen() {
  const searchPaths = [
    process.cwd(),
    __dirname,
    process.env.PPTXGENJS_PATH || "",
    path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules"),
    ...(process.env.NODE_PATH ? process.env.NODE_PATH.split(path.delimiter) : []),
  ].filter(Boolean);
  const requireFromHere = Module.createRequire(path.join(process.cwd(), "noop.js"));
  try {
    return requireFromHere("pptxgenjs");
  } catch (_) {}
  for (const base of searchPaths) {
    try {
      return require(require.resolve("pptxgenjs", { paths: [base] }));
    } catch (_) {}
  }
  throw new Error(
    "Cannot find pptxgenjs. Install it with `npm install pptxgenjs` or set NODE_PATH to a node_modules directory that contains pptxgenjs."
  );
}

function fail(message, err) {
  console.error(`[ERROR] ${message}`);
  if (err && err.message) console.error(err.message);
  process.exit(1);
}

const input = process.argv[2];
const output = process.argv[3];
if (!input || !output) {
  console.error("Usage: node create_neutral_pptx.cjs deck-plan.json output.pptx");
  process.exit(2);
}

let pptxgen;
let plan;
try {
  pptxgen = loadPptxgen();
} catch (err) {
  fail("PPTX dependency is unavailable.", err);
}
try {
  plan = JSON.parse(fs.readFileSync(input, "utf8"));
} catch (err) {
  fail(`Could not read or parse JSON deck plan: ${input}`, err);
}
if (!Array.isArray(plan.slides) || plan.slides.length === 0) {
  fail("Deck plan must include a non-empty `slides` array.");
}
fs.mkdirSync(path.dirname(output), { recursive: true });

const fontFace = plan.fontFace || ((plan.lang || "zh-CN").toLowerCase().startsWith("zh") ? "PingFang SC" : "Aptos");

const pptx = new pptxgen();
pptx.layout = "LAYOUT_WIDE";
pptx.author = plan.author || "Codex";
pptx.subject = plan.title || "Consulting proposal";
pptx.title = plan.title || "Consulting proposal";
pptx.company = plan.company || "Neutral Consulting Template";
pptx.lang = plan.lang || "zh-CN";
pptx.theme = {
  headFontFace: fontFace,
  bodyFontFace: fontFace,
  lang: plan.lang || "zh-CN",
};
pptx.defineLayout({ name: "LAYOUT_WIDE", width: 13.333, height: 7.5 });

const C = {
  bg: "FFFFFF",
  ink: "262626",
  muted: "666666",
  light: "F7F5F2",
  line: "D8D2CD",
  accent: plan.accent || "8A1538",
  gold: "C7A46A",
  soft: "F4E9ED",
  charcoal: "383231",
};

function addText(slide, value, x, y, w, h, o = {}) {
  slide.addText(String(value || ""), {
    x, y, w, h,
    fontFace,
    fontSize: o.size ?? 9,
    bold: o.bold ?? false,
    color: o.color ?? C.ink,
    align: o.align ?? "left",
    valign: o.valign ?? "top",
    fit: "shrink",
    margin: o.margin ?? 0.03,
    breakLine: false,
  });
}

function footer(slide, pageNo) {
  slide.addShape(pptx.ShapeType.line, { x: 0.55, y: 7.08, w: 12.25, h: 0, line: { color: C.line, width: 0.5 } });
  addText(slide, plan.footer || `${plan.title || "Proposal"} | Draft`, 0.55, 7.18, 5.8, 0.13, { size: 6.4, color: C.muted, margin: 0 });
  addText(slide, String(pageNo).padStart(2, "0"), 12.25, 7.15, 0.55, 0.14, { size: 7, color: C.muted, align: "right", margin: 0 });
}

function title(slide, headline, subtitle, pageNo) {
  slide.background = { color: C.bg };
  slide.addShape(pptx.ShapeType.rect, { x: 0.55, y: 0.36, w: 0.09, h: 0.56, fill: { color: C.accent }, line: { color: C.accent } });
  addText(slide, headline, 0.75, 0.32, 11.75, 0.52, { size: 19.5, bold: true, margin: 0 });
  if (subtitle) addText(slide, subtitle, 0.76, 0.91, 11.5, 0.25, { size: 8.5, color: C.muted, margin: 0 });
  footer(slide, pageNo);
}

function bullets(slide, items, x, y, w, h) {
  addText(slide, (items || []).map((v) => `• ${v}`).join("\n"), x, y, w, h, { size: 8.4, margin: 0.02 });
}

function card(slide, x, y, w, h, head, body) {
  slide.addShape(pptx.ShapeType.rect, { x, y, w, h, fill: { color: "FFFFFF" }, line: { color: C.line, width: 0.8 } });
  slide.addShape(pptx.ShapeType.rect, { x, y, w: 0.06, h, fill: { color: C.accent }, line: { color: C.accent } });
  addText(slide, head, x + 0.18, y + 0.15, w - 0.32, 0.25, { size: 9.2, bold: true });
  addText(slide, body, x + 0.18, y + 0.52, w - 0.34, h - 0.64, { size: 7.5, color: C.muted });
}

function addTable(slide, columns, rows) {
  const x = 0.75, y = 1.55, w = 11.8;
  const all = [columns || [], ...(rows || [])];
  const colCount = Math.max(1, all[0].length);
  const rowH = Math.min(0.58, 4.9 / Math.max(1, all.length));
  all.forEach((row, r) => {
    row.forEach((cell, c) => {
      const cw = w / colCount;
      slide.addShape(pptx.ShapeType.rect, {
        x: x + c * cw, y: y + r * rowH, w: cw, h: rowH,
        fill: { color: r === 0 ? C.charcoal : (r % 2 ? "FFFFFF" : C.light) },
        line: { color: C.line, width: 0.5 },
      });
      addText(slide, cell, x + c * cw + 0.06, y + r * rowH + 0.08, cw - 0.12, rowH - 0.12, {
        size: r === 0 ? 7.4 : 6.8,
        bold: r === 0,
        color: r === 0 ? "FFFFFF" : C.ink,
      });
    });
  });
}

function addChart(slide, sDef) {
  const chartTypeMap = {
    bar: pptx.ChartType.bar,
    col: pptx.ChartType.bar,
    column: pptx.ChartType.bar,
    line: pptx.ChartType.line,
    pie: pptx.ChartType.pie,
    doughnut: pptx.ChartType.doughnut,
  };
  const chartType = chartTypeMap[sDef.chartType || "bar"] || pptx.ChartType.bar;
  const data = Array.isArray(sDef.series) && sDef.series.length
    ? sDef.series.map((series, idx) => ({
        name: series.name || `Series ${idx + 1}`,
        labels: Array.isArray(series.labels) ? series.labels : (sDef.labels || []),
        values: Array.isArray(series.values) ? series.values : [],
      }))
    : [
        {
          name: sDef.seriesName || "Value",
          labels: sDef.labels || [],
          values: sDef.values || [],
        },
      ];
  slide.addChart(chartType, data, {
    x: 0.95,
    y: 1.55,
    w: 7.1,
    h: 4.3,
    showLegend: chartType !== pptx.ChartType.pie,
    showValue: true,
    showCategoryName: false,
    valAxisLabelFontFace: fontFace,
    catAxisLabelFontFace: fontFace,
    valAxisLabelFontSize: 8,
    catAxisLabelFontSize: 8,
    dataLabelFontFace: fontFace,
    dataLabelFontSize: 8,
    chartColors: [C.accent, C.gold, C.charcoal, C.muted],
  });
  if (sDef.takeaway) {
    card(slide, 8.45, 1.65, 3.55, 2.2, sDef.takeawayTitle || "Implication", sDef.takeaway);
  }
}

function addMatrix(slide, sDef) {
  const x0 = 1.35, y0 = 1.55, w = 6.8, h = 4.55;
  slide.addShape(pptx.ShapeType.line, { x: x0, y: y0 + h, w, h: 0, line: { color: C.ink, width: 1 } });
  slide.addShape(pptx.ShapeType.line, { x: x0, y: y0, w: 0, h, line: { color: C.ink, width: 1 } });
  addText(slide, sDef.yHigh || "High", x0 - 0.72, y0 - 0.04, 0.6, 0.2, { size: 7, color: C.muted, align: "right" });
  addText(slide, sDef.xHigh || "High", x0 + w - 0.15, y0 + h + 0.12, 0.8, 0.2, { size: 7, color: C.muted });
  addText(slide, sDef.yAxis || "Impact", x0 - 0.85, y0 + 2.0, 0.7, 0.24, { size: 7, color: C.muted, align: "right" });
  addText(slide, sDef.xAxis || "Feasibility", x0 + 2.7, y0 + h + 0.38, 1.5, 0.24, { size: 7, color: C.muted, align: "center" });
  slide.addShape(pptx.ShapeType.rect, { x: x0 + w * 0.52, y: y0 + 0.15, w: w * 0.38, h: h * 0.36, fill: { color: C.soft, transparency: 10 }, line: { color: C.accent, dash: "dash" } });
  (sDef.points || []).forEach((p) => {
    const px = x0 + Math.max(0.02, Math.min(0.98, p.x ?? 0.5)) * w;
    const py = y0 + (1 - Math.max(0.02, Math.min(0.98, p.y ?? 0.5))) * h;
    slide.addShape(pptx.ShapeType.ellipse, { x: px - 0.06, y: py - 0.06, w: 0.12, h: 0.12, fill: { color: p.color || C.accent }, line: { color: p.color || C.accent } });
    addText(slide, p.label || "", px + 0.08, py - 0.09, 1.6, 0.22, { size: 6.8, color: p.color || C.ink });
  });
  if (sDef.takeaway) card(slide, 8.6, 1.65, 3.35, 2.3, sDef.takeawayTitle || "Implication", sDef.takeaway);
}

function addRoadmap(slide, sDef) {
  const phases = sDef.phases || [];
  const x0 = 0.75, y0 = 1.6, gap = 0.18;
  const colW = (11.85 - gap * Math.max(0, phases.length - 1)) / Math.max(1, phases.length);
  phases.forEach((p, i) => {
    const x = x0 + i * (colW + gap);
    slide.addShape(pptx.ShapeType.chevron, { x, y: y0, w: colW, h: 0.62, fill: { color: i === 0 ? C.accent : C.charcoal }, line: { color: "FFFFFF" } });
    addText(slide, p.period || `Phase ${i + 1}`, x + 0.12, y0 + 0.12, colW * 0.34, 0.18, { size: 6.6, bold: true, color: "FFFFFF" });
    addText(slide, p.title || "", x + colW * 0.38, y0 + 0.08, colW * 0.52, 0.24, { size: 8.2, bold: true, color: "FFFFFF" });
    slide.addShape(pptx.ShapeType.rect, { x, y: y0 + 0.88, w: colW, h: 3.2, fill: { color: i % 2 ? "FFFFFF" : C.light }, line: { color: C.line } });
    bullets(slide, p.actions || [], x + 0.16, y0 + 1.16, colW - 0.32, 1.55);
    if (p.milestone) addText(slide, p.milestone, x + 0.16, y0 + 3.52, colW - 0.32, 0.24, { size: 6.8, bold: true, color: C.accent });
  });
}

function addJourney(slide, sDef) {
  const stages = sDef.stages || [];
  const x0 = 0.75, y0 = 1.55, w = 11.85;
  const colW = w / Math.max(1, stages.length);
  stages.forEach((stage, i) => {
    const x = x0 + i * colW;
    slide.addShape(pptx.ShapeType.rect, { x, y: y0, w: colW, h: 4.95, fill: { color: i % 2 ? "FFFFFF" : C.light }, line: { color: C.line, width: 0.5 } });
    slide.addShape(pptx.ShapeType.rect, { x, y: y0, w: colW, h: 0.48, fill: { color: i === 0 ? C.accent : C.charcoal }, line: { color: i === 0 ? C.accent : C.charcoal } });
    addText(slide, stage.name || `Stage ${i + 1}`, x + 0.08, y0 + 0.14, colW - 0.16, 0.18, { size: 7.6, bold: true, color: "FFFFFF" });
    addText(slide, "行为", x + 0.1, y0 + 0.75, colW - 0.2, 0.18, { size: 6.8, bold: true, color: C.accent });
    addText(slide, stage.behavior || "", x + 0.1, y0 + 0.98, colW - 0.2, 0.55, { size: 6.5, color: C.muted });
    addText(slide, "缺口", x + 0.1, y0 + 1.75, colW - 0.2, 0.18, { size: 6.8, bold: true, color: C.accent });
    addText(slide, stage.gap || "", x + 0.1, y0 + 1.98, colW - 0.2, 0.7, { size: 6.5, color: C.muted });
    addText(slide, "动作", x + 0.1, y0 + 2.92, colW - 0.2, 0.18, { size: 6.8, bold: true, color: C.accent });
    addText(slide, stage.action || "", x + 0.1, y0 + 3.15, colW - 0.2, 0.75, { size: 6.5, color: C.ink });
    addText(slide, "指标：" + (stage.metric || ""), x + 0.1, y0 + 4.32, colW - 0.2, 0.2, { size: 6.3, bold: true, color: C.charcoal });
  });
}

(plan.slides || []).forEach((sDef, idx) => {
  const slide = pptx.addSlide();
  const pageNo = idx + 1;
  if (sDef.type === "cover") {
    slide.background = { color: C.bg };
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.23, h: 7.5, fill: { color: C.accent }, line: { color: C.accent } });
    slide.addShape(pptx.ShapeType.rect, { x: 0.23, y: 0, w: 0.04, h: 7.5, fill: { color: C.gold }, line: { color: C.gold } });
    addText(slide, sDef.client || plan.client || "", 0.85, 1.38, 3.0, 0.35, { size: 13, bold: true, color: C.accent });
    addText(slide, sDef.title || plan.title, 0.85, 2.02, 8.9, 0.72, { size: 30, bold: true });
    addText(slide, sDef.subtitle || plan.subtitle || "", 0.9, 2.92, 8.4, 0.35, { size: 12, color: C.muted });
    addText(slide, sDef.date || plan.date || "", 0.9, 6.48, 3.6, 0.25, { size: 8.5, color: C.muted });
  } else if (sDef.type === "section") {
    slide.background = { color: C.charcoal };
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.22, h: 7.5, fill: { color: C.accent }, line: { color: C.accent } });
    addText(slide, sDef.kicker || "", 0.85, 1.65, 2.8, 0.4, { size: 16, bold: true, color: C.gold });
    addText(slide, sDef.title || "", 0.85, 2.28, 8.9, 0.7, { size: 28, bold: true, color: "FFFFFF" });
    if (sDef.subtitle) addText(slide, sDef.subtitle, 0.9, 3.55, 7.5, 0.4, { size: 10, color: "E8E2DD" });
    addText(slide, String(pageNo).padStart(2, "0"), 11.7, 6.6, 0.7, 0.25, { size: 8, color: "D8D2CD", align: "right" });
  } else if (sDef.type === "table") {
    title(slide, sDef.title, sDef.subtitle, pageNo);
    addTable(slide, sDef.columns, sDef.rows);
  } else if (sDef.type === "cards") {
    title(slide, sDef.title, sDef.subtitle, pageNo);
    const cards = sDef.cards || [];
    cards.slice(0, 4).forEach((c, i) => card(slide, 0.75 + i * 3.05, 1.65, 2.65, 2.2, c.title, c.body));
  } else if (sDef.type === "chart") {
    title(slide, sDef.title, sDef.subtitle, pageNo);
    addChart(slide, sDef);
  } else if (sDef.type === "matrix") {
    title(slide, sDef.title, sDef.subtitle, pageNo);
    addMatrix(slide, sDef);
  } else if (sDef.type === "roadmap") {
    title(slide, sDef.title, sDef.subtitle, pageNo);
    addRoadmap(slide, sDef);
  } else if (sDef.type === "journey") {
    title(slide, sDef.title, sDef.subtitle, pageNo);
    addJourney(slide, sDef);
  } else {
    title(slide, sDef.title, sDef.subtitle, pageNo);
    bullets(slide, sDef.bullets || [], 0.9, 1.55, 10.8, 3.8);
  }
});

async function write() {
  try {
    await pptx.writeFile({ fileName: output });
    const stats = fs.statSync(output);
    if (!stats.isFile() || stats.size <= 0) {
      fail(`PPTX was not written correctly: ${output}`);
    }
    console.log(output);
  } catch (err) {
    fail(`Could not write PPTX: ${output}`, err);
  }
}

write();
