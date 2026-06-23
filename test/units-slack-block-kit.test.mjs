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
  unitsAstToSlackBlockKit,
  unitsToSlackBlockKit,
  validateStructuredSlack,
} from "../packages/units-slack-block-kit/index.js";
import { parseUnits } from "../packages/units/units-parser.js";

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
