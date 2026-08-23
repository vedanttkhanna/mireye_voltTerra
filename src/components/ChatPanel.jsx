import { useState, useRef, useEffect } from 'react';
import { renderMarkdownLite } from '../utils/markdownLite.jsx';
import CitationChip from './CitationChip.jsx';
import BucketBadge from './BucketBadge.jsx';
import { formatRatio } from '../utils/format.js';

function formatDataGap(gap) {
  if (typeof gap === 'string') return gap;
  if (!gap || typeof gap !== 'object') return String(gap);
  return gap.message ?? gap.description ?? gap.field ?? JSON.stringify(gap);
}

function summarizeDataGaps(gaps) {
  const formatted = gaps.map(formatDataGap);
  if (formatted.length <= 6) return formatted.join(', ');
  return `${formatted.slice(0, 6).join(', ')} and ${formatted.length - 6} more`;
}

function formatProvider(provider) {
  if (provider === 'gemini') return 'Gemini';
  if (provider === 'groq') return 'Groq';
  return 'deterministic fallback';
}

export default function ChatPanel({ selectedCounty, onSelectCounty, chatExpanded, onToggleExpand, onClose }) {
  const [messages, setMessages] = useState([
    {
      id: 'welcome',
      role: 'assistant',
      content:
        'Hello! I can evaluate California counties for EV charging funding using Mireye physical grid tools and California DMV/DOE infrastructure models.\n\nAsk me about any county or location, and I will inspect real physical constraints and formulate justifiable funding decisions.',
      citations: [
        { source: 'EIA Substation Dataset', source_url: 'https://www.eia.gov/electricity/data.php', confidence: 'high' },
        { source: 'DOE AFDC Charging Data', source_url: 'https://developer.nlr.gov', confidence: 'high' },
        { source: 'CA DMV Vehicle Counts', source_url: 'https://data.ca.gov/dataset/vehicle-fuel-type-count-by-zip-code', confidence: 'high' },
      ],
      confidence: 'high',
      answered_at: new Date().toISOString(),
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  const sendQuery = async (queryText) => {
    const textToSend = queryText || input;
    if (!textToSend.trim() || loading) return;

    const userMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: textToSend.trim(),
      county_name: selectedCounty?.county_name,
    };

    setMessages((prev) => [...prev, userMessage]);
    if (!queryText) setInput('');
    setLoading(true);
    setError(null);

    const history = messages
      .filter((message) => message.id !== 'welcome' && ['user', 'assistant'].includes(message.role))
      .slice(-6)
      .map(({ role, content }) => ({ role, content: content.slice(0, 1500) }));

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: textToSend.trim(),
          county_fips: selectedCounty?.county_fips,
          history,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Agent request failed');
      }

      // Deduplicate citations by source_url + source
      const uniqueCitations = [];
      const seen = new Set();
      for (const c of data.citations || []) {
        const key = `${c.source}-${c.source_url}`;
        if (!seen.has(key)) {
          seen.add(key);
          uniqueCitations.push(c);
        }
      }

      const agentMessage = {
        id: `agent-${Date.now()}`,
        role: 'assistant',
        content: data.answer,
        decision: data.decision,
        decision_label: data.decision_label,
        confidence: data.confidence,
        citations: uniqueCitations,
        data_gaps: data.data_gaps,
        answered_at: data.answered_at,
        county: data.county,
        tool_executions: data.tool_executions,
        provider: data.provider,
        fallback_used: data.fallback_used,
        fallback_reason: data.fallback_reason,
        context_scope: data.context_scope,
        token_usage: data.token_usage,
        followups: data.suggested_followups,
      };

      setMessages((prev) => [...prev, agentMessage]);

      if (data.county?.county_fips && onSelectCounty) {
        onSelectCounty(data.county.county_fips);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendQuery();
    }
  };

  const dynamicPrompts = selectedCounty
    ? [
      `Evaluate feasibility and make funding decision for ${selectedCounty.county_name}`,
      `Inspect substation capacity & distance in ${selectedCounty.county_name}`,
      `Compare ${selectedCounty.county_name} (${formatRatio(selectedCounty.driver_to_plug_ratio)} EVs/port) against state median`,
    ]
    : [];

  return (
    <div className="card chat-panel-container">
      {/* Active county context, plus the panel's own expand/close controls */}
      <div className="chat-header">
        {selectedCounty ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.78rem' }}>
            <span style={{ color: '#ffffff' }}>Focus:</span>
            <strong style={{ color: '#ffffff' }}>{selectedCounty.county_name}</strong>
            <BucketBadge bucket={selectedCounty.bucket} />
            <button
              onClick={() => onSelectCounty(null)}
              style={{ border: 'none', background: 'none', color: '#ffffff', cursor: 'pointer', fontSize: '0.75rem', padding: '0 0.2rem' }}
              title="Clear county focus"
            >
              ✕
            </button>
          </div>
        ) : (
          <span style={{ fontSize: '0.78rem', color: '#ffffff' }}>California Statewide Context</span>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          {onToggleExpand && (
            <button
              onClick={onToggleExpand}
              aria-label={chatExpanded ? 'Restore compact chat' : 'Expand chat'}
              title={chatExpanded ? 'Restore compact chat' : 'Expand chat'}
              style={{ border: 'none', background: 'none', color: '#ffffff', cursor: 'pointer', fontSize: '0.9rem', padding: '0 0.2rem' }}
            >
              {chatExpanded ? '↙' : '⛶'}
            </button>
          )}
          {onClose && (
            <button
              onClick={onClose}
              aria-label="Close panel"
              title="Close"
              style={{ border: 'none', background: 'none', color: '#ffffff', cursor: 'pointer', fontSize: '0.85rem', padding: '0 0.2rem' }}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Message Stream */}
      <div className="chat-messages-scroll">
        {messages.map((msg) => {
          const isUser = msg.role === 'user';
          return (
            <div key={msg.id} className={`chat-bubble-row ${isUser ? 'user-row' : 'agent-row'}`}>
              <div className={`chat-bubble ${isUser ? 'user-bubble' : 'agent-bubble'}`}>
                {isUser ? (
                  <div style={{ fontSize: '0.9rem', lineHeight: 1.4 }}>{msg.content}</div>
                ) : (
                  <div>
                    {/* Autonomous Decision Badge */}
                    {msg.decision && (
                      <div style={{ marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          Autonomous Verdict:
                        </span>
                        <BucketBadge bucket={msg.decision} />
                      </div>
                    )}

                    {/* Content */}
                    <div style={{ fontSize: '0.88rem', lineHeight: 1.55 }}>
                      {renderMarkdownLite(msg.content)}
                    </div>

                    {/* Tool Execution Details */}
                    {msg.tool_executions && msg.tool_executions.length > 0 && (
                      <details style={{ marginTop: '0.65rem', fontSize: '0.76rem', color: 'var(--fg-muted)' }}>
                        <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--accent-darker)' }}>
                          ⚙️ Executed {msg.tool_executions.length} MCP Tools &amp; Data Checks
                        </summary>
                        <div style={{ marginTop: '0.35rem', background: 'var(--bg)', padding: '0.5rem', borderRadius: 6 }}>
                          {msg.tool_executions.map((te, idx) => (
                            <div key={idx} style={{ marginBottom: '0.25rem' }}>
                              <code>{te.tool}</code>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}

                    {/* Confidence & Metadata */}
                    {msg.confidence && (
                      <div style={{ marginTop: '0.65rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.75rem', color: 'var(--fg-muted)' }}>
                        <span>Confidence: <strong style={{ color: 'var(--accent-darker)' }}>{msg.confidence}</strong></span>
                        {msg.answered_at && <span>· {new Date(msg.answered_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
                      </div>
                    )}

                    {msg.provider && (
                      <div style={{ marginTop: '0.4rem', fontSize: '0.75rem', color: 'var(--fg-muted)' }}>
                        Answered by <strong>{formatProvider(msg.provider)}</strong>
                        {msg.fallback_used && msg.fallback_reason ? ` · ${msg.fallback_reason}` : ''}
                      </div>
                    )}

                    {msg.context_scope && (
                      <div style={{ marginTop: '0.3rem', fontSize: '0.72rem', color: 'var(--fg-muted)' }}>
                        Context: {msg.context_scope.state}
                        {msg.context_scope.county ? ` · ${msg.context_scope.county}` : ''}
                        {` · ${msg.context_scope.history_messages} prior messages · ${msg.context_scope.mireye_fields} Mireye fields`}
                      </div>
                    )}

                    {msg.token_usage?.total > 0 && (
                      <div style={{ marginTop: '0.2rem', fontSize: '0.72rem', color: 'var(--fg-muted)' }}>
                        Groq tokens: {msg.token_usage.total.toLocaleString()}
                      </div>
                    )}

                    {msg.data_gaps && msg.data_gaps.length > 0 && (
                      <div style={{ marginTop: '0.4rem', fontSize: '0.75rem', color: 'var(--warn-dark)', background: 'var(--warn-light)', padding: '0.3rem 0.5rem', borderRadius: 4 }}>
                        <strong>Data note:</strong> {summarizeDataGaps(msg.data_gaps)}
                      </div>
                    )}

                    {/* Clickable Interactive Citations */}
                    {msg.citations && msg.citations.length > 0 && (
                      <div style={{ marginTop: '0.85rem', borderTop: '1px solid var(--card-border)', paddingTop: '0.6rem' }}>
                        <div style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.4rem' }}>
                          Cited Physical Data Sources (Click to inspect):
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                          {msg.citations.map((c, i) => (
                            <CitationChip key={i} citation={c} />
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Followup Question Pills */}
                    {msg.followups && msg.followups.length > 0 && (
                      <div style={{ marginTop: '0.75rem', display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                        {msg.followups.map((f, i) => (
                          <button
                            key={i}
                            onClick={() => sendQuery(f)}
                            disabled={loading}
                            className="chat-followup-pill"
                          >
                            {f} →
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {loading && (
          <div className="chat-bubble-row agent-row">
            <div className="chat-bubble agent-bubble" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: 'var(--accent-darker)', fontSize: '0.85rem' }}>
              <div className="loading-spinner" />
              <span>Agent is executing physical grid tools &amp; evaluating feasibility...</span>
            </div>
          </div>
        )}

        {error && (
          <div style={{ background: 'var(--danger-light)', border: '1px solid var(--danger)', color: 'var(--danger)', padding: '0.6rem 0.8rem', borderRadius: 8, fontSize: '0.85rem', margin: '0.5rem 0' }}>
            {error}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Suggested Quick Prompts */}
      {dynamicPrompts.length > 0 && (
        <div className="chat-quick-prompts">
          <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--fg-muted)', marginBottom: '0.35rem' }}>
            Suggested actions:
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
            {dynamicPrompts.slice(0, 3).map((prompt, idx) => (
              <button
                key={idx}
                onClick={() => sendQuery(prompt)}
                disabled={loading}
                className="chat-prompt-pill"
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input Box */}
      <div className="chat-input-area">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={selectedCounty ? `Ask agent to evaluate or decide for ${selectedCounty.county_name}...` : "Ask agent to evaluate any county, grid constraint, or decision..."}
          rows={2}
          disabled={loading}
          className="chat-textarea"
        />
        <button
          onClick={() => sendQuery()}
          disabled={loading || !input.trim()}
          className="chat-send-button"
        >
          {loading ? '...' : 'Ask Agent'}
        </button>
      </div>
    </div>
  );
}
