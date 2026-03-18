/**
 * AgentTerminal - Interactive terminal card for a single CLI Claude agent
 */

import React, { useState, useEffect, useRef } from 'react';
import { Agent } from '../../services/swarm/types';
import './AgentTerminal.css';

interface AgentTerminalProps {
  agent: Agent;
  theme: 'light' | 'dark';
  onKill: (agentId: string) => void;
  onSendInput: (agentId: string, data: string) => void;
  expanded: boolean;
  onToggleExpand: (agentId: string) => void;
}

export const AgentTerminal: React.FC<AgentTerminalProps> = ({
  agent,
  theme,
  onKill,
  onSendInput,
  expanded,
  onToggleExpand,
}) => {
  const [inputValue, setInputValue] = useState('');
  const terminalRef = useRef<HTMLDivElement>(null);
  const displayName = agent.label || agent.role.name;
  const outputLines = agent.outputBuffer
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const taskSummary = (() => {
    const lines = agent.assignedTask
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const assignedLine = lines.find((line) => line.startsWith('Your assigned task:'));
    if (assignedLine) {
      return assignedLine.replace(/^Your assigned task:\s*/, '');
    }
    return lines[0] || agent.assignedTask;
  })();
  const ownershipSummary = agent.ownedFiles && agent.ownedFiles.length > 0
    ? `Owns ${agent.ownedFiles.slice(0, 3).join(', ')}${agent.ownedFiles.length > 3 ? '…' : ''}`
    : null;

  // Auto-scroll to bottom when output changes
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [agent.outputBuffer.length]);

  const getStatusColor = () => {
    switch (agent.status) {
      case 'running': return '#10B981';
      case 'waiting_for_input':
      case 'waiting_for_approval': return '#F59E0B';
      case 'completed': return '#3B82F6';
      case 'failed':
      case 'terminated': return '#EF4444';
      default: return '#6B7280';
    }
  };

  const getStatusText = () => {
    switch (agent.status) {
      case 'running': return 'RUNNING';
      case 'waiting_for_input': return 'WAITING';
      case 'waiting_for_approval': return 'APPROVAL';
      case 'completed': return 'DONE';
      case 'failed': return 'FAILED';
      case 'terminated': return 'KILLED';
      default: return 'INIT';
    }
  };

  const handleSend = () => {
    const val = inputValue.trim();
    if (!val) return;
    onSendInput(agent.id, val);
    setInputValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
  };

  const isFinished =
    agent.status === 'completed' ||
    agent.status === 'failed' ||
    agent.status === 'terminated';

  return (
    <div className={`agent-terminal ${theme} ${expanded ? 'expanded' : ''} ${isFinished ? 'finished' : ''}`}>
      <div className="terminal-header">
        <div className="terminal-title">
          <div className="status-dot" style={{ backgroundColor: getStatusColor() }} />
          <span className="agent-name">{displayName}</span>
          <span className="status-label" style={{ color: getStatusColor() }}>
            {getStatusText()}
          </span>
        </div>
        <div className="terminal-actions">
          <button
            className="terminal-icon-btn expand-btn"
            onClick={() => onToggleExpand(agent.id)}
            title={expanded ? 'Collapse' : 'Expand'}
          >
            {expanded ? '⊖' : '⊕'}
          </button>
          <button
            className="terminal-icon-btn kill-btn"
            onClick={() => onKill(agent.id)}
            title="Kill agent"
          >
            ×
          </button>
        </div>
      </div>

      <div className="agent-work-block">
        <span className="agent-work-title">Working on</span>
        <div className="agent-work-copy" title={agent.assignedTask}>
          {taskSummary}
        </div>
      </div>
      {ownershipSummary && (
        <div className="agent-ownership-label" title={agent.ownedFiles?.join(', ')}>
          {ownershipSummary}
        </div>
      )}

      {expanded && (
        <div className="terminal-window" ref={terminalRef}>
          {outputLines.length === 0 ? (
            <div className="terminal-line muted">Launching Claude Code for {displayName}...</div>
          ) : (
            agent.outputBuffer.map((line, i) => (
              <div key={i} className="terminal-line">
                {line}
              </div>
            ))
          )}
        </div>
      )}

      {!isFinished && expanded && (
        <div className="terminal-input-row">
          <input
            type="text"
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Send input to agent..."
            className="terminal-input"
          />
          <button
            className="terminal-send-btn"
            onClick={handleSend}
            disabled={!inputValue.trim()}
          >
            →
          </button>
        </div>
      )}
    </div>
  );
};
