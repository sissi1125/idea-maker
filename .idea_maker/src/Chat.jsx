// Main chat screen. Holds preset questions, input, agent thinking, result, feedback.
// State machine: idle -> running -> done

const chatStyles = {
  page: { flex:1, height:"100%", overflow:"auto", padding:"0", background:"var(--bg)" },
  inner:{ maxWidth:980, margin:"0 auto", padding:"24px 28px 96px" },
  h:    { fontFamily:"'Noto Sans SC', sans-serif", fontSize:22, fontWeight:600,
          letterSpacing:"-.01em", color:"var(--ink)", marginBottom:4 },
  sub:  { fontSize:13, color:"var(--ink-3)", marginBottom:18 },
  sectionH:{ fontSize:11.5, fontWeight:600, letterSpacing:".08em", textTransform:"uppercase",
             color:"var(--ink-3)", margin:"22px 0 10px", display:"flex",alignItems:"center", gap:8 },
};

function ProjectInfoCards({ onUse }) {
  const Card = ({ kind, data, accent }) => (
    <div className="card" style={{
      padding:"16px 18px",
      borderColor: accent ? "rgba(79,168,154,.25)" : "var(--line)",
      background: accent ? "linear-gradient(180deg, rgba(79,168,154,.05), #fff 40%)" : "#fff",
      flex:1, minWidth:0,
      display:"flex",flexDirection:"column",gap:10,
    }}>
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        <span style={{
          width:24,height:24,borderRadius:6,
          background: accent ? "var(--brand-soft)" : "rgba(180,83,9,.1)",
          color: accent ? "var(--brand)" : "var(--tool)",
          display:"flex",alignItems:"center",justifyContent:"center",
        }}>
          {accent ? <IconFile size={13} stroke={1.8} /> : <IconLayers size={13} stroke={1.8} />}
        </span>
        <div style={{fontSize:13.5, fontWeight:600, color:"var(--ink)"}}>{data.title}</div>
        <span className="chip" style={{
          background: accent ? "var(--brand-soft)" : "rgba(224,140,90,.1)",
          color: accent ? "var(--brand)" : "var(--tool)", fontSize:10.5,
        }}>
          <IconSparkle size={10} stroke={2} /> Agent 自动生成
        </span>
      </div>
      <div style={{fontSize:13, lineHeight:1.65, color:"var(--ink-2)"}}>{data.body}</div>
      <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
        {data.chips.map((c,i) => (
          <span key={i} className="chip" style={{background:"rgba(11,17,32,.04)"}}>{c}</span>
        ))}
      </div>
      <div style={{display:"flex",gap:6, marginTop:2}}>
        <button className="btn btn-sm"><IconEdit size={11} stroke={1.8} /> 编辑</button>
        <button className="btn btn-sm btn-ghost"><IconRefresh size={11} stroke={1.8} /> 刷新</button>
      </div>
    </div>
  );

  return (
    <div style={{display:"flex", gap:14}}>
      <Card kind="intro" data={PROJECT_CARDS.intro}   accent={true} />
      <Card kind="compete" data={PROJECT_CARDS.compete} />
    </div>
  );
}

function PresetGrid({ onPick }) {
  return (
    <div style={{
      display:"flex", gap:6, overflowX:"auto", paddingBottom:2,
      scrollbarWidth:"none",
    }} className="no-scroll">
      {PRESET_QUESTIONS.map(q => (
        <button key={q.id}
          onClick={() => onPick(q)}
          title={q.hint}
          style={{
            flex:"none", padding:"7px 12px",
            border:"1px solid var(--line)", borderRadius:999,
            background:"#fff", cursor:"pointer", transition:".15s",
            display:"inline-flex", gap:7, alignItems:"center",
            fontSize:12.5, fontWeight:500, color:"var(--ink-2)",
            whiteSpace:"nowrap",
          }}
          onMouseEnter={(e)=>{
            e.currentTarget.style.borderColor="var(--brand)";
            e.currentTarget.style.color="var(--brand)";
            e.currentTarget.style.background="var(--brand-soft)";
          }}
          onMouseLeave={(e)=>{
            e.currentTarget.style.borderColor="var(--line)";
            e.currentTarget.style.color="var(--ink-2)";
            e.currentTarget.style.background="#fff";
          }}
        >
          <span style={{fontSize:14, lineHeight:1}}>{q.icon}</span>
          <span>{q.title}</span>
        </button>
      ))}
      <button style={{
        flex:"none", padding:"7px 12px",
        border:"1px dashed var(--line-strong)", borderRadius:999,
        background:"transparent", cursor:"pointer", color:"var(--ink-3)",
        display:"inline-flex", alignItems:"center", gap:6, fontSize:12.5, fontWeight:500,
        whiteSpace:"nowrap",
      }}>
        <IconPlus size={12} stroke={2} /> 自定义
      </button>
    </div>
  );
}

