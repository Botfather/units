import React from "react";
import source from "./todo.ui?raw";
import formatted from "./todo.ui?format";
import tokens from "./todo.ui?tokens";
import highlightHtml from "./todo.ui?highlight";
import { highlightTokens } from "./highlight.js";

export function PrettyPanel() {
  const html = React.useMemo(() => highlightTokens(tokens), []);
  return (
    <div className="pretty-panel">
      <section>
        <h3>Original</h3>
        <pre className="code-block">{source}</pre>
      </section>
      <section>
        <h3>Formatted</h3>
        <pre className="code-block">{formatted}</pre>
      </section>
      <section>
        <h3>Tokens</h3>
        <pre className="code-block" dangerouslySetInnerHTML={{ __html: html }} />
      </section>
      <section>
        <h3>Highlight (plugin)</h3>
        <pre className="code-block" dangerouslySetInnerHTML={{ __html: highlightHtml }} />
      </section>
    </div>
  );
}
