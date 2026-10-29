import { setAiChoice, useAi } from '../data/ai';

/** Provider + model selector (Gemini, ChatGPT…), shown before running an AI edit. */
export function AiPicker() {
  const { list, choice, provider } = useAi();
  if (!list) return <p className="hint">Checking which AI is set up…</p>;
  if (!list.length) return <p className="hint">No AI is set up on the server yet. Add GEMINI_API_KEY or OPENAI_API_KEY to the server’s .env (see README).</p>;
  return (
    <div className="aipick">
      <div className="field">
        <label htmlFor="ai-provider">AI</label>
        <select id="ai-provider" value={choice?.provider} onChange={(e) => { const p = list.find((x) => x.id === e.target.value)!; setAiChoice({ provider: p.id, model: p.defaultModel }); }}>
          {list.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="ai-model">Model</label>
        <select id="ai-model" value={choice?.model} onChange={(e) => setAiChoice({ provider: choice!.provider, model: e.target.value })}>
          {provider?.models.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
      {provider && <p className="hint" style={{ gridColumn: '1 / -1', margin: '-6px 0 8px' }}>Connected with {provider.mode}. The key stays on the server.</p>}
    </div>
  );
}
