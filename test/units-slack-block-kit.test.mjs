import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

import {
  SLACK_UNITS_STRUCTURED_OUTPUT_SCHEMA,
  compileUnitsToSlackBlockKit,
  compileStructuredSlackToBlockKit,
  serializeSlackMrkdwn,
  structuredSlackToBlockKit,
  structuredSlackToUnitsTree,
  unitsTreeToSlackBlockKit,
  unitsAstToSlackBlockKit,
  unitsToSlackBlockKit,
  validateStructuredSlack,
} from "../packages/units-slack-block-kit/index.js";
import { parseUnits } from "../packages/units/units-parser.js";

const SLACK_TEXT_KIND = "units-slack-text";

function slackText(value) {
  return {
    kind: SLACK_TEXT_KIND,
    value,
  };
}

function slackElement(name, props = {}, children = []) {
  return {
    kind: "element",
    name,
    props,
    events: {},
    children,
  };
}

test("converts a simple SlackMessage DSL into Block Kit payload", () => {
  const payload = unitsToSlackBlockKit(`
SlackMessage (channel:'C123', text:'Release request') {
  Section (blockId:'summary') {
    text 'Release is ready for approval.'
  }
  Actions {
    Button (name:'Approve', actionId:'approve', style:'primary')
    Button (name:'Reject', actionId:'reject', style:'danger')
  }
}
`);

  assert.equal(payload.channel, "C123");
  assert.equal(payload.text, "Release request");
  assert.deepEqual(payload.blocks, [
    {
      type: "section",
      block_id: "summary",
      text: {
        type: "mrkdwn",
        text: "Release is ready for approval.",
      },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "Approve",
          },
          action_id: "approve",
          style: "primary",
        },
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "Reject",
          },
          action_id: "reject",
          style: "danger",
        },
      ],
    },
  ]);
});

test("serializes semantic Units inline tags as Slack mrkdwn", () => {
  const payload = unitsToSlackBlockKit(`
SlackMessage {
  Section {
    Strong { 'Release:' }
    ' '
    Link (href:'https://example.com/release') { 'View request' }
    ' assigned to '
    Mention (userId:'U012AB3CD')
    ' in '
    Channel (channelId:'C999', name:'deploys')
    ' '
    UserGroup (userGroupId:'S12345', name:'ops')
    ' '
    SpecialMention (name:'here')
    ' '
    Date (timestamp:'1392734382', format:'{date_short}', fallback:'Feb 18, 2014')
    ' '
    Code { 'deploy --prod' }
  }
  Blockquote {
    'Ship only after QA signs off.'
  }
}
`);

  assert.equal(
    payload.blocks[0].text.text,
    "*Release:* <https://example.com/release|View request> assigned to <@U012AB3CD> in <#C999|deploys> <!subteam^S12345|ops> <!here> <!date^1392734382^{date_short}|Feb 18, 2014> `deploy --prod`",
  );
  assert.equal(payload.blocks[1].text.text, ">Ship only after QA signs off.");
});

test("maps section fields and accessory elements", () => {
  const payload = unitsToSlackBlockKit(`
Section (blockId:'release') {
  Strong { 'Release checklist' }
  Field {
    Strong { 'Status:' }
    '
Ready'
  }
  Field {
    Strong { 'Owner:' }
    '
'
    Mention (userId:'U777')
  }
  Button (name:'Open request', actionId:'open', href:'https://example.com/release')
}
`);

  assert.deepEqual(payload.blocks, [
    {
      type: "section",
      block_id: "release",
      text: {
        type: "mrkdwn",
        text: "*Release checklist*",
      },
      fields: [
        {
          type: "mrkdwn",
          text: "*Status:*\nReady",
        },
        {
          type: "mrkdwn",
          text: "*Owner:*\n<@U777>",
        },
      ],
      accessory: {
        type: "button",
        text: {
          type: "plain_text",
          text: "Open request",
        },
        action_id: "open",
        url: "https://example.com/release",
      },
    },
  ]);
});

