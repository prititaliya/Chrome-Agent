import { useEffect, useState } from "react";
import { costLabel, formatTokens } from "../../agent/usage";
import {
  deleteConversation,
  listConversations,
  watchConversations,
  type ConversationSummary,
} from "../../storage/conversations";
import { when } from "../time";
import { TrashIcon } from "./Icons";


interface Props {
  currentId: string;
  onOpen: (id: string) => void;
}

export default function HistoryView({ currentId, onOpen }: Props) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<ConversationSummary[]>([]);

  useEffect(() => {
    const load = () => void listConversations(query).then(setItems);
    load();
    return watchConversations(load);
  }, [query]);

  return (
    <div className="page">
      <input
        className="search"
        type="search"
        placeholder="Search conversations"
        aria-label="Search conversations"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />
      {items.length === 0 ? (
        <p className="muted center">{query ? "No matches." : "No conversations yet."}</p>
      ) : (
        <ul className="history">
          {items.map((item) => (
            <li key={item.id} className={item.id === currentId ? "history-item current" : "history-item"}>
              <button className="history-open" onClick={() => onOpen(item.id)}>
                <span className="history-title">{item.title}</span>
                <span className="history-meta">
                  <span>{when(item.updatedAt)}</span>
                  {item.model && <span>{item.model.split("/").pop()}</span>}
                  {item.usage && item.usage.requests > 0 && (
                    <span>
                      {formatTokens(item.usage.input + item.usage.output)} tok · {costLabel(item.usage)}
                    </span>
                  )}
                </span>
              </button>
              <button
                className="icon-btn"
                aria-label={`Delete ${item.title}`}
                onClick={() => void deleteConversation(item.id)}
              >
                <TrashIcon size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