function ChatInput({ value, setValue, onSend, disabled }) {
  return (
    <div className="card" style={{
      padding:"12px 12px 10px", boxShadow:"var(--shadow-md)",
      borderColor: "var(--line-strong)",
    }}>
      <textarea
        placeholder="你的需求或进一步优化…（如：把语气改得更俏皮一点、强化「续航」卖点）"
        value={value}
        onChange={(e)=>setValue(e.target.value)}
        onKeyDown={(e)=>{
          if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { onSend(); }
        }}
        rows={3}
        style={{
          width:"100%", border:"none", outline:"none", resize:"none",
          fontSize:14, lineHeight:1.55, background:"transparent", padding:"4px 6px",
          color:"var(--ink)",
          fontFamily:"inherit",
        }}
      />
      <div style={{
        display:"flex",alignItems:"center",gap:6, padding:"4px 4px 0",
        borderTop:"1px solid var(--line-2)", paddingTop:8,
      }}>
        <button className="btn btn-sm btn-ghost"><IconPaperclip size={13} stroke={1.8} /> 附件</button>
        <button className="btn btn-sm btn-ghost"><IconMic size={13} stroke={1.8} /> 语音</button>
        <span style={{flex:1}} />
        <span style={{fontSize:11.5, color:"var(--ink-4)", marginRight:6}}>
          按 <span className="kbd">Ctrl</span> <span className="kbd">↵</span> 发送
        </span>
        <button className="btn btn-sm btn-primary"
                onClick={onSend}
                disabled={disabled || !value.trim()}
                style={{opacity:(disabled || !value.trim())?.5:1}}>
          发送 <IconSend size={12} stroke={2} />
        </button>
      </div>
    </div>
  );
}

function StarRating({ value, onChange, size=16 }) {
  return (
    <div style={{display:"inline-flex",gap:2}}>
      {[1,2,3,4,5].map(i => (
        <button key={i} onClick={()=>onChange(i)}
          style={{
            border:"none",background:"transparent",cursor:"pointer",padding:2,
            color: i<=value ? "#E5A636" : "rgba(11,17,32,.18)",
            display:"flex",alignItems:"center",
          }}>
          <IconStar size={size} stroke={1.6} fill={i<=value ? "#E5A636" : "none"} />
        </button>
      ))}
    </div>
  );
}

