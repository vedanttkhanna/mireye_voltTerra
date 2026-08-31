import { useState, useRef, useEffect } from 'react';
import { renderMarkdownLite } from '../utils/markdownLite.jsx';
import CitationChip from './CitationChip.jsx';
import BucketBadge from './BucketBadge.jsx';
import ToolExecutionList from './ToolExecutionList.jsx';
import { readJsonResponse } from '../utils/http.js';

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

/**
 * Pulls anything map-renderable out of a completed agent turn: named
 * substations and a labor-shed origin. Returns null when the turn produced
 * nothing plottable, so an ordinary answer leaves the existing map layer alone
 * rather than clearing it.
 */
function extractMapFindings(toolExecutions = []) {
  const substations = [];
  let laborShed = null;

  for (const te of toolExecutions) {
    const r = te.result;
    if (!r || r.error) continue;

    if (te.tool === 'find_nearest_substations') {
      const strongestName = r.highest_voltage_nearby?.name;
      for (const c of r.candidates ?? []) {
        if (c.lat == null || c.lng == null) continue;
        substations.push({ ...c, isStrongest: c.name === strongestName });
      }
    }

    if (te.tool === 'get_labor_shed' && !r.quote_only && r.population_within_shed != null) {
      laborShed = {
        lat: Number(te.args?.lat),
        lng: Number(te.args?.lng),
        minutes: r.minutes,
        population: r.population_within_shed,
        labor_force: r.civilian_labor_force_within_shed,
      };
      if (!Number.isFinite(laborShed.lat) || !Number.isFinite(laborShed.lng)) laborShed = null;
    }
  }

  if (!substations.length && !laborShed) return null;
  return { substations, laborShed };
}

export default function ChatPanel({ selectedCounty, onSelectCounty, chatExpanded, onToggleExpand, onClose, onAgentFindings }) {
  const [messages, setMessages] = useState([
    {
      id: 'welcome',
      role: 'assistant',
      content:
        'Hello! I can evaluate counties for EV charging funding using Mireye physical grid tools and state DMV/DOE infrastructure models.\n\nAsk me about any county or location, and I will inspect real physical constraints and formulate justifiable funding decisions.',
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

      const data = await readJsonResponse(res, 'POST /api/chat');

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
        credits_spent: data.credits_spent,
        credit_budget: data.credit_budget,
        provider: data.provider,
        fallback_used: data.fallback_used,
        fallback_reason: data.fallback_reason,
        context_scope: data.context_scope,
        token_usage: data.token_usage,
        followups: data.suggested_followups,
      };

      setMessages((prev) => [...prev, agentMessage]);

      const findings = extractMapFindings(data.tool_executions);
      if (findings && onAgentFindings) onAgentFindings(findings);

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
          <span style={{ fontSize: '0.78rem', color: '#ffffff' }}>Statewide Context</span>
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
                    <ToolExecutionList
                      executions={msg.tool_executions}
                      creditsSpent={msg.credits_spent}
                    />

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

                    {msg.credits_spent > 0 && (
                      <div style={{ marginTop: '0.4rem', fontSize: '0.75rem' }}>
                        <span style={{ background: 'var(--accent-light)', border: '1px solid var(--accent-border)', color: 'var(--accent-darker)', padding: '0.15rem 0.45rem', borderRadius: 999, fontWeight: 600 }}>
                          ⚡ Live evidence: {msg.credits_spent} Mireye credits spent
                        </span>
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
