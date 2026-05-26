// AgentThinking — the visualization centerpiece.
// Simplified view: 4 phases with animated bars.
// Detailed view: traces, retrieved chunks, tool calls, self-eval.

const STAGE_META = [
  { id:"think",  label:"思考",   color:"var(--think)",  bg:"var(--think-bg)",  emoji:"💭", note:"分析需求 · 拆解步骤" },
  { id:"search", label:"检索",   color:"var(--search)", bg:"var(--search-bg)", emoji:"🔍", note:"知识库语义检索"     },
  { id:"tool",   label:"工具",   color:"var(--tool)",   bg:"var(--tool-bg)",   emoji:"🛠", note:"调用生成 / 评分工具" },
  { id:"gen",    label:"生成",   color:"var(--gen)",    bg:"var(--gen-bg)",    emoji:"✨", note:"写稿 · 自我评估"     },
];

function useStageProgress(running, finished) {
  // progress[0..3] in 0..100. Phases run sequentially.
  const [progress, setProgress] = React.useState(finished ? [100,100,100,100] : [0,0,0,0]);
  React.useEffect(() => {
    if (finished) { setProgress([100,100,100,100]); return; }
    if (!running)  { setProgress([0,0,0,0]); return; }
    setProgress([0,0,0,0]);
    const phaseDurations = [1400, 1600, 1400, 1800]; // ms per phase
    let t0 = performance.now();
    let raf;
    const tick = (now) => {
      const elapsed = now - t0;
      const next = [0,0,0,0];
      let consumed = 0;
      for (let i=0;i<4;i++){
        const d = phaseDurations[i];
        if (elapsed >= consumed + d) next[i] = 100;
        else if (elapsed > consumed) next[i] = Math.round(((elapsed - consumed)/d)*100);
        consumed += d;
      }
      setProgress(next);
      if (next[3] < 100) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running, finished]);
  return progress;
}

function Bar({ value, color }) {
  return (
    <div style={{
      position:"relative", height:6, flex:1, borderRadius:999,
      background:"rgba(11,17,32,.06)", overflow:"hidden",
    }}>
      <div style={{
        position:"absolute", inset:0, width: `${value}%`, background: color,
        borderRadius:999, transition:"width .35s cubic-bezier(.2,.7,.2,1)",
      }} />
      {value > 0 && value < 100 && (
        <div style={{
          position:"absolute", top:0, bottom:0, width:"36%",
          background:"linear-gradient(90deg, transparent, rgba(255,255,255,.6), transparent)",
          animation:"shimmer 1.4s linear infinite",
          mixBlendMode:"overlay",
        }} />
      )}
    </div>
  );
}

function DotPulse() {
  return (
    <span style={{display:"inline-flex",gap:3, alignItems:"center"}}>
      {[0,1,2].map(i => (
        <span key={i} style={{
          width:4,height:4,borderRadius:"50%",background:"currentColor",
          animation:`dot 1.2s ease-in-out ${i*.15}s infinite`,
        }} />
      ))}
    </span>
  );
}

function PhaseRow({ stage, value, currentTextIdx }) {
  const active = value > 0 && value < 100;
  const done = value === 100;
  return (
    <div style={{display:"flex", alignItems:"center", gap:12, padding:"3px 0"}}>
      <div style={{
        display:"flex",alignItems:"center",gap:8, width: 110, flex:"none",
        color: done ? "var(--ink)" : (active ? "var(--ink)" : "var(--ink-3)"),
      }}>
        <StageGlyph stage={stage.id} size={22} />
        <span style={{fontSize:13, fontWeight:600}}>{stage.label}</span>
      </div>
      <Bar value={value} color={stage.color} />
      <div style={{
        width:56, textAlign:"right",
        fontFamily:"'JetBrains Mono', monospace", fontSize:11.5,
        color: done ? stage.color : "var(--ink-3)", fontWeight:600,
        fontVariantNumeric:"tabular-nums",
      }}>
        {done ? (
          <span style={{display:"inline-flex",alignItems:"center",gap:4}}>
            <IconCheck size={11} stroke={2.4} /> 完成
          </span>
        ) : active ? `${value}%` : "0%"}
      </div>
    </div>
  );
}

function ThinkingTraceDetail() {
  const sec = (title, color, content, icon) => (
    <div style={{padding:"14px 0", borderTop:"1px solid var(--line-2)"}}>
      <div style={{display:"flex",alignItems:"center",gap:8, marginBottom:8}}>
        {icon}
        <div style={{fontSize:12.5, fontWeight:600, color}}>{title}</div>
      </div>
      <div>{content}</div>
    </div>
  );

  return (
    <div style={{padding:"4px 18px 14px"}}>
      {sec("思考阶段", "var(--think)",
        <ul style={{margin:0, padding:0, listStyle:"none", display:"flex",flexDirection:"column",gap:5}}>
          {THINKING_TRACE.think.map((t,i) => (
            <li key={i} style={{
              fontSize:13, color:"var(--ink-2)", lineHeight:1.55,
              paddingLeft:14, position:"relative",
            }}>
              <span style={{position:"absolute", left:0, top:7, width:6,height:6, borderRadius:"50%",
                            background:"var(--think)", opacity:.6}}></span>
              「{t}」
            </li>
          ))}
        </ul>,
        <StageGlyph stage="think" />
      )}

      {sec("检索阶段", "var(--search)",
        <div>
          <div style={{fontSize:12, color:"var(--ink-3)", marginBottom:8, display:"flex",alignItems:"center",gap:8}}>
            找到 {THINKING_TRACE.search.chunks.length} 个相关 chunk
            <span className="chip mono" style={{background:"var(--search-bg)", color:"var(--search)"}}>
              整体置信度 {Math.round(THINKING_TRACE.search.overallConf*100)}%
            </span>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {THINKING_TRACE.search.chunks.map(c => (
              <div key={c.id} style={{
                padding:"9px 11px", borderRadius:8, background:"#FAFAF6",
                border:"1px solid var(--line-2)",
              }}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                  <IconFile size={13} stroke={1.6} style={{color:"var(--ink-3)"}} />
                  <span style={{fontSize:12.5, fontWeight:600, color:"var(--ink)"}}>{c.file}</span>
                  <span className="mono" style={{fontSize:11, color:"var(--ink-4)"}}>{c.lines}</span>
                  <span style={{marginLeft:"auto", fontSize:11, color:"var(--search)",
                                fontFamily:"'JetBrains Mono', monospace"}}>
                    {Math.round(c.conf*100)}%
                  </span>
                </div>
                <div style={{fontSize:12.5, color:"var(--ink-2)", lineHeight:1.55}}>{c.preview}</div>
              </div>
            ))}
          </div>
        </div>,
        <StageGlyph stage="search" />
      )}

      {sec("工具调用", "var(--tool)",
        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          {THINKING_TRACE.tools.map((t,i) => (
            <div key={i} className="mono" style={{
              fontSize:12, padding:"9px 11px", borderRadius:8,
              background:"#FBF8F2", border:"1px solid var(--line-2)",
              color:"var(--ink-2)", display:"flex", flexDirection:"column", gap:3,
            }}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{color:"var(--tool)", fontWeight:600}}>→ {t.name}()</span>
                <span style={{marginLeft:"auto", color:"var(--ink-4)"}}>{t.ms} ms</span>
              </div>
              <div style={{color:"var(--ink-3)", fontSize:11.5, paddingLeft:14}}>args = {t.args}</div>
            </div>
          ))}
        </div>,
        <StageGlyph stage="tool" />
      )}

      {sec("自我评估", "var(--gen)",
        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          {THINKING_TRACE.selfEval.map((e,i) => (
            <div key={i} style={{
              display:"flex",alignItems:"flex-start",gap:9, padding:"8px 11px",
              borderRadius:8, background: e.ok ? "rgba(31,138,91,.06)" : "rgba(180,83,9,.08)",
              border: e.ok ? "1px solid rgba(31,138,91,.18)" : "1px solid rgba(180,83,9,.18)",
              fontSize:12.5, color:"var(--ink-2)", lineHeight:1.5,
            }}>
              <span style={{
                marginTop:1, width:16,height:16,borderRadius:"50%", flex:"none",
                display:"flex",alignItems:"center",justifyContent:"center",
                background: e.ok ? "var(--ok)" : "var(--warn)", color:"#fff",
              }}>
                {e.ok ? <IconCheck size={10} stroke={3} /> : <span style={{fontSize:10, fontWeight:700}}>!</span>}
              </span>
              {e.text}
            </div>
          ))}
        </div>,
        <StageGlyph stage="gen" />
      )}
    </div>
  );
}