function NoteCard({ note, idx }) {
  const [rating, setRating]   = React.useState(note.rating);
  const [vote, setVote]       = React.useState(null);
  const [expanded, setExpanded] = React.useState(idx === 0); // first note expanded by default
  const [editing, setEditing] = React.useState(false);
  const [body, setBody]       = React.useState(note.body);
  const [saved, setSaved]     = React.useState(false);
  const [justSaved, setJustSaved] = React.useState(false);

  const toggleSave = () => {
    if (saved) { setSaved(false); return; }
    setSaved(true); setJustSaved(true);
    setTimeout(()=>setJustSaved(false), 1800);
  };

  return (
    <div className="card fade-up" style={{
      animationDelay:`${idx*0.07}s`, animationFillMode:"both",
      padding:0, overflow:"hidden", boxShadow:"var(--shadow-sm)",
    }}>
      {/* Header — selling point */}
      <div style={{
        display:"flex", alignItems:"center", gap:11, padding:"13px 16px",
        background:"linear-gradient(180deg, #FBF9F2, #fff)",
        borderBottom: expanded ? "1px solid var(--line-2)" : "1px solid transparent",
        cursor:"pointer",
      }} onClick={()=>setExpanded(v=>!v)}>
        <span className="mono" style={{
          flex:"none", width:24, height:24, borderRadius:"50%",
          background:"#fff", border:"1px solid rgba(214,180,80,.3)",
          color:"var(--gen)", fontWeight:700, fontSize:11.5,
          display:"flex", alignItems:"center", justifyContent:"center",
        }}>{idx+1}</span>
        <span className="chip" style={{
          background:"#fff", color:"var(--gen)",
          border:"1px solid rgba(214,180,80,.25)", fontWeight:600,
        }}>{note.tag}</span>
        <span style={{flex:1, fontSize:13.5, fontWeight:600, color:"var(--ink)"}}>
          {note.angle}
        </span>
        <span className="mono" style={{fontSize:11, color:"var(--ink-4)"}}>
          {note.stats.tokens} tokens · {(note.stats.ms/1000).toFixed(1)}s
        </span>
        {saved && (
          <span className="chip fade-in" style={{
            background:"rgba(31,138,91,.1)", color:"var(--ok)",
            border:"1px solid rgba(31,138,91,.25)", fontWeight:600,
          }}>
            <IconCheck size={10} stroke={2.6} /> 已入库
          </span>
        )}
        <span style={{display:"inline-flex", gap:1}}>
          {[1,2,3,4,5].map(i => (
            <IconStar key={i} size={11} stroke={1.4}
              fill={i<=rating?"#E5A636":"none"}
              style={{color: i<=rating?"#E5A636":"rgba(11,17,32,.18)"}} />
          ))}
        </span>
        <span style={{color:"var(--ink-3)"}}>
          {expanded ? <IconUp size={14} stroke={2} /> : <IconDown size={14} stroke={2} />}
        </span>
      </div>

      {expanded && (
        <div className="fade-in" style={{padding:"14px 16px 16px"}}>
          {/* Body */}
          <div style={{
            fontSize:11.5, fontWeight:600, color:"var(--ink-3)", letterSpacing:".06em",
            textTransform:"uppercase", marginBottom:6, display:"flex", alignItems:"center", gap:6,
          }}>
            📝 笔记正文
            <span style={{flex:1}} />
            <button className="btn btn-sm btn-ghost"
                    onClick={()=>setEditing(v=>!v)}
                    style={{padding:"0 6px", height:22}}>
              <IconEdit size={11} stroke={1.6} />{editing?"完成":"编辑"}
            </button>
            <button className="btn btn-sm btn-ghost" style={{padding:"0 6px", height:22}}>
              <IconCopy size={11} stroke={1.6} /> 复制
            </button>
          </div>
          {editing ? (
            <textarea value={body} onChange={e=>setBody(e.target.value)}
              style={{
                width:"100%", border:"1px solid var(--brand)", borderRadius:8, padding:"10px 12px",
                fontSize:13.5, lineHeight:1.7, resize:"vertical", outline:"none",
                fontFamily:"inherit", minHeight:120, background:"#fff",
              }} />
          ) : (
            <div style={{
              padding:"12px 14px",
              background:"linear-gradient(180deg, #FEFAEF, #fff)",
              border:"1px solid var(--line-2)", borderRadius:9,
              fontSize:13.5, lineHeight:1.75, color:"var(--ink)",
              whiteSpace:"pre-wrap",
            }}>{body}</div>
          )}

          {/* Hashtags */}
          <div style={{display:"flex", gap:5, flexWrap:"wrap", marginTop:10}}>
            {note.hashtags.map(h => (
              <span key={h} className="chip" style={{
                background:"var(--brand-soft)", color:"var(--brand)", fontSize:11,
              }}>{h}</span>
            ))}
          </div>

          {/* Image prompts */}
          <div style={{marginTop:14}}>
            <div style={{
              fontSize:11.5, fontWeight:600, color:"var(--ink-3)", letterSpacing:".06em",
              textTransform:"uppercase", marginBottom:6, display:"flex", alignItems:"center", gap:6,
            }}>
              🎨 配图 prompt · {note.prompts.length} 张
              <span style={{flex:1}} />
              <button className="btn btn-sm btn-ghost" style={{padding:"0 6px", height:22}}>
                <IconRefresh size={11} stroke={1.6} /> 重新生成
              </button>
            </div>
            <div style={{display:"flex", flexDirection:"column", gap:6}}>
              {note.prompts.map((p, i) => (
                <div key={i} style={{
                  display:"flex", gap:10, padding:"10px 12px",
                  background:"#F4F1FB", border:"1px solid rgba(122,90,224,.15)",
                  borderRadius:8,
                }}>
                  {/* Placeholder image swatch */}
                  <div style={{
                    width:54, height:54, flex:"none", borderRadius:6,
                    background:`repeating-linear-gradient(45deg, #E9E3F8 0 6px, #DDD5F2 6px 12px)`,
                    border:"1px solid rgba(122,90,224,.22)",
                    display:"flex", alignItems:"center", justifyContent:"center",
                    color:"#7A5AE0",
                  }}>
                    <IconSparkle size={18} stroke={1.6} />
                  </div>
                  <div style={{flex:1, minWidth:0}}>
                    <div style={{fontSize:10.5, color:"#7A5AE0", fontWeight:600,
                                 marginBottom:3, fontFamily:"'JetBrains Mono', monospace"}}>
                      PROMPT {i+1}
                    </div>
                    <div style={{fontSize:12.5, lineHeight:1.55, color:"var(--ink-2)"}}>{p}</div>
                  </div>
                  <div style={{display:"flex", flexDirection:"column", gap:4}}>
                    <button className="btn btn-sm btn-ghost"
                            style={{padding:"0 6px", height:22, fontSize:11}}>
                      <IconCopy size={10} stroke={1.6} />
                    </button>
                    <button className="btn btn-sm btn-ghost"
                            style={{padding:"0 6px", height:22, fontSize:11}} title="去画图">
                      <IconArrowR size={10} stroke={2} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Sources + per-note feedback */}
          <div style={{
            marginTop:14, paddingTop:12, borderTop:"1px solid var(--line-2)",
            display:"flex", gap:14, flexWrap:"wrap", alignItems:"flex-start",
          }}>
            <div style={{flex:"1 1 240px", minWidth:0}}>
              <div style={{fontSize:11, fontWeight:600, color:"var(--ink-3)",
                           letterSpacing:".06em", textTransform:"uppercase", marginBottom:5}}>
                引用来源
              </div>
              {note.sources.map((s, i) => (
                <div key={i} style={{display:"flex", alignItems:"center", gap:7,
                                     fontSize:12, color:"var(--ink-2)", marginBottom:2}}>
                  <IconFile size={12} stroke={1.6} style={{color:"var(--ink-4)"}} />
                  <span style={{fontWeight:500}}>{s.file}</span>
                  <span style={{color:"var(--ink-4)"}}>· {s.at}</span>
                </div>
              ))}
            </div>
            <div style={{flex:"1 1 280px", minWidth:0}}>
              <div style={{fontSize:11, fontWeight:600, color:"var(--ink-3)",
                           letterSpacing:".06em", textTransform:"uppercase", marginBottom:5}}>
                对这篇笔记打分
              </div>
              <div style={{display:"flex", alignItems:"center", gap:8, flexWrap:"wrap"}}>
                <StarRating value={rating} onChange={setRating} size={15} />
                <button className="btn btn-sm"
                        onClick={()=>setVote(v => v==="up" ? null : "up")}
                        style={{
                          background: vote==="up" ? "rgba(31,138,91,.08)" : "#fff",
                          color:      vote==="up" ? "var(--ok)" : "var(--ink-2)",
                          borderColor:vote==="up" ? "rgba(31,138,91,.3)" : "var(--line-strong)",
                          padding:"0 8px", height:26,
                        }}>
                  <IconThumb size={11} stroke={1.8} />
                </button>
                <button className="btn btn-sm"
                        onClick={()=>setVote(v => v==="down" ? null : "down")}
                        style={{
                          background: vote==="down" ? "rgba(179,38,30,.06)" : "#fff",
                          color:      vote==="down" ? "var(--err)" : "var(--ink-2)",
                          borderColor:vote==="down" ? "rgba(179,38,30,.25)" : "var(--line-strong)",
                          padding:"0 8px", height:26,
                        }}>
                  <IconThumbDn size={11} stroke={1.8} />
                </button>
                <span style={{flex:1}} />
                <button className="btn btn-sm"
                        onClick={toggleSave}
                        style={{
                          background: saved ? "rgba(31,138,91,.08)" : "var(--brand-soft)",
                          color:      saved ? "var(--ok)" : "var(--brand)",
                          borderColor:saved ? "rgba(79,168,138,.3)" : "rgba(79,168,154,.25)",
                          fontWeight:600,
                        }}>
                  {saved
                    ? <><IconCheck size={11} stroke={2.4} /> 已保存到内容资产</>
                    : <><IconBolt size={11} stroke={1.8} /> 保存到内容资产</>}
                </button>
                <button className="btn btn-sm">
                  <IconRefresh size={11} stroke={1.8} /> 单独优化
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function GeneratedResult() {
  const r = GENERATED_RESULT;
  const avgRating = (r.notes.reduce((a,b)=>a+b.rating,0)/r.notes.length).toFixed(1);

  return (
    <div className="card fade-up" style={{padding:"18px 20px", boxShadow:"var(--shadow-md)"}}>
      {/* Result header */}
      <div style={{display:"flex",alignItems:"flex-start",gap:11, marginBottom:14}}>
        <span style={{
          width:26,height:26,borderRadius:7,
          background:"linear-gradient(135deg, #E5C56F, #C9A23E)",
          display:"flex",alignItems:"center",justifyContent:"center", flex:"none",
          boxShadow:"0 4px 10px rgba(201,162,62,.25)",
        }}>
          <IconSparkle size={14} stroke={2} style={{color:"#fff"}} />
        </span>
        <div style={{flex:1}}>
          <div style={{fontSize:15, fontWeight:600, color:"var(--ink)"}}>{r.title}</div>
          <div style={{fontSize:12, color:"var(--ink-3)", marginTop:2}}>{r.subtitle}</div>
        </div>
        <div style={{display:"flex",gap:6}}>
          <button className="btn btn-sm btn-ghost"><IconDownload size={12} stroke={1.8} /> 一键下载</button>
        </div>
      </div>

      {/* Summary stats */}
      <div style={{
        display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:8, marginBottom:14,
      }}>
        {[
          { label:"笔记数",     v:`${r.notes.length}`, sub:"篇",     c:"var(--gen)" },
          { label:"配图 prompt", v:`${r.notes.reduce((a,b)=>a+b.prompts.length,0)}`, sub:"个", c:"#7A5AE0" },
          { label:"平均评分",   v:avgRating,           sub:"★",      c:"#E5A636" },
          { label:"总成本",     v:`$${r.cost.total.toFixed(2)}`, sub:"", c:"var(--ok)" },
        ].map((s,i) => (
          <div key={i} style={{
            padding:"9px 12px", borderRadius:8, background:"#FBF9F2",
            border:"1px solid var(--line-2)",
          }}>
            <div style={{fontSize:10.5, color:"var(--ink-3)", fontWeight:500, marginBottom:2,
                         letterSpacing:".04em", textTransform:"uppercase"}}>{s.label}</div>
            <div className="mono" style={{fontSize:18, fontWeight:700, color:s.c, letterSpacing:"-.02em"}}>
              {s.v}<span style={{fontSize:11, color:"var(--ink-4)", fontWeight:500, marginLeft:3}}>{s.sub}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Per-note cards */}
      <div style={{display:"flex", flexDirection:"column", gap:8}}>
        {r.notes.map((n, i) => <NoteCard key={i} note={n} idx={i} />)}
      </div>

      {/* Cost details (small footer) */}
      <div style={{
        marginTop:14, paddingTop:12, borderTop:"1px solid var(--line-2)",
        display:"flex", gap:12, alignItems:"center", flexWrap:"wrap",
        fontSize:11.5, color:"var(--ink-3)",
      }}>
        <span className="mono">
          💰 Embedding ${r.cost.embed.toFixed(2)} · LLM ${r.cost.llm.toFixed(2)} · in {r.cost.tokensIn} / out {r.cost.tokensOut}
        </span>
        <span style={{flex:1}} />
        <button className="btn btn-sm"><IconRefresh size={12} stroke={1.8} /> 全部重新生成</button>
        <button className="btn btn-sm btn-primary"><IconCheck size={12} stroke={2.2} /> 保存全部反馈</button>
      </div>
    </div>
  );
}

function FeedbackPanel() {
  const [ratings, setRatings] = React.useState({ relevance: 5, style: 4, reliability: 5, representative: 5 });
  const [vote, setVote]       = React.useState(null);
  const [edit, setEdit]       = React.useState("");
  const dims = [
    { key:"relevance",      label:"相关性", hint:"是否切中需求"   },
    { key:"style",          label:"风格",   hint:"语气、长度是否合适"},
    { key:"reliability",    label:"可靠性", hint:"是否有可追溯来源"},
    { key:"representative", label:"代表性", hint:"是否覆盖核心信息"},
  ];
  return (
    <div className="card" style={{padding:"16px 18px"}}>
      <div style={{display:"flex",alignItems:"center",gap:8, marginBottom:12}}>
        <IconBolt size={14} stroke={1.8} style={{color:"var(--brand)"}} />
        <div style={{fontSize:13.5, fontWeight:600}}>你的反馈</div>
        <span className="chip" style={{background:"var(--brand-soft)",color:"var(--brand)"}}>
          Agent 会从你的偏好中学习
        </span>
      </div>

      <div style={{display:"grid", gridTemplateColumns:"repeat(2, 1fr)", gap:"10px 18px",
                   marginBottom:14}}>
        {dims.map(d => (
          <div key={d.key} style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{flex:1, minWidth:0}}>
              <div style={{fontSize:12.5, fontWeight:600, color:"var(--ink)"}}>{d.label}</div>
              <div style={{fontSize:11, color:"var(--ink-4)"}}>{d.hint}</div>
            </div>
            <StarRating value={ratings[d.key]} onChange={(v)=>setRatings({...ratings, [d.key]:v})} />
          </div>
        ))}
      </div>

      <div>
        <div style={{fontSize:12, fontWeight:600, color:"var(--ink-3)", marginBottom:6}}>编辑建议（可选）</div>
        <textarea
          placeholder="可以直接改写文案，Agent 会把你的编辑作为偏好样本，下次自动应用类似风格…"
          value={edit} onChange={e=>setEdit(e.target.value)}
          rows={2}
          style={{
            width:"100%", border:"1px solid var(--line)", borderRadius:8, padding:"9px 11px",
            fontSize:13, lineHeight:1.55, resize:"vertical", outline:"none",
            fontFamily:"inherit",
          }}
        />
      </div>

      <div style={{display:"flex",alignItems:"center",gap:8, marginTop:12}}>
        <button className="btn"
                onClick={()=>setVote("up")}
                style={{
                  background: vote==="up" ? "rgba(31,138,91,.08)" : "#fff",
                  color: vote==="up" ? "var(--ok)" : "var(--ink-2)",
                  borderColor: vote==="up" ? "rgba(31,138,91,.3)" : "var(--line-strong)",
                }}>
          <IconThumb size={13} stroke={1.8} /> 好评
        </button>
        <button className="btn"
                onClick={()=>setVote("down")}
                style={{
                  background: vote==="down" ? "rgba(179,38,30,.06)" : "#fff",
                  color: vote==="down" ? "var(--err)" : "var(--ink-2)",
                  borderColor: vote==="down" ? "rgba(179,38,30,.25)" : "var(--line-strong)",
                }}>
          <IconThumbDn size={13} stroke={1.8} /> 差评
        </button>
        <span style={{flex:1}} />
        <button className="btn"><IconRefresh size={13} stroke={1.8} /> 一键优化</button>
        <button className="btn btn-primary">
          <IconCheck size={13} stroke={2.2} /> 保存反馈
        </button>
      </div>
    </div>
  );
}

function Chat({ project }) {
  const [phase, setPhase]       = React.useState("done"); // idle | running | done
  const [expanded, setExpanded] = React.useState(true);
  const [input, setInput]       = React.useState("");
  const [showPresets, setShowPresets] = React.useState(true);
  const [lastPrompt, setLastPrompt]   = React.useState("生成 5 个卖点及小红书笔记");

  const start = (text) => {
    setLastPrompt(text);
    setPhase("running");
    setExpanded(false);
    setShowPresets(false);
    // Mimic async work
    setTimeout(() => {
      setPhase("done");
      setExpanded(true);
    }, 6200);
  };

  const onSend = () => {
    if (!input.trim()) return;
    start(input.trim());
    setInput("");
  };

  return (
    <main style={chatStyles.page}>
      <div style={chatStyles.inner}>
        {/* Top: title + project context */}
        <div style={{marginBottom:6}}>
          <div style={chatStyles.h}>{project.name}</div>
          <div style={chatStyles.sub}>{project.description}</div>
        </div>

        {/* Auto-generated info cards */}
        <ProjectInfoCards onUse={(kind) => start(kind==="intro" ?
          "基于产品介绍卡片，生成 5 个核心卖点 + 小红书笔记草稿。" :
          "基于竞品分析，写一版强调差异化的微博文案。")} />

        {/* Conversation thread — user prompt */}
        <div style={{marginTop:24, display:"flex", gap:12, alignItems:"flex-start"}}>
          <div style={{
            width:30,height:30,borderRadius:"50%", flex:"none",
            background:"linear-gradient(135deg, #F0BC8B, #DA8A4A)", color:"#fff",
            display:"flex",alignItems:"center",justifyContent:"center",fontWeight:600, fontSize:11.5,
            fontFamily:"'Inter Tight', sans-serif",
          }}>YQ</div>
          <div style={{flex:1, paddingTop:4}}>
            <div style={{fontSize:11.5, color:"var(--ink-3)", marginBottom:4}}>叶清 · 刚刚</div>
            <div className="card" style={{
              display:"inline-block", padding:"10px 14px", maxWidth:"100%",
              background:"var(--brand-soft)", borderColor:"rgba(79,168,154,.22)",
              fontSize:13.5, lineHeight:1.55, color:"var(--ink)",
            }}>{lastPrompt}</div>
          </div>
        </div>

        {/* Agent panel + result */}
        <div style={{marginTop:14, display:"flex", gap:12, alignItems:"flex-start"}}>
          <div style={{
            width:30,height:30,borderRadius:"50%", flex:"none",
            background:"linear-gradient(135deg, #6BBFAF 0%, #3D8C7F 100%)", color:"#fff",
            display:"flex",alignItems:"center",justifyContent:"center", fontSize:14, fontWeight:700,
            fontFamily:"'Inter Tight', sans-serif",
            boxShadow:"0 4px 10px rgba(79,168,154,.32)",
          }}>H</div>
          <div style={{flex:1, minWidth:0, display:"flex", flexDirection:"column", gap:14}}>
            <div style={{fontSize:11.5, color:"var(--ink-3)"}}>
              Harness Agent · {phase==="running" ? "思考中…" : "回复"}
            </div>
            <AgentThinking running={phase==="running"} finished={phase==="done"}
                           expanded={expanded} setExpanded={setExpanded} />
            {phase==="done" && (
              <GeneratedResult />
            )}
          </div>
        </div>
      </div>

      {/* Sticky composer */}
      <div style={{
        position:"sticky", bottom:0, background:"linear-gradient(180deg, rgba(247,246,242,0), var(--bg) 35%)",
        padding:"24px 28px 18px", marginTop:-24,
      }}>
        <div style={{maxWidth:980, margin:"0 auto"}}>
          {/* Preset section — placed directly above the composer */}
          <div style={{
            display:"flex", alignItems:"center", justifyContent:"space-between",
            margin:"0 2px 10px",
          }}>
            <div style={{
              fontSize:11.5, fontWeight:600, letterSpacing:".08em", textTransform:"uppercase",
              color:"var(--ink-3)", display:"flex", alignItems:"center", gap:8,
            }}>
              📋 快速开始 — 预设问题
            </div>
            <button className="btn btn-sm btn-ghost" onClick={()=>setShowPresets(s=>!s)}>
              {showPresets ? <IconDown size={12} stroke={2}/> : <IconUp size={12} stroke={2}/>}
              {showPresets ? "收起" : "展开"}
            </button>
          </div>
          {showPresets && (
            <div style={{marginBottom:12}}>
              <PresetGrid onPick={(q)=>start(q.title)} />
            </div>
          )}
          <ChatInput value={input} setValue={setInput} onSend={onSend} disabled={phase==="running"} />
        </div>
      </div>
    </main>
  );
}

Object.assign(window, { Chat });
