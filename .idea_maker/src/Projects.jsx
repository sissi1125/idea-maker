function Projects({ project, setProject, setRoute }) {
  const [creating, setCreating] = React.useState(false);
  const [name, setName] = React.useState("");
  return (
    <main style={{flex:1,height:"100%",overflow:"auto", background:"var(--bg)"}}>
      <div style={{maxWidth:1100, margin:"0 auto", padding:"28px 32px 80px"}}>
        <div style={{display:"flex",alignItems:"flex-end", marginBottom:20}}>
          <div style={{flex:1}}>
            <div style={{fontSize:22, fontWeight:600, letterSpacing:"-.01em"}}>所有项目</div>
            <div style={{fontSize:13, color:"var(--ink-3)", marginTop:2}}>
              每个项目拥有独立的知识库、偏好和 Agent 记忆 · 共 {PROJECTS.length} 个
            </div>
          </div>
          <button className="btn btn-primary" onClick={()=>setCreating(true)}>
            <IconPlus size={13} stroke={2.2} /> 新建项目
          </button>
        </div>

        <div style={{
          display:"grid",
          gridTemplateColumns:"repeat(auto-fill, minmax(280px, 1fr))",
          gap:14,
        }}>
          {/* New project card */}
          {creating && (
            <div className="card fade-in" style={{padding:"18px 18px", border:"1px dashed var(--brand)", background:"var(--brand-soft)"}}>
              <div style={{fontSize:13, fontWeight:600, color:"var(--brand)", marginBottom:8}}>新项目</div>
              <input autoFocus value={name} onChange={e=>setName(e.target.value)}
                     placeholder="项目名称，如「夏季新品蓝牙音响」"
                     style={{width:"100%", height:34, padding:"0 10px", borderRadius:7,
                             border:"1px solid var(--line-strong)", outline:"none", fontSize:13,
                             background:"#fff"}} />
              <div style={{display:"flex", gap:6, marginTop:10}}>
                <button className="btn btn-sm btn-primary" disabled={!name.trim()}
                        onClick={()=>{ setCreating(false); setName(""); }}>创建</button>
                <button className="btn btn-sm" onClick={()=>{setCreating(false); setName("");}}>取消</button>
              </div>
            </div>
          )}

          {PROJECTS.map(p => {
            const active = p.id === project.id;
            return (
              <div key={p.id} className="card"
                   onClick={()=>{ setProject(p); setRoute("chat"); }}
                   style={{
                     padding:"18px 18px", cursor:"pointer", position:"relative",
                     border: active ? "1px solid var(--brand)" : "1px solid var(--line)",
                     boxShadow: active ? "0 0 0 4px rgba(79,168,154,.1)" : "var(--shadow-sm)",
                     transition:".18s",
                   }}
                   onMouseEnter={(e)=>{e.currentTarget.style.transform="translateY(-2px)";
                                       e.currentTarget.style.boxShadow= active ?
                                          "0 0 0 4px rgba(79,168,154,.14), 0 12px 28px rgba(79,168,154,.16)" :
                                          "0 10px 24px rgba(31,45,52,.07)" }}
                   onMouseLeave={(e)=>{e.currentTarget.style.transform="none";
                                       e.currentTarget.style.boxShadow= active ?
                                          "0 0 0 4px rgba(79,168,154,.1)" :
                                          "var(--shadow-sm)" }}
              >
                <div style={{display:"flex",alignItems:"flex-start", gap:12, marginBottom:10}}>
                  <div style={{
                    width:42,height:42,borderRadius:10,
                    background:"linear-gradient(180deg, #FBF9F2, #F2EFE5)",
                    border:"1px solid var(--line-2)",
                    display:"flex",alignItems:"center",justifyContent:"center", fontSize:22,
                  }}>{p.emoji}</div>
                  <div style={{flex:1, minWidth:0}}>
                    <div style={{fontSize:14.5, fontWeight:600, letterSpacing:"-.01em",
                                 whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis"}}>
                      {p.name}
                    </div>
                    <div style={{fontSize:11, color:"var(--ink-4)", marginTop:2}}>
                      创建于 {p.created}
                    </div>
                  </div>
                  {active && <span className="chip" style={{background:"var(--brand-soft)", color:"var(--brand)"}}>当前</span>}
                </div>
                <div style={{fontSize:12.5, color:"var(--ink-3)", lineHeight:1.55,
                             display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical",
                             overflow:"hidden",
                             minHeight: 34, marginBottom:14}}>
                  {p.description}
                </div>
                <div style={{display:"flex", gap:14, paddingTop:11,
                             borderTop:"1px solid var(--line-2)",fontSize:11.5, color:"var(--ink-3)"}}>
                  <span style={{display:"inline-flex",alignItems:"center",gap:5}}>
                    <IconFile size={11} stroke={1.6} /> {p.docs} 文档
                  </span>
                  <span style={{display:"inline-flex",alignItems:"center",gap:5}}>
                    <IconClock size={11} stroke={1.6} /> {p.updated}
                  </span>
                  <span style={{marginLeft:"auto", display:"inline-flex",alignItems:"center",gap:5,
                                color:"var(--ok)", fontWeight:600}} className="mono">
                    <IconDollar size={10} stroke={2} /> {p.cost.toFixed(2)}
                  </span>
                </div>
                <button onClick={(e)=>{e.stopPropagation();}}
                        className="btn btn-sm btn-ghost"
                        style={{position:"absolute", top:10, right:10, padding:"0 6px", height:24}}>
                  <IconDots size={14} />
                </button>
              </div>
            );
          })}

          <div className="card" style={{
            padding:"18px 18px", border:"1px dashed var(--line-strong)",
            background:"transparent", cursor:"pointer",
            display:"flex", alignItems:"center", justifyContent:"center",
            color:"var(--ink-3)", minHeight: 162, fontSize:13.5, fontWeight:500, gap:8,
          }} onClick={()=>setCreating(true)}>
            <IconPlus size={14} stroke={2} /> 新建项目
          </div>
        </div>
      </div>
    </main>
  );
}

Object.assign(window, { Projects });