test("maps context images and input/select blocks", () => {
  const payload = unitsToSlackBlockKit(`
SlackMessage {
  Context {
    Image (src:'https://example.com/avatar.png', alt:'avatar')
    'Approved by '
    Mention (userId:'U1')
    PlainText { 'plain tail' }
  }
  Input (blockId:'owner', label:'Owner', hint:'Pick one', optional:true) {
    StaticSelect (
      actionId:'owner_select',
      placeholder:'Select owner',
      options=[
        { text:'Ada', value:'U1' },
        { text:'Grace', value:'U2' }
      ]
    )
  }
}
`);

  assert.equal(payload.blocks[0].type, "context");
  assert.deepEqual(payload.blocks[0].elements, [
    {
      type: "image",
      image_url: "https://example.com/avatar.png",
      alt_text: "avatar",
    },
    {
      type: "mrkdwn",
      text: "Approved by <@U1>",
    },
    {
      type: "plain_text",
      text: "plain tail",
    },
  ]);
  assert.deepEqual(payload.blocks[1], {
    type: "input",
    label: {
      type: "plain_text",
      text: "Owner",
    },
    block_id: "owner",
    hint: {
      type: "plain_text",
      text: "Pick one",
    },
    element: {
      type: "static_select",
      action_id: "owner_select",
      placeholder: {
        type: "plain_text",
        text: "Select owner",
      },
      options: [
        {
          text: {
            type: "plain_text",
            text: "Ada",
          },
          value: "U1",
        },
        {
          text: {
            type: "plain_text",
            text: "Grace",
          },
          value: "U2",
        },
      ],
    },
    optional: true,
  });
});

test("evaluates Units loops and expression props before Block Kit serialization", () => {
  const result = compileUnitsToSlackBlockKit(`
SlackMessage (text:'Deploy approvals') {
  Actions {
    #for (item in @actions) {
      #key (@item.id)
      Button (name=@item.label, actionId=@item.id, style=@item.style)
    }
  }
}
`, {
    scope: {
      actions: [
        { id: "approve", label: "Approve", style: "primary" },
        { id: "hold", label: "Hold", style: "danger" },
      ],
    },
  });

  assert.equal(result.warnings.length, 0);
  assert.deepEqual(result.blocks[0].elements.map((element) => element.action_id), ["approve", "hold"]);
  assert.deepEqual(result.blocks[0].elements.map((element) => element.text.text), ["Approve", "Hold"]);
});

test("accepts AST input, raw pass-through blocks, and strict unsupported-tag failures", () => {
  const ast = parseUnits(`
SlackMessage {
  RawBlock (payload=({ type:'divider', block_id:'raw' }))
}
`);

  assert.deepEqual(unitsAstToSlackBlockKit(ast).blocks, [
    {
      type: "divider",
      block_id: "raw",
    },
  ]);

  assert.throws(
    () => unitsToSlackBlockKit("UnsupportedSlackThing", { strict: true }),
    /Unsupported Slack block tag/,
  );
});

test("serializes existing Slack benchmark Units fixture", async () => {
  const source = await fs.readFile(new URL("../bench/cases/slack_block_kit.ui", import.meta.url), "utf8");
  const { payload, warnings } = compileUnitsToSlackBlockKit(source, { strict: true });

  assert.equal(warnings.length, 0);
  assert.equal(payload.blocks.length, 4);
  assert.equal(payload.blocks[0].type, "section");
  assert.match(payload.blocks[0].text.text, /\*Release:\*/);
  assert.match(payload.blocks[0].text.text, /<https:\/\/example.com\/release\|View request>/);
  assert.equal(payload.blocks[1].type, "context");
  assert.equal(payload.blocks[2].type, "section");
  assert.equal(payload.blocks[2].text.text, ">Ship only after QA signs off.");
  assert.equal(payload.blocks[3].type, "actions");
  assert.equal(payload.blocks[3].elements[0].action_id, "approve");
});

test("serializeSlackMrkdwn escapes raw text", () => {
  assert.equal(serializeSlackMrkdwn("a < b && c > d"), "a &lt; b &amp;&amp; c &gt; d");
});

