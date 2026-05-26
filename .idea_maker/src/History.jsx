function HistoryDetailModal({ item, onClose }) {
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!item) return null;

  const r = GENERATED_RESULT;
  const stageStats = [
    { stage:"think",  label:"思考",   ms:"1.2s", count:"3 步推理" },
    { stage:"search", label:"检索",   ms:"0.8s", count:"3 个 chunk" },
    { stage:"tool",   label:"工具",   ms:"2.4s", count:"2 次调用"  },
    { stage:"gen",    label:"生成",   ms:"1.4s", count:"1.3k tokens" },
  ];

  return (
    <div
      onClick={onClose}
      style={{
        position:"fixed", inset:0, zIndex:60,
        background:"rgba(11,17,32,.42)",
        backdropFilter:"blur(4px)", WebkitBackdropFilter:"blur(4px)",
        display:"flex", alignItems:"flex-start", justifyContent:"center",
        padding:"4vh 24px", overflowY:"auto",
        animation:"fadeIn .15s ease-out",
      }}
    >
      <div
        onClick={(e)=>e.stopPropagation()}
        className="fade-up"
        style={{
          width:"min(820px, 100%)",
          background:"#fff", borderRadius:14,
          border:"1px solid var(--line)",
          boxShadow:"var(--shadow-lg)",
          overflow:"hidden", display:"flex", flexDirection:"column",
        }}
      >
        {/* Header */}
        <div style={{
          padding:"16px 20px", display:"flex", alignItems:"flex-start", gap:14,
          borderBottom:"1px solid var(--line-2)",
        }}>
          <span style={{
            width:36,height:36,borderRadius:9,
            background:"linear-gradient(135deg, #E5C56F, #C9A23E)",
            display:"flex", alignItems:"center", justifyContent:"center", flex:"none",
            boxShadow:"0 4px 10px rgba(201,162,62,.25)",
          }}>
            <IconSparkle size={16} stroke={2} style={{color:"#fff"}} />
          </span>
          <div style={{flex:1, minWidth:0}}>
            <div style={{fontSize:11.5, color:"var(--ink-4)", marginBottom:3}}>
              {item.date} · {item.time} · <span className="chip" style={{
                background:item.preset?"var(--brand-soft)":"rgba(11,17,32,.05)",
                color:item.preset?"var(--brand)":"var(--ink-3)", fontSize:10.5, marginLeft:4,
              }}>{item.tag}</span>
            </div>
            <div style={{fontSize:16, fontWeight:600, color:"var(--ink)", lineHeight:1.4}}>
              「{item.q}」
            </div>
          </div>
          <button onClick={onClose} className="btn btn-sm btn-ghost"
                  style={{padding:"0 6px", height:28, width:28, justifyContent:"center"}}>
            <IconX size={14} stroke={2} />
          </button>
        </div>

        {/* Stats strip */}
        <div style={{
          display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:1,
          background:"var(--line-2)",
          borderBottom:"1px solid var(--line-2)",
        }}>
          {stageStats.map((s,i) => (
            <div key={i} style={{
              padding:"12px 14px", background:"#fff",
              display:"flex", alignItems:"center", gap:9,
            }}>
              <StageGlyph stage={s.stage} size={26} />
              <div style={{minWidth:0}}>
                <div style={{fontSize:11.5, fontWeight:600, color:"var(--ink-3)"}}>{s.label}</div>
                <div style={{fontSize:11, color:"var(--ink-4)", marginTop:1}} className="mono">
                  {s.ms} · {s.count}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Body */}
        <div style={{padding:"18px 20px", maxHeight:"56vh", overflowY:"auto",
                     display:"flex", flexDirection:"column", gap:16}}>
          <div>
            <div style={{fontSize:11.5, fontWeight:600, color:"var(--ink-3)",
                         letterSpacing:".06em", textTransform:"uppercase", marginBottom:8}}>
              生成内容 · {r.notes.length} 篇笔记
            </div>
            <div style={{display:"flex", flexDirection:"column", gap:8}}>
              {r.notes.map((n, i) => (
                <div key={i} style={{
                  padding:"11px 13px", background:"#FBF9F2",
                  border:"1px solid rgba(214,180,80,.16)", borderRadius:8,
                }}>
                  <div style={{display:"flex", alignItems:"center", gap:8, marginBottom:6}}>
                    <span className="mono" style={{
                      flex:"none", width:20, height:20, borderRadius:"50%",
                      background:"#fff", border:"1px solid rgba(214,180,80,.3)",
                      color:"var(--gen)", fontWeight:700, fontSize:10.5,
                      display:"flex", alignItems:"center", justifyContent:"center",
                    }}>{i+1}</span>
                    <span className="chip" style={{background:"#fff", color:"var(--gen)",
                                                    border:"1px solid rgba(214,180,80,.25)", fontSize:10.5}}>
                      {n.tag}
                    </span>
                    <span style={{fontSize:12.5, fontWeight:600, color:"var(--ink)", flex:1}}>{n.angle}</span>
                    <span style={{display:"inline-flex", gap:1}}>
                      {[1,2,3,4,5].map(s => (
                        <span key={s} style={{color: s<=n.rating?"#E5A636":"rgba(11,17,32,.18)", fontSize:11}}>★</span>
                      ))}
                    </span>
                  </div>
                  <div style={{fontSize:12, lineHeight:1.55, color:"var(--ink-2)", whiteSpace:"pre-wrap",
                               display:"-webkit-box", WebkitLineClamp:3, WebkitBoxOrient:"vertical",
                               overflow:"hidden"}}>
                    {n.body}
                  </div>
                  <div style={{display:"flex", gap:10, marginTop:6, fontSize:10.5, color:"var(--ink-4)"}} className="mono">
                    <span>📝 {n.body.length} 字</span>
                    <span>🎨 {n.prompts.length} 张配图 prompt</span>
                    <span>{n.sources.length} 个引用</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{display:"flex", gap:18, flexWrap:"wrap"}}>
            <div style={{flex:"1 1 220px"}}>
              <div style={{fontSize:11.5, fontWeight:600, color:"var(--ink-3)",
                           letterSpacing:".06em", textTransform:"uppercase", marginBottom:8}}>
                成本与反馈
              </div>
              <div className="mono" style={{display:"grid", gridTemplateColumns:"1fr auto",
                                            rowGap:3, fontSize:12, color:"var(--ink-2)"}}>
                <span>总成本</span>
                <span style={{fontWeight:700, color:"var(--ok)"}}>${item.cost.toFixed(2)}</span>
                <span>编辑次数</span><span>{item.edits} 次</span>
                <span>整体评分</span>
                <span>{[1,2,3,4,5].map(i => (
                  <span key={i} style={{color: i<=item.score?"#E5A636":"rgba(11,17,32,.15)"}}>★</span>
                ))}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer actions */}
        <div style={{
          padding:"12px 16px", display:"flex", gap:8, alignItems:"center",
          borderTop:"1px solid var(--line-2)", background:"#FBFAF6",
        }}>
          <button className="btn btn-sm btn-ghost"><IconCopy size={12} stroke={1.8} /> 复制内容</button>
          <button className="btn btn-sm btn-ghost"><IconDownload size={12} stroke={1.8} /> 下载</button>
          <span style={{flex:1}} />
          <button className="btn btn-sm" onClick={onClose}>关闭</button>
          <button className="btn btn-sm btn-primary">
            <IconRefresh size={12} stroke={2} /> 复用问题
          </button>
        </div>
      </div>
    </div>
  );
}

function NoteLibraryCard({ note, onOpen }) {
  const channelColor = note.channel === "小红书" ? "#D96A85"
                    : note.channel === "微博" ? "#D6A24B"
                    : note.channel === "抖音" ? "#3D4D55" : "var(--ink-3)";
  return (
    <div className="card" onClick={onOpen}
      style={{
        padding:"14px 15px", cursor:"pointer", transition:".15s",
        display:"flex", flexDirection:"column", gap:9,
      }}
      onMouseEnter={(e)=>{e.currentTarget.style.transform="translateY(-2px)";
                          e.currentTarget.style.boxShadow="0 10px 24px rgba(11,17,32,.08)";
                          e.currentTarget.style.borderColor="#B6BFE0";}}
      onMouseLeave={(e)=>{e.currentTarget.style.transform="none";
                          e.currentTarget.style.boxShadow="var(--shadow-sm)";
                          e.currentTarget.style.borderColor="var(--line)";}}
    >
      <div style={{display:"flex", alignItems:"center", gap:7}}>
        <span className="chip" style={{
          background:"#fff", color:"var(--gen)",
          border:"1px solid rgba(214,180,80,.25)", fontWeight:600,
        }}>{note.tag}</span>
        <span className="chip" style={{
          background: `${channelColor}1A`, color: channelColor, fontWeight:600,
        }}>{note.channel}</span>
        <span className="chip" style={{
          background:"rgba(11,17,32,.04)", color:"var(--ink-3)",
        }}>{note.style}</span>
        <span style={{flex:1}} />
        <span style={{display:"inline-flex", gap:1}}>
          {[1,2,3,4,5].map(i => (
            <span key={i} style={{color: i<=note.rating?"#E5A636":"rgba(11,17,32,.18)", fontSize:11}}>★</span>
          ))}
        </span>
      </div>

      <div style={{fontSize:13.5, fontWeight:600, color:"var(--ink)", lineHeight:1.4}}>
        {note.angle}
      </div>

      <div style={{
        fontSize:12.5, color:"var(--ink-2)", lineHeight:1.6,
        display:"-webkit-box", WebkitLineClamp:3, WebkitBoxOrient:"vertical",
        overflow:"hidden", minHeight: 60,
      }}>{note.body}</div>

      <div style={{display:"flex", gap:5, flexWrap:"wrap"}}>
        {note.hashtags.slice(0,2).map(h => (
          <span key={h} className="chip" style={{
            background:"var(--brand-soft)", color:"var(--brand)", fontSize:10.5,
          }}>{h}</span>
        ))}
      </div>

      <div style={{
        display:"flex", alignItems:"center", gap:10, paddingTop:8,
        borderTop:"1px solid var(--line-2)", fontSize:11, color:"var(--ink-3)",
      }}>
        <span style={{display:"inline-flex", alignItems:"center", gap:3}}>
          <IconCopy size={11} stroke={1.6} /> 已用 <b className="mono" style={{color:"var(--ink)"}}>{note.uses}</b> 次
        </span>
        <span className="mono">📝 {note.words} 字</span>
        <span className="mono">🎨 {note.prompts}</span>
        <span style={{flex:1}} />
        <button className="btn btn-sm" onClick={(e)=>{e.stopPropagation();}}
                style={{padding:"0 8px", height:24, fontSize:11.5}}>
          复用 <IconArrowR size={10} stroke={2} />
        </button>
      </div>
    </div>
  );
}

function History({ project }) {
  const [tab, setTab]   = React.useState("library"); // library | log
  const [sort, setSort] = React.useState("date");
  const [q, setQ] = React.useState("");
  const [detail, setDetail] = React.useState(null);
  const [filter, setFilter] = React.useState("全部");

  const filteredNotes = React.useMemo(() => {
    return NOTE_LIBRARY.filter(n => {
      if (filter !== "全部" && n.channel !== filter && n.tag !== filter) return false;
      if (q && !(n.angle.includes(q) || n.body.includes(q) || n.tag.includes(q))) return false;
      return true;
    });
  }, [filter, q]);

  const grouped = React.useMemo(() => {
    const filtered = HISTORY.filter(h => !q || h.q.includes(q));
    const sorted = [...filtered].sort((a,b) => {
      if (sort === "score") return b.score - a.score;
      if (sort === "cost")  return b.cost - a.cost;
      return (b.date+b.time).localeCompare(a.date+a.time);
    });
    const g = {};
    sorted.forEach(h => { (g[h.date] ||= []).push(h); });
    return g;
  }, [sort, q]);

  const filterOptions = ["全部","小红书","微博","抖音","续航","音质","防护","配色"];

  return (
    <main style={{flex:1,height:"100%",overflow:"auto", background:"var(--bg)"}}>
      <div style={{maxWidth:1080, margin:"0 auto", padding:"28px 32px 80px"}}>
        <div style={{marginBottom:14}}>
          <div style={{fontSize:22, fontWeight:600, letterSpacing:"-.01em"}}>
            📚 内容资产 · {project.name}
          </div>
          <div style={{fontSize:13, color:"var(--ink-3)", marginTop:2}}>
            既能查看历史对话，也能浏览可复用的 <b>小红书笔记库</b> · 共 {NOTE_LIBRARY.length} 篇笔记 · {HISTORY.length} 次对话
          </div>
        </div>

        {/* Tabs */}
        <div style={{display:"flex", gap:4, marginBottom:14,
                     borderBottom:"1px solid var(--line-2)"}}>
          {[
            { id:"library", icon:"📝", label:"笔记库",    sub: NOTE_LIBRARY.length },
            { id:"log",     icon:"💬", label:"对话历史",  sub: HISTORY.length      },
          ].map(t => (
            <button key={t.id} onClick={()=>setTab(t.id)}
              style={{
                background:"transparent", border:"none", padding:"10px 14px 11px",
                fontSize:13.5, fontWeight: tab===t.id ? 600 : 500,
                color: tab===t.id ? "var(--ink)" : "var(--ink-3)",
                borderBottom: `2px solid ${tab===t.id ? "var(--brand)" : "transparent"}`,
                marginBottom:-1, cursor:"pointer", display:"flex", alignItems:"center", gap:7,
              }}>
              <span>{t.icon}</span>{t.label}
              <span className="mono" style={{
                background:"rgba(11,17,32,.05)", padding:"0 6px", height:18, borderRadius:9,
                fontSize:10.5, display:"inline-flex", alignItems:"center", color:"var(--ink-3)", fontWeight:600,
              }}>{t.sub}</span>
            </button>
          ))}
        </div>

        {/* Search + filters */}
        <div className="card" style={{padding:"10px 12px", display:"flex",alignItems:"center", gap:8, marginBottom:14}}>
          <div style={{flex:1, position:"relative"}}>
            <IconSearch size={14} style={{
              position:"absolute", left:10, top:"50%", transform:"translateY(-50%)",
              color:"var(--ink-4)"
            }} />
            <input value={q} onChange={e=>setQ(e.target.value)}
                   placeholder={tab==="library"
                                  ? "搜索笔记（如 续航 / 露营 / 落日橘…）"
                                  : "搜索历史问题（如 卖点 / 微博 / 配图…）"}
                   style={{
                     width:"100%", height:32, padding:"0 10px 0 32px",
                     border:"none", outline:"none", fontSize:13, background:"transparent",
                   }} />
          </div>
          {tab === "log" && (
            <div style={{display:"flex",gap:4, padding:2, background:"rgba(11,17,32,.04)", borderRadius:7}}>
              {[
                {id:"date",  label:"按日期"},
                {id:"score", label:"按评分"},
                {id:"cost",  label:"按成本"},
              ].map(s => (
                <button key={s.id} onClick={()=>setSort(s.id)}
                  style={{
                    border:"none", padding:"4px 10px", fontSize:12, fontWeight:600, borderRadius:5,
                    background: sort===s.id ? "#fff" : "transparent",
                    color: sort===s.id ? "var(--ink)" : "var(--ink-3)",
                    cursor:"pointer",
                    boxShadow: sort===s.id ? "0 1px 2px rgba(11,17,32,.08)" : "none",
                  }}>{s.label}</button>
              ))}
            </div>
          )}
        </div>

        {tab === "library" && (
          <>
            {/* Filter chips */}
            <div style={{display:"flex", gap:6, marginBottom:14, flexWrap:"wrap"}}>
              {filterOptions.map(f => (
                <button key={f} onClick={()=>setFilter(f)}
                  className="chip"
                  style={{
                    cursor:"pointer", border:"1px solid",
                    background: filter===f ? "var(--brand)" : "#fff",
                    color: filter===f ? "#fff" : "var(--ink-2)",
                    borderColor: filter===f ? "var(--brand)" : "var(--line)",
                    fontWeight:500, height:26, padding:"0 11px", fontSize:12,
                  }}>{f}</button>
              ))}
              <span style={{flex:1}} />
              <span style={{fontSize:11.5, color:"var(--ink-4)", alignSelf:"center"}}>
                {filteredNotes.length} 篇
              </span>
            </div>

            <div style={{
              display:"grid",
              gridTemplateColumns:"repeat(auto-fill, minmax(280px, 1fr))",
              gap:12,
            }}>
              {filteredNotes.map(n => (
                <NoteLibraryCard key={n.id} note={n} onOpen={()=>setDetail({asNote:n})} />
              ))}
            </div>
            {filteredNotes.length === 0 && (
              <div style={{textAlign:"center", padding:"60px 0", color:"var(--ink-4)", fontSize:13}}>
                没有匹配的笔记 · 试试换一个筛选条件
              </div>
            )}
          </>
        )}

        {tab === "log" && Object.entries(grouped).map(([date, list]) => (
          <div key={date} style={{marginBottom:18}}>
            <div style={{
              display:"flex",alignItems:"center", gap:10, marginBottom:8,
              fontSize:11.5, fontWeight:600, color:"var(--ink-3)",
              letterSpacing:".06em", textTransform:"uppercase",
            }}>
              <span>{date}</span>
              <div style={{flex:1, height:1, background:"var(--line-2)"}} />
              <span className="mono" style={{color:"var(--ink-4)", textTransform:"none", letterSpacing:0}}>
                {list.length} 项
              </span>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {list.map((h, i) => (
                <div key={i} className="card" style={{
                  padding:"13px 16px", display:"flex", alignItems:"center", gap:14,
                  transition:".15s",
                }}
                onMouseEnter={(e)=>{e.currentTarget.style.borderColor="#B6BFE0";}}
                onMouseLeave={(e)=>{e.currentTarget.style.borderColor="var(--line)";}}>
                  <span className="mono" style={{
                    flex:"none", fontSize:11.5, color:"var(--ink-4)", width:42,
                  }}>{h.time}</span>
                  <span style={{
                    flex:"none", fontSize:18, lineHeight:1,
                  }}>
                    {h.tag==="营销文案"?"💡":h.tag==="竞品分析"?"📊":h.tag==="多渠道"?"📱":h.tag==="场景化"?"🌟":"✏️"}
                  </span>
                  <div style={{flex:1, minWidth:0}}>
                    <div style={{fontSize:13.5, fontWeight:600, color:"var(--ink)",
                                 overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>
                      「{h.q}」
                    </div>
                    <div style={{display:"flex",alignItems:"center", gap:12, fontSize:11.5, color:"var(--ink-3)", marginTop:4}}>
                      <span className="chip" style={{
                        background: h.preset ? "var(--brand-soft)" : "rgba(11,17,32,.05)",
                        color:      h.preset ? "var(--brand)"      : "var(--ink-3)",
                        fontSize:10.5,
                      }}>{h.tag}</span>
                      <span>
                        {[1,2,3,4,5].map(i => (
                          <span key={i} style={{color: i<=h.score?"#E5A636":"rgba(11,17,32,.15)"}}>★</span>
                        ))}
                      </span>
                      <span style={{display:"inline-flex",alignItems:"center",gap:4}}>
                        <IconEdit size={11} stroke={1.6} /> {h.edits} 次编辑
                      </span>
                      <span className="mono" style={{color:"var(--ok)", fontWeight:600}}>
                        ${h.cost.toFixed(2)}
                      </span>
                    </div>
                  </div>
                  <div style={{display:"flex", gap:5}}>
                    <button className="btn btn-sm" onClick={()=>setDetail(h)}>
                      <IconEye size={12} stroke={1.8} /> 详情
                    </button>
                    <button className="btn btn-sm btn-ghost"><IconRefresh size={12} stroke={1.8} /> 复用</button>
                    <button className="btn btn-sm btn-ghost"><IconTrash size={12} stroke={1.8} /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <HistoryDetailModal item={detail} onClose={()=>setDetail(null)} />
    </main>
  );
}

Object.assign(window, { History });
