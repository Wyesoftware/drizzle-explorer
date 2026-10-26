import { useEffect, useRef } from "react";
import { useTheme } from "@/lib/theme";
import { EditorState, Compartment, type Extension } from "@codemirror/state";
import { EditorView, keymap, placeholder as cmPlaceholder } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { basicSetup } from "codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import { PostgreSQL, SQLite, sql, type SQLNamespace } from "@codemirror/lang-sql";
import type { Dialect } from "@shared/types";

export function CodeEditor({
  value,
  onChange,
  onRun,
  dialect = "postgres",
  schema,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  onRun: () => void;
  dialect?: Dialect;
  schema?: SQLNamespace;
  placeholder?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const themeCompartment = useRef(new Compartment());
  const langCompartment = useRef(new Compartment());
  const onRunRef = useRef(onRun);
  const onChangeRef = useRef(onChange);
  onRunRef.current = onRun;
  onChangeRef.current = onChange;
  const { resolvedTheme } = useTheme();

  const languageExtension = (): Extension =>
    sql({ dialect: dialect === "sqlite" ? SQLite : PostgreSQL, schema, upperCaseKeywords: false });

  useEffect(() => {
    if (!host.current) return;
    const state = EditorState.create({
      doc: value,
      extensions: [
        basicSetup,
        history(),
        keymap.of([
          { key: "Mod-Enter", run: () => (onRunRef.current(), true) },
          indentWithTab,
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        langCompartment.current.of(languageExtension()),
        themeCompartment.current.of(resolvedTheme === "dark" ? oneDark : []),
        EditorView.theme({
          "&": { height: "100%", fontSize: "13px" },
          ".cm-scroller": { fontFamily: "var(--font-mono)", overflow: "auto" },
          "&.cm-focused": { outline: "none" },
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current(update.state.doc.toString());
        }),
        placeholder ? cmPlaceholder(placeholder) : [],
      ],
    });
    view.current = new EditorView({ state, parent: host.current });
    return () => {
      view.current?.destroy();
      view.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    view.current?.dispatch({ effects: themeCompartment.current.reconfigure(resolvedTheme === "dark" ? oneDark : []) });
  }, [resolvedTheme]);

  useEffect(() => {
    view.current?.dispatch({ effects: langCompartment.current.reconfigure(languageExtension()) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialect, schema]);

  // Keep the editor in sync if the value is changed from outside.
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const current = v.state.doc.toString();
    if (current !== value) v.dispatch({ changes: { from: 0, to: current.length, insert: value } });
  }, [value]);

  return <div ref={host} className="h-full min-h-0 w-full overflow-hidden bg-background" />;
}
