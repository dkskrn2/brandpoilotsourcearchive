import { Plus, Trash2 } from "lucide-react";

const MAX_ITEMS = 8;
const MAX_LENGTH = 80;

function normalize(value: string) {
  return value.normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function faqUtteranceValidation(values: string[], minItems = 0) {
  const normalized = values.map(normalize).filter(Boolean);
  return {
    duplicate: new Set(normalized).size !== normalized.length,
    tooLong: values.some((value) => Array.from(value).length > MAX_LENGTH),
    empty: values.some((value) => !normalize(value)),
    count: normalized.length < minItems || values.length > MAX_ITEMS,
  };
}

interface Props {
  values: string[];
  onChange(values: string[]): void;
  disabled?: boolean;
  minItems?: number;
  label?: string;
}

export function FaqUtteranceEditor({
  values,
  onChange,
  disabled = false,
  minItems = 0,
  label = "표현 예시",
}: Props) {
  const validation = faqUtteranceValidation(values, minItems);
  return <fieldset className="faq-utterance-editor" disabled={disabled}>
    <legend>{label}</legend>
    <p className="faq-utterance-help">고객이 실제로 보낼 법한 짧은 질문을 한 줄씩 입력하세요.</p>
    <div className="faq-utterance-rows">
      {values.map((value, index) => <div className="faq-utterance-row" key={index}>
        <input
          aria-label={`표현 예시 ${index + 1}`}
          value={value}
          maxLength={MAX_LENGTH + 1}
          onChange={(event) => {
            const next = [...values];
            next[index] = event.target.value;
            onChange(next);
          }}
        />
        <button
          className="button icon-button"
          type="button"
          aria-label={`표현 예시 ${index + 1} 삭제`}
          onClick={() => onChange(values.filter((_, candidate) => candidate !== index))}
        ><Trash2 size={15} /></button>
      </div>)}
    </div>
    <button
      className="button faq-utterance-add"
      type="button"
      disabled={disabled || values.length >= MAX_ITEMS}
      onClick={() => onChange([...values, ""])}
    ><Plus size={15} /> 표현 예시 추가</button>
    {validation.count ? <p className="faq-utterance-error">표현 예시는 {minItems}~8개로 입력해 주세요.</p> : null}
    {validation.empty ? <p className="faq-utterance-error">빈 표현을 삭제하거나 내용을 입력해 주세요.</p> : null}
    {validation.duplicate ? <p className="faq-utterance-error">같은 의미의 표현이 중복되었습니다.</p> : null}
    {validation.tooLong ? <p className="faq-utterance-error">표현은 80자 이하로 입력해 주세요.</p> : null}
  </fieldset>;
}
