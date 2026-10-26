/**
 * Disables macOS text substitution in every editable element (WKWebView applies autocorrect, smart
 * capitalisation and spellcheck to inputs by default, so "postgres" became "Postgres" in the connection
 * form). Attributes are applied on focus, which also covers fields we do not render ourselves
 * (AG Grid cell editors, CodeMirror's contenteditable, Base UI inputs).
 */
export function installNoAutocorrect(root: Document = document): void {
  root.addEventListener(
    "focusin",
    (event) => {
      const el = event.target;
      if (!(el instanceof HTMLElement)) return;
      if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el.isContentEditable)) return;
      if (!el.hasAttribute("autocorrect")) el.setAttribute("autocorrect", "off");
      if (!el.hasAttribute("autocapitalize")) el.setAttribute("autocapitalize", "off");
      if (!el.hasAttribute("spellcheck")) el.setAttribute("spellcheck", "false");
    },
    true,
  );
}