function AgentThinking({ running, finished, expanded, setExpanded }) {
  const progress = useStageProgress(running, finished);
  const currentIdx = progress.findIndex(p => p < 100);
  const activeStage = currentIdx === -1 ? STAGE_META[3] : STAGE_META[currentIdx];
  const overall = Math.round((progress.reduce((a,b)=>a+b,0))/4);

  return (
    <div className="card fade-in" style={{
      overflow:"hidden", borderColor: running ? "rgba(79,168,154,.4)" : "var(--line)",
      boxShadow: running ? "0 0 0 4px rgba(79,168,154,.08), var(--shadow-md)" : "var(--shadow-sm)",
      transition:"box-shadow .3s, border-color .3s",
    }}>
      {/* Header */}
      <div style={{
        display:"flex",alignItems:"center",gap:12, padding:"12px 16px",
        borderBottom:"1px solid var(--line-2)",
      }}>
        <div style={{position:"relative", width:28, height:28, flex:"none"}}>
          <div style={{
            position:"absolute", inset:0, borderRadius:"50%",
            background: `conic-gradient(${activeStage.color} ${overall*3.6}deg, rgba(11,17,32,.07) 0)`,
          }} />
          <div style={{
            position:"absolute", inset:3, borderRadius:"50%", background:"#fff",
            display:"flex",alignItems:"center",justifyContent:"center",
            fontSize:11, fontWeight:700, color:"var(--ink)",
            fontFamily:"'JetBrains Mono', monospace",
          }}>{overall}</div>
        </div>
        <div style={{flex:1, minWidth:0}}>
          <div style={{fontSize:13.5, fontWeight:600, color:"var(--ink)",
                       display:"flex",alignItems:"center",gap:8}}>
            {running ? <>
              Agent 正在 {activeStage.label}<span style={{color:activeStage.color}}><DotPulse/></span>
            </> : finished ? <>
              <IconCheck size={14} stroke={2.2} style={{color:"var(--ok)"}} />
              思考完成 · 4 / 4 阶段
            </> : "Agent 待命"}
          </div>
          <div style={{fontSize:11.5, color:"var(--ink-3)", marginTop:2}}>
            {running ? activeStage.note :
              finished ? `共耗时 5.8s · 调用 ${THINKING_TRACE.tools.length} 个工具 · 引用 ${THINKING_TRACE.search.chunks.length} 个 chunk` :
              "等待请求"}
          </div>
        </div>
        <button className="btn btn-sm btn-ghost"
                onClick={() => setExpanded(!expanded)}
                disabled={!finished && !running}
                style={{opacity: (running||finished) ? 1 : .4}}>
          {expanded ? <><IconUp size={12} stroke={2} /> 收起详情</> : <><IconDown size={12} stroke={2} /> 展开详情</>}
        </button>
      </div>

      {/* Bars */}
      <div style={{padding:"12px 18px 14px", display:"flex",flexDirection:"column",gap:2}}>
        {STAGE_META.map((s, i) => (
          <PhaseRow key={s.id} stage={s} value={progress[i]} />
        ))}
      </div>

      {/* Detail */}
      {expanded && finished && <ThinkingTraceDetail />}
    </div>
  );
}

Object.assign(window, { AgentThinking, Bar, StageGlyph });
