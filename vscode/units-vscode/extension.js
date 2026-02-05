const vscode = require("vscode");
const { formatUnits, formatUnitsRange } = require("./formatter");

function fullRange(document) {
  const lastLine = document.lineAt(document.lineCount - 1);
  return new vscode.Range(0, 0, lastLine.lineNumber, lastLine.range.end.character);
}

function activate(context) {
  const provider = vscode.languages.registerDocumentFormattingEditProvider("units", {
    provideDocumentFormattingEdits(document) {
      const formatted = formatUnits(document.getText());
      return [vscode.TextEdit.replace(fullRange(document), formatted)];
    },
  });

  const rangeProvider = vscode.languages.registerDocumentRangeFormattingEditProvider("units", {
    provideDocumentRangeFormattingEdits(document, range) {
      const start = document.offsetAt(range.start);
      const end = document.offsetAt(range.end);
      const result = formatUnitsRange(document.getText(), start, end);
      const targetRange = new vscode.Range(document.positionAt(result.start), document.positionAt(result.end));
      return [vscode.TextEdit.replace(targetRange, result.formatted)];
    },
  });

  const onSave = vscode.workspace.onWillSaveTextDocument((event) => {
    if (event.document.languageId !== "units") return;
    const cfg = vscode.workspace.getConfiguration("units", event.document.uri);
    if (!cfg.get("formatOnSave", true)) return;
    const formatted = formatUnits(event.document.getText());
    event.waitUntil(Promise.resolve([vscode.TextEdit.replace(fullRange(event.document), formatted)]));
  });

  context.subscriptions.push(provider, rangeProvider, onSave);
}

function deactivate() {}

module.exports = { activate, deactivate };
