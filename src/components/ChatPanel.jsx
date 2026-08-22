import { useState, useRef, useEffect } from 'react';
import { renderMarkdownLite } from '../utils/markdownLite.jsx';
import CitationChip from './CitationChip.jsx';
import BucketBadge from './BucketBadge.jsx';
import { formatRatio } from '../utils/format.js';

const INITIAL_PROMPTS = [
  'Decide if Sutter County should fund chargers or grid upgrades',
  'What are the electrical substation constraints in Riverside County?',
  'Analyze Contra Costa EV infrastructure deficit and grid proximity',
  'Which California counties have the highest charging stress?',
];

export default function ChatPanel({ selectedCounty, onSelectCounty }) {
  const [messages, setMessages] = useState([
    {
      id: 'welcome',
      role: 'assistant',
      content:
        'Hello! I am your **Autonomous Feasibility Agent**, powered by Mireye physical grid tools and California DMV/DOE infrastructure models.\n\nAsk me to evaluate any county or location, and I will inspect real physical constraints and formulate justifiable funding decisions.',
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

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: textToSend.trim(),
          county_fips: selectedCounty?.county_fips,
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
    : INITIAL_PROMPTS;

  return (
    <div className="card chat-panel-container">
      {/* Header with Active Context */}
      <div className="chat-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--accent)', boxShadow: '0 0 8px var(--accent)' }} />
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--fg)' }}>
            Autonomous Feasibility Agent
          </h3>
          <span style={{ fontSize: '0.72rem', background: 'var(--accent-light)', color: 'var(--accent-darker)', padding: '0.1rem 0.45rem', borderRadius: 999, fontWeight: 600, border: '1px solid var(--accent-border)' }}>
            MCP Tools &amp; Mireye
          </span>
        </div>

        {selectedCounty ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.78rem' }}>
            <span style={{ color: 'var(--fg-muted)' }}>Focus:</span>
            <strong style={{ color: 'var(--accent-darker)' }}>{selectedCounty.county_name}</strong>
            <BucketBadge bucket={selectedCounty.bucket} />
            <button
              onClick={() => onSelectCounty(null)}
              style={{ border: 'none', background: 'none', color: 'var(--fg-muted)', cursor: 'pointer', fontSize: '0.75rem', padding: '0 0.2rem' }}
              title="Clear county focus"
            >
              ✕
            </button>
          </div>
        ) : (
          <span style={{ fontSize: '0.78rem', color: 'var(--fg-muted)' }}>California Statewide Context</span>
        )}
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

                    {msg.data_gaps && msg.data_gaps.length > 0 && (
                      <div style={{ marginTop: '0.4rem', fontSize: '0.75rem', color: 'var(--warn-dark)', background: 'var(--warn-light)', padding: '0.3rem 0.5rem', borderRadius: 4 }}>
                        <strong>Data note:</strong> {msg.data_gaps.join(', ')}
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