test("converts schema-constrained structured Slack output into Block Kit", () => {
  const structured = {
    type: "SlackMessage",
    channel: "C123",
    text: "Release request",
    blocks: [
      {
        type: "Section",
        blockId: "summary",
        children: [
          { type: "Strong", text: "Release:" },
          " ready for approval by ",
          { type: "Mention", userId: "U012AB3CD" },
        ],
        fields: [
          {
            type: "Field",
            children: [
              { type: "Strong", text: "Status:" },
              "\nReady",
            ],
          },
        ],
        accessory: {
          type: "Button",
          name: "Open request",
          actionId: "open",
          href: "https://example.com/release",
        },
      },
      {
        type: "Actions",
        elements: [
          { type: "Button", name: "Approve", actionId: "approve", style: "primary" },
          { type: "Button", name: "Reject", actionId: "reject", style: "danger" },
        ],
      },
    ],
  };

  const validation = validateStructuredSlack(structured);
  assert.equal(validation.ok, true);

  const tree = structuredSlackToUnitsTree(structured);
  assert.equal(tree.name, "SlackMessage");
  assert.equal(tree.children[0].name, "Section");

  const result = compileStructuredSlackToBlockKit(structured, { strict: true });
  assert.equal(result.validation.ok, true);
  assert.equal(result.warnings.length, 0);
  assert.deepEqual(result.payload.blocks, [
    {
      type: "section",
      block_id: "summary",
      text: {
        type: "mrkdwn",
        text: "*Release:* ready for approval by <@U012AB3CD>",
      },
      fields: [
        {
          type: "mrkdwn",
          text: "*Status:*\nReady",
        },
      ],
      accessory: {
        type: "button",
        text: {
          type: "plain_text",
          text: "Open request",
        },
        action_id: "open",
        url: "https://example.com/release",
      },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "Approve",
          },
          action_id: "approve",
          style: "primary",
        },
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "Reject",
          },
          action_id: "reject",
          style: "danger",
        },
      ],
    },
  ]);

  assert.deepEqual(structuredSlackToBlockKit(structured), result.payload);
});

test("validates structured output before emitting Block Kit", () => {
  const invalid = {
    type: "SlackMessage",
    blocks: [
      { type: "Mention" },
      { type: "MysteryBlock" },
    ],
  };

  const validation = validateStructuredSlack(invalid);
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.some((error) => error.message === "Mention requires userId."));
  assert.ok(validation.errors.some((error) => error.message === "Unsupported structured Slack node type: MysteryBlock."));

  assert.throws(
    () => compileStructuredSlackToBlockKit(invalid, { strict: true }),
    /Invalid structured Slack output/,
  );
});

test("exports a schema for structured model outputs", () => {
  assert.equal(SLACK_UNITS_STRUCTURED_OUTPUT_SCHEMA.name, "slack_units_message");
  assert.equal(SLACK_UNITS_STRUCTURED_OUTPUT_SCHEMA.strict, true);
  assert.equal(SLACK_UNITS_STRUCTURED_OUTPUT_SCHEMA.schema.properties.type.const, "SlackMessage");
  assert.ok(SLACK_UNITS_STRUCTURED_OUTPUT_SCHEMA.schema.$defs.node.properties.type.enum.includes("Section"));
  assert.ok(SLACK_UNITS_STRUCTURED_OUTPUT_SCHEMA.schema.$defs.node.properties.type.enum.includes("Button"));
});

