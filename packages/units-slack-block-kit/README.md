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

## LLM Prompt Shape

For model-generated messages, constrain output to Units DSL and validate by conversion:

```txt
Return only valid Units DSL for a Slack Block Kit message.
Use SlackMessage, Section, Context, Actions, Button, Field, Strong, Link, Mention, and Date tags.
Use single-quoted strings. Do not output markdown fences or JSON.
```

Then:

```js
const { payload, warnings } = compileUnitsToSlackBlockKit(modelOutput, {
  strict: true,
});
```
