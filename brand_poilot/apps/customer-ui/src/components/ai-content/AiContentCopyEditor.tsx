import { useEffect, useState } from "react";
import type {
  AiContentCopyFields,
  AiGenerationOutput,
  ContentOutputFormatV2,
} from "../../features/ai-content/types";

const emptyCopy: AiContentCopyFields = {
  hook: "",
  keyMessage: "",
  body: "",
  cta: "",
  caption: "",
  hashtags: [],
};

const copyLabels: Record<Exclude<keyof AiContentCopyFields, "hashtags">, string> = {
  hook: "훅",
  keyMessage: "핵심 메시지",
  body: "본문",
  cta: "CTA",
  caption: "캡션",
};

function visibleFields(outputFormat: ContentOutputFormatV2) {
  return outputFormat === "blog"
    ? (["hook", "keyMessage", "body", "cta"] as const)
    : (["hook", "keyMessage", "body", "cta", "caption"] as const);
}

export function AiContentCopyEditor({
  outputFormat,
  output,
  saving,
  onSave,
}: {
  outputFormat: ContentOutputFormatV2;
  output: AiGenerationOutput;
  saving: boolean;
  onSave(fields: Partial<AiContentCopyFields>): Promise<void>;
}) {
  const [fields, setFields] = useState<AiContentCopyFields>(output.copy ?? emptyCopy);

  useEffect(() => {
    setFields(output.copy ?? emptyCopy);
  }, [output.copy]);

  const canSave = output.status === "completed"
    && output.revisionCapabilities?.includes("save_copy");

  return (
    <article className="content-review-copy__output">
      <h3>{output.title}</h3>
      {canSave ? (
        <>
          <fieldset disabled={saving}>
            <legend>직접 수정 후 저장</legend>
            {visibleFields(outputFormat).map((field) => (
              <label key={field}>
                <span>{copyLabels[field]}</span>
                <textarea
                  aria-label={`${output.title} ${copyLabels[field]}`}
                  value={fields[field]}
                  onChange={(event) => setFields((current) => ({
                    ...current,
                    [field]: event.target.value,
                  }))}
                />
              </label>
            ))}
            {outputFormat !== "blog" ? (
              <label>
                <span>해시태그</span>
                <input
                  aria-label={`${output.title} 해시태그`}
                  value={fields.hashtags.join(", ")}
                  onChange={(event) => setFields((current) => ({
                    ...current,
                    hashtags: event.target.value.split(",").map((tag) => tag.trim()).filter(Boolean),
                  }))}
                />
              </label>
            ) : null}
            <button
              className="button primary"
              type="button"
              disabled={saving}
              onClick={() => void onSave(Object.fromEntries([
                ...visibleFields(outputFormat).map((field) => [field, fields[field]]),
                ...(outputFormat === "blog" ? [] : [["hashtags", fields.hashtags]]),
              ]))}
            >
              {saving ? "저장 중" : `${output.title} 카피 저장`}
            </button>
          </fieldset>
        </>
      ) : output.artifact?.text ? (
        <p>{output.artifact.text}</p>
      ) : (
        <p className="muted">저장 가능한 카피가 없습니다.</p>
      )}
    </article>
  );
}
