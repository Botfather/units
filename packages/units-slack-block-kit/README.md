# @botfather/units-slack-block-kit

Convert Units DSL, Units AST, or a rendered Units tree into Slack Block Kit payloads.

## Install

```sh
npm install @botfather/units @botfather/units-slack-block-kit
```

## Usage

```js
import { unitsToSlackBlockKit } from "@botfather/units-slack-block-kit";

const payload = unitsToSlackBlockKit(`
SlackMessage (channel:'C123', name:'Release request') {
  Section (blockId:'summary') {
    Strong { 'Release:' }
    ' ready for approval by '
    Mention (userId:'U012AB3CD')
  }
  Actions {
    Button (name:'Approve', actionId:'approve', style:'primary')
    Button (name:'Reject', actionId:'reject', style:'danger')
  }
}
`);

console.log(payload.blocks);
```

Use `compileUnitsToSlackBlockKit` when you want diagnostics:

```js
import { compileUnitsToSlackBlockKit } from "@botfather/units-slack-block-kit";

const result = compileUnitsToSlackBlockKit(source, {
  scope: { approvers },
  strict: true,
});

console.log(result.payload);
console.log(result.warnings);
```

The adapter evaluates Units directives and expressions through `createUnitsRenderer`, so `#if`, `#for`, expression props, slots, and text interpolation are resolved before Slack serialization.

## Supported Units Tags

Block tags:

- `SlackMessage`, `Message`
- `Section`, `Markdown`
- `Header`, `Heading`
- `Context`
- `Actions`, `Group`
- `Divider`, `Separator`
- `Image`
- `Input`
- `File`, `Video`, `RichText`
- `Block`, `RawBlock`, `SlackBlock` with `type`/`slackType`/`payload`

Element tags:

- `Button`, `WorkflowButton`
- `Image`
- `Overflow`
- `DatePicker`, `TimePicker`, `DateTimePicker`
- `PlainTextInput`, `EmailInput`, `UrlInput`, `NumberInput`, `RichTextInput`
- `StaticSelect`, `ExternalSelect`, `UsersSelect`, `ConversationsSelect`, `ChannelsSelect`
- `MultiStaticSelect`, `MultiExternalSelect`, `MultiUsersSelect`, `MultiConversationsSelect`, `MultiChannelsSelect`
- `Checkboxes`, `RadioButtons`
- `Element`, `RawElement`, `SlackElement` with `type`/`slackType`/`payload`

Inline mrkdwn tags:

- `Strong`, `Emphasis`, `Strike`
- `Code`, `Pre`
- `Blockquote`
- `Link`
- `Mention`, `Channel`, `UserGroup`, `SpecialMention`
- `Date`
- `Emoji`
- `Field`, `Label`, `Hint`

Camel-case Slack props are converted to Slack snake-case fields where useful, for example `blockId -> block_id`, `actionId -> action_id`, `src -> image_url`, and `alt -> alt_text`.

## LLM Structured Output

For model-generated messages, prefer schema-constrained structured output over free-form DSL. The emitter can only render valid input; it cannot make a model produce valid `.ui` syntax.

```js
import {
  SLACK_UNITS_STRUCTURED_OUTPUT_SCHEMA,
  compileStructuredSlackToBlockKit,
} from "@botfather/units-slack-block-kit";

// Pass SLACK_UNITS_STRUCTURED_OUTPUT_SCHEMA to your model provider as the
// required JSON schema. Then validate and render the returned object.
const result = compileStructuredSlackToBlockKit(modelJson, {
  strict: true,
});

console.log(result.payload);
```

Structured output shape:

```json
{
  "type": "SlackMessage",
  "channel": "C123",
  "text": "Release request",
  "blocks": [
    {
      "type": "Section",
      "blockId": "summary",
      "children": [
        { "type": "Strong", "text": "Release:" },
        " ready for approval by ",
        { "type": "Mention", "userId": "U012AB3CD" }
      ],
      "accessory": {
        "type": "Button",
        "name": "Open request",
        "actionId": "open",
        "href": "https://example.com/release"
      }
    }
  ]
}
```

Use `validateStructuredSlack(modelJson)` if you want validation without rendering. Keep `compileUnitsToSlackBlockKit(source, { strict: true })` for human-authored DSL, migrations, tests, or fallback repair flows:

```js
const { payload, warnings } = compileUnitsToSlackBlockKit(source, {
  strict: true,
});
```
