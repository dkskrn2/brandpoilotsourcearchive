"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef } from "react";

type SmartEditorApp = {
  exec: (command: string, parameters: unknown[]) => void;
};

declare global {
  interface Window {
    nhn?: {
      husky?: {
        EZCreator?: {
          createInIFrame: (options: Record<string, unknown>) => void;
        };
      };
    };
  }
}

type NaverSmartEditorProps = {
  defaultValue: string;
};

const EDITOR_ID = "article-body-editor";

export function NaverSmartEditor({ defaultValue }: NaverSmartEditorProps) {
  const editorApps = useRef<SmartEditorApp[]>([]);
  const initialized = useRef(false);
  const container = useRef<HTMLDivElement>(null);

  const initialize = useCallback(() => {
    if (initialized.current || !window.nhn?.husky?.EZCreator) return;
    initialized.current = true;
    window.nhn.husky.EZCreator.createInIFrame({
      oAppRef: editorApps.current,
      elPlaceHolder: EDITOR_ID,
      sSkinURI: "/vendor/smarteditor2/SmartEditor2Skin.html",
      fCreator: "createSEditor2",
      htParams: {
        bUseToolbar: true,
        bUseVerticalResizer: true,
        bUseModeChanger: true,
        bSkipXssFilter: false
      }
    });
  }, []);

  useEffect(() => {
    const form = container.current?.closest("form");
    if (!form) return;
    const synchronize = () => editorApps.current[0]?.exec("UPDATE_CONTENTS_FIELD", []);
    form.addEventListener("submit", synchronize);
    return () => form.removeEventListener("submit", synchronize);
  }, []);

  return (
    <div className="admin-smart-editor" ref={container}>
      <Script src="/vendor/smarteditor2/js/service/HuskyEZCreator.js" strategy="afterInteractive" onReady={initialize} />
      <div className="admin-smart-editor__viewport">
        <textarea id={EDITOR_ID} name="body" rows={22} defaultValue={defaultValue} aria-label="글 내용" />
      </div>
      <small>에디터·HTML·TEXT 모드를 지원합니다. 붙여넣은 HTML은 저장 시 안전한 태그와 스타일만 유지됩니다.</small>
    </div>
  );
}