test("maps advanced Block Kit blocks and interactive elements from rendered Units trees", () => {
  const payload = unitsTreeToSlackBlockKit(slackElement("SlackMessage", {
    channel: "C999",
    threadTs: "1700000000.000100",
    username: "release-bot",
    iconEmoji: ":rocket:",
    unfurlLinks: false,
    parseMode: "none",
  }, [
    slackText("Loose text block"),
    slackElement("Markdown", { blockId: "md", text: "*raw markdown*" }),
    slackElement("Header", { blockId: "head", emoji: false }, [slackText("Launch window")]),
    slackElement("Divider", { blockId: "line" }),
    slackElement("Image", {
      blockId: "hero",
      imageUrl: "https://example.com/hero.png",
      altText: "Launch chart",
      title: "Launch chart",
    }),
    slackElement("Video", {
      blockId: "video",
      videoUrl: "https://example.com/demo.mp4",
      thumbnailUrl: "https://example.com/thumb.png",
      alt: "Demo",
      title: "Launch demo",
    }),
    slackElement("File", { blockId: "file", externalId: "F123", source: "remote" }, [
      slackText("Release notes"),
    ]),
    slackElement("RichText", {
      blockId: "rich",
      elements: [{ type: "rich_text_section", elements: [{ type: "text", text: "Rich" }] }],
    }),
    slackElement("Block", { slackType: "section", blockId: "generic" }, [
      slackText("Generic section"),
    ]),
    slackElement("Actions", {
      blockId: "controls",
      elements: [{ type: "button", text: { type: "plain_text", text: "Raw" }, action_id: "raw" }],
    }, [
      slackElement("WorkflowButton", { text: "Run workflow", actionId: "workflow", workflow: { trigger: { url: "https://example.com/trigger" } } }),
      slackElement("Overflow", {
        actionId: "overflow",
        text: "More",
        options: [
          "One",
          { name: "Two", value: "two", description: "Second option" },
        ],
        confirm: {
          title: "Confirm",
          text: "Continue?",
          confirm: "Yes",
          deny: "No",
        },
      }),
      slackElement("StaticSelect", {
        actionId: "select",
        placeholder: "Pick one",
        options: [{ label: "Ada", value: "ada" }],
        initialOption: { name: "Ada", value: "ada" },
        optionGroups: [{ name: "People", options: ["Grace"] }],
      }),
      slackElement("PlainTextInput", {
        actionId: "input",
        value: "initial",
        multiline: false,
        dispatchActionConfig: { trigger_actions_on: ["on_enter_pressed"] },
      }),
      slackElement("RadioButtons", {
        actionId: "radio",
        text: "Priority",
        options: [{ text: "High", value: "high" }],
      }),
      slackElement("Checkboxes", {
        actionId: "checks",
        text: "Flags",
        options: [{ text: "QA", value: "qa" }],
      }),
      slackElement("Element", { slackType: "email_text_input", actionId: "email" }),
      slackElement("RawElement", { payload: { type: "datepicker", action_id: "raw_date" } }),
    ]),
    slackElement("Input", { blockId: "fallback-input", optional: true }, [
      slackElement("Label", {}, [slackText("Generated label")]),
      slackElement("Hint", {}, [slackText("Generated hint")]),
    ]),
  ]));

  assert.equal(payload.channel, "C999");
  assert.equal(payload.thread_ts, "1700000000.000100");
  assert.equal(payload.icon_emoji, ":rocket:");
  assert.equal(payload.parse, "none");
  assert.equal(payload.blocks[0].type, "section");
  assert.equal(payload.blocks[1].type, "markdown");
  assert.deepEqual(payload.blocks[2].text, { type: "plain_text", text: "Launch window", emoji: false });
  assert.equal(payload.blocks[4].title.text, "Launch chart");
  assert.equal(payload.blocks[5].type, "video");
  assert.equal(payload.blocks[6].type, "file");
  assert.equal(payload.blocks[7].type, "rich_text");
  assert.equal(payload.blocks[8].text.text, "Generic section");

  const actions = payload.blocks[9];
  assert.equal(actions.elements[0].action_id, "raw");
  assert.equal(actions.elements[1].type, "workflow_button");
  assert.equal(actions.elements[2].confirm.confirm.text, "Yes");
  assert.deepEqual(actions.elements[2].options.map((option) => option.text.text), ["One", "Two"]);
  assert.equal(actions.elements[3].placeholder.text, "Pick one");
  assert.equal(actions.elements[3].initial_option.text.text, "Ada");
  assert.equal(actions.elements[3].option_groups[0].label.text, "People");
  assert.equal(actions.elements[4].initial_value, "initial");
  assert.equal(actions.elements[4].multiline, false);
  assert.equal(actions.elements[5].text.text, "Priority");
  assert.equal(actions.elements[6].text.text, "Flags");
  assert.equal(actions.elements[7].type, "email_text_input");
  assert.equal(actions.elements[8].action_id, "raw_date");

  assert.deepEqual(payload.blocks[10], {
    type: "input",
    label: { type: "plain_text", text: "Generated label" },
    block_id: "fallback-input",
    hint: { type: "plain_text", text: "Generated hint" },
    element: { type: "plain_text_input", block_id: "fallback-input", optional: true },
    optional: true,
  });
});

test("records non-strict Slack emitter warnings without dropping valid sibling blocks", () => {
  const result = compileUnitsToSlackBlockKit(slackElement("SlackMessage", {}, [
    slackElement("Section"),
    slackElement("Context"),
    slackElement("Actions", {}, [slackElement("UnknownElement")]),
    slackElement("Image"),
    slackElement("MysteryBlock", {}, [slackElement("Divider", { blockId: "nested" })]),
  ]));

  assert.deepEqual(result.warnings.map((warning) => warning.code), [
    "empty_section",
    "empty_context",
    "unsupported_element",
    "empty_actions",
    "missing_image_url",
  ]);
  assert.ok(result.blocks.some((block) => block.block_id === "nested"));
});

