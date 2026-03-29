import { useState, useRef, useEffect, FormEvent } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import type { ChatMessage, BoardReference } from '../../types/review';
import { Send, Bot, User, MapPin, Loader2 } from 'lucide-react';

interface ChatPanelProps {
  projectId: string;
}

function ReferenceLink({ boardRef }: { boardRef: BoardReference }) {
  const navigateTo = useProjectStore((s) => s.navigateTo);
  const setHighlightedNet = useProjectStore((s) => s.setHighlightedNet);

  const handleClick = () => {
    if (boardRef.location) {
      navigateTo(boardRef.location.x, boardRef.location.y, 25);
    }
    if (boardRef.type === 'net' && boardRef.id) {
      setHighlightedNet(boardRef.id);
    }
  };

  return (
    <button
      onClick={handleClick}
      className="inline-flex items-center gap-0.5 text-brand-400 hover:text-brand-300 text-xs font-medium underline decoration-brand-400/30 hover:decoration-brand-300/50 transition-colors"
    >
      <MapPin className="w-2.5 h-2.5" />
      {boardRef.name || boardRef.id || 'View location'}
    </button>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex gap-2.5 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      {/* Avatar */}
      <div
        className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
          isUser ? 'bg-brand-600/20' : 'bg-emerald-600/20'
        }`}
      >
        {isUser ? (
          <User className="w-3.5 h-3.5 text-brand-400" />
        ) : (
          <Bot className="w-3.5 h-3.5 text-emerald-400" />
        )}
      </div>

      {/* Content */}
      <div
        className={`max-w-[85%] rounded-xl px-3 py-2 text-sm leading-relaxed ${
          isUser
            ? 'bg-brand-600/20 text-gray-200'
            : 'bg-gray-800 text-gray-300'
        }`}
      >
        {/* Streaming indicator */}
        {message.isStreaming && (
          <span className="inline-block w-1.5 h-4 bg-brand-400 animate-pulse ml-0.5 align-middle" />
        )}

        {/* Message text */}
        <div className="whitespace-pre-wrap">{message.content}</div>

        {/* Board references */}
        {message.references && message.references.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {message.references.map((ref, i) => (
              <ReferenceLink key={i} boardRef={ref} />
            ))}
          </div>
        )}

        {/* Timestamp */}
        <div
          className={`text-[10px] mt-1 ${
            isUser ? 'text-brand-400/50' : 'text-gray-600'
          }`}
        >
          {new Date(message.timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </div>
      </div>
    </div>
  );
}

export default function ChatPanel({ projectId }: ChatPanelProps) {
  const { chatMessages, chatLoading, sendMessage } = useProjectStore();
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const msg = input.trim();
    if (!msg || chatLoading) return;
    setInput('');
    await sendMessage(projectId, msg);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  // Auto-resize textarea
  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Messages */}
      <div className="flex-1 overflow-auto p-3 space-y-3">
        {chatMessages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <Bot className="w-10 h-10 text-gray-700 mb-3" />
            <p className="text-sm text-gray-400 mb-1">Ask about your PCB design</p>
            <p className="text-xs text-gray-600 leading-relaxed">
              I can help you understand review findings, suggest improvements, explain design rules,
              and answer questions about your board layout.
            </p>
            <div className="mt-4 space-y-1.5 w-full">
              {[
                'Why did the clearance check fail near U1?',
                'How can I improve the thermal relief on my ground plane?',
                'What trace width should I use for 2A on the 5V rail?',
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => {
                    setInput(suggestion);
                    inputRef.current?.focus();
                  }}
                  className="w-full text-left px-3 py-2 text-xs text-gray-500 hover:text-gray-300 bg-gray-800/50 hover:bg-gray-800 rounded-lg transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {chatMessages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
            {chatLoading && (
              <div className="flex items-center gap-2 text-xs text-gray-500 px-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Thinking...
              </div>
            )}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Input area */}
      <div className="border-t border-gray-800 p-3 shrink-0">
        <form onSubmit={handleSubmit} className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your design..."
            rows={1}
            className="input-field text-sm resize-none py-2 min-h-[36px] max-h-[120px]"
          />
          <button
            type="submit"
            disabled={!input.trim() || chatLoading}
            className="btn-primary p-2 shrink-0"
            title="Send message"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
        <p className="text-[10px] text-gray-600 mt-1.5">
          Press Enter to send, Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
