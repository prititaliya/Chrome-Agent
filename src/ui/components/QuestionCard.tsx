import { useState, type KeyboardEvent } from "react";
import { QuestionIcon } from "./Icons";

interface Props {
  question: string;
  options: string[];
  multiple: boolean;
  /** null means skipped. */
  onAnswer: (answer: string | null) => void;
}

export default function QuestionCard({ question, options, multiple, onAnswer }: Props) {
  const [picked, setPicked] = useState<string[]>([]);
  const [other, setOther] = useState("");

  const submit = () => {
    const custom = other.trim();
    if (multiple) {
      const all = custom ? [...picked, custom] : picked;
      if (all.length > 0) onAnswer(all.join("; "));
      return;
    }
    if (custom) onAnswer(custom);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="question" role="dialog" aria-label="Agent question">
      <div className="question-head">
        <QuestionIcon size={16} />
        <strong>The agent is asking</strong>
      </div>
      <p className="question-text">{question}</p>
      {options.length > 0 && (
        <div className={multiple ? "question-options multi" : "question-options"}>
          {options.map((option) =>
            multiple ? (
              <label key={option} className="question-check">
                <input
                  type="checkbox"
                  checked={picked.includes(option)}
                  onChange={(e) => setPicked(e.target.checked ? [...picked, option] : picked.filter((p) => p !== option))}
                />
                <span>{option}</span>
              </label>
            ) : (
              <button key={option} className="btn question-option" onClick={() => onAnswer(option)}>
                {option}
              </button>
            ),
          )}
        </div>
      )}
      <div className="question-other">
        <input
          type="text"
          placeholder={options.length > 0 ? "Other…" : "Your answer…"}
          aria-label="Your answer"
          value={other}
          onChange={(e) => setOther(e.target.value)}
          onKeyDown={onKeyDown}
          autoFocus={options.length === 0}
        />
        <button className="btn primary small" onClick={submit} disabled={multiple ? picked.length === 0 && other.trim() === "" : other.trim() === ""}>
          Send
        </button>
        <button className="btn ghost small" onClick={() => onAnswer(null)}>
          Skip
        </button>
      </div>
    </div>
  );
}