test("validates every structured Slack requirement with useful paths", () => {
  assert.deepEqual(validateStructuredSlack(null), {
    ok: false,
    errors: [{ path: "$", message: "Structured Slack output must be an object." }],
    warnings: [],
  });

  const validation = validateStructuredSlack({
    type: "NotSlack",
    blocks: [
      7,
      {},
      { type: "RawBlock", payload: {} },
      { type: "RawElement" },
      { type: "Image" },
      { type: "Link" },
      { type: "Channel" },
      { type: "UserGroup" },
      { type: "Date" },
      {
        type: "Section",
        children: [false],
        fields: ["field copy"],
        elements: [{ type: "Button", name: "Action" }],
        accessory: { type: "Mention" },
        element: { type: "RawElement", payload: { type: "plain_text_input" } },
        options: ["bad", { text: "Missing value" }],
      },
    ],
  });

  assert.equal(validation.ok, false);
  assert.deepEqual(validation.errors.map((error) => `${error.path}: ${error.message}`), [
    "type: Root type must be SlackMessage.",
    "blocks.0: Expected a string or structured node object.",
    "blocks.1: Structured nodes must include a type.",
    "blocks.2.payload: RawBlock requires payload.type.",
    "blocks.3.payload: RawElement requires payload.type.",
    "blocks.4: Image requires src, imageUrl, or url.",
    "blocks.5: Link requires href or url.",
    "blocks.6: Channel requires channelId.",
    "blocks.7: UserGroup requires userGroupId.",
    "blocks.8: Date requires timestamp.",
    "blocks.9.children.0: Expected a string or structured node object.",
    "blocks.9.accessory: Mention requires userId.",
    "blocks.9.options.0: Options must be objects.",
    "blocks.9.options.1: Options require text and value strings.",
  ]);

  assert.equal(validateStructuredSlack({ type: "SlackMessage", blocks: [] }).errors[0].path, "blocks");
});

test("structured Slack conversion handles scalar children, field shorthand, and loose props", () => {
  const tree = structuredSlackToUnitsTree({
    type: "SlackMessage",
    props: {
      metadata: { event_type: "release" },
    },
    text: "Fallback",
    blocks: [
      {
        type: "Section",
        props: { blockId: "from-props" },
        children: ["Count: ", 3, true, null],
        fields: ["field shorthand"],
        elements: [{ type: "Button", name: "Inline action", actionId: "inline" }],
      },
    ],
  });

  assert.equal(tree.props.metadata.event_type, "release");
  assert.equal(tree.props.text, "Fallback");
  assert.equal(tree.children[0].props.blockId, "from-props");
  assert.deepEqual(
    tree.children[0].children.map((child) => child.kind === SLACK_TEXT_KIND ? child.value : child.name),
    ["Count: ", "3", "true", "Field", "Button"],
  );

  const payload = structuredSlackToBlockKit({
    type: "SlackMessage",
    text: "Fallback",
    blocks: [
      {
        type: "Context",
        children: [
          { type: "PlainText", text: "Plain" },
          { type: "Text", text: "Text node" },
        ],
      },
    ],
  });
  assert.deepEqual(payload.blocks[0].elements, [
    { type: "plain_text", text: "Plain" },
    { type: "mrkdwn", text: "Text node" },
  ]);
});

test("serializes Slack mrkdwn fallbacks and entity escaping edge cases", () => {
  assert.equal(
    serializeSlackMrkdwn([
      42,
      true,
      slackElement("Link", {}, [slackText("No href <label>")]),
      " ",
      slackElement("Link", { href: "https://example.com/a|b" }),
      " ",
      slackElement("Mention", {}, [slackText("@U123")]),
      " ",
      slackElement("Channel", {}, [slackText("#C123")]),
      " ",
      slackElement("UserGroup", {}, [slackText("@S123")]),
      " ",
      slackElement("Date", { fallback: "No date" }),
      " ",
      slackElement("Emoji", { name: ":ship:" }),
      " ",
      slackElement("SpecialMention", { name: "not-real" }),
      " ",
      slackElement("Pre", {}, [slackText("```code```")]),
    ]),
    "42trueNo href &lt;label&gt; <https://example.com/a&#124;b> <@U123> <#C123> <!subteam^S123> No date :ship: <!here> ```'''code'''```",
  );
});
