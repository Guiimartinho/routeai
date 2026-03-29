/**
 * AIAssistant - Floating contextual AI chat panel.
 *
 * Bottom-right floating panel that:
 * - Shows AI suggestions based on the current workflow stage
 * - Provides chat input for questions at any stage
 * - Renders board references as clickable links
 * - Has Accept / Modify / Reject buttons for suggestions
 * - Shows AI reasoning in expandable sections
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  MessageSquare,
  X,
  Send,
  Loader2,
  ChevronDown,
  ChevronUp,
  Check,
  Pencil,
  XCircle,
  Sparkles,
  Bot,
  User,
  MapPin,
  ExternalLink,
  Minimize2,
  Maximize2,
} from 'lucide-react';
import { useWorkflowStore, type AIChatMessage, type AISuggestion } from '../../stores/workflowStore';
import { useProjectStore } from '../../stores/projectStore';
import type { BoardReference } from '../../types/review';

// ---------------------------------------------------------------------------
// Reference link
// ---------------------------------------------------------------------------

function ReferenceLink({ boardRef }: { boardRef: BoardReference }) {
  const navigateTo = useProjectStore((s) => s.navigateTo);
  const setHighlightedNet = useProjectStore((s) => s.setHighlightedNet);
  const setSelectedElement = useProjectStore((s) => s.setSelectedElement);

  const handleClick = () => {
    if (boardRef.location) {
      navigateTo(boardRef.location.x, boardRef.location.y, 10);
    }
    if (boardRef.type === 'net' && boardRef.id) {
      setHighlightedNet(boardRef.id);
    }
    if (boardRef.id) {
      setSelectedElement(boardRef.id, boardRef.type);
    }
  };

  return (
    <button
      onClick={handleClick}
      className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded text-[10px] text-brand-300 hover:text-brand-200 transition-colors"
      title={`Navigate to ${boardRef.type}: ${boardRef.name || boardRef.id}`}
    >
      <MapPin className="w-2.5 h-2.5" />
      {boardRef.name || boardRef.id || boardRef.type}
      <ExternalLink className="w-2 h-2 opacity-50" />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Chat message bubble
// ---------------------------------------------------------------------------

function ChatBubble({ message }: { message: AIChatMessage }) {
  const [expanded, setExpanded] = useState(false);
  const isUser = message.role === 'user';
  const isLong = message.content.length > 300;
  const displayContent = isLong && !expanded ? message.content.slice(0, 300) + '...' : message.content;

  return (
    <div className={`flex gap-2 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      {/* Avatar */}
      <div
        className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
          isUser ? 'bg-brand-600' : 'bg-purple-600'
        }`}
      >
        {isUser ? <User className="w-3 h-3 text-white" /> : <Bot className="w-3 h-3 text-white" />}
      </div>

      {/* Bubble */}
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 text-xs leading-relaxed ${
          isUser
            ? 'bg-brand-600/20 text-brand-100 border border-brand-500/20'
            : 'bg-gray-800 text-gray-200 border border-gray-700'
        }`}
      >
        {/* Context badge */}
        {message.context && (
          <span className="inline-block px-1.5 py-0.5 mb-1 rounded text-[9px] font-medium bg-gray-700 text-gray-400 uppercase">
            {message.context}
          </span>
        )}

        {/* Content */}
        <div className="whitespace-pre-wrap">{displayContent}</div>

        {/* Expand/collapse for long messages */}
        {isLong && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="mt-1 flex items-center gap-0.5 text-[10px] text-gray-500 hover:text-gray-300"
          >
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {expanded ? 'Show less' : 'Show more'}
          </button>
        )}

        {/* Board references */}
        {message.references && message.references.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {message.references.map((bRef, i) => (
              <ReferenceLink key={`${bRef.id ?? bRef.type}-${i}`} boardRef={bRef} />
            ))}
          </div>
        )}

        {/* Timestamp */}
        <div className="mt-1 text-[9px] text-gray-600">
          {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Suggestion card
// ---------------------------------------------------------------------------

interface SuggestionCardProps {
  suggestion: AISuggestion;
  onAccept: () => void;
  onModify: () => void;
  onReject: () => void;
}

function SuggestionCard({ suggestion, onAccept, onModify, onReject }: SuggestionCardProps) {
  const [showReasoning, setShowReasoning] = useState(false);

  const typeColors: Record<string, string> = {
    placement: 'border-blue-500/30 bg-blue-900/10',
    review: 'border-purple-500/30 bg-purple-900/10',
    routing: 'border-emerald-500/30 bg-emerald-900/10',
    drc_fix: 'border-yellow-500/30 bg-yellow-900/10',
    component: 'border-cyan-500/30 bg-cyan-900/10',
  };

  const typeLabels: Record<string, string> = {
    placement: 'Placement',
    review: 'Review',
    routing: 'Routing',
    drc_fix: 'DRC Fix',
    component: 'Component',
  };

  return (
    <div className={`rounded-lg border p-3 ${typeColors[suggestion.type] || 'border-gray-700 bg-gray-800/50'}`}>
      {/* Header */}
      <div className="flex items-start gap-2 mb-2">
        <Sparkles className="w-4 h-4 text-brand-400 shrink-0 mt-0.5" />
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-gray-200">{suggestion.title}</span>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-700 text-gray-400 uppercase">
              {typeLabels[suggestion.type] || suggestion.type}
            </span>
          </div>
          <p className="text-[11px] text-gray-400 mt-1 leading-relaxed">{suggestion.description}</p>
        </div>
      </div>

      {/* Reasoning toggle */}
      {suggestion.data && Object.keys(suggestion.data).length > 0 && (
        <button
          onClick={() => setShowReasoning(!showReasoning)}
          className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-300 mb-2"
        >
          {showReasoning ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          {showReasoning ? 'Hide reasoning' : 'Show reasoning'}
        </button>
      )}

      {showReasoning && suggestion.data && (
        <div className="mb-2 p-2 bg-gray-900/60 rounded text-[10px] text-gray-400 font-mono overflow-auto max-h-24">
          {JSON.stringify(suggestion.data, null, 2)}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2">
        <button
          onClick={onAccept}
          className="flex-1 flex items-center justify-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium bg-brand-600 text-white hover:bg-brand-500 transition-colors"
        >
          <Check className="w-3 h-3" />
          {suggestion.action}
        </button>
        <button
          onClick={onModify}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors"
          title="Modify suggestion"
        >
          <Pencil className="w-3 h-3" />
        </button>
        <button
          onClick={onReject}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium bg-gray-700 text-gray-300 hover:bg-red-900/40 hover:text-red-400 transition-colors"
          title="Dismiss suggestion"
        >
          <XCircle className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main AIAssistant component
// ---------------------------------------------------------------------------

export default function AIAssistant({ projectId }: { projectId: string }) {
  const aiPanelOpen = useWorkflowStore((s) => s.aiPanelOpen);
  const toggleAIPanel = useWorkflowStore((s) => s.toggleAIPanel);
  const setAIPanelOpen = useWorkflowStore((s) => s.setAIPanelOpen);
  const aiChatMessages = useWorkflowStore((s) => s.aiChatMessages);
  const aiIsThinking = useWorkflowStore((s) => s.aiIsThinking);
  const aiSuggestion = useWorkflowStore((s) => s.aiSuggestion);
  const currentStage = useWorkflowStore((s) => s.currentStage);
  const sendAIMessage = useWorkflowStore((s) => s.sendAIMessage);
  const setAISuggestion = useWorkflowStore((s) => s.setAISuggestion);
  const requestAIReview = useWorkflowStore((s) => s.requestAIReview);
  const requestAIPlacement = useWorkflowStore((s) => s.requestAIPlacement);
  const requestAIRouting = useWorkflowStore((s) => s.requestAIRouting);
  const advanceStage = useWorkflowStore((s) => s.advanceStage);

  const [input, setInput] = useState('');
  const [isMinimized, setIsMinimized] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [aiChatMessages, aiIsThinking]);

  // Handle send
  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || aiIsThinking) return;
    setInput('');
    sendAIMessage(projectId, text, currentStage);
  }, [input, aiIsThinking, projectId, currentStage, sendAIMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  // Suggestion actions
  const handleAcceptSuggestion = useCallback(() => {
    if (!aiSuggestion) return;

    switch (aiSuggestion.type) {
      case 'review':
        requestAIReview(projectId);
        break;
      case 'placement':
        requestAIPlacement(projectId);
        break;
      case 'routing':
        requestAIRouting(projectId);
        break;
      case 'drc_fix':
      case 'component':
        advanceStage();
        break;
    }
    setAISuggestion(null);
  }, [aiSuggestion, projectId, requestAIReview, requestAIPlacement, requestAIRouting, advanceStage, setAISuggestion]);

  const handleModifySuggestion = useCallback(() => {
    if (!aiSuggestion) return;
    setInput(`Regarding "${aiSuggestion.title}": `);
    inputRef.current?.focus();
  }, [aiSuggestion]);

  const handleRejectSuggestion = useCallback(() => {
    setAISuggestion(null);
  }, [setAISuggestion]);

  // ---------------------------------------------------------------------------
  // Render: collapsed button
  // ---------------------------------------------------------------------------

  if (!aiPanelOpen) {
    return (
      <button
        onClick={toggleAIPanel}
        className="fixed bottom-4 right-4 z-50 w-12 h-12 rounded-full bg-brand-600 hover:bg-brand-500 text-white shadow-lg shadow-brand-600/30 flex items-center justify-center transition-all hover:scale-105"
        title="Open AI Assistant"
      >
        <MessageSquare className="w-5 h-5" />
        {(aiSuggestion || aiChatMessages.length > 0) && (
          <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-[9px] font-bold flex items-center justify-center">
            {aiSuggestion ? '!' : aiChatMessages.length}
          </span>
        )}
      </button>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: open panel
  // ---------------------------------------------------------------------------

  return (
    <div
      className={`fixed bottom-4 right-4 z-50 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl shadow-black/50 flex flex-col transition-all duration-200 ${
        isMinimized ? 'w-80 h-12' : 'w-96 h-[520px]'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-brand-400" />
          <span className="text-xs font-semibold text-gray-200">AI Assistant</span>
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-500 uppercase">
            {currentStage}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsMinimized(!isMinimized)}
            className="p-1 text-gray-500 hover:text-gray-300 transition-colors"
            title={isMinimized ? 'Expand' : 'Minimize'}
          >
            {isMinimized ? <Maximize2 className="w-3.5 h-3.5" /> : <Minimize2 className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={() => setAIPanelOpen(false)}
            className="p-1 text-gray-500 hover:text-gray-300 transition-colors"
            title="Close"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {!isMinimized && (
        <>
          {/* Messages area */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {/* Welcome message if empty */}
            {aiChatMessages.length === 0 && !aiSuggestion && (
              <div className="text-center py-6">
                <Bot className="w-8 h-8 text-gray-700 mx-auto mb-2" />
                <p className="text-xs text-gray-500">
                  I am here to help with your PCB design. Ask me anything about your schematic, placement, routing, or DRC.
                </p>
              </div>
            )}

            {/* AI suggestion card */}
            {aiSuggestion && (
              <SuggestionCard
                suggestion={aiSuggestion}
                onAccept={handleAcceptSuggestion}
                onModify={handleModifySuggestion}
                onReject={handleRejectSuggestion}
              />
            )}

            {/* Chat messages */}
            {aiChatMessages.map((msg) => (
              <ChatBubble key={msg.id} message={msg} />
            ))}

            {/* Thinking indicator */}
            {aiIsThinking && (
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-purple-600 flex items-center justify-center shrink-0">
                  <Bot className="w-3 h-3 text-white" />
                </div>
                <div className="flex items-center gap-1.5 px-3 py-2 bg-gray-800 rounded-lg border border-gray-700">
                  <Loader2 className="w-3 h-3 text-brand-400 animate-spin" />
                  <span className="text-[11px] text-gray-400">Thinking...</span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input area */}
          <div className="shrink-0 p-3 border-t border-gray-800">
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={`Ask about ${currentStage}...`}
                className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-brand-500 transition-colors"
                disabled={aiIsThinking}
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || aiIsThinking}
                className="p-2 rounded-lg bg-brand-600 text-white hover:bg-brand-500 disabled:bg-gray-800 disabled:text-gray-600 disabled:cursor-not-allowed transition-colors"
                title="Send message"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
