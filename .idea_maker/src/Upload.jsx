function Upload({ project, setRoute }) {
  const CATEGORIES = [
    { id:"product", label:"产品资料",       hint:"产品手册、规格书、卖点稿", icon:"📦",
      color:"var(--brand)",  bg:"var(--brand-soft)",  border:"rgba(79,168,154,.28)" },
    { id:"compete", label:"竞品资料",       hint:"对标竞品的产品页、评测",   icon:"🎯",
      color:"var(--tool)",   bg:"var(--tool-bg)",     border:"rgba(201,89,29,.22)" },
    { id:"history", label:"历史宣传物料",   hint:"过往优秀文案、获奖案例",   icon:"🗂️",
      color:"var(--gen)",    bg:"var(--gen-bg)",      border:"rgba(214,180,80,.25)" },
  ];

  const [category, setCategory] = React.useState("product");
  const [files, setFiles] = React.useState([
    { name:"product_guide.pdf",       size:"2.3 MB", status:"done",      progress:100, stage:"已索引",  chunks: 42, cat:"product" },
    { name:"spec_sheet_v3.pdf",       size:"1.1 MB", status:"done",      progress:100, stage:"已索引",  chunks: 18, cat:"product" },
    { name:"competitor_info.pdf",     size:"1.8 MB", status:"processing",progress:60,  stage:"Chunking", chunks: 0,  cat:"compete" },
    { name:"jbl_review_summary.docx", size:"320 KB", status:"done",      progress:100, stage:"已索引",  chunks: 12, cat:"compete" },
    { name:"xhs_top10_2024.pdf",      size:"4.2 MB", status:"done",      progress:100, stage:"已索引",  chunks: 67, cat:"history" },
    { name:"brand_guidelines.docx",   size:"540 KB", status:"queued",    progress:0,   stage:"等待中",  chunks: 0,  cat:"history" },
  ]);
  const [drag, setDrag] = React.useState(false);

  // Animate the processing file
  React.useEffect(() => {
    const id = setInterval(() => {
      setFiles(curr => curr.map(f => {
        if (f.status==="processing" && f.progress < 99) {
          const np = Math.min(99, f.progress + 4);
          const stage = np < 30 ? "解析中" : np < 65 ? "Chunking" : np < 90 ? "Embedding" : "建索引";
          return {...f, progress: np, stage};
        }
        return f;
      }));
    }, 600);
    return () => clearInterval(id);
  }, []);

  const StageIcon = ({status}) => {
    if (status==="done") return <span style={{
      width:22,height:22,borderRadius:"50%",background:"var(--ok)",color:"#fff",
      display:"flex",alignItems:"center",justifyContent:"center",
    }}><IconCheck size={12} stroke={2.5} /></span>;
    if (status==="processing") return <span style={{
      width:22,height:22,borderRadius:"50%",
      border:"2.5px solid rgba(79,168,154,.22)", borderTopColor:"var(--brand)",
      animation:"spin .9s linear infinite",
    }} />;
    return <span style={{
      width:22,height:22,borderRadius:"50%",background:"rgba(11,17,32,.06)",
      display:"flex",alignItems:"center",justifyContent:"center", fontSize:11, color:"var(--ink-3)",
    }}>·</span>;
  };

  const active = CATEGORIES.find(c => c.id === category);
  const countByCat = (id) => files.filter(f => f.cat===id).length;

  return (
    <main style={{flex:1, height:"100%", overflow:"auto", background:"var(--bg)"}}>
      <div style={{maxWidth:980, margin:"0 auto", padding:"28px 32px 80px"}}>
        <div style={{marginBottom:18}}>
          <div style={{fontSize:22, fontWeight:600, letterSpacing:"-.01em"}}>📚 知识库 · {project.name}</div>
          <div style={{fontSize:13, color:"var(--ink-3)", marginTop:2}}>
            按 <b>产品资料 / 竞品资料 / 历史宣传物料</b> 三类分别上传 — Agent 会针对不同来源使用不同的检索策略
          </div>
        </div>

        {/* Category tiles */}
        <div style={{display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:10, marginBottom:14}}>
          {CATEGORIES.map(c => {
            const isActive = c.id === category;
            const count = countByCat(c.id);
            return (
              <button key={c.id}
                onClick={()=>setCategory(c.id)}
                style={{
                  textAlign:"left", padding:"14px 14px", borderRadius:11, cursor:"pointer",
                  border: `1px solid ${isActive ? c.color : "var(--line)"}`,
                  background: isActive ? c.bg : "#fff",
                  boxShadow: isActive ? `0 0 0 4px ${c.bg}, 0 6px 14px ${c.bg}` : "var(--shadow-sm)",
                  display:"flex", gap:11, alignItems:"flex-start", transition:".15s",
                }}
              >
                <span style={{
                  width:36, height:36, borderRadius:9, flex:"none",
                  background:"#fff", border:`1px solid ${c.border}`,
                  display:"flex", alignItems:"center", justifyContent:"center", fontSize:18,
                }}>{c.icon}</span>
                <span style={{flex:1, minWidth:0}}>
                  <span style={{
                    display:"flex", alignItems:"center", gap:6, marginBottom:3,
                  }}>
                    <span style={{fontSize:13.5, fontWeight:600, color:"var(--ink)"}}>{c.label}</span>
                    {isActive && <IconCheck size={12} stroke={2.4} style={{color:c.color}} />}
                  </span>
                  <span style={{display:"block", fontSize:11.5, color:"var(--ink-3)", marginBottom:8, lineHeight:1.45}}>
                    {c.hint}
                  </span>
                  <span style={{display:"flex", alignItems:"center", gap:8, fontSize:11}}>
                    <span className="chip mono" style={{background:isActive?"#fff":"rgba(11,17,32,.04)", color:c.color, fontWeight:600}}>
                      {count} 文件
                    </span>
                    <span style={{color:"var(--ink-4)"}}>
                      {files.filter(f=>f.cat===c.id && f.status==="done").reduce((a,b)=>a+b.chunks,0)} chunks
                    </span>
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        {/* Dropzone for active category */}
        <div
          onDragOver={(e)=>{e.preventDefault();setDrag(true);}}
          onDragLeave={()=>setDrag(false)}
          onDrop={(e)=>{e.preventDefault();setDrag(false);}}
          style={{
            padding:"30px 24px", borderRadius:14, textAlign:"center",
            border: `2px dashed ${drag ? active.color : "var(--line-strong)"}`,
            background: drag ? active.bg : "#fff",
            transition:".15s",
          }}>
          <div style={{
            margin:"0 auto 12px", width:50, height:50, borderRadius:13,
            background:active.bg, color:active.color,
            display:"flex",alignItems:"center",justifyContent:"center",
          }}>
            <IconUpload size={24} stroke={1.8} />
          </div>
          <div style={{fontSize:14.5, fontWeight:600, color:"var(--ink)", marginBottom:4}}>
            拖拽 <span style={{color:active.color}}>{active.label}</span> 到此处，或<span style={{color:active.color}}> 点击上传</span>
          </div>
          <div style={{fontSize:12, color:"var(--ink-3)"}}>
            支持 PDF、DOCX、TXT、Markdown · 单文件最大 50 MB
          </div>
          <div style={{display:"flex",justifyContent:"center",gap:14, marginTop:14, fontSize:11.5, color:"var(--ink-4)"}}>
            {["PDF","DOCX","TXT","MD"].map(t => (
              <span key={t} className="chip mono" style={{background:"rgba(11,17,32,.04)"}}>{t}</span>
            ))}
          </div>
        </div>

        {/* Currently processing summary */}
        <div className="card" style={{marginTop:14, padding:"14px 16px", display:"flex",alignItems:"center",gap:14}}>
          <div style={{position:"relative", width:38, height:38, flex:"none"}}>
            <div style={{
              position:"absolute", inset:0, borderRadius:"50%",
              background:`conic-gradient(var(--brand) ${60*3.6}deg, rgba(11,17,32,.07) 0)`,
            }} />
            <div style={{position:"absolute", inset:4, borderRadius:"50%", background:"#fff",
                         display:"flex",alignItems:"center",justifyContent:"center",
                         fontSize:11, fontWeight:700}} className="mono">60</div>
          </div>
          <div style={{flex:1}}>
            <div style={{fontSize:13.5, fontWeight:600}}>正在处理 1 个文件 · Chunking 阶段</div>
            <div style={{fontSize:11.5, color:"var(--ink-3)", marginTop:2}}>
              预计还需 38 秒 · 完成后将自动生成 <b>产品介绍</b> 与 <b>竞品分析</b> 卡片
            </div>
          </div>
          <button className="btn btn-sm">查看处理日志</button>
        </div>

        {/* File list grouped by category */}
        <div style={{marginTop:18}}>
          {CATEGORIES.map(c => {
            const list = files.filter(f => f.cat === c.id);
            if (list.length === 0) return null;
            return (
              <div key={c.id} style={{marginBottom:14}}>
                <div style={{
                  display:"flex", alignItems:"center", gap:10, marginBottom:8,
                  fontSize:11.5, fontWeight:600, color:c.color,
                  letterSpacing:".06em", textTransform:"uppercase",
                }}>
                  <span style={{fontSize:13}}>{c.icon}</span>
                  <span>{c.label}</span>
                  <div style={{flex:1, height:1, background:"var(--line-2)"}} />
                  <span className="mono" style={{color:"var(--ink-4)", textTransform:"none", letterSpacing:0}}>
                    {list.length} 个文件
                  </span>
                </div>
                <div className="card" style={{padding:0, overflow:"hidden"}}>
                  {list.map((f, i) => (
                    <div key={f.name} style={{
                      display:"flex",alignItems:"center", gap:12, padding:"12px 16px",
                      borderTop: i===0 ? "none" : "1px solid var(--line-2)",
                    }}>
                      <span style={{
                        width:34,height:34,borderRadius:8,
                        background:f.name.endsWith(".pdf")?"#FBE9DC":(f.name.endsWith(".docx")?"var(--brand-soft)":"#F2F1EA"),
                        color:f.name.endsWith(".pdf")?"var(--tool)":(f.name.endsWith(".docx")?"var(--brand)":"var(--ink-3)"),
                        display:"flex",alignItems:"center",justifyContent:"center", flex:"none", fontSize:11, fontWeight:700,
                        fontFamily:"'JetBrains Mono', monospace",
                      }}>
                        {f.name.split(".").pop().toUpperCase()}
                      </span>
                      <div style={{flex:1, minWidth:0}}>
                        <div style={{display:"flex",alignItems:"baseline",gap:8}}>
                          <div style={{fontSize:13.5, fontWeight:600, overflow:"hidden",
                                       textOverflow:"ellipsis", whiteSpace:"nowrap"}}>{f.name}</div>
                          <div style={{fontSize:11, color:"var(--ink-4)"}} className="mono">{f.size}</div>
                        </div>
                        {f.status==="processing" ? (
                          <div style={{display:"flex",alignItems:"center", gap:10, marginTop:6}}>
                            <Bar value={f.progress} color={c.color} />
                            <span className="mono" style={{fontSize:11, color:c.color, fontWeight:600, minWidth:64, textAlign:"right"}}>
                              {f.progress}% · {f.stage}
                            </span>
                          </div>
                        ) : (
                          <div style={{fontSize:11.5, color:"var(--ink-3)", marginTop:3}}>
                            {f.status==="done"
                              ? <>✓ 已索引 · 切分为 <b className="mono">{f.chunks}</b> 个 chunk · 平均置信度 <span className="mono">92%</span></>
                              : "等待上一个文件处理完成…"
                            }
                          </div>
                        )}
                      </div>
                      <StageIcon status={f.status} />
                      <button className="btn btn-sm btn-ghost"><IconDots size={14} /></button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <div style={{marginTop:18, display:"flex", gap:8}}>
          <button className="btn btn-primary" onClick={()=>setRoute("chat")}>
            完成，去对话 <IconArrowR size={12} stroke={2.2} />
          </button>
          <button className="btn">查看 chunk 详情</button>
        </div>
      </div>
    </main>
  );
}

Object.assign(window, { Upload });
