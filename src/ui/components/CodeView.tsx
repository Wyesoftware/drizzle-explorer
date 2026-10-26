import { useEffect, useRef } from "react";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, highlightActiveLine, lineNumbers } from "@codemirror/view";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { oneDark } from "@codemirror/theme-one-dark";
import { sql, PostgreSQL, SQLite } from "@codemirror/lang-sql";
import { json } from "@codemirror/lang-json";
import { useTheme } from "@/lib/theme";

export type CodeLanguage = "sql" | "sqlite" | "json" | "text";

/** Read-only CodeMirror view for DDL, routine bodies and large cell values. */
export function CodeView({
  value,
  language = "text",
  wrap = true,
  className,
  onChange,
}: {
  value: string;
  language?: CodeLanguage;
  wrap?: boolean;
  className?: string;
  /** When given, the view becomes an editor and reports every change. */
  onChange?: (value: string) => void;
}) {
  const editable = Boolean(onChange);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const editableCompartment = useRef(new Compartment());
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const themeCompartment = useRef(new Compartment());
  const langCompartment = useRef(new Compartment());
  const wrapCompartment = useRef(new Compartment());
  const { resolvedTheme } = useTheme();

  const langExt = (): Extension => {
    switch (language) {
      case "sql":
        return sql({ dialect: PostgreSQL });
      case "sqlite":
        return sql({ dialect: SQLite });
      case "json":
        return json();
      default:
        return [];
    }
  };
  const themeExt = () => (resolvedTheme === "dark" ? oneDark : syntaxHighlighting(defaultHighlightStyle));

  useEffect(() => {
    if (!host.current) return;
    view.current = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          editableCompartment.current.of([EditorState.readOnly.of(!editable), EditorView.editable.of(editable)]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && onChangeRef.current) onChangeRef.current(update.state.doc.toString());
          }),
          langCompartment.current.of(langExt()),
          themeCompartment.current.of(themeExt()),
          wrapCompartment.current.of(wrap ? EditorView.lineWrapping : []),
          EditorView.theme({
            "&": { height: "100%", fontSize: "12.5px", backgroundColor: "transparent" },
            ".cm-scroller": { fontFamily: "var(--font-mono)", overflow: "auto" },
            "&.cm-focused": { outline: "none" },
          }),
        ],
      }),
    });
    return () => {
      view.current?.destroy();
      view.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    view.current?.dispatch({ effects: themeCompartment.current.reconfigure(themeExt()) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedTheme]);

  useEffect(() => {
    view.current?.dispatch({ effects: langCompartment.current.reconfigure(langExt()) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  useEffect(() => {
    view.current?.dispatch({ effects: wrapCompartment.current.reconfigure(wrap ? EditorView.lineWrapping : []) });
  }, [wrap]);

  useEffect(() => {
    view.current?.dispatch({
      effects: editableCompartment.current.reconfigure([EditorState.readOnly.of(!editable), EditorView.editable.of(editable)]),
    });
  }, [editable]);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const current = v.state.doc.toString();
    if (current !== value) v.dispatch({ changes: { from: 0, to: current.length, insert: value } });
  }, [value]);

  return <div ref={host} className={className ?? "h-full min-h-0 w-full overflow-hidden"} />;
}
