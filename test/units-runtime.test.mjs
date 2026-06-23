import assert from "node:assert/strict";
import test from "node:test";

import {
  createUnitsEvaluator,
  parseUnits,
  renderUnits,
} from "../packages/units/index.js";

function flatten(value, out = []) {
  if (Array.isArray(value)) {
    for (const item of value) flatten(item, out);
    return out;
  }
  out.push(value);
  return out;
}

test("renderUnits resolves text interpolation and plain text nodes", () => {
  const ast = parseUnits(`
App {
  text 'Hello @{name}'
  text 'Done'
}
`);

  const rendered = renderUnits(ast, { name: "Ada" });
  assert.ok(Array.isArray(rendered));
  assert.equal(rendered.length, 1);
  const app = rendered[0];
  const children = flatten(app.props.children).filter((item) => item != null);
  assert.ok(children.includes("Hello "));
  assert.ok(children.includes("Ada"));
  assert.ok(children.includes("Done"));
});

test("renderUnits handles #for with #key and expression props", () => {
  const ast = parseUnits(`
List {
  #for (item, i in @items) {
    #key (@item.id)
    Row (idx=@i) {
      @item.label
    }
  }
}
`);

  const rendered = renderUnits(ast, {
    items: [
      { id: "r1", label: "One" },
      { id: "r2", label: "Two" },
    ],
  });

  const list = rendered[0];
  const children = flatten(list.props.children).filter((item) => item && typeof item === "object");
  const rows = children.filter((item) => item.type === "Row");

  assert.equal(rows.length, 2);
  assert.equal(rows[0].key, "r1");
  assert.equal(rows[1].key, "r2");
  assert.equal(rows[0].props.idx, 0);
  assert.equal(rows[1].props.idx, 1);
});

test("renderUnits handles if/elif/else chains and unmatched condition nulls", () => {
  const withElseAst = parseUnits(`
Shell {
  #if (@showA) {
    text 'A'
  }
  #elif (@showB) {
    text 'B'
  }
  #else {
    text 'C'
  }
}
`);

  const withElse = renderUnits(withElseAst, { showA: false, showB: true });
  const withElseChildren = flatten(withElse[0].props.children);
  assert.ok(withElseChildren.includes("B"));
  assert.ok(!withElseChildren.includes("C"));

  const noElseAst = parseUnits(`
Shell {
  #if (@showA) {
    text 'A'
  }
}
`);
  const noElse = renderUnits(noElseAst, { showA: false });
  const noElseChildren = flatten(noElse[0].props.children);
  assert.ok(noElseChildren.includes(null));
});

test("renderUnits resolves slot directives and evaluator preserves literal @ strings", () => {
  const ast = parseUnits(`
Card {
  #slot (footer)
}
`);

  const staticSlot = renderUnits(ast, {}, {
    slots: {
      footer: "Tail",
    },
  });
  assert.ok(flatten(staticSlot[0].props.children).includes("Tail"));

  const fnSlot = renderUnits(ast, {}, {
    slots: {
      footer: () => "FnTail",
    },
  });
  assert.ok(flatten(fnSlot[0].props.children).includes("FnTail"));

  const evalExpr = createUnitsEvaluator();
  assert.equal(evalExpr("'foo@bar.com'", {}), "foo@bar.com");
});

test("createUnitsEvaluator caches expressions and supports set assignment syntax", () => {
  const evalExpr = createUnitsEvaluator();
  assert.equal(evalExpr("@count + 1", { count: 1 }), 2);
  assert.equal(evalExpr("@count + 1", { count: 4 }), 5);

  const calls = [];
  assert.equal(
    evalExpr("set(clicked:=@event.type)", {}, {
      event: { type: "submit" },
      set: (key, value) => calls.push([key, value]),
    }),
    1,
  );
  assert.deepEqual(calls, [["clicked", "submit"]]);
});

test("renderUnits covers runtime directives, custom components, events, and interpolation edges", () => {
  function Field() {}

  const ast = parseUnits(`
Field (
  label:'Run',
  count=@count,
  enabled?=@enabled,
  hidden?=@hidden,
  disabled,
  on:click={ set(clicked:=@event.type) },
  !submit { set(submitted:=true) }
) {
  text 'Brace @{message.replace("}", "!")}'
  text 'Broken @{message'
  @computed
  #for (not valid) {
    text 'never'
  }
  #slot (missing)
  #noop {
    text 'from noop'
  }
}
`);

  const updates = [];
  const rendered = renderUnits(
    ast,
    {
      count: 2,
      enabled: true,
      hidden: false,
      message: "ok}",
      computed: "computed child",
    },
    {
      components: { Field },
      set: (key, value) => {
        updates.push([key, value]);
        return "stored";
      },
    },
  );

  const field = rendered[0];
  assert.equal(field.type, Field);
  assert.equal(field.props.label, "Run");
  assert.equal(field.props.count, 2);
  assert.equal(field.props.enabled, true);
  assert.equal(field.props.hidden, undefined);
  assert.equal(field.props.disabled, true);
  assert.equal(field.props.__scope.count, 2);

  assert.equal(field.props.onClick({ type: "click" }), "stored");
  assert.equal(field.props.onSubmit({ type: "submit" }), "stored");
  assert.deepEqual(updates, [
    ["clicked", "click"],
    ["submitted", true],
  ]);

  const children = flatten(field.props.children);
  assert.ok(children.includes("Brace "));
  assert.ok(children.includes("ok!"));
  assert.ok(children.includes("Broken "));
  assert.ok(children.includes("@{message"));
  assert.ok(children.includes("computed child"));
  assert.ok(children.includes(null));
  assert.ok(children.includes("from noop"));
  assert.ok(!children.includes("never"));
});

test("renderUnits accepts direct AST nodes and ignores unknown nodes", () => {
  assert.equal(renderUnits({ type: "text", value: "leaf" }, {}), "leaf");
  assert.equal(renderUnits({ type: "unknown" }, {}), null);
});
