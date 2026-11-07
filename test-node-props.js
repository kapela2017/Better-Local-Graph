/* Node-only contract checks for the node-properties modal. No vault writes. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const bundle = fs.readFileSync(path.join(__dirname, "main.js"), "utf8");
const helperNames = ["_blgTagsModelValue", "_blgTagify", "_blgTagAppend"];
const helperSource = helperNames.map(name => {
  const line = bundle.split("\n").find(text => text.startsWith(`function ${name}(`));
  assert.ok(line, `${name} present in bundle`);
  return line;
}).join("\n");
const helperContext = { globalThis: null };
helperContext.globalThis = helperContext;
vm.runInNewContext(`${helperSource}
globalThis.helpers = { _blgTagsModelValue, _blgTagify, _blgTagAppend };`, helperContext);
const { _blgTagsModelValue, _blgTagify, _blgTagAppend } = helperContext.helpers;

assert.match(bundle, /String\(k\)\.toLowerCase\(\)==="tags"&&\(v=_blgTagsModelValue\(v\)\)/);
assert.match(bundle, /let tg=_blgTagify\(raw\);/);
assert.match(bundle, /this\._tagSug\(inp,ar\);this\._nameTag\(inp\)/);

{
  const original = ["voice_notes/herreria/tips/arco_corto_menos_huecos"];
  const model = _blgTagsModelValue(original[0]);
  assert.equal(JSON.stringify(model), JSON.stringify(original));
  assert.notEqual(model, original);
  assert.equal(JSON.stringify(_blgTagsModelValue(null)), "[]");
  assert.equal(JSON.stringify(_blgTagsModelValue(["a", "b"])), '["a","b"]');
  assert.notEqual(_blgTagsModelValue(original), original);
  assert.equal(_blgTagsModelValue(7), 7);
}

{
  assert.equal(_blgTagify("Arco corto menos huecos"), "arco_corto_menos_huecos");
  assert.equal(_blgTagify("Súbita señal"), "subita_senal");
  assert.equal(_blgTagify("uno/dos"), "uno/dos");
  assert.equal(_blgTagify("#tag"), "tag");
  assert.equal(_blgTagify("!!!"), "");
  assert.equal(_blgTagify(null), "");
}

{
  const base = "voice_notes/herreria/tips/";
  const name = "Arco corto menos huecos";
  assert.equal(_blgTagAppend(base, name), "voice_notes/herreria/tips/arco_corto_menos_huecos");
  assert.equal(_blgTagAppend("voice_notes/herreria/tips", name), "voice_notes/herreria/tips/arco_corto_menos_huecos");
  assert.equal(_blgTagAppend("", name), "arco_corto_menos_huecos");
  assert.equal(_blgTagAppend("///", name), "arco_corto_menos_huecos");
  assert.equal(_blgTagAppend("  voice_notes/tips  ", name), "voice_notes/tips/arco_corto_menos_huecos");
  assert.equal(_blgTagAppend(base, ""), "");
  assert.equal(_blgTagAppend(base, "!!!"), "");
}

function extractMethod(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `${signature} present in bundle`);
  let depth = 0;
  for (let i = source.indexOf("{", start); i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`Unbalanced method: ${signature}`);
}

const methodContext = {
  _blgTagAppend,
  Event: class { constructor(type) { this.type = type; } },
  globalThis: null
};
methodContext.globalThis = methodContext;
const methodSource = extractMethod(bundle, "_nameTag(inp){");
const modalMethods = vm.runInNewContext(`({${methodSource}})`, methodContext);

function tagInput(value) {
  const input = { value, events: [], selection: null };
  input.addEventListener = (type, listener) => {
    assert.equal(type, "keydown");
    input.listener = listener;
  };
  input.dispatchEvent = event => input.events.push(event);
  input.setSelectionRange = (start, end) => { input.selection = [start, end]; };
  input.fire = (key, modifiers = {}) => {
    const event = {
      key,
      shiftKey: !!modifiers.shiftKey,
      ctrlKey: !!modifiers.ctrlKey,
      metaKey: !!modifiers.metaKey,
      altKey: !!modifiers.altKey,
      preventDefault() { this.prevented = true; },
      stopPropagation() { this.stopped = true; }
    };
    input.listener(event);
    return event;
  };
  return input;
}

{
  const modal = { _nameInput: { value: "Arco corto menos huecos" }, _nameTag: modalMethods._nameTag };
  const input = tagInput("voice_notes/herreria/tips/");
  modal._nameTag(input);
  const event = input.fire("Enter", { shiftKey: true });
  assert.equal(input.value, "voice_notes/herreria/tips/arco_corto_menos_huecos");
  assert.equal(event.prevented, true);
  assert.equal(event.stopped, true);
  assert.equal(input.events.length, 1);
  assert.equal(input.events[0].type, "change");
  assert.deepEqual(input.selection, [input.value.length, input.value.length]);
}

{
  const modal = { _nameInput: { value: "Arco corto" }, _nameTag: modalMethods._nameTag };
  const input = tagInput("voice_notes/tips/");
  modal._nameTag(input);
  const before = input.value;
  const plain = input.fire("Enter");
  const ctrlShift = input.fire("Enter", { shiftKey: true, ctrlKey: true });
  const metaShift = input.fire("Enter", { shiftKey: true, metaKey: true });
  const altShift = input.fire("Enter", { shiftKey: true, altKey: true });
  assert.equal(input.value, before);
  for (const event of [plain, ctrlShift, metaShift, altShift]) {
    assert.equal(event.prevented, undefined);
    assert.equal(event.stopped, undefined);
  }
  assert.equal(input.events.length, 0);
}

{
  const modal = { _nameInput: { value: "  " }, _nameTag: modalMethods._nameTag };
  const input = tagInput("voice_notes/tips/");
  modal._nameTag(input);
  const event = input.fire("Enter", { shiftKey: true });
  assert.equal(input.value, "voice_notes/tips/");
  assert.equal(event.prevented, undefined);
  assert.equal(input.events.length, 0);
  modal._nameInput.value = null;
  const nullEvent = input.fire("Enter", { shiftKey: true });
  assert.equal(input.value, "voice_notes/tips/");
  assert.equal(nullEvent.prevented, undefined);
}

{
  const modal = { _nameInput: { value: "!!!" }, _nameTag: modalMethods._nameTag };
  const input = tagInput("voice_notes/tips/");
  modal._nameTag(input);
  const event = input.fire("Enter", { shiftKey: true });
  assert.equal(input.value, "voice_notes/tips/");
  assert.equal(event.prevented, undefined);
  assert.equal(input.events.length, 0);
}

console.log("test-node-props.js: ok");
