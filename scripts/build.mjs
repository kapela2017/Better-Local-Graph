import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const check = process.argv.includes("--check");
const unknownArgs = process.argv.slice(2).filter((arg) => arg !== "--check");

function fail(message) {
  throw new Error(message);
}

function absolute(relative) {
  return path.join(root, relative);
}

function requireFile(relative) {
  const target = absolute(relative);
  if (!existsSync(target) || !statSync(target).isFile()) {
    fail(`Falta el archivo requerido: ${relative}`);
  }
}

function readRaw(relative) {
  requireFile(relative);
  return readFileSync(absolute(relative));
}

function readModule(relative) {
  requireFile(relative);
  return Buffer.from(readFileSync(absolute(relative), "utf8").replace(/\r\n/g, "\n"), "utf8");
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function validateManifest() {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(absolute("manifest.json"), "utf8"));
  } catch (error) {
    fail(`manifest.json no es JSON válido: ${error.message}`);
  }

  if (typeof manifest.id !== "string" || !/^[a-z0-9-]+$/.test(manifest.id)) {
    fail("manifest.id debe coincidir con /^[a-z0-9-]+$/");
  }
  if (manifest.id.includes("obsidian")) fail("manifest.id no puede contener 'obsidian'");
  if (manifest.id.endsWith("plugin")) fail("manifest.id no puede terminar en 'plugin'");
  if (typeof manifest.name !== "string" || /obsidian|plugin/i.test(manifest.name)) {
    fail("manifest.name no puede contener 'Obsidian' ni 'Plugin'");
  }
  if (typeof manifest.version !== "string" || !/^\d+\.\d+\.\d+$/.test(manifest.version)) {
    fail("manifest.version debe tener formato semver x.y.z");
  }
  if (typeof manifest.description !== "string" || manifest.description.length > 250 || !manifest.description.endsWith(".")) {
    fail("manifest.description debe medir como máximo 250 caracteres y terminar en punto");
  }
  if (typeof manifest.isDesktopOnly !== "boolean") fail("manifest.isDesktopOnly debe ser booleano");
  if (typeof manifest.minAppVersion !== "string" || !/^\d+\.\d+\.\d+$/.test(manifest.minAppVersion)) {
    fail("manifest.minAppVersion debe tener formato semver x.y.z");
  }
}

function assemble() {
  const inputs = [
    { file: "src/core.bundle.js", read: readRaw },
    { file: "src/vendor-markmap.inline.js", read: readRaw },
    { file: "blg-mcp-server.js", read: readModule },
    { file: "blg-backgrounds.js", read: readModule },
    { file: "blg-tag-mindmap.js", read: readModule },
    { file: "blg-pin-board.js", read: readModule },
    { file: "blg-folder-drops.js", read: readModule }
  ];
  // core→vendor, vendor→MCP, MCP→backgrounds, backgrounds→mindmap,
  // mindmap→pin-board, pin-board→drops.
  const separators = ["", "", "", "", "", "\n"];
  const chunks = [];

  inputs.forEach((input, index) => {
    chunks.push(input.read(input.file));
    if (index < separators.length) chunks.push(Buffer.from(separators[index], "utf8"));
  });
  return Buffer.concat(chunks);
}

function validateAssembly(assembled) {
  const text = assembled.toString("utf8");
  const headers = [
    "Better Local Graph — Servidor MCP embebido (inyectado)",
    "Better Local Graph — Fondos animados programables (inyectado)",
    "Better Local Graph — Mapa mental de tags con markmap (inyectado)",
    "Better Local Graph — Pizarra de notas fijadas (inyectado).",
    "Better Local Graph — Gotas de ubicación y Mover A (inyectado)."
  ];
  let previous = -1;

  for (const header of headers) {
    const count = text.split(header).length - 1;
    if (count !== 1) fail(`La cabecera '${header}' aparece ${count} veces; se esperaba una`);
    const position = text.indexOf(header);
    if (position <= previous) fail(`Las cabeceras de módulos no están en el orden esperado: ${header}`);
    previous = position;
  }

  if (!text.includes("__BLG_MARKMAP_VENDOR")) fail("Falta __BLG_MARKMAP_VENDOR en el bundle ensamblado");
  for (const required of ["manifest.json", "styles.css", "LICENSE", "README.md"]) requireFile(required);
  validateManifest();
}

function main() {
  if (unknownArgs.length) fail(`Argumentos desconocidos: ${unknownArgs.join(" ")}`);
  const assembled = assemble();
  validateAssembly(assembled);
  const digest = sha256(assembled);

  if (check) {
    const current = readRaw("main.js");
    if (!current.equals(assembled)) {
      fail(`main.js difiere del ensamblado (actual: ${sha256(current)}; esperado: ${digest})`);
    }
    console.log(`OK: main.js coincide con el ensamblado (${assembled.length} bytes; sha256 ${digest})`);
    return;
  }

  writeFileSync(absolute("main.js"), assembled);
  console.log(`Build OK: main.js (${assembled.length} bytes; sha256 ${digest})`);
}

try {
  main();
} catch (error) {
  console.error(`BLG build: ${error.message}`);
  process.exitCode = 1;
}
